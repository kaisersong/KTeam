import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  KTEAM_UPDATE_FEED, PORTABLE_UPDATE_MESSAGE, UNSUPPORTED_UPDATE_MESSAGE, DEV_MODE_MESSAGE, DISABLED_MESSAGE,
  PERIODIC_UPDATE_INTERVAL_MS, STARTUP_UPDATE_DELAY_MS, skipUpdateCodeSignature,
  autoUpdateDisabledByEnv, autoUpdateEnabledForChannel, configureAutoUpdater, createKTeamUpdater,
  isPortableBuild, resolveAutoUpdateChannel, type UpdaterEnvironment,
} from '../desktop/updater.js';
import { KTEAM_RELEASES_URL, presentUpdateCheck } from '../desktop/update-ui.js';

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
  return {
    checkForUpdates: fn(async () => ({})),
    checkForUpdatesAndNotify: fn(async () => ({})),
    quitAndInstall: fn(),
    setFeedURL: fn(),
    on: fn(),
  };
}

const idleStatus = { checking: false, available: false, downloading: false, downloaded: false, progress: 0 };

describe('auto-update channel gating', () => {
  it('enables macOS and Windows NSIS, and treats portable / Linux as inactive', () => {
    assert.equal(resolveAutoUpdateChannel('darwin', {}), 'mac');
    assert.equal(resolveAutoUpdateChannel('darwin', { PORTABLE_EXECUTABLE_DIR: 'C:\\KTeam' }), 'mac');
    assert.equal(resolveAutoUpdateChannel('win32', {}), 'nsis');
    assert.equal(resolveAutoUpdateChannel('win32', { PORTABLE_EXECUTABLE_DIR: 'C:\\KTeamPortable' }), 'portable');
    assert.equal(resolveAutoUpdateChannel('win32', { PORTABLE_EXECUTABLE_DIR: '' }), 'nsis');
    assert.equal(resolveAutoUpdateChannel('linux', {}), 'unsupported');
    assert.equal(resolveAutoUpdateChannel('linux', { PORTABLE_EXECUTABLE_DIR: '/tmp' }), 'unsupported');
    assert.equal(autoUpdateEnabledForChannel('mac'), true);
    assert.equal(autoUpdateEnabledForChannel('nsis'), true);
    assert.equal(autoUpdateEnabledForChannel('portable'), false);
    assert.equal(autoUpdateEnabledForChannel('unsupported'), false);
    assert.equal(isPortableBuild({}), false);
    assert.equal(isPortableBuild({ PORTABLE_EXECUTABLE_DIR: '' }), false);
    assert.equal(isPortableBuild({ PORTABLE_EXECUTABLE_DIR: 'D:\\KTeam' }), true);
    assert.equal(autoUpdateDisabledByEnv({ PORTABLE_EXECUTABLE_DIR: 'D:\\KTeam' }), false);
  });
});

describe('Windows NSIS updater path', () => {
  it('starts the updater, pins the KTeam feed, and skips code-signature verification', async () => {
    const updater = Object.assign(fakeAutoUpdater(), { verifyUpdateCodeSignature: fn(async () => 'would-reject-unsigned') }) as ReturnType<typeof fakeAutoUpdater> & { verifyUpdateCodeSignature: Mock; allowPrerelease?: boolean };
    const loadModule = fn(async () => ({ autoUpdater: updater }));
    const { environment, clock } = fakeEnvironment({ platform: 'win32', loadModule }, updater);
    const subject = createKTeamUpdater(environment);
    assert.equal(subject.getChannel(), 'nsis');
    await subject.setup(undefined, { requestSource: 'scheduler' });
    assert.equal(loadModule.calls.length, 1);
    assert.deepEqual(updater.setFeedURL.calls, [[{ provider: 'github', owner: 'kaisersong', repo: 'KTeam' }]]);
    assert.equal(updater.verifyUpdateCodeSignature, skipUpdateCodeSignature);
    assert.equal(await skipUpdateCodeSignature(['CN=Anyone'], 'KTeam-setup-0.4.0.exe'), null);
    assert.equal(updater.allowPrerelease, false);
    await clock.advance(STARTUP_UPDATE_DELAY_MS);
    assert.equal(updater.checkForUpdatesAndNotify.calls.length, 1);
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS);
    assert.equal(updater.checkForUpdates.calls.length, 1);
  });

  it('does not install a signature hook on the macOS updater', () => {
    const updater: Record<string, unknown> = { setFeedURL: fn(), allowPrerelease: true, allowDowngrade: true, autoDownload: false, autoInstallOnAppQuit: false, channel: 'beta' };
    configureAutoUpdater(updater);
    assert.equal('verifyUpdateCodeSignature' in updater, false);
    assert.deepEqual((updater.setFeedURL as Mock).calls, [[{ ...KTEAM_UPDATE_FEED }]]);
  });

  it('keeps app-update.yml unsigned (no publisherName) so NsisUpdater will not verify a signature', () => {
    const appUpdate = readFileSync(join(repoRoot, 'desktop', 'app-update.yml'), 'utf8');
    assert.doesNotMatch(appUpdate, /publisherName/);
    assert.match(appUpdate, /^owner: kaisersong$/m);
    assert.match(appUpdate, /^repo: KTeam$/m);
  });
});

