import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/wallpaperWatchdog.test.ts
// Locks down the desktop-wallpaper watchdog: trigger point 1 recovery (window build failure /
// renderer crash), the captured-pid parent liveness probe (trigger point 2), and the crash-loop
// breaker. The module is dependency-injected so none of this needs an Electron runtime.

const require = createRequire(import.meta.url);
const {
  WALLPAPER_MODE_SETTING_KEY,
  WALLPAPER_WRAPPED_CRASH_COUNT_KEY,
  isWallpaperModeEnabled,
  isWallpaperWrapped,
  isX11WallpaperMode,
  createWallpaperWatchdog,
} = require('../../../electron/wallpaper/wallpaperWatchdog.cjs') as {
  WALLPAPER_MODE_SETTING_KEY: string;
  WALLPAPER_WRAPPED_CRASH_COUNT_KEY: string;
  isWallpaperModeEnabled: (store: StoreLike) => boolean;
  isWallpaperWrapped: (env: Record<string, string | undefined>) => boolean;
  isX11WallpaperMode: (state: { platform: string; env: Record<string, string | undefined>; store: StoreLike }) => boolean;
  createWallpaperWatchdog: (options: WatchdogOptions) => Watchdog;
};

interface StoreLike {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
}

type Env = Record<string, string | undefined>;

interface SpawnOptions {
  env: Record<string, string>;
  detached: boolean;
  stdio: string;
}
interface SpawnCall {
  cmd: string;
  args: string[];
  opts: SpawnOptions;
}

interface WatchdogOptions {
  store: StoreLike;
  env?: Env;
  spawnFn: (cmd: string, args: string[], opts: SpawnOptions) => EventEmitter;
  execPath?: () => string;
  argv?: () => string[];
  getPpid?: () => number;
  exit?: (code: number) => void;
  killFn?: (pid: number, signal: number) => void;
  logWarn?: (...args: unknown[]) => void;
  logError?: (...args: unknown[]) => void;
  setIntervalFn?: (fn: () => void, ms: number) => { id: number; unref: () => void };
  clearIntervalFn?: (handle: { id: number }) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => { id: number; unref: () => void };
  clearTimeoutFn?: (handle: { id: number }) => void;
  probeIntervalMs?: number;
  healthyUptimeMs?: number;
  crashThreshold?: number;
}

interface Watchdog {
  recoverToNormalWindow: () => void;
  relaunchSelfNormal: () => void;
  handleWindowBuildFailure: () => boolean;
  handleRendererGone: (details: { reason?: string }) => boolean;
  startParentLivenessProbe: (options?: { parentPid?: number }) => { stop: () => void };
  getWrappedCrashCount: () => number;
  recordWrappedLaunch: () => number;
  resetWrappedCrashCount: () => void;
  shouldDisableWallpaperMode: () => boolean;
}

const createMemoryStorage = (): StoreLike => {
  const data = new Map<string, unknown>();
  return {
    get: (key) => data.get(key),
    set: (key, value) => { data.set(key, value); },
    delete: (key) => { data.delete(key); },
  };
};

// Deterministic clock: advance(ms) fires due timeouts once and due intervals the right number of
// times, so probe/breaker timing is asserted without real timers.
const createFakeClock = () => {
  let now = 0;
  let nextId = 1;
  const intervals: Array<{ id: number; fn: () => void; ms: number; last: number }> = [];
  const timeouts: Array<{ id: number; fn: () => void; firedAt: number }> = [];

  const setIntervalFn = (fn: () => void, ms: number) => {
    const entry = { id: nextId++, fn, ms, last: now };
    intervals.push(entry);
    return { id: entry.id, unref: () => {} };
  };
  const clearIntervalFn = (handle: { id: number }) => {
    const index = intervals.findIndex((entry) => entry.id === handle.id);
    if (index >= 0) intervals.splice(index, 1);
  };
  const setTimeoutFn = (fn: () => void, ms: number) => {
    const entry = { id: nextId++, fn, firedAt: now + ms };
    timeouts.push(entry);
    return { id: entry.id, unref: () => {} };
  };
  const clearTimeoutFn = (handle: { id: number }) => {
    const index = timeouts.findIndex((entry) => entry.id === handle.id);
    if (index >= 0) timeouts.splice(index, 1);
  };

  const advance = (ms: number) => {
    now += ms;
    for (const timeout of [...timeouts]) {
      if (now >= timeout.firedAt) {
        timeout.fn();
        const index = timeouts.findIndex((entry) => entry.id === timeout.id);
        if (index >= 0) timeouts.splice(index, 1);
      }
    }
    for (const interval of [...intervals]) {
      while (now - interval.last >= interval.ms) {
        interval.last += interval.ms;
        interval.fn();
      }
    }
  };

  return { setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, advance };
};

