import {transientUpdateNetworkError} from './update-network.js';
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

export function updateErrorPresentation(error: string): { message: string; showReleasesLink: boolean } {
  if (/code signature[\s\S]*(?:validation|requirement)|signature[\s\S]*(?:rejected|invalid)/i.test(error)) {
    return { message: '更新未通过签名校验。请从 KTeam Releases 下载官方安装包，替换当前应用后重新打开。', showReleasesLink: true };
  }
  if (error === 'update_install_handoff_unconfirmed') {
    return { message: '尚未确认更新安装已启动。请保留当前工作，并从 KTeam Releases 下载官方安装包。', showReleasesLink: true };
  }
  if(transientUpdateNetworkError(error))return {message:'暂时无法连接更新服务器，请检查网络或代理。将自动重试，也可点击重新检查。',showReleasesLink:false};
  return { message: `检查更新失败：${error}`, showReleasesLink: false };
}

export type UpdateCheckTone = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'portable' | 'unsupported' | 'disabled' | 'dev';

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
  showDownloadButton?: boolean;
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
  // A cached download can survive a native signature/install failure. It must
  // never hide that failure behind the restart button (or an installing spinner).
  if (status.error === DEV_MODE_MESSAGE) {
    return { ...base, statusText: DEV_MODE_MESSAGE, tone: 'dev' };
  }
  if (status.error === DISABLED_MESSAGE) {
    return { ...base, statusText: DISABLED_MESSAGE, tone: 'disabled' };
  }
  if (status.error) {
    const failure = updateErrorPresentation(status.error);
    return { ...base, statusText: failure.message, tone: 'error', showReleasesLink: failure.showReleasesLink, ...(failure.showReleasesLink ? { releasesUrl: KTEAM_RELEASES_URL } : {}) };
  }
  if (status.installing) {
    return { ...base, buttonDisabled: true, statusText: status.version ? `正在安装 KTeam ${status.version}…` : '正在安装更新…', tone: 'ready' };
  }
  if (status.downloaded && status.version) {
    return { ...base, statusText: `KTeam ${status.version} 已下载，重启即可完成更新。`, tone: 'ready', showInstallButton: true };
  }
  if (status.downloading) {
    const version = status.version ? ` KTeam ${status.version}` : '';
    const progress = Number.isFinite(status.progress) ? `（${status.progress}%）` : '';
    return { ...base, buttonDisabled: true, statusText: `正在后台下载${version}${progress}，下载完成后可在左下角重启安装。`, tone: 'downloading' };
  }
  if (status.checking) {
    return { ...base, buttonDisabled: true, statusText: '正在检查更新…', tone: 'checking' };
  }
  if (status.available && status.version) {
    return { ...base, statusText: `发现 KTeam ${status.version}，点击下载更新。`, tone: 'available', showDownloadButton: true };
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
