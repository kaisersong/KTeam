// KTeam desktop auto-update. Unit tests ported from the original desktop updater
// tests, plus KTeam-only checks: the feed points only at kaisersong/KTeam, the
// env kill switch, dev-build skip, prerelease policy and the startup delay.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  KTEAM_UPDATE_FEED, PERIODIC_UPDATE_INTERVAL_MS, STARTUP_UPDATE_DELAY_MS, DEV_MODE_MESSAGE, DISABLED_MESSAGE,
  callAutoUpdaterQuitAndInstall, configureAutoUpdater, createKTeamUpdater, isDevelopmentMode, autoUpdateDisabledByEnv,
  resolveAutoUpdaterExport, runStartupUpdateCheck, type UpdaterEnvironment, type KTeamUpdater,
} from '../desktop/updater.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

type Mock = ((...args: any[]) => any) & { calls: any[][]; impl?: (...args: any[]) => any; queue: Array<() => any> };
function fn(impl?: (...args: any[]) => any): Mock {
  const mock = ((...args: any[]) => { mock.calls.push(args); const next = mock.queue.shift(); if (next) return next(); return mock.impl?.(...args); }) as Mock;
  mock.calls = []; mock.queue = []; if (impl) mock.impl = impl;
  return mock;
}

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; callback: () => void; every?: number }>();
  return {
    setTimer: (callback: () => void, delayMs: number) => { const id = ++seq; timers.set(id, { at: now + delayMs, callback }); return id; },
    setRepeating: (callback: () => void, delayMs: number) => { const id = ++seq; timers.set(id, { at: now + delayMs, callback, every: delayMs }); return id; },
    clearTimer: (handle: unknown) => { timers.delete(handle as number); },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.every) timer.at += timer.every; else timers.delete(id);
        timer.callback();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      now = target;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

function fakeEnvironment(overrides: Partial<UpdaterEnvironment> = {}, updater?: unknown) {
  const clock = fakeClock();
  const environment: UpdaterEnvironment = {
    env: { NODE_ENV: 'production' },
    isPackaged: true,
    resourcesPath: '/fixture/resources',
    fileExists: path => path === join('/fixture/resources', 'app-update.yml'),
    loadModule: async () => ({ autoUpdater: updater }),
    platform: 'darwin',
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    setRepeating: clock.setRepeating,
    ...overrides,
  };
  return { environment, clock };
}

function fakeAutoUpdater() {
  return Object.assign(new EventEmitter(), {
    checkForUpdates: fn(async () => ({})),
    checkForUpdatesAndNotify: fn(async () => ({})),
    quitAndInstall: fn(),
    setFeedURL: fn(),
  }) as EventEmitter & Record<string, any>;
}

describe('desktop updater', () => {
  it('loads autoUpdater from CommonJS default exports', () => {
    const updater = { checkForUpdates: fn() };
    assert.equal(resolveAutoUpdaterExport({ default: { autoUpdater: updater } }), updater);
  });

  it('prefers named autoUpdater exports when available', () => {
    const namedUpdater = { checkForUpdates: fn() };
    const defaultUpdater = { checkForUpdates: fn() };
    assert.equal(resolveAutoUpdaterExport({ autoUpdater: namedUpdater, default: { autoUpdater: defaultUpdater } }), namedUpdater);
  });

  it('returns null when the module does not expose autoUpdater', () => {
    assert.equal(resolveAutoUpdaterExport({ default: {} }), null);
  });

  it('installs downloaded updates by allowing app quit and relaunch', () => {
    const updater = { autoInstallOnAppQuit: false, quitAndInstall: fn() };
    assert.equal(callAutoUpdaterQuitAndInstall(updater), true);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.deepEqual(updater.quitAndInstall.calls, [[false, true]]);
  });

  it('reports install failure when updater is unavailable', () => {
    assert.equal(callAutoUpdaterQuitAndInstall(null), false);
    assert.equal(callAutoUpdaterQuitAndInstall({}), false);
  });

  it('retries a failed startup update check once after a short delay', async () => {
    const retryCallbacks: Array<() => void | Promise<void>> = [];
    const retryDelays: number[] = [];
    const errors: string[] = [];
    const updater = { checkForUpdatesAndNotify: fn() };
    updater.checkForUpdatesAndNotify.queue.push(() => Promise.reject(new Error('Cannot find latest-mac.yml')), () => Promise.resolve(undefined));
    await runStartupUpdateCheck(updater, {
      retryDelayMs: 25,
      onError: error => errors.push(error.message),
      setTimer: (callback, delayMs) => { retryCallbacks.push(callback); retryDelays.push(delayMs); },
    });
    assert.equal(updater.checkForUpdatesAndNotify.calls.length, 1);
    assert.deepEqual(errors, ['Cannot find latest-mac.yml']);
    assert.deepEqual(retryDelays, [25]);
    assert.equal(retryCallbacks.length, 1);
    await retryCallbacks[0]!();
    assert.equal(updater.checkForUpdatesAndNotify.calls.length, 2);
    assert.equal(retryCallbacks.length, 1);
  });
});

