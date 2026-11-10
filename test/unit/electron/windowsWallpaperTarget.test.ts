import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/windowsWallpaperTarget.test.ts
// Locks down the Windows wallpaper target-display decision table: which monitor the wallpaper
// window fills (live ordinary window → session target → WINDOW_BOUNDS → primary) and how a display
// that disappeared is handled. The resolver takes `screen` by injection, so none of this needs
// Electron or a real display.

const require = createRequire(import.meta.url);
const { createWindowsWallpaperTargetResolver, isUsableDisplayId } = require('../../../electron/wallpaper/windowsWallpaperTarget.cjs') as {
  createWindowsWallpaperTargetResolver: (options: ResolverOptions) => Resolver;
  isUsableDisplayId: (id: unknown) => boolean;
};

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FakeDisplay {
  id: number;
  bounds: Bounds;
  scaleFactor: number;
}

interface ResolverOptions {
  screen: {
    getAllDisplays: () => FakeDisplay[];
    getDisplayMatching: (bounds: Bounds) => FakeDisplay;
    getPrimaryDisplay: () => FakeDisplay;
  };
  getStoredBounds?: () => Bounds | null;
  getMainWindow?: () => FakeWindow | null;
  getDisplayChoice?: () => { id: number; bounds: Bounds; label: string } | null;
}

interface FakeWindow {
  isDestroyed: () => boolean;
  getBounds: () => Bounds;
  __wallpaperGeometry?: boolean;
}

interface Resolver {
  resolve: () => FakeDisplay | null;
  peek: () => FakeDisplay | null;
  current: () => { id: number; bounds: Bounds } | null;
  rememberFromWindow: (win: FakeWindow | null) => FakeDisplay | null;
  clear: () => void;
}

