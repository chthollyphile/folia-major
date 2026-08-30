// electron/windowsWallpaperController.cjs
// Windows desktop wallpaper mode: spawn/manage the folia-wallpaper-helper.exe process that
// parents the main window into the WorkerW layer.
//
// Unlike the Linux wallpaper mode there is no process relaunch involved: attach/detach are
// runtime operations on the existing window. This module owns the helper child process and a
// heartbeat watchdog over it (JSONL events on stdout, see the helper's src/events.rs); the
// helper re-attaches on its own for explorer restarts / WorkerW rebuilds, and only reports
// failure back here. The structure mirrors wallpaperWatchdog.cjs: all side effects (spawn,
// timers, store) are injected so the re-attach / degrade / crash-loop-breaker state machine can
// be unit-tested headless.

const WALLPAPER_MODE_SETTING_KEY = 'wallpaper_mode';
// Crash-loop breaker counters, persisted so a failing session cannot loop across app restarts.
const WALLPAPER_WINDOWS_FAILURE_COUNT_KEY = 'wallpaper_windows_failure_count';

const HELPER_HEARTBEAT_INTERVAL_MS = 5000; // helper emits every 5s (see monitor.rs)
const HELPER_HEARTBEAT_TIMEOUT_MS = 15_000;
const ATTACH_RETRY_DELAY_MS = 2000;
const CRASH_LOOP_THRESHOLD = 3;
const CRASH_LOOP_HEALTHY_UPTIME_MS = 60_000;
const DETACH_GRACE_MS = 5000;

