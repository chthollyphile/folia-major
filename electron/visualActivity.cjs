// electron/visualActivity.cjs
// Native window state stays reliable even with Chromium backgroundThrottling disabled.
function createVisualActivityMonitor({ isWallpaperWindow, platform = process.platform }) {
  const windows = new Map();
  let otherAppFocused = false;
  const getInactive = win => {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return true;
    if (isWallpaperWindow(win)) return platform === 'win32' && otherAppFocused;
    return !win.isFocused();
  };
  return {
    getInactive,
    bind(win) {
      const publish = () => {
        if (win.isDestroyed()) return;
        win.webContents.send('visual-activity-changed', getInactive(win));
      };
      windows.set(win, publish);
      for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.on(event, publish);
      win.webContents.on('did-finish-load', publish);
      win.once('closed', () => windows.delete(win));
    },
    setOtherAppFocused(focused) {
      if (otherAppFocused === focused) return;
      otherAppFocused = focused;
      windows.forEach(publish => publish());
    },
  };
}

module.exports = { createVisualActivityMonitor };
