import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { taskkillPath } from '../src/runtime/platform-process.js';
import {
  HOST_STOP_LEADER_GONE, HOST_STOP_RESIDUAL, captureWindowsHostIdentity, filetimeTicks, parseVerifiedHostTree, residualAliveMembers, stopWindowsHostTree,
  type WindowsHostProcessLayer,
} from '../desktop/windows-host-shutdown.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const identity = { pid: 100, birth: '1000' };

function fakeLayer(platform: NodeJS.Platform, census: string, options: { birth?: string; linger?: boolean; lingerPids?: number[]; reuseAfterKill?: Record<number, string> } = {}) {
  const calls: Array<{ kind: 'exec' | 'spawn'; file: string; args: string[]; timeout?: number }> = [];
  const logs: Array<[string, string?, string?]> = [];
  let table = census;
  let now = 0;
  const env = { SystemRoot: 'C:\\Windows' };
  const execImpl = (file: string, args: string[], timeout?: number) => {
    calls.push({ kind: 'exec', file, args: [...args], timeout });
    if (options.birth !== undefined && String(args.at(-1) ?? '').includes('ProcessId =')) return options.birth;
    return table;
  };
  const spawnImpl = (file: string, args: string[], timeout?: number) => {
    calls.push({ kind: 'spawn', file, args: [...args], timeout });
    const lingerAll = options.linger === true;
    const linger = new Set(options.lingerPids ?? []);
    const killed = new Set<number>();
    for (let i = 0; i < args.length; i++) if (args[i] === '/PID') killed.add(Number(args[i + 1]));
    if (!lingerAll) {
      table = table.split(/\n/).filter(line => {
        const pid = Number(line.trim().split(/\s+/)[0]);
        return !killed.has(pid) || linger.has(pid);
      }).join('\n');
    }
    for (const pid of killed) {
      const replacement = options.reuseAfterKill?.[pid];
      if (replacement) {
        const lines = table.split(/\n/).filter(line => Number(line.trim().split(/\s+/)[0]) !== pid);
        lines.push(replacement);
        table = lines.filter(Boolean).join('\n');
      }
    }
    return { status: 0 as number | null };
  };
  const layer: WindowsHostProcessLayer = {
    platform,
    env,
    exec: (file, args) => execImpl(file, args),
    spawnSync: (file, args) => spawnImpl(file, args),
    execAsync: async (file, args, options) => execImpl(file, args, options.timeout),
    spawnAsync: async (file, args, options) => spawnImpl(file, args, options.timeout),
    now: () => now,
    wait: async (ms) => { now += ms; },
    log: (event, diagnostic, level) => { logs.push([event, diagnostic, level]); },
  };
  return { layer, calls, logs, env };
}

describe('windows host tree identity', () => {
  it('keeps descendants whose CreationDate is at or after the parent and the recorded root', () => {
    const listed = parseVerifiedHostTree('100 1 1000\n101 100 1001\n102 101 1002\n', identity);
    assert.deepEqual(listed.verified.map(m => m.pid), [100, 101, 102]);
    assert.equal(listed.skipped.length, 0);
    assert.ok((filetimeTicks('1001') ?? 0n) >= (filetimeTicks('1000') ?? 1n));
  });

  it('does not walk the tree when the recorded leader pid has been reused', () => {
    const mismatches: string[] = [];
    const listed = parseVerifiedHostTree('100 1 2000\n101 100 1100\n102 100 2001\n', identity, message => mismatches.push(message));
    assert.deepEqual(listed.verified, []);
    assert.deepEqual(listed.skipped, [{ pid: 100, reason: 'pid_reused' }]);
    assert.match(mismatches[0]!, /process 100 was started at 2000, not at the recorded 1000/);
  });

  it('does not walk the tree when the recorded host is dead and a reused pid parents an unrelated tree', () => {
    const mismatches: string[] = [];
    // 客服 repro: host 1234 born 100 is gone; 2000/2001 only share the old pid as ParentProcessId.
    const listed = parseVerifiedHostTree('2000 1234 300\n2001 2000 310\n', { pid: 1234, birth: '100' }, message => mismatches.push(message));
    assert.deepEqual(listed.verified, []);
    assert.deepEqual(listed.skipped, [{ pid: 1234, reason: 'leader_gone' }]);
    assert.match(mismatches[0]!, /process 1234 is no longer running at the recorded birth 100/);
  });

  it('does not select a child whose CreationDate is earlier than its parent or that has no birth', () => {
    const listed = parseVerifiedHostTree('100 1 1000\n101 100 900\n102 100 0\n103 100\n', identity);
    assert.deepEqual(listed.verified.map(m => m.pid), [100]);
    assert.deepEqual(listed.skipped.map(s => s.reason).sort(), ['birth_before_parent', 'birth_missing', 'birth_missing']);
  });

  it('residual poll matches snapshot members by pid and CreationDate and treats a reused pid as gone', () => {
    const snapshot = [{ pid: 100, birth: '1000' }, { pid: 101, birth: '1001' }];
    assert.deepEqual(residualAliveMembers(snapshot, '101 1 1001\n').map(m => m.pid), [101]);
    assert.deepEqual(residualAliveMembers(snapshot, '100 1 2000\n101 1 9000\n').map(m => m.pid), []);
  });
});

