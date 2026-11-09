import { KTeamError } from '../errors.js';

export type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

function unicode(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new KTeamError('invalid_unicode');
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new KTeamError('invalid_unicode');
  }
}

/** AIMP v3.1 vector subset. Unsafe integers/floats are deliberately unsupported. */
export function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new KTeamError('json_depth_exceeded');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { unicode(value); return JSON.stringify(value); }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, v => canonical(v, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => {
      unicode(key);
      return JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key], depth + 1);
    }).join(',') + '}';
  }
  throw new KTeamError('unsupported_json_value');
}

/** Bounded JSON parser: rejects duplicate keys before they can disappear in JSON.parse. */
export function parseJson(input: string, maxBytes = 256 * 1024): Json {
  return parseBoundedJson(input,maxBytes,false);
}

/** Semantic host responses contain measurements and model scores, outside AIMP canonicalization. */
export function parseDataJson(input: string,maxBytes=256*1024):Json {
  return parseBoundedJson(input,maxBytes,true);
}

function parseBoundedJson(input:string,maxBytes:number,allowFractional:boolean):Json {
  if (Buffer.byteLength(input) > maxBytes) throw new KTeamError('message_too_large', 413);
  let at = 0;
  function ws() { while (/[\x20\t\r\n]/.test(input[at] ?? '\0')) at++; }
  function string(): string {
    const start = at++;
    while (at < input.length) {
      const c = input[at++];
      if (c === '\\') { at++; continue; }
      if (c === '"') {
        const result: unknown = JSON.parse(input.slice(start, at));
        if (typeof result !== 'string') throw new KTeamError('invalid_json');
        unicode(result);
        return result;
      }
    }
    throw new KTeamError('invalid_json');
  }
  function read(depth: number): Json {
    if (depth > 32) throw new KTeamError('json_depth_exceeded');
    ws();
    const c = input[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; ws();
      const result: { [key: string]: Json } = {};
      const keys = new Set<string>();
      if (input[at] === '}') { at++; return result; }
      while (true) {
        ws();
        if (input[at] !== '"') throw new KTeamError('invalid_json');
        const key = string();
        if (keys.has(key)) throw new KTeamError('duplicate_json_key');
        keys.add(key); ws();
        if (input[at++] !== ':') throw new KTeamError('invalid_json');
        Object.defineProperty(result, key, { value: read(depth + 1), enumerable: true, configurable: true });
        ws(); const sep = input[at++];
        if (sep === '}') return result;
        if (sep !== ',') throw new KTeamError('invalid_json');
      }
    }
    if (c === '[') {
      at++; ws(); const result: Json[] = [];
      if (input[at] === ']') { at++; return result; }
      while (true) {
        result.push(read(depth + 1)); ws(); const sep = input[at++];
        if (sep === ']') return result;
        if (sep !== ',') throw new KTeamError('invalid_json');
      }
    }
    const match = /^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(input.slice(at));
    if (!match) throw new KTeamError('invalid_json');
    at += match[0].length;
    const result: unknown = JSON.parse(match[0]);
    if (typeof result === 'number' && (!Number.isFinite(result)||(Number.isInteger(result)&&!Number.isSafeInteger(result))||(!allowFractional&&!Number.isSafeInteger(result)))) throw new KTeamError('unsupported_json_number');
    return result as Json;
  }
  try {
    const result = read(0); ws();
    if (at !== input.length) throw new KTeamError('invalid_json');
    return result;
  } catch (error) {
    if (error instanceof KTeamError) throw error;
    throw new KTeamError('invalid_json');
  }
}
