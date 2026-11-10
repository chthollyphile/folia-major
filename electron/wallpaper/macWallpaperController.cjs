// electron/wallpaper/macWallpaperController.cjs
// macOS desktop-wallpaper mode. Unlike Windows (helper re-parent into WorkerW) and Linux
// (windowtolayer / X11 desktop window) there is no relaunch and no helper process: the LIVE
// BrowserWindow is sunk to a desktop layer — below the Finder icons, above the system
// wallpaper — and a LISTEN-ONLY CGEventTap observes clicks that macOS would otherwise route
// to the bare Finder desktop, which we then forward into the renderer via
// webContents.sendInputEvent (the window itself never receives those clicks: it sits below
// the icons).
//
// The module owns every side that needs FFI or system state and stays free of Electron
// imports so the pure logic is unit-testable headless:
//   - NSWindow level / collection-behavior bridge through koffi (prebuilt N-API, no compile).
//   - session event tap + Input Monitoring preflight/request + the bare-desktop point probe.
//   - Dock auto-hide while the wallpaper is up, with a crash-safe marker so a hard exit
//     cannot strand the user's Dock auto-hidden.
//
// All FFI entry points are darwin-gated and fail-soft: any load/symbol failure turns
// isAvailable() false and every mutator into a no-op, so the app never crashes because the
// wallpaper bridge is missing. The Windows/Linux paths never touch this module.

const WALLPAPER_MODE_SETTING_KEY = 'wallpaper_mode';

// How far below the Finder-icon layer our wallpaper sits. macOS routes clicks on the bare
// desktop to Finder, so a desktop-level window never sees them; the tap below exists exactly
// to observe and forward those. The measured Finder desktop layer constant lives next to the
// desktop-point probe (it is machine-measured, not derived from an API).
const FINDER_DESKTOP_LAYER = -2147483603;

// Bare hover (no button) is forwarded so hover-reveal chrome works, but kMouseMoved fires far
// above frame rate and every forward costs a CGWindowList enumeration on the main thread, so
// moves are time-throttled. Same trade-off the Windows helper solves with its own throttle.
const MOVE_THROTTLE_MS = 40;

// CGEventType is a uint32 enum; the tap-disabled sentinels are 0xFFFFFFFE / 0xFFFFFFFF. The
// koffi callback prototype MUST type it as uint32 — declared as int, koffi hands back -2/-1,
// the re-arm branch never matches and a system-disabled tap stays dead forever.
const kCGEventLeftMouseDown = 1;
const kCGEventLeftMouseUp = 2;
const kCGEventRightMouseDown = 3;
const kCGEventRightMouseUp = 4;
const kCGEventMouseMoved = 5;
const kCGEventLeftMouseDragged = 6;
const kCGEventRightMouseDragged = 7;
const kCGEventScrollWheel = 22;
const kCGEventTapDisabledByTimeout = 0xfffffffe;
const kCGEventTapDisabledByUserInput = 0xffffffff;

// CGWindowList reports our simple-full-screen wallpaper window at the full-screen presentation
// layer (observed 101) even though the NSWindow level reads desktop: such a window spans the
// whole display and must not count as "covering" the point when deciding desktop hits.
const FULLSCREEN_PRESENTATION_LAYER = 101;

// Dock-owned windows up to the Dock level (measured layer 20) carry both the visible Dock bar
// and — in auto-hide — the full-display tracking surface. Surfaces above this level (Dock
// menus / popovers) are ordinary chrome and always cover the point.
const DOCK_UI_LAYER_LIMIT = 20;

// How much of a display a surface must span to count as the full-display desktop chrome (the
// Finder desktop backdrop / the Dock's full-display surface). Menu-bar and rounding offsets keep
// these frames a couple of pixels short of CGDisplayBounds.
const FULL_DISPLAY_SLOP_PX = 2;

// Pure classification of a raw CGEventType into the tap event kinds the forwarding layer
// consumes. Returns null for event types we do not observe, and a 'disabled-*' marker for the
// two tap-disabled sentinels (so a caller can react to a system-disabled tap without decoding
// the uint32 sentinels itself).
function classifyMacTapEventType(type) {
  switch (type) {
    case kCGEventLeftMouseDown: return 'down';
    case kCGEventLeftMouseUp: return 'up';
    case kCGEventLeftMouseDragged: return 'drag';
    case kCGEventRightMouseDown: return 'rdown';
    case kCGEventRightMouseUp: return 'rup';
    case kCGEventRightMouseDragged: return 'rdrag';
    case kCGEventMouseMoved: return 'move';
    case kCGEventScrollWheel: return 'scroll';
    case kCGEventTapDisabledByTimeout: return 'disabled-timeout';
    case kCGEventTapDisabledByUserInput: return 'disabled-userinput';
    default: return null;
  }
}

// Our wallpaper level is exactly one below the desktop-icon layer: above the system wallpaper
// picture (so the window is actually visible as the wallpaper) but under the icons (so they
// keep showing). Kept as a pure function so the arithmetic is unit-testable without FFI.
function computeDesktopLevel(iconWindowLevel) {
  return iconWindowLevel - 1;
}

// Fully transparent windows never occlude the wallpaper. At desktop-adjacent (negative) layers
// macOS keeps invisible container surfaces (it reserves a desktop-widget zone above the Finder
// desktop layer); counting them as covering makes the wallpaper behind them dead to mouse input.
// Normal-layer (>= 0) transparent overlays can still own clicks while invisible, so they stay
// covering. Pure so the decision is unit-testable without the CGWindowList FFI.
function isTransparentDesktopSurface(layer, alpha) {
  return layer < 0 && typeof alpha === 'number' && alpha <= 0;
}