describe('stopWindowsHostTree', () => {
  it('is a no-op on macOS and does not spawn taskkill', async () => {
    const { layer, calls } = fakeLayer('darwin', '100 1 1000\n101 100 1001\n');
    const result = await stopWindowsHostTree(identity, layer);
    assert.deepEqual(result, { ok: true, killed: [], skipped: [] });
    assert.equal(calls.length, 0);
    assert.equal(captureWindowsHostIdentity(100, layer), undefined);
  });

  it('kills the live verified host first, then descendants, with taskkill /F /PID and never /T, within the overall deadline', async () => {
    const { layer, calls, env } = fakeLayer('win32', '100 1 1000\n101 100 1001\n102 101 1002\n');
    const events: string[] = [];
    const original = layer.spawnAsync!;
    layer.spawnAsync = async (file, args, options) => {
      events.push('kill');
      return original(file, args, options);
    };
    const result = await stopWindowsHostTree(identity, layer, { timeoutMs: 4000 });
    events.push('begin');
    assert.equal(result.ok, true);
    assert.deepEqual(result.killed, [100, 101, 102]);
    const kills = calls.filter(c => c.kind === 'spawn');
    assert.equal(kills.length, 3);
    for (const kill of kills) {
      assert.equal(kill.file, taskkillPath(env));
      assert.deepEqual(kill.args.slice(0, 2), ['/F', '/PID']);
      assert.equal(kill.args.includes('/T'), false);
      assert.ok((kill.timeout ?? 0) <= 4000);
      assert.ok((kill.timeout ?? 0) > 0);
    }
    assert.deepEqual(kills.map(k => k.args[2]), ['100', '101', '102']);
    assert.deepEqual(events, ['kill', 'kill', 'kill', 'begin']);
    for (const call of calls) assert.ok((call.timeout ?? 0) <= 4000);
  });

  it('kills nothing when the recorded host is dead and a reused pid parents an unrelated tree', async () => {
    const { layer, calls, logs } = fakeLayer('win32', '2000 1234 300\n2001 2000 310\n');
    const result = await stopWindowsHostTree({ pid: 1234, birth: '100' }, layer);
    assert.equal(result.ok, true);
    assert.deepEqual(result.killed, []);
    assert.equal(calls.filter(c => c.kind === 'spawn').length, 0);
    assert.equal(calls.some(c => c.args.includes('2000') || c.args.includes('2001') || c.args.includes('1234') && c.kind === 'spawn'), false);
    assert.ok(logs.some(entry => entry[0] === HOST_STOP_LEADER_GONE && entry[1]?.includes('no longer running at the recorded birth 100')));
  });

  it('kills nothing when the recorded host pid has been reused, including former orphans', async () => {
    const { layer, calls, logs } = fakeLayer('win32', '100 1 2000\n101 100 1100\n102 100 2001\n');
    const result = await stopWindowsHostTree(identity, layer);
    assert.equal(result.ok, true);
    assert.deepEqual(result.killed, []);
    assert.equal(calls.filter(c => c.kind === 'spawn').length, 0);
    assert.ok(logs.some(entry => entry[0] === HOST_STOP_LEADER_GONE && entry[1]?.includes('not at the recorded 1000')));
  });

  it('logs and returns ok:false when the verified tree is still running after the overall timeout', async () => {
    const { layer, logs, calls } = fakeLayer('win32', '100 1 1000\n', { linger: true });
    const result = await stopWindowsHostTree(identity, layer, { timeoutMs: 400 });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /host still running after 400ms: 100/);
    assert.ok(logs.some(entry => entry[0] === HOST_STOP_RESIDUAL && entry[1] === '100' && entry[2] === 'warn'));
    for (const call of calls) assert.ok((call.timeout ?? 0) <= 400);
  });

  it('returns ok:false and warns host-stop-residual when the host is gone but a descendant survives', async () => {
    const { layer, logs, calls } = fakeLayer('win32', '100 1 1000\n101 100 1001\n', { lingerPids: [101] });
    const result = await stopWindowsHostTree(identity, layer, { timeoutMs: 400 });
    assert.equal(result.ok, false);
    assert.deepEqual(result.killed, [100, 101]);
    assert.match(result.error ?? '', /host still running after 400ms: 101/);
    assert.ok(logs.some(entry => entry[0] === HOST_STOP_RESIDUAL && entry[1] === '101' && entry[2] === 'warn'));
    assert.equal(logs.some(entry => entry[0] === 'host-stop-failed'), false);
    for (const call of calls) assert.ok((call.timeout ?? 0) <= 400);
  });

  it('treats a snapshot pid reused with a different CreationDate as gone', async () => {
    const { layer, logs } = fakeLayer('win32', '100 1 1000\n101 100 1001\n', { reuseAfterKill: { 101: '101 1 9000' } });
    const result = await stopWindowsHostTree(identity, layer);
    assert.equal(result.ok, true);
    assert.deepEqual(result.killed, [100, 101]);
    assert.equal(logs.some(entry => entry[0] === HOST_STOP_RESIDUAL), false);
  });
});

