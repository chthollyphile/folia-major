// electron/macWallpaperTapWorker.cjs
// Runs the active macOS mouse-button tap on its own worker thread and CFRunLoop. The tap sits
// inline in system input delivery; keeping it off Electron's main thread prevents renderer/main
// startup work from delaying or disabling the tap. Verified wallpaper events are posted back to
// the controller, which forwards them to the renderer.

const Module = require('module');
const { parentPort, workerData } = require('worker_threads');

const config = workerData || {};
if (config.nodeModulesPath) {
  process.env.NODE_PATH = config.nodeModulesPath;
  Module._initPaths();
}

const {
  classifyMacTapEventType,
  createMacTapMasks,
  createMacWallpaperController,
  planMacInterceptGesture,
} = require('./macWallpaperController.cjs');

const fixedHitRect = config.hitRect || null;
const stopView = config.stopBuffer ? new Int32Array(config.stopBuffer) : null;
const dockChromeView = config.dockChromeBuffer ? new Int32Array(config.dockChromeBuffer) : null;
const hitRectView = config.hitRectBuffer ? new Int32Array(config.hitRectBuffer) : null;
const parentPortRef = parentPort;

function post(message) {
  try {
    parentPortRef?.postMessage(message);
  } catch (error) {
    // The controller may already have terminated this worker.
  }
}

function insideWallpaper(x, y) {
  const rect = currentHitRect();
  return Boolean(
    rect
    && x >= rect.x
    && x < rect.x + rect.width
    && y >= rect.y
    && y < rect.y + rect.height,
  );
}

function currentHitRect() {
  if (hitRectView && hitRectView[2] > 0 && hitRectView[3] > 0) {
    return {
      x: hitRectView[0],
      y: hitRectView[1],
      width: hitRectView[2],
      height: hitRectView[3],
    };
  }
  return fixedHitRect;
}

function currentDockChrome() {
  if (!dockChromeView) return null;
  const orientation = dockChromeView[0] === 1
    ? 'left'
    : dockChromeView[0] === 2
      ? 'right'
      : dockChromeView[0] === 3
        ? 'bottom'
        : null;
  return {
    orientation,
    autohide: dockChromeView[1] === 1,
    size: dockChromeView[2],
    rect: dockChromeView[5] > 0 && dockChromeView[6] > 0
      ? {
          x: dockChromeView[3],
          y: dockChromeView[4],
          width: dockChromeView[5],
          height: dockChromeView[6],
        }
      : null,
  };
}

const probe = createMacWallpaperController({
  store: { get: () => undefined, set: () => undefined },
  userDataPath: () => null,
  env: process.env,
  platform: 'darwin',
  testMode: true,
  logWarn: () => undefined,
});

if (!probe.isAvailable()) {
  post({ type: 'unavailable', reason: probe.reason() || 'probe-unavailable' });
  process.exit(2);
}
probe.refreshDockChrome();

let koffi;
let cg;
let cf;
let appServices;
try {
  koffi = require('koffi');
  cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  appServices = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
} catch (error) {
  post({ type: 'unavailable', reason: error && error.message });
  process.exit(2);
}

