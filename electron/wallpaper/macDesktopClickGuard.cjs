// electron/wallpaper/macDesktopClickGuard.cjs
// Drives libfolia_click_guard.dylib (packaging/macos/desktop-click-guard/ClickGuard.swift) for the
// macOS wallpaper while Stage Manager is on and the desktop icons are shown (issue #698): the
// library keeps a click on the bare wallpaper away from Finder, so Stage Manager does not send the
// stage aside, and leaves clicks on icons alone. Folia's own listen-only tap still forwards the
// click into the wallpaper.
//
// The library is loaded into Folia's main process through koffi, so the Accessibility grant its
// active tap needs is Folia's own (a helper process was judged by its own identity and stayed
// untrusted). Its tap runs on a native thread and decides in native code; no JavaScript is on the
// click path. Without the grant Folia falls back to the click catchers over the controls
// (macWallpaperHitPanels.cjs). No Electron imports: the library loader is injectable for headless
// tests.

const fs = require('fs');

// Binds the library's C entry points through koffi. Throws when the file cannot be loaded.
function loadClickGuardLibrary(file) {
  const koffi = require('koffi');
  const lib = koffi.load(file);
  return {
    start: lib.func('int32_t folia_click_guard_start(void)'),
    setRegion: lib.func('void folia_click_guard_set_region(double x, double y, double w, double h)'),
    clearRegion: lib.func('void folia_click_guard_clear_region(void)'),
    stop: lib.func('void folia_click_guard_stop(void)'),
    trusted: lib.func('bool folia_click_guard_trusted(void)'),
    requestAccess: lib.func('void folia_click_guard_request_access(void)'),
  };
}

let trustFn = null;
// AXIsProcessTrusted() through koffi: whether Folia holds the Accessibility grant. false when the
// bridge is missing.
function isAccessibilityTrusted() {
  if (process.platform !== 'darwin') return false;
  try {
    if (!trustFn) {
      const koffi = require('koffi');
      const lib = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
      trustFn = lib.func('bool AXIsProcessTrusted(void)');
    }
    return trustFn() === true;
  } catch (e) {
    return false;
  }
}

function isRect(rect) {
  return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
}

const START_RESULTS = { 0: null, 3: 'untrusted', 4: 'tap-failed' };

function createMacDesktopClickGuard({
  libraryPath,
  loadLibrary = loadClickGuardLibrary,
  existsSync = fs.existsSync,
  logWarn = console.warn.bind(console),
}) {
  let lib = null;
  let loadFailed = false;
  let running = false;
  let lastFailure = null; // 'missing' | 'load-failed' | 'untrusted' | 'tap-failed' | null

  function getLibrary() {
    if (lib || loadFailed) return lib;
    const file = typeof libraryPath === 'function' ? libraryPath() : libraryPath;
    if (!file || !existsSync(file)) {
      lastFailure = 'missing';
      return null;
    }
    try {
      lib = loadLibrary(file);
    } catch (e) {
      loadFailed = true;
      lastFailure = 'load-failed';
      logWarn('[WallpaperMac] click guard library failed to load:', e && e.message);
    }
    return lib;
  }

  function setRegion(rect) {
    if (!lib) return;
    if (isRect(rect)) lib.setRegion(rect.x, rect.y, rect.width, rect.height);
    else lib.clearRegion();
  }

  // Sets the region first (the tap reads it from its first event), then starts the tap if it is
  // not running. Returns whether the guard is running.
  function start(region) {
    const l = getLibrary();
    if (!l) return false;
    setRegion(region);
    if (running) return true;
    const code = l.start();
    const failure = Object.prototype.hasOwnProperty.call(START_RESULTS, code) ? START_RESULTS[code] : 'tap-failed';
    if (failure) {
      if (failure !== lastFailure) logWarn('[WallpaperMac] click guard not started:', failure);
      lastFailure = failure;
      l.clearRegion();
      return false;
    }
    running = true;
    lastFailure = null;
    return true;
  }

  function stop() {
    if (!lib) return;
    if (running) lib.stop();
    running = false;
    lib.clearRegion();
  }

  // Shows macOS' Accessibility prompt for Folia.
  function requestAccess() {
    const l = getLibrary();
    if (!l) return false;
    l.requestAccess();
    return true;
  }

  return {
    start,
    setRegion,
    requestAccess,
    stop,
    isRunning: () => running,
    lastFailure: () => lastFailure,
  };
}

module.exports = {
  isAccessibilityTrusted,
  loadClickGuardLibrary,
  createMacDesktopClickGuard,
};
