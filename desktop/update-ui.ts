/**
 * Presentation for KTeam's settings 「检查更新」 control.
 * The Releases URL lives here (not in updater.ts) so the updater module stays
 * free of download URLs. The only destination is KTeam's own Releases.
 */
import {
  PORTABLE_UPDATE_MESSAGE, UNSUPPORTED_UPDATE_MESSAGE, DEV_MODE_MESSAGE, DISABLED_MESSAGE,
  type AutoUpdateChannel, type UpdateStatus,
} from './update-contract.js';

/** The only page the portable / unsupported 「检查更新」 path may open. */
export const KTEAM_RELEASES_URL = 'https://github.com/kaisersong/KTeam/releases';

export type UpdateCheckTone = 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'error' | 'portable' | 'unsupported' | 'disabled' | 'dev';

export interface UpdateCheckView {
  buttonLabel: string;
  /** The button stays clickable on portable and unsupported builds. Disabled only while a real check or install is in flight. */
  buttonDisabled: boolean;
  statusText: string;
  tone: UpdateCheckTone;
  showReleasesLink: boolean;
  releasesUrl?: string;
  showInstallButton: boolean;
  installLabel: string;
}

export interface UpdateSnapshot {
  channel: AutoUpdateChannel;
  status: UpdateStatus;
  currentVersion?: string;
  checked?: boolean;
}

export function presentUpdateCheck(input: UpdateSnapshot): UpdateCheckView {
  const installLabel = '立即重启并更新';
  const base = { buttonLabel: '检查更新', installLabel, showInstallButton: false, showReleasesLink: false, buttonDisabled: false };
  if (input.channel === 'portable') {
    return { ...base, statusText: PORTABLE_UPDATE_MESSAGE, tone: 'portable', showReleasesLink: true, releasesUrl: KTEAM_RELEASES_URL };
  }
  if (input.channel === 'unsupported') {
    return { ...base, statusText: UNSUPPORTED_UPDATE_MESSAGE, tone: 'unsupported', showReleasesLink: true, releasesUrl: KTEAM_RELEASES_URL };
  }
  const status = input.status;
  if (status.installing) {
    return { ...base, buttonDisabled: true, statusText: status.version ? `正在安装 KTeam ${status.version}…` : '正在安装更新…', tone: 'ready' };
  }
  if (status.downloaded && status.version) {
    return { ...base, statusText: `KTeam ${status.version} 已下载，重启即可完成更新。`, tone: 'ready', showInstallButton: true };
  }
  if (status.downloading) {
    const version = status.version ? ` KTeam ${status.version}` : '';
    const progress = Number.isFinite(status.progress) ? `（${status.progress}%）` : '';
    return { ...base, buttonDisabled: true, statusText: `正在后台下载${version}${progress}，下载完成后会提示你重启。`, tone: 'downloading' };
  }
  if (status.checking) {
    return { ...base, buttonDisabled: true, statusText: '正在检查更新…', tone: 'checking' };
  }
  if (status.error === DEV_MODE_MESSAGE) {
    return { ...base, statusText: DEV_MODE_MESSAGE, tone: 'dev' };
  }
  if (status.error === DISABLED_MESSAGE) {
    return { ...base, statusText: DISABLED_MESSAGE, tone: 'disabled' };
  }
  if (status.error) {
    return { ...base, statusText: `检查更新失败：${status.error}`, tone: 'error' };
  }
  if (status.available && status.version) {
    return { ...base, statusText: `正在后台下载 KTeam ${status.version}，下载完成后会提示你重启。`, tone: 'downloading' };
  }
  if (input.checked && input.currentVersion) {
    return { ...base, statusText: `KTeam ${input.currentVersion} 已是最新版本。`, tone: 'current' };
  }
  return { ...base, statusText: '', tone: 'idle' };
}

export interface UpdateMenuDialogOptions {
  type: 'info';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  title: string;
  message: string;
  detail: string;
}

/** Actual portable / unsupported menu behaviour: the message, the Releases URL in the detail, and opening it when the first button is chosen. */
export async function showPortableOrUnsupportedUpdateDialog(input: {
  channel: 'portable' | 'unsupported';
  showMessageBox: (options: UpdateMenuDialogOptions) => Promise<{ response: number }>;
  openReleases: () => Promise<unknown>;
}): Promise<'opened-releases' | 'dismissed'> {
  const message = input.channel === 'portable' ? PORTABLE_UPDATE_MESSAGE : UNSUPPORTED_UPDATE_MESSAGE;
  const picked = await input.showMessageBox({
    type: 'info',
    buttons: ['打开 Releases', '好'],
    defaultId: 0,
    cancelId: 1,
    title: 'KTeam 更新',
    message,
    detail: KTEAM_RELEASES_URL,
  });
  if (picked.response === 0) {
    await input.openReleases();
    return 'opened-releases';
  }
  return 'dismissed';
}