const PRIMARY: FakeDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
// Secondary display to the right at 150%: 2560 physical px wide → 1706.67 DIP, rounded here to a
// realistic Chromium-reported rect.
const SECONDARY: FakeDisplay = { id: 2, bounds: { x: 1920, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 };

function createFakeWindow(bounds: Bounds, overrides: Partial<FakeWindow> = {}): FakeWindow {
  return {
    isDestroyed: () => false,
    getBounds: () => bounds,
    ...overrides,
  };
}

function createScreen(displays: FakeDisplay[]) {
  return {
    getAllDisplays: () => displays,
    getDisplayMatching: (bounds: Bounds) => {
      const intersecting = displays.filter((display) => {
        const horizontal = Math.min(bounds.x + bounds.width, display.bounds.x + display.bounds.width) - Math.max(bounds.x, display.bounds.x);
        const vertical = Math.min(bounds.y + bounds.height, display.bounds.y + display.bounds.height) - Math.max(bounds.y, display.bounds.y);
        return horizontal > 0 && vertical > 0;
      });
      if (!intersecting.length) {
        // Chromium answers "nearest"; the resolver must reject that and use the primary display.
        return displays[displays.length - 1];
      }
      return intersecting[0];
    },
    getPrimaryDisplay: () => displays[0],
  };
}

describe('isUsableDisplayId', () => {
  it('rejects the placeholder ids Electron reports', () => {
    expect(isUsableDisplayId(-1)).toBe(false);
    expect(isUsableDisplayId(-10)).toBe(false);
    expect(isUsableDisplayId(0)).toBe(false);
    expect(isUsableDisplayId('2')).toBe(false);
    expect(isUsableDisplayId(2)).toBe(true);
  });
});

describe('windows wallpaper target display', () => {
  it('prefers the live ordinary window over the stored geometry', () => {
    const screen = createScreen([PRIMARY, SECONDARY]);
    const resolver = createWindowsWallpaperTargetResolver({
      screen,
      getStoredBounds: () => PRIMARY.bounds,
      getMainWindow: () => createFakeWindow({ x: 2000, y: 100, width: 800, height: 600 }),
    });

    expect(resolver.resolve()).toEqual(SECONDARY);
  });

  it('ignores the wallpaper window itself and uses the stored geometry', () => {
    const screen = createScreen([PRIMARY, SECONDARY]);
    const resolver = createWindowsWallpaperTargetResolver({
      screen,
      // A wallpaper window's bounds are the display itself; reading them back would be circular.
      getStoredBounds: () => ({ x: 2000, y: 100, width: 800, height: 600 }),
      getMainWindow: () => createFakeWindow(SECONDARY.bounds, { __wallpaperGeometry: true }),
    });

    expect(resolver.resolve()).toEqual(SECONDARY);
  });

  it('falls back to the primary display when the stored geometry intersects nothing', () => {
    const screen = createScreen([PRIMARY, SECONDARY]);
    const resolver = createWindowsWallpaperTargetResolver({
      screen,
      // The monitor this geometry was on has been unplugged.
      getStoredBounds: () => ({ x: -3840, y: 0, width: 1920, height: 1080 }),
      getMainWindow: () => null,
    });

    expect(resolver.resolve()).toEqual(PRIMARY);
  });

  it('falls back to the primary display when the stored geometry has no origin', () => {
    const screen = createScreen([PRIMARY, SECONDARY]);
    const resolver = createWindowsWallpaperTargetResolver({
      screen,
      getStoredBounds: () => ({ width: 1200, height: 800 }) as Bounds,
      getMainWindow: () => null,
    });

    expect(resolver.resolve()).toEqual(PRIMARY);
  });

  it('keeps the session target across rebuilds and moves onto another display after clear', () => {
    const displays = [PRIMARY, SECONDARY];
    const screen = createScreen(displays);
    let liveWindow: FakeWindow | null = null;
    const resolver = createWindowsWallpaperTargetResolver({
      screen,
      getStoredBounds: () => ({ x: 2000, y: 100, width: 800, height: 600 }),
      getMainWindow: () => liveWindow,
    });

    // Entering wallpaper mode: the outgoing ordinary window decides.
    resolver.rememberFromWindow(createFakeWindow({ x: 2000, y: 100, width: 800, height: 600 }));
    expect(resolver.resolve()).toEqual(SECONDARY);

    // Session tear-down: the next entry re-derives from wherever the window is then.
    resolver.clear();
    expect(resolver.resolve()).toEqual(SECONDARY); // stored geometry still points at the secondary

    liveWindow = createFakeWindow({ x: 100, y: 100, width: 800, height: 600 });
    expect(resolver.resolve()).toEqual(PRIMARY);
  });

  it('re-resolves to the primary display when the remembered display is unplugged', () => {
    const displays = [PRIMARY, SECONDARY];
    const resolver = createWindowsWallpaperTargetResolver({
      screen: createScreen(displays),
      getStoredBounds: () => SECONDARY.bounds,
      getMainWindow: () => null,
    });

    resolver.rememberFromWindow(createFakeWindow({ x: 2000, y: 100, width: 800, height: 600 }));
    expect(resolver.resolve()).toEqual(SECONDARY);

    // Unplug it: the session target can no longer be matched, and the stored geometry is off-screen
    // as well, so the wallpaper must land on the primary display.
    displays.splice(0, displays.length, PRIMARY);
    expect(resolver.resolve()).toEqual(PRIMARY);
  });

  it('matches the remembered display by geometry when the platform reports no usable id', () => {
    const unidentifiable: FakeDisplay = { id: -1, bounds: { x: 1920, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 };
    const resolver = createWindowsWallpaperTargetResolver({
      screen: createScreen([PRIMARY, unidentifiable]),
      getStoredBounds: () => PRIMARY.bounds,
      getMainWindow: () => null,
    });

    resolver.rememberFromWindow(createFakeWindow(unidentifiable.bounds));
    expect(resolver.resolve()).toEqual(unidentifiable);
  });

  it('survives screen lookups that throw while the topology changes', () => {
    const resolver = createWindowsWallpaperTargetResolver({
      screen: {
        getAllDisplays: () => {
          throw new Error('topology changing');
        },
        getDisplayMatching: () => {
          throw new Error('topology changing');
        },
        getPrimaryDisplay: () => PRIMARY,
      },
      getStoredBounds: () => PRIMARY.bounds,
      getMainWindow: () => null,
    });

    // Window creation goes through this call, so it must resolve to something usable instead of
    // propagating the error.
    expect(resolver.resolve()).toEqual(PRIMARY);
  });

  it('puts the display chosen in Settings before the live ordinary window', () => {
    const resolver = createWindowsWallpaperTargetResolver({
      screen: createScreen([PRIMARY, SECONDARY]),
      getStoredBounds: () => PRIMARY.bounds,
      // The app window sits on the primary display; the choice names the secondary.
      getMainWindow: () => createFakeWindow({ x: 100, y: 100, width: 800, height: 600 }),
      getDisplayChoice: () => ({ id: SECONDARY.id, bounds: SECONDARY.bounds, label: '' }),
    });

    expect(resolver.resolve()).toEqual(SECONDARY);
  });

  it('goes back to the order without a choice while the chosen display is unplugged', () => {
    const displays = [PRIMARY, SECONDARY];
    const resolver = createWindowsWallpaperTargetResolver({
      screen: createScreen(displays),
      getStoredBounds: () => PRIMARY.bounds,
      getMainWindow: () => null,
      getDisplayChoice: () => ({ id: SECONDARY.id, bounds: SECONDARY.bounds, label: '' }),
    });

    expect(resolver.resolve()).toEqual(SECONDARY);

    // Unplugged: neither the choice nor the session target can be matched, so the stored geometry
    // decides, as it does without a choice.
    displays.splice(0, displays.length, PRIMARY);
    expect(resolver.resolve()).toEqual(PRIMARY);

    // Plugged back in: the choice outranks the session target the fallback left behind.
    displays.push(SECONDARY);
    expect(resolver.resolve()).toEqual(SECONDARY);
  });

  it('answers where a wallpaper would go without changing where this session is', () => {
    let choice: { id: number; bounds: Bounds; label: string } | null = null;
    const resolver = createWindowsWallpaperTargetResolver({
      screen: createScreen([PRIMARY, SECONDARY]),
      getStoredBounds: () => PRIMARY.bounds,
      getMainWindow: () => null,
      getDisplayChoice: () => choice,
    });

    expect(resolver.current()).toBeNull();
    expect(resolver.resolve()).toEqual(PRIMARY);
    expect(resolver.current()).toEqual({ id: PRIMARY.id, bounds: PRIMARY.bounds });

    choice = { id: SECONDARY.id, bounds: SECONDARY.bounds, label: '' };
    expect(resolver.peek()).toEqual(SECONDARY);
    expect(resolver.current()).toEqual({ id: PRIMARY.id, bounds: PRIMARY.bounds });
  });
});
