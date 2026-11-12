/**
 * KTeam desktop auto-update (macOS and Windows NSIS).
 *
 * KTeam owns this file. It started as a copy of another desktop app's updater and
 * is now maintained here only. Updates come only from KTeam's own GitHub Releases
 * (`KTEAM_UPDATE_FEED`), never from any other product's feed.
 *
 * Behaviour:
 *  - Packaged macOS and Windows NSIS builds only. Dev / unpackaged builds, builds
 *    without `Resources/app-update.yml`, Linux and other platforms,
 *    `KTEAM_DISABLE_AUTO_UPDATE=1`, and Windows portable builds
 *    (`PORTABLE_EXECUTABLE_DIR` set) never start the updater and never download.
 *  - Check shortly after startup (one retry after a minute on failure), then every 4 hours.
 *  - Download in the background; once downloaded the user is asked to restart, and
 *    the update is also installed on the next normal quit.
 *  - Stable users never receive prereleases or downgrades.
 *  - Install uses the two-phase handoff in `updater-handoff.ts`: nothing is torn
 *    down until the real `before-quit` fires.
 */
import { types } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UpdaterHandoffStateMachine } from './updater-handoff.js';

/** The only update feed KTeam ever uses. Must match electron-builder.yml `publish` and desktop/app-update.yml. */
export const KTEAM_UPDATE_FEED = Object.freeze({ provider: 'github', owner: 'kaisersong', repo: 'KTeam' } as const);
export const STARTUP_UPDATE_DELAY_MS = 10_000;
export const STARTUP_UPDATE_RETRY_DELAY_MS = 60_000;
export const PERIODIC_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const INSTALL_OBSERVATION_MS = 30_000;
export const DEV_MODE_MESSAGE = '开发模式下无法检查更新';
export const DISABLED_MESSAGE = '自动更新已关闭（KTEAM_DISABLE_AUTO_UPDATE）';
export const PORTABLE_UPDATE_MESSAGE = '便携版不会自动更新，请到 Releases 下载新版本';
export const UNSUPPORTED_UPDATE_MESSAGE = '此版本不支持自动更新';

/** electron-builder sets this for portable executables. Any non-empty value means portable. */
export function isPortableBuild(env: NodeJS.ProcessEnv): boolean {
  const value = env.PORTABLE_EXECUTABLE_DIR;
  return value !== undefined && value !== '';
}

export type AutoUpdateChannel = 'mac' | 'nsis' | 'portable' | 'unsupported';

export function resolveAutoUpdateChannel(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): AutoUpdateChannel {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return isPortableBuild(env) ? 'portable' : 'nsis';
  return 'unsupported';
}

export function autoUpdateEnabledForChannel(channel: AutoUpdateChannel): boolean {
  return channel === 'mac' || channel === 'nsis';
}

export function inactiveUpdateMessage(reason: 'portable' | 'unsupported' | 'env' | 'dev'): string {
  if (reason === 'portable') return PORTABLE_UPDATE_MESSAGE;
  if (reason === 'unsupported') return UNSUPPORTED_UPDATE_MESSAGE;
  if (reason === 'env') return DISABLED_MESSAGE;
  return DEV_MODE_MESSAGE;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
  progress: number; // 0-100
  version?: string;
  error?: string;
}

export interface UpdaterRequestContext { requestSource: 'user' | 'agent' | 'scheduler' }
export type UpdaterLogger = (event: string, diagnostic?: string) => void;

export interface UpdaterEnvironment {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  resourcesPath: string | undefined;
  fileExists: (path: string) => boolean;
  loadModule: () => Promise<unknown>;
  platform: NodeJS.Platform;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  setRepeating: (callback: () => void, delayMs: number) => unknown;
}

export interface UpdaterEvents {
  /** Fired once per downloaded version so the shell can ask the user to restart. */
  onDownloaded?: (version: string) => void;
  /** Every status change (renderer / menu projection). */
  onStatus?: (status: UpdateStatus) => void;
}

export function defaultUpdaterEnvironment(input: { isPackaged: boolean }): UpdaterEnvironment {
  return {
    env: process.env,
    isPackaged: input.isPackaged,
    resourcesPath: process.resourcesPath,
    fileExists: existsSync,
    loadModule: () => import('electron-updater'),
    platform: process.platform,
    setTimer: (callback, delayMs) => { const t = setTimeout(callback, delayMs); t.unref?.(); return t; },
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setRepeating: (callback, delayMs) => { const t = setInterval(callback, delayMs); t.unref?.(); return t; },
  };
}

