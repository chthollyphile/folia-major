// electron/wallpaper/macWallpaperHitPanels.cjs
// macOS wallpaper mode: click catchers over the wallpaper's on-screen controls (issue #698).
//
// The wallpaper window sits below the Finder icons, so a click on the wallpaper lands on Finder's
// desktop window; the listen-only tap (macWallpaperController.cjs) forwards it into the renderer,
// but Finder still receives it, and with Stage Manager on that desktop click brings other apps'
// windows forward. Swallowing the click would need an active tap and the Accessibility grant
// (PR #709). Instead, while the wallpaper's controls (bottom capsule, panel toggle, panel, toasts)
// are on screen, a fully transparent, borderless, non-activating NSPanel is placed over each one,
// one level above the Finder icons and below every normal window: the click lands on our own
// panel, which never activates Folia, Finder never sees it, and Stage Manager does not react
// (measured on macOS 15.3 with Stage Manager on, 2026-10-19). The tap still sees the click and
// forwards it as before: isDesktopPoint lets our own desktop-adjacent windows through.
//
// The panels are plain AppKit windows made through koffi (no BrowserWindow, no renderer process),
// so they cost next to no memory. Desktop icons under a panel cannot be clicked while it is up;
// the panels only exist while the controls they cover are shown. Everything is fail-soft: any FFI
// failure leaves the wallpaper as it was before this module existed (clicks reach Finder).
//
// Covering only the controls leaves the rest of the wallpaper (lyrics, empty space, and all of it
// when the controls are set to always hidden) a Finder desktop click, and every such click still
// sends the stage aside. When Stage Manager is on AND hides the desktop items while it is on
// (System Settings > Desktop & Dock > Show Items > In Stage Manager, off), there are no icons to
// click on the desktop, so one catcher covers the whole wallpaper (readStageManagerDesktop). Read
// through CFPreferences, no child process. Otherwise only the controls are covered.

const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL = 1 << 7; // borderless (0) | nonactivatingPanel
const NS_BACKING_STORE_BUFFERED = 2;
// canJoinAllSpaces | stationary | ignoresCycle: present on every Space with the wallpaper, not
// moved by Mission Control, never in the window cycle.
const HIT_PANEL_COLLECTION_BEHAVIOR = 1 | 16 | 64;
// The renderer reports a handful of controls; anything beyond this is a bug, not a layout.
const MAX_HIT_PANELS = 8;
// Smaller than this is a control mid-animation or a sliver left by clipping: not worth a window.
const MIN_HIT_PANEL_SIZE = 4;

// Renderer rects (viewport CSS px) -> global screen points (top-left origin, Electron/Quartz
// space), rounded outward and clipped to the wallpaper window. `zoom` is the page zoom factor.
// Pure so the geometry is unit-testable without AppKit.
function toScreenHitRects(rects, windowBounds, zoom = 1) {
  if (!Array.isArray(rects) || !windowBounds) return [];
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const out = [];
  for (const rect of rects) {
    if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) continue;
    const left = Math.max(windowBounds.x, Math.floor(windowBounds.x + rect.left * scale));
    const top = Math.max(windowBounds.y, Math.floor(windowBounds.y + rect.top * scale));
    const right = Math.min(windowBounds.x + windowBounds.width, Math.ceil(windowBounds.x + (rect.left + rect.width) * scale));
    const bottom = Math.min(windowBounds.y + windowBounds.height, Math.ceil(windowBounds.y + (rect.top + rect.height) * scale));
    if (right - left < MIN_HIT_PANEL_SIZE || bottom - top < MIN_HIT_PANEL_SIZE) continue;
    out.push({ x: left, y: top, width: right - left, height: bottom - top });
    if (out.length >= MAX_HIT_PANELS) break;
  }
  return out;
}

// Electron/Quartz screen rect (origin top-left of the primary display, y down) -> Cocoa frame
// (origin bottom-left of the primary display, y up). Pure.
function toCocoaFrame(rect, primaryHeight) {
  return { x: rect.x, y: primaryHeight - (rect.y + rect.height), w: rect.width, h: rect.height };
}

