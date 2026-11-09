import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Upstreams, loopbackUrl } from '../src/adapters/upstream.js';

test('upstream URLs never send installation credentials to non-loopback destinations', () => {
  for (const url of ['https://example.com','http://example.com','http://localhost','http://127.0.0.1/a','http://user:password@127.0.0.1','http://127.0.0.1/?secret=1']) {
    assert.throws(() => loopbackUrl(url), /upstream_must_be_loopback/);
  }
  assert.equal(loopbackUrl('http://127.0.0.1:4318'), 'http://127.0.0.1:4318');
});

test('lost or malformed POST receipts remain unknown, with no automatic retries or redirected credentials', async () => {
  let posts = 0, redirected = 0;
  const target = http.createServer((_req, res) => { redirected++; res.end('{}'); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const targetPort = (target.address() as { port: number }).port;
  const server = http.createServer((req, res) => {
    posts++;
    if (req.url?.includes('redirect')) res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/captured` });
    res.end('response lost after action');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const upstream = new Upstreams({ brokerUrl: url, kswarmUrl: url, brokerToken: 'installation-credential' });
  try {
    await assert.rejects(upstream.sendMessage('room', { text: 'work' }), /upstream_operation_unknown/);
    assert.equal(posts, 1);
    await assert.rejects(upstream.sendMessage('redirect', { text: 'work' }), /upstream_operation_unknown/);
    assert.equal(posts, 2); assert.equal(redirected, 0);
  } finally {
    server.closeAllConnections(); target.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => target.close(() => resolve()))]);
  }
});
