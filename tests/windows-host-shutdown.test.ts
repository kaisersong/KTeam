import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { taskkillPath } from '../src/runtime/platform-process.js';
import {
  captureWindowsHostIdentity, filetimeTicks, parseVerifiedHostTree, stopWindowsHostTree,
  type WindowsHostProcessLayer,
} from '../desktop/windows-host-shutdown.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const identity = { pid: 100, birth: '1000' };

function fakeLayer(platform: NodeJS.Platform, census: string, options: { birth?: string; linger?: boolean } = {}) {
  const calls: Array<{ kind: 'exec' | 'spawn'; file: string; args: string[] }> = [];
  const logs: Array<[string, string?]> = [];
  let table = census;
  let now = 0;
  const env = { SystemRoot: 'C:\\Windows' };
  const layer: WindowsHostProcessLayer = {
    platform,
    env,
    exec: (file, args) => {
      calls.push({ kind: 'exec', file, args: [...args] });
      if (options.birth !== undefined && String(args.at(-1) ?? '').includes('ProcessId =')) return options.birth;
      return table;
    },
    spawnSync: (file, args) => {
      calls.push({ kind: 'spawn', file, args: [...args] });
      if (!options.linger) {
        const killed = new Set<number>();
        for (let i = 0; i < args.length; i++) if (args[i] === '/PID') killed.add(Number(args[i + 1]));
        table = table.split(/\n/).filter(line => !killed.has(Number(line.trim().split(/\s+/)[0]))).join('\n');
      }
      return { status: 0 };
    },
    now: () => now,
    wait: async (ms) => { now += ms; },
    log: (event, diagnostic) => { logs.push([event, diagnostic]); },
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

  it('does not select a reused leader pid or processes that belong to the stranger', () => {
    const mismatches: string[] = [];
    // 100 was reused at 2000; 101 is an orphan from our host (birth 1100); 102 was started by the stranger.
    const listed = parseVerifiedHostTree('100 1 2000\n101 100 1100\n102 100 2001\n', identity, message => mismatches.push(message));
    assert.deepEqual(listed.verified.map(m => m.pid), [101]);
    assert.deepEqual(listed.skipped.map(s => [s.pid, s.reason]), [
      [100, 'pid_reused'],
      [102, 'belongs_to_reused_pid'],
    ]);
    assert.match(mismatches[0]!, /process 100 was started at 2000, not at the recorded 1000/);
  });

  it('does not select a child whose CreationDate is earlier than its parent or that has no birth', () => {
    const listed = parseVerifiedHostTree('100 1 1000\n101 100 900\n102 100 0\n103 100\n', identity);
    assert.deepEqual(listed.verified.map(m => m.pid), [100]);
    assert.deepEqual(listed.skipped.map(s => s.reason).sort(), ['birth_before_parent', 'birth_missing', 'birth_missing']);
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

  it('stops the verified host tree on win32 with taskkill /F /PID per member and never /T', async () => {
    const { layer, calls, env } = fakeLayer('win32', '100 1 1000\n101 100 1001\n102 101 1002\n');
    const events: string[] = [];
    const originalSpawn = layer.spawnSync;
    layer.spawnSync = (file, args, options) => {
      events.push('kill');
      return originalSpawn(file, args, options);
    };
    const result = await stopWindowsHostTree(identity, layer);
    events.push('begin');
    assert.equal(result.ok, true);
    assert.deepEqual(result.killed, [101, 102, 100]);
    const kills = calls.filter(c => c.kind === 'spawn');
    assert.equal(kills.length, 3);
    for (const kill of kills) {
      assert.equal(kill.file, taskkillPath(env));
      assert.deepEqual(kill.args.slice(0, 2), ['/F', '/PID']);
      assert.equal(kill.args.includes('/T'), false);
    }
    assert.deepEqual(kills.map(k => k.args[2]), ['101', '102', '100']);
    assert.deepEqual(events, ['kill', 'kill', 'kill', 'begin']);
  });

  it('does not kill an unverified or reused pid, then still allows quitAndInstall to begin', async () => {
    const { layer, calls, logs } = fakeLayer('win32', '100 1 2000\n101 100 1100\n102 100 2001\n');
    const result = await stopWindowsHostTree(identity, layer);
    const begin: string[] = ['stopped'];
    begin.push('begin');
    assert.equal(result.ok, true);
    assert.deepEqual(result.killed, [101]);
    const kills = calls.filter(c => c.kind === 'spawn');
    assert.deepEqual(kills.map(k => k.args), [['/F', '/PID', '101']]);
    assert.equal(kills.some(k => k.args.includes('100') || k.args.includes('102') || k.args.includes('/T')), false);
    assert.ok(logs.some(entry => entry[0] === 'host-stop-mismatch' && entry[1]?.includes('not at the recorded 1000')));
    assert.deepEqual(begin, ['stopped', 'begin']);
  });

  it('logs and returns ok:false when the verified tree is still running after the timeout', async () => {
    const { layer, logs } = fakeLayer('win32', '100 1 1000\n', { linger: true });
    const result = await stopWindowsHostTree(identity, layer, { timeoutMs: 400 });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /host still running after 400ms: 100/);
    assert.ok(logs.some(entry => entry[0] === 'host-stop-failed'));
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
    // Every host-stop *call* is behind an explicit win32 gate (imports are excluded).
    for (const pattern of [/stopWindowsHostIfNeeded\(/g, /captureWindowsHostIdentity\(/g, /stopWindowsHostTree\(/g]) {
      for (const site of main.matchAll(pattern)) {
        const around = main.slice(Math.max(0, site.index! - 220), site.index! + 80);
        assert.match(around, /win32/, `host-stop at ${site.index} is not win32-gated: ${around}`);
      }
    }
    assert.doesNotMatch(main, /\/T/);
  });
});
