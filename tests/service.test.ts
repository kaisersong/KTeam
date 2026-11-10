import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import http from 'node:http';
import { initConfig, clientToken, socketPath } from '../src/service/config.js';
import { startHost, versionHeaders } from '../src/service/server.js';
import { hostRequest } from '../src/service/client.js';

function raw(root: string, headers: Record<string, string>, value?: unknown, path = '/v1/handshake') {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ socketPath: socketPath(root), path, agent: false, method: value === undefined ? 'GET' : 'POST', headers }, res => {
      let output = ''; res.on('data', data => output += data); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(output) }));
    });
    req.on('error', reject); req.end(value === undefined ? undefined : JSON.stringify(value));
  });
}

test('single durable host, two independently authenticated clients, incompatible version is read-only, restart fence rises', async () => {
  const root = realpathSync(mkdtempSync('/tmp/kteam-service-'));
  initConfig(root, { version: 1, brokerUrl: 'http://127.0.0.1:1', kswarmUrl: 'http://127.0.0.1:1' });
  let host = await startHost({ root, upstream: { brokerUrl: 'http://127.0.0.1:1', kswarmUrl: 'http://127.0.0.1:1' } });
  try {
    const a = await hostRequest(root, 'kteam-main', '/v1/handshake');
    const b = await hostRequest(root, 'kteam-companion', '/v1/handshake');
    assert.equal(a.clientId, 'kteam-main'); assert.equal(b.clientId, 'kteam-companion');
    assert.equal(a.instanceId, b.instanceId); assert.equal(a.ownerEpoch, b.ownerEpoch);
    await assert.rejects(startHost({ root, upstream: { brokerUrl: 'http://127.0.0.1:1', kswarmUrl: 'http://127.0.0.1:1' } }), /host_already_running/);
    assert.equal((await hostRequest(root, 'kteam-main', '/v1/handshake')).instanceId, a.instanceId);
    assert.equal((await raw(root, {})).status, 401);
    const auth = { authorization: 'Bearer ' + clientToken(root, 'kteam-main') };
    assert.equal((await raw(root, { ...auth, origin: 'http://evil.example' })).status, 403);
    assert.equal((await raw(root, { ...auth, 'x-kteam-api-version': '99' })).body.access, 'read_only');
    assert.equal((await raw(root, auth, {}, '/v1/teams')).body.code, 'client_upgrade_required');
    assert.equal((await raw(root, { ...auth, ...versionHeaders() }, { from: 'agent://x/fake' }, '/v1/messages')).status, 400);
    assert.equal((await raw(root, { ...auth, ...versionHeaders() }, undefined, '/v1/teams/x/messages?limit=100000')).body.code, 'invalid_pagination');
    const status = await hostRequest(root, 'kteam-main', '/v1/status');
    assert.equal((status.upstream as { ready: boolean }).ready, false);
    const oldEpoch = host.epoch;
    await host.close();
    host = await startHost({ root, upstream: { brokerUrl: 'http://127.0.0.1:1', kswarmUrl: 'http://127.0.0.1:1' } });
    assert.ok(host.epoch > oldEpoch);
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }); }
});
