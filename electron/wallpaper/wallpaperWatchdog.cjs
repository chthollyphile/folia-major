// electron/wallpaper/wallpaperWatchdog.cjs
// Desktop wallpaper mode (Wayland wlr-layer-shell via windowtolayer / X11 desktop window):
// liveness watchdog and recovery-to-normal-window plumbing, extracted from main.cjs so the
// recovery paths can be unit-tested and simulated without an Electron runtime or a compositor.
//
// Process model: a "jumpboard" Folia spawns windowtolayer (wtl); wtl spawns the real wrapped
// Folia child with WAYLAND_SOCKET=<fd>. The wrapped child's parent is wtl. If wtl dies the
// socketpair EOFs and Chromium usually crashes in milliseconds — the watchdog cannot beat that.
// Its value is (a) recovering when the main process survives wtl exiting for a non-fatal reason,
// and (b) the crash-loop breaker stopping a persistent re-wrap loop on the next launch.

const WALLPAPER_MODE_SETTING_KEY = 'wallpaper_mode';
const WALLPAPER_WRAPPED_CRASH_COUNT_KEY = 'wallpaper_wrapped_crash_count';

function isWallpaperModeEnabled(store) {
  return store.get(WALLPAPER_MODE_SETTING_KEY) === true;
}

function isWallpaperWrapped(env) {
  return env.FOLIA_WRAPPED_BY_WINDOWTOLAYER === '1';
}

function isX11WallpaperMode({ platform, env, store }) {
  return platform === 'linux' && !env.WAYLAND_DISPLAY && isWallpaperModeEnabled(store);
}

function createWallpaperWatchdog(options = {}) {
  const {
    store,
    env = process.env,
    spawnFn,
    execPath = () => process.execPath,
    argv = () => process.argv.slice(1),
    getPpid = () => process.ppid,
    exit,
    killFn = process.kill.bind(process),
    logWarn = console.warn.bind(console),
    logError = console.error.bind(console),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    probeIntervalMs = 2000,
    healthyUptimeMs = 60_000,
    crashThreshold = 3,
  } = options;

  let recovering = false;
  let parentProbeHandle = null;

  // Relaunches Folia as a plain (non-wrapped) process without touching the stored mode.
  function relaunchSelfNormal() {
    const childEnv = { ...env, FOLIA_RELAUNCH: '1' }; // marker lets the new process win the lock race
    delete childEnv.WAYLAND_SOCKET;
    delete childEnv.FOLIA_WRAPPED_BY_WINDOWTOLAYER;
    const child = spawnFn(execPath(), argv(), { env: childEnv, detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      // The current process keeps running; just log so the half-state is visible in the console.
      logError('[Wallpaper] relaunch failed, staying in current window', err);
    });
    child.on('spawn', () => exit(0));
  }

  function recoverToNormalWindow() {
    if (recovering) {
      return false;
    }
    recovering = true;
    if (parentProbeHandle) {
      clearIntervalFn(parentProbeHandle);
      parentProbeHandle = null;
    }
    // The setting must be cleared first, otherwise the next launch enters the wrapper branch again.
    logWarn('[Wallpaper] windowtolayer lost, recovering to a normal window');
    store.set(WALLPAPER_MODE_SETTING_KEY, false);
    relaunchSelfNormal();
    return true;
  }

  // Watchdog trigger point 1 (window build failure): recover only while wrapped. The caller logs
  // the failure itself — the original main.cjs printed it unconditionally, wrapped or not.
  function handleWindowBuildFailure() {
    if (!isWallpaperWrapped(env)) {
      return false;
    }
    return recoverToNormalWindow();
  }

  // Watchdog trigger point 1 (renderer crash): recover only while wrapped, and only on a real
  // crash — 'oom' / 'killed' / manual termination are not treated as wtl failures.
  function handleRendererGone(details) {
    if (!isWallpaperWrapped(env) || details?.reason !== 'crashed') {
      return false;
    }
    return recoverToNormalWindow();
  }

  // Watchdog trigger point 2: while wrapped the parent is wtl. Probe its liveness and recover to
  // a normal window if it died. parentPid is captured once at startup: on Linux the kernel
  // reparents an orphan to a subreaper (systemd --user / init), so re-reading process.ppid after
  // wtl dies returns a live pid and the ESRCH probe would never fire.
  function startParentLivenessProbe({ parentPid = getPpid() } = {}) {
    const handle = setIntervalFn(() => {
      if (recovering) {
        return;
      }
      if (getPpid() !== parentPid) {
        recoverToNormalWindow();
        return;
      }
      try {
        killFn(parentPid, 0); // 0 = existence probe only, no signal sent
      } catch (err) {
        if (err?.code === 'ESRCH') {
          recoverToNormalWindow();
        }
        // EPERM = the process exists but is not owned by us; treat as alive and ignore.
      }
    }, probeIntervalMs);
    if (typeof handle?.unref === 'function') {
      handle.unref();
    }
    parentProbeHandle = handle;
    return {
      stop: () => {
        if (parentProbeHandle === handle) {
          parentProbeHandle = null;
        }
        clearIntervalFn(handle);
      },
    };
  }

  // Crash-loop breaker: a wrapped session that dies before the watchdog can fire leaves
  // wallpaper_mode on, so the next launch re-wraps. Count consecutive wrapped launches; a session
  // that survives healthyUptimeMs resets the count, and once it reaches crashThreshold the wrap
  // decision disables wallpaper mode to break the loop.
  function getWrappedCrashCount() {
    const stored = store.get(WALLPAPER_WRAPPED_CRASH_COUNT_KEY);
    return typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
  }

  function recordWrappedLaunch() {
    const count = getWrappedCrashCount() + 1;
    store.set(WALLPAPER_WRAPPED_CRASH_COUNT_KEY, count);
    const reset = setTimeoutFn(() => {
      store.set(WALLPAPER_WRAPPED_CRASH_COUNT_KEY, 0);
    }, healthyUptimeMs);
    if (typeof reset?.unref === 'function') {
      reset.unref();
    }
    return count;
  }

  function resetWrappedCrashCount() {
    // Runs on every plain startup, so avoid a store write when there is nothing to clear.
    if (getWrappedCrashCount() !== 0) {
      store.set(WALLPAPER_WRAPPED_CRASH_COUNT_KEY, 0);
    }
  }

  function shouldDisableWallpaperMode() {
    return getWrappedCrashCount() >= crashThreshold;
  }

  return {
    recoverToNormalWindow,
    relaunchSelfNormal,
    handleWindowBuildFailure,
    handleRendererGone,
    startParentLivenessProbe,
    getWrappedCrashCount,
    recordWrappedLaunch,
    resetWrappedCrashCount,
    shouldDisableWallpaperMode,
  };
}

module.exports = {
  WALLPAPER_MODE_SETTING_KEY,
  WALLPAPER_WRAPPED_CRASH_COUNT_KEY,
  isWallpaperModeEnabled,
  isWallpaperWrapped,
  isX11WallpaperMode,
  createWallpaperWatchdog,
};
