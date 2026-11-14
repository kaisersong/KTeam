import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, isAbsolute } from 'node:path';
import { SQLiteState } from './state.mjs';
import { FileBlobs } from './blobs.mjs';
import { SpaceService } from './service.mjs';
import { servers } from './http.mjs';
import { digest } from './package.mjs';
import { Failure } from './errors.mjs';

// This validation runtime deliberately supports local storage only. Cloud credentials
// belong to a separately deployed service, never to a desktop/browser bundle.
process.umask(0o077);
let pair, state, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (pair) await Promise.all(Object.values(pair).map(server => new Promise(done => {
    server.close(done); server.closeAllConnections();
  })));
  state?.close(); process.exit(0);
}
async function start(root) {
  if (!isAbsolute(root)) throw Error('absolute_data_directory_required');
  const token = randomBytes(32).toString('base64url'), expected = Buffer.from(digest(token));
  state = new SQLiteState(resolve(root, 'state.sqlite'));
  const service = new SpaceService({ state, blobs: new FileBlobs(resolve(root, 'blobs')) });
  pair = servers({ service, verify: async header => {
    const actual = Buffer.from(digest(typeof header === 'string' ? header.slice(7) : ''));
    if (!header?.startsWith('Bearer ') || !timingSafeEqual(expected, actual)) throw new Failure('unauthorized', 401);
    return digest('splash-local-profile');
  }});
  await Promise.all(Object.values(pair).map(server => new Promise((done, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', done);
  })));
  return `http://127.0.0.1:${pair.control.address().port}/splash#token=${token}`;
}
async function main() {
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (process.argv.includes('--managed-splash')) {
    if (!process.send) throw Error('parent_ipc_required');
    process.once('disconnect', stop);
    let initialized = false, nonce;
    const timer = setTimeout(stop, 10000);
    process.on('message', message => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'shutdown' && message.nonce === nonce && initialized) { void stop(); return; }
      if (initialized || message.type !== 'init' || !/^[a-f0-9]{64}$/.test(message.nonce) || typeof message.dataDir !== 'string') return;
      initialized = true; nonce = message.nonce; clearTimeout(timer);
      void start(message.dataDir).then(url => {
        if (!stopping && process.connected) process.send({ type: 'ready', nonce, url });
      }).catch(() => { process.exit(1); });
    });
  } else if (process.argv.includes('--standalone')) {
    const at = process.argv.indexOf('--data-dir');
    if (at < 0 || !process.argv[at + 1]) throw Error('explicit_data_directory_required');
    console.log(await start(resolve(process.argv[at + 1])));
  } else throw Error('explicit_splash_mode_required');
}
main().catch(() => { console.error('splash_start_failed'); process.exit(1); });
