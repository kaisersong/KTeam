import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { KTeamError, record } from '../errors.js';
import { parseJson } from '../protocol/json.js';
import { AIMP_SPEC, AIMP_WIRE } from '../protocol/aimp.js';
import { Upstreams, type UpstreamOptions } from '../adapters/upstream.js';
import { CLIENTS, clientToken, ensurePrivateRoot, socketPath, type ClientId } from './config.js';
import { acquireOwner } from './owner.js';
import { CollaborationService } from './collaboration.js';

export const API_VERSION = 1;
export const SCHEMA_VERSION = 1;
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new KTeamError('message_too_large', 413);
    chunks.push(chunk);
  }
  try { return parseJson(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch (error) { if (error instanceof KTeamError) throw error; throw new KTeamError('invalid_utf8'); }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function page(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new KTeamError('invalid_pagination');
  return Number(value);
}
export async function startHost(options: { root: string; upstream: UpstreamOptions }) {
  ensurePrivateRoot(options.root);
  const path = socketPath(options.root);
  const tokens = CLIENTS.map(id => ({ id, token: clientToken(options.root, id) }));
  if (tokens.some(v => v.token.length < 32) || new Set(tokens.map(v => v.token)).size !== tokens.length) throw new KTeamError('client_credentials_invalid');
  const upstream = new Upstreams(options.upstream);
  const owner = acquireOwner(options.root);
  const collaboration = new CollaborationService(upstream);
  const instanceId = randomUUID();
  const server = http.createServer(async (req, res) => {
    try {
      // Even a local browser with a stolen URL gets no access; there is no CORS surface.
      if (req.headers.origin !== undefined) throw new KTeamError('browser_origin_forbidden', 403);
      const bearer = typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer /, '') : '';
      const client = tokens.find(entry => equal(entry.token, bearer));
      if (!client) throw new KTeamError('authentication_required', 401);
      const url = new URL(req.url ?? '/', 'http://kteam.local');
      const compatible = req.headers['x-kteam-api-version'] === String(API_VERSION)
        && req.headers['x-kteam-schema-version'] === String(SCHEMA_VERSION);
      if (url.pathname === '/v1/handshake' && req.method === 'GET') {
        return send(res, 200, { ok: true, product: 'KTeam', clientId: client.id,
          apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION, ownerEpoch: owner.epoch, instanceId,
          access: compatible ? 'read_write' : 'read_only',
          aimp: { specification: AIMP_SPEC, wire: AIMP_WIRE, enabledLevels: ['L0'], compatibilityClaim: null,
            executionEnabled: false, reason: 'core_l2_sequencer_not_implemented' },
          capabilities: ['existing-agent-roster','broker-owned-teams','aimp-l0-message','bounded-history'],
        });
      }
      if (req.method !== 'GET' && !compatible) throw new KTeamError('client_upgrade_required', 409);
      if (url.pathname === '/v1/status' && req.method === 'GET') return send(res, 200, { ok: true, ownerEpoch: owner.epoch, instanceId, upstream: await upstream.probe() });
      if (url.pathname === '/v1/bots' && req.method === 'GET') return send(res, 200, await collaboration.bots());
      if (url.pathname === '/v1/runtimes' && req.method === 'GET') return send(res, 200, await collaboration.runtimes());
      if (url.pathname === '/v1/teams') {
        if (req.method === 'GET') return send(res, 200, await collaboration.teams());
        if (req.method === 'POST') return send(res, 201, await collaboration.createTeam(await body(req)));
      }
      if (url.pathname === '/v1/messages' && req.method === 'POST') return send(res, 201, await collaboration.send(await body(req)));
      const history = /^\/v1\/teams\/([^/]+)\/messages$/.exec(url.pathname);
      if (history && req.method === 'GET') {
        const after = page(url.searchParams.get('after'), 0, Number.MAX_SAFE_INTEGER);
        const limit = page(url.searchParams.get('limit'), 50, 100);
        if (!limit) throw new KTeamError('invalid_pagination');
        return send(res, 200, await collaboration.messages(decodeURIComponent(history[1]!), after, limit));
      }
      throw new KTeamError('route_not_found', 404);
    } catch (error) {
      const known = error instanceof KTeamError;
      send(res, known ? error.status : 500, { ok: false, code: known ? error.code : 'internal_error', ...(known && error.details ? { details: error.details } : {}) });
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 32;
  try {
    // Only the exclusive owner may remove a socket left by its crashed predecessor.
    if (existsSync(path)) {
      if (!lstatSync(path).isSocket()) throw new KTeamError('host_socket_path_occupied');
      unlinkSync(path);
    }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    chmodSync(path, 0o600);
  } catch (error) { server.close(); owner.release(); throw error; }
  let closePromise: Promise<void> | undefined;
  return { epoch: owner.epoch, instanceId, path,
    close() {
      if (!closePromise) closePromise = (async () => {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        owner.release();
      })();
      return closePromise;
    },
  };
}

export function versionHeaders() { return { 'x-kteam-api-version': String(API_VERSION), 'x-kteam-schema-version': String(SCHEMA_VERSION) }; }
export type { ClientId };
