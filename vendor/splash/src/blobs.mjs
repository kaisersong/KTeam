import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Failure, requireValue } from './errors.mjs';
function keyPath(key) { requireValue(/^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9]{64}$/.test(key), 'invalid_storage_key', 500); return key; }
export class FileBlobs {
  constructor(root) { this.root = resolve(root); }
  async put(key, bytes) {
    const target = resolve(this.root, keyPath(key)); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 }); await chmod(target, 0o600);
  }
  async get(key) { try { return await readFile(resolve(this.root, keyPath(key))); } catch { throw new Failure('content_unavailable', 503); } }
}
export class CloudBaseBlobs {
  constructor({ baseURL, key, bucket }) {
    this.base = new URL(baseURL); requireValue(this.base.protocol === 'https:' && key && /^[a-z0-9-]+$/.test(bucket), 'invalid_backend_configuration', 500);
    this.key = key; this.bucket = bucket;
  }
  async request(method, key, bytes, type) {
    try {
      const url = new URL(`/v1/storages/object/${this.bucket}/${keyPath(key).split('/').map(encodeURIComponent).join('/')}`, this.base);
      const response = await fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.key}`, ...(bytes ? { 'Content-Type': type, 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store', 'x-upsert': 'true' } : {}) }, body: bytes,
      });
      if (!response.ok) throw new Failure('content_unavailable', 503);
      return response;
    } catch { throw new Failure('content_unavailable', 503); }
  }
  async put(key, bytes, type) { await this.request('POST', key, bytes, type); }
  async get(key) {
    const response = await this.request('GET', key);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new Failure('content_too_large', 503); } chunks.push(value); }
    return Buffer.concat(chunks);
  }
}