koffi.struct('FOLIA_WORKER_POINT', { x: 'double', y: 'double' });
const CGEventGetLocation = cg.func('FOLIA_WORKER_POINT CGEventGetLocation(void *event)');
const CGEventTapCreate = cg.func('void *CGEventTapCreate(uint32 tap, uint32 place, uint32 options, uint64 mask, void *cb, void *userInfo)');
const CGEventTapEnable = cg.func('void CGEventTapEnable(void *port, bool enable)');
const AXIsProcessTrusted = appServices.func('bool AXIsProcessTrusted(void)');
const CFMachPortCreateRunLoopSource = cf.func('void *CFMachPortCreateRunLoopSource(void *allocator, void *port, long order)');
const CFRunLoopGetCurrent = cf.func('void *CFRunLoopGetCurrent(void)');
const CFRunLoopAddSource = cf.func('void CFRunLoopAddSource(void *rl, void *source, void *mode)');
const CFRunLoopRunInMode = cf.func('int32 CFRunLoopRunInMode(void *mode, double seconds, bool returnAfterSourceHandled)');
const AXUIElementCreateSystemWide = appServices.func('void *AXUIElementCreateSystemWide(void)');
const AXUIElementCopyElementAtPosition = appServices.func('int32 AXUIElementCopyElementAtPosition(void *system, float x, float y, _Out_ void **element)');
const AXUIElementCopyAttributeValue = appServices.func('int32 AXUIElementCopyAttributeValue(void *element, void *attribute, _Out_ void **value)');
const AXValueGetType = appServices.func('uint32 AXValueGetType(void *value)');
const AXValueGetValue = appServices.func('bool AXValueGetValue(void *value, uint32 type, _Out_ void *out)');
const CFStringCreateWithCString = cf.func('void *CFStringCreateWithCString(void *allocator, const char *value, uint32 encoding)');
const CFStringGetCString = cf.func('bool CFStringGetCString(void *value, _Out_ char *buffer, long size, uint32 encoding)');
const CFGetTypeID = cf.func('unsigned long CFGetTypeID(void *value)');
const CFStringGetTypeID = cf.func('unsigned long CFStringGetTypeID(void)');
const CFRelease = cf.func('void CFRelease(void *value)');
const libc = koffi.load('/usr/lib/libSystem.B.dylib');
const dlopen = libc.func('void *dlopen(const char *path, int flags)');
const dlsym = libc.func('void *dlsym(void *handle, const char *name)');
const exportedConst = (name) => koffi.decode(dlsym(dlopen(null, 1), name), 'void *');
const commonModes = exportedConst('kCFRunLoopCommonModes');
const defaultMode = exportedConst('kCFRunLoopDefaultMode');

const CF_STRING_ENCODING_UTF8 = 0x08000100;
const systemWideElement = AXUIElementCreateSystemWide();
const axRoleAttribute = CFStringCreateWithCString(null, 'AXRole', CF_STRING_ENCODING_UTF8);
const axDescriptionAttribute = CFStringCreateWithCString(null, 'AXDescription', CF_STRING_ENCODING_UTF8);
const axPositionAttribute = CFStringCreateWithCString(null, 'AXPosition', CF_STRING_ENCODING_UTF8);
const axSizeAttribute = CFStringCreateWithCString(null, 'AXSize', CF_STRING_ENCODING_UTF8);

function copyAxAttribute(element, attribute) {
  const out = Buffer.alloc(8);
  if (AXUIElementCopyAttributeValue(element, attribute, out) !== 0) return null;
  return koffi.decode(out, 'void *');
}

function readAxString(element, attribute) {
  const value = copyAxAttribute(element, attribute);
  if (!value) return null;
  try {
    if (CFGetTypeID(value) !== CFStringGetTypeID()) return null;
    const buffer = Buffer.alloc(1024);
    if (!CFStringGetCString(value, buffer, buffer.length, CF_STRING_ENCODING_UTF8)) return null;
    const end = buffer.indexOf(0);
    return buffer.subarray(0, end < 0 ? buffer.length : end).toString('utf8');
  } finally {
    CFRelease(value);
  }
}

function readAxRect(element) {
  const positionValue = copyAxAttribute(element, axPositionAttribute);
  const sizeValue = copyAxAttribute(element, axSizeAttribute);
  if (!positionValue || !sizeValue) {
    if (positionValue) CFRelease(positionValue);
    if (sizeValue) CFRelease(sizeValue);
    return null;
  }
  try {
    const point = Buffer.alloc(16);
    const size = Buffer.alloc(16);
    if (AXValueGetType(positionValue) !== 1 || AXValueGetType(sizeValue) !== 2) return null;
    if (!AXValueGetValue(positionValue, 1, point) || !AXValueGetValue(sizeValue, 2, size)) return null;
    return {
      x: point.readDoubleLE(0),
      y: point.readDoubleLE(8),
      width: size.readDoubleLE(0),
      height: size.readDoubleLE(8),
    };
  } finally {
    CFRelease(positionValue);
    CFRelease(sizeValue);
  }
}

