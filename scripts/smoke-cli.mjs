import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { hostRequest } from '../dist/src/service/client.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'kteam-cli-')));
const cli = join(project, 'dist/src/cli.js');
const env = { ...process.env, KTEAM_DATA_DIR: root, KTEAM_BROKER_URL: 'http://127.0.0.1:1', KTEAM_KSWARM_URL: 'http://127.0.0.1:1' };
delete env.KTEAM_BROKER_TOKEN_FILE; delete env.KTEAM_KSWARM_TOKEN_FILE;
const execute = promisify(execFile);
const children = [];
const report = { node: process.version, root, processes: [], assertions: [], remainingOwnProcesses: null };
function start() {
  const child = spawn(process.execPath, [cli, 'start'], { env, stdio: ['ignore','pipe','pipe'] });
  children.push(child); report.processes.push({ pid: child.pid });
  return child;
}
function exited(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => { child.once('exit', resolve); if (signal) child.kill(signal); });
}
async function ready(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI readiness timed out')), 5000);
    let output = '', errors = '';
    child.stderr.on('data', chunk => errors += chunk);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(output.trim())); } catch (error) { reject(error); } }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('CLI early exit:' + code + ':' + errors)); });
  });
}
try {
  await execute(process.execPath, [cli, 'init'], { env });
  const first = start(); const one = await ready(first);
  assert.equal((await hostRequest(root, 'kteam-companion', '/v1/handshake')).ownerEpoch, one.ownerEpoch);
  await assert.rejects(execute(process.execPath, [cli, 'start'], { env }), error => error.stderr.includes('host_already_running'));
  report.assertions.push('separate CLI processes cannot acquire a second writer');
  await exited(first, 'SIGKILL');
  const second = start(); const two = await ready(second);
  assert.ok(two.ownerEpoch > one.ownerEpoch);
  report.assertions.push('crash releases OS lock; new owner removes stale socket and advances epoch');
  const diagnosis = JSON.parse((await execute(process.execPath, [cli, 'doctor'], { env })).stdout);
  assert.equal(diagnosis.handshake.clientId, 'kteam-main');
  assert.equal(diagnosis.status.upstream.ready, false);
  assert.equal(diagnosis.handshake.aimp.executionEnabled, false);
  report.assertions.push('doctor returns explicit upstream absence and no execution admission');
  if (process.platform === 'win32') {
    // Windows has no POSIX SIGTERM delivery: child.kill('SIGTERM') is TerminateProcess, so the CLI's SIGTERM handler
    // cannot run. Check the forced stop instead: the process is gone and the next owner starts cleanly.
    await exited(second, 'SIGTERM');
    assert.ok(second.exitCode !== null || second.signalCode !== null);
    const third = start(); const three = await ready(third);
    assert.ok(three.ownerEpoch > two.ownerEpoch);
    await exited(third, 'SIGTERM');
    report.assertions.push('Windows: a terminated CLI owner releases the lock and the next owner advances epoch (graceful SIGTERM is POSIX-only)');
  } else {
    await exited(second, 'SIGTERM');
    assert.equal(second.exitCode, 0);
    report.assertions.push('graceful CLI shutdown exits successfully');
  }
} finally {
  for (const child of children) await exited(child, 'SIGKILL');
  report.remainingOwnProcesses = children.filter(child => child.exitCode === null && child.signalCode === null).length;
  mkdirSync(join(project, '.artifacts'), { recursive: true });
  writeFileSync(join(project, '.artifacts/cli-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  rmSync(root, { recursive: true, force: true });
}
assert.equal(report.remainingOwnProcesses, 0);
console.log(JSON.stringify(report, null, 2));
