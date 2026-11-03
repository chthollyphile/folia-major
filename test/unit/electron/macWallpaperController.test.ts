import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// test/unit/electron/macWallpaperController.test.ts
// Locks down the macOS wallpaper controller's pure logic: CGEventType classification, the
// desktop-level arithmetic, the test-mode switch, and the Dock auto-hide state machine with
// injected `defaults` / `killall` executors. FFI paths (window level, event tap, CGWindowList
// probe) need a real macOS host and are left to manual verification.

const require = createRequire(import.meta.url);
const {
  classifyMacTapEventType,
  computeDesktopLevel,
  isTransparentDesktopSurface,
  isFullDisplaySurface,
  parseDockMarker,
  createMacWallpaperController,
  isMacWallpaperTestMode,
  FINDER_DESKTOP_LAYER,
} = require('../../../electron/wallpaper/macWallpaperController.cjs') as {
  classifyMacTapEventType: (type: number) => string | null;
  computeDesktopLevel: (iconLevel: number) => number;
  isTransparentDesktopSurface: (layer: number, alpha: number) => boolean;
  isFullDisplaySurface: (bounds: Rect | null, displayFrame: Rect | null) => boolean;
  parseDockMarker: (content: string) => { autohide: '0' | 'absent'; delay: string } | null;
  createMacWallpaperController: (options?: Record<string, unknown>) => Controller;
  isMacWallpaperTestMode: (env: Record<string, string>, testMode?: boolean) => boolean;
  FINDER_DESKTOP_LAYER: number;
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExecCall {
  cmd: string;
  args: string[];
}

interface Controller {
  isAvailable: () => boolean;
  desktopLevel: () => number;
  setLevel: () => boolean;
  setCollectionBehavior: () => boolean;
  hasPermission: () => boolean;
  requestPermission: () => boolean;
  isDesktopPoint: (x: number, y: number) => boolean;
  isDockAtBottom: () => boolean;
  start: (forward?: (evt: unknown) => void) => boolean;
  stop: () => void;
  isRunning: () => boolean;
  setDockAutohide: (on: boolean) => Promise<void>;
  restoreDock: () => Promise<void>;
  restoreDockSync: () => void;
  recoverStrandedDock: () => Promise<void>;
  configureDockRecovery: () => string | null;
  hasDockPriorState: () => boolean;
  MOVE_THROTTLE_MS: number;
  FINDER_DESKTOP_LAYER: number;
}

interface DockHarness {
  controller: Controller;
  execCalls: ExecCall[];
  execSyncCalls: ExecCall[];
  markerFile: string;
  tempDir: string;
}

// defaults read autohide returns; 'autohide-delay' returns. A throw simulates a missing key.
function createDockHarness(overrides: {
  platform?: string;
  autohide?: string;
  autohideDelay?: string | null;
  storeInitial?: Record<string, unknown>;
} = {}): DockHarness {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-macwallpaper-'));
  const markerFile = path.join(tempDir, '.wallpaper-dock-autohidden');
  const execCalls: ExecCall[] = [];
  const execSyncCalls: ExecCall[] = [];
  const store: Record<string, unknown> = { wallpaper_mode: false, ...(overrides.storeInitial ?? {}) };

  const execFile = (cmd: string, args: string[], cb: (err: Error | null) => void) => {
    execCalls.push({ cmd, args });
    cb(null);
  };
  const execFileSync = (cmd: string, args: string[]) => {
    execSyncCalls.push({ cmd, args });
    if (args[0] === 'read' && args[2] === 'autohide') {
      if (overrides.autohide === undefined) throw new Error('key not present');
      return Buffer.from(`${overrides.autohide}\n`);
    }
    if (args[0] === 'read' && args[2] === 'autohide-delay') {
      if (overrides.autohideDelay === undefined || overrides.autohideDelay === null) throw new Error('key not present');
      return Buffer.from(`${overrides.autohideDelay}\n`);
    }
    return Buffer.from('');
  };

  const controller = createMacWallpaperController({
    store: { get: (k: string) => store[k], set: (k: string, v: unknown) => { store[k] = v; } },
    userDataPath: () => tempDir,
    execFile,
    execFileSync,
    fsModule: fs,
    env: {},
    platform: overrides.platform ?? 'darwin',
    testMode: false,
    logWarn: () => undefined,
  });

  return { controller, execCalls, execSyncCalls, markerFile, tempDir };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifyMacTapEventType', () => {
  it('maps the observed CGEventTypes to forwarding kinds', () => {
    expect(classifyMacTapEventType(1)).toBe('down');   // leftMouseDown
    expect(classifyMacTapEventType(2)).toBe('up');     // leftMouseUp
    expect(classifyMacTapEventType(6)).toBe('drag');   // leftMouseDragged
    expect(classifyMacTapEventType(3)).toBe('rdown');  // rightMouseDown
    expect(classifyMacTapEventType(4)).toBe('rup');    // rightMouseUp
    expect(classifyMacTapEventType(7)).toBe('rdrag');  // rightMouseDragged
    expect(classifyMacTapEventType(5)).toBe('move');   // mouseMoved
    expect(classifyMacTapEventType(22)).toBe('scroll'); // scrollWheel
  });

  it('keeps the uint32 tap-disabled sentinels distinguishable from real events', () => {
    // The koffi callback prototype types CGEventType as uint32, so the system-disabled sentinels
    // arrive as their unsigned values and must still be recognised (never re-interpreted as
    // signed ints, which would leave a system-disabled tap dead forever).
    expect(classifyMacTapEventType(0xfffffffe)).toBe('disabled-timeout');
    expect(classifyMacTapEventType(0xffffffff)).toBe('disabled-userinput');
  });

  it('returns null for unobserved event types', () => {
    expect(classifyMacTapEventType(0)).toBeNull();
    expect(classifyMacTapEventType(14)).toBeNull(); // keyDown
    expect(classifyMacTapEventType(21)).toBeNull(); // otherMouseDown
  });
});