// Does the window frame span the whole display that contains the probe point? The Finder desktop
// window (icons + empty desktop) and the Dock's full-display surface are reported at exactly the
// display frame on every measured macOS, while real covering content (icon windows, a visible
// Dock bar) is reported at its own smaller size. A few pixels of slop cover menu-bar/Dock overlap
// and WindowServer rounding. Pure so the decision is unit-testable without the CGWindowList FFI.
function isFullDisplaySurface(bounds, displayFrame) {
  if (!bounds || !displayFrame) return false;
  return bounds.x <= displayFrame.x + FULL_DISPLAY_SLOP_PX
    && bounds.y <= displayFrame.y + FULL_DISPLAY_SLOP_PX
    && bounds.x + bounds.width >= displayFrame.x + displayFrame.width - FULL_DISPLAY_SLOP_PX
    && bounds.y + bounds.height >= displayFrame.y + displayFrame.height - FULL_DISPLAY_SLOP_PX;
}

// Parses a Dock crash-marker file. Markers written by this build are JSON
// { autohide: '0'|'absent', delay: string|'absent' } — both prior values, so a crash recovery can
// restore the user's reveal delay instead of deleting it. The very first markers held only the
// autohide value; for those the delay prior is unknowable and treated as 'absent' (the historical
// recovery deleted the zeroed key). Returns null for unreadable/unknown content so the caller can
// drop the marker instead of acting on it. Pure so recovery is unit-testable without fs.
function parseDockMarker(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return null;
  let autohide;
  let delay;
  if (trimmed[0] === '{') {
    try {
      const parsed = JSON.parse(trimmed);
      autohide = parsed.autohide;
      delay = parsed.delay;
    } catch (e) {
      return null;
    }
  } else {
    autohide = trimmed;
    delay = 'absent';
  }
  // A marker is only ever written when the Dock is about to be hidden, which never happens when
  // the user's prior autohide is already '1'; anything else is not a marker we wrote.
  if (autohide !== '0' && autohide !== 'absent') return null;
  if (typeof delay !== 'string' || delay.length === 0) delay = 'absent';
  return { autohide, delay };
}

// Marker file name (inside userData): records the user's pre-wallpaper Dock state (autohide and
// reveal delay) so a hard crash while the Dock is hidden can be recovered on the next launch.
const MAC_WALLPAPER_DOCK_MARKER = '.wallpaper-dock-autohidden';

// Headless self-test / unit probes must not restart the real Dock or pop the Input Monitoring
// prompt. An explicit `override` (from options.testMode) wins over the env switch.
function isMacWallpaperTestMode(env, override) {
  if (typeof override === 'boolean') return override;
  return env.FOLIA_MAC_WALLPAPER_SELFTEST === '1';
}

// --- FFI state (lazily initialised once per process) ---
let windowLevelState = null;
let eventTapState = null;

function initWindowLevel() {
  if (windowLevelState) return windowLevelState;
  if (process.platform !== 'darwin') {
    windowLevelState = { ok: false, reason: 'not-darwin' };
    return windowLevelState;
  }
  try {
    // objc_msgSend must be declared once per concrete prototype (arm64 requires exact sigs).
    const koffi = require('koffi');
    const objc = koffi.load('/usr/lib/libobjc.A.dylib');
    const sel_registerName = objc.func('void* sel_registerName(const char*)');
    const objc_getClass = objc.func('void* objc_getClass(const char*)');
    const msgSend_ptr = objc.func('objc_msgSend', 'void*', ['void*', 'void*']);
    const msgSend_long = objc.func('objc_msgSend', 'long', ['void*', 'void*']);
    const msgSend_ulong = objc.func('objc_msgSend', 'unsigned long', ['void*', 'void*']);
    const msgSend_v_long = objc.func('objc_msgSend', 'void', ['void*', 'void*', 'long']);
    const msgSend_v_ulong = objc.func('objc_msgSend', 'void', ['void*', 'void*', 'unsigned long']);
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const CGWindowLevelForKey = cg.func('int32 CGWindowLevelForKey(int32)');
    const kCGDesktopIconWindowLevelKey = 18;
    const desktopLevel = computeDesktopLevel(CGWindowLevelForKey(kCGDesktopIconWindowLevelKey));

    const selCache = new Map();
    const SEL = (s) => {
      let v = selCache.get(s);
      if (!v) {
        v = sel_registerName(s);
        selCache.set(s, v);
      }
      return v;
    };

    windowLevelState = {
      ok: true,
      koffi,
      SEL,
      objc_getClass,
      msgSend_ptr,
      msgSend_long,
      msgSend_ulong,
      msgSend_v_long,
      msgSend_v_ulong,
      desktopLevel,
    };
  } catch (e) {
    console.warn('[WallpaperMac] level FFI init failed:', e && e.message);
    windowLevelState = { ok: false, reason: e && e.message };
  }
  return windowLevelState;
}

