import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { KTeamError } from '../errors.js';
import { ensurePrivateRoot } from './config.js';

/** SQLite's OS-backed transaction lock outlives windows and releases on a process crash.
 * A second host cannot unlink/rebind the socket while this owner holds the lock. */
export function acquireOwner(root: string) {
  ensurePrivateRoot(root);
  const lock = new DatabaseSync(join(root, 'owner-lock.sqlite'));
  lock.exec('PRAGMA busy_timeout=0');
  try { lock.exec('BEGIN IMMEDIATE'); }
  catch { lock.close(); throw new KTeamError('host_already_running', 409); }
  let state: DatabaseSync | undefined;
  try {
    state = new DatabaseSync(join(root, 'host-state.sqlite'));
    state.exec('CREATE TABLE IF NOT EXISTS host_meta (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, epoch INTEGER NOT NULL)');
    state.exec('INSERT OR IGNORE INTO host_meta VALUES (1, 1, 0)');
    const metadata = state.prepare('SELECT * FROM host_meta WHERE id=1').get();
    if (metadata?.schema_version !== 1) throw new KTeamError('host_schema_unsupported');
    state.exec('UPDATE host_meta SET epoch=epoch+1 WHERE id=1');
    const epoch = Number(state.prepare('SELECT epoch FROM host_meta WHERE id=1').get()!.epoch);
    let released = false;
    return { epoch, release() { if (!released) { released = true; lock.exec('ROLLBACK'); lock.close(); } } };
  } catch (error) { lock.close(); throw error; }
  finally { state?.close(); }
}
