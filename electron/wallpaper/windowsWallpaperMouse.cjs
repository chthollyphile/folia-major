// electron/wallpaper/windowsWallpaperMouse.cjs
// Injects the Windows wallpaper helper's desktop mouse reports into the wallpaper renderer.
//
// The helper is per-monitor DPI aware and reports *physical* screen pixels (the virtual-screen
// space Windows uses natively); the injection API takes DIP coordinates relative to the window's
// content area. The conversion runs through Electron's own `screen.screenToDipPoint`, so both
// operands of the subtraction come from Chromium's mapping and a mixed-DPI desktop stays aligned.
// A DPI-unaware helper would instead report Windows' *virtualized* coordinates, which diverge from
// Electron's DIP space as soon as two monitors have different scale factors.
//
// Injection goes through `webContents.sendInputEvent` rather than posted window messages: Chromium
// arms TrackMouseEvent on the first processed WM_MOUSEMOVE, but the real cursor physically sits on
// the desktop icon layer above the wallpaper window, so the system instantly answers
// WM_MOUSELEAVE and hover is torn down between every forwarded move (measured 300–500 enter/leave
// pairs per second).

const WHEEL_DELTA = 120;
// Chromium's mouseWheel wants CSS pixels: ~100px per raw-input notch.
const WHEEL_PIXELS_PER_NOTCH = 100;
const DOUBLE_CLICK_INTERVAL_MS = 500;
const DOUBLE_CLICK_SLOP_DIP = 8;

function createWindowsWallpaperMouseInjector(options = {}) {
  const { screen, getMainWindow, logWarn = console.warn.bind(console) } = options;

  // Tracks the primary button between helper mousedown/mouseup reports: injected mouseMove events
  // carry no button state of their own, and Chromium derives MouseEvent.buttons from the
  // 'leftbuttondown' modifier — without it a drag is torn down by the first forwarded move.
  let primaryButtonHeld = false;
  let lastPrimaryDown = { at: 0, x: 0, y: 0 };
  let dipConversionWarned = false;

  // Physical screen pixels → Chromium's DIP space. Falls back to the raw coordinates (the
  // pre-multi-monitor behaviour) when the platform conversion is unavailable, so mouse forwarding
  // degrades instead of stopping.
  function toDipPoint(x, y) {
    if (typeof screen.screenToDipPoint !== 'function') {
      if (!dipConversionWarned) {
        dipConversionWarned = true;
        logWarn('[WallpaperWin] screen.screenToDipPoint unavailable, assuming helper coordinates are DIP');
      }
      return { x, y };
    }
    try {
      const dip = screen.screenToDipPoint({ x, y });
      if (dip && Number.isFinite(dip.x) && Number.isFinite(dip.y)) {
        return dip;
      }
    } catch (error) {
      if (!dipConversionWarned) {
        dipConversionWarned = true;
        logWarn('[WallpaperWin] screen.screenToDipPoint failed, assuming helper coordinates are DIP', error && error.message);
      }
    }
    return { x, y };
  }

  function toWindowPoint(win, event) {
    const dip = toDipPoint(event.x, event.y);
    const bounds = win.getContentBounds();

    return {
      x: Math.round(dip.x - bounds.x),
      y: Math.round(dip.y - bounds.y),
      bounds,
    };
  }

  // One helper mouse event. Coordinates are physical screen pixels; they are converted to
  // window-relative DIP and injected at the Chromium input-pipeline level.
  function forward(event) {
    const win = getMainWindow?.();
    if (!win || win.isDestroyed() || !event || typeof event.x !== 'number' || typeof event.y !== 'number') {
      return;
    }
    const { x, y, bounds } = toWindowPoint(win, event);
    // The wallpaper covers one monitor: anything on another monitor's desktop (or the taskbar) has
    // nothing to hover. Button-up is the exception — it is always delivered so a drag that leaves
    // the window cannot stick the pressed state.
    const inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;

    switch (event.event) {
      case 'mousemove': {
        if (!inside) {
          return;
        }
        const moveEvent = { type: 'mouseMove', x, y };
        if (primaryButtonHeld) {
          moveEvent.modifiers = ['leftbuttondown'];
        }
        win.webContents.sendInputEvent(moveEvent);
        return;
      }
      case 'mousedown': {
        if (!inside) {
          return;
        }
        primaryButtonHeld = true;
        // clickCount must be synthesized: injected events bypass the OS multi-click detection.
        const now = Date.now();
        const isDoubleClick =
          now - lastPrimaryDown.at < DOUBLE_CLICK_INTERVAL_MS &&
          Math.abs(x - lastPrimaryDown.x) <= DOUBLE_CLICK_SLOP_DIP &&
          Math.abs(y - lastPrimaryDown.y) <= DOUBLE_CLICK_SLOP_DIP;
        lastPrimaryDown = { at: now, x, y };
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          x,
          y,
          button: 'left',
          clickCount: isDoubleClick ? 2 : 1,
          modifiers: ['leftbuttondown'],
        });
        return;
      }
      case 'mouseup': {
        primaryButtonHeld = false;
        win.webContents.sendInputEvent({
          type: 'mouseUp',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        return;
      }
      case 'mousewheel': {
        if (!inside) {
          return;
        }
        // Helper deltas are raw-input notches (multiples of WHEEL_DELTA=120; hi-res wheels send
        // smaller increments). The vertical sign passes through unchanged — sendInputEvent's
        // injected deltaY semantics are inverted relative to native wheel events (calibrated on
        // the real machine, where negating the raw delta produced reversed scrolling); horizontal
        // keeps its sign (positive = scroll right).
        const notch = (raw) => Math.round(((raw || 0) / WHEEL_DELTA) * WHEEL_PIXELS_PER_NOTCH);
        win.webContents.sendInputEvent({
          type: 'mouseWheel',
          x,
          y,
          deltaX: notch(event.deltaX),
          deltaY: notch(event.deltaY),
        });
        return;
      }
      default:
        return;
    }
  }

  return {
    forward,
  };
}

module.exports = {
  createWindowsWallpaperMouseInjector,
};