function initEventTap() {
  if (eventTapState) return eventTapState;
  if (process.platform !== 'darwin') {
    eventTapState = { ok: false, reason: 'not-darwin' };
    return eventTapState;
  }
  try {
    const koffi = require('koffi');
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    const libc = koffi.load('/usr/lib/libSystem.B.dylib');

    koffi.struct('FOLIA_CGPoint', { x: 'double', y: 'double' });
    // Display-frame queries: the Finder desktop backdrop and the Dock's full-display surface are
    // recognised by comparing their bounds against the display that contains the probe point.
    koffi.struct('FOLIA_CGRect', { x: 'double', y: 'double', width: 'double', height: 'double' });

    const fn = {
      CGEventGetLocation: cg.func('FOLIA_CGPoint CGEventGetLocation(void *event)'),
      CGEventGetIntegerValueField: cg.func('int64 CGEventGetIntegerValueField(void *event, uint32 field)'),
      CGEventTapCreate: cg.func('void *CGEventTapCreate(uint32 tap, uint32 place, uint32 options, uint64 mask, void *cb, void *userInfo)'),
      CGEventTapEnable: cg.func('void CGEventTapEnable(void *port, bool enable)'),
      CGPreflightListenEventAccess: cg.func('bool CGPreflightListenEventAccess(void)'),
      CGRequestListenEventAccess: cg.func('void CGRequestListenEventAccess(void)'),
      CGWindowListCopyWindowInfo: cg.func('void *CGWindowListCopyWindowInfo(uint32 option, uint32 rel)'),
      CGRectMakeWithDictionaryRepresentation: cg.func('bool CGRectMakeWithDictionaryRepresentation(void *dict, _Out_ void *rect)'),
      CGGetDisplaysWithPoint: cg.func('uint32 CGGetDisplaysWithPoint(uint32 maxDisplays, FOLIA_CGPoint point, _Out_ void *displays, _Out_ void *count)'),
      CGDisplayBounds: cg.func('FOLIA_CGRect CGDisplayBounds(uint32 display)'),
      CFMachPortCreateRunLoopSource: cf.func('void *CFMachPortCreateRunLoopSource(void *allocator, void *port, long order)'),
      CFRunLoopGetMain: cf.func('void *CFRunLoopGetMain(void)'),
      CFRunLoopAddSource: cf.func('void CFRunLoopAddSource(void *rl, void *source, void *mode)'),
      CFRunLoopRemoveSource: cf.func('void CFRunLoopRemoveSource(void *rl, void *source, void *mode)'),
      CFArrayGetCount: cf.func('long CFArrayGetCount(void *arr)'),
      CFArrayGetValueAtIndex: cf.func('void *CFArrayGetValueAtIndex(void *arr, long i)'),
      CFDictionaryGetValue: cf.func('void *CFDictionaryGetValue(void *d, void *k)'),
      CFNumberGetValue: cf.func('bool CFNumberGetValue(void *num, int type, _Out_ void *out)'),
      CFRelease: cf.func('void CFRelease(void *p)'),
      dlopen: libc.func('void *dlopen(const char *path, int flags)'),
      dlsym: libc.func('void *dlsym(void *handle, const char *name)'),
    };

    const handle = fn.dlopen(null, 1);
    const exportedConst = (name) => koffi.decode(fn.dlsym(handle, name), 'void *'); // deref the exported CFStringRef var
    const consts = {
      commonModes: exportedConst('kCFRunLoopCommonModes'),
      kWindowLayer: exportedConst('kCGWindowLayer'),
      kWindowBounds: exportedConst('kCGWindowBounds'),
      kWindowOwnerPID: exportedConst('kCGWindowOwnerPID'),
      kWindowAlpha: exportedConst('kCGWindowAlpha'),
    };

    const TapProto = koffi.proto('void *FOLIA_TapCb(void *proxy, uint32 type, void *event, void *userInfo)');
    eventTapState = {
      ok: true,
      koffi,
      fn,
      consts,
      TapProto,
      tap: null,
      source: null,
      cb: null,
      forward: null,
      hitTest: null,
      leftDownDesktop: false,
      rightDownDesktop: false,
      lastMoveAt: 0,
    };
  } catch (e) {
    eventTapState = { ok: false, reason: e && e.message };
  }
  return eventTapState;
}

// Cached pid of the Dock process: isDesktopPoint restricts the Dock pass-through to its
// full-display surface (see DOCK_UI_LAYER_LIMIT), so the pid is resolved lazily once and
// re-resolved if the cached pid goes away (killall Dock).
let dockOwnerPid = null;
function currentDockOwnerPid() {
  if (dockOwnerPid !== null) {
    try {
      process.kill(dockOwnerPid, 0); // 0 = existence probe
      return dockOwnerPid;
    } catch (e) {
      dockOwnerPid = null;
    }
  }
  try {
    const { execFileSync } = require('child_process');
    const out = String(execFileSync('/usr/bin/pgrep', ['-x', 'Dock'], { encoding: 'utf8', timeout: 3000 })).trim();
    const pid = Number(out.split('\n')[0]);
    dockOwnerPid = Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    dockOwnerPid = null;
  }
  return dockOwnerPid;
}