describe('computeDesktopLevel', () => {
  it('sits one level below the desktop-icon layer', () => {
    expect(computeDesktopLevel(100)).toBe(99);
    expect(computeDesktopLevel(-2147483603)).toBe(-2147483604);
  });

  it('places the wallpaper below the measured Finder desktop layer', () => {
    // FINDER_DESKTOP_LAYER is the machine-measured icon layer; our level must be strictly lower
    // so icons stay clickable/visible while the window above the wallpaper picture.
    const desktopLevel = computeDesktopLevel(FINDER_DESKTOP_LAYER);
    expect(desktopLevel).toBeLessThan(FINDER_DESKTOP_LAYER);
    expect(desktopLevel).toBe(FINDER_DESKTOP_LAYER - 1);
  });
});

describe('isTransparentDesktopSurface', () => {
  it('ignores fully transparent windows only at desktop-adjacent layers', () => {
    // Desktop-widget containers macOS keeps above the Finder desktop layer are alpha 0.
    expect(isTransparentDesktopSurface(-2147483602, 0)).toBe(true);
    expect(isTransparentDesktopSurface(-2147483601, 0)).toBe(true);
  });

  it('keeps visible or normal-layer windows covering', () => {
    // A visible desktop icon/widget has a positive alpha and must still block forwarding.
    expect(isTransparentDesktopSurface(-2147483602, 1)).toBe(false);
    // A normal-layer (>= 0) overlay stays covering even when invisible — it can own clicks.
    expect(isTransparentDesktopSurface(0, 0)).toBe(false);
    expect(isTransparentDesktopSurface(20, 0)).toBe(false);
    expect(isTransparentDesktopSurface(24, 0)).toBe(false);
  });
});

describe('isFullDisplaySurface', () => {
  const displayFrame: Rect = { x: 0, y: 0, width: 1470, height: 956 };

  it('recognises the full-display Finder backdrop / Dock surfaces', () => {
    expect(isFullDisplaySurface({ x: 0, y: 0, width: 1470, height: 956 }, displayFrame)).toBe(true);
    // Menu-bar / Dock overlap and WindowServer rounding leave a couple of pixels of slop.
    expect(isFullDisplaySurface({ x: 0, y: 1, width: 1470, height: 955 }, displayFrame)).toBe(true);
  });

  it('keeps smaller real windows (icon windows, a visible Dock bar) distinct', () => {
    expect(isFullDisplaySurface({ x: 0, y: 0, width: 1470, height: 90 }, displayFrame)).toBe(false);
    expect(isFullDisplaySurface({ x: 0, y: 0, width: 1400, height: 956 }, displayFrame)).toBe(false);
    expect(isFullDisplaySurface({ x: 20, y: 20, width: 64, height: 64 }, displayFrame)).toBe(false);
  });

  it('fails soft when either frame is missing', () => {
    expect(isFullDisplaySurface({ x: 0, y: 0, width: 1470, height: 956 }, null)).toBe(false);
    expect(isFullDisplaySurface(null, displayFrame)).toBe(false);
  });
});

