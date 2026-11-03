import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/windowsWallpaperMouse.test.ts
// Locks down the Windows wallpaper mouse injection: helper coordinates are *physical* screen
// pixels and must be converted into Chromium's DIP space before they are made window-relative —
// the mixed-DPI case the old "helper space equals DIP space" assumption got wrong. `screen` and
// the window are injected, so no Electron host is needed.

const require = createRequire(import.meta.url);
const { createWindowsWallpaperMouseInjector } = require('../../../electron/wallpaper/windowsWallpaperMouse.cjs') as {
  createWindowsWallpaperMouseInjector: (options: InjectorOptions) => Injector;
};

interface InputEvent {
  type: string;
  x: number;
  y: number;
  button?: string;
  clickCount?: number;
  modifiers?: string[];
  deltaX?: number;
  deltaY?: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InjectorOptions {
  screen: {
    screenToDipPoint?: (point: { x: number; y: number }) => { x: number; y: number };
  };
  getMainWindow: () => FakeWindow | null;
  logWarn?: (...args: unknown[]) => void;
}

interface FakeWindow {
  isDestroyed: () => boolean;
  getContentBounds: () => Bounds;
  webContents: { sendInputEvent: (event: InputEvent) => void };
}

interface Injector {
  forward: (event: { event: string; x: number; y: number; deltaX?: number; deltaY?: number }) => void;
}

// Secondary display to the right of a 100% primary, scaled to 150%: physical 1920..4480 maps to a
// DIP window at x=1920 with a DIP width of 1707.
function createHarness(options: { screenToDipPoint?: InjectorOptions['screen']['screenToDipPoint']; windowBounds?: Bounds } = {}) {
  const events: InputEvent[] = [];
  const bounds = options.windowBounds ?? { x: 1920, y: 0, width: 1707, height: 960 };
  const window: FakeWindow = {
    isDestroyed: () => false,
    getContentBounds: () => bounds,
    webContents: {
      sendInputEvent: (event) => {
        events.push(event);
      },
    },
  };
  const logWarn = vi.fn();
  const injector = createWindowsWallpaperMouseInjector({
    screen: { screenToDipPoint: options.screenToDipPoint },
    getMainWindow: () => window,
    logWarn,
  });

  return { injector, events, logWarn, bounds };
}

// 150% scaling, matching the harness window: physical → DIP = origin + (physical - physicalOrigin)/1.5.
function scaledToDip(point: { x: number; y: number }) {
  return { x: 1920 + (point.x - 1920) / 1.5, y: (point.y - 0) / 1.5 };
}

describe('windows wallpaper mouse injection', () => {
  it('converts physical coordinates into DIP window coordinates', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    // 300 physical px into the secondary display at 150% → 200 DIP px into a window whose DIP
    // origin is x=1920.
    injector.forward({ event: 'mousemove', x: 2220, y: 300 });

    expect(events).toEqual([{ type: 'mouseMove', x: 200, y: 200 }]);
  });

  it('drops events that land outside the wallpaper window', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    // Still on the primary display: the wallpaper covers the secondary one only.
    injector.forward({ event: 'mousemove', x: 100, y: 300 });
    // Below the window, and the taskbar strip in DIP terms.
    injector.forward({ event: 'mousemove', x: 2400, y: 2000 });

    expect(events).toEqual([]);
  });

  it('does not inject a press that happened on another display', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    injector.forward({ event: 'mousedown', x: 100, y: 300 });
    expect(events).toEqual([]);

    // The release still goes through so a drag cannot leave the renderer stuck pressed.
    injector.forward({ event: 'mouseup', x: 100, y: 300 });
    expect(events.map((event) => event.type)).toEqual(['mouseUp']);
  });

  it('keeps the pressed state on the forwarded moves of a drag', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    injector.forward({ event: 'mousedown', x: 2220, y: 300 });
    injector.forward({ event: 'mousemove', x: 2250, y: 300 });
    injector.forward({ event: 'mouseup', x: 2250, y: 300 });
    injector.forward({ event: 'mousemove', x: 2280, y: 300 });

    expect(events).toEqual([
      { type: 'mouseDown', x: 200, y: 200, button: 'left', clickCount: 1, modifiers: ['leftbuttondown'] },
      { type: 'mouseMove', x: 220, y: 200, modifiers: ['leftbuttondown'] },
      { type: 'mouseUp', x: 220, y: 200, button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: 240, y: 200 },
    ]);
  });

  it('synthesizes double clicks from DIP positions', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    injector.forward({ event: 'mousedown', x: 2220, y: 300 });
    injector.forward({ event: 'mouseup', x: 2220, y: 300 });
    injector.forward({ event: 'mousedown', x: 2230, y: 300 });

    expect(events.filter((event) => event.type === 'mouseDown').map((event) => event.clickCount)).toEqual([1, 2]);
  });

  it('converts wheel notches into CSS pixels', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    injector.forward({ event: 'mousewheel', x: 2220, y: 300, deltaX: 0, deltaY: -120 });

    expect(events).toEqual([{ type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: -100 }]);
  });

  it('falls back to treating helper coordinates as DIP when the conversion is unavailable', () => {
    const { injector, events, logWarn } = createHarness();

    injector.forward({ event: 'mousemove', x: 2000, y: 100 });

    expect(events).toEqual([{ type: 'mouseMove', x: 80, y: 100 }]);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing conversion', () => {
    const { injector, events } = createHarness({
      screenToDipPoint: () => {
        throw new Error('screen gone');
      },
    });

    injector.forward({ event: 'mousemove', x: 2000, y: 100 });

    expect(events).toEqual([{ type: 'mouseMove', x: 80, y: 100 }]);
  });

  it('ignores events without a usable position', () => {
    const { injector, events } = createHarness({ screenToDipPoint: scaledToDip });

    injector.forward({ event: 'mousemove', x: Number.NaN, y: 100 });
    injector.forward({ event: 'unknown', x: 2220, y: 300 });

    expect(events).toEqual([]);
  });
});