// Is the global screen point on the bare desktop (no app/Dock/widget window on top)? Reads the
// live on-screen window list and returns false when any window with a layer above the Finder
// desktop covers the point. Only layer + bounds + owner pid + alpha are read — never window
// names — so this does not trigger Screen Recording permission.
//
// The Finder desktop surface (icons + empty desktop) sits AT FINDER_DESKTOP_LAYER and spans the
// whole display. It must not be treated as a covering window — that would make every point
// "covered" and the wallpaper dead to input — so only the full-display Finder backdrop passes
// through. Smaller surfaces at that layer (per-icon Finder windows on macOS versions that list
// them, desktop widgets) still cover the point and stop forwarding, so a click on a desktop file
// is not re-injected into the wallpaper underneath while Finder opens it. The Dock gets the same
// rule: only its full-display surface (the auto-hide tracking window; measured as one
// full-display layer-20 window in every Dock state on macOS 26) is pass-through chrome — a
// visible, bar-sized Dock window keeps covering.
function isDesktopPoint(x, y) {
  const s = eventTapState;
  if (!s || !s.ok) return false;
  let arr = null;
  try {
    // Display frame of the display containing (x, y), resolved lazily and cached per probe: only
    // the desktop-/dock-layer surfaces need it, and they are few.
    let pointDisplayFrame;
    const displayFrameAtPoint = () => {
      if (pointDisplayFrame === undefined) {
        pointDisplayFrame = null;
        try {
          const displays = Buffer.alloc(8 * 4);
          const displayCount = Buffer.alloc(4);
          if (s.fn.CGGetDisplaysWithPoint(8, { x, y }, displays, displayCount) === 0
            && displayCount.readUInt32LE(0) > 0) {
            const frame = s.fn.CGDisplayBounds(displays.readUInt32LE(0));
            pointDisplayFrame = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
          }
        } catch (e) {
          // ignore: unresolved frame falls back to "full display" below
        }
      }
      return pointDisplayFrame;
    };
    // Full-display system chrome at a desktop/dock layer is not a covering window. When the
    // display frame cannot be resolved the surface keeps the historical unconditional pass, so a
    // probe failure cannot make the wallpaper unclickable.
    const isPassThroughFullDisplay = (bx0, by0, bw0, bh0) => {
      const frame = displayFrameAtPoint();
      return !frame || isFullDisplaySurface({ x: bx0, y: by0, width: bw0, height: bh0 }, frame);
    };
    arr = s.fn.CGWindowListCopyWindowInfo(1 /*onScreenOnly*/, 0);
    if (!arr) return false;
    const count = Number(s.fn.CFArrayGetCount(arr));
    const numBuf = Buffer.alloc(8);
    const rect = Buffer.alloc(32);
    for (let i = 0; i < count; i++) {
      const dict = s.fn.CFArrayGetValueAtIndex(arr, i);
      if (!dict) continue;
      const layerValue = s.fn.CFDictionaryGetValue(dict, s.consts.kWindowLayer);
      if (!layerValue) continue;
      s.fn.CFNumberGetValue(layerValue, 3 /*SInt32*/, numBuf);
      const layer = numBuf.readInt32LE(0);
      // Strictly BELOW the Finder desktop layer: the wallpaper picture surfaces — never "on top".
      if (layer < FINDER_DESKTOP_LAYER) continue;
      if (layer < 0) {
        // Only desktop-adjacent surfaces are probed: they are few, so reading the alpha key stays
        // cheap (normal-layer windows are many and never skipped by transparency).
        const alphaValue = s.fn.CFDictionaryGetValue(dict, s.consts.kWindowAlpha);
        if (alphaValue) {
          s.fn.CFNumberGetValue(alphaValue, 6 /*Float64*/, numBuf);
          if (isTransparentDesktopSurface(layer, numBuf.readDoubleLE(0))) continue;
        }
      }
      let ownerPid = null;
      const pidValue = s.fn.CFDictionaryGetValue(dict, s.consts.kWindowOwnerPID);
      if (pidValue) {
        s.fn.CFNumberGetValue(pidValue, 3 /*SInt32*/, numBuf);
        ownerPid = numBuf.readInt32LE(0);
      }
      // Our own wallpaper window: WindowServer lists the simple-full-screen presentation at the
      // full-screen layer spanning the whole display, so it must not "cover" every desktop point.
      if (ownerPid === process.pid && layer >= FULLSCREEN_PRESENTATION_LAYER) continue;
      // Our own click catchers over the wallpaper's controls (macWallpaperHitPanels.cjs) sit one
      // level above the Finder icons: they take the click away from Finder, the wallpaper still
      // gets it from here.
      if (ownerPid === process.pid && layer < 0) continue;
      const boundsValue = s.fn.CFDictionaryGetValue(dict, s.consts.kWindowBounds);
      if (!boundsValue) continue;
      if (!s.fn.CGRectMakeWithDictionaryRepresentation(boundsValue, rect)) continue;
      const bx = rect.readDoubleLE(0);
      const by = rect.readDoubleLE(8);
      const bw = rect.readDoubleLE(16);
      const bh = rect.readDoubleLE(24);
      if (x < bx || x >= bx + bw || y < by || y >= by + bh) continue; // not under the cursor
      if (layer === FINDER_DESKTOP_LAYER) {
        // The Finder backdrop spans the whole display; only that passes through. Anything smaller
        // at the desktop layer is an actual surface (an icon window on macOS versions that expose
        // them) and blocks forwarding.
        if (isPassThroughFullDisplay(bx, by, bw, bh)) continue;
        return false;
      }
      if (ownerPid !== null && ownerPid === currentDockOwnerPid() && layer <= DOCK_UI_LAYER_LIMIT) {
        // Only the Dock's full-display tracking surface passes through; a visible bar-sized Dock
        // window is real chrome and blocks forwarding.
        if (isPassThroughFullDisplay(bx, by, bw, bh)) continue;
        return false;
      }
      return false; // covered by something above
    }
    return true;
  } catch (e) {
    return false;
  } finally {
    if (arr) {
      try {
        s.fn.CFRelease(arr);
      } catch (e) {
        // ignore
      }
    }
  }
}

function nswindowFor(win) {
  const s = initWindowLevel();
  if (!s.ok || !win || win.isDestroyed()) return null;
  try {
    const view = s.koffi.decode(win.getNativeWindowHandle(), 'void *'); // NSView*
    if (!view) return null;
    return s.msgSend_ptr(view, s.SEL('window')); // [view window] -> NSWindow*
  } catch (e) {
    return null;
  }
}

function readWindowOcclusionState(win) {
  const s = initWindowLevel();
  const w = nswindowFor(win);
  if (!s.ok || !w) return null;
  try {
    return Number(s.msgSend_ulong(w, s.SEL('occlusionState')));
  } catch (e) {
    return null;
  }
}

