// electron/wallpaper/wallpaperEntryRequest.cjs
// Tray entry into wallpaper mode: the tray lives in the main process and cannot draw the in-app
// ConfirmDialog, so it asks the renderer to show it instead. The renderer funnels the answer into
// the same save-settings path as the settings card / command palette, so there is exactly one
// confirmation implementation. Leaving wallpaper mode never goes through here.

const WALLPAPER_ENTRY_REQUEST_CHANNEL = 'wallpaper-entry-requested';

// Sends the confirmation request to the main window's renderer after bringing the window forward
// (it may be hidden in the tray). Returns false when no renderer can answer, so the caller can
// enter wallpaper mode directly instead of silently dropping the click. A click-through window
// cannot answer either: the dialog's buttons would never receive the mouse.
function requestWallpaperEntryConfirmation({ mainWindow, focusMainWindow, isClickThroughActive }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed() || contents.isLoading()) {
    return false;
  }
  if (typeof contents.isCrashed === 'function' && contents.isCrashed()) {
    return false;
  }
  if (typeof isClickThroughActive === 'function' && isClickThroughActive()) {
    return false;
  }
  focusMainWindow();
  contents.send(WALLPAPER_ENTRY_REQUEST_CHANNEL);
  return true;
}

module.exports = {
  WALLPAPER_ENTRY_REQUEST_CHANNEL,
  requestWallpaperEntryConfirmation,
};
