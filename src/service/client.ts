import http from 'node:http';
import { KTeamError, record } from '../errors.js';
import { parseDataJson } from '../protocol/json.js';
import { clientToken, socketPath, type ClientId } from './config.js';
import { versionHeaders } from './api-version.js';

/** Shared by KTeam main and future xiaok main adapter. Tokens never enter renderer. */
export async function hostRequest(root: string, client: ClientId, route: string, value?: unknown) {
  const token = clientToken(root, client);
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.request({ socketPath: socketPath(root), path: route, agent: false, method: value === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + token, ...versionHeaders(), ...(value !== undefined ? { 'content-type': 'application/json' } : {}) },
    }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { res.destroy(new KTeamError('host_response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const result = record(parseDataJson(Buffer.concat(chunks).toString('utf8'), 2 * 1024 * 1024));
          if (!res.statusCode || res.statusCode >= 400 || result.ok === false) throw new KTeamError(String(result.code ?? 'host_request_failed'), res.statusCode, result.details);
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new KTeamError(value === undefined ? 'host_timeout' : 'host_operation_unknown', 503)));
    if (value !== undefined) req.write(JSON.stringify(value));
    req.end();
  });
}