// NSApplicationPresentationOptions bits Electron's simple-full-screen emulation sets APP-WIDE
// (not per window): AutoHideDock | AutoHideMenuBar. They apply whenever this app is frontmost.
// Electron's simple-full-screen EXIT restores the options that were current when the window
// ENTERED; when a window is destroyed while still in simple full screen no exit runs, the bits
// survive, and the next session captures them as "the value to restore" — stranding macOS in
// auto-hide every time the app is focused. Only these two bits are ever cleared here; the
// FullScreen bit is owned by the system during native transitions and must never be touched
// (clearing it mid-transition is what made an earlier fix loop).
const NS_PRESENTATION_AUTOHIDE_DOCK = 1 << 0;
const NS_PRESENTATION_AUTOHIDE_MENU_BAR = 1 << 2;

function sharedApplication() {
  const s = initWindowLevel();
  if (!s.ok) return null;
  try {
    let nsApplicationClass = s.objc_getClass('NSApplication');
    if (!nsApplicationClass) {
      // AppKit is loaded in the Electron main process, but stay self-sufficient: load it so the
      // class exists (mirrors the dlopen pattern of the event-tap init).
      try {
        const libc = s.koffi.load('/usr/lib/libSystem.B.dylib');
        const dlopen = libc.func('void *dlopen(const char *path, int flags)');
        dlopen('/System/Library/Frameworks/AppKit.framework/AppKit', 2 /*RTLD_NOW*/);
        nsApplicationClass = s.objc_getClass('NSApplication');
      } catch (e) {
        // ignore
      }
    }
    if (!nsApplicationClass) return null;
    return s.msgSend_ptr(nsApplicationClass, s.SEL('sharedApplication'));
  } catch (e) {
    return null;
  }
}

