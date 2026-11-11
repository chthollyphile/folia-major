// Decisions for a main window built with the macOS traffic lights (`titleBarStyle: 'hidden'`),
// kept apart from electron/main.cjs so they can be tested without an Electron window.

// The system red light (and Cmd+W) closes the window without going through the `window-close`
// channel, so "close to tray" has to be honoured in the window's own `close` event. Quitting the
// app sets `isAppQuitting` first and must always get through.
function shouldHideToTrayOnClose({ nativeTrafficLights, isAppQuitting, wallpaperMode, closeToTray, hasTray }) {
    return nativeTrafficLights === true && !isAppQuitting && !wallpaperMode && closeToTray === true && hasTray === true;
}

// Wallpaper mode needs a frameless window, so one built with traffic lights is rebuilt before it
// sinks. Not when the entry is going to be refused anyway (the rebuild would only reload the page
// and leave a window without its lights), and not while it is in native full screen, where the
// entry is deferred until the window has left full screen.
function shouldRebuildBeforeMacWallpaper({ nativeTrafficLights, canEnterWallpaper, fullscreen }) {
    return nativeTrafficLights === true && canEnterWallpaper === true && !fullscreen;
}

// Leaving wallpaper mode keeps the frameless window it was shown in; with the setting on, the
// lights only come back on a window built for them.
function shouldRebuildAfterMacWallpaper({ settingEnabled, nativeTrafficLights }) {
    return settingEnabled === true && nativeTrafficLights !== true;
}

module.exports = { shouldHideToTrayOnClose, shouldRebuildBeforeMacWallpaper, shouldRebuildAfterMacWallpaper };