describe('parseDockMarker', () => {
  it('parses the JSON markers this build writes (both prior values)', () => {
    expect(parseDockMarker(JSON.stringify({ autohide: '0', delay: 'absent' })))
      .toEqual({ autohide: '0', delay: 'absent' });
    expect(parseDockMarker(JSON.stringify({ autohide: 'absent', delay: '0.8' })))
      .toEqual({ autohide: 'absent', delay: '0.8' });
  });

  it('reads first-generation plain-value markers with an unknown delay', () => {
    expect(parseDockMarker('0')).toEqual({ autohide: '0', delay: 'absent' });
    expect(parseDockMarker('absent')).toEqual({ autohide: 'absent', delay: 'absent' });
  });

  it('rejects unknown content so recovery never guesses at the prior state', () => {
    // A marker is only ever written right before hiding the Dock, so '1' can never be stored.
    expect(parseDockMarker('1')).toBeNull();
    expect(parseDockMarker('garbage')).toBeNull();
    expect(parseDockMarker(JSON.stringify({ autohide: '1', delay: '0.5' }))).toBeNull();
    expect(parseDockMarker(JSON.stringify({ delay: '0.5' }))).toBeNull();
    expect(parseDockMarker('{broken json')).toBeNull();
    expect(parseDockMarker('')).toBeNull();
  });
});

describe('isDockAtBottom', () => {
  const makeController = (execFileSync: () => unknown) => createMacWallpaperController({
    store: { get: () => null, set: () => undefined },
    userDataPath: () => null,
    platform: 'darwin',
    env: {},
    testMode: false,
    logWarn: () => undefined,
    execFileSync,
  });

  it('reports bottom only when the dock orientation is bottom', () => {
    expect(makeController(() => 'bottom').isDockAtBottom()).toBe(true);
    expect(makeController(() => 'left').isDockAtBottom()).toBe(false);
    expect(makeController(() => 'right').isDockAtBottom()).toBe(false);
    expect(makeController(() => Buffer.from('bottom\n')).isDockAtBottom()).toBe(true);
    expect(makeController(() => 'BOTTOM').isDockAtBottom()).toBe(true);
  });

  it('fails soft (not bottom) when the orientation cannot be read', () => {
    expect(makeController(() => { throw new Error('defaults read failed'); }).isDockAtBottom()).toBe(false);
  });
});

describe('isMacWallpaperTestMode', () => {
  it('honours the env switch', () => {
    expect(isMacWallpaperTestMode({})).toBe(false);
    expect(isMacWallpaperTestMode({ FOLIA_MAC_WALLPAPER_SELFTEST: '1' })).toBe(true);
    expect(isMacWallpaperTestMode({ FOLIA_MAC_WALLPAPER_SELFTEST: '0' })).toBe(false);
  });

  it('honours an injected flag over the env', () => {
    expect(isMacWallpaperTestMode({ FOLIA_MAC_WALLPAPER_SELFTEST: '1' }, false)).toBe(false);
    expect(isMacWallpaperTestMode({}, true)).toBe(true);
  });
});

