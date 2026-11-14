import http from 'node:http';
import { Failure, requireValue } from './errors.mjs';
import { policy } from './package.mjs';
import { workspaceHTML, workspaceJS } from './workspace.mjs';

async function body(req) {
  requireValue((req.headers['content-type'] ?? '').split(';')[0] === 'application/json', 'json_required', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; requireValue(size <= 1500000, 'request_too_large', 413); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Failure('invalid_json'); }
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'json_object_required');
  return value;
}
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
function fail(res, error) { if (!res.headersSent) json(res, error instanceof Failure ? error.status : 503, { error: error instanceof Failure ? error.code : 'unavailable' }); else res.destroy(); }
export function servers({ service, verify, contentSuffix = 'spaces.localhost' }) {
  requireValue(/^[a-z0-9.-]+$/.test(contentSuffix), 'invalid_content_domain', 500);
  // Fixed-memory pre-admission limiter: rejects before touching cloud DB. No trusting X-Forwarded-For.
  const counters = new Map();
  let globalWindow = 0, globalCount = 0;
  function earlyLimit(req) {
    const now = Math.floor(Date.now() / 10000); const ip = req.socket.remoteAddress;
    if (now !== globalWindow) { globalWindow = now; globalCount = 0; }
    requireValue(++globalCount <= 2000, 'rate_limited', 429);
    const key = `${ip}:${now}`; const count = (counters.get(key) ?? 0) + 1;
    for (const k of counters.keys()) if (!k.endsWith(`:${now}`)) counters.delete(k);
    requireValue(counters.has(key) || counters.size < 10000, 'rate_limited', 429);
    counters.set(key, count); requireValue(count <= 200, 'rate_limited', 429);
  }
  const control = http.createServer(async (req, res) => {
    try {
      earlyLimit(req);
      const host = req.headers.host ?? ''; requireValue(!host.split(':')[0].endsWith(`.${contentSuffix}`), 'invalid_host', 400);
      if (req.headers.origin) requireValue(req.headers.origin === `http://${host}` || req.headers.origin === `https://${host}`, 'origin_rejected', 403);
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
      if (req.method === 'GET' && ['/splash', '/splash/app.js'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': url.pathname === '/splash' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(url.pathname === '/splash' ? workspaceHTML : workspaceJS);
      }
      const owner = await verify(req.headers.authorization); const key = req.headers['idempotency-key'];
      if (url.pathname === '/v1/operations' && req.method === 'GET') return json(res, 200, await service.operation(owner, url.searchParams.get('kind'), url.searchParams.get('spaceId'), url.searchParams.get('key')));
      if (url.pathname === '/v1/quota' && req.method === 'GET') return json(res, 200, await service.quota(owner));
      if (url.pathname === '/v1/spaces') {
        if (req.method === 'GET') return json(res, 200, await service.list(owner));
        if (req.method === 'POST') { const b = await body(req); return json(res, 201, await service.create(owner, b.title, key)); }
      }
      const match = /^\/v1\/spaces\/([a-f0-9-]{36})(?:\/(versions|publish|rollback|unpublish))?$/.exec(url.pathname);
      requireValue(match, 'not_found', 404); const [, id, action] = match;
      const shareUrl = () => `http://${id}.${contentSuffix}:${content.address().port}/`;
      if (!action && req.method === 'GET') { const result = await service.read(owner, id); return json(res, 200, { ...result, shareUrl: result.status === 'published' ? shareUrl() : null }); }
      requireValue(req.method === 'POST', 'method_not_allowed', 405); const b = await body(req);
      if (action === 'versions') return json(res, 201, await service.upload(owner, id, b, b.expectedRevision, key));
      if (action === 'publish' || action === 'rollback') { const result = await service.publish(owner, id, action === 'publish' ? b.versionId : b.releaseId, b.expectedRevision, key, action === 'rollback'); return json(res, 200, { ...result, shareUrl: shareUrl() }); }
      if (action === 'unpublish') return json(res, 200, await service.unpublish(owner, id, b.expectedRevision, key));
      throw new Failure('not_found', 404);
    } catch (error) { fail(res, error); }
  });
  const content = http.createServer(async (req, res) => {
    let admission, enqueued = 0, terminal = false;
    const settle = async () => {
      if (terminal || !admission) return; terminal = true;
      try { await service.settle(admission.holdId, enqueued); } catch { /* preserve unknown durable hold; never invent a refund */ }
    };
    try {
      earlyLimit(req);
      requireValue(['GET', 'HEAD'].includes(req.method), 'method_not_allowed', 405);
      const host = (req.headers.host ?? '').split(':')[0];
      const tail = `.${contentSuffix}`; requireValue(host.endsWith(tail), 'not_found', 404);
      const id = host.slice(0, -tail.length); requireValue(/^[a-f0-9-]{36}$/.test(id), 'not_found', 404);
      requireValue(!req.headers.range, 'range_unsupported', 416);
      const url = new URL(req.url, 'http://local'); requireValue(!url.search, 'query_not_supported');
      let path; try { path = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Failure('invalid_path'); }
      admission = await service.admit(id, path, req.method === 'HEAD');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', policy(admission.scriptHashes)); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', admission.file.type); res.setHeader('Content-Length', String(admission.file.size));
      res.once('finish', settle); res.once('close', settle);
      if (req.method === 'HEAD') { res.end(); return; }
      const bytes = await service.materialize(admission);
      // Charge bytes accepted by Node's output queue, not proof of client receipt.
      // Unknown process crashes stay reserved for reconciliation.
      enqueued = bytes.length; res.end(bytes);
    } catch (error) { await settle(); res.removeHeader('Content-Length'); fail(res, error); }
  });
  for (const server of [control, content]) { server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100; }
  return { control, content };
}
