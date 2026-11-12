/** Renderer-safe update projection. Execution and handoff remain in the main process. */
export const DEV_MODE_MESSAGE = '开发模式下无法检查更新';
export const DISABLED_MESSAGE = '自动更新已关闭（KTEAM_DISABLE_AUTO_UPDATE）';
export const PORTABLE_UPDATE_MESSAGE = '便携版不会自动更新，请到 Releases 下载新版本';
export const UNSUPPORTED_UPDATE_MESSAGE = '此版本不支持自动更新';
export type AutoUpdateChannel = 'mac' | 'nsis' | 'portable' | 'unsupported';
export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  installing?: boolean;
  progress: number;
  version?: string;
  error?: string;
}
