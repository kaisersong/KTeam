import { createHash, createPublicKey, sign, verify, type KeyLike } from 'node:crypto';
import { canonical } from './json.js';
import { KTeamError, record, text } from '../errors.js';

export const AIMP_SPEC = '3.1';
export const AIMP_WIRE = '1.0';
const intentFields = ['aimp','id','thread_id','room_id','task_ref','control_ref','target_event','from','to','mentions','audience','exp','key_id','reply_to','act','source_level','classification','capability_token','intent_origin'];
const recordFields = ['intent_hash','sender_sig','seq','term','recorded_at','prev_hash','verdict'];
const systemFields = ['id','thread_id','task_ref','control_ref','target_event','act','source_level','key_id','payload'];
const approvalFields = ['schema_version','task_ref','action_type','target','amount','irreversibility','artifacts','payload','constraints'];
export type SignatureDomain = 'intent' | 'record' | 'system' | 'approval';
export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function pick(input: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
}

/** Explicit projection: ts, locale, sig and sequencing never acquire authority. */
export function intentProjection(envelope: Record<string, unknown>): Record<string, unknown> {
  const projection = pick(envelope, intentFields);
  if (typeof envelope.body !== 'string') throw new KTeamError('invalid_body');
  canonical(envelope.body); // Reject lone surrogates before UTF-8 hashing can replace them.
  projection.body_hash = sha256(envelope.body);
  if (Object.hasOwn(envelope, 'payload')) projection.payload_hash = sha256(canonical(envelope.payload));
  if (Object.hasOwn(envelope, 'artifacts')) {
    if (!Array.isArray(envelope.artifacts)) throw new KTeamError('invalid_artifacts');
    projection.artifacts = envelope.artifacts.map(value => pick(record(value), ['ref','version','sha256','media_type']));
  }
  return projection;
}

export function projection(domain: SignatureDomain, object: Record<string, unknown>): Record<string, unknown> {
  if (domain === 'intent') return intentProjection(object);
  return pick(object, domain === 'record' ? recordFields : domain === 'system' ? systemFields : approvalFields);
}
export function signatureBytes(domain: SignatureDomain, projected: unknown): Buffer {
  return Buffer.concat([Buffer.from(`AIMP/1/${domain}\0`, 'utf8'), Buffer.from(canonical(projected), 'utf8')]);
}
export function intentHash(envelope: Record<string, unknown>): string {
  return sha256(signatureBytes('intent', intentProjection(envelope)));
}
/** Codec primitive only: neither this signature nor its verification grants permission. */
export function signProjection(domain: SignatureDomain, projected: unknown, key: KeyLike): string {
  return sign(null, signatureBytes(domain, projected), key).toString('hex');
}
export function verifyProjection(domain: SignatureDomain, projected: unknown, sig: string, publicKeyHex: string): boolean {
  if (!/^[a-f0-9]{128}$/.test(sig) || !/^[a-f0-9]{64}$/.test(publicKeyHex)) return false;
  const key = createPublicKey({ key: Buffer.from('302a300506032b6570032100' + publicKeyHex, 'hex'), format: 'der', type: 'spki' });
  return verify(null, signatureBytes(domain, projected), key, Buffer.from(sig, 'hex'));
}

export interface L0Envelope extends Record<string, unknown> {
  aimp: '1.0'; id: string; room_id: string; thread_id: string; from: string;
  to: string[]; mentions: string[]; ts: string; act: 'chat' | 'inform';
  source_level: 'principal' | 'peer' | 'environment'; body: string;
}

/** Preview transport accepts conversational L0 only. L2 needs a sequencer/contract first. */
export function validateL0(value: unknown): L0Envelope {
  const m = record(value);
  if (m.aimp !== AIMP_WIRE) throw new KTeamError('unsupported_aimp_version');
  text(m.id, 'message_id'); text(m.room_id, 'room_id'); text(m.thread_id, 'thread_id');
  if (!/^msg_[a-f0-9]{32}$/.test(String(m.id))) throw new KTeamError('invalid_message_id');
  text(m.body, 'body', 32_768);
  if (!['chat','inform'].includes(String(m.act))) throw new KTeamError('aimp_effect_not_enabled', 409);
  if (!['principal','peer','environment'].includes(String(m.source_level))) throw new KTeamError('invalid_source_level');
  if (typeof m.from !== 'string' || !/^(human|agent):\/\/[a-z0-9.-]+\/[^/\s]+$/.test(m.from)) throw new KTeamError('invalid_from');
  for (const field of ['to','mentions']) {
    if (!Array.isArray(m[field]) || m[field].length > 16 || m[field].some(v => typeof v !== 'string' || !/^(human|agent):\/\/[a-z0-9.-]+\/[^/\s]+$/.test(v))) throw new KTeamError('invalid_' + field);
  }
  if (typeof m.ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(m.ts) || !Number.isFinite(Date.parse(m.ts))) throw new KTeamError('invalid_ts');
  const forbidden = ['payload','task_ref','control_ref','capability_token','intent_origin','sig','sequencing','key_id','target_event','artifacts'];
  if (forbidden.some(key => Object.hasOwn(m, key))) throw new KTeamError('aimp_effect_not_enabled', 409);
  const allowed = ['aimp','id','room_id','thread_id','from','to','mentions','ts','act','source_level','body','reply_to','locale','classification'];
  if (Object.keys(m).some(key => !allowed.includes(key))) throw new KTeamError('unknown_envelope_field');
  if (m.reply_to !== undefined) text(m.reply_to, 'reply_to');
  if (m.classification !== undefined && m.classification !== 'internal') throw new KTeamError('classification_not_supported');
  canonical(m);
  return m as L0Envelope;
}
