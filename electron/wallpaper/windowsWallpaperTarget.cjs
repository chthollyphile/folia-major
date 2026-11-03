// electron/wallpaper/windowsWallpaperTarget.cjs
// Target-display resolution for Windows wallpaper mode: which monitor the wallpaper window fills.
// With a display chosen in Settings the wallpaper goes there; without one it follows the main
// window — the display the app window was on when wallpaper mode was entered.
//
// Resolution order (see docs/wallpaper-mode.md):
//   1. the display chosen in Settings (wallpaperDisplay.cjs), while it is connected
//   2. the live ordinary main window ("the app window is right there"); outranks the session
//      target because wallpaper mode off + window moved must re-target on the next entry, and a
//      maximized window never updates WINDOW_BOUNDS
//   3. the session's target, remembered once resolved (window rebuilds and display changes inside
//      one wallpaper session all keep the same monitor)
//   4. WINDOW_BOUNDS — the last ordinary-window geometry, which wallpaper geometry never
//      overwrites (see saveWindowState), i.e. "where the app window was last time" for the
//      startup-with-wallpaper-mode and destroyed-window recovery paths
//   5. the primary display (no stored origin, or the remembered display is unplugged)
//
// The helper is deliberately not told about the monitor: it fills whichever display the window
// sits on (MonitorFromWindow), so placing the window correctly is the whole contract here.
//
// All side effects are injected so the decision table is unit-testable headless.

const { isUsableDisplayId, resolveWallpaperDisplay } = require('./wallpaperDisplay.cjs');

function hasOrigin(bounds) {
  return Boolean(bounds)
    && typeof bounds.x === 'number'
    && typeof bounds.y === 'number'
    && typeof bounds.width === 'number'
    && typeof bounds.height === 'number';
}

function boundsIntersect(a, b) {
  const horizontalOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const verticalOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

  return horizontalOverlap > 0 && verticalOverlap > 0;
}

function createWindowsWallpaperTargetResolver(options = {}) {
  const { screen, getStoredBounds, getMainWindow, getDisplayChoice } = options;

  // { id, bounds } of the display this session's wallpaper belongs to; null until resolved.
  let sessionTarget = null;

  function snapshot(display) {
    if (!display || !hasOrigin(display.bounds)) {
      sessionTarget = null;
      return null;
    }
    sessionTarget = {
      id: display.id,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
    };
    return display;
  }

  // Screen lookups can throw (or report nothing) while the display topology is changing. The
  // resolution feeds window creation, so it degrades to "no display" instead of throwing.
  function safeDisplay(lookup) {
    try {
      return lookup() ?? null;
    } catch (error) {
      return null;
    }
  }

  // Matches the remembered display against the live list: by id when the platform reported a
  // usable one, by exact geometry otherwise (also covers an id that changed across the session).
  // The same rule finds the display a stored choice points at.
  function matchSessionTarget(displays) {
    return resolveWallpaperDisplay(displays, sessionTarget);
  }

  // The main window while it is still an ordinary window: a wallpaper window's geometry is the
  // display itself, so it is not a usable source of "where the user put the window".
  function getOrdinaryMainWindow() {
    const win = getMainWindow?.();
    if (!win || win.isDestroyed() || win.__wallpaperGeometry === true) {
      return null;
    }
    return win;
  }

  function displayForBounds(bounds) {
    if (!hasOrigin(bounds)) {
      return safeDisplay(() => screen.getPrimaryDisplay());
    }
    const matched = safeDisplay(() => screen.getDisplayMatching(bounds));
    // getDisplayMatching answers "nearest" for a rect that intersects nothing (a monitor the user
    // unplugged, a stale WINDOW_BOUNDS); the wallpaper goes to the primary display instead of
    // following that guess.
    if (matched && hasOrigin(matched.bounds) && boundsIntersect(bounds, matched.bounds)) {
      return matched;
    }
    return safeDisplay(() => screen.getPrimaryDisplay());
  }

  // The display a wallpaper window built now belongs on: where the wallpaper is, or would be if it
  // were entered now. Remembers nothing (resolve() does that), so the settings page can ask.
  function peek() {
    const displays = safeDisplay(() => screen.getAllDisplays()) ?? [];
    if (!displays.length) {
      return safeDisplay(() => screen.getPrimaryDisplay());
    }

    const chosen = resolveWallpaperDisplay(displays, getDisplayChoice?.());
    if (chosen && hasOrigin(chosen.bounds)) {
      return chosen;
    }

    const liveWindow = getOrdinaryMainWindow();
    if (liveWindow) {
      return displayForBounds(liveWindow.getBounds());
    }

    // The session's display while it is connected; once it is unplugged, where the app window
    // was last.
    return matchSessionTarget(displays) ?? displayForBounds(getStoredBounds?.());
  }

  // Called when a wallpaper window is built: the display it goes on becomes the session's target.
  function resolve() {
    return snapshot(peek());
  }

  // { id, bounds } of the display the session's wallpaper window was built on, or null.
  function current() {
    return sessionTarget ? { id: sessionTarget.id, bounds: { ...sessionTarget.bounds } } : null;
  }

  // Captures the display of the window that is about to be replaced by the wallpaper window. Must
  // be called while that window is still alive: a maximized window's WINDOW_BOUNDS is stale (see
  // persistWindowStateSnapshot), so the stored-geometry path alone would pick the wrong monitor.
  function rememberFromWindow(win) {
    if (!win || win.isDestroyed() || win.__wallpaperGeometry === true) {
      return null;
    }
    return snapshot(displayForBounds(win.getBounds()));
  }

  function clear() {
    sessionTarget = null;
  }

  return {
    resolve,
    peek,
    current,
    rememberFromWindow,
    clear,
  };
}

module.exports = {
  createWindowsWallpaperTargetResolver,
  isUsableDisplayId,
};
