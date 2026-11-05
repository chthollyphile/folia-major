'use strict';

// electron/windowSystemMenu.cjs
// Windows' window menu (Alt+Space, or a right click on a drag region) on the app's windows. It stays
// as Windows draws it, except while a key-capture field in that window is recording: Alt+Space must
// then reach the page as a key, so the menu is refused for that window only. Chromium still hands the
// Space keydown to the refused menu, so only the release reaches the page, where KeyCapture records
// it. Tracked per webContents, cleared when its page navigates, crashes or goes away, so a recording
// that never said it ended cannot keep the menu away for good.

/** Creates the guard: `attach` every BrowserWindow, `setCapturing` from the renderer's IPC. */
function createWindowSystemMenuGuard() {
  const capturing = new Set();

  const attach = (window) => {
    const { webContents } = window;
    // Read once: the id cannot be read from a destroyed webContents.
    const id = webContents.id;
    const release = () => capturing.delete(id);
    window.on('system-context-menu', (event) => {
      if (capturing.has(id)) {
        event.preventDefault();
      }
    });
    window.once('closed', release);
    // The page itself reloading or going elsewhere; an iframe loading inside it (a URL background, a
    // mod's frame) leaves the recording alone.
    webContents.on('did-start-navigation', (details) => {
      if (details && details.isMainFrame && !details.isSameDocument) {
        release();
      }
    });
    webContents.on('render-process-gone', release);
  };

  const setCapturing = (webContentsId, active) => {
    if (active === true) {
      capturing.add(webContentsId);
    } else {
      capturing.delete(webContentsId);
    }
  };

  return {
    attach,
    setCapturing,
    isCapturing: (webContentsId) => capturing.has(webContentsId),
  };
}

module.exports = { createWindowSystemMenuGuard };
