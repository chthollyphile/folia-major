// electron/backgroundThrottling.cjs
// The opt-in 后台节流 switch (性能与动效 page) for the main window. Off, the default, the window keeps
// backgroundThrottling: false, so OBS window capture of a covered or minimised Folia stays live for
// the streamers who rely on it. On, Chromium may throttle the window while it is hidden, and the
// renderer holds the lyric animation while the window is minimised or hidden to the tray
// (src/components/app/backgroundThrottling/). Losing the focus alone does not count: a window that
// is still on screen keeps moving. The switch stands down while something needs the window live
// even out of sight: wallpaper mode, a video export, a connected OBS browser source.

const BACKGROUND_THROTTLING_SETTING_KEY = 'BACKGROUND_THROTTLING';

/** What the renderer is told: whether the switch is in force, and whether the window is out of sight while it is. */
const SAME_STATE = (a, b) => a.active === b.active && a.hidden === b.hidden;

/**
 * Applies the switch to the main window. `isEnabled` reads the saved setting; `getStandDownReason`
 * names what currently needs the window live, or null. Call `refresh` whenever either may have
 * changed; the window's own minimise / restore / hide / show are followed here.
 */
function createBackgroundThrottling({ isEnabled, getStandDownReason }) {
  let window = null;
  let applied = false;
  let lastReason = null;
  let told = { active: false, hidden: false };

  // Read from the window itself: with the switch freshly on, Chromium's page visibility can still
  // say visible for a minimised window.
  const readState = () => {
    const hidden = applied && Boolean(window) && !window.isDestroyed()
      && (window.isMinimized() || !window.isVisible());
    return { active: applied, hidden };
  };

  const refresh = () => {
    if (!window || window.isDestroyed()) {
      return;
    }
    const enabled = isEnabled();
    const reason = enabled ? getStandDownReason() : null;
    const active = enabled && !reason;
    if (active !== applied || reason !== lastReason) {
      if (active !== applied) {
        window.webContents.setBackgroundThrottling(active);
      }
      applied = active;
      lastReason = reason;
      console.info(`[BackgroundThrottling] ${!enabled ? 'Off' : active ? 'On' : `Standing down: ${reason}`}`);
    }
    const state = readState();
    if (!SAME_STATE(state, told)) {
      told = state;
      window.webContents.send('background-throttling-changed', state);
    }
  };

  // A new main window starts at backgroundThrottling: false and has not been told anything yet.
  const attach = (win) => {
    window = win;
    applied = false;
    lastReason = null;
    told = { active: false, hidden: false };
    for (const event of ['minimize', 'restore', 'hide', 'show']) {
      win.on(event, refresh);
    }
    refresh();
  };

  return { attach, refresh, getState: readState };
}

module.exports = { BACKGROUND_THROTTLING_SETTING_KEY, createBackgroundThrottling };