const createHarness = (overrides: Partial<WatchdogOptions> = {}) => {
  const store = createMemoryStorage();
  const env: Env = {};
  const spawnCalls: SpawnCall[] = [];
  const exits: number[] = [];
  const child = new EventEmitter();

  const watchdog = createWallpaperWatchdog({
    store,
    env,
    spawnFn: (cmd, args, opts) => { spawnCalls.push({ cmd, args, opts }); return child; },
    execPath: () => '/usr/bin/folia',
    argv: () => ['--flag'],
    getPpid: () => 100,
    exit: (code) => { exits.push(code); },
    killFn: () => {},
    ...overrides,
  });

  return { watchdog, store, env, spawnCalls, exits, child };
};

describe('wallpaper mode predicates', () => {
  it('isWallpaperWrapped recognizes the wrapper marker only', () => {
    expect(isWallpaperWrapped({ FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1' })).toBe(true);
    expect(isWallpaperWrapped({})).toBe(false);
    expect(isWallpaperWrapped({ FOLIA_WRAPPED_BY_WINDOWTOLAYER: '0' })).toBe(false);
    expect(isWallpaperWrapped({ FOLIA_WRAPPED_BY_WINDOWTOLAYER: 'true' })).toBe(false);
  });

  it('isWallpaperModeEnabled reads the stored boolean exactly', () => {
    const store = createMemoryStorage();
    expect(isWallpaperModeEnabled(store)).toBe(false);
    store.set(WALLPAPER_MODE_SETTING_KEY, true);
    expect(isWallpaperModeEnabled(store)).toBe(true);
    store.set(WALLPAPER_MODE_SETTING_KEY, 'true');
    expect(isWallpaperModeEnabled(store)).toBe(false); // strings are not normalized here
  });

  it('isX11WallpaperMode requires linux + no WAYLAND_DISPLAY + enabled', () => {
    const store = createMemoryStorage();
    store.set(WALLPAPER_MODE_SETTING_KEY, true);
    expect(isX11WallpaperMode({ platform: 'linux', env: {}, store })).toBe(true);
    expect(isX11WallpaperMode({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, store })).toBe(false);
    expect(isX11WallpaperMode({ platform: 'win32', env: {}, store })).toBe(false);
    const offStore = createMemoryStorage();
    expect(isX11WallpaperMode({ platform: 'linux', env: {}, store: offStore })).toBe(false);
  });
});

describe('watchdog trigger point 1 — window build failure', () => {
  it('recovers while wrapped: clears the mode, relaunches a plain process, exits on spawn', () => {
    const { watchdog, store, spawnCalls, exits, child } = createHarness({
      env: { FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1' },
    });

    expect(watchdog.handleWindowBuildFailure()).toBe(true);
    expect(store.get(WALLPAPER_MODE_SETTING_KEY)).toBe(false);
    expect(spawnCalls).toHaveLength(1);

    const { opts } = spawnCalls[0];
    expect(opts.env.FOLIA_RELAUNCH).toBe('1');
    expect(opts.env.WAYLAND_SOCKET).toBeUndefined();
    expect(opts.env.FOLIA_WRAPPED_BY_WINDOWTOLAYER).toBeUndefined();
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');
    expect(exits).toHaveLength(0); // only after the child actually spawns

    child.emit('spawn');
    expect(exits).toEqual([0]);
  });

  it('is a no-op when not wrapped', () => {
    const { watchdog, store, spawnCalls } = createHarness({ env: {} });

    expect(watchdog.handleWindowBuildFailure()).toBe(false);
    expect(store.get(WALLPAPER_MODE_SETTING_KEY)).toBeUndefined();
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('watchdog trigger point 1 — renderer crash', () => {
  it('recovers on a wrapped renderer crash', () => {
    const { watchdog, spawnCalls } = createHarness({
      env: { FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1' },
    });

    expect(watchdog.handleRendererGone({ reason: 'crashed' })).toBe(true);
    expect(spawnCalls).toHaveLength(1);
  });

  it('ignores non-crash renderer terminations', () => {
    const { watchdog, spawnCalls } = createHarness({
      env: { FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1' },
    });

    expect(watchdog.handleRendererGone({ reason: 'oom' })).toBe(false);
    expect(watchdog.handleRendererGone({ reason: 'killed' })).toBe(false);
    expect(watchdog.handleRendererGone({ reason: 'launch-failed' })).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  it('ignores a renderer crash when not wrapped', () => {
    const { watchdog, spawnCalls } = createHarness({ env: {} });

    expect(watchdog.handleRendererGone({ reason: 'crashed' })).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('relaunchSelfNormal', () => {
  it('spawns with the relaunch marker and the wrapper env stripped, unrelated vars preserved', () => {
    const { watchdog, spawnCalls } = createHarness({
      env: { FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1', WAYLAND_SOCKET: '9', HOME: '/home/u' },
    });

    watchdog.relaunchSelfNormal();
    expect(spawnCalls).toHaveLength(1);
    const { cmd, args, opts } = spawnCalls[0];
    expect(cmd).toBe('/usr/bin/folia');
    expect(args).toEqual(['--flag']);
    expect(opts.env.FOLIA_RELAUNCH).toBe('1');
    expect(opts.env.WAYLAND_SOCKET).toBeUndefined();
    expect(opts.env.FOLIA_WRAPPED_BY_WINDOWTOLAYER).toBeUndefined();
    expect(opts.env.HOME).toBe('/home/u');
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');
  });

  it('does not mutate the process environment it was given', () => {
    const env: Env = { FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1', WAYLAND_SOCKET: '9' };
    const { watchdog } = createHarness({ env });

    watchdog.relaunchSelfNormal();
    expect(env.FOLIA_WRAPPED_BY_WINDOWTOLAYER).toBe('1');
    expect(env.WAYLAND_SOCKET).toBe('9');
  });

  it('stays running when the relaunch child fails to spawn', () => {
    // The module binds console.error at watchdog creation, so the spy must be installed first.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { watchdog, exits, child } = createHarness({ env: {} });

    watchdog.relaunchSelfNormal();
    child.emit('error', new Error('ENOENT'));
    expect(exits).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('exits the current process once the relaunch child has spawned', () => {
    const { watchdog, exits, child } = createHarness({ env: {} });

    watchdog.relaunchSelfNormal();
    child.emit('spawn');
    expect(exits).toEqual([0]);
  });
});

describe('recoverToNormalWindow', () => {
  it('clears the stored mode before relaunching', () => {
    const { watchdog, store, spawnCalls } = createHarness({ env: {} });
    const order: string[] = [];
    const originalSet = store.set.bind(store);
    store.set = (key, value) => { order.push(`set:${key}`); originalSet(key, value); };

    watchdog.recoverToNormalWindow();
    expect(order[0]).toBe(`set:${WALLPAPER_MODE_SETTING_KEY}`);
    expect(spawnCalls).toHaveLength(1);
  });

  it('is idempotent when multiple watchdog triggers arrive together', () => {
    const { watchdog, spawnCalls } = createHarness({
      env: { FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1' },
    });

    expect(watchdog.handleRendererGone({ reason: 'crashed' })).toBe(true);
    expect(watchdog.handleWindowBuildFailure()).toBe(false);
    expect(spawnCalls).toHaveLength(1);
  });
});

describe('parent liveness probe (trigger point 2)', () => {
  const clockFns = (clock: ReturnType<typeof createFakeClock>) => ({
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  it('recovers when the parent pid changed — the process was reparented after wtl died', () => {
    const clock = createFakeClock();
    let ppid = 100;
    const { watchdog, spawnCalls } = createHarness({
      getPpid: () => ppid,
      probeIntervalMs: 2000,
      ...clockFns(clock),
    });

    watchdog.startParentLivenessProbe(); // parentPid captured once: 100
    ppid = 999; // reparented to a subreaper
    clock.advance(2000);
    expect(spawnCalls).toHaveLength(1);
  });

  it('recovers when the captured parent pid raises ESRCH', () => {
    const clock = createFakeClock();
    let gone = false;
    const { watchdog, spawnCalls } = createHarness({
      getPpid: () => 100,
      killFn: () => {
        if (gone) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      },
      probeIntervalMs: 2000,
      ...clockFns(clock),
    });

    watchdog.startParentLivenessProbe({ parentPid: 100 });
    clock.advance(2000); // parent alive → no recovery
    expect(spawnCalls).toHaveLength(0);

    gone = true;
    clock.advance(2000);
    expect(spawnCalls).toHaveLength(1);
  });

  it('ignores EPERM (parent exists but is not ours)', () => {
    const clock = createFakeClock();
    const { watchdog, spawnCalls } = createHarness({
      getPpid: () => 100,
      killFn: () => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); },
      probeIntervalMs: 2000,
      ...clockFns(clock),
    });

    watchdog.startParentLivenessProbe({ parentPid: 100 });
    clock.advance(6000);
    expect(spawnCalls).toHaveLength(0);
  });

  it('keeps probing silently while the parent is alive', () => {
    const clock = createFakeClock();
    const { watchdog, spawnCalls } = createHarness({
      getPpid: () => 100,
      killFn: () => {},
      probeIntervalMs: 2000,
      ...clockFns(clock),
    });

    watchdog.startParentLivenessProbe({ parentPid: 100 });
    clock.advance(10_000); // 5 ticks
    expect(spawnCalls).toHaveLength(0);
  });

  it('stop() prevents further probes', () => {
    const clock = createFakeClock();
    const { watchdog, spawnCalls } = createHarness({
      getPpid: () => 100,
      killFn: () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); },
      probeIntervalMs: 2000,
      ...clockFns(clock),
    });

    const probe = watchdog.startParentLivenessProbe({ parentPid: 100 });
    probe.stop();
    clock.advance(10_000);
    expect(spawnCalls).toHaveLength(0);
  });
});

describe('crash-loop breaker', () => {
  const clockFns = (clock: ReturnType<typeof createFakeClock>) => ({
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  it('disables wallpaper mode after crashThreshold consecutive wrapped launches', () => {
    const clock = createFakeClock();
    const { watchdog } = createHarness({ ...clockFns(clock), healthyUptimeMs: 60_000, crashThreshold: 3 });

    expect(watchdog.getWrappedCrashCount()).toBe(0);
    expect(watchdog.recordWrappedLaunch()).toBe(1);
    expect(watchdog.recordWrappedLaunch()).toBe(2);
    expect(watchdog.recordWrappedLaunch()).toBe(3);
    expect(watchdog.shouldDisableWallpaperMode()).toBe(true);
  });

  it('resets the counter once a session survives healthyUptimeMs', () => {
    const clock = createFakeClock();
    const { watchdog } = createHarness({ ...clockFns(clock), healthyUptimeMs: 60_000, crashThreshold: 3 });

    watchdog.recordWrappedLaunch();
    watchdog.recordWrappedLaunch();
    expect(watchdog.shouldDisableWallpaperMode()).toBe(false); // 2 < 3

    clock.advance(60_000); // healthy uptime reached → count cleared
    expect(watchdog.getWrappedCrashCount()).toBe(0);
    expect(watchdog.shouldDisableWallpaperMode()).toBe(false);
  });

  it('resetWrappedCrashCount zeroes the counter and is a no-op when already zero', () => {
    const clock = createFakeClock();
    const { watchdog, store } = createHarness({ ...clockFns(clock) });

    watchdog.resetWrappedCrashCount();
    expect(store.get(WALLPAPER_WRAPPED_CRASH_COUNT_KEY)).toBeUndefined(); // no write when already 0

    watchdog.recordWrappedLaunch();
    expect(watchdog.getWrappedCrashCount()).toBe(1);
    watchdog.resetWrappedCrashCount();
    expect(watchdog.getWrappedCrashCount()).toBe(0);
    expect(store.get(WALLPAPER_WRAPPED_CRASH_COUNT_KEY)).toBe(0);
  });
});