// Pure JSONL line parser: returns the event object for well-formed helper lines, null otherwise.
// Kept side-effect free for direct unit testing.
function parseHelperEventLine(line) {
  if (typeof line !== 'string' || line.trim() === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed.event === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function createWindowsWallpaperController(options = {}) {
  const {
    store,
    spawnFn = require('child_process').spawn,
    logWarn = console.warn.bind(console),
    logError = console.error.bind(console),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    heartbeatIntervalMs = HELPER_HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs = HELPER_HEARTBEAT_TIMEOUT_MS,
    attachRetryDelayMs = ATTACH_RETRY_DELAY_MS,
    crashLoopThreshold = CRASH_LOOP_THRESHOLD,
    crashLoopHealthyUptimeMs = CRASH_LOOP_HEALTHY_UPTIME_MS,
    detachGraceMs = DETACH_GRACE_MS,
    getHwnd, // () => hwnd number for the current main window, or null
    onDegrade, // () => void, called when wallpaper mode is given up entirely
    onReattachNeeded, // () => void, called when the window must be rebuilt + re-attached
    // (mode) => void for the desktop architecture reported by `attached` events
    // ('classic' = Win10/early Win11 WorkerW sibling, 'raised' = Win11 24H2+ Progman child).
    onAttachMode,
    // (event) => void for helper mouse events (mousemove/mousedown/mouseup in 96-DPI
    // virtualized screen pixels — the helper is DPI-unaware, which matches Electron's DIP
    // space; see the helper's mouse_forward.rs). The main process injects these into the
    // renderer via webContents.sendInputEvent — posted WM_MOUSEMOVE cannot be used because
    // Chromium's TrackMouseEvent tears the hover state back down between every forwarded move
    // (the real cursor sits above us on the desktop icon layer).
    onMouseInput,
  } = options;

  let helperProcess = null;
  let attached = false;
  let attaching = false;
  let degraded = false;
  let lastEventAt = 0;
  let attachedAt = 0;
  let heartbeatTimer = null;
  let reattachTimer = null;
  let healthyTimer = null;

  function getFailureCount() {
    const stored = store.get(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY);
    return typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
  }

  function recordFailure() {
    const count = getFailureCount() + 1;
    store.set(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY, count);
    return count;
  }

  function resetFailureCount() {
    if (getFailureCount() !== 0) {
      store.set(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY, 0);
    }
  }

  function stopHeartbeatMonitor() {
    if (heartbeatTimer) {
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeatMonitor() {
    stopHeartbeatMonitor();
    heartbeatTimer = setIntervalFn(() => {
      if (!helperProcess) {
        return;
      }
      // Covers both a resident helper that stopped talking and one that never managed to emit
      // its first `attached` event (hung startup) — the watchdog must not be gated on attached.
      if (Date.now() - lastEventAt > heartbeatTimeoutMs) {
        logWarn('[WallpaperWin] helper heartbeat timeout, killing and re-attaching');
        killHelper();
        // A hung session never proved itself healthy either; count it toward the crash-loop
        // breaker or a repeatedly-hanging helper would respawn forever without degrading.
        // killHelper drops the reference first, so the late exit event cannot double-count.
        if (!noteFailure()) {
          scheduleReattach();
        }
      }
    }, heartbeatIntervalMs);
    if (typeof heartbeatTimer?.unref === 'function') {
      heartbeatTimer.unref();
    }
  }

  function killHelper() {
    if (!helperProcess) {
      return;
    }
    const child = helperProcess;
    helperProcess = null;
    attached = false;
    attaching = false;
    stopHeartbeatMonitor();
    stopHealthyReset();
    try {
      child.kill();
    } catch {
      // already dead
    }
  }

  function handleFatal(message) {
    if (degraded) {
      return;
    }
    killHelper();
    if (noteFailure()) {
      return;
    }
    logWarn(`[WallpaperWin] fatal helper problem (${message}), will re-attach`);
    scheduleReattach();
  }

  // Records one failed helper session and trips the degrade latch at the threshold (clears
  // wallpaper_mode and hands recovery to onDegrade). Returns true when wallpaper mode was
  // given up, so the caller stops scheduling its own recovery.
  function noteFailure() {
    if (recordFailure() >= crashLoopThreshold) {
      degraded = true;
      logError('[WallpaperWin] repeated helper failures, disabling wallpaper mode');
      store.set(WALLPAPER_MODE_SETTING_KEY, false);
      resetFailureCount();
      onDegrade?.();
      return true;
    }
    return false;
  }

  function stopHealthyReset() {
    if (healthyTimer) {
      clearTimeoutFn(healthyTimer);
      healthyTimer = null;
    }
  }

  function scheduleHealthyReset() {
    stopHealthyReset();
    healthyTimer = setTimeoutFn(() => {
      healthyTimer = null;
      if (helperProcess && attached && Date.now() - attachedAt >= crashLoopHealthyUptimeMs) {
        resetFailureCount();
      }
    }, crashLoopHealthyUptimeMs);
    if (typeof healthyTimer?.unref === 'function') {
      healthyTimer.unref();
    }
  }

  function scheduleReattach() {
    if (degraded || reattachTimer) {
      return;
    }
    reattachTimer = setTimeoutFn(() => {
      reattachTimer = null;
      attach();
    }, attachRetryDelayMs);
    if (typeof reattachTimer?.unref === 'function') {
      reattachTimer.unref();
    }
  }

  function handleHelperEvent(event) {
    lastEventAt = Date.now();
    switch (event.event) {
      case 'attached':
        attached = true;
        attaching = false;
        attachedAt = Date.now();
        scheduleHealthyReset();
        startHeartbeatMonitor();
        if (typeof event.mode === 'string') {
          onAttachMode?.(event.mode);
        }
        break;
      case 'heartbeat':
        break;
      // Mouse reports are high frequency but never fatal; they double as liveness evidence
      // because handleHelperEvent refreshes lastEventAt before this switch.
      case 'mousemove':
      case 'mousedown':
      case 'mouseup':
      case 'mousewheel':
        onMouseInput?.(event);
        break;
      // The helper re-attaches on its own; these are informational unless it reports an error.
      case 'workerw-destroyed':
      case 'explorer-restarted':
      case 'reasserted':
      case 'moved':
      case 'detached':
        break;
      case 'error':
        if (attached) {
          // The structured `kind` is the contract for the window-destroyed case: the Folia
          // window was destroyed together with its WorkerW, so the main process must rebuild
          // it — a plain re-attach of the same hwnd would be pointless. Either way the helper
          // has nothing useful left to do.
          attached = false;
          if (event.kind === 'window-destroyed') {
            killHelper();
            onReattachNeeded?.();
          } else {
            handleFatal(event.message || 'helper error');
          }
        } else {
          handleFatal(event.message || 'helper error before attach');
        }
        break;
      default:
        break;
    }
  }

  function spawnHelper(helperPath, { forwardMouse, zguard }) {
    const hwnd = getHwnd();
    if (hwnd === null || hwnd === undefined) {
      return 'no-window';
    }
    const args = ['attach', '--hwnd', String(hwnd)];
    if (forwardMouse) {
      args.push('--forward-mouse');
    }
    if (zguard) {
      args.push('--zguard');
    }
    attaching = true;
    lastEventAt = Date.now();
    let child;
    try {
      child = spawnFn(helperPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      // spawn throws synchronously on invalid arguments (the async ENOENT case arrives via the
      // 'error' event instead); without this the attach latch would stay set and every future
      // attach() would return 'already' forever.
      attaching = false;
      logError('[WallpaperWin] helper spawn threw', err);
      handleFatal(String(err?.code || err));
      return 'failed';
    }
    helperProcess = child;
    // Watch the spawn itself: if the helper never emits `attached`, the heartbeat watchdog
    // still reaps it (see startHeartbeatMonitor).
    startHeartbeatMonitor();

    let buffered = '';
    child.stdout?.on('data', (chunk) => {
      // Same ownership rule as the exit handler: once killHelper/detach has dropped the
      // reference, residual stdout from the superseded child must not reach the session —
      // a late error line would otherwise be misattributed as a failure of the current
      // (possibly already replaced) session and pollute the crash-loop counter.
      if (helperProcess !== child) {
        return;
      }
      buffered += chunk.toString();
      let newlineIndex = buffered.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffered.slice(0, newlineIndex);
        buffered = buffered.slice(newlineIndex + 1);
        const event = parseHelperEventLine(line);
        if (event) {
          handleHelperEvent(event);
        }
        newlineIndex = buffered.indexOf('\n');
      }
    });
    child.stderr?.on('data', (chunk) => {
      logWarn(`[WallpaperWin] helper stderr: ${chunk.toString().trim()}`);
    });
    child.on('error', (err) => {
      if (helperProcess !== child) {
        return;
      }
      logError('[WallpaperWin] helper spawn failed', err);
      helperProcess = null;
      attaching = false;
      handleFatal(String(err?.code || err));
    });
    child.on('exit', (code) => {
      // killHelper()/detach() drop the process reference BEFORE the async exit event fires, so
      // an exit from a killed or superseded child must not touch the current session: it would
      // otherwise null the freshly spawned helper, stop its heartbeat watchdog, and schedule a
      // duplicate attach (two helpers on the same hwnd → double-injected mouse input). This
      // also covers intentional detaches: the detached child's late exit finds the reference
      // gone and cannot schedule a re-attach of the just-restored window.
      if (helperProcess !== child) {
        return;
      }
      const wasAttached = attached;
      helperProcess = null;
      attached = false;
      attaching = false;
      stopHeartbeatMonitor();
      stopHealthyReset();
      if (degraded) {
        return; // degrade path owns recovery now
      }
      logWarn(`[WallpaperWin] helper exited (code ${code}, attached ${wasAttached})`);
      // Crash-loop accounting: any session that did not stay attached past the healthy-uptime
      // window counts as a failure — including helpers that die before the first `attached`
      // event (e.g. a corrupted binary exiting instantly), which would otherwise respawn
      // forever without ever reaching the degrade latch.
      const sessionHealthy = wasAttached && Date.now() - attachedAt >= crashLoopHealthyUptimeMs;
      if (!sessionHealthy && noteFailure()) {
        return;
      }
      scheduleReattach();
    });
    return 'spawned';
  }

  // Attach (or re-attach) the current main window. Idempotent: a running attach is a no-op.
  function attach() {
    // Defense in depth for scheduled re-attaches: if the user turned wallpaper mode off while
    // a retry was pending, the mode must stay off (the exit handler already skips intentional
    // detaches; this also covers a heartbeat-kill racing the disable toggle).
    if (store.get(WALLPAPER_MODE_SETTING_KEY) !== true) {
      return 'disabled';
    }
    // The degrade latch only exists to stop automatic retries while the mode is off. The
    // Windows path never relaunches the process, so a user re-enable after a degrade (the
    // store is back to true) must start a fresh crash-loop watch instead of being blocked
    // until the next app restart.
    if (degraded) {
      degraded = false;
    }
    if (attaching || helperProcess) {
      return 'already';
    }
    const hwnd = getHwnd();
    if (hwnd === null || hwnd === undefined) {
      return 'no-window';
    }
    const helperPath = options.helperPath?.();
    if (!helperPath) {
      logWarn('[WallpaperWin] helper binary missing, cannot enable wallpaper mode');
      return 'missing';
    }
    // Defaults match the renderer settings: both toggles default to on.
    const forwardMouse = store.get('wallpaper_forward_mouse') !== false;
    const zguard = store.get('wallpaper_zguard') !== false;
    const result = spawnHelper(helperPath, { forwardMouse, zguard });
    if (result === 'spawned') {
      // Recovery from repeated failures starts optimistic; the failure counter only grows when
      // a session dies young, so also schedule the healthy reset from here.
      scheduleHealthyReset();
    }
    return result;
  }

  // Detach: ask the helper to restore the window, then kill it after a grace period.
  function detach() {
    if (degraded) {
      return;
    }
    stopHeartbeatMonitor();
    stopHealthyReset();
    if (reattachTimer) {
      clearTimeoutFn(reattachTimer);
      reattachTimer = null;
    }
    const child = helperProcess;
    // Dropping the reference makes the child's late exit event a no-op (the exit handler
    // compares against helperProcess), so no re-attach can be scheduled for an intentional
    // detach — the just-restored window must stay a normal top-level window. The attach latch
    // must be reset here too: a detach racing a still-unconfirmed spawn (no `attached` yet)
    // would otherwise leave `attaching` stuck true and every future attach() a silent 'already'.
    helperProcess = null;
    attached = false;
    attaching = false;
    if (!child) {
      return;
    }
    try {
      child.stdin?.write('detach\n');
    } catch {
      // helper already gone
    }
    setTimeoutFn(() => {
      try {
        child.kill();
      } catch {
        // already dead
      }
    }, detachGraceMs);
  }

  return {
    attach,
    detach,
    killHelper,
    handleHelperEvent,
    parseHelperEventLine,
    isAttached: () => attached,
    isDegraded: () => degraded,
    getFailureCount,
  };
}

module.exports = {
  WALLPAPER_MODE_SETTING_KEY,
  WALLPAPER_WINDOWS_FAILURE_COUNT_KEY,
  parseHelperEventLine,
  createWindowsWallpaperController,
};
