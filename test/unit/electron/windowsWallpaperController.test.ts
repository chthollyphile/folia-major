import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/windowsWallpaperController.test.ts
// Locks down the Windows wallpaper helper controller: JSONL parsing, attach/detach lifecycle,
// the heartbeat watchdog, re-attach scheduling, and the crash-loop breaker (degrade to a normal
// window). Everything side-effectful is injected, so none of this needs a Windows host or a
// real helper binary.

const require = createRequire(import.meta.url);
const {
  WALLPAPER_MODE_SETTING_KEY,
  WALLPAPER_WINDOWS_FAILURE_COUNT_KEY,
  parseHelperEventLine,
  createWindowsWallpaperController,
} = require('../../../electron/windowsWallpaperController.cjs') as {
  WALLPAPER_MODE_SETTING_KEY: string;
  WALLPAPER_WINDOWS_FAILURE_COUNT_KEY: string;
  parseHelperEventLine: (line: unknown) => HelperEvent | null;
  createWindowsWallpaperController: (options: ControllerOptions) => Controller;
};

interface HelperEvent {
  event: string;
  [key: string]: unknown;
}

interface StoreLike {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}

interface ControllerOptions {
  store: StoreLike;
  spawnFn?: (cmd: string, args: string[], opts: { stdio: string[] }) => FakeChild;
  logWarn?: (...args: unknown[]) => void;
  logError?: (...args: unknown[]) => void;
  helperPath?: () => string | null;
  getHwnd?: () => number | null;
  onDegrade?: () => void;
  onReattachNeeded?: () => void;
  onMouseInput?: (event: HelperEvent) => void;
}

interface Controller {
  attach: () => string;
  detach: () => void;
  killHelper: () => void;
  handleHelperEvent: (event: HelperEvent) => void;
  isAttached: () => boolean;
  isDegraded: () => boolean;
  getFailureCount: () => number;
}

function createFakeStore(initial: Record<string, unknown> = {}): StoreLike & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}

// A fake helper child: stdout/stderr are real streams so the JSONL splitter can be exercised,
// stdin records what was written (the `detach` command), exit events are manual.
interface FakeChild extends EventEmitter {
  stdout: Writable;
  stderr: Writable;
  stdin: Writable;
  stdinWrites: string[];
  killed: boolean;
  kill: () => boolean;
  emitExit: (code: number) => void;
  writeStdout: (text: string) => void;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.stderr = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.stdinWrites = [];
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      child.stdinWrites.push(chunk.toString());
      cb();
    },
  });
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.emitExit = (code: number) => {
    child.emit('exit', code);
  };
  child.writeStdout = (text: string) => {
    child.stdout.emit('data', Buffer.from(text));
  };
  return child;
}

interface Harness {
  controller: Controller;
  children: FakeChild[];
  spawnArgs: string[][];
  store: StoreLike;
  onDegrade: ReturnType<typeof vi.fn>;
  onReattachNeeded: ReturnType<typeof vi.fn>;
}

function createHarness(overrides: Partial<ControllerOptions> = {}): Harness {
  const children: FakeChild[] = [];
  const spawnArgs: string[][] = [];
  const onDegrade = vi.fn();
  const onReattachNeeded = vi.fn();
  const store: StoreLike = overrides.store ?? createFakeStore({ [WALLPAPER_MODE_SETTING_KEY]: true });
  const controller = createWindowsWallpaperController({
    store,
    helperPath: () => 'C:\\fake\\folia-wallpaper-helper.exe',
    getHwnd: () => 1234,
    onDegrade,
    onReattachNeeded,
    ...overrides,
    spawnFn: overrides.spawnFn ?? ((cmd: string, args: string[], opts: { stdio: string[] }) => {
      void cmd;
      void opts;
      const child = createFakeChild();
      children.push(child);
      spawnArgs.push(args);
      return child;
    }),
  });
  return { controller, children, spawnArgs, store, onDegrade, onReattachNeeded };
}

describe('parseHelperEventLine', () => {
  it('parses well-formed helper events', () => {
    expect(parseHelperEventLine('{"event":"attached","hwnd":1,"workerw":2,"mode":"classic"}')).toEqual({
      event: 'attached',
      hwnd: 1,
      workerw: 2,
      mode: 'classic',
    });
    expect(parseHelperEventLine('{"event":"heartbeat"}')).toEqual({ event: 'heartbeat' });
  });

  it('returns null for malformed or non-event lines', () => {
    expect(parseHelperEventLine('not json')).toBeNull();
    expect(parseHelperEventLine('{"nope":1}')).toBeNull();
    expect(parseHelperEventLine('')).toBeNull();
    expect(parseHelperEventLine(null)).toBeNull();
    expect(parseHelperEventLine(42)).toBeNull();
  });
});