export function assertUpdaterSource(raw: unknown, allowed: 'user' | 'scheduler'): void {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw) || !Object.hasOwn(raw, 'requestSource')) throw Error('updater_request_source_required');
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'requestSource');
  const source = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof source !== 'string' || !['user', 'agent', 'scheduler'].includes(source)) throw Error('updater_request_source_invalid');
  if (source !== allowed) throw Error('updater_request_source_forbidden');
}

const STATUS_KEYS = new Set(['checking', 'available', 'downloading', 'downloaded', 'installing', 'progress', 'version', 'error']);
export function captureUpdateStatus(raw: unknown): UpdateStatus {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw)) throw Error('updater_projection_unavailable');
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!STATUS_KEYS.has(key)) throw Error('updater_projection_unavailable');
  for (const key of ['checking', 'available', 'downloading', 'downloaded'] as const) if (typeof value[key] !== 'boolean') throw Error('updater_projection_unavailable');
  if (value.installing !== undefined && typeof value.installing !== 'boolean') throw Error('updater_projection_unavailable');
  if (typeof value.progress !== 'number' || !Number.isFinite(value.progress)) throw Error('updater_projection_unavailable');
  for (const key of ['version', 'error'] as const) if (value[key] !== undefined && typeof value[key] !== 'string') throw Error('updater_projection_unavailable');
  const status: UpdateStatus = {
    checking: value.checking as boolean, available: value.available as boolean,
    downloading: value.downloading as boolean, downloaded: value.downloaded as boolean, progress: value.progress as number,
  };
  if (value.installing !== undefined) status.installing = value.installing as boolean;
  if (value.version !== undefined) status.version = value.version as string;
  if (value.error !== undefined) status.error = value.error as string;
  return status;
}

export function resolveAutoUpdaterExport(module: unknown): any | null {
  if (!module || typeof module !== 'object') return null;
  const candidate = (module as { autoUpdater?: unknown }).autoUpdater
    ?? (module as { default?: { autoUpdater?: unknown } }).default?.autoUpdater;
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof (candidate as { checkForUpdates?: unknown }).checkForUpdates !== 'function') return null;
  return candidate;
}

export function callAutoUpdaterQuitAndInstall(updater: unknown): boolean {
  if (!updater || typeof updater !== 'object') return false;
  const candidate = updater as {
    autoInstallOnAppQuit?: boolean;
    quitAndInstall?: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  };
  if (typeof candidate.quitAndInstall !== 'function') return false;
  candidate.autoInstallOnAppQuit = true;
  candidate.quitAndInstall(false, true);
  return true;
}

interface StartupUpdateCheckOptions {
  retryDelayMs?: number;
  onError: (error: Error) => void;
  setTimer?: (callback: () => void | Promise<void>, delayMs: number) => unknown;
  shouldCheck?: () => boolean;
}

interface StartupAutoUpdater {
  checkForUpdatesAndNotify: () => Promise<unknown> | unknown;
}

export async function runStartupUpdateCheck(updater: StartupAutoUpdater, options: StartupUpdateCheckOptions): Promise<void> {
  const retryDelayMs = options.retryDelayMs ?? STARTUP_UPDATE_RETRY_DELAY_MS;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  try {
    if (options.shouldCheck && !options.shouldCheck()) return;
    await updater.checkForUpdatesAndNotify();
  } catch (error) {
    options.onError(toError(error));
    setTimer(async () => {
      try {
        if (options.shouldCheck && !options.shouldCheck()) return;
        await updater.checkForUpdatesAndNotify();
      } catch (retryError) {
        options.onError(toError(retryError));
      }
    }, retryDelayMs);
  }
}

/** Removes URLs (which may carry signed download tokens) from diagnostics. */
export function redactUpdaterDiagnostic(message: string): string {
  return message.replace(/https?:\/\/[^\s]+/gi, '[URL omitted]');
}

