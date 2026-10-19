// electron/remoteControlWindowSettings.cjs
// Pure helpers for the remote control window's "hide floating bar", "click-through",
// "expand cover" and "drag past the screen edge" switches.

const REMOTE_CONTROL_HIDE_TITLEBAR_SETTING_KEY = 'REMOTE_CONTROL_HIDE_TITLEBAR';
const REMOTE_CONTROL_CLICK_THROUGH_SETTING_KEY = 'REMOTE_CONTROL_CLICK_THROUGH';
const REMOTE_CONTROL_EXPAND_COVER_SETTING_KEY = 'REMOTE_CONTROL_EXPAND_COVER';
const REMOTE_CONTROL_DRAG_BEYOND_EDGE_SETTING_KEY = 'REMOTE_CONTROL_DRAG_BEYOND_EDGE';

/** Reads the switches from a settings reader; the first two default to off, the rest to on. */
function readRemoteControlWindowSettings(readBoolean) {
  return {
    hideTitlebar: Boolean(readBoolean(REMOTE_CONTROL_HIDE_TITLEBAR_SETTING_KEY, false)),
    clickThrough: Boolean(readBoolean(REMOTE_CONTROL_CLICK_THROUGH_SETTING_KEY, false)),
    expandCover: Boolean(readBoolean(REMOTE_CONTROL_EXPAND_COVER_SETTING_KEY, true)),
    dragBeyondEdge: Boolean(readBoolean(REMOTE_CONTROL_DRAG_BEYOND_EDGE_SETTING_KEY, true)),
  };
}

/** The tray "unlock" item only makes sense while the window is open and ignoring the mouse. */
function shouldShowRemoteUnlockTrayItem({ remoteOpen, clickThrough }) {
  return Boolean(remoteOpen) && Boolean(clickThrough);
}

/**
 * Applies click-through to the remote window (the switch, or the cursor over the empty part left
 * of the card). Mouse events are deliberately NOT forwarded: the
 * page must never see hover/move events while it is click-through, so no hover state can latch.
 */
function applyRemoteControlMouseIgnore(win, clickThrough) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) {
    return false;
  }

  win.setIgnoreMouseEvents(Boolean(clickThrough));
  return Boolean(clickThrough);
}

module.exports = {
  REMOTE_CONTROL_HIDE_TITLEBAR_SETTING_KEY,
  REMOTE_CONTROL_CLICK_THROUGH_SETTING_KEY,
  REMOTE_CONTROL_EXPAND_COVER_SETTING_KEY,
  REMOTE_CONTROL_DRAG_BEYOND_EDGE_SETTING_KEY,
  readRemoteControlWindowSettings,
  shouldShowRemoteUnlockTrayItem,
  applyRemoteControlMouseIgnore,
};