describe('main.ts keeps the macOS quit and update path and only stops the host on win32', () => {
  it('leaves detached host spawn, menu update checks and the before-quit handoff line unchanged, and gates host-stop on win32', () => {
    const main = readFileSync(join(repoRoot, 'desktop', 'main.ts'), 'utf8');
    assert.match(main, /spawn\(process\.execPath,\[join\(resources\(\),'build','host\.cjs'\)\],\{detached:true,windowsHide:true,/);
    assert.match(main, /child\.unref\(\);/);
    assert.match(main, /if\(process\.platform==='win32'&&child\.pid\)windowsHost=captureWindowsHostIdentity\(child\.pid,windowsHostLayer\(\)\);/);
    assert.match(main, /if\(process\.platform==='win32'\)await stopWindowsHostIfNeeded\(\);const outcome=updaterHandoff\.begin\(\{requestSource:'user'\}\);logUpdater\('install-requested',outcome\.status\);/);
    assert.equal((main.match(/if\(process\.platform==='win32'\)await stopWindowsHostIfNeeded\(\);const outcome=updaterHandoff\.begin/g) ?? []).length, 2);
    assert.match(main, /if\(process\.platform==='win32'&&windowsHost&&!windowsHostQuitStarted\)/);
    assert.match(main, /if\(updaterHandoff\.commitHandoffOnBeforeQuit\(\)\.committed\)updater\.completeHandoff\(\);/);
    assert.match(main, /await updater\.checkForUpdates\(\{requestSource:'user'\}\);/);
    for (const pattern of [/stopWindowsHostIfNeeded\(/g, /captureWindowsHostIdentity\(/g, /stopWindowsHostTree\(/g]) {
      for (const site of main.matchAll(pattern)) {
        const around = main.slice(Math.max(0, site.index! - 220), site.index! + 80);
        assert.match(around, /win32/, `host-stop at ${site.index} is not win32-gated: ${around}`);
      }
    }
    assert.doesNotMatch(main, /\/T/);
  });
});