export function autoUpdateDisabledByEnv(env: NodeJS.ProcessEnv): boolean {
  const value = env.KTEAM_DISABLE_AUTO_UPDATE;
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

export function isDevelopmentMode(environment: Pick<UpdaterEnvironment, 'env' | 'isPackaged' | 'resourcesPath' | 'fileExists'>): boolean {
  if (!environment.isPackaged) return true;
  if (environment.env.NODE_ENV === 'development') return true;
  if (environment.env.KTEAM_DEV_URL) return true;
  if (!environment.resourcesPath) return true;
  // electron-updater reads its feed from Resources/app-update.yml; without it there is no feed.
  return !environment.fileExists(join(environment.resourcesPath, 'app-update.yml'));
}

/** No-op verifier: 0.4 Windows builds are unsigned, and electron-updater would
 * reject them if a publisherName were present. Returning null means "accept".
 * When publisherName is absent, NsisUpdater already skips verification; this
 * keeps that skip explicit if a verifier is installed on the instance. */
export async function skipUpdateCodeSignature(_publisherNames: string[], _file: string): Promise<string | null> {
  return null;
}

/** Stable builds never move to a prerelease or an older version. */
export function configureAutoUpdater(updater: Record<string, unknown>): void {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.channel = 'latest';
  if (typeof updater.setFeedURL === 'function') (updater.setFeedURL as (feed: unknown) => void)({ ...KTEAM_UPDATE_FEED });
  // Only NsisUpdater exposes this setter. MacUpdater is left unchanged.
  if ('verifyUpdateCodeSignature' in updater) updater.verifyUpdateCodeSignature = skipUpdateCodeSignature;
}

function toError(error: unknown): Error {
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object' && !types.isProxy(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') return new Error(descriptor.value);
  }
  return new Error('updater_operation_unknown');
}

function sdkScalar(raw: unknown, key: string): unknown {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw)) throw Error('updater_projection_unavailable');
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  if (!descriptor || !('value' in descriptor)) throw Error('updater_projection_unavailable');
  return descriptor.value;
}

export interface KTeamUpdater {
  setup(logger: UpdaterLogger | undefined, context: UpdaterRequestContext): Promise<void>;
  checkForUpdates(context: UpdaterRequestContext): Promise<void>;
  getStatus(): UpdateStatus;
  getChannel(): AutoUpdateChannel;
  hasCompletedCheck(): boolean;
  createHandoff(platform?: NodeJS.Platform): UpdaterHandoffStateMachine;
  /** Called only after the real before-quit transition, never by the install request. */
  completeHandoff(): void;
  /** Cancel startup/periodic update checks. Windows last-window quit calls this; macOS quit/update paths do not. */
  stopPolling(): void;
  quitAndInstall(context: UpdaterRequestContext): ReturnType<UpdaterHandoffStateMachine['begin']>;
}

