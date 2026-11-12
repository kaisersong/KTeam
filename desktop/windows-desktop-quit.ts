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
export const WINDOWS_QUIT_FORCE_EXIT_DEFERRED = 'windows-quit-forced-exit-deferred';

/**
 * Default fallback timer. It is unref'd so it never keeps the event loop alive on
 * its own: a clean quit exits immediately instead of lingering 3s and always
 * taking the app.exit(0) path. It still fires if something else keeps the
 * process alive, which is exactly the hang it guards against.
 */
export function scheduleUnrefTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(callback, delayMs);
  timer.unref?.();
  return timer;
}

export interface WindowsDesktopQuitHooks {
  stopPolling: () => void | Promise<void>;
  stopHostTree: () => Promise<void>;
  quit: () => void;
  exit: (code: number) => void;
  log: (event: string, diagnostic?: string, level?: 'warn' | 'error') => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** Returns a cancel function for the scheduled fallback. */
  schedule?: (callback: () => void, delayMs: number) => (() => void) | void;
  /** Register a one-shot will-quit listener; the fallback timer is cleared there. */
  onWillQuit?: (listener: () => void) => void;
  forceExitAfterMs?: number;
  /** Return false while an update install handoff is pending but not yet committed, so it is not cut off. */
  canForceExit?: () => boolean;
}

export async function quitWindowsDesktop(hooks: WindowsDesktopQuitHooks): Promise<void> {
  await hooks.stopPolling();
  try {
    await hooks.stopHostTree();
  } finally {
    const forceAfter = hooks.forceExitAfterMs ?? WINDOWS_QUIT_FORCE_EXIT_MS;
    const fire = () => {
      if (hooks.canForceExit && !hooks.canForceExit()) {
        hooks.log(WINDOWS_QUIT_FORCE_EXIT_DEFERRED, 'update install handoff pending and not committed; not forcing exit', 'warn');
        return;
      }
      hooks.log(WINDOWS_QUIT_FORCE_EXIT, `process still alive ${forceAfter}ms after app.quit`, 'warn');
      hooks.exit(0);
    };
    let cancelled = false;
    let cancel: (() => void) | void;
    const guarded = () => { if (!cancelled) fire(); };
    if (hooks.schedule) cancel = hooks.schedule(guarded, forceAfter);
    else if (hooks.wait) void hooks.wait(forceAfter).then(guarded);
    else {
      const timer = scheduleUnrefTimer(guarded, forceAfter);
      cancel = () => clearTimeout(timer);
    }
    hooks.onWillQuit?.(() => {
      cancelled = true;
      if (cancel) cancel();
    });
    hooks.quit();
  }
}