describe('KTeam update feed', () => {
  it('points only at kaisersong/KTeam GitHub Releases, in code, electron-builder.yml and app-update.yml', () => {
    assert.deepEqual({ ...KTEAM_UPDATE_FEED }, { provider: 'github', owner: 'kaisersong', repo: 'KTeam' });
    assert.ok(Object.isFrozen(KTEAM_UPDATE_FEED));
    const appUpdate = readFileSync(join(repoRoot, 'desktop', 'app-update.yml'), 'utf8');
    const fields = Object.fromEntries(appUpdate.split('\n').filter(Boolean).map(line => line.split(':').map(part => part.trim()) as [string, string]));
    assert.deepEqual(fields, { provider: 'github', owner: 'kaisersong', repo: 'KTeam', releaseType: 'release', updaterCacheDirName: 'kteam-updater' });
    const builder = readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8');
    const publish = /^publish:\n((?: {2}.+\n)+)/m.exec(builder);
    assert.ok(publish, 'electron-builder.yml must have a publish block');
    assert.match(publish[1]!, /^ {2}provider: github$/m);
    assert.match(publish[1]!, /^ {2}owner: kaisersong$/m);
    assert.match(publish[1]!, /^ {2}repo: KTeam$/m);
    assert.match(builder, /- from: desktop\/app-update\.yml\n\s+to: app-update\.yml/);
    // No other feed host, owner, repo or generic URL anywhere in the updater sources.
    for (const file of ['desktop/updater.ts', 'desktop/updater-handoff.ts', 'desktop/app-update.yml']) {
      const text = readFileSync(join(repoRoot, file), 'utf8');
      assert.doesNotMatch(text, /xiaok/i, file);
      assert.doesNotMatch(text, /https?:\/\//, file);
      for (const owner of text.matchAll(/owner:\s*'?([\w-]+)/g)) assert.equal(owner[1], 'kaisersong', file);
      for (const repo of text.matchAll(/repo:\s*'?([\w-]+)/g)) assert.equal(repo[1], 'KTeam', file);
    }
  });

  it('overrides any on-disk feed with kaisersong/KTeam and never allows prereleases or downgrades', () => {
    const updater = { setFeedURL: fn(), allowPrerelease: true, allowDowngrade: true, autoDownload: false, autoInstallOnAppQuit: false, channel: 'beta' };
    configureAutoUpdater(updater);
    assert.deepEqual(updater.setFeedURL.calls, [[{ provider: 'github', owner: 'kaisersong', repo: 'KTeam' }]]);
    assert.equal(updater.allowPrerelease, false);
    assert.equal(updater.allowDowngrade, false);
    assert.equal(updater.autoDownload, true);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.equal(updater.channel, 'latest');
  });

  it('pins electron-updater to an exact version as a runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    assert.match(pkg.dependencies['electron-updater'], /^\d+\.\d+\.\d+$/);
  });
});

describe('KTeam updater gating', () => {
  it('treats unpackaged, dev-url and missing app-update.yml builds as development', () => {
    const base = { env: {}, isPackaged: true, resourcesPath: '/r', fileExists: () => true };
    assert.equal(isDevelopmentMode(base), false);
    assert.equal(isDevelopmentMode({ ...base, isPackaged: false }), true);
    assert.equal(isDevelopmentMode({ ...base, env: { KTEAM_DEV_URL: 'http://127.0.0.1:5173' } }), true);
    assert.equal(isDevelopmentMode({ ...base, env: { NODE_ENV: 'development' } }), true);
    assert.equal(isDevelopmentMode({ ...base, resourcesPath: undefined }), true);
    assert.equal(isDevelopmentMode({ ...base, fileExists: () => false }), true);
  });

  it('honours KTEAM_DISABLE_AUTO_UPDATE', () => {
    assert.equal(autoUpdateDisabledByEnv({}), false);
    assert.equal(autoUpdateDisabledByEnv({ KTEAM_DISABLE_AUTO_UPDATE: '' }), false);
    assert.equal(autoUpdateDisabledByEnv({ KTEAM_DISABLE_AUTO_UPDATE: '0' }), false);
    assert.equal(autoUpdateDisabledByEnv({ KTEAM_DISABLE_AUTO_UPDATE: 'false' }), false);
    assert.equal(autoUpdateDisabledByEnv({ KTEAM_DISABLE_AUTO_UPDATE: '1' }), true);
    assert.equal(autoUpdateDisabledByEnv({ KTEAM_DISABLE_AUTO_UPDATE: 'true' }), true);
  });

  it('never loads electron-updater when disabled by env', async () => {
    const loadModule = fn(async () => ({ autoUpdater: fakeAutoUpdater() }));
    const { environment, clock } = fakeEnvironment({ env: { KTEAM_DISABLE_AUTO_UPDATE: '1' }, loadModule });
    const subject = createKTeamUpdater(environment);
    await subject.setup(undefined, { requestSource: 'scheduler' });
    await subject.checkForUpdates({ requestSource: 'user' });
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS * 2);
    assert.equal(loadModule.calls.length, 0);
    assert.equal(subject.getStatus().error, DISABLED_MESSAGE);
  });

  it('never loads electron-updater in unpackaged builds', async () => {
    const loadModule = fn(async () => ({ autoUpdater: fakeAutoUpdater() }));
    const { environment, clock } = fakeEnvironment({ isPackaged: false, loadModule });
    const subject = createKTeamUpdater(environment);
    await subject.setup(undefined, { requestSource: 'scheduler' });
    await subject.checkForUpdates({ requestSource: 'user' });
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS * 2);
    assert.equal(loadModule.calls.length, 0);
    assert.equal(subject.getStatus().error, DEV_MODE_MESSAGE);
  });

  it('checks after the startup delay, then every 4 hours', async () => {
    const updater = fakeAutoUpdater();
    const { environment, clock } = fakeEnvironment({}, updater);
    const subject = createKTeamUpdater(environment);
    await subject.setup(undefined, { requestSource: 'scheduler' });
    assert.equal(updater.checkForUpdatesAndNotify.calls.length, 0);
    assert.deepEqual(updater.setFeedURL.calls, [[{ provider: 'github', owner: 'kaisersong', repo: 'KTeam' }]]);
    assert.equal(updater.allowPrerelease, false);
    await clock.advance(STARTUP_UPDATE_DELAY_MS);
    assert.equal(updater.checkForUpdatesAndNotify.calls.length, 1);
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS);
    assert.equal(updater.checkForUpdates.calls.length, 1);
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS);
    assert.equal(updater.checkForUpdates.calls.length, 2);
  });

  it('requires scheduler context for setup and user context for manual checks and installs', async () => {
    const { environment } = fakeEnvironment({}, fakeAutoUpdater());
    const subject = createKTeamUpdater(environment);
    await assert.rejects(subject.setup(undefined, { requestSource: 'user' }), /updater_request_source_forbidden/);
    await assert.rejects(subject.checkForUpdates({ requestSource: 'agent' }), /updater_request_source_forbidden/);
    assert.throws(() => subject.quitAndInstall({ requestSource: 'agent' }), /updater_request_source_forbidden/);
    assert.throws(() => subject.quitAndInstall({} as any), /updater_request_source_required/);
  });

  it('asks the user to restart once per downloaded version', async () => {
    const updater = fakeAutoUpdater();
    const prompts: string[] = [];
    const { environment } = fakeEnvironment({}, updater);
    const subject = createKTeamUpdater(environment, { onDownloaded: version => prompts.push(version) });
    await subject.setup(undefined, { requestSource: 'scheduler' });
    updater.emit('update-available', { version: '0.4.0' });
    updater.emit('download-progress', { percent: 42.4 });
    assert.deepEqual({ ...subject.getStatus() }, { checking: false, available: true, downloading: true, downloaded: false, installing: false, progress: 42, version: '0.4.0' });
    updater.emit('update-downloaded', { version: '0.4.0' });
    updater.emit('update-downloaded', { version: '0.4.0' });
    assert.deepEqual(prompts, ['0.4.0']);
    assert.equal(subject.getStatus().downloaded, true);
    assert.equal(subject.quitAndInstall({ requestSource: 'user' }).status, 'pending');
    assert.deepEqual(updater.quitAndInstall.calls, [[false, true]]);
  });
});