// Whether the catchers cover the whole wallpaper instead of the controls only. Pure.
function coversWholeWallpaper(stageManager) {
  return !!(stageManager && stageManager.enabled && stageManager.hidesDesktopItems);
}

function sameRects(a, b) {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);
}

let ffiState = null;

function initFfi() {
  if (ffiState) return ffiState;
  if (process.platform !== 'darwin') {
    ffiState = { ok: false, reason: 'not-darwin' };
    return ffiState;
  }
  try {
    const koffi = require('koffi');
    // Own struct name: the controller registers FOLIA_CGPoint / FOLIA_CGRect with other fields.
    koffi.struct('FOLIA_NSRect', { x: 'double', y: 'double', w: 'double', h: 'double' });
    const objc = koffi.load('/usr/lib/libobjc.A.dylib');
    const sel_registerName = objc.func('void* sel_registerName(const char*)');
    const selCache = new Map();
    const SEL = (s) => {
      let v = selCache.get(s);
      if (!v) {
        v = sel_registerName(s);
        selCache.set(s, v);
      }
      return v;
    };
    ffiState = {
      ok: true,
      SEL,
      objc_getClass: objc.func('void* objc_getClass(const char*)'),
      msgSend_ptr: objc.func('objc_msgSend', 'void*', ['void*', 'void*']),
      msgSend_v: objc.func('objc_msgSend', 'void', ['void*', 'void*']),
      msgSend_v_ptr: objc.func('objc_msgSend', 'void', ['void*', 'void*', 'void*']),
      msgSend_v_bool: objc.func('objc_msgSend', 'void', ['void*', 'void*', 'bool']),
      msgSend_v_long: objc.func('objc_msgSend', 'void', ['void*', 'void*', 'long']),
      msgSend_v_ulong: objc.func('objc_msgSend', 'void', ['void*', 'void*', 'unsigned long']),
      msgSend_v_rect_bool: objc.func('objc_msgSend', 'void', ['void*', 'void*', 'FOLIA_NSRect', 'bool']),
      msgSend_init: objc.func('objc_msgSend', 'void*', ['void*', 'void*', 'FOLIA_NSRect', 'unsigned long', 'unsigned long', 'bool']),
    };
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    ffiState.cf = {
      CFStringCreateWithCString: cf.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32 encoding)'),
      CFPreferencesAppSynchronize: cf.func('bool CFPreferencesAppSynchronize(void *app)'),
      CFPreferencesGetAppBooleanValue: cf.func('bool CFPreferencesGetAppBooleanValue(void *key, void *app, _Out_ uint8 *valid)'),
    };
  } catch (e) {
    ffiState = { ok: false, reason: e && e.message };
  }
  return ffiState;
}

// Stage Manager's switch and its "hide desktop items" setting (com.apple.WindowManager
// GloballyEnabled / HideDesktop), re-read from disk each call. null when unreadable.
const kCFStringEncodingUTF8 = 0x08000100;
let stageManagerKeys = null;
function readStageManagerDesktop() {
  const s = initFfi();
  if (!s.ok) return null;
  try {
    if (!stageManagerKeys) {
      // Created once and kept for the process (CF Create rule: we own these three strings).
      const str = (text) => s.cf.CFStringCreateWithCString(null, text, kCFStringEncodingUTF8);
      stageManagerKeys = { app: str('com.apple.WindowManager'), enabled: str('GloballyEnabled'), hide: str('HideDesktop') };
    }
    const { app, enabled, hide } = stageManagerKeys;
    s.cf.CFPreferencesAppSynchronize(app); // pick up a change System Settings made since
    const valid = [0];
    return {
      enabled: s.cf.CFPreferencesGetAppBooleanValue(enabled, app, valid) && valid[0] !== 0,
      hidesDesktopItems: s.cf.CFPreferencesGetAppBooleanValue(hide, app, valid) && valid[0] !== 0,
    };
  } catch (e) {
    return null;
  }
}