// The Accessibility hit-test is the only reliable way to tell Finder's full-display desktop
// backdrop from an icon/widget/label that lives inside the same Finder window. Fail open to the
// wallpaper if Accessibility cannot answer, so a transient AX failure cannot kill interaction.
function isBareFinderDesktopPoint(x, y) {
  const out = Buffer.alloc(8);
  if (AXUIElementCopyElementAtPosition(systemWideElement, x, y, out) !== 0) return true;
  const element = koffi.decode(out, 'void *');
  if (!element) return true;
  try {
    const role = readAxString(element, axRoleAttribute);
    if (role !== 'AXGroup') return false;
    const description = readAxString(element, axDescriptionAttribute);
    if (description === '桌面' || description === 'Desktop') return true;
    const frame = readAxRect(element);
    const wallpaperRect = currentHitRect();
    return Boolean(
      frame
      && wallpaperRect
      && Math.abs(frame.x - wallpaperRect.x) <= 2
      && Math.abs(frame.y - wallpaperRect.y) <= 2
      && Math.abs(frame.width - wallpaperRect.width) <= 2
      && Math.abs(frame.height - wallpaperRect.height) <= 2,
    );
  } finally {
    CFRelease(element);
  }
}

const TapProto = koffi.proto('void *FOLIA_WORKER_TAP(void *proxy, uint32 type, void *event, void *userInfo)');
let tap = null;
let leftDownDesktop = false;
let rightDownDesktop = false;

const callback = koffi.register((proxy, type, event) => {
  try {
    if (type === 0xfffffffe || type === 0xffffffff) {
      leftDownDesktop = false;
      rightDownDesktop = false;
      if (tap && AXIsProcessTrusted()) CGEventTapEnable(tap, true);
      else post({ type: 'unavailable', reason: 'accessibility-revoked' });
      return event;
    }
    const kind = classifyMacTapEventType(type);
    if (!kind) return event;
    const loc = CGEventGetLocation(event);
    const x = loc.x;
    const y = loc.y;
    const downKind = kind === 'down' || kind === 'rdown';
    probe.setDockChrome(currentDockChrome());
    const plan = planMacInterceptGesture(kind, {
      onWallpaper: downKind ? insideWallpaper(x, y) : false,
      desktopPoint: downKind
        ? probe.isDesktopPoint(x, y) && isBareFinderDesktopPoint(x, y)
        : false,
      leftDownDesktop,
      rightDownDesktop,
    });
    if (plan.forward) post({ type: 'event', event: { kind, x, y } });
    leftDownDesktop = plan.nextLeftDownDesktop;
    rightDownDesktop = plan.nextRightDownDesktop;
    if (plan.consume) return null;
  } catch (error) {
    post({ type: 'error', reason: error && error.message });
  }
  return event;
}, koffi.pointer(TapProto));

if (!AXIsProcessTrusted()) {
  post({ type: 'unavailable', reason: 'accessibility-not-granted' });
  process.exit(2);
}

tap = CGEventTapCreate(1 /* session */, 0 /* head insert */, 0 /* active */, createMacTapMasks().activeGestureMask, callback, null);
if (!tap) {
  post({ type: 'unavailable', reason: 'active-tap-create-null' });
  process.exit(2);
}

CGEventTapEnable(tap, true);
const source = CFMachPortCreateRunLoopSource(null, tap, 0);
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, commonModes);
post({ type: 'ready' });
while (!stopView || Atomics.load(stopView, 0) === 0) {
  CFRunLoopRunInMode(defaultMode, 0.1, true);
}
process.exit(0);