describe('portable and unsupported builds never start the updater', () => {
  it('does not load electron-updater on a Windows portable build, including a manual check', async () => {
    const loadModule = fn(async () => ({ autoUpdater: fakeAutoUpdater() }));
    const { environment, clock } = fakeEnvironment({
      platform: 'win32',
      env: { NODE_ENV: 'production', PORTABLE_EXECUTABLE_DIR: 'C:\\KTeamPortable' },
      loadModule,
    });
    const subject = createKTeamUpdater(environment);
    assert.equal(subject.getChannel(), 'portable');
    await subject.setup(undefined, { requestSource: 'scheduler' });
    await subject.checkForUpdates({ requestSource: 'user' });
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS * 2);
    assert.equal(loadModule.calls.length, 0);
    assert.equal(subject.hasCompletedCheck(), false);
    assert.equal(subject.getStatus().error, PORTABLE_UPDATE_MESSAGE);
  });

  it('does not load electron-updater on Linux', async () => {
    const loadModule = fn(async () => ({ autoUpdater: fakeAutoUpdater() }));
    const { environment, clock } = fakeEnvironment({ platform: 'linux', loadModule });
    const subject = createKTeamUpdater(environment);
    assert.equal(subject.getChannel(), 'unsupported');
    await subject.setup(undefined, { requestSource: 'scheduler' });
    await subject.checkForUpdates({ requestSource: 'user' });
    await clock.advance(PERIODIC_UPDATE_INTERVAL_MS * 2);
    assert.equal(loadModule.calls.length, 0);
    assert.equal(subject.getStatus().error, UNSUPPORTED_UPDATE_MESSAGE);
  });
});

