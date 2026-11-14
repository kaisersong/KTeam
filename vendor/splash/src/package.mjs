import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import { requireValue } from './errors.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' };
export function safePath(value) {
  requireValue(typeof value === 'string' && value.length < 200 && /^[A-Za-z0-9._/-]+$/.test(value), 'invalid_file_path');
  requireValue(!value.startsWith('/') && value.split('/').every(s => s && s !== '.' && s !== '..' && !s.startsWith('.')), 'invalid_file_path');
  return value;
}
function inspectHTML(bytes) {
  const hashes = [];
  const walk = node => {
    requireValue(!['iframe', 'object', 'embed', 'base', 'form'].includes(node.tagName), 'unsupported_html_capability');
    for (const attribute of node.attrs ?? []) {
      if (node.tagName === 'meta' && attribute.name === 'http-equiv') requireValue(attribute.value.toLowerCase() !== 'refresh', 'html_redirect_forbidden');
      requireValue(!attribute.name.startsWith('on'), 'inline_event_handler_unsupported');
      if (['src', 'href', 'action', 'poster', 'srcset', 'xlink:href'].includes(attribute.name)) {
        const value = attribute.value.trim();
        if (node.tagName === 'a' && attribute.name === 'href' && /^https?:\/\//i.test(value)) continue;
        requireValue(!/^[a-z][a-z0-9+.-]*:|^\/\/|\\/i.test(value), 'external_or_unsafe_resource');
      }
    }
    if (node.tagName === 'script' && !(node.attrs ?? []).some(a => a.name === 'src')) {
      const text = (node.childNodes ?? []).map(n => n.value ?? '').join('');
      hashes.push(`'sha256-${createHash('sha256').update(text).digest('base64')}'`);
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse(bytes.toString('utf8'))); return hashes;
}
export function validatePackage(input, maximum = 1024 * 1024) {
  requireValue(input && Array.isArray(input.files) && input.files.length > 0 && input.files.length <= 64, 'invalid_package');
  const paths = new Set(); let total = 0; const hashes = [];
  const files = input.files.map(file => {
    const path = safePath(file.path); requireValue(!paths.has(path), 'duplicate_file'); paths.add(path);
    requireValue(typeof file.base64 === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64), 'invalid_base64');
    const bytes = Buffer.from(file.base64, 'base64'); total += bytes.length;
    requireValue(total <= maximum, 'package_too_large', 413);
    const type = types[path.split('.').at(-1).toLowerCase()]; requireValue(type, 'unsupported_file_type');
    if (type.startsWith('text/html')) hashes.push(...inspectHTML(bytes));
    return { path, bytes, size: bytes.length, sha256: digest(bytes), type };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const entry = safePath(input.entry ?? 'index.html');
  requireValue(paths.has(entry) && entry.endsWith('.html'), 'missing_html_entry');
  const manifest = files.map(({ bytes, ...meta }) => meta);
  return { files, manifest, entry, total, fingerprint: digest(JSON.stringify({ manifest, entry })), scriptHashes: [...new Set(hashes)] };
}
export function policy(scriptHashes = []) {
  return `default-src 'self'; script-src 'self' ${scriptHashes.join(' ')}; style-src 'self' 'unsafe-inline'; worker-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}