// Creates the catcher pool. `level` is the NSWindow level (one above the Finder icons);
// `primaryHeight()` returns the primary display's height in points for the Cocoa flip.
function createMacWallpaperHitPanels({ level, primaryHeight, logWarn = console.warn.bind(console) }) {
  const panels = []; // NSPanel* pointers we own (+1 from alloc/init)
  let shown = [];
  let shownHeight = null; // primary height the shown frames were flipped with

  function makePanel(frame) {
    const s = initFfi();
    const panel = s.msgSend_init(
      s.msgSend_ptr(s.objc_getClass('NSPanel'), s.SEL('alloc')),
      s.SEL('initWithContentRect:styleMask:backing:defer:'),
      frame, NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL, NS_BACKING_STORE_BUFFERED, false,
    );
    if (!panel) return null;
    s.msgSend_v_bool(panel, s.SEL('setReleasedWhenClosed:'), false);
    // Folia is never the active app in wallpaper mode; a panel hiding on deactivate would vanish.
    s.msgSend_v_bool(panel, s.SEL('setHidesOnDeactivate:'), false);
    s.msgSend_v_bool(panel, s.SEL('setOpaque:'), false);
    s.msgSend_v_ptr(panel, s.SEL('setBackgroundColor:'), s.msgSend_ptr(s.objc_getClass('NSColor'), s.SEL('clearColor')));
    s.msgSend_v_bool(panel, s.SEL('setHasShadow:'), false);
    // Explicitly NO: a clear window is click-through by default; this makes the whole frame hit.
    s.msgSend_v_bool(panel, s.SEL('setIgnoresMouseEvents:'), false);
    s.msgSend_v_long(panel, s.SEL('setLevel:'), level);
    s.msgSend_v_ulong(panel, s.SEL('setCollectionBehavior:'), HIT_PANEL_COLLECTION_BEHAVIOR >>> 0);
    return panel;
  }

  // Shows one catcher per rect (global screen points), reusing the pool; hides the rest.
  function apply(rects) {
    const s = initFfi();
    if (!s.ok) return false;
    const next = Array.isArray(rects) ? rects.slice(0, MAX_HIT_PANELS) : [];
    const height = primaryHeight();
    // Same rects but a new primary display height (a display change) still moves the panels.
    if (height === shownHeight && sameRects(shown, next)) return true;
    try {
      for (let i = 0; i < next.length; i++) {
        const frame = toCocoaFrame(next[i], height);
        if (!panels[i]) {
          const panel = makePanel(frame);
          if (!panel) break;
          panels[i] = panel;
        } else {
          s.msgSend_v_rect_bool(panels[i], s.SEL('setFrame:display:'), frame, false);
        }
        s.msgSend_v(panels[i], s.SEL('orderFrontRegardless'));
      }
      for (let i = next.length; i < panels.length; i++) {
        s.msgSend_v_ptr(panels[i], s.SEL('orderOut:'), null);
      }
      shown = next;
      shownHeight = height;
      return true;
    } catch (e) {
      logWarn('[WallpaperMac] hit panels failed:', e && e.message);
      clear();
      return false;
    }
  }

  function clear() {
    const s = initFfi();
    shown = [];
    if (!s.ok) return;
    for (const panel of panels) {
      try {
        s.msgSend_v_ptr(panel, s.SEL('orderOut:'), null);
      } catch (e) {
        // ignore
      }
    }
  }

  // Closes and releases every panel; the pool is empty afterwards and may be reused.
  function destroy() {
    const s = initFfi();
    shown = [];
    if (!s.ok) return;
    for (const panel of panels.splice(0)) {
      try {
        s.msgSend_v(panel, s.SEL('close'));
        s.msgSend_v(panel, s.SEL('release'));
      } catch (e) {
        // ignore
      }
    }
  }

  return {
    isAvailable: () => initFfi().ok === true,
    apply,
    clear,
    destroy,
    shownRects: () => shown.slice(),
  };
}

module.exports = {
  MAX_HIT_PANELS,
  MIN_HIT_PANEL_SIZE,
  toScreenHitRects,
  toCocoaFrame,
  coversWholeWallpaper,
  readStageManagerDesktop,
  createMacWallpaperHitPanels,
};