describe('settings 检查更新 presentation', () => {
  it('keeps the button clickable on portable and shows the Releases message plus link', () => {
    const view = presentUpdateCheck({
      channel: 'portable',
      status: { ...idleStatus, error: PORTABLE_UPDATE_MESSAGE },
      currentVersion: '0.4.0',
    });
    assert.equal(view.buttonLabel, '检查更新');
    assert.equal(view.buttonDisabled, false);
    assert.equal(view.statusText, PORTABLE_UPDATE_MESSAGE);
    assert.equal(view.tone, 'portable');
    assert.equal(view.showReleasesLink, true);
    assert.equal(view.releasesUrl, KTEAM_RELEASES_URL);
    assert.equal(KTEAM_RELEASES_URL, 'https://github.com/kaisersong/KTeam/releases');
    assert.equal(view.showInstallButton, false);
    // A click is a checkForUpdates that stays on the same projection — still not greyed.
    const afterClick = presentUpdateCheck({
      channel: 'portable',
      status: { ...idleStatus, error: PORTABLE_UPDATE_MESSAGE },
      currentVersion: '0.4.0',
      checked: false,
    });
    assert.equal(afterClick.buttonDisabled, false);
    assert.equal(afterClick.statusText, '便携版不会自动更新，请到 Releases 下载新版本');
    assert.equal(afterClick.releasesUrl, 'https://github.com/kaisersong/KTeam/releases');
  });

  it('projects checking, up to date, downloading, ready to restart and error states', () => {
    assert.deepEqual(presentUpdateCheck({ channel: 'nsis', status: { ...idleStatus, checking: true }, currentVersion: '0.4.0' }).tone, 'checking');
    assert.equal(presentUpdateCheck({ channel: 'nsis', status: { ...idleStatus, checking: true } }).buttonDisabled, true);
    assert.equal(presentUpdateCheck({ channel: 'nsis', status: { ...idleStatus, checking: true } }).statusText, '正在检查更新…');

    const current = presentUpdateCheck({ channel: 'mac', status: idleStatus, currentVersion: '0.4.0', checked: true });
    assert.equal(current.tone, 'current');
    assert.equal(current.statusText, 'KTeam 0.4.0 已是最新版本。');
    assert.equal(current.buttonDisabled, false);
    assert.equal(presentUpdateCheck({ channel: 'mac', status: idleStatus, currentVersion: '0.4.0', checked: false }).tone, 'idle');

    const downloading = presentUpdateCheck({ channel: 'nsis', status: { checking: false, available: true, downloading: true, downloaded: false, progress: 42, version: '0.4.1' } });
    assert.equal(downloading.tone, 'downloading');
    assert.equal(downloading.buttonDisabled, true);
    assert.match(downloading.statusText, /正在后台下载 KTeam 0\.4\.1（42%）/);

    const ready = presentUpdateCheck({ channel: 'mac', status: { checking: false, available: true, downloading: false, downloaded: true, progress: 100, version: '0.4.1' } });
    assert.equal(ready.tone, 'ready');
    assert.equal(ready.statusText, 'KTeam 0.4.1 已下载，重启即可完成更新。');
    assert.equal(ready.showInstallButton, true);
    assert.equal(ready.installLabel, '立即重启并更新');

    const failed = presentUpdateCheck({ channel: 'nsis', status: { ...idleStatus, error: 'network down' } });
    assert.equal(failed.tone, 'error');
    assert.equal(failed.statusText, '检查更新失败：network down');
    assert.equal(failed.buttonDisabled, false);

    assert.equal(presentUpdateCheck({ channel: 'mac', status: { ...idleStatus, error: DEV_MODE_MESSAGE } }).tone, 'dev');
    assert.equal(presentUpdateCheck({ channel: 'mac', status: { ...idleStatus, error: DISABLED_MESSAGE } }).tone, 'disabled');
    const linux = presentUpdateCheck({ channel: 'unsupported', status: { ...idleStatus, error: UNSUPPORTED_UPDATE_MESSAGE } });
    assert.equal(linux.tone, 'unsupported');
    assert.equal(linux.showReleasesLink, true);
    assert.equal(linux.buttonDisabled, false);
  });

  it('places the button in 关于 KTeam and never greys or hides it for the portable path', () => {
    const settings = readFileSync(join(repoRoot, 'desktop', 'renderer', 'src', 'settings.tsx'), 'utf8');
    const panel = readFileSync(join(repoRoot, 'desktop', 'renderer', 'src', 'update-check.tsx'), 'utf8');
    const main = readFileSync(join(repoRoot, 'desktop', 'main.ts'), 'utf8');
    assert.match(settings, /UpdateCheckSettings/);
    assert.match(settings, /关于 KTeam/);
    assert.match(panel, /检查更新/);
    assert.match(panel, /view\.releasesUrl/);
    assert.match(panel, /disabled=\{view\.buttonDisabled\}/);
    assert.doesNotMatch(panel, /hidden|grey|gray|PORTABLE_EXECUTABLE_DIR/);
    assert.match(main, /updateStatus/);
    assert.match(main, /openKTeamReleases/);
    assert.match(main, /KTEAM_RELEASES_URL/);
    assert.match(main, /PORTABLE_UPDATE_MESSAGE/);
    const ui = readFileSync(join(repoRoot, 'desktop', 'update-ui.ts'), 'utf8');
    const updater = readFileSync(join(repoRoot, 'desktop', 'updater.ts'), 'utf8');
    assert.doesNotMatch(ui, /xiaok/i);
    assert.doesNotMatch(updater, /xiaok/i);
    assert.doesNotMatch(panel, /xiaok/i);
    assert.match(ui, /kaisersong\/KTeam\/releases/);
  });
});