// Ported from the original "real updater handoff wiring" integration tests.
describe('real updater handoff wiring', () => {
  let subject: KTeamUpdater;
  let updater: EventEmitter & Record<string, any>;
  let clock: ReturnType<typeof fakeClock>;
  let platform: NodeJS.Platform;
  let logger: Mock;
  beforeEach(async () => {
    updater = fakeAutoUpdater();
    platform = 'darwin';
    logger = fn();
    const fixture = fakeEnvironment({}, updater);
    clock = fixture.clock;
    subject = createKTeamUpdater({ ...fixture.environment, get platform() { return platform; } });
    await subject.setup(logger, { requestSource: 'scheduler' });
  });

  it('rejects absent download before entering mac wrapper', () => {
    const handoff = subject.createHandoff('darwin');
    assert.equal(handoff.begin({ requestSource: 'user' }).status, 'rejected_sync');
    assert.equal(updater.quitAndInstall.calls.length, 0);
  });

  it('preserves a prior native failure and rejects before wrapper', () => {
    updater.emit('update-downloaded', { version: '0.4.0' });
    updater.emit('error', new Error('signature rejected'));
    assert.equal(subject.createHandoff('darwin').begin({ requestSource: 'user' }).status, 'rejected_sync');
    assert.equal(subject.getStatus().error, 'signature rejected');
    assert.equal(updater.quitAndInstall.calls.length, 0);
  });

  it('stops spinning without retry or shutdown after observation expires; late quit is allowed', async () => {
    updater.emit('update-downloaded', { version: '0.4.0' });
    const handoff = subject.createHandoff('darwin');
    handoff.begin({ requestSource: 'user' });
    await clock.advance(30_001);
    assert.equal(subject.getStatus().downloaded, true);
    assert.equal(subject.getStatus().installing, false);
    assert.equal(subject.getStatus().error, 'update_install_handoff_unconfirmed');
    assert.equal(handoff.hasPendingIntent, true);
    const before = updater.checkForUpdates.calls.length;
    for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded']) {
      updater.emit(event, { version: '0.4.1', percent: 12 });
    }
    await subject.checkForUpdates({ requestSource: 'user' });
    assert.equal(subject.getStatus().error, 'update_install_handoff_unconfirmed');
    handoff.begin({ requestSource: 'user' });
    assert.equal(updater.quitAndInstall.calls.length, 1);
    assert.equal(updater.checkForUpdates.calls.length, before);
    handoff.commitHandoffOnBeforeQuit();
    subject.completeHandoff();
    updater.emit('error', new Error('late unrelated error'));
    assert.equal(handoff.snapshot().kind, 'handed_off');
  });

  for (const target of ['darwin', 'win32'] as const) {
    it(`keeps asynchronous errors sticky on ${target}`, () => {
      updater.emit('update-downloaded', { version: '0.4.0' });
      const handoff = subject.createHandoff(target);
      handoff.begin({ requestSource: 'user' });
      updater.emit('error', new Error('native delayed failure'));
      assert.equal(handoff.snapshot().kind, 'pending_error_sticky');
      assert.equal(subject.getStatus().installing, false);
      assert.equal(subject.getStatus().error, 'native delayed failure');
      handoff.begin({ requestSource: 'user' });
      assert.equal(updater.quitAndInstall.calls.length, 1);
    });
  }

  it('attributes Windows synchronous emitted errors without treating delayed errors as retryable', () => {
    updater.emit('update-downloaded', { version: '0.4.0' });
    updater.quitAndInstall.impl = () => updater.emit('error', new Error('install refused'));
    const handoff = subject.createHandoff('win32');
    assert.equal(handoff.begin({ requestSource: 'user' }).status, 'rejected_sync');
    assert.equal(handoff.snapshot().kind, 'error');
  });

  for (const target of ['darwin', 'win32'] as const) {
    it(`classifies synchronous wrapper throws on ${target}`, () => {
      updater.emit('update-downloaded', { version: '0.4.0' });
      updater.quitAndInstall.impl = () => { throw new Error('wrapper failed'); };
      const handoff = subject.createHandoff(target);
      assert.equal(handoff.begin({ requestSource: 'user' }).status, target === 'darwin' ? 'pending_error_sticky' : 'rejected_sync');
      assert.equal(subject.getStatus().installing, false);
      assert.equal(subject.getStatus().error, 'wrapper failed');
    });
  }

  it('suppresses the scheduled startup retry and periodic check once an install is pending', async () => {
    updater.checkForUpdatesAndNotify.queue.push(() => Promise.reject(new Error('startup check failed')));
    await clock.advance(STARTUP_UPDATE_DELAY_MS);
    await subject.checkForUpdates({ requestSource: 'user' });
    updater.emit('update-downloaded', { version: '0.4.0' });
    const startupCalls = updater.checkForUpdatesAndNotify.calls.length;
    const checkCalls = updater.checkForUpdates.calls.length;
    subject.createHandoff('darwin').begin({ requestSource: 'user' });
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS);
    assert.equal(updater.checkForUpdatesAndNotify.calls.length, startupCalls);
    assert.equal(updater.checkForUpdates.calls.length, checkCalls);
    assert.equal(subject.getStatus().error, 'update_install_handoff_unconfirmed');
  });

  it('logs useful updater diagnostics without credentials embedded in download URLs', () => {
    updater.emit('error', new Error('native rejected https://user:secret@download.example/package.zip?token=private'));
    assert.deepEqual(logger.calls.at(-1), ['error', 'native rejected [URL omitted]']);
    assert.doesNotMatch(JSON.stringify(logger.calls), /secret|private|download\.example/);
  });

  it('does not rearm observation after synchronous before-quit', async () => {
    updater.emit('update-downloaded', { version: '0.4.0' });
    const handoff = subject.createHandoff('darwin');
    updater.quitAndInstall.impl = () => { handoff.commitHandoffOnBeforeQuit(); subject.completeHandoff(); };
    handoff.begin({ requestSource: 'user' });
    await clock.advance(30_001);
    assert.equal(handoff.snapshot().kind, 'handed_off');
    assert.equal(subject.getStatus().error, undefined);
  });

  it('does not roll back a synchronous committed handoff if the wrapper then throws', () => {
    updater.emit('update-downloaded', { version: '0.4.0' });
    const handoff = subject.createHandoff('darwin');
    updater.quitAndInstall.impl = () => { handoff.commitHandoffOnBeforeQuit(); subject.completeHandoff(); throw new Error('after quit'); };
    handoff.begin({ requestSource: 'user' });
    assert.equal(handoff.snapshot().kind, 'handed_off');
    handoff.begin({ requestSource: 'user' });
    assert.equal(updater.quitAndInstall.calls.length, 1);
  });
});