describe('attach lifecycle', () => {
  it('spawns the helper with the parsed hwnd and default-on flags', () => {
    const { controller, spawnArgs } = createHarness();
    expect(controller.attach()).toBe('spawned');
    expect(spawnArgs[0]).toEqual(['attach', '--hwnd', '1234', '--forward-mouse', '--zguard']);
  });

  it('passes --forward-mouse / --zguard only when enabled in the store', () => {
    const { controller, spawnArgs } = createHarness({
      store: createFakeStore({
        [WALLPAPER_MODE_SETTING_KEY]: true,
        wallpaper_forward_mouse: false,
        wallpaper_zguard: true,
      }),
    });
    controller.attach();
    expect(spawnArgs[0]).toContain('--zguard');
    expect(spawnArgs[0]).not.toContain('--forward-mouse');
  });

  it('reports missing helper without spawning', () => {
    const { controller, children } = createHarness({ helperPath: () => null });
    expect(controller.attach()).toBe('missing');
    expect(children).toHaveLength(0);
  });

  it('marks itself attached on the attached event', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached","hwnd":1234,"workerw":9,"mode":"raised"}\n');
    expect(controller.isAttached()).toBe(true);
  });

  it('feeds partial stdout chunks through the JSONL splitter', () => {
    const { controller, children } = createHarness();
    controller.attach();
    // One event split across two chunks, followed by a non-event line to ignore.
    children[0].writeStdout('{"event":"atta');
    children[0].writeStdout('ched","mode":"classic"}\ngarbage\n');
    expect(controller.isAttached()).toBe(true);
  });

  it('refuses to attach when wallpaper_mode is not enabled', () => {
    const { controller, children } = createHarness({
      store: createFakeStore({ [WALLPAPER_MODE_SETTING_KEY]: false }),
    });
    expect(controller.attach()).toBe('disabled');
    expect(children).toHaveLength(0);
  });

  it('detach writes the detach command and forgets the process', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    controller.detach();
    expect(children[0].stdinWrites.join('')).toContain('detach');
    expect(controller.isAttached()).toBe(false);
  });

  it('detach during an unconfirmed spawn resets the attach latch (re-enable still works)', () => {
    const { controller, children } = createHarness();
    controller.attach();
    // Detach races the helper before it emitted `attached` (e.g. the user toggles the mode
    // off within the probe window): the latch must not stay stuck or every future attach()
    // would be a silent 'already'.
    controller.detach();
    expect(controller.attach()).toBe('spawned');
    expect(children).toHaveLength(2);
  });

  it('stdout from a superseded child is ignored (no false failure accounting)', () => {
    const { controller, children, store } = createHarness();
    controller.attach();
    controller.killHelper();
    controller.attach();
    // The killed child flushes a late error after the reference was dropped: it must not
    // reach handleHelperEvent as a failure of the replacement session.
    children[0].writeStdout('{"event":"error","message":"late boom"}\n');
    expect(store.get(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY)).toBeUndefined();
    expect(controller.isDegraded()).toBe(false);
    // The replacement session is unaffected and still attached-capable.
    children[1].writeStdout('{"event":"attached","mode":"classic"}\n');
    expect(controller.isAttached()).toBe(true);
  });
});