// Clears the app-level AutoHideDock|AutoHideMenuBar presentation bits (fail-soft no-op when the
// bridge is unavailable). It clears the app's REQUESTED options ([NSApp presentationOptions],
// which persist regardless of whether this app is frontmost) — reading
// currentSystemPresentationOptions instead would miss the bits while the app is inactive and
// let the auto-hide resurface on the next activation. Callers run this only after a wallpaper
// session has fully torn down (window restored or gone). Calling setPresentationOptions: while
// the wallpaper window is still in simple full screen makes AppKit re-adjust every window and
// re-enter this call — measured: infinite recursion pegging the main thread. Only these two
// bits are ever cleared; never the FullScreen bit (clearing that mid-transition made an
// earlier fix loop).
function clearAutoHidePresentationOptions() {
  const s = initWindowLevel();
  const app = s && s.ok ? sharedApplication() : null;
  if (!app) return false;
  try {
    const requested = Number(s.msgSend_ulong(app, s.SEL('presentationOptions')));
    const mask = NS_PRESENTATION_AUTOHIDE_DOCK | NS_PRESENTATION_AUTOHIDE_MENU_BAR;
    if ((requested & mask) !== 0) {
      s.msgSend_v_ulong(app, s.SEL('setPresentationOptions:'), (requested & ~mask) >>> 0);
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Creates the controller. Every system effect is injectable so headless tests exercise the Dock
// and permission state machines without touching `defaults` / killall or the Input Monitoring
// prompt.
function createMacWallpaperController(options = {}) {
  const {
    store,
    userDataPath = () => null,
    execFile = require('child_process').execFile,
    execFileSync = require('child_process').execFileSync,
    fsModule = require('fs'),
    env = process.env,
    platform = process.platform,
    testMode = isMacWallpaperTestMode(env),
    logWarn = console.warn.bind(console),
  } = options;

  // The user's Dock state before WE touched it; null means this session never changed it.
  let dockPriorAutohide = null; // '0' | '1' | 'absent'
  let dockPriorAutohideDelay = null; // raw string | 'absent'

  function dockAllowed() {
    return platform === 'darwin' && !testMode;
  }

  function resolveDockMarkerPath() {
    try {
      const dir = typeof userDataPath === 'function' ? userDataPath() : userDataPath;
      return dir ? require('path').join(dir, MAC_WALLPAPER_DOCK_MARKER) : null;
    } catch (e) {
      return null;
    }
  }

  function writeDockMarker(priorAutohide, priorDelay) {
    const p = resolveDockMarkerPath();
    if (!p) return;
    try {
      fsModule.writeFileSync(p, JSON.stringify({ autohide: priorAutohide, delay: priorDelay }));
    } catch (e) {
      // ignore
    }
  }

  function clearDockMarker() {
    const p = resolveDockMarkerPath();
    if (!p) return;
    try {
      if (fsModule.existsSync(p)) fsModule.unlinkSync(p);
    } catch (e) {
      // ignore
    }
  }

  // Dock `defaults` writes + `killall Dock` are async chains over the SAME preference keys, so two
  // overlapping chains (startup crash recovery + wallpaper re-enter, or a quick exit -> re-enter)
  // would interleave writes and leave the Dock state and the marker disagreeing. Every async Dock
  // transition therefore runs on one FIFO promise queue, and each op performs its reads when its
  // turn comes — no op can observe a state the previous op is still mutating.
  let dockOpTail = Promise.resolve();
  function dockEnqueue(op) {
    const next = dockOpTail.then(() => op());
    dockOpTail = next.catch(() => undefined);
    return next;
  }

  // `defaults read` for a Dock key; 'absent' when the key is missing or unreadable.
  function readDockPref(arg) {
    try {
      const out = execFileSync('/usr/bin/defaults', ['read', 'com.apple.dock', arg], { timeout: 4000 });
      return String(out || '').trim();
    } catch (e) {
      return 'absent';
    }
  }

  // Runs one step of a Dock transition; resolves after the execFile callback (never rejects).
  function execDockStep(cmd, args, warnPrefix) {
    return new Promise((resolve) => {
      try {
        execFile(cmd, args, (err) => {
          if (err && warnPrefix) logWarn(warnPrefix, err && err.message);
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  // Auto-hide the Dock (and drop the reveal delay to zero so it pops up instantly on mouse
  // approach) while the wallpaper is up. Reads the user's prior autohide only once, so a later
  // restore puts the Dock back exactly as it was.
  function setDockAutohide(on) {
    return dockEnqueue(async () => {
      if (!dockAllowed()) return;
      try {
        if (dockPriorAutohide === null) {
          const prior = readDockPref('autohide');
          dockPriorAutohide = (prior === '0' || prior === '1') ? prior : 'absent';
        }
        if (on && dockPriorAutohide === '1') return; // already auto-hidden -> nothing to change
        if (on) {
          // Read BOTH prior values before mutating anything, then write the marker with both:
          // a crash after the reveal delay is zeroed must recover the user's custom delay, not
          // delete the preference (the delay was previously read after the marker write, so a
          // crash in between left recovery with no delay to restore).
          if (dockPriorAutohideDelay === null) {
            dockPriorAutohideDelay = readDockPref('autohide-delay');
          }
          writeDockMarker(dockPriorAutohide, dockPriorAutohideDelay);
          await execDockStep('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide-delay', '-float', '0'], '[WallpaperMac] autohide-delay write failed:');
          await execDockStep('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide', '-bool', 'true'], '[WallpaperMac] autohide write failed:');
          await execDockStep('/usr/bin/killall', ['Dock'], '[WallpaperMac] Dock restart failed:');
        } else {
          await execDockStep('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide', '-bool', 'false'], '[WallpaperMac] autohide write failed:');
          await execDockStep('/usr/bin/killall', ['Dock'], '[WallpaperMac] Dock restart failed:');
          clearDockMarker();
        }
      } catch (e) {
        // ignore
      }
    });
  }

  // Which edge the Dock sits on, as macOS reports it (`bottom` | `left` | `right`). Only a bottom
  // Dock overlaps the wallpaper's lower content, so the automatic (setting-unset) hide is gated on
  // this; an explicit user on/off skips the gate in main.cjs. Injectable execFileSync keeps it
  // headless-testable; any read failure fails soft to "not bottom" (no position change).
  function isDockAtBottom() {
    if (platform !== 'darwin') return false;
    try {
      const out = String(execFileSync('/usr/bin/defaults', ['read', 'com.apple.dock', 'orientation'], { timeout: 4000 }) || '').trim().toLowerCase();
      return out === 'bottom';
    } catch (e) {
      return false;
    }
  }

  // Restore the Dock to the user's prior autohide state (async; used on wallpaper exit while the
  // app keeps running). Runs on the Dock op queue like every other async Dock transition.
  async function restoreDockInner() {
    if (platform !== 'darwin' || dockPriorAutohide === null) return;
    const prior = dockPriorAutohide;
    const priorDelay = dockPriorAutohideDelay;
    dockPriorAutohide = null;
    dockPriorAutohideDelay = null;
    if (prior === '1') return; // we never changed it -> no marker, no delay change
    try {
      if (priorDelay === null || priorDelay === 'absent') {
        await execDockStep('/usr/bin/defaults', ['delete', 'com.apple.dock', 'autohide-delay'], '[WallpaperMac] Dock restore failed:');
      } else {
        await execDockStep('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide-delay', '-float', priorDelay], '[WallpaperMac] Dock restore failed:');
      }
      if (prior === 'absent') {
        await execDockStep('/usr/bin/defaults', ['delete', 'com.apple.dock', 'autohide'], '[WallpaperMac] Dock restore failed:');
      } else {
        await execDockStep('/usr/bin/defaults', ['write', 'com.apple.dock', 'autohide', '-bool', 'false'], '[WallpaperMac] Dock restore failed:');
      }
      // clear only AFTER the restore lands
      await execDockStep('/usr/bin/killall', ['Dock'], '[WallpaperMac] Dock restart failed:');
      clearDockMarker();
    } catch (e) {
      // ignore
    }
  }

  function restoreDock() {
    return dockEnqueue(restoreDockInner);
  }

  // Synchronous restore for before-quit: the process may die mid-restore, so use execFileSync
  // (killall Dock included) rather than racing the async chain.
  function restoreDockSync() {
    if (platform !== 'darwin' || dockPriorAutohide === null) return;
    const prior = dockPriorAutohide;
    const priorDelay = dockPriorAutohideDelay;
    dockPriorAutohide = null;
    dockPriorAutohideDelay = null;
    if (prior === '1') return;
    const run = (args) => {
      try {
        execFileSync('/usr/bin/defaults', args, { timeout: 4000 });
      } catch (e) {
        // ignore
      }
    };
    try {
      if (prior === 'absent') run(['delete', 'com.apple.dock', 'autohide']);
      else run(['write', 'com.apple.dock', 'autohide', '-bool', 'false']);
      if (priorDelay === null || priorDelay === 'absent') run(['delete', 'com.apple.dock', 'autohide-delay']);
      else run(['write', 'com.apple.dock', 'autohide-delay', '-float', priorDelay]);
      execFileSync('/usr/bin/killall', ['Dock'], { timeout: 4000 });
      clearDockMarker();
    } catch (e) {
      // ignore
    }
  }

  // On startup: a surviving marker means a previous session auto-hid the Dock and died before
  // restoring it. Restore the user's prior autohide AND reveal delay so they never open to a
  // permanently auto-hidden Dock or a silently deleted autohide-delay preference. Runs on the
  // Dock op queue BEFORE any later enter's hide, so that hide reads the restored state — never
  // the still-hidden crash state — as "the user's" preference.
  function recoverStrandedDock() {
    return dockEnqueue(async () => {
      if (platform !== 'darwin' || testMode) return;
      const p = resolveDockMarkerPath();
      if (!p) return;
      try {
        if (!fsModule.existsSync(p)) return;
        const marker = parseDockMarker(fsModule.readFileSync(p, 'utf8'));
        if (!marker) {
          // Unknown / unreadable marker: nothing trustworthy to restore; drop it so recovery
          // does not repeat forever (and does not reset unrelated Dock preferences).
          clearDockMarker();
          return;
        }
        dockPriorAutohide = marker.autohide; // marker never stores '1'
        dockPriorAutohideDelay = marker.delay;
        await restoreDockInner();
      } catch (e) {
        // ignore
      }
    });
  }

  function configureDockRecovery() {
    // Resolves (and thereby validates) the marker path now; recovery is a separate call so the
    // controller can be created before userData is available and configured once it is.
    return resolveDockMarkerPath();
  }

  // --- Tap lifecycle ---
  // forward(evt) receives only desktop-verified events:
  //   { kind: 'down'|'up'|'drag'|'rdown'|'rup'|'rdrag'|'move'|'scroll', x, y, dx?, dy? }
  function listenAccessGranted() {
    const s = initEventTap();
    if (!s.ok) return false;
    try {
      return !!s.fn.CGPreflightListenEventAccess();
    } catch (e) {
      return false;
    }
  }

  // start(forward, hitTest?): forward receives desktop-verified events. When a hitTest(x, y)
  // predicate is given (main.cjs passes "is this point inside the wallpaper window"), initial
  // events (down/rdown/move/scroll) must also pass it, so bare-desktop events on OTHER displays
  // — where the wallpaper window does not exist — never start a gesture. drag/up follow the
  // remembered start and are not re-gated, so a drag that leaves the window still ends cleanly.
  function start(forward, hitTest = null) {
    const s = initEventTap();
    if (!s.ok) return false;
    if (s.tap) return true; // already running
    if (!listenAccessGranted()) return false;
    try {
      s.forward = forward;
      s.hitTest = hitTest || null;
      const mask = (1n << BigInt(kCGEventLeftMouseDown))
        | (1n << BigInt(kCGEventLeftMouseUp))
        | (1n << BigInt(kCGEventLeftMouseDragged))
        | (1n << BigInt(kCGEventMouseMoved))
        | (1n << BigInt(kCGEventRightMouseDown))
        | (1n << BigInt(kCGEventRightMouseUp))
        | (1n << BigInt(kCGEventRightMouseDragged))
        | (1n << BigInt(kCGEventScrollWheel));
      const onWallpaper = (x, y) => !s.hitTest || s.hitTest(x, y);
      s.cb = s.koffi.register((proxy, type, event) => {
        try {
          if (type === kCGEventTapDisabledByTimeout || type === kCGEventTapDisabledByUserInput) {
            // The system disabled the tap (timeout or user input); re-arm it in place.
            if (s.tap) s.fn.CGEventTapEnable(s.tap, true);
            return event;
          }
          const kind = classifyMacTapEventType(type);
          if (!kind || !forward) return event;
          const loc = s.fn.CGEventGetLocation(event);
          const x = loc.x;
          const y = loc.y;
          if (kind === 'down') {
            s.leftDownDesktop = onWallpaper(x, y) && isDesktopPoint(x, y);
            if (s.leftDownDesktop) forward({ kind, x, y });
          } else if (kind === 'up') {
            if (s.leftDownDesktop) forward({ kind, x, y });
            s.leftDownDesktop = false;
          } else if (kind === 'rdown') {
            s.rightDownDesktop = onWallpaper(x, y) && isDesktopPoint(x, y);
            if (s.rightDownDesktop) forward({ kind, x, y });
          } else if (kind === 'rup') {
            if (s.rightDownDesktop) forward({ kind, x, y });
            s.rightDownDesktop = false;
          } else if (kind === 'drag' || kind === 'rdrag') {
            // Dragging follows the remembered desktop start; no per-event CGWindowList probe.
            const startedOnDesktop = kind === 'drag' ? s.leftDownDesktop : s.rightDownDesktop;
            if (startedOnDesktop) forward({ kind, x, y });
          } else if (kind === 'move') {
            // Time-throttle hover forwarding: timestamp compare, no timer to leak.
            const now = Date.now();
            if (now - (s.lastMoveAt || 0) >= MOVE_THROTTLE_MS) {
              s.lastMoveAt = now;
              if (onWallpaper(x, y) && isDesktopPoint(x, y)) forward({ kind, x, y });
            }
          } else if (kind === 'scroll') {
            if (onWallpaper(x, y) && isDesktopPoint(x, y)) {
              const dy = Number(s.fn.CGEventGetIntegerValueField(event, 11)); // ScrollWheelEventDeltaAxis1
              const dx = Number(s.fn.CGEventGetIntegerValueField(event, 12)); // ScrollWheelEventDeltaAxis2
              forward({ kind, x, y, dx, dy });
            }
          }
        } catch (e) {
          // never let a tap callback throw into WindowServer
        }
        return event;
      }, s.koffi.pointer(s.TapProto));

      s.tap = s.fn.CGEventTapCreate(1 /*session*/, 0 /*headInsert*/, 1 /*listenOnly*/, mask, s.cb, null);
      if (!s.tap) {
        // Permission missing -> NULL; unregister the trampoline so it does not leak.
        try {
          s.koffi.unregister(s.cb);
        } catch (e) {
          // ignore
        }
        s.cb = null;
        s.forward = null;
        s.hitTest = null;
        return false;
      }
      s.fn.CGEventTapEnable(s.tap, true);
      s.source = s.fn.CFMachPortCreateRunLoopSource(null, s.tap, 0);
      const rl = s.fn.CFRunLoopGetMain(); // Electron's main thread runs this CFRunLoop -> callback fires
      s.fn.CFRunLoopAddSource(rl, s.source, s.consts.commonModes);
      return true;
    } catch (e) {
      try {
        stop(); // free of `this`: start must keep working even if detached from the controller
      } catch (_) {
        // ignore
      }
      return false;
    }
  }

  function stop() {
    const s = eventTapState;
    if (!s || !s.ok) return;
    try {
      if (s.tap) s.fn.CGEventTapEnable(s.tap, false);
      if (s.source) {
        const rl = s.fn.CFRunLoopGetMain();
        s.fn.CFRunLoopRemoveSource(rl, s.source, s.consts.commonModes);
      }
      // Free what we own (source + tap follow the CF Create rule, +1 each), then the koffi
      // callback trampoline. Order: disable + remove from the runloop FIRST so no in-flight
      // callback can touch freed memory, then release the source, the port, and the trampoline.
      if (s.source) s.fn.CFRelease(s.source);
      if (s.tap) s.fn.CFRelease(s.tap);
      if (s.cb) s.koffi.unregister(s.cb);
    } catch (e) {
      // ignore
    }
    s.tap = null;
    s.source = null;
    s.cb = null;
    s.forward = null;
    s.hitTest = null;
    s.leftDownDesktop = false;
    s.rightDownDesktop = false;
    s.lastMoveAt = 0;
  }

  function isRunning() {
    return !!(eventTapState && eventTapState.ok && eventTapState.tap);
  }

  return {
    isAvailable() {
      return initWindowLevel().ok === true && initEventTap().ok === true;
    },
    reason() {
      return (initWindowLevel().reason || initEventTap().reason) || null;
    },
    desktopLevel() {
      return initWindowLevel().desktopLevel;
    },
    normalLevel() {
      return 0; // NSNormalWindowLevel
    },
    setLevel(win, level) {
      const s = initWindowLevel();
      const w = nswindowFor(win);
      if (!s.ok || !w) return false;
      try {
        s.msgSend_v_long(w, s.SEL('setLevel:'), level);
        return true;
      } catch (e) {
        logWarn('[WallpaperMac] setLevel failed:', e && e.message);
        return false;
      }
    },
    getLevel(win) {
      const s = initWindowLevel();
      const w = nswindowFor(win);
      if (!s.ok || !w) return null;
      try {
        return Number(s.msgSend_long(w, s.SEL('level')));
      } catch (e) {
        return null;
      }
    },
    // Raw NSWindowCollectionBehavior bits; normally Electron's
    // setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) already sets the all-spaces
    // + FullScreenAuxiliary bits we need, so main.cjs should NOT additionally call this with a
    // bare 81 mask (81 lacks FullScreenAuxiliary and would clobber the Electron-set bits).
    setCollectionBehavior(win, mask) {
      const s = initWindowLevel();
      const w = nswindowFor(win);
      if (!s.ok || !w) return false;
      try {
        s.msgSend_v_ulong(w, s.SEL('setCollectionBehavior:'), mask >>> 0);
        return true;
      } catch (e) {
        logWarn('[WallpaperMac] setCollectionBehavior failed:', e && e.message);
        return false;
      }
    },
    getOcclusionState(win) {
      return readWindowOcclusionState(win);
    },
    isVisibleByOcclusion(win) {
      const state = readWindowOcclusionState(win);
      if (state === null || state === undefined) return null;
      return (state & (1 << 1)) !== 0; // NSWindowOcclusionState.visible bit
    },

    // Clears the app-level AutoHide menu-bar/Dock presentation bits Electron's simple
    // full screen sets (see clearAutoHidePresentationOptions). Called by main.cjs after every
    // wallpaper teardown so a stale capture can never strand the menu bar / Dock in auto-hide.
    clearAutoHidePresentationOptions() {
      return clearAutoHidePresentationOptions();
    },
    hasPermission() {
      return listenAccessGranted();
    },
    // Surfaces the macOS Input Monitoring prompt (only effective once per app identity). The
    // user must enable Folia in System Settings if the preflight still reports false.
    requestPermission() {
      const s = initEventTap();
      if (!s.ok) return false;
      try {
        s.fn.CGRequestListenEventAccess();
        return true;
      } catch (e) {
        return false;
      }
    },
    isDesktopPoint,
    start,
    stop,
    isRunning,
    isDockAtBottom,
    setDockAutohide,
    restoreDock,
    restoreDockSync,
    recoverStrandedDock,
    configureDockRecovery,
    hasDockPriorState: () => dockPriorAutohide !== null,
    // Pure helpers exposed for headless unit tests and main.cjs diagnostics.
    MOVE_THROTTLE_MS,
    FINDER_DESKTOP_LAYER,
  };
}

module.exports = {
  WALLPAPER_MODE_SETTING_KEY,
  MAC_WALLPAPER_DOCK_MARKER,
  FINDER_DESKTOP_LAYER,
  DOCK_UI_LAYER_LIMIT,
  MOVE_THROTTLE_MS,
  kCGEventTapDisabledByTimeout,
  kCGEventTapDisabledByUserInput,
  classifyMacTapEventType,
  computeDesktopLevel,
  isTransparentDesktopSurface,
  isFullDisplaySurface,
  parseDockMarker,
  createMacWallpaperController,
  isMacWallpaperTestMode,
};