describe('Dock auto-hide state machine', () => {
  let harness: DockHarness;

  beforeEach(() => {
    harness = createDockHarness({ autohide: '0' });
  });

  afterEach(() => {
    fs.rmSync(harness.tempDir, { recursive: true, force: true });
  });

  it('is a no-op off-mac', async () => {
    const offMac = createDockHarness({ platform: 'linux', autohide: '0' });
    await offMac.controller.setDockAutohide(true);
    expect(offMac.execCalls).toEqual([]);
    expect(offMac.execSyncCalls).toEqual([]);
    fs.rmSync(offMac.tempDir, { recursive: true, force: true });
  });

  it('records the prior autohide and hides the Dock with a zero reveal delay', async () => {
    await harness.controller.setDockAutohide(true);
    // prior autohide ('0') and autohide-delay (missing -> 'absent') are read synchronously.
    expect(harness.execSyncCalls.map(call => call.args[2])).toEqual(['autohide', 'autohide-delay']);
    // Then: zero the delay, hide the Dock, restart the Dock.
    expect(harness.execCalls).toEqual([
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide-delay', '-float', '0'] },
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide', '-bool', 'true'] },
      { cmd: '/usr/bin/killall', args: ['Dock'] },
    ]);
    // Marker written before the writes so a crash can still recover; it carries BOTH prior values
    // (JSON), so a crash after zeroing the delay restores it instead of deleting the preference.
    expect(fs.existsSync(harness.markerFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(harness.markerFile, 'utf8')))
      .toEqual({ autohide: '0', delay: 'absent' });
  });

  it('persists a custom reveal delay in the marker and restores it', async () => {
    const custom = createDockHarness({ autohide: '0', autohideDelay: '0.8' });
    await custom.controller.setDockAutohide(true);
    expect(JSON.parse(fs.readFileSync(custom.markerFile, 'utf8')))
      .toEqual({ autohide: '0', delay: '0.8' });
    custom.execCalls.length = 0;

    await custom.controller.restoreDock();
    expect(custom.execCalls).toEqual([
      // The user's own delay comes back, not a deleted preference.
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide-delay', '-float', '0.8'] },
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide', '-bool', 'false'] },
      { cmd: '/usr/bin/killall', args: ['Dock'] },
    ]);
    expect(fs.existsSync(custom.markerFile)).toBe(false);
    fs.rmSync(custom.tempDir, { recursive: true, force: true });
  });

  it('leaves an already auto-hidden Dock alone', async () => {
    const already = createDockHarness({ autohide: '1' });
    await already.controller.setDockAutohide(true);
    expect(already.execSyncCalls.map(call => call.args[2])).toEqual(['autohide']);
    expect(already.execCalls).toEqual([]);
    expect(fs.existsSync(already.markerFile)).toBe(false);
    fs.rmSync(already.tempDir, { recursive: true, force: true });
  });

  it('restores the prior Dock state and clears the marker', async () => {
    await harness.controller.setDockAutohide(true);
    expect(harness.controller.hasDockPriorState()).toBe(true);
    harness.execCalls.length = 0;

    await harness.controller.restoreDock();
    expect(harness.controller.hasDockPriorState()).toBe(false);
    expect(harness.execCalls).toEqual([
      // priorDelay was absent -> delete the delay key we zeroed, back to the macOS default.
      { cmd: '/usr/bin/defaults', args: ['delete', 'com.apple.dock', 'autohide-delay'] },
      // prior autohide was '0' -> restore autohide false.
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide', '-bool', 'false'] },
      { cmd: '/usr/bin/killall', args: ['Dock'] },
    ]);
    expect(fs.existsSync(harness.markerFile)).toBe(false);
  });

  it('restores synchronously on quit', async () => {
    await harness.controller.setDockAutohide(true);
    harness.execCalls.length = 0;
    harness.execSyncCalls.length = 0;

    harness.controller.restoreDockSync();
    expect(harness.execSyncCalls.map(call => call.args[0])).toEqual(['write', 'delete', 'Dock']);
    expect(harness.execCalls).toEqual([]);
    expect(fs.existsSync(harness.markerFile)).toBe(false);
  });

  it('recoverStrandedDock restores a Dock left hidden by a previous crash', async () => {
    // A marker written by a dead session exists on disk with the user's prior ('0').
    fs.writeFileSync(harness.markerFile, '0');
    harness.controller.configureDockRecovery();
    await harness.controller.recoverStrandedDock();
    expect(harness.execCalls.map(call => call.args[0])).toEqual(['delete', 'write', 'Dock']);
    expect(fs.existsSync(harness.markerFile)).toBe(false);
  });

  it('recoverStrandedDock restores the reveal delay a JSON marker recorded', async () => {
    // Crash after the marker write: the JSON marker holds the user's delay ('0.8') as well, so
    // recovery puts it back instead of deleting the preference.
    fs.writeFileSync(harness.markerFile, JSON.stringify({ autohide: '0', delay: '0.8' }));
    harness.controller.configureDockRecovery();
    await harness.controller.recoverStrandedDock();
    expect(harness.execCalls).toEqual([
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide-delay', '-float', '0.8'] },
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide', '-bool', 'false'] },
      { cmd: '/usr/bin/killall', args: ['Dock'] },
    ]);
    expect(fs.existsSync(harness.markerFile)).toBe(false);
  });

  it('recoverStrandedDock drops an unknown marker instead of resetting preferences', async () => {
    fs.writeFileSync(harness.markerFile, 'not a marker we wrote');
    harness.controller.configureDockRecovery();
    await harness.controller.recoverStrandedDock();
    expect(harness.execCalls).toEqual([]);
    expect(harness.execSyncCalls).toEqual([]);
    expect(fs.existsSync(harness.markerFile)).toBe(false);
  });

  it('serialises a hide followed by a restore enqueued before the hide ran', async () => {
    // The crash-recovery path at startup enqueues a restore and the wallpaper re-enter enqueues a
    // hide moments later, before the first async chain has run. Both must still execute one after
    // the other, in full, and the restore must see the prior autohide the hide captured.
    const hide = harness.controller.setDockAutohide(true);
    const restore = harness.controller.restoreDock();
    await restore; // resolves only after both queued ops finished

    expect(harness.execCalls).toEqual([
      // hide: zero delay, hide the Dock, restart the Dock
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide-delay', '-float', '0'] },
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide', '-bool', 'true'] },
      { cmd: '/usr/bin/killall', args: ['Dock'] },
      // restore: delete the delay key, put autohide back to false, restart the Dock
      { cmd: '/usr/bin/defaults', args: ['delete', 'com.apple.dock', 'autohide-delay'] },
      { cmd: '/usr/bin/defaults', args: ['write', 'com.apple.dock', 'autohide', '-bool', 'false'] },
      { cmd: '/usr/bin/killall', args: ['Dock'] },
    ]);
    expect(fs.existsSync(harness.markerFile)).toBe(false);
  });
});