describe('watchdog state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a re-attach when the helper exits young', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    children[0].emitExit(1);
    expect(children).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(children).toHaveLength(2);
  });

  it('does not re-attach after an intentional detach (the window must stay normal)', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    controller.detach();
    // The helper restores the window and exits on its own; that exit closes the session
    // instead of scheduling a re-attach (a re-attach would weld the window back into the
    // WorkerW ~2s after the user turned the mode off).
    children[0].emitExit(0);
    vi.advanceTimersByTime(30_000);
    expect(children).toHaveLength(1);
  });

  it('a superseded child exit must not clobber the new session or spawn a duplicate', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    // Mirrors the synchronous main.cjs pattern (killHelper(); attach();) used by the
    // helper-flag save-settings path, rebuild, and recreate: killHelper drops the old
    // reference before its async exit event fires.
    controller.killHelper();
    controller.attach();
    expect(children).toHaveLength(2);
    // The late exit of the killed child must be ignored entirely: no third spawn, no state
    // clobbering of the freshly spawned helper.
    children[0].emitExit(1);
    vi.advanceTimersByTime(3000);
    expect(children).toHaveLength(2);
    // The replacement session is still fully functional: it attaches and its heartbeat
    // watchdog is armed (it gets reaped when it goes silent).
    children[1].writeStdout('{"event":"attached"}\n');
    expect(controller.isAttached()).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(children[1].killed).toBe(true);
  });

  it('degrades when helpers die young without ever attaching (no infinite respawn)', () => {
    const { controller, children, store, onDegrade } = createHarness();
    controller.attach();
    for (let died = 1; died <= 3; died += 1) {
      const child = children[children.length - 1];
      child.emitExit(1); // exits before any stdout event (e.g. corrupted binary)
      vi.advanceTimersByTime(3000); // covers the 2s re-attach delay
    }
    expect(children).toHaveLength(3);
    expect(store.get(WALLPAPER_MODE_SETTING_KEY)).toBe(false);
    expect(onDegrade).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(children).toHaveLength(3);
  });

  it('keeps prior failures across an attach and resets only after a full healthy window', () => {
    const { controller, children, store } = createHarness({
      store: createFakeStore({
        [WALLPAPER_MODE_SETTING_KEY]: true,
        [WALLPAPER_WINDOWS_FAILURE_COUNT_KEY]: 2,
      }),
    });
    controller.attach();
    children[0].writeStdout('{"event":"attached","hwnd":1234,"workerw":9,"mode":"raised"}\n');
    expect(controller.isAttached()).toBe(true);
    // Attaching alone must NOT clear the counter: a flapping helper (attaches, then dies young,
    // repeatedly) would reset it every cycle and never trip the degrade latch.
    expect(store.get(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY)).toBe(2);
    for (let elapsed = 0; elapsed < 61_000; elapsed += 5000) {
      vi.advanceTimersByTime(5000);
      if (children.length === 1) {
        children[0].writeStdout('{"event":"heartbeat"}\n');
      }
    }
    expect(store.get(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY)).toBe(0);
  });

  it('degrades when helpers attach but die young repeatedly (flapping)', () => {
    const { controller, children, store, onDegrade } = createHarness();
    controller.attach();
    for (let died = 1; died <= 3; died += 1) {
      const child = children[children.length - 1];
      child.writeStdout('{"event":"attached","hwnd":1234,"workerw":9,"mode":"classic"}\n');
      vi.advanceTimersByTime(10_000);
      child.emitExit(1);
      vi.advanceTimersByTime(3000);
    }
    expect(children).toHaveLength(3);
    expect(store.get(WALLPAPER_MODE_SETTING_KEY)).toBe(false);
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it('degrades when helpers repeatedly hang before the first heartbeat', () => {
    const { controller, children, store, onDegrade } = createHarness();
    controller.attach();
    for (let hung = 1; hung <= 3; hung += 1) {
      vi.advanceTimersByTime(20_000); // heartbeat watchdog reaps the silent helper
      vi.advanceTimersByTime(3000); // covers the 2s re-attach delay
    }
    expect(children).toHaveLength(3);
    expect(store.get(WALLPAPER_MODE_SETTING_KEY)).toBe(false);
    expect(onDegrade).toHaveBeenCalledTimes(1);
  });

  it('does not count failures after a healthy session exits', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    // Keep the session healthy past the crash-loop uptime window with heartbeats...
    for (let elapsed = 0; elapsed < 61_000; elapsed += 5000) {
      vi.advanceTimersByTime(5000);
      if (children.length === 1) {
        children[0].writeStdout('{"event":"heartbeat"}\n');
      }
    }
    children[0].emitExit(0);
    vi.advanceTimersByTime(3000);
    expect(children).toHaveLength(2);
    expect(controller.getFailureCount()).toBe(0);
  });

  it('kills and re-attaches when heartbeats stop', () => {
    const { controller, children } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    vi.advanceTimersByTime(20_000);
    expect(children[0].killed).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(children).toHaveLength(2);
  });

  it('kills a helper that never emits attached (hung startup)', () => {
    const { controller, children } = createHarness();
    controller.attach();
    // No events at all: the spawn-time watchdog must still reap it.
    vi.advanceTimersByTime(20_000);
    expect(children[0].killed).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(children).toHaveLength(2);
  });

  it('treats a window-destroyed error as a rebuild request, not a plain re-attach', () => {
    const { controller, children, onReattachNeeded } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    // The structured `kind` is the contract (the message text is not parsed by the controller).
    children[0].writeStdout(
      '{"event":"error","message":"folia window was destroyed together with the WorkerW; the main process must rebuild it","kind":"window-destroyed"}\n'
    );
    expect(controller.isAttached()).toBe(false);
    expect(onReattachNeeded).toHaveBeenCalledTimes(1);
    // The rebuild path is the main process' job; the controller must not spawn in parallel.
    vi.advanceTimersByTime(30_000);
    expect(children).toHaveLength(1);
  });

  it('degrades after three consecutive failures and clears wallpaper_mode', () => {
    const { controller, store, onDegrade } = createHarness();
    controller.attach();
    controller.handleHelperEvent({ event: 'error', message: 'boom 1' });
    controller.handleHelperEvent({ event: 'error', message: 'boom 2' });
    controller.handleHelperEvent({ event: 'error', message: 'boom 3' });
    expect(store.get(WALLPAPER_MODE_SETTING_KEY)).toBe(false);
    expect(onDegrade).toHaveBeenCalledTimes(1);
    expect(controller.isDegraded()).toBe(true);
  });

  it('stops re-attaching once degraded', () => {
    const { controller, children } = createHarness();
    controller.attach();
    controller.handleHelperEvent({ event: 'error', message: 'boom 1' });
    controller.handleHelperEvent({ event: 'error', message: 'boom 2' });
    controller.handleHelperEvent({ event: 'error', message: 'boom 3' });
    const countAfterDegrade = children.length;
    vi.advanceTimersByTime(60_000);
    expect(children).toHaveLength(countAfterDegrade);
  });

  it('re-enabling after a degrade starts a fresh session instead of staying blocked', () => {
    const { controller, children, store } = createHarness();
    controller.attach();
    controller.handleHelperEvent({ event: 'error', message: 'boom 1' });
    controller.handleHelperEvent({ event: 'error', message: 'boom 2' });
    controller.handleHelperEvent({ event: 'error', message: 'boom 3' });
    expect(controller.isDegraded()).toBe(true);
    // The user re-enables the mode (the Windows path never relaunches the process, so the
    // degrade latch must clear on the next explicit attach or the mode could never come back).
    store.set(WALLPAPER_MODE_SETTING_KEY, true);
    expect(controller.attach()).toBe('spawned');
    expect(controller.isDegraded()).toBe(false);
    expect(children).toHaveLength(2);
  });

  it('a synchronously throwing spawn counts as a failure without wedging the attach latch', () => {
    let throwNextSpawn = true;
    const { controller, children, store, onDegrade } = createHarness({
      spawnFn: (cmd, args, opts) => {
        void cmd;
        void args;
        void opts;
        if (throwNextSpawn) {
          throwNextSpawn = false;
          throw new Error('invalid arguments');
        }
        throwNextSpawn = false;
        const child = createFakeChild();
        children.push(child);
        return child;
      },
    });
    expect(controller.attach()).toBe('failed');
    expect(children).toHaveLength(0);
    // The latch was reset before the throw, so the scheduled re-attach can spawn normally.
    vi.advanceTimersByTime(3000);
    expect(children).toHaveLength(1);
    // And the failed spawn went through the crash-loop accounting.
    expect(store.get(WALLPAPER_WINDOWS_FAILURE_COUNT_KEY)).toBe(1);
    expect(onDegrade).not.toHaveBeenCalled();
  });
});

