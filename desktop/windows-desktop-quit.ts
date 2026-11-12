/**
 * Windows-only last-window quit. macOS must never call this: closing the last
 * window there leaves the app (and the detached host) running in the background.
 *
 * Order: stop updater polling, stop the verified host tree (service-owner and
 * services are children of the host), then app.quit(). If the process is still
 * alive after 3s, app.exit(0) and log a warn — a last-window close on Windows
 * has no tray, so a leftover main process is unreachable.
 */
export const WINDOWS_QUIT_FORCE_EXIT_MS = 3_000;
export const WINDOWS_QUIT_FORCE_EXIT = 'windows-quit-forced-exit';

export interface WindowsDesktopQuitHooks {
  stopPolling: () => void | Promise<void>;
  stopHostTree: () => Promise<void>;
  quit: () => void;
  exit: (code: number) => void;
  log: (event: string, diagnostic?: string, level?: 'warn' | 'error') => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  schedule?: (callback: () => void, delayMs: number) => void;
  forceExitAfterMs?: number;
}

export async function quitWindowsDesktop(hooks: WindowsDesktopQuitHooks): Promise<void> {
  await hooks.stopPolling();
  try {
    await hooks.stopHostTree();
  } finally {
    const forceAfter = hooks.forceExitAfterMs ?? WINDOWS_QUIT_FORCE_EXIT_MS;
    const fire = () => {
      hooks.log(WINDOWS_QUIT_FORCE_EXIT, `process still alive ${forceAfter}ms after app.quit`, 'warn');
      hooks.exit(0);
    };
    if (hooks.schedule) hooks.schedule(fire, forceAfter);
    else if (hooks.wait) void hooks.wait(forceAfter).then(fire);
    else setTimeout(fire, forceAfter);
    hooks.quit();
  }
}