export function createKTeamUpdater(environment: UpdaterEnvironment, events: UpdaterEvents = {}): KTeamUpdater {
  let updateStatus: UpdateStatus = { checking: false, available: false, downloading: false, downloaded: false, progress: 0 };
  let isDevMode = false;
  let inactiveReason: 'portable' | 'unsupported' | 'env' | 'dev' | undefined;
  let autoUpdater: any = null;
  let autoUpdaterEventsRegistered = false;
  let updaterSetup: Promise<boolean> | undefined;
  let handoff: UpdaterHandoffStateMachine | null = null;
  let observationTimer: unknown;
  let wrapperInProgress = false;
  let syncWrapperError: Error | undefined;
  let notifiedVersion: string | undefined;
  let completedCheck = false;
  let logUpdater: UpdaterLogger = () => {};
  let startupTimer: unknown;
  let periodicTimer: unknown;
  let pollingStopped = false;

  const attemptLocked = () => Boolean(handoff?.hasPendingIntent || handoff?.snapshot().kind === 'handed_off');
  const clearObservation = () => { if (observationTimer !== undefined) environment.clearTimer(observationTimer); observationTimer = undefined; };
  function stopPolling(): void {
    pollingStopped = true;
    if (startupTimer !== undefined) environment.clearTimer(startupTimer);
    startupTimer = undefined;
    if (periodicTimer !== undefined) environment.clearTimer(periodicTimer);
    periodicTimer = undefined;
    clearObservation();
  }
  const currentChannel = () => resolveAutoUpdateChannel(environment.platform, environment.env);
  const resolveInactiveReason = (): 'portable' | 'unsupported' | 'env' | 'dev' | undefined => {
    const channel = currentChannel();
    if (channel === 'portable') return 'portable';
    if (channel === 'unsupported') return 'unsupported';
    if (autoUpdateDisabledByEnv(environment.env)) return 'env';
    if (isDevMode || isDevelopmentMode(environment)) return 'dev';
    return undefined;
  };

  function sendUpdateStatus(): void {
    try { events.onStatus?.(captureUpdateStatus(updateStatus)); } catch { /* a closing window cannot throw back into the SDK dispatcher */ }
  }
  function recordProjectionFailure(): void {
    updateStatus = { ...updateStatus, error: 'updater_projection_unavailable' };
    sendUpdateStatus();
  }
  function setUpdateStatus(patch: Partial<UpdateStatus>, installTransition = false): void {
    if (!installTransition && attemptLocked()) return;
    try { updateStatus = captureUpdateStatus(Object.fromEntries(Object.entries({ ...updateStatus, ...patch }).filter(([, value]) => value !== undefined))); }
    catch { recordProjectionFailure(); return; }
    sendUpdateStatus();
  }
  function sdkEvent(handler: (raw: unknown) => void): (raw: unknown) => void {
    return raw => { try { handler(raw); } catch { recordProjectionFailure(); } };
  }
  function reportUpdaterError(error: unknown): void {
    const message = toError(error).message;
    try { logUpdater('error', redactUpdaterDiagnostic(message)); } catch { /* diagnostic sink */ }
    if (handoff?.snapshot().kind === 'handed_off') return;
    if (wrapperInProgress) syncWrapperError = toError(error);
    else handoff?.observeAsyncUpdaterError(error);
    clearObservation();
    completedCheck = true;
    setUpdateStatus({ checking: false, downloading: false, installing: false, error: message }, true);
  }

  async function loadAutoUpdater(): Promise<boolean> {
    if (autoUpdater) return true;
    try {
      autoUpdater = resolveAutoUpdaterExport(await environment.loadModule());
      if (!autoUpdater) { setUpdateStatus({ error: '无法加载更新器: electron-updater 未导出 autoUpdater' }); return false; }
      configureAutoUpdater(autoUpdater);
      return true;
    } catch (error) {
      setUpdateStatus({ error: `无法加载更新器: ${toError(error).message}` });
      return false;
    }
  }

  function registerAutoUpdaterEvents(): void {
    if (!autoUpdater || autoUpdaterEventsRegistered) return;
    autoUpdaterEventsRegistered = true;
    autoUpdater.on('checking-for-update', () => setUpdateStatus({ checking: true, installing: false, error: undefined }));
    autoUpdater.on('update-available', sdkEvent(info => {
      const version = sdkScalar(info, 'version');
      if (typeof version !== 'string') throw Error('updater_projection_unavailable');
      completedCheck = true;
      logUpdater('update-available', version);
      setUpdateStatus({ checking: false, available: true, installing: false, version });
    }));
    autoUpdater.on('update-not-available', () => { completedCheck = true; setUpdateStatus({ checking: false, available: false, installing: false }); });
    autoUpdater.on('download-progress', sdkEvent(progress => {
      const percent = sdkScalar(progress, 'percent');
      if (typeof percent !== 'number' || !Number.isFinite(percent)) throw Error('updater_projection_unavailable');
      setUpdateStatus({ downloading: true, installing: false, progress: Math.round(percent) });
    }));
    autoUpdater.on('update-downloaded', sdkEvent(info => {
      const version = sdkScalar(info, 'version');
      if (typeof version !== 'string') throw Error('updater_projection_unavailable');
      logUpdater('update-downloaded', version);
      const locked = attemptLocked();
      setUpdateStatus({ downloading: false, downloaded: true, installing: false, version, progress: 100 });
      if (!locked && notifiedVersion !== version) {
        notifiedVersion = version;
        try { events.onDownloaded?.(version); } catch { /* prompt failures never break the updater */ }
      }
    }));
    autoUpdater.on('error', sdkEvent(error => reportUpdaterError(toError(error))));
  }

  function createHandoff(platform: NodeJS.Platform = environment.platform): UpdaterHandoffStateMachine {
    if (handoff) return handoff;
    handoff = new UpdaterHandoffStateMachine({
      platformClass: platform === 'darwin' ? 'mac' : 'base',
      authorizeBegin: context => assertUpdaterSource(context, 'user'),
      preflight: () => {
        if (updateStatus.error) throw new Error(updateStatus.error);
        if (!updateStatus.downloaded || !autoUpdater || typeof autoUpdater.quitAndInstall !== 'function') {
          const error = new Error('update_install_not_ready');
          reportUpdaterError(error);
          throw error;
        }
      },
      invokeWrapper: () => {
        syncWrapperError = undefined;
        wrapperInProgress = true;
        setUpdateStatus({ installing: true }, true);
        logUpdater('install-wrapper-entered');
        try {
          if (!callAutoUpdaterQuitAndInstall(autoUpdater)) throw new Error('update_install_not_ready');
        } catch (error) {
          reportUpdaterError(error);
          throw error;
        } finally {
          wrapperInProgress = false;
        }
        if (!syncWrapperError && handoff?.hasPendingIntent) {
          observationTimer = environment.setTimer(() => {
            observationTimer = undefined;
            if (handoff?.hasPendingIntent) reportUpdaterError(new Error('update_install_handoff_unconfirmed'));
          }, INSTALL_OBSERVATION_MS);
        }
        return { syncError: syncWrapperError };
      },
    });
    return handoff;
  }

  async function setup(logger: UpdaterLogger | undefined, context: UpdaterRequestContext): Promise<void> {
    assertUpdaterSource(context, 'scheduler');
    if (logger) logUpdater = logger;
    if (updaterSetup) { await updaterSetup; return; }
    const attempt = Promise.resolve().then(async () => {
      const reason = resolveInactiveReason();
      if (reason === 'portable' || reason === 'unsupported' || reason === 'env' || reason === 'dev') {
        inactiveReason = reason;
        isDevMode = reason === 'dev';
        updateStatus.error = inactiveUpdateMessage(reason);
        logUpdater(reason === 'dev' ? 'skipped' : 'disabled', reason === 'env' ? 'KTEAM_DISABLE_AUTO_UPDATE' : reason === 'dev' ? 'development build' : reason);
        return true;
      }
      if (!(await loadAutoUpdater())) return false;
      registerAutoUpdaterEvents();
      logUpdater('setup', `${KTEAM_UPDATE_FEED.owner}/${KTEAM_UPDATE_FEED.repo}`);
      startupTimer = environment.setTimer(() => {
        startupTimer = undefined;
        if (pollingStopped) return;
        void runStartupUpdateCheck(autoUpdater, {
          retryDelayMs: STARTUP_UPDATE_RETRY_DELAY_MS,
          setTimer: (callback, delayMs) => environment.setTimer(() => { void callback(); }, delayMs),
          shouldCheck: () => !pollingStopped && !attemptLocked(),
          onError: error => { if (!pollingStopped && !attemptLocked()) reportUpdaterError(error); },
        });
      }, STARTUP_UPDATE_DELAY_MS);
      periodicTimer = environment.setRepeating(() => {
        if (pollingStopped) return;
        if (autoUpdater && !attemptLocked()) {
          Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch((error: unknown) => {
            try { logUpdater('error', redactUpdaterDiagnostic(toError(error).message)); } catch { /* diagnostic sink */ }
            setUpdateStatus({ checking: false, downloading: false, error: toError(error).message });
          });
        }
      }, PERIODIC_UPDATE_INTERVAL_MS);
      if (pollingStopped) stopPolling();
      return true;
    });
    updaterSetup = attempt;
    try { if (!await attempt && updaterSetup === attempt) updaterSetup = undefined; }
    catch (error) { if (updaterSetup === attempt) updaterSetup = undefined; throw error; }
  }

  function getStatus(): UpdateStatus {
    const reason = inactiveReason ?? resolveInactiveReason();
    if (reason) {
      return { checking: false, available: false, downloading: false, downloaded: false, installing: false, progress: 0, error: inactiveUpdateMessage(reason) };
    }
    return captureUpdateStatus(updateStatus);
  }

  async function checkForUpdates(context: UpdaterRequestContext): Promise<void> {
    assertUpdaterSource(context, 'user');
    if (attemptLocked()) return;
    const reason = inactiveReason ?? resolveInactiveReason();
    if (reason) {
      setUpdateStatus({ checking: false, error: inactiveUpdateMessage(reason) });
      return;
    }
    setUpdateStatus({ checking: true, error: undefined });
    if (!(await loadAutoUpdater())) { setUpdateStatus({ checking: false }); return; }
    registerAutoUpdaterEvents();
    try {
      const result = await autoUpdater.checkForUpdates();
      completedCheck = true;
      if (result === null) setUpdateStatus({ checking: false, error: '更新器未激活' });
    } catch (error) {
      completedCheck = true;
      setUpdateStatus({ checking: false, downloading: false, error: toError(error).message });
    }
  }

  return {
    setup,
    checkForUpdates,
    getStatus,
    getChannel: currentChannel,
    hasCompletedCheck: () => completedCheck,
    createHandoff,
    completeHandoff: () => { clearObservation(); logUpdater('before-quit'); },
    stopPolling,
    quitAndInstall: context => createHandoff().begin(context),
  };
}