describe('helper mouse events', () => {
  it('forwards mousemove/mousedown/mouseup/mousewheel to the onMouseInput callback', () => {
    const onMouseInput = vi.fn();
    const { controller } = createHarness({ onMouseInput });
    controller.handleHelperEvent({ event: 'mousemove', x: 1920, y: 1080 });
    controller.handleHelperEvent({ event: 'mousedown', x: 100, y: 50 });
    controller.handleHelperEvent({ event: 'mouseup', x: 100, y: 50 });
    controller.handleHelperEvent({ event: 'mousewheel', x: 40, y: 60, deltaX: 0, deltaY: -120 });
    expect(onMouseInput.mock.calls.map((call) => (call[0] as HelperEvent).event)).toEqual([
      'mousemove',
      'mousedown',
      'mouseup',
      'mousewheel',
    ]);
    expect(onMouseInput.mock.calls[0][0]).toEqual({ event: 'mousemove', x: 1920, y: 1080 });
    expect(onMouseInput.mock.calls[3][0]).toEqual({
      event: 'mousewheel',
      x: 40,
      y: 60,
      deltaX: 0,
      deltaY: -120,
    });
  });

  it('does not require onMouseInput (safe when unset)', () => {
    const { controller } = createHarness();
    expect(() => {
      controller.handleHelperEvent({ event: 'mousemove', x: 1, y: 2 });
    }).not.toThrow();
  });
});

describe('error classification', () => {
  it('does not request a rebuild for ordinary helper errors', () => {
    const { controller, children, onReattachNeeded } = createHarness();
    controller.attach();
    children[0].writeStdout('{"event":"attached"}\n');
    children[0].writeStdout(
      '{"event":"error","message":"re-attach failed after 10 retries: WorkerW not found"}\n'
    );
    expect(onReattachNeeded).not.toHaveBeenCalled();
    expect(controller.isDegraded()).toBe(false);
  });
});
