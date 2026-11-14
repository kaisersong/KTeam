import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { Failure } from './errors.mjs';

export const emptyState = () => ({ spaces: {}, versions: {}, releases: {}, accounts: {}, holds: {}, operations: {} });

// Business transitions are pure and replayable. CAS conflict retries do not run IO.
export class StateStore {
  async change(transition) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const { revision, state } = await this.load();
      const result = transition(state);
      if (await this.compareAndSet(revision, state)) return result;
      await new Promise(resolve => setTimeout(resolve, Math.min(50, attempt * 3)));
    }
    throw new Failure('state_busy', 503);
  }
}

export class SQLiteState extends StateStore {
  constructor(file) {
    super(); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file); chmodSync(file, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO state VALUES(1,0,?)').run(JSON.stringify(emptyState()));
  }
  async load() {
    const row = this.db.prepare('SELECT revision,body FROM state WHERE id=1').get();
    return { revision: row.revision, state: JSON.parse(row.body) };
  }
  async compareAndSet(revision, state) {
    return this.db.prepare('UPDATE state SET revision=revision+1,body=? WHERE id=1 AND revision=?')
      .run(JSON.stringify(state), revision).changes === 1;
  }
  close() { this.db.close(); }
}

export class CloudBaseState extends StateStore {
  constructor({ baseURL, key, rpcName = 'cbspace_proto_state' }) {
    super(); this.baseURL = new URL(baseURL); this.key = key;
    if (this.baseURL.protocol !== 'https:' || !key || !/^[a-z_]+$/.test(rpcName)) throw new Failure('invalid_backend_configuration', 500);
    this.rpcName = rpcName;
  }
  async request(action, revision = 0, body = null) {
    try {
      const response = await fetch(new URL(`/v1/rdb/rest/rpc/${this.rpcName}`, this.baseURL), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_action: action, p_revision: revision, p_body: body }),
      });
      if (!response.ok) throw new Failure('backend_unavailable', 503);
      return await response.json();
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure('backend_unavailable', 503);
    }
  }
  async load() { return this.request('load'); }
  async compareAndSet(revision, state) { return (await this.request('cas', revision, state)).applied === true; }
  close() {}
}
