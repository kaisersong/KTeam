import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { WINDOWS_QUIT_FORCE_EXIT, WINDOWS_QUIT_FORCE_EXIT_MS, quitWindowsDesktop } from '../desktop/windows-desktop-quit.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function hooks() {
  const events: string[] = [];
  const logs: Array<[string, string?, string?]> = [];
  let scheduled: { callback: () => void; delayMs: number } | undefined;
  return {
    events,
    logs,
    scheduled: () => scheduled,
    hooks: {
      stopPolling: () => { events.push('stopPolling'); },
      stopHostTree: async () => { events.push('stopHostTree'); },
      quit: () => { events.push('quit'); },
      exit: (code: number) => { events.push(`exit:${code}`); },
      log: (event: string, diagnostic?: string, level?: 'warn' | 'error') => { logs.push([event, diagnostic, level]); },
      schedule: (callback: () => void, delayMs: number) => { scheduled = { callback, delayMs }; },
    },
  };
}

describe('quitWindowsDesktop', () => {
  it('stops updater polling, then the host tree, then app.quit', async () => {
    const { events, hooks: input, scheduled } = hooks();
    await quitWindowsDesktop(input);
    assert.deepEqual(events, ['stopPolling', 'stopHostTree', 'quit']);
    assert.equal(scheduled()?.delayMs, WINDOWS_QUIT_FORCE_EXIT_MS);
    assert.equal(events.includes('exit:0'), false);
  });

  it('force-exits with a warn if the process is still alive after the budget', async () => {
    const { events, hooks: input, logs, scheduled } = hooks();
    await quitWindowsDesktop(input);
    assert.deepEqual(events, ['stopPolling', 'stopHostTree', 'quit']);
    scheduled()!.callback();
    assert.deepEqual(events, ['stopPolling', 'stopHostTree', 'quit', 'exit:0']);
    assert.ok(logs.some(entry => entry[0] === WINDOWS_QUIT_FORCE_EXIT && entry[2] === 'warn'));
  });

  it('still quits and schedules the forced exit if stopping the host tree fails', async () => {
    const { events, hooks: input, scheduled } = hooks();
    input.stopHostTree = async () => { events.push('stopHostTree'); throw new Error('host-stop-timeout'); };
    await assert.rejects(() => quitWindowsDesktop(input), /host-stop-timeout/);
    assert.deepEqual(events, ['stopPolling', 'stopHostTree', 'quit']);
    assert.equal(scheduled()?.delayMs, WINDOWS_QUIT_FORCE_EXIT_MS);
  });
});

describe('main.ts gates the last-window forced quit on win32 and leaves the macOS path unchanged', () => {
  it('stops polling and the host tree on Windows window-all-closed, and keeps the darwin no-op and before-quit handoff line', () => {
    const main = readFileSync(join(repoRoot, 'desktop', 'main.ts'), 'utf8');
    assert.match(main, /app\.on\('window-all-closed',\(\)=>\{if\(process\.platform==='win32'\)\{void quitWindowsOnLastWindow\(\);return;\}if\(process\.platform!=='darwin'\)app\.quit\(\);\}\);/);
    assert.match(main, /if\(process\.platform!=='win32'\)return;\n if\(windowsDesktopQuitStarted\)return;/);
    assert.match(main, /stopPolling:\(\)=>updater\.stopPolling\(\),stopHostTree:stopWindowsHostIfNeeded,quit:\(\)=>app\.quit\(\),exit:code=>app\.exit\(code\),log:logUpdater/);
    assert.match(main, /if\(updaterHandoff\.commitHandoffOnBeforeQuit\(\)\.committed\)updater\.completeHandoff\(\);/);
    assert.match(main, /if\(updaterHandoff\.commitHandoffOnBeforeQuit\(\)\.committed\)updater\.completeHandoff\(\);app\.quit\(\);/);
    assert.doesNotMatch(main, /Tray/);
  });
});
