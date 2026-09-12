const { app, BrowserWindow, ipcMain, session, screen, dialog, shell, nativeImage, desktopCapturer, Menu, Tray, nativeTheme, powerSaveBlocker, safeStorage, protocol, net: electronNet } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store').default || require('electron-store');
const crypto = require('crypto');
const { createStageApi } = require('./stageApi.cjs');
const { createModSystem } = require('./modSystem/modSystem.cjs');
const { MOD_PROTOCOL_PRIVILEGED_SCHEME } = require('./modSystem/modProtocol.cjs');
const { createWindowPlaybackHandoffStore } = require('./windowPlaybackHandoff.cjs');
const wallpaperWatchdogModule = require('./wallpaperWatchdog.cjs');
const windowsWallpaperModule = require('./windowsWallpaperController.cjs');
const macWallpaperModule = require('./macWallpaperController.cjs');
const { createKugouApiBridge } = require('./kugouApiBridge.cjs');
const { createQqAuthSessionRepository } = require('./qqAuthSessionRepository.cjs');
const { DEFAULT_DISCORD_APPLICATION_ID, createDiscordPresenceController } = require('./discordPresence.cjs');
const { createVoiceInputPauseMonitor } = require('./voiceInputPause.cjs');
const { createDisplaySleepBlocker } = require('./displaySleepBlocker.cjs');
const { createLyricApi } = require('./lyricApi.cjs');
const { createLocalCoverAssetStore, getLocalCoverAssetDirectory } = require('./localCoverAssets.cjs');
const {
  compareVersions,
  getReleaseUrl,
  getUpdateDiscoveryConfig,
  getUpdateProviderConfig,
  parseUpdateMetadataVersion,
  resolveReleaseChannel,
} = require('./updateChannels.cjs');
const { resolveCacheLimit, selectEvictions } = require('./audioCachePrune.cjs');
const { createAnalysisHost } = require('./analysis/host.cjs');
const { createDebugHost, runtimeLine } = require('./debug/debugHost.cjs');
const { createCrashLog, installCrashHandlers } = require('./debug/crashLog.cjs');
const { createModelStore } = require('./analysis/modelStore.cjs');
const { resolveLinuxPasswordStore } = require('./linuxPasswordStore.cjs');
const { createTranscodeService } = require('./transcode/service.cjs');
const { TRANSCODE_PROTOCOL_SCHEME } = require('./transcode/protocol.cjs');
const { sanitizeDualTheme: sanitizeGeneratedDualTheme } = require('../shared/themeSanitizer.cjs');
const {
  detectOpenAICompatibleProvider,
  normalizeOpenAIChatCompletionsUrl,
  parseAiJsonObject,
  runAiJsonCompletion,
} = require('./aiTextClient.cjs');
const {
  SEGMENTATION_GEMINI_GENERATION_CONFIG,
  SEGMENTATION_JSON_SCHEMA,
  SEGMENTATION_MAX_OUTPUT_TOKENS,
  SEGMENTATION_SCHEMA_NAME,
  buildSegmentationSourcePrompt,
  buildSegmentationSystemPrompt,
  parseSegmentationResponse,
} = require('../shared/lyricSegmentationPrompt.cjs');
const useLinuxGraphicsDebugMode = process.env.ELECTRON_LINUX_PACKAGED_GRAPHICS === 'true';
const isAppImageRuntime =
  process.platform === 'linux' &&
  (Boolean(process.env.APPIMAGE) || Boolean(process.env.APPDIR) || useLinuxGraphicsDebugMode);
const linuxGraphicsMode =
  process.platform !== 'linux'
    ? 'system'
    : (process.env.FOLIA_LINUX_GRAPHICS_MODE || (isAppImageRuntime ? 'swiftshader' : 'system'));

// Every custom scheme must be registered in this one call: each
// registerSchemesAsPrivileged call overwrites the fetch/secure/cors scheme
// command-line switches, so a second call silently strips those privileges
// from the schemes registered earlier.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'folia-cover',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: TRANSCODE_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  MOD_PROTOCOL_PRIVILEGED_SCHEME,
]);

// Trusts only the known KuGou media CDN hostname mismatch while preserving TLS checks elsewhere.
app.on('certificate-error', (event, _webContents, requestUrl, error, _certificate, callback) => {
  let isAllowedKugouMediaRequest = false;
  try {
    const parsedUrl = new URL(requestUrl);
    isAllowedKugouMediaRequest =
      parsedUrl.protocol === 'https:' &&
      parsedUrl.hostname === 'fs.youthandroid2.kugou.com' &&
      error === 'net::ERR_CERT_COMMON_NAME_INVALID';
  } catch {
    isAllowedKugouMediaRequest = false;
  }

  if (isAllowedKugouMediaRequest) {
    event.preventDefault();
    callback(true);
    return;
  }

  callback(false);
});

// Fix for Arch Linux / Wayland & Vulkan compatibility issues
if (process.platform === 'linux') {
  // Must run before the ready event: Chromium reads the password backend once while initialising
  // OSCrypt, and the default detection leaves unrecognised desktops without any real encryption.
  const linuxPasswordStore = resolveLinuxPasswordStore();
  if (linuxPasswordStore) {
    app.commandLine.appendSwitch('password-store', linuxPasswordStore);
  }

  app.commandLine.appendSwitch('disable-vulkan');
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('log-level', '3');

  if (linuxGraphicsMode === 'software') {
    // Hard fallback: safest, but usually slower.
    app.disableHardwareAcceleration();
  } else if (linuxGraphicsMode === 'swiftshader') {
    // AppImage is the only runtime showing broken blur/opacity plus GPU crashes.
    // Prefer software GL here so Chromium keeps its compositor pipeline
    // without relying on the host Vulkan / GPU stack.
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  } else {
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
  }
}

// Chromium starts the video capture service to enumerate video inputs whenever the renderer calls
// enumerateDevices() -- which the playback settings panel must do to list audio outputs -- and does
// not release it afterwards (crbug 377749384), leaving a utility process and an OS privacy
// indicator behind. This feature adds an idle timer that shuts the video source provider down about
// a minute after the last use.
//
// The flag alone is inert: Chromium only re-checks whether the provider is still needed when a
// device-change subscription is dropped, and enumerating never schedules that check. The renderer
// therefore subscribes to `devicechange` while the device picker is open and unsubscribes when it
// closes, purely to trigger the timer -- see src/hooks/useAudioOutputDevices.ts. Removing that
// subscription re-pins the capture service for the lifetime of the process.
function appendChromiumFeature(featureName) {
  // base::CommandLine keeps one value per switch, so a plain appendSwitch would drop features the
  // user passed on the command line, or any appended earlier here.
  const enabledFeatures = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch(
    'enable-features',
    enabledFeatures ? `${enabledFeatures},${featureName}` : featureName,
  );
}

if (process.platform === 'win32' || process.platform === 'darwin') {
  appendChromiumFeature('ReleaseVideoSourceProviderIfNotInUse');
}

// macOS: GPU 加速优化，解决 Intel Mac + AMD 独显在 Retina 屏幕下的渲染卡顿
if (process.platform === 'darwin' && process.arch === 'x64') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('use-angle', 'gl');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

const store = new Store({ projectName: 'Folia' });
const transcodeService = createTranscodeService({
  app,
  protocol,
  net: electronNet,
  onCacheWrite: pruneMediaCache,
});
// KuGou credentials stay inside the main process and are encrypted lazily after Electron is ready.
// The bridge refuses Linux's plaintext `basic_text` fallback and degrades to an in-memory session.
const kugouApiBridge = createKugouApiBridge({ store, safeStorage });
const qqAuthSessionRepository = createQqAuthSessionRepository({ store, safeStorage });

// --- Desktop wallpaper mode (Wayland layer-shell via windowtolayer / X11 desktop window) ---
// Settings keys follow the existing electron-store key/value chain; values are normalized here in
// the main process so stale or dirty stored values never reach the windowtolayer CLI.
const WALLPAPER_MODE_SETTING_KEY = 'wallpaper_mode';
// Windows-only helper switches; both default to on (missing = enabled).
const WALLPAPER_FORWARD_MOUSE_SETTING_KEY = 'wallpaper_forward_mouse';
const WALLPAPER_ZGUARD_SETTING_KEY = 'wallpaper_zguard';
// macOS-only: auto-hide the Dock while a wallpaper session is active. Hiding only ever applies to a
// bottom-edge Dock (side Docks stay untouched); the on/off switch is the override — turning it off
// disables even a bottom Dock. Exiting wallpaper mode or quitting restores the user's original Dock
// state either way.
const WALLPAPER_MAC_AUTOHIDE_DOCK_SETTING_KEY = 'wallpaper_mac_autohide_dock';

// Thin wrappers over electron/wallpaperWatchdog.cjs so the call sites across the file keep their
// existing signatures while the predicates stay a single source of truth in the module.
function isWallpaperModeEnabled() {
  return wallpaperWatchdogModule.isWallpaperModeEnabled(store);
}

// Wallpaper mode ships only where the window can be sunk into a desktop layer
// (X11/Wayland/Windows/macOS desktop-level sink); tray/settings surfaces gate on this.
function isWallpaperModeSupportedPlatform() {
  return process.platform === 'linux' || process.platform === 'win32' || process.platform === 'darwin';
}

// X11 wallpaper mode: the main window is a _NET_WM_WINDOW_TYPE_DESKTOP window. It shares the
// desktop layer with the KDE desktop window, and because desktop windows are rendered unredirected
// there is no composited backdrop behind them. Click-through is therefore unavailable there: it
// would let clicks reach the KDE desktop window, which KWin then raises above Folia (both are
// desktop-type, the topmost wins), covering the wallpaper.
function isX11WallpaperMode() {
  return wallpaperWatchdogModule.isX11WallpaperMode({
    platform: process.platform,
    env: process.env,
    store,
  });
}

// The wrapped child keeps FOLIA_WRAPPED_BY_WINDOWTOLAYER=1; it must never wrap itself again.
function isWallpaperWrapped() {
  return wallpaperWatchdogModule.isWallpaperWrapped(process.env);
}

// The binary ships as resources/windowtolayer (built by packaging/linux/build-windowtolayer.mjs).
// FOLIA_WINDOWTOLAYER_PATH overrides it for non-packaged (dev) runs; the dev:electron* scripts
// inject `build/windowtolayer` (produced by `npm run build:windowtolayer`) so wallpaper mode also
// works outside an electron-builder package. A missing binary just disables wallpaper mode.
function resolveWindowToLayerPath() {
  const override = process.env.FOLIA_WINDOWTOLAYER_PATH;
  if (override) {
    return fs.existsSync(override) ? override : null;
  }
  const candidate = path.join(process.resourcesPath, 'windowtolayer');
  return fs.existsSync(candidate) ? candidate : null;
}

// Enables wallpaper mode on Wayland: spawn windowtolayer wrapping a fresh Folia child, then the
// old process exits once the wrapper has spawned. Spawn failure (ENOENT/EACCES) arrives on the
// async 'error' event, never as a synchronous throw, so we revert the setting instead of crashing.
function launchWrappedSelf({ onError } = {}) {
  const wtl = resolveWindowToLayerPath();
  if (!wtl) {
    console.warn('[Wallpaper] windowtolayer missing, cannot enable wallpaper mode');
    store.set(WALLPAPER_MODE_SETTING_KEY, false);
    onError?.(new Error('windowtolayer binary is missing'));
    return Promise.resolve('missing');
  }

  return new Promise((resolve) => {
    const child = spawn(wtl, ['--layer=bottom', '--interactivity=all',
      process.execPath, ...process.argv.slice(1)],
      {
        env: { ...process.env, FOLIA_WRAPPED_BY_WINDOWTOLAYER: '1', FOLIA_RELAUNCH: '1' },
        stdio: 'inherit',
      });
    child.once('error', (err) => {
      console.error('[Wallpaper] windowtolayer spawn failed, reverting wallpaper mode', err);
      store.set(WALLPAPER_MODE_SETTING_KEY, false);
      onError?.(err);
      resolve('error');
    });
    child.once('spawn', () => {
      resolve('spawned');
      app.exit(0);
    });
  });
}

// Watchdog: liveness probe + recovery-to-normal-window live in electron/wallpaperWatchdog.cjs
// (dependency-injected here so the same logic is unit-testable and simulatable headless).
const wallpaperWatchdog = wallpaperWatchdogModule.createWallpaperWatchdog({
  store,
  env: process.env,
  spawnFn: spawn,
  execPath: () => process.execPath,
  argv: () => process.argv.slice(1),
  getPpid: () => process.ppid,
  exit: (code) => app.exit(code),
  killFn: process.kill.bind(process),
  probeIntervalMs: 2000,
});

// --- Windows wallpaper mode (WorkerW parenting via folia-wallpaper-helper.exe) ---
// Unlike the Linux paths there is no relaunch: the helper parents the existing window into the
// WorkerW layer at runtime. Mode toggles recreate the window in place with a playback handoff.

// Windows wallpaper mode: the main window is parented below the desktop icons. Click-through
// is refused here as well — after SetParent the clicks never reach the window anyway, so an
// ignore-mouse state would only leave the UI answering clicks that cannot happen.
function isWindowsWallpaperMode() {
  return process.platform === 'win32' && wallpaperWatchdogModule.isWallpaperModeEnabled(store);
}

// Desktop architecture the wallpaper helper last attached to, as reported by its `attached`
// event ('raised' = Win11 24H2+ layered shell view, 'classic' = Win10/early Win11). Persisted
// because it is a per-machine property: the window builder needs it before the first attach.
// A transparent Electron window only keeps presenting after SetParent on the raised desktop —
// on classic the WS_EX_LAYERED redirection surface dies with the re-parent and the wallpaper
// presents black (renderer keeps painting; only the window surface is lost, verified on
// Win10 17763), so classic-mode wallpaper windows are always built opaque.
const WALLPAPER_WINDOWS_ATTACH_MODE_KEY = 'wallpaper_windows_attach_mode';
let wallpaperWindowsAttachMode = store.get(WALLPAPER_WINDOWS_ATTACH_MODE_KEY) === 'raised' ? 'raised' : 'classic';

function isWindowsWallpaperTransparentSupported() {
  return wallpaperWindowsAttachMode === 'raised';
}

// The user preference (TRANSPARENT_PLAYER_BACKGROUND) is independent of what the current
// window can render: wallpaper mode on the classic desktop derives an opaque window. After an
// attach reports a different architecture than the window was built for, bring them back in
// sync with one rebuild.
function reconcileWindowsWallpaperWindowTransparency() {
  if (process.platform !== 'win32' || !isWindowsWallpaperMode() || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const desiredTransparent = isTransparentPlayerBackgroundEnabled() && isWindowsWallpaperTransparentSupported();
  if (mainWindow.__wallpaperWindowTransparent === desiredTransparent) {
    return;
  }
  recreateMainWindowWithTransparencyMode(isTransparentPlayerBackgroundEnabled(), null);
}

// The helper ships as resources/folia-wallpaper-helper.exe (built by
// packaging/windows/build-wallpaper-helper.mjs). FOLIA_WALLPAPER_HELPER_PATH overrides it for
// non-packaged (dev) runs, mirroring FOLIA_WINDOWTOLAYER_PATH. A missing binary just disables
// wallpaper mode (attach reports 'missing' and the renderer learns via wallpaper-mode-changed).
function resolveWallpaperHelperPath() {
  const override = process.env.FOLIA_WALLPAPER_HELPER_PATH;
  if (override) {
    return fs.existsSync(override) ? override : null;
  }
  const candidate = path.join(process.resourcesPath, 'folia-wallpaper-helper.exe');
  return fs.existsSync(candidate) ? candidate : null;
}
function refreshWindowsDesktopWallpaper() {
  if (process.platform !== 'win32') {
    return;
  }
  const helperPath = resolveWallpaperHelperPath();
  if (!helperPath) {
    return;
  }
  try {
    const child = spawn(helperPath, ['refresh'], { stdio: 'ignore', detached: true });
    child.on('error', (err) => {
      console.warn('[WallpaperWin] desktop wallpaper refresh failed:', err.message);
    });
    child.unref();
  } catch (err) {
    console.warn('[WallpaperWin] desktop wallpaper refresh could not be spawned:', err?.message);
  }
}

function getMainWindowNativeHwnd() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  try {
    const handle = mainWindow.getNativeWindowHandle();
    return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
  } catch {
    return null;
  }
}

// --- Windows wallpaper mode mouse injection (sendInputEvent) ---
// The helper reports desktop mouse input (move + left button) as JSONL events in 96-DPI
// virtualized screen pixels (its process is DPI-unaware, which is exactly Electron's DIP
// space); here they are made window-relative and injected at the Chromium input-pipeline
// level. Posting WM_MOUSEMOVE/WM_LBUTTONDOWN to the window directly is not an option: Chromium
// arms TrackMouseEvent on the first processed WM_MOUSEMOVE, but the real cursor physically
// sits on the desktop icon layer above the wallpaper window, so the system instantly answers
// WM_MOUSELEAVE and hover is torn down between every forwarded move (measured 300–500
// enter/leave pairs per second).
let lastWallpaperMouseDown = { at: 0, x: 0, y: 0 };
// Tracks the primary button between helper mousedown/mouseup reports: injected mouseMove
// events carry no button state of their own, and Chromium derives MouseEvent.buttons from the
// 'leftbuttondown' modifier — without it a drag is torn down by the first forwarded move.
let wallpaperPrimaryButtonHeld = false;

// Injects one helper mouse event into the main window's renderer.
function forwardWallpaperMouseInput(event) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  // Helper coordinates are already in DIP screen space — only shift by the window origin.
  const bounds = mainWindow.getContentBounds();
  const x = event.x - bounds.x;
  const y = event.y - bounds.y;
  switch (event.event) {
    case 'mousemove': {
      // Outside the window (taskbar, other monitor) there is nothing to hover; button events
      // still go through so a drag that strays out of bounds cannot stick the pressed state.
      if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
        return;
      }
      const moveEvent = { type: 'mouseMove', x, y };
      if (wallpaperPrimaryButtonHeld) {
        moveEvent.modifiers = ['leftbuttondown'];
      }
      mainWindow.webContents.sendInputEvent(moveEvent);
      return;
    }
    case 'mousedown': {
      wallpaperPrimaryButtonHeld = true;
      // clickCount must be synthesized: injected events bypass the OS multi-click detection.
      const now = Date.now();
      const isDoubleClick =
        now - lastWallpaperMouseDown.at < 500 &&
        Math.abs(event.x - lastWallpaperMouseDown.x) <= 8 &&
        Math.abs(event.y - lastWallpaperMouseDown.y) <= 8;
      lastWallpaperMouseDown = { at: now, x: event.x, y: event.y };
      mainWindow.webContents.sendInputEvent({
        type: 'mouseDown',
        x,
        y,
        button: 'left',
        clickCount: isDoubleClick ? 2 : 1,
        modifiers: ['leftbuttondown'],
      });
      return;
    }
    case 'mouseup': {
      wallpaperPrimaryButtonHeld = false;
      mainWindow.webContents.sendInputEvent({
        type: 'mouseUp',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
      return;
    }
    case 'mousewheel': {
      // Scrollable content only exists inside the window; outside (taskbar, other monitor)
      // the packet is dropped like a stray mousemove.
      if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
        return;
      }
      // Helper deltas are raw-input notches (multiples of WHEEL_DELTA=120; hi-res wheels send
      // smaller increments). Chromium's mouseWheel wants CSS pixels: ~100px per notch. The
      // vertical sign passes through unchanged — sendInputEvent's injected deltaY semantics
      // are inverted relative to native wheel events (calibrated on the real machine, where
      // negating the raw delta produced reversed scrolling); horizontal keeps its sign
      // (positive = scroll right).
      const notch = (raw) => Math.round(((raw || 0) / 120) * 100);
      mainWindow.webContents.sendInputEvent({
        type: 'mouseWheel',
        x,
        y,
        deltaX: notch(event.deltaX),
        deltaY: notch(event.deltaY),
      });
      return;
    }
  }
}

// Helper process lifecycle + heartbeat watchdog + crash-loop breaker. The recovery callbacks
// rebuild the main window when the helper cannot keep it (window destroyed with its WorkerW,
// renderer crash, repeated failures) — degrade clears wallpaper_mode and comes back as a
// normal window without an app relaunch.
const windowsWallpaper = windowsWallpaperModule.createWindowsWallpaperController({
  store,
  helperPath: () => resolveWallpaperHelperPath(),
  getHwnd: getMainWindowNativeHwnd,
  onDegrade: () => {
    refreshWindowsDesktopWallpaper();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wallpaper-mode-changed', getPublicSettings());
    }
    recreateMainWindowWithTransparencyMode(isTransparentPlayerBackgroundEnabled(), null);
  },
  onReattachNeeded: () => {
    rebuildWindowsWallpaperSession();
  },
  onAttachMode: (mode) => {
    if (mode !== 'raised' && mode !== 'classic') {
      return;
    }
    if (mode === wallpaperWindowsAttachMode) {
      return;
    }
    wallpaperWindowsAttachMode = mode;
    store.set(WALLPAPER_WINDOWS_ATTACH_MODE_KEY, mode);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wallpaper-mode-changed', getPublicSettings());
    }
    reconcileWindowsWallpaperWindowTransparency();
  },
  onMouseInput: forwardWallpaperMouseInput,
});

// Renderer crash / WorkerW teardown broke the wallpaper session: attach the helper to a live
// window, or rebuild one first when the Folia window was destroyed together with the WorkerW.
function rebuildWindowsWallpaperSession() {
  if (process.platform !== 'win32' || !isWindowsWallpaperMode()) {
    return;
  }
  windowsWallpaper.killHelper();
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createWindow();
  }
  windowsWallpaper.attach();
}

// Runtime change (save-settings IPC): relaunch the whole process so the new mode takes effect.
// The store value is already written by the save-settings handler before this runs.
async function relaunchForWallpaperModeChange(nextEnabled, expectedGeneration = null) {
  // macOS: in-place toggle — the live window is sunk/raised with no relaunch and no window
  // rebuild, so the renderer (and its audio / visualizer state) survives untouched.
  if (process.platform === 'darwin') {
    if (expectedGeneration !== null && expectedGeneration !== wallpaperModeRelaunchGeneration) {
      return;
    }
    if (nextEnabled) {
      // A window whose level was ever touched through Electron's setAlwaysOnTop cannot
      // present simple full screen correctly anymore (measured: content 33pt low, empty
      // menu-bar strip above the wallpaper — sticky for the life of the window). Rebuild
      // it so the entry runs on a fresh window, like the always-correct startup path.
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.__macAlwaysOnTopElectronTouched === true) {
        await rebuildMainWindowForMacWallpaper();
      }
      enterMacWallpaperMode();
    } else {
      exitMacWallpaperMode();
    }
    return;
  }
  // Windows: the window must be RECREATED with the wallpaper option set, not just re-parented.
  // A normal window is built with thickFrame:true; once the helper parents it into the WorkerW,
  // Chromium keeps the client-frame compensation it computed at creation, and the rendered
  // content sits inside a ~10px gap (measured at 150% scaling). Startup with the setting on
  // creates the window borderless (thickFrame:false) and has no gap — so the runtime toggle
  // recreates the window to match, and the playback handoff carries the session across the
  // renderer reload.
  if (process.platform === 'win32') {
    const handoff = await requestWindowPlaybackHandoff();
    if (expectedGeneration !== null && expectedGeneration !== wallpaperModeRelaunchGeneration) {
      return;
    }
    if (!nextEnabled) {
      // Release the helper before its hwnd is destroyed (the recreate path would only kill it).
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const safety = setTimeout(done, 500);
        if (typeof safety?.unref === 'function') {
          safety.unref();
        }
        const hadHelper = windowsWallpaper.detach({
          onDetached: () => {
            clearTimeout(safety);
            done();
          },
        });
        if (!hadHelper) {
          clearTimeout(safety);
          done();
        }
      });
    }
    recreateMainWindowWithTransparencyMode(isTransparentPlayerBackgroundEnabled(), handoff);
    return;
  }
  if (nextEnabled) {
    if (isWallpaperWrapped()) {
      return; // already a wallpaper session, nothing to do
    }
    if (Boolean(process.env.WAYLAND_DISPLAY)) {
      void launchWrappedSelf({
        onError: () => {
          setMainWindowClickThroughEnabled(false);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('wallpaper-mode-changed', getPublicSettings());
          }
        },
      });
    } else {
      wallpaperWatchdog.relaunchSelfNormal(); // X11: plain relaunch; the fresh window picks up type:'desktop'
    }
  } else {
    wallpaperWatchdog.relaunchSelfNormal();
  }
}

// Rebuilds the main window before a mac wallpaper entry (or after a session exits) so the
// wallpaper always runs on a window that has never had its level touched through Electron's
// setAlwaysOnTop — such a window cannot present simple full screen correctly anymore
// (measured: content presented 33pt below the window top). The playback handoff carries
// audio/visualizer state across the renderer reload; if wallpaper mode was turned back on
// before the new window is ready, the recreate path re-sinks it.
async function rebuildMainWindowForMacWallpaper() {
  try {
    const handoff = await requestWindowPlaybackHandoff();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    recreateMainWindowWithTransparencyMode(isTransparentPlayerBackgroundEnabled(), handoff);
  } catch (error) {
    console.warn('[WallpaperMac] window rebuild for wallpaper failed:', error && error.message);
  }
}

// Coalesce rapid UI toggles into one relaunch. The generation check also prevents a stale
// handoff request from launching an older mode after the user changes the switch again.
function scheduleWallpaperModeRelaunch(nextEnabled) {
  wallpaperModeRelaunchGeneration += 1;
  const generation = wallpaperModeRelaunchGeneration;
  if (wallpaperModeRelaunchTimer) {
    clearTimeout(wallpaperModeRelaunchTimer);
  }

  wallpaperModeRelaunchTimer = setTimeout(async () => {
    wallpaperModeRelaunchTimer = null;
    // Windows detaches/recreates the window in place (no process relaunch); the playback
    // handoff inside keeps the session alive across the renderer reload.
    if (process.platform === 'win32') {
      if (generation !== wallpaperModeRelaunchGeneration) {
        return;
      }
      await relaunchForWallpaperModeChange(nextEnabled, generation);
      return;
    }
    if (process.platform === 'darwin') {
      // macOS switches in place — no handoff, no relaunch; the window is never destroyed.
      if (generation !== wallpaperModeRelaunchGeneration) {
        return;
      }
      await relaunchForWallpaperModeChange(nextEnabled, generation);
      return;
    }
    await requestWindowPlaybackHandoff();
    if (generation !== wallpaperModeRelaunchGeneration) {
      return;
    }
    relaunchForWallpaperModeChange(nextEnabled);
  }, 300);
}

// --- macOS wallpaper mode (in-place desktop-level sink; no helper / no relaunch) ---
// Unlike Windows (helper re-parent) and Linux (windowtolayer / X11 desktop window), macOS sinks
// the LIVE main window below the Finder icons with a koffi NSWindow setLevel: call, then uses a
// listen-only CGEventTap to forward clicks that macOS routes to the bare desktop into the
// renderer. All of the FFI + Dock logic lives in macWallpaperController.cjs; this file only wires
// it to the Electron window and to the same wallpaper_mode setting the other platforms use.
let macWallpaperControllerInstance = null;
let isMacWallpaperActive = false;
let isMacWallpaperInteractionEnabled = false;
let macWallpaperTapFailures = 0;
let macWallpaperTapRetryTimer = null;
let macWallpaperSavedState = null; // { bounds, resizable, movable, maximizable, nativeBlurEnabled }
let macWallpaperMouseDownAt = { at: 0, x: 0, y: 0 };
let macWallpaperPendingDrag = null;
let macWallpaperDragTimer = null;
// Deferred-entry state: entering wallpaper mode while the window is in native (Space-based)
// full screen must wait for the exit animation to land before sinking the window (see
// deferMacWallpaperEnterUntilFullScreenExit). These timers/flags are single-flight and bounded
// so they can never reschedule themselves off resize events (that looped once before).
let macWallpaperPendingEnter = false; // posture deferred until a full-screen exit has landed
let macWallpaperEnterPollElapsed = 0;
let macWallpaperEnterPollTimer = null;
let macWallpaperSettleTimer = null;
let macWallpaperSettleAttempts = 0;
const MAC_WALLPAPER_TAP_RETRY_DELAY_MS = 2000;
const MAC_WALLPAPER_TAP_FAILURE_THRESHOLD = 3;
const MAC_WALLPAPER_DRAG_FLUSH_MS = 16;
const MAC_WALLPAPER_FULLSCREEN_EXIT_POLL_MS = 250;
const MAC_WALLPAPER_FULLSCREEN_EXIT_MAX_WAIT_MS = 6000;
const MAC_WALLPAPER_FRAME_SETTLE_DELAY_MS = 1000;
const MAC_WALLPAPER_FRAME_SETTLE_MAX_ATTEMPTS = 4;

function isMacWallpaperMode() {
  return process.platform === 'darwin' && isWallpaperModeEnabled();
}

// The controller needs app.getPath('userData') (Dock crash marker), which is only available
// after app ready; it is created lazily on first use.
function getMacWallpaperController() {
  if (process.platform !== 'darwin') {
    return null;
  }
  if (!macWallpaperControllerInstance) {
    try {
      macWallpaperControllerInstance = macWallpaperModule.createMacWallpaperController({
        store,
        userDataPath: () => app.getPath('userData'),
      });
    } catch (error) {
      console.warn('[WallpaperMac] controller init failed:', error && error.message);
      macWallpaperControllerInstance = null;
    }
  }
  return macWallpaperControllerInstance;
}

function isMacSimpleFullScreen(win) {
  if (!win || win.isDestroyed() || typeof win.isSimpleFullScreen !== 'function') {
    return false;
  }
  try {
    return win.isSimpleFullScreen();
  } catch (error) {
    return false;
  }
}

// Ambient wallpaper posture: present on every Space, sunk below the Finder icons, click-through.
// The all-spaces + FullScreenAuxiliary collection bits come from Electron's own API here; a raw
// koffi setCollectionBehavior(81) would clobber the FullScreenAuxiliary bit (controller note).
function applyMacAmbientLevel() {
  const controller = getMacWallpaperController();
  if (!controller || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (error) {
    // ignore
  }
  controller.setLevel(mainWindow, controller.desktopLevel());
  try {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch (error) {
    // ignore
  }
  return true;
}

// True full-bleed: a plain setBounds(display.bounds) is clamped to the workArea on macOS, so a
// menu-bar strip and dock gap would leak the real wallpaper. Simple full screen covers the whole
// display. The caller re-asserts the ambient level afterwards (the presentation change rewrites
// it). NOTE: simple full screen must be entered FIRST — setBounds(display.bounds) beforehand is
// clamped by macOS to (0, menuBarHeight, displayW, displayH) (full height, bottom off-screen),
// and the origin-shift animation into simple full screen can leave the web-contents view offset
// by the menu-bar height inside the window (measured: the page paints full height, the screen
// shows an empty menu-bar strip of the desktop behind it).
function applyMacWallpaperFrame() {
  const controller = getMacWallpaperController();
  if (!controller || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  try {
    const target = screen.getPrimaryDisplay().bounds;
    const current = mainWindow.getBounds();
    const frameChanged = current.x !== target.x
      || current.y !== target.y
      || current.width !== target.width
      || current.height !== target.height;
    if (!isMacSimpleFullScreen(mainWindow)) {
      // Enters simple full screen in ONE animation straight from the current frame: Electron
      // frames the window to the full display itself, so no workArea-clamped intermediate
      // frame exists for the content view to get stuck on.
      mainWindow.setSimpleFullScreen(true);
    }
    if (frameChanged && isMacSimpleFullScreen(mainWindow)) {
      // Only reached when the window was somehow already simple-full-screen at the wrong
      // frame; re-framing it is safe (setBounds is not blocked in simple full screen).
      mainWindow.setBounds(target, false);
    }
    return true;
  } catch (error) {
    console.warn('[WallpaperMac] apply wallpaper frame failed:', error && error.message);
    return false;
  }
}

// Drops every deferred-entry / settle timer the entry may have left behind. Called from the
// exit path (toggle off, rollback, window closed) so a cancelled entry can never sink the
// window after the fact.
function clearMacWallpaperDeferredState() {
  macWallpaperPendingEnter = false;
  macWallpaperEnterPollElapsed = 0;
  if (macWallpaperEnterPollTimer) {
    clearTimeout(macWallpaperEnterPollTimer);
    macWallpaperEnterPollTimer = null;
  }
  if (macWallpaperSettleTimer) {
    clearTimeout(macWallpaperSettleTimer);
    macWallpaperSettleTimer = null;
  }
  macWallpaperSettleAttempts = 0;
}

// One bounded, timer-driven re-assert of the full-bleed frame after the wallpaper posture
// lands: the simple-full-screen entry animates, and any residual clamping shows up a beat
// later. Single-flight and capped so it can never loop (a resize-event-driven re-assert was
// an infinite loop once — never schedule this off events).
function scheduleMacWallpaperFrameSettleVerify() {
  if (macWallpaperSettleTimer) {
    clearTimeout(macWallpaperSettleTimer);
    macWallpaperSettleTimer = null;
  }
  if (macWallpaperSettleAttempts >= MAC_WALLPAPER_FRAME_SETTLE_MAX_ATTEMPTS) {
    return;
  }
  macWallpaperSettleTimer = setTimeout(() => {
    macWallpaperSettleTimer = null;
    if (!isMacWallpaperActive || macWallpaperPendingEnter || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isFullScreen()) {
      return; // a full-screen transition owns the frame; nothing to settle
    }
    macWallpaperSettleAttempts += 1;
    try {
      const target = screen.getPrimaryDisplay().bounds;
      const current = mainWindow.getBounds();
      const frameMatches = current.x === target.x
        && current.y === target.y
        && current.width === target.width
        && current.height === target.height;
      if (!frameMatches) {
        applyMacWallpaperFrame(); // no-op when the frame already matches
        applyMacAmbientLevel(); // the presentation change rewrites the level
        scheduleMacWallpaperFrameSettleVerify();
      }
    } catch (error) {
      // ignore
    }
  }, MAC_WALLPAPER_FRAME_SETTLE_DELAY_MS);
}

// The wallpaper posture part of the entry: window locks, vibrancy drop, ambient level +
// full-bleed frame, Dock auto-hide, interaction tap, stored flag + renderer notify. Runs
// inline for an already-normal window, or exactly once after a full-screen exit has landed
// (see enterMacWallpaperMode / deferMacWallpaperEnterUntilFullScreenExit) — never while the
// exit animation is still in flight.
function applyMacWallpaperPosture(controller) {
  if (!controller || !isMacWallpaperActive || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  try {
    if (mainWindow.isFullScreen() || isMacSimpleFullScreen(mainWindow)) {
      return false; // the full-screen exit has not landed yet; the caller retries later
    }
    if (!macWallpaperSavedState) {
      // Deferred entry: capture the true normal state only now, once the full-screen exit
      // restored the window's own frame (capturing earlier, while native-fullscreen, records
      // the full-screen Space frame that exitMacWallpaperMode would then restore).
      macWallpaperSavedState = {
        bounds: mainWindow.getBounds(),
        resizable: mainWindow.isResizable(),
        movable: mainWindow.isMovable(),
        maximizable: mainWindow.isMaximizable(),
        nativeBlurEnabled: store.get('enable_player_page_native_blur') === true,
      };
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
    mainWindow.setResizable(false);
    mainWindow.setMovable(false);
    // Wallpaper geometry is dictated by the display; stop persisting window bounds while it
    // spans the screen (same guard the Windows/X11 geometry windows use).
    mainWindow.__wallpaperGeometry = true;
    // vibrancy at the desktop layer renders behind the icons (the "wallpaper stuck" AppKit trap);
    // drop it for the session and restore it on exit if the user had native blur on.
    if (macWallpaperSavedState.nativeBlurEnabled) {
      try {
        mainWindow.setVibrancy(null);
      } catch (error) {
        // ignore
      }
    }
    // Enter the full-bleed simple-full-screen frame BEFORE sinking the window: the
    // all-spaces + FullScreenAuxiliary collection behavior applied by applyMacAmbientLevel
    // makes macOS treat the window as a full-screen auxiliary surface whose content the
    // system insets below the menu bar (measured: an empty menu-bar strip on top of the
    // wallpaper) when it is set while the window is already in simple full screen.
    applyMacWallpaperFrame();
    applyMacAmbientLevel();
    // Hide the Dock while the wallpaper is up when the decision says so (default: only a bottom
    // Dock, overridable by an explicit user on/off). The window already spans the full display and
    // a visible Dock draws above it either way.
    if (shouldMacWallpaperAutohideDock(controller)) {
      void controller.setDockAutohide(true);
    }
    isMacWallpaperInteractionEnabled = store.get(WALLPAPER_FORWARD_MOUSE_SETTING_KEY) !== false;
    startMacWallpaperInteraction();
    store.set(WALLPAPER_MODE_SETTING_KEY, true);
    notifyMacWallpaperModeChanged();
    scheduleMacWallpaperFrameSettleVerify();
    return true;
  } catch (error) {
    console.warn('[WallpaperMac] enter wallpaper mode failed:', error && error.message);
    try {
      exitMacWallpaperMode();
    } catch (exitError) {
      // ignore
    }
    return false;
  }
}

// Entering wallpaper mode while the window is in native (Space-based) full screen used to
// sink the window while the exit animation was still in flight; Electron's simple-full-screen
// frame then gets overridden by the tail of the native exit, leaving the window stuck at the
// visible frame (a menu-bar strip of the real desktop shows through the translucent menu bar)
// with the simple-full-screen flag already set and no later event to re-assert it — measured
// on-device. The posture is therefore deferred until the exit has fully landed.
// 'leave-full-screen' is the primary signal; a bounded poller is the fallback when the event
// never arrives (e.g. an exit the system cancelled mid-flight).
function deferMacWallpaperEnterUntilFullScreenExit() {
  if (!isMacWallpaperActive || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  macWallpaperPendingEnter = true;
  macWallpaperEnterPollElapsed = 0;
  let leftFullScreenSeen = false;
  let masksClearSince = 0; // timestamp once both full-screen kinds report off
  const applyPosture = () => {
    if (!macWallpaperPendingEnter || !isMacWallpaperActive || !mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    if (mainWindow.isFullScreen() || isMacSimpleFullScreen(mainWindow)) {
      return false;
    }
    macWallpaperPendingEnter = false;
    if (macWallpaperEnterPollTimer) {
      clearTimeout(macWallpaperEnterPollTimer);
      macWallpaperEnterPollTimer = null;
    }
    macWallpaperEnterPollElapsed = 0;
    const controller = getMacWallpaperController();
    return applyMacWallpaperPosture(controller);
  };
  const onLeftFullScreen = () => {
    if (!macWallpaperPendingEnter || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    leftFullScreenSeen = true;
    applyPosture();
  };
  mainWindow.once('leave-full-screen', onLeftFullScreen);
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  if (isMacSimpleFullScreen(mainWindow)) {
    mainWindow.setSimpleFullScreen(false);
  }
  const poll = () => {
    macWallpaperEnterPollTimer = null;
    if (!macWallpaperPendingEnter || !isMacWallpaperActive || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const nativeOn = mainWindow.isFullScreen();
    const simpleOn = isMacSimpleFullScreen(mainWindow);
    if (nativeOn || simpleOn) {
      masksClearSince = 0;
    } else if (masksClearSince === 0) {
      masksClearSince = Date.now();
    }
    // Apply once the exit has fully landed: the leave event, or masks clear AND stable for a
    // beat (the native exit animation can outlive the mask flip by a few hundred ms — applying
    // during it is exactly the stuck-frame state this deferral exists to avoid).
    if (!nativeOn && !simpleOn) {
      if (leftFullScreenSeen || Date.now() - masksClearSince >= 1000) {
        applyPosture();
      }
    }
    if (!macWallpaperPendingEnter) {
      return; // the posture ran (or rolled back); stop polling
    }
    macWallpaperEnterPollElapsed += MAC_WALLPAPER_FULLSCREEN_EXIT_POLL_MS;
    if (macWallpaperEnterPollElapsed >= MAC_WALLPAPER_FULLSCREEN_EXIT_MAX_WAIT_MS) {
      // The exit never settled: do not sink the window mid-transition (the exact failure this
      // deferral exists to avoid) — roll the mode back instead of leaving it half-entered.
      console.warn('[WallpaperMac] full-screen exit did not settle, wallpaper mode rolled back');
      macWallpaperPendingEnter = false;
      try {
        exitMacWallpaperMode();
      } catch (error) {
        // ignore
      }
      return;
    }
    macWallpaperEnterPollTimer = setTimeout(poll, MAC_WALLPAPER_FULLSCREEN_EXIT_POLL_MS);
  };
  macWallpaperEnterPollTimer = setTimeout(poll, MAC_WALLPAPER_FULLSCREEN_EXIT_POLL_MS);
}

function notifyMacWallpaperModeChanged() {
  refreshTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wallpaper-mode-changed', getPublicSettings());
  }
}

// Input Monitoring is required to forward desktop clicks/hover into the wallpaper window. When it
// is missing the renderer shows a toast pointing at System Settings (mirrors the Windows
// wallpaper-transparent-refused prompt pattern).
function notifyMacWallpaperInputMonitoringNeeded() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wallpaper-input-monitor-requested', null);
  }
}

// Dock auto-hide during a wallpaper session is position-aware: the Dock is hidden only while it
// sits at the bottom edge (where it overlaps the wallpaper's lower content); side Docks are never
// touched. The stored on/off switch is the override — off disables even a bottom Dock. Whatever
// the decision, exit/quit restore the user's original Dock state.
function shouldMacWallpaperAutohideDock(controller) {
  if (!controller) {
    return false;
  }
  if (store.get(WALLPAPER_MAC_AUTOHIDE_DOCK_SETTING_KEY) === false) {
    return false;
  }
  try {
    return controller.isDockAtBottom();
  } catch (error) {
    return false;
  }
}

function enterMacWallpaperMode() {
  if (process.platform !== 'darwin' || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (isMacWallpaperActive) {
    return true;
  }
  // Every failure path below rolls the setting back: the renderer keys its chrome off of the
  // stored wallpaper_mode, so leaving a stale true would strip the titlebar controls from a
  // window that is not actually acting as a wallpaper.
  const revertStoredWallpaperMode = () => {
    store.set(WALLPAPER_MODE_SETTING_KEY, false);
    notifyMacWallpaperModeChanged();
  };
  const controller = getMacWallpaperController();
  if (!controller || !controller.isAvailable()) {
    console.warn('[WallpaperMac] FFI bridge unavailable, wallpaper mode stays off');
    revertStoredWallpaperMode();
    return false;
  }
  // Interactivity is the point of the mac wallpaper (the sunk window can only be reached through
  // the tap); refuse entry instead of leaving a dead, unclickable wallpaper behind the icons.
  if (!controller.hasPermission()) {
    try {
      controller.requestPermission(); // surfaces the macOS Input Monitoring prompt
    } catch (error) {
      // ignore
    }
    notifyMacWallpaperInputMonitoringNeeded();
    revertStoredWallpaperMode();
    return false;
  }
  try {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      // The toggle can come from the tray while the window is hidden-to-tray; the wallpaper must
      // still appear. showInactive keeps focus on whatever the user is doing (the sunk window
      // never takes key focus anyway).
      try {
        mainWindow.showInactive();
      } catch (error) {
        mainWindow.show();
      }
    }
    // Mark active BEFORE the mutating calls so a mid-setup throw is rolled back by
    // exitMacWallpaperMode (which clears the flag and restores whatever it can).
    isMacWallpaperActive = true;
    setMainWindowClickThroughEnabled(false);
    // Wallpaper mode owns the z-order (FFI level sink below the icons), so an always-on-top
    // preference cannot survive the session. Flip the STORED flag only — calling Electron's
    // setAlwaysOnTop here (or from the tray before the entry) poisons the simple-full-screen
    // presentation of this window (measured: content presented 33pt low, empty menu-bar
    // strip above the wallpaper).
    if (mainWindowAlwaysOnTop) {
      mainWindowAlwaysOnTop = false;
      store.set(MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY, false);
    }
    if (mainWindow.isFullScreen() || isMacSimpleFullScreen(mainWindow)) {
      // Leaving native (Space-based) full screen is async, and any geometry we set while the
      // exit animation is in flight gets overwritten by it — leaving the window stuck at the
      // visible frame (measured: menu-bar strip of real desktop above the wallpaper, no later
      // event to re-assert). Defer the whole posture until the exit has fully landed.
      deferMacWallpaperEnterUntilFullScreenExit();
      return true;
    }
    macWallpaperSavedState = {
      bounds: mainWindow.getBounds(),
      resizable: mainWindow.isResizable(),
      movable: mainWindow.isMovable(),
      maximizable: mainWindow.isMaximizable(),
      nativeBlurEnabled: store.get('enable_player_page_native_blur') === true,
    };
    return applyMacWallpaperPosture(controller);
  } catch (error) {
    console.warn('[WallpaperMac] enter wallpaper mode failed:', error && error.message);
    try {
      exitMacWallpaperMode();
    } catch (exitError) {
      // ignore
    }
    return false;
  }
}

// Electron's simple-full-screen entry sets APP-LEVEL AutoHideDock|AutoHideMenuBar options
// (they apply whenever this app is frontmost) and its exit restores the value captured at
// entry. When a window is destroyed while still in simple full screen (window close /
// transparent-toggle rebuild), no exit runs and the bits survive; the next session then
// captures them as "the value to restore", stranding macOS in auto-hide every time this app
// is focused. After every wallpaper teardown, clear exactly those two bits. Only ever called
// once the window is restored/gone — never during a full-screen transition, and never with
// the FullScreen bit (clearing that mid-transition made an earlier fix loop).
function clearMacWallpaperAutoHideLeftovers() {
  const controller = getMacWallpaperController();
  if (!controller || typeof controller.clearAutoHidePresentationOptions !== 'function') {
    return false;
  }
  try {
    return controller.clearAutoHidePresentationOptions();
  } catch (error) {
    return false;
  }
}

function exitMacWallpaperMode() {
  if (process.platform !== 'darwin') {
    return false;
  }
  const controller = getMacWallpaperController();
  // These are system/process state: they must be restored even when the window is already gone.
  if (macWallpaperTapRetryTimer) {
    clearTimeout(macWallpaperTapRetryTimer);
    macWallpaperTapRetryTimer = null;
  }
  if (macWallpaperDragTimer) {
    clearTimeout(macWallpaperDragTimer);
    macWallpaperDragTimer = null;
  }
  macWallpaperPendingDrag = null;
  isMacWallpaperInteractionEnabled = false;
  macWallpaperTapFailures = 0;
  // A deferred entry (full-screen exit still in flight) must not sink the window after a
  // toggle-off / rollback / window close; stop its timers and pending latch.
  clearMacWallpaperDeferredState();
  if (controller) {
    try {
      controller.stop();
    } catch (error) {
      // ignore
    }
    try {
      void controller.restoreDock();
    } catch (error) {
      // ignore
    }
  }
  const wasActive = isMacWallpaperActive;
  isMacWallpaperActive = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    macWallpaperSavedState = null;
    if (wasActive) {
      store.set(WALLPAPER_MODE_SETTING_KEY, false);
      notifyMacWallpaperModeChanged();
    }
    // A destroyed window never ran Electron's simple-full-screen exit, so the app-level
    // AutoHide bits it set on entry survive unless cleared here.
    clearMacWallpaperAutoHideLeftovers();
    return wasActive;
  }
  if (!wasActive) {
    clearMacWallpaperAutoHideLeftovers();
    return false;
  }
  try {
    if (controller) {
      controller.setLevel(mainWindow, controller.normalLevel());
    }
    try {
      mainWindow.setVisibleOnAllWorkspaces(false);
    } catch (error) {
      // ignore
    }
    try {
      mainWindow.setIgnoreMouseEvents(false);
    } catch (error) {
      // ignore
    }
    // Resolve the frame to restore BEFORE leaving simple full screen: Electron's simple-full-
    // screen exit animates the window back to the frame that was current when it ENTERED —
    // which is the clamped pre-wallpaper display frame (setBounds is clamped to the workArea
    // on macOS), not the user's window. Restoring the bounds after the exit call races and
    // loses to that animation, leaving the window at the clamped full-display frame (measured
    // on-device: (0, menuBarHeight, displayW, displayH) — bottom off-screen). Pointing the
    // exit at the real restore frame first (setBounds updates Electron's recorded original
    // frame) makes the exit animation land exactly there.
    let macWallpaperRestoreBounds = null;
    if (macWallpaperSavedState && macWallpaperSavedState.bounds) {
      // Entering wallpaper from native full screen records the full-display frame; macOS
      // restores the real pre-fullscreen frame only for the window itself, so fall back to the
      // persisted normal bounds when the saved frame looks like a full-display rect.
      macWallpaperRestoreBounds = macWallpaperSavedState.bounds;
      try {
        const displayBounds = screen.getPrimaryDisplay().bounds;
        const looksLikeFullDisplay = macWallpaperRestoreBounds.x === displayBounds.x
          && macWallpaperRestoreBounds.y === displayBounds.y
          && macWallpaperRestoreBounds.width === displayBounds.width
          && macWallpaperRestoreBounds.height === displayBounds.height;
        if (looksLikeFullDisplay) {
          const storedNormal = getStoredWindowState();
          if (storedNormal.bounds && !storedNormal.isMaximized) {
            macWallpaperRestoreBounds = storedNormal.bounds;
          }
        }
      } catch (error) {
        // ignore
      }
    }
    if (isMacSimpleFullScreen(mainWindow)) {
      if (macWallpaperRestoreBounds) {
        try {
          // Updates Electron's recorded original frame so its exit animation lands here.
          mainWindow.setBounds(macWallpaperRestoreBounds, false);
        } catch (error) {
          // ignore
        }
      }
      try {
        mainWindow.setSimpleFullScreen(false);
      } catch (error) {
        // ignore
      }
    }
    if (macWallpaperSavedState) {
      mainWindow.setResizable(macWallpaperSavedState.resizable);
      mainWindow.setMovable(macWallpaperSavedState.movable);
      // setResizable(false) + simple full screen flip maximizable as an AppKit side effect and
      // neither setter restores it; put it back explicitly (after setResizable, which rewrites
      // the zoom-button style mask).
      try {
        mainWindow.setMaximizable(macWallpaperSavedState.maximizable !== false);
      } catch (error) {
        // ignore
      }
      if (!isTransparentPlayerBackgroundEnabled() && store.get('enable_player_page_native_blur') === true) {
        try {
          mainWindow.setVibrancy('fullscreen-ui');
        } catch (error) {
          // ignore
        }
      }
    } else {
      mainWindow.setResizable(true);
      mainWindow.setMovable(true);
      try {
        mainWindow.setMaximizable(true);
      } catch (error) {
        // ignore
      }
    }
    if (macWallpaperRestoreBounds) {
      mainWindow.setBounds(macWallpaperRestoreBounds, false);
    }
    // Restore the geometry guard only after the saved bounds are back, so the restore-induced
    // move/resize events cannot persist an intermediate geometry.
    mainWindow.__wallpaperGeometry = false;
    mainWindow.show();
    mainWindow.focus();
  } catch (error) {
    console.warn('[WallpaperMac] exit wallpaper mode restore issue:', error && error.message);
  } finally {
    macWallpaperSavedState = null;
    store.set(WALLPAPER_MODE_SETTING_KEY, false);
    notifyMacWallpaperModeChanged();
    // Runs after Electron's simple-full-screen exit restored its (possibly stale) capture;
    // this is the last word on the app-level AutoHide bits.
    clearMacWallpaperAutoHideLeftovers();
  }
  return true;
}

// The transparent-background toggle rebuilds the main window (the `transparent` flag is fixed at
// window creation), destroying the window the wallpaper session was sunk into. The session's
// per-window state — level, geometry, click-through, saved state — dies with it, so re-assert the
// full wallpaper posture on the replacement. Without this the window comes back as an ordinary
// window while the stored wallpaper_mode stays on: the renderer keeps its wallpaper chrome but the
// mode is visually gone (the in-place macOS path otherwise never rebuilds the window).
function rebindMacWallpaperSessionToCurrentWindow() {
  const controller = getMacWallpaperController();
  if (process.platform !== 'darwin' || !isMacWallpaperActive || !controller || !controller.isAvailable()) {
    return false;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (macWallpaperTapRetryTimer) {
    clearTimeout(macWallpaperTapRetryTimer);
    macWallpaperTapRetryTimer = null;
  }
  if (macWallpaperDragTimer) {
    clearTimeout(macWallpaperDragTimer);
    macWallpaperDragTimer = null;
  }
  macWallpaperPendingDrag = null;
  // The replacement window starts clean; drop any deferred-entry/settle timers the destroyed
  // window's session may still carry.
  clearMacWallpaperDeferredState();
  try {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      try {
        mainWindow.showInactive();
      } catch (error) {
        mainWindow.show();
      }
    }
    // Capture the replacement's normal state before mutating it — the recorded state from the
    // destroyed wallpaper window describes a frame that no longer exists.
    macWallpaperSavedState = {
      bounds: mainWindow.getBounds(),
      resizable: mainWindow.isResizable(),
      movable: mainWindow.isMovable(),
      maximizable: mainWindow.isMaximizable(),
      nativeBlurEnabled: store.get('enable_player_page_native_blur') === true,
    };
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
    if (isMacSimpleFullScreen(mainWindow)) {
      mainWindow.setSimpleFullScreen(false);
    }
    mainWindow.setResizable(false);
    mainWindow.setMovable(false);
    // The wallpaper frame is dictated by the display; never persist the replacement's geometry
    // while it spans the screen (same guard enterMacWallpaperMode sets).
    mainWindow.__wallpaperGeometry = true;
    // vibrancy at the desktop layer renders behind the icons (the "wallpaper stuck" AppKit trap);
    // drop it for the session and restore it on exit if the user had native blur on.
    if (macWallpaperSavedState.nativeBlurEnabled) {
      try {
        mainWindow.setVibrancy(null);
      } catch (error) {
        // ignore
      }
    }
    // Frame first, then ambient — same order the posture uses (see applyMacWallpaperPosture).
    applyMacWallpaperFrame();
    applyMacAmbientLevel();
    if (shouldMacWallpaperAutohideDock(controller)) {
      void controller.setDockAutohide(true);
    }
    // Re-arm the tap against the replacement window. When interactivity was already disabled
    // this degrades gracefully instead of failing the rebind.
    startMacWallpaperInteraction();
    scheduleMacWallpaperFrameSettleVerify();
    return true;
  } catch (error) {
    console.warn('[WallpaperMac] re-sink wallpaper after window swap failed:', error && error.message);
    return false;
  }
}

// Bare-desktop events only matter where the wallpaper window actually is. The tap is session-wide,
// so on a multi-display setup the other screens' bare desktop would otherwise start gestures that
// this window (spanning the primary display only) must never receive.
function macWallpaperWindowHitTest(x, y) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  try {
    const b = mainWindow.getBounds();
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  } catch (error) {
    return false;
  }
}

// Toggle the "click the wallpaper directly" behaviour (default ON in wallpaper mode). Starts or
// stops the listen-only mouse tap. Needs the Input Monitoring grant; until it is granted the
// wallpaper stays on but non-interactive.
function startMacWallpaperInteraction() {
  const controller = getMacWallpaperController();
  if (!isMacWallpaperActive || !controller || !controller.isAvailable()) {
    return false;
  }
  if (!isMacWallpaperInteractionEnabled) {
    controller.stop();
    return false;
  }
  if (!controller.hasPermission()) {
    try {
      controller.requestPermission();
    } catch (error) {
      // ignore
    }
    isMacWallpaperInteractionEnabled = false;
    notifyMacWallpaperInputMonitoringNeeded();
    return false;
  }
  const started = controller.start(forwardMacWallpaperMouse, macWallpaperWindowHitTest);
  if (!started) {
    macWallpaperTapFailures += 1;
    if (macWallpaperTapFailures >= MAC_WALLPAPER_TAP_FAILURE_THRESHOLD) {
      // Repeated failure -> degrade to a non-interactive wallpaper instead of a retry loop.
      console.warn('[WallpaperMac] event tap keeps failing, wallpaper is now non-interactive');
      isMacWallpaperInteractionEnabled = false;
      controller.stop();
      notifyMacWallpaperInputMonitoringNeeded();
      return false;
    }
    if (!macWallpaperTapRetryTimer) {
      macWallpaperTapRetryTimer = setTimeout(() => {
        macWallpaperTapRetryTimer = null;
        if (isMacWallpaperActive && isMacWallpaperInteractionEnabled) {
          startMacWallpaperInteraction();
        }
      }, MAC_WALLPAPER_TAP_RETRY_DELAY_MS);
      if (typeof macWallpaperTapRetryTimer?.unref === 'function') {
        macWallpaperTapRetryTimer.unref();
      }
    }
    return false;
  }
  macWallpaperTapFailures = 0;
  return true;
}

function stopMacWallpaperInteraction() {
  isMacWallpaperInteractionEnabled = false;
  const controller = getMacWallpaperController();
  if (controller) {
    try {
      controller.stop();
    } catch (error) {
      // ignore
    }
  }
}

function flushMacWallpaperPendingDrag() {
  if (macWallpaperDragTimer) {
    clearTimeout(macWallpaperDragTimer);
    macWallpaperDragTimer = null;
  }
  if (!macWallpaperPendingDrag) {
    return;
  }
  const dragEvent = macWallpaperPendingDrag;
  macWallpaperPendingDrag = null;
  sendMacWallpaperMouseEvent(dragEvent);
}

// The tap only reports events it verified as bare-desktop, so nothing an app/Dock/window owns is
// ever hijacked. Down/up/scroll pass through immediately; drag events are coalesced to the latest
// position and flushed at ~display rate so the main -> renderer IPC does not flood.
function forwardMacWallpaperMouse(event) {
  if (!isMacWallpaperActive || !isMacWallpaperInteractionEnabled) {
    return;
  }
  if (event.kind === 'drag' || event.kind === 'rdrag') {
    macWallpaperPendingDrag = event; // only the most recent position survives
    if (!macWallpaperDragTimer) {
      macWallpaperDragTimer = setTimeout(flushMacWallpaperPendingDrag, MAC_WALLPAPER_DRAG_FLUSH_MS);
    }
    return;
  }
  flushMacWallpaperPendingDrag(); // emit any pending move first (event order + final position)
  sendMacWallpaperMouseEvent(event);
}

// Inject one screen-space desktop mouse event into the wallpaper renderer via sendInputEvent
// (the behind-icons window never receives these natively). Screen point -> window content point.
function sendMacWallpaperMouseEvent(event) {
  if (!isMacWallpaperActive || !isMacWallpaperInteractionEnabled || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  try {
    const bounds = mainWindow.getBounds();
    const x = Math.round(event.x - bounds.x);
    const y = Math.round(event.y - bounds.y);
    const webContents = mainWindow.webContents;
    switch (event.kind) {
      case 'down': {
        // clickCount must be synthesised: injected events bypass the OS multi-click detector.
        const now = Date.now();
        const isDoubleClick = now - macWallpaperMouseDownAt.at < 500
          && Math.abs(event.x - macWallpaperMouseDownAt.x) <= 8
          && Math.abs(event.y - macWallpaperMouseDownAt.y) <= 8;
        macWallpaperMouseDownAt = { at: now, x: event.x, y: event.y };
        webContents.sendInputEvent({
          type: 'mouseDown',
          x,
          y,
          button: 'left',
          clickCount: isDoubleClick ? 2 : 1,
          modifiers: ['leftbuttondown'],
        });
        return;
      }
      case 'up':
        webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        return;
      case 'drag': {
        // Injected mouseMove events carry no button state of their own; the modifier is what
        // keeps MouseEvent.buttons=1 so Chromium does not tear the drag down mid-gesture.
        webContents.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftbuttondown'] });
        return;
      }
      case 'rdrag': {
        // Right-drag mirrors the left-drag case with the right-button modifier (buttons=2).
        webContents.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['rightbuttondown'] });
        return;
      }
      case 'rdown':
        webContents.sendInputEvent({
          type: 'mouseDown',
          x,
          y,
          button: 'right',
          clickCount: 1,
          modifiers: ['rightbuttondown'],
        });
        return;
      case 'rup':
        webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
        return;
      case 'move': {
        if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
          return; // nothing to hover outside the window
        }
        webContents.sendInputEvent({ type: 'mouseMove', x, y });
        return;
      }
      case 'scroll': {
        if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
          return;
        }
        // Quartz line deltas scale to CSS px for Chromium's mouseWheel (calibrated with the same
        // multiplier the reference implementation uses on-device).
        webContents.sendInputEvent({
          type: 'mouseWheel',
          x,
          y,
          deltaX: (event.dx || 0) * 16,
          deltaY: (event.dy || 0) * 16,
          canScroll: true,
        });
        return;
      }
      default:
        break;
    }
  } catch (error) {
    // ignore
  }
}

// Startup wrapper: only the main process reaches main.cjs (GPU/renderer children start with
// --type=... and exit before this). The jumpboard takes the single-instance lock before spawning
// windowtolayer; the wrapped child uses FOLIA_RELAUNCH to retry after the jumpboard exits.
const wallpaperMode = isWallpaperModeEnabled();
const onWayland = Boolean(process.env.WAYLAND_DISPLAY);

// Serializes ownership, wrapper launch, and crash-loop accounting.
async function prepareMainProcessStartup() {
  const gotSingleInstanceLock = await acquireSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    return 'duplicate';
  }

  app.on('second-instance', () => {
    focusMainWindow();
  });

  if (isWallpaperWrapped()) {
    wallpaperWatchdog.recordWrappedLaunch();
    wallpaperWatchdog.startParentLivenessProbe({ parentPid: process.ppid });
    return 'ready';
  }

  if (!wallpaperMode || !onWayland) {
    wallpaperWatchdog.resetWrappedCrashCount();
    return 'ready';
  }

  if (wallpaperWatchdog.shouldDisableWallpaperMode()) {
    // Repeated wrapped sessions crashed before the watchdog could fire; turn the mode off and
    // run as a plain window this time instead of re-entering the wrap loop.
    console.warn('[Wallpaper] repeated wrapped crashes, disabling wallpaper mode');
    store.set(WALLPAPER_MODE_SETTING_KEY, false);
    wallpaperWatchdog.resetWrappedCrashCount();
    return 'fallback';
  }

  const wrapperResult = await launchWrappedSelf();
  if (wrapperResult !== 'spawned') {
    wallpaperWatchdog.resetWrappedCrashCount();
    return 'fallback';
  }
  return wrapperResult;
}

const mainProcessStartupPromise = prepareMainProcessStartup();

// --- Electron main process locale map ---
const APP_LOCALE_KEY = 'APP_LOCALE';
const mainLocale = {
  'zh-CN': {
    trayShowWindow: '显示窗口',
    trayHideWindow: '隐藏窗口',
    trayOpenRemote: '遥控窗口',
    trayTransparentBackground: '透明背景',
    trayToggleClickThrough: '点击穿透',
    trayAlwaysOnTop: '窗口置顶',
    trayHideTaskbar: '隐藏任务栏图标',
    trayDesktopLyricMode: '桌面歌词',
    trayToggleWallpaperMode: '壁纸模式',
    trayResetWindow: '重置窗口',
    trayQuit: '退出',
    dialogImportTitle: '无法导入此文件夹',
    dialogImportMessage: '不能直接导入系统目录或常用用户目录。\n请选择一个专门存放音乐的文件夹。',
    dialogChooseOther: '选择其他文件夹',
    dialogCancel: '取消',
    crashTitle: 'Folia 遇到了问题',
    crashMessage: '程序发生了一次崩溃，日志已保存。把它发给开发者能帮助定位问题。',
    crashOpenFolder: '打开日志所在文件夹',
    crashClose: '关闭',
  },
  en: {
    trayShowWindow: 'Show Window',
    trayHideWindow: 'Hide Window',
    trayOpenRemote: 'Remote Window',
    trayTransparentBackground: 'Transparent Background',
    trayToggleClickThrough: 'Click-Through',
    trayAlwaysOnTop: 'Always on Top',
    trayHideTaskbar: 'Hide Taskbar Icon',
    trayDesktopLyricMode: 'Desktop Lyrics',
    trayToggleWallpaperMode: 'Wallpaper Mode',
    trayResetWindow: 'Reset Window',
    trayQuit: 'Quit',
    dialogImportTitle: 'Cannot import this folder',
    dialogImportMessage: 'Cannot directly import system or common user directories.\nPlease choose a dedicated music folder.',
    dialogChooseOther: 'Choose Another Folder',
    dialogCancel: 'Cancel',
    crashTitle: 'Folia ran into a problem',
    crashMessage: 'The app crashed and a log has been saved. Sending it to the developer helps track the problem down.',
    crashOpenFolder: 'Open Log Folder',
    crashClose: 'Close',
  },
  in: {
    trayShowWindow: 'Tampilkan Jendela',
    trayHideWindow: 'Sembunyikan Jendela',
    trayOpenRemote: 'Jendela Remote',
    trayTransparentBackground: 'Latar Belakang Transparan',
    trayToggleClickThrough: 'Click-Through',
    trayAlwaysOnTop: 'Selalu di Atas',
    trayHideTaskbar: 'Sembunyikan Ikon Taskbar',
    trayDesktopLyricMode: 'Lirik Desktop',
    trayToggleWallpaperMode: 'Mode Wallpaper',
    trayResetWindow: 'Atur Ulang Jendela',
    trayQuit: 'Keluar',
    dialogImportTitle: 'Tidak dapat mengimpor folder ini',
    dialogImportMessage: 'Folder sistem atau folder pengguna umum tidak dapat diimpor langsung.\nPilih folder khusus untuk menyimpan musik.',
    dialogChooseOther: 'Pilih Folder Lain',
    dialogCancel: 'Batal',
    crashTitle: 'Folia mengalami masalah',
    crashMessage: 'Aplikasi mengalami crash dan log telah disimpan. Mengirimkannya ke pengembang membantu menemukan masalahnya.',
    crashOpenFolder: 'Buka Folder Log',
    crashClose: 'Tutup',
  },
};

// Maps an arbitrary BCP 47 tag onto one of the three locales the main process ships.
// Returns null for unsupported tags so callers can keep walking the preference list.
function normalizeMainLocaleKey(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  const lowered = value.toLowerCase();
  if (lowered === 'in' || lowered.startsWith('id')) {
    return 'in';
  }
  if (lowered.startsWith('zh')) {
    return 'zh-CN';
  }
  if (lowered.startsWith('en')) {
    return 'en';
  }
  return null;
}

// Used before the renderer has ever pushed APP_LOCALE, so a fresh install shows
// tray and dialog text in the system language instead of hard-defaulting to English.
// Both Electron locale APIs require `ready`, which every caller here is past.
function detectSystemLocaleKey() {
  const candidates = [];

  if (typeof app.getPreferredSystemLanguages === 'function') {
    try {
      candidates.push(...app.getPreferredSystemLanguages());
    } catch (error) {
      console.warn('[Electron] Failed to read preferred system languages', error);
    }
  }

  try {
    candidates.push(app.getLocale());
  } catch (error) {
    console.warn('[Electron] Failed to read app locale', error);
  }

  for (const candidate of candidates) {
    const normalized = normalizeMainLocaleKey(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return 'en';
}

// The locale key the main process should speak in, honouring the app setting
// and falling back to the system locale. Split out from getMainLocale so
// modules with their own dialog copy (the mod loader) can ask for the key.
function getMainLocaleKey() {
  const stored = store.get(APP_LOCALE_KEY);
  if (stored === 'zh-CN' || stored === 'en' || stored === 'in') {
    return stored;
  }
  return detectSystemLocaleKey();
}

function getMainLocale() {
  return mainLocale[getMainLocaleKey()];
}

// Crash reporting. Installed here rather than at the end of the file because everything below it
// runs before `ready`, and a startup failure is exactly the crash a user cannot diagnose alone.
// Writes to `logs` beside the executable where that is writable — see resolveCrashLogDir for the
// platforms where it is not, and where the reports land instead.
const crashLog = createCrashLog({
  app,
  dialog,
  shell,
  getLocale: getMainLocale,
  onLine: runtimeLine,
});
installCrashHandlers({
  app,
  crashLog,
  // 壁纸模式对渲染进程崩溃有自己的恢复路径：Linux 的 windowtolayer watchdog 会重启进程回到普通
  // 窗口，Windows / macOS 就地 reload 页面。两处都只认 reason === 'crashed'，这里跟着它们走。
  // 崩溃文件照写，只是不弹窗——桌面正在自己恢复，弹出来的框用户除了关掉别无选择。
  isRendererCrashRecovered: (details) => details?.reason === 'crashed' && isWallpaperModeEnabled(),
});


let mainWindow = null;
let modSystem = null;
let remoteControlWindow = null;
let appTray = null;
let latestRemoteControlSnapshot = null;
let obsBrowserSourceServer = null;
let latestObsBrowserSourceConfig = null;
let latestObsBrowserSourceClock = null;
let latestObsBrowserSourceAudio = null;
const obsBrowserSourceClients = new Set();
let remoteControlAlwaysOnTop = false;
let remoteControlSkipTaskbarEnabled = false;
let mainWindowAlwaysOnTop = false;
let mainWindowClickThroughEnabled = false;
let mainWindowClickThroughUnlockHover = false;
let mainWindowClickThroughUnlockHoverTimer = null;
let mainWindowSkipTaskbarEnabled = false;
let videoExportWindowRestoreState = null;
let autoUpdater = null;
// Backed by the settings store so a handoff survives a full process relaunch (wallpaper mode)
const windowPlaybackHandoffStore = createWindowPlaybackHandoffStore({
  storage: store,
  ttlMs: 60_000,
});
const pendingWindowPlaybackHandoffRequests = new Map();
let pendingWindowStateSave = null;
let windowStateSaveTimer = null;
let wallpaperModeRelaunchTimer = null;
let wallpaperModeRelaunchGeneration = 0;
const x11WallpaperWindows = new WeakSet();
const MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT = {
  width: 48,
  height: 40,
  rightInset: 176,
  topInset: 4,
};
const MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOVER_INTERVAL_MS = 150;
const DEFAULT_WINDOW_BOUNDS = {
  width: 1200,
  height: 800,
};
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300;
const CACHE_DIRECTORY_SETTING_KEY = 'CACHE_DIRECTORY';
const MODELS_DIRECTORY_SETTING_KEY = 'MODELS_DIRECTORY';
const ENABLE_UPDATE_CHECK_SETTING_KEY = 'ENABLE_UPDATE_CHECK';
const ENABLE_AUTO_UPDATE_SETTING_KEY = 'ENABLE_AUTO_UPDATE';
const UPDATE_CHANNEL_SETTING_KEY = 'UPDATE_CHANNEL';
const LAST_SEEN_UPDATE_VERSION_SETTING_KEY = 'LAST_SEEN_UPDATE_VERSION';
const STAGE_MODE_ENABLED_SETTING_KEY = 'STAGE_MODE_ENABLED';
const STAGE_MODE_SOURCE_SETTING_KEY = 'STAGE_MODE_SOURCE';
const STAGE_API_TOKEN_SETTING_KEY = 'STAGE_API_TOKEN';
const STAGE_API_PORT_SETTING_KEY = 'STAGE_API_PORT';
const OBS_BROWSER_SOURCE_ENABLED_SETTING_KEY = 'OBS_BROWSER_SOURCE_ENABLED';
const OBS_BROWSER_SOURCE_TOKEN_SETTING_KEY = 'OBS_BROWSER_SOURCE_TOKEN';
const OBS_BROWSER_SOURCE_PORT_SETTING_KEY = 'OBS_BROWSER_SOURCE_PORT';
const LYRIC_API_ENABLED_SETTING_KEY = 'LYRIC_API_ENABLED';
const DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY = 'DISCORD_RICH_PRESENCE_ENABLED';
const MINIMIZE_TO_TRAY_SETTING_KEY = 'MINIMIZE_TO_TRAY';
const HIDE_TASKBAR_ICON_SETTING_KEY = 'HIDE_TASKBAR_ICON';
const REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY = 'REMOTE_CONTROL_ALWAYS_ON_TOP';
const REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY = 'REMOTE_CONTROL_SKIP_TASKBAR';
const MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY = 'MAIN_WINDOW_ALWAYS_ON_TOP';
const TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY = 'TRANSPARENT_PLAYER_BACKGROUND';
const VOICE_INPUT_PAUSE_ENABLED_SETTING_KEY = 'VOICE_INPUT_PAUSE_ENABLED';
const PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_SETTING_KEY = 'PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK';
// Master switch for the experimental mod system. Off by default: with it off no
// mod is discovered, activated or reachable over IPC, so an unfinished
// apiVersion 1 costs nothing to anyone who has not opted in.
const MOD_SYSTEM_ENABLED_SETTING_KEY = 'MOD_SYSTEM_ENABLED';

const DEFAULT_STAGE_API_PORT = 32107;
const DEFAULT_OBS_BROWSER_SOURCE_PORT = 32108;
const DEFAULT_LYRIC_API_PORT = 32109;
const FOLIA_RELEASES_URL = 'https://github.com/chthollyphile/folia-major/releases';
const FOLIA_GITHUB_REPOSITORY = {
  owner: 'chthollyphile',
  repo: 'folia-major',
};
const WINDOWS_APP_USER_MODEL_ID = 'top.izuna.foliamajor';
const REMOTE_CONTROL_WINDOW_TITLE = 'Folia Remote';
const WINDOW_PLAYBACK_HANDOFF_REQUEST_TIMEOUT_MS = 800;
const bundledAppIconPath = path.join(__dirname, '../build/icon.png');
const extraResourceIconPath = path.join(process.resourcesPath, 'icon.png');
const bundledMacTrayIconPath = path.join(__dirname, '../build/trayTemplate.png');
const bundledMacTrayIcon2xPath = path.join(__dirname, '../build/trayTemplate@2x.png');
const extraResourceMacTrayIconPath = path.join(process.resourcesPath, 'trayTemplate.png');
const extraResourceMacTrayIcon2xPath = path.join(process.resourcesPath, 'trayTemplate@2x.png');
const APP_ICON_PATH = fs.existsSync(bundledAppIconPath) ? bundledAppIconPath : extraResourceIconPath;
const THUMBAR_ICON_DIR = path.join(__dirname, '../build/thumbar');

function loadThumbarIcon(name) {
  if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
    return null;
  }

  return nativeImage.createFromPath(path.join(THUMBAR_ICON_DIR, name)).resize({
    width: 16,
    height: 16,
    quality: 'best',
  });
}

const THUMBAR_BUTTON_ICONS = process.platform === 'win32'
  ? {
    previous: loadThumbarIcon('previous.png'),
    play: loadThumbarIcon('play.png'),
    pause: loadThumbarIcon('pause.png'),
    next: loadThumbarIcon('next.png'),
  }
  : null;

// macOS menu bar icons should be monochrome template images with transparent backgrounds.
function createTrayIconImage() {
  if (process.platform !== 'darwin') {
    return APP_ICON_PATH;
  }

  if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
    return APP_ICON_PATH;
  }

  const trayImagePath = fs.existsSync(bundledMacTrayIconPath)
    ? bundledMacTrayIconPath
    : extraResourceMacTrayIconPath;
  const trayImage2xPath = fs.existsSync(bundledMacTrayIcon2xPath)
    ? bundledMacTrayIcon2xPath
    : extraResourceMacTrayIcon2xPath;
  const trayImage = nativeImage.createFromPath(trayImagePath);

  if (trayImage.isEmpty()) {
    return APP_ICON_PATH;
  }

  const retinaImage = nativeImage.createFromPath(trayImage2xPath);
  if (!retinaImage.isEmpty()) {
    trayImage.addRepresentation({
      scaleFactor: 2.0,
      width: 32,
      height: 32,
      buffer: retinaImage.toPNG(),
    });
  }

  if (typeof trayImage.setTemplateImage === 'function') {
    trayImage.setTemplateImage(true);
  }

  return trayImage;
}

function readStoredBoolean(settingKey, fallback = false) {
  const value = store.get(settingKey);

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return fallback;
}

function getPublicSettings() {
  return {
    ...store.store,
    [MINIMIZE_TO_TRAY_SETTING_KEY]: readStoredBoolean(MINIMIZE_TO_TRAY_SETTING_KEY, false),
    [HIDE_TASKBAR_ICON_SETTING_KEY]: readStoredBoolean(HIDE_TASKBAR_ICON_SETTING_KEY, false),
    [REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY]: readStoredBoolean(REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY, true),
    [REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY]: readStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY, false),
    [MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY]: readStoredBoolean(MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY, false),
    [TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY]: readStoredBoolean(TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY, false),
    [DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY]: readStoredBoolean(DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY, false),
    [LYRIC_API_ENABLED_SETTING_KEY]: readStoredBoolean(LYRIC_API_ENABLED_SETTING_KEY, false),
    [VOICE_INPUT_PAUSE_ENABLED_SETTING_KEY]: readStoredBoolean(VOICE_INPUT_PAUSE_ENABLED_SETTING_KEY, false),
    [PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_SETTING_KEY]: readStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_SETTING_KEY, false),
    [MOD_SYSTEM_ENABLED_SETTING_KEY]: readStoredBoolean(MOD_SYSTEM_ENABLED_SETTING_KEY, false),
    [UPDATE_CHANNEL_SETTING_KEY]: getCurrentReleaseChannel().id,
    'enable_player_page_native_blur': store.get('enable_player_page_native_blur') === true,
    'wallpaper_attach_mode': process.platform === 'win32' ? wallpaperWindowsAttachMode : null,
    [WALLPAPER_MODE_SETTING_KEY]: isWallpaperModeEnabled(),
    [WALLPAPER_MAC_AUTOHIDE_DOCK_SETTING_KEY]: readStoredBoolean(WALLPAPER_MAC_AUTOHIDE_DOCK_SETTING_KEY, true),
  };
}

function getConfiguredObsBrowserSourcePort() {
  const storedPort = Number(store.get(OBS_BROWSER_SOURCE_PORT_SETTING_KEY));
  if (Number.isInteger(storedPort) && storedPort > 0 && storedPort <= 65535) {
    return storedPort;
  }
  return DEFAULT_OBS_BROWSER_SOURCE_PORT;
}

function isObsBrowserSourceEnabled() {
  return Boolean(store.get(OBS_BROWSER_SOURCE_ENABLED_SETTING_KEY));
}

function getObsBrowserSourceToken({ generateIfMissing = false } = {}) {
  const existing = store.get(OBS_BROWSER_SOURCE_TOKEN_SETTING_KEY);
  if (typeof existing === 'string' && existing.trim()) {
    return existing;
  }

  if (!generateIfMissing) {
    return null;
  }

  const nextToken = crypto.randomBytes(32).toString('base64url');
  store.set(OBS_BROWSER_SOURCE_TOKEN_SETTING_KEY, nextToken);
  return nextToken;
}

function buildObsBrowserSourceUrl() {
  const token = getObsBrowserSourceToken({ generateIfMissing: isObsBrowserSourceEnabled() });
  if (!token) {
    return null;
  }

  return `http://127.0.0.1:${getConfiguredObsBrowserSourcePort()}/obs?obs=1&token=${encodeURIComponent(token)}`;
}

function buildObsBrowserSourceStatus() {
  const token = getObsBrowserSourceToken({ generateIfMissing: isObsBrowserSourceEnabled() });
  return {
    enabled: isObsBrowserSourceEnabled(),
    port: getConfiguredObsBrowserSourcePort(),
    token,
    url: token ? buildObsBrowserSourceUrl() : null,
    clientCount: obsBrowserSourceClients.size,
  };
}

function broadcastObsBrowserSourceStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('obs-browser-source-status-changed', buildObsBrowserSourceStatus());
  }
}

mainWindowSkipTaskbarEnabled = readStoredBoolean(HIDE_TASKBAR_ICON_SETTING_KEY, false);
remoteControlAlwaysOnTop = readStoredBoolean(REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY, true);
remoteControlSkipTaskbarEnabled = readStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY, false);
mainWindowAlwaysOnTop = readStoredBoolean(MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY, false);

const stageApi = createStageApi({
  app,
  store,
  getMainWindow: () => mainWindow,
  stageModeEnabledSettingKey: STAGE_MODE_ENABLED_SETTING_KEY,
  stageModeSourceSettingKey: STAGE_MODE_SOURCE_SETTING_KEY,
  stageApiTokenSettingKey: STAGE_API_TOKEN_SETTING_KEY,
  stageApiPortSettingKey: STAGE_API_PORT_SETTING_KEY,
  defaultStageApiPort: DEFAULT_STAGE_API_PORT,
  getNeteasePort: () => assignedPort,
});

const lyricApi = createLyricApi({
  store,
  getMainWindow: () => mainWindow,
  enabledSettingKey: LYRIC_API_ENABLED_SETTING_KEY,
  port: DEFAULT_LYRIC_API_PORT,
});

const discordPresence = createDiscordPresenceController({
  getApplicationId: () => DEFAULT_DISCORD_APPLICATION_ID,
  isEnabled: () => readStoredBoolean(DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY, false),
  onStatusChange: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('discord-presence-status-changed', status);
    }
  },
});

const voiceInputPauseMonitor = createVoiceInputPauseMonitor({
  getMainWindow: () => mainWindow,
  isEnabled: () => readStoredBoolean(VOICE_INPUT_PAUSE_ENABLED_SETTING_KEY, false),
  getOwnExePath: () => process.execPath,
});
const displaySleepBlocker = createDisplaySleepBlocker(powerSaveBlocker);
// Both models, in a child process. Registers their IPC handlers; the renderer falls back to its
// own estimators whenever they answer null, which is what the web build always gets.
// The developer debug module: the runtime log and the memory monitor, both switched from
// Settings > Developer. Created BEFORE the analysis host, which logs through it.
createDebugHost({ app, ipcMain, store, BrowserWindow });

const analysisHost = createAnalysisHost({ app, ipcMain, getModelsDirs: getModelsDirectories });

function buildPlaybackSyncBridgeStatus() {
  return {
    remoteControlOpen: Boolean(remoteControlWindow && !remoteControlWindow.isDestroyed()),
    discordPresenceEnabled: readStoredBoolean(DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY, false),
  };
}

function broadcastPlaybackSyncBridgeStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('playback-sync-bridge-status-changed', buildPlaybackSyncBridgeStatus());
  }
}

function getStoredWindowState() {
  const storedBounds = store.get('WINDOW_BOUNDS');
  const storedMaximized = store.get('WINDOW_IS_MAXIMIZED');

  return {
    bounds:
      storedBounds &&
        typeof storedBounds.width === 'number' &&
        typeof storedBounds.height === 'number'
        ? storedBounds
        : DEFAULT_WINDOW_BOUNDS,
    isMaximized: Boolean(storedMaximized),
  };
}

function ensureWindowBoundsVisible(bounds) {
  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return bounds;
  }

  const displays = screen.getAllDisplays();

  if (!displays.length) {
    return bounds;
  }

  const visibleDisplay = displays.find(({ workArea }) => {
    const horizontalOverlap =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const verticalOverlap =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);

    return horizontalOverlap > 0 && verticalOverlap > 0;
  });

  if (visibleDisplay) {
    return bounds;
  }

  const primaryWorkArea = screen.getPrimaryDisplay().workArea;

  return {
    width: Math.min(bounds.width, primaryWorkArea.width),
    height: Math.min(bounds.height, primaryWorkArea.height),
    x: primaryWorkArea.x + Math.max(0, Math.floor((primaryWorkArea.width - Math.min(bounds.width, primaryWorkArea.width)) / 2)),
    y: primaryWorkArea.y + Math.max(0, Math.floor((primaryWorkArea.height - Math.min(bounds.height, primaryWorkArea.height)) / 2)),
  };
}

function persistWindowStateSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  const nextState = {
    WINDOW_IS_MAXIMIZED: snapshot.isMaximized,
  };

  if (!snapshot.isMaximized && snapshot.bounds) {
    nextState.WINDOW_BOUNDS = snapshot.bounds;
  }

  store.set(nextState);
}

function clearWindowStateSaveTimer() {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
  }
}

function saveWindowState(win, options = {}) {
  // A wallpaper window's geometry is dictated by the display; persisting it would clobber the
  // bounds a normal window restores to after leaving wallpaper mode (same reason as the X11
  // guards — the Windows wallpaper path just has no separate window set to check against).
  if (!win || win.isDestroyed() || isX11WallpaperMode() || x11WallpaperWindows.has(win) || win.__wallpaperGeometry === true) {
    return;
  }

  const isMaximized = win.isMaximized();
  const snapshot = {
    isMaximized,
    bounds: isMaximized ? null : win.getBounds(),
  };

  if (options.deferred) {
    pendingWindowStateSave = snapshot;
    clearWindowStateSaveTimer();
    windowStateSaveTimer = setTimeout(() => {
      persistWindowStateSnapshot(pendingWindowStateSave);
      pendingWindowStateSave = null;
      windowStateSaveTimer = null;
    }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
    return;
  }

  pendingWindowStateSave = null;
  clearWindowStateSaveTimer();
  persistWindowStateSnapshot(snapshot);
}

function isWindowsThumbarSupported() {
  return process.platform === 'win32';
}

function sendThumbarAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('thumbar-action', action);
}

function updateWindowThumbarButtons(state = {}) {
  if (!isWindowsThumbarSupported() || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const {
    hasActiveTrack = false,
    canGoPrevious = false,
    canGoNext = false,
    isPlaying = false,
  } = state;

  if (!hasActiveTrack) {
    try {
      return mainWindow.setThumbarButtons([]);
    } catch (error) {
      console.warn('[Electron] Failed to clear Windows thumbar buttons', error);
      return false;
    }
  }

  try {
    return mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous Track',
        icon: THUMBAR_BUTTON_ICONS.previous,
        flags: canGoPrevious ? [] : ['disabled'],
        click: () => sendThumbarAction('previous'),
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: isPlaying ? THUMBAR_BUTTON_ICONS.pause : THUMBAR_BUTTON_ICONS.play,
        click: () => sendThumbarAction('play-pause'),
      },
      {
        tooltip: 'Next Track',
        icon: THUMBAR_BUTTON_ICONS.next,
        flags: canGoNext ? [] : ['disabled'],
        click: () => sendThumbarAction('next'),
      },
    ]);
  } catch (error) {
    console.warn('[Electron] Failed to set Windows thumbar buttons', error);
    return false;
  }
}

function getDefaultCacheDirectory() {
  return path.join(app.getPath('userData'), 'media-cache');
}

function getConfiguredCacheDirectory() {
  const configured = store.get(CACHE_DIRECTORY_SETTING_KEY);
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured
    : getDefaultCacheDirectory();
}

// The analysis model weights - 83MB and 166MB of ONNX - and the three places they are allowed to
// live, best first.
//
// They used to be one place: `resources/models` inside the install directory, shipped in the
// installer. That put 249MB into a 436MB download that most listeners never turn the feature on for,
// and it put them somewhere an update or a reinstall overwrites - so "you do not have to download
// the models again" was not true even though nothing about them had changed.
//
// Now: whatever directory the user pointed us at, then the app's own download directory under
// userData (which no update touches), then the bundled copy - kept so a build that still ships them
// works unchanged, and so `npm run models:fetch` keeps working in a dev checkout.
function getDefaultModelsDirectory() {
  return path.join(app.getPath('userData'), 'models');
}

function getConfiguredModelsDirectory() {
  const configured = store.get(MODELS_DIRECTORY_SETTING_KEY);
  return typeof configured === 'string' && configured.trim().length > 0 ? configured.trim() : null;
}

function getBundledModelsDirectory() {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'models');
}

function getModelsDirectories() {
  return [getConfiguredModelsDirectory(), getDefaultModelsDirectory(), getBundledModelsDirectory()];
}

function getAudioCacheDirectory() {
  return path.join(getConfiguredCacheDirectory(), 'audio');
}

function getCoverCacheDirectory() {
  return path.join(getConfiguredCacheDirectory(), 'cover');
}

const localCoverAssetStore = createLocalCoverAssetStore({
  getDirectory: () => getLocalCoverAssetDirectory(app.getPath('userData')),
  createThumbnail: async (source, requestedSize) => {
    const image = nativeImage.createFromBuffer(source);
    if (image.isEmpty()) return null;
    const dimensions = image.getSize();
    const longestEdge = Math.max(dimensions.width, dimensions.height);
    if (longestEdge <= requestedSize) return null;
    const scale = requestedSize / longestEdge;
    const resized = image.resize({
      width: Math.max(1, Math.round(dimensions.width * scale)),
      height: Math.max(1, Math.round(dimensions.height * scale)),
      quality: 'good',
    });
    return { data: resized.toJPEG(84), mimeType: 'image/jpeg' };
  },
});

function getAudioCacheBaseName(cacheKey) {
  return crypto.createHash('sha256').update(cacheKey).digest('hex');
}

function getAudioCachePaths(cacheKey) {
  const baseName = getAudioCacheBaseName(cacheKey);
  const directory = getAudioCacheDirectory();

  return {
    directory,
    dataPath: path.join(directory, `${baseName}.bin`),
    metaPath: path.join(directory, `${baseName}.json`),
  };
}

function getCoverCachePaths(cacheKey) {
  const baseName = getAudioCacheBaseName(cacheKey);
  const directory = getCoverCacheDirectory();

  return {
    directory,
    dataPath: path.join(directory, `${baseName}.bin`),
    metaPath: path.join(directory, `${baseName}.json`),
  };
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  refreshTrayMenu();
}

function isMainWindowVisible() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.hide();
  refreshTrayMenu();
  return true;
}

function toggleMainWindowVisibility() {
  if (isMainWindowVisible()) {
    return hideMainWindow();
  }

  focusMainWindow();
  return true;
}

function isMinimizeToTrayEnabled() {
  return readStoredBoolean(MINIMIZE_TO_TRAY_SETTING_KEY, false);
}

function setMainWindowSkipTaskbarEnabled(enabled) {
  mainWindowSkipTaskbarEnabled = Boolean(enabled);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSkipTaskbar(mainWindowSkipTaskbarEnabled);
  }
  refreshTrayMenu();
  return mainWindowSkipTaskbarEnabled;
}

function persistMainWindowSkipTaskbarEnabled(enabled) {
  store.set(HIDE_TASKBAR_ICON_SETTING_KEY, Boolean(enabled));
  return setMainWindowSkipTaskbarEnabled(enabled);
}

function applyRemoteControlAlwaysOnTop(win) {
  if (!win || win.isDestroyed()) {
    return false;
  }

  win.setAlwaysOnTop(remoteControlAlwaysOnTop, 'screen-saver');
  if (remoteControlAlwaysOnTop && typeof win.moveTop === 'function') {
    win.moveTop();
  }
  return remoteControlAlwaysOnTop;
}

function applyRemoteControlSkipTaskbar(win) {
  if (!win || win.isDestroyed()) {
    return false;
  }

  win.setSkipTaskbar(remoteControlSkipTaskbarEnabled);
  return remoteControlSkipTaskbarEnabled;
}

function applyMainWindowAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.setAlwaysOnTop(mainWindowAlwaysOnTop, 'screen-saver');
  // Electron's setAlwaysOnTop poisons this window's later simple-full-screen presentation
  // (measured on-device: content presented 33pt below the window top, empty menu-bar strip
  // above the wallpaper — sticky for the life of the window). Mark it so the mac wallpaper
  // entry rebuilds the window instead of sinking a poisoned one.
  mainWindow.__macAlwaysOnTopElectronTouched = true;
  if (mainWindowAlwaysOnTop && typeof mainWindow.moveTop === 'function') {
    mainWindow.moveTop();
  }
  return mainWindowAlwaysOnTop;
}

function setMainWindowAlwaysOnTop(enabled) {
  // Always-on-top would fight the wallpaper's desktop-layer z-order, so wallpaper mode refuses it.
  if (Boolean(enabled) && isWallpaperModeEnabled()) {
    return mainWindowAlwaysOnTop;
  }

  mainWindowAlwaysOnTop = Boolean(enabled);
  store.set(MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY, mainWindowAlwaysOnTop);
  applyMainWindowAlwaysOnTop();
  patchRemoteControlSnapshot({
    mainWindowAlwaysOnTop,
  });
  refreshTrayMenu();
  return mainWindowAlwaysOnTop;
}

function isDesktopLyricModeActive() {
  return mainWindowClickThroughEnabled
    && mainWindowAlwaysOnTop
    && isTransparentPlayerBackgroundEnabled()
    && mainWindowSkipTaskbarEnabled;
}

async function setDesktopLyricMode(enabled) {
  const nextEnabled = Boolean(enabled);
  if (nextEnabled && isWallpaperModeEnabled()) {
    return false;
  }

  // The preset has no state of its own: it only applies one exact combination of independent
  // window switches. Drop click-through before a possible window rebuild, then reapply it last.
  setMainWindowClickThroughEnabled(false);
  setMainWindowAlwaysOnTop(nextEnabled);
  persistMainWindowSkipTaskbarEnabled(nextEnabled);
  if (isTransparentPlayerBackgroundEnabled() !== nextEnabled) {
    await setMainWindowTransparentModeFromRemote(nextEnabled);
  }
  if (nextEnabled) {
    setMainWindowClickThroughEnabled(true);
  }
  return nextEnabled;
}

async function resetMainWindowPresentation() {
  return setDesktopLyricMode(false);
}

async function enableDesktopLyricsLeavingWallpaperMode() {
  store.set(WALLPAPER_MODE_SETTING_KEY, false);
  refreshTrayMenu();

  if (process.platform === 'linux') {
    mainWindowAlwaysOnTop = true;
    mainWindowSkipTaskbarEnabled = true;
    store.set(MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY, true);
    store.set(HIDE_TASKBAR_ICON_SETTING_KEY, true);
    store.set(TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY, true);
    process.env.FOLIA_PENDING_DESKTOP_LYRIC = '1';
    scheduleWallpaperModeRelaunch(false);
    return;
  }

  wallpaperModeRelaunchGeneration += 1;
  const generation = wallpaperModeRelaunchGeneration;
  if (wallpaperModeRelaunchTimer) {
    clearTimeout(wallpaperModeRelaunchTimer);
    wallpaperModeRelaunchTimer = null;
  }
  await relaunchForWallpaperModeChange(false, generation);
  await setDesktopLyricMode(true);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!appTray) {
    return;
  }

  const locale = getMainLocale();
  const hasMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
  const remoteOpen = Boolean(remoteControlWindow && !remoteControlWindow.isDestroyed());
  const wallpaperOn = isWallpaperModeEnabled();
  // Reset only has something to undo while the window sits in a non-default presentation.
  const canResetPresentation = hasMainWindow && (
    mainWindowClickThroughEnabled
    || mainWindowAlwaysOnTop
    || isTransparentPlayerBackgroundEnabled()
    || mainWindowSkipTaskbarEnabled
  );
  // One flat level, grouped by separators: window presence, whole-window modes, the individual
  // switches those modes are made of, then reset and quit. No submenu: every switch is one click
  // away, and a mode and its parts stay visible together so the checkboxes explain each other.
  const menu = Menu.buildFromTemplate([
    {
      label: isMainWindowVisible() ? locale.trayHideWindow : locale.trayShowWindow,
      enabled: hasMainWindow,
      click: () => {
        toggleMainWindowVisibility();
      },
    },
    {
      label: locale.trayOpenRemote,
      type: 'checkbox',
      checked: remoteOpen,
      click: () => {
        // Both createRemoteControlWindow and the window's 'closed' handler refresh the tray.
        if (remoteControlWindow && !remoteControlWindow.isDestroyed()) {
          remoteControlWindow.close();
        } else {
          createRemoteControlWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: locale.trayDesktopLyricMode,
      type: 'checkbox',
      checked: isDesktopLyricModeActive(),
      enabled: hasMainWindow,
      click: () => {
        const nextEnabled = !isDesktopLyricModeActive();
        if (nextEnabled && isWallpaperModeEnabled()) {
          void enableDesktopLyricsLeavingWallpaperMode();
          return;
        }
        void setDesktopLyricMode(nextEnabled).then(() => {
          refreshTrayMenu();
        });
      },
    },
    ...(isWallpaperModeSupportedPlatform() ? [{
      label: locale.trayToggleWallpaperMode,
      type: 'checkbox',
      checked: isWallpaperModeEnabled(),
      click: () => {
        const nextEnabled = !isWallpaperModeEnabled();
        // NOTE: no Electron window calls here. Calling setAlwaysOnTop/setIgnoreMouseEvents
        // on the window right before the entry poisons the upcoming simple-full-screen
        // presentation (measured on-device: the content is presented 33pt low, leaving an
        // empty menu-bar strip above the wallpaper). The wallpaper entry asserts click-
        // through and the always-on-top state itself (state-only flip + level sink).
        store.set(WALLPAPER_MODE_SETTING_KEY, nextEnabled);
        refreshTrayMenu();
        scheduleWallpaperModeRelaunch(nextEnabled);
      },
    }] : []),
    { type: 'separator' },
    {
      label: locale.trayTransparentBackground,
      type: 'checkbox',
      checked: isTransparentPlayerBackgroundEnabled(),
      enabled: hasMainWindow && !(process.platform === 'win32'
        && isWindowsWallpaperMode()
        && !isWindowsWallpaperTransparentSupported()),
      click: () => {
        void setMainWindowTransparentModeFromRemote(!isTransparentPlayerBackgroundEnabled()).then(() => {
          refreshTrayMenu();
        });
      },
    },
    {
      label: locale.trayToggleClickThrough,
      type: 'checkbox',
      checked: mainWindowClickThroughEnabled,
      enabled: hasMainWindow && !wallpaperOn,
      click: () => {
        setMainWindowClickThroughEnabled(!mainWindowClickThroughEnabled);
      },
    },
    {
      label: locale.trayAlwaysOnTop,
      type: 'checkbox',
      checked: mainWindowAlwaysOnTop,
      enabled: hasMainWindow && !wallpaperOn,
      click: () => {
        setMainWindowAlwaysOnTop(!mainWindowAlwaysOnTop);
      },
    },
    {
      label: locale.trayHideTaskbar,
      type: 'checkbox',
      checked: mainWindowSkipTaskbarEnabled,
      enabled: hasMainWindow && !wallpaperOn,
      click: () => {
        persistMainWindowSkipTaskbarEnabled(!mainWindowSkipTaskbarEnabled);
      },
    },
    { type: 'separator' },
    {
      label: locale.trayResetWindow,
      enabled: canResetPresentation,
      click: () => {
        void resetMainWindowPresentation().then(() => {
          refreshTrayMenu();
        });
      },
    },
    { type: 'separator' },
    {
      label: locale.trayQuit,
      click: () => {
        app.quit();
      },
    },
  ]);

  appTray.setContextMenu(menu);
  appTray.setToolTip('Folia');
}

function ensureTray() {
  if (appTray) {
    refreshTrayMenu();
    return appTray;
  }

  try {
    appTray = new Tray(createTrayIconImage());
  } catch (error) {
    console.error('[Electron] Failed to create tray icon', error);
    return null;
  }

  appTray.on('click', () => {
    if (!isMainWindowVisible()) {
      focusMainWindow();
    }
  });
  refreshTrayMenu();
  return appTray;
}

// Retries the single-instance lock for a short window during a relaunch race
// (FOLIA_RELAUNCH=1): the old instance has just called app.exit() and is about to
// release the lock, so a fresh process may need a few attempts before it wins it.
function acquireSingleInstanceLock() {
  if (app.requestSingleInstanceLock()) {
    return true;
  }
  if (process.env.FOLIA_RELAUNCH !== '1') {
    return false; // ordinary second launch: behave as before (focus existing instance and quit)
  }
  const deadline = Date.now() + 10_000;
  return new Promise((resolve) => {
    const attempt = () => {
      if (app.requestSingleInstanceLock()) {
        return resolve(true);
      }
      if (Date.now() >= deadline) {
        return resolve(false);
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

async function ensureSystemProxySession() {
  const ses = session.defaultSession;
  await ses.setProxy({ mode: 'system' });
  await ses.forceReloadProxyConfig();
  await ses.closeAllConnections();
  return ses;
}

function isFileSystemPermission(permission) {
  return permission === 'fileSystem' || permission === 'filesystem';
}

function isFontAccessPermission(permission) {
  return permission === 'local-fonts';
}

function isClipboardWritePermission(permission) {
  return permission === 'clipboard-sanitized-write';
}

function isSpeakerSelectionPermission(permission) {
  return permission === 'speaker-selection';
}

function isAudioMediaPermission(permission, details) {
  if (permission !== 'media') {
    return false;
  }

  const mediaType = details?.mediaType;
  return mediaType === 'audio' || mediaType === 'unknown' || typeof mediaType === 'undefined';
}

function isAllowedMainWindowPermission(permission, details) {
  return (
    isFileSystemPermission(permission) ||
    isFontAccessPermission(permission) ||
    isClipboardWritePermission(permission) ||
    isSpeakerSelectionPermission(permission) ||
    isAudioMediaPermission(permission, details) ||
    permission === 'unknown'
  );
}

function isTrustedMainWindowContents(webContents) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    webContents &&
    webContents.id === mainWindow.webContents.id
  );
}

function isTrustedRemoteControlContents(webContents) {
  return Boolean(
    remoteControlWindow &&
    !remoteControlWindow.isDestroyed() &&
    webContents &&
    webContents.id === remoteControlWindow.webContents.id
  );
}

function getMainWindowUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return '';
  }

  return mainWindow.webContents.getURL() || '';
}

function normalizeOrigin(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function isTrustedMainWindowRequest(webContents, requestingOrigin, details) {
  if (isTrustedMainWindowContents(webContents)) {
    return true;
  }

  const mainWindowUrl = getMainWindowUrl();
  const mainWindowOrigin = normalizeOrigin(mainWindowUrl);
  const requestOrigin = normalizeOrigin(requestingOrigin);
  const requestUrlOrigin = normalizeOrigin(details?.requestingUrl);

  if (!mainWindowOrigin) {
    return false;
  }

  return requestOrigin === mainWindowOrigin || requestUrlOrigin === mainWindowOrigin;
}

function setupFileSystemAccessPermissionHandlers() {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const trustedMainWindow = isTrustedMainWindowRequest(webContents, requestingOrigin, details);
    const allowedPermission = isAllowedMainWindowPermission(permission, details);

    if (!trustedMainWindow || !allowedPermission) {
      return false;
    }

    return true;
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trustedMainWindow = isTrustedMainWindowRequest(webContents, details?.requestingUrl, details);
    const allowedPermission = isAllowedMainWindowPermission(permission, details);

    if (!trustedMainWindow || !allowedPermission) {
      return callback(false);
    }

    callback(true);
  });
}

function setupCorsBypassHandlers() {
  const ses = session.defaultSession;

  const getKugouMediaRequestInfo = details => {
    const parsedUrl = new URL(details.url);
    const isMediaRequest = details.resourceType === 'media' || parsedUrl.hostname.startsWith('fs.');
    return isMediaRequest ? {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      resourceType: details.resourceType,
    } : null;
  };
  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    const originUrl = details.url;

    let isTargetDomain = false;
    try {
      const parsedUrl = new URL(originUrl);
      const hostname = parsedUrl.hostname;
      isTargetDomain =
        hostname === 'qq.com' ||
        hostname.endsWith('.qq.com') ||
        hostname === 'y.gtimg.cn' ||
        hostname === 'kugou.com' ||
        hostname.endsWith('.kugou.com') ||
        hostname === 'amll-ttml-db.stevexmh.net';
    } catch (error) {
      isTargetDomain = false;
    }

    if (isTargetDomain) {
      removeCorsResponseHeaders(responseHeaders);
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Headers'] = ['*'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS, PUT, DELETE'];
    }

    callback({ cancel: false, responseHeaders });
  });

  ses.webRequest.onErrorOccurred({ urls: ['*://*.kugou.com/*'] }, details => {
    const requestInfo = getKugouMediaRequestInfo(details);
    if (!requestInfo) return;
    if (requestInfo.resourceType === 'media' && details.error === 'net::ERR_FAILED') return;
    console.warn('[KuGouMedia] request:error', {
      ...requestInfo,
      error: details.error,
    });
  });
}

function removeCorsResponseHeaders(responseHeaders) {
  for (const headerName of Object.keys(responseHeaders)) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (
      normalizedHeaderName === 'access-control-allow-origin' ||
      normalizedHeaderName === 'access-control-allow-headers' ||
      normalizedHeaderName === 'access-control-allow-methods'
    ) {
      delete responseHeaders[headerName];
    }
  }
}

function isAllowedLyricProxyHost(hostname) {
  return (
    hostname === 'qq.com' ||
    hostname.endsWith('.qq.com') ||
    hostname === 'y.gtimg.cn' ||
    hostname === 'kugou.com' ||
    hostname.endsWith('.kugou.com') ||
    hostname === 'kgimg.com' ||
    hostname.endsWith('.kgimg.com') ||
    hostname === 'amll-ttml-db.stevexmh.net'
  );
}

function isAmllDbHost(hostname) {
  return hostname === 'amll-ttml-db.stevexmh.net';
}

async function proxyLyricRequest(targetUrlStr, init = {}) {
  const targetUrl = new URL(targetUrlStr);
  const hostname = targetUrl.hostname;
  const isAmllDbRequest = isAmllDbHost(hostname);

  if (!isAllowedLyricProxyHost(hostname)) {
    throw new Error(`Forbidden lyric proxy host: ${hostname}`);
  }

  if (isAmllDbRequest) {
    console.log(`[AMLL Proxy] ${typeof init?.method === 'string' ? init.method : 'GET'} ${targetUrl.toString()}`);
  }

  const headers = new Headers(init?.headers || {});
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('origin');
  headers.delete('referer');

  const response = await fetch(targetUrl.toString(), {
    method: typeof init?.method === 'string' ? init.method : 'GET',
    headers,
    body: init?.body,
  });

  if (isAmllDbRequest) {
    console.log(`[AMLL Proxy] Response ${response.status} ${targetUrl.toString()}`);
  }

  if (isAmllDbRequest && response.status === 404) {
    console.log(`[AMLL Proxy] Convert 404 -> 204 ${targetUrl.toString()}`);
    return {
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: {},
      bodyText: '',
    };
  }

  const normalizedHeaders = {};
  for (const [key, value] of response.headers.entries()) {
    normalizedHeaders[key] = value;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: normalizedHeaders,
    bodyText: await response.text(),
  };
}

function normalizeDebugSelector(selector) {
  if (typeof selector !== 'string') {
    return '';
  }

  return selector.trim().slice(0, 512);
}

async function withMainWindowDebugger(task) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available.');
  }

  const { debugger: webDebugger } = mainWindow.webContents;
  const attachedHere = !webDebugger.isAttached();

  if (attachedHere) {
    webDebugger.attach('1.3');
  }

  try {
    await webDebugger.sendCommand('DOM.enable');
    await webDebugger.sendCommand('CSS.enable');
    return await task(webDebugger);
  } finally {
    if (attachedHere && webDebugger.isAttached()) {
      webDebugger.detach();
    }
  }
}

async function getRenderedFontReport(selector) {
  const normalizedSelector = normalizeDebugSelector(selector);

  if (!normalizedSelector) {
    throw new Error('A non-empty CSS selector is required.');
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available.');
  }

  const elementSummary = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const element = document.querySelector(${JSON.stringify(normalizedSelector)});
      if (!element) {
        return null;
      }

      const style = window.getComputedStyle(element);
      return {
        selector: ${JSON.stringify(normalizedSelector)},
        tagName: element.tagName,
        className: element.className || '',
        textSample: (element.textContent || '').trim().slice(0, 160),
        declaredFontFamily: style.fontFamily,
        declaredFontSize: style.fontSize,
        declaredFontWeight: style.fontWeight,
      };
    })()
  `, true);

  if (!elementSummary) {
    throw new Error(`No element matched selector: ${normalizedSelector}`);
  }

  const platformFonts = await withMainWindowDebugger(async (webDebugger) => {
    const { root } = await webDebugger.sendCommand('DOM.getDocument', { depth: -1 });
    const { nodeId } = await webDebugger.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: normalizedSelector,
    });

    if (!nodeId) {
      throw new Error(`No element matched selector: ${normalizedSelector}`);
    }

    const result = await webDebugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
    return Array.isArray(result.fonts) ? result.fonts : [];
  });

  return {
    ...elementSummary,
    platformFonts,
  };
}

async function fetchWithOptionalSystemProxy(url, options, useSystemProxy) {
  if (!useSystemProxy) {
    return fetch(url, options);
  }

  const ses = await ensureSystemProxySession();
  const proxy = await ses.resolveProxy(typeof url === 'string' ? url : url.url);
  console.log('[AI Proxy] resolved proxy for request:', proxy);
  return ses.fetch(url, options);
}

function getUpdateCheckEnabled() {
  const configured = store.get(ENABLE_UPDATE_CHECK_SETTING_KEY);
  return configured === undefined ? true : Boolean(configured);
}

function getAutoUpdateEnabled() {
  return Boolean(store.get(ENABLE_AUTO_UPDATE_SETTING_KEY));
}

function normalizeVersion(value) {
  return typeof value === 'string' ? value.trim().replace(/^v/i, '') : '';
}

function getPackagedReleaseChannel() {
  try {
    const packageJsonPath = path.join(app.getAppPath(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.foliaReleaseChannel;
  } catch {
    return null;
  }
}

function getCurrentReleaseChannel() {
  return resolveReleaseChannel(
    app.getVersion(),
    store.get(UPDATE_CHANNEL_SETTING_KEY) || getPackagedReleaseChannel(),
  );
}

function normalizeUpdateChannelSelection(value) {
  const channel = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return channel === 'realeco' || channel === 'limo' || channel === 'cielo' ? channel : null;
}

function getUpdateCheckSupportReason() {
  return getCurrentReleaseChannel().updateEnabled ? null : 'channel';
}

function isUpdateCheckSupported() {
  return getUpdateCheckSupportReason() === null;
}

function isDevUpdatePreviewEnabled() {
  return process.env.ELECTRON_DEV === 'true' && process.env.FOLIA_DEV_UPDATE_PREVIEW === 'true';
}

// Builds a believable next patch version so the preview stays aligned with package metadata.
function getDevUpdatePreviewVersion() {
  const currentVersion = normalizeVersion(app.getVersion());
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(currentVersion);

  if (!match) {
    return '999.0.0';
  }

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function isAutoUpdaterSupported() {
  return (
    process.platform === 'win32' &&
    isUpdateCheckSupported() &&
    app.isPackaged &&
    process.env.ELECTRON_DEV !== 'true' &&
    process.env.NODE_ENV !== 'development'
  );
}

function getAutoUpdateSupportReason() {
  if (!getCurrentReleaseChannel().updateEnabled) {
    return 'channel';
  }
  return process.platform === 'win32' ? null : 'system';
}

function isPackagedUpdateRuntime() {
  return app.isPackaged && process.env.ELECTRON_DEV !== 'true' && process.env.NODE_ENV !== 'development';
}

const updateState = {
  status: 'idle',
  currentVersion: normalizeVersion(app.getVersion()),
  availableVersion: null,
  updateUrl: FOLIA_RELEASES_URL,
  error: null,
  lastCheckedAt: null,
  downloadProgress: null,
};

function getUpdateStatus() {
  const availableVersion = updateState.availableVersion;
  const isDevPreview = isDevUpdatePreviewEnabled();

  return {
    ...updateState,
    supported: isDevPreview || isAutoUpdaterSupported(),
    updateCheckSupported: isDevPreview || isUpdateCheckSupported(),
    updateCheckSupportReason: isDevPreview ? null : getUpdateCheckSupportReason(),
    platform: process.platform,
    updateCheckEnabled: getUpdateCheckEnabled(),
    autoUpdateEnabled: getAutoUpdateEnabled(),
    autoUpdateSupported: isDevPreview || isAutoUpdaterSupported(),
    autoUpdateSupportReason: isDevPreview ? null : getAutoUpdateSupportReason(),
    lastSeenVersion: store.get(LAST_SEEN_UPDATE_VERSION_SETTING_KEY) || null,
    updateSeen: Boolean(
      availableVersion &&
      store.get(LAST_SEEN_UPDATE_VERSION_SETTING_KEY) === availableVersion
    ),
  };
}

function publishUpdateStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('update-status-changed', getUpdateStatus());
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  publishUpdateStatus();
}

// Load electron-updater lazily so updater failures don't block the main window.
function ensureAutoUpdater() {
  if (autoUpdater !== null) {
    return autoUpdater;
  }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    console.error('[Updater] Failed to load electron-updater', error);
    autoUpdater = false;
  }

  return autoUpdater || null;
}

function setupAutoUpdater() {
  const updater = ensureAutoUpdater();
  if (!updater) {
    setUpdateState({
      status: isAutoUpdaterSupported() ? 'error' : 'idle',
      error: isAutoUpdaterSupported() ? 'Failed to initialize auto updater.' : null,
      downloadProgress: null,
    });
    return;
  }

  updater.autoDownload = false;
  if (getCurrentReleaseChannel().updateEnabled) {
    configureAutoUpdaterChannel(updater);
  }
  updater.autoInstallOnAppQuit = false;

  updater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', error: null, downloadProgress: null });
  });

  updater.on('update-available', (info) => {
    const version = normalizeVersion(info?.version);
    setUpdateState({
      status: 'available',
      availableVersion: version || null,
      updateUrl: getReleaseUrl(getCurrentReleaseChannel().id, version, FOLIA_RELEASES_URL),
      error: null,
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });
  });

  updater.on('update-not-available', () => {
    setUpdateState({
      status: 'latest',
      availableVersion: null,
      updateUrl: FOLIA_RELEASES_URL,
      error: null,
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });
  });

  updater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      error: null,
      downloadProgress: {
        percent: typeof progress.percent === 'number' ? progress.percent : 0,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  updater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      availableVersion: normalizeVersion(info?.version) || updateState.availableVersion,
      error: null,
      downloadProgress: null,
    });
  });

  updater.on('error', (error) => {
    setUpdateState({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      downloadProgress: null,
    });
  });
}

function configureAutoUpdaterChannel(updater) {
  const releaseChannel = getCurrentReleaseChannel();
  updater.channel = releaseChannel.updaterChannel;
  updater.allowPrerelease = releaseChannel.allowPrerelease;

  const providerConfig = getUpdateProviderConfig(releaseChannel, FOLIA_GITHUB_REPOSITORY);
  if (providerConfig) {
    updater.setFeedURL(providerConfig);
  }
}

async function downloadAvailableUpdate() {
  if (isDevUpdatePreviewEnabled()) {
    setUpdateState({ status: 'downloaded', error: null, downloadProgress: null });
    return getUpdateStatus();
  }

  if (!isAutoUpdaterSupported()) {
    setUpdateState({ status: 'unsupported', error: null });
    return getUpdateStatus();
  }

  const updater = ensureAutoUpdater();
  if (!updater) {
    setUpdateState({
      status: 'error',
      error: 'Failed to initialize auto updater.',
      downloadProgress: null,
    });
    return getUpdateStatus();
  }

  if (!updateState.availableVersion) {
    await checkForUpdates({ manual: true });
  }

  if (!updateState.availableVersion) {
    return getUpdateStatus();
  }

  try {
    setUpdateState({ status: 'downloading', error: null, downloadProgress: null });
    await updater.downloadUpdate();
  } catch (error) {
    setUpdateState({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      downloadProgress: null,
    });
  }

  return getUpdateStatus();
}

async function checkForUpdates({ manual = false } = {}) {
  if (isDevUpdatePreviewEnabled()) {
    const availableVersion = getDevUpdatePreviewVersion();
    setUpdateState({
      status: 'available',
      availableVersion,
      updateUrl: getReleaseUrl(getCurrentReleaseChannel().id, availableVersion, FOLIA_RELEASES_URL),
      error: null,
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });
    return getUpdateStatus();
  }

  if (!getUpdateCheckEnabled() && !manual) {
    setUpdateState({ status: 'disabled', error: null, downloadProgress: null });
    return getUpdateStatus();
  }

  if (!isUpdateCheckSupported()) {
    setUpdateState({ status: 'unsupported', error: null, downloadProgress: null });
    return getUpdateStatus();
  }

  if (!isPackagedUpdateRuntime()) {
    setUpdateState({ status: 'idle', error: null, downloadProgress: null });
    return getUpdateStatus();
  }

  if (!isAutoUpdaterSupported()) {
    return checkForManualUpdateAvailability();
  }

  try {
    const updater = ensureAutoUpdater();
    if (!updater) {
      throw new Error('Failed to initialize auto updater.');
    }

    updater.autoDownload = getAutoUpdateEnabled();
    await updater.checkForUpdates();
  } catch (error) {
    setUpdateState({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });
  }

  return getUpdateStatus();
}

async function checkForManualUpdateAvailability() {
  const releaseChannel = getCurrentReleaseChannel();
  const discovery = getUpdateDiscoveryConfig(releaseChannel, FOLIA_GITHUB_REPOSITORY);
  if (!discovery) {
    setUpdateState({ status: 'unsupported', error: null, availableVersion: null, downloadProgress: null });
    return getUpdateStatus();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  setUpdateState({ status: 'checking', error: null, downloadProgress: null });

  try {
    // Keep the startup check off the app's default session so refreshing proxy state cannot
    // interrupt playback, provider requests, or other live connections.
    const ses = session.fromPartition('folia-update-check');
    await ses.setProxy({ mode: 'system' });
    await ses.forceReloadProxyConfig();
    const response = await ses.fetch(discovery.url, {
      headers: {
        Accept: 'text/yaml, text/plain',
        'User-Agent': `Folia/${app.getVersion()}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Update metadata request failed: ${response.status} ${response.statusText}`);
    }

    const metadata = await response.text();
    const latestVersion = parseUpdateMetadataVersion(metadata);
    if (!latestVersion) {
      throw new Error('Update metadata did not include a version.');
    }

    const hasUpdate = compareVersions(latestVersion, app.getVersion()) > 0;
    setUpdateState({
      status: hasUpdate ? 'available' : 'latest',
      availableVersion: hasUpdate ? latestVersion : null,
      updateUrl: hasUpdate
        ? getReleaseUrl(releaseChannel.id, latestVersion, FOLIA_RELEASES_URL)
        : FOLIA_RELEASES_URL,
      error: null,
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });
  } catch (error) {
    setUpdateState({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });
  } finally {
    clearTimeout(timeout);
  }

  return getUpdateStatus();
}

function markUpdateSeen(version) {
  const normalizedVersion = normalizeVersion(version || updateState.availableVersion);

  if (normalizedVersion) {
    store.set(LAST_SEEN_UPDATE_VERSION_SETTING_KEY, normalizedVersion);
  }

  publishUpdateStatus();
  return getUpdateStatus();
}

async function openUpdateReleasePage(version) {
  const normalizedVersion = normalizeVersion(version || updateState.availableVersion);
  const url = normalizedVersion
    ? getReleaseUrl(getCurrentReleaseChannel().id, normalizedVersion, FOLIA_RELEASES_URL)
    : updateState.updateUrl || FOLIA_RELEASES_URL;

  await shell.openExternal(url);
  return true;
}

async function openExternalUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return false;
  }

  await shell.openExternal(url.trim());
  return true;
}

function scheduleStartupUpdateCheck() {
  if (isDevUpdatePreviewEnabled()) {
    void checkForUpdates({ manual: true });
    return;
  }

  if (!getUpdateCheckEnabled()) {
    setUpdateState({ status: 'disabled', error: null });
    return;
  }

  if (!isUpdateCheckSupported()) {
    setUpdateState({ status: 'unsupported', error: null });
    return;
  }

  if (!isPackagedUpdateRuntime()) {
    setUpdateState({ status: 'idle', error: null });
    return;
  }

  setTimeout(() => {
    checkForUpdates().catch((error) => {
      setUpdateState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 4500);
}

function getGeminiResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      light: {
        type: 'OBJECT',
        description: 'Theme optimized for light/daylight mode',
        properties: {
          name: { type: 'STRING', description: 'A creative name for this light theme in Chinese, strictly limited to 10 characters or less' },
          description: { type: 'STRING', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
          backgroundColor: { type: 'STRING', description: 'Hex code for light background (whites, creams, pastels)' },
          primaryColor: { type: 'STRING', description: 'Hex code for main text (dark color for contrast)' },
          accentColor: { type: 'STRING', description: 'Hex code for highlighted text/effects' },
          secondaryColor: { type: 'STRING', description: 'Hex code for secondary elements (must contrast with light bg)' },
          wordColors: {
            type: 'ARRAY',
            description: 'List of exact emotional standalone words from the source text and their specific colors; Latin-script words must not contain punctuation or spaces',
            items: {
              type: 'OBJECT',
              properties: {
                word: { type: 'STRING' },
                color: { type: 'STRING' },
              },
              required: ['word', 'color'],
            },
          },
          lyricsIcons: {
            type: 'ARRAY',
            description: 'List of Lucide icon names related to the source text',
            items: { type: 'STRING' }
          },
        },
        required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'],
      },
      dark: {
        type: 'OBJECT',
        description: 'Theme optimized for dark/midnight mode',
        properties: {
          name: { type: 'STRING', description: 'A creative name for this dark theme in Chinese, strictly limited to 10 characters or less' },
          description: { type: 'STRING', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
          backgroundColor: { type: 'STRING', description: 'Hex code for dark background (deep colors)' },
          primaryColor: { type: 'STRING', description: 'Hex code for main text (light color for contrast)' },
          accentColor: { type: 'STRING', description: 'Hex code for highlighted text/effects' },
          secondaryColor: { type: 'STRING', description: 'Hex code for secondary elements (must contrast with dark bg)' },
          wordColors: {
            type: 'ARRAY',
            description: 'List of exact emotional standalone words from the source text and their specific colors; Latin-script words must not contain punctuation or spaces',
            items: {
              type: 'OBJECT',
              properties: {
                word: { type: 'STRING' },
                color: { type: 'STRING' },
              },
              required: ['word', 'color'],
            },
          },
          lyricsIcons: {
            type: 'ARRAY',
            description: 'List of Lucide icon names related to the source text',
            items: { type: 'STRING' }
          },
        },
        required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'],
      },
    },
    required: ['light', 'dark'],
  };
}

async function generateGeminiTheme({ apiKey, systemPrompt, sourcePrompt, customFetch }) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
  const response = await customFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          { text: systemPrompt }
        ]
      },
      contents: [
        {
          parts: [
            { text: sourcePrompt }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: getGeminiResponseSchema(),
      }
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}${errText ? ` - ${errText}` : ''}`);
  }

  const data = await response.json();
  const jsonText = data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === 'string')?.text;
  if (!jsonText) {
    throw new Error('Failed to generate theme JSON');
  }

  return JSON.parse(jsonText);
}

const THEME_JSON_SCHEMA_NAME = 'dual_theme';
const THEME_MAX_OUTPUT_TOKENS = 4096;
const THEME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    light: {
      type: 'object',
      additionalProperties: false,
      description: 'Theme optimized for light/daylight mode',
      properties: {
        name: { type: 'string', description: 'A creative name for this light theme in Chinese, strictly limited to 10 characters or less' },
        description: { type: 'string', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
        backgroundColor: { type: 'string', description: 'Hex code for light background' },
        primaryColor: { type: 'string', description: 'Hex code for main text (dark)' },
        accentColor: { type: 'string', description: 'Hex code for highlighted text/effects' },
        secondaryColor: { type: 'string', description: 'Hex code for secondary elements' },
        wordColors: {
          type: 'array',
          description: 'List of exact emotional standalone words from the source text and their specific colors; Latin-script words must not contain punctuation or spaces',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              word: { type: 'string' },
              color: { type: 'string' },
            },
            required: ['word', 'color'],
          },
        },
        lyricsIcons: {
          type: 'array',
          description: 'List of Lucide icon names related to the source text',
          items: { type: 'string' }
        },
      },
      required: ['name', 'description', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons'],
    },
    dark: {
      type: 'object',
      additionalProperties: false,
      description: 'Theme optimized for dark/midnight mode',
      properties: {
        name: { type: 'string', description: 'A creative name for this dark theme in Chinese, strictly limited to 10 characters or less' },
        description: { type: 'string', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
        backgroundColor: { type: 'string', description: 'Hex code for dark background' },
        primaryColor: { type: 'string', description: 'Hex code for main text (light)' },
        accentColor: { type: 'string', description: 'Hex code for highlighted text/effects' },
        secondaryColor: { type: 'string', description: 'Hex code for secondary elements' },
        wordColors: {
          type: 'array',
          description: 'List of exact emotional standalone words from the source text and their specific colors; Latin-script words must not contain punctuation or spaces',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              word: { type: 'string' },
              color: { type: 'string' },
            },
            required: ['word', 'color'],
          },
        },
        lyricsIcons: {
          type: 'array',
          description: 'List of Lucide icon names related to the source text',
          items: { type: 'string' }
        },
      },
      required: ['name', 'description', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons'],
    },
  },
  required: ['light', 'dark'],
};

function buildThemeSystemPrompt(includeSchemaText = false) {
  const instructionPrompt = `Analyze the mood of the provided song source text and generate TWO visual theme configurations for a music player - one for LIGHT mode and one for DARK mode.

DUAL THEME REQUIREMENTS:
1. Generate TWO complete themes: one optimized for LIGHT/DAYLIGHT mode, one for DARK/MIDNIGHT mode.
2. Both themes should capture the SAME emotional essence of the source text, but with appropriate color palettes for their respective modes.
3. The theme names must be in Chinese and strictly limited to 10 characters or less. They should reflect both the mood AND the mode (e.g., "忧郁破晓" for light, "忧郁子夜" for dark).
4. The theme description must be a brief, emotional sentence in Chinese (strictly limited to 15 to 30 Chinese characters) reflecting a stream-of-consciousness style with youth and literary characteristics, capturing a listener's immediate emotional reaction to this song. Do not write formal analytical text. Must be written from a first-person listener perspective.
   GUIDELINES FOR THE EXPRESSIVE STYLE:
   - Stream of Consciousness & Literary Vibe: Emphasize poetic, reflective, or introspective thoughts (e.g., emotional connection, existential thoughts, quiet solitude).
   - Youth & Nostalgia: Associate the mood with nostalgic memories of youth, dreams, seasons, or romantic longing.
   - Spatial & Situational Synesthesia: Translate the music's vibe into a vivid situation, atmosphere, weather, or imagery (e.g., summer breeze, starry sky, quiet room).
   Examples for reference: "戴上耳机的那一刻，喧嚣的世界瞬间消失了。", "然后，这份爱编织了太阳和所有星星", "你的世界，也包括我在内吗？", "微醺的夏夜吹拂过一阵海风。", "青春是一种眺望的姿态！", "仿佛回到了那个满是汽水味和单车后座的夏天。"。

SOURCE MODE:
1. If 'Pure instrumental' is yes, the source text below is the song title of a pure instrumental track, not lyrics.
2. If 'Pure instrumental' is no, the source text below is a lyrics snippet.
3. Base your mood inference only on the provided source text.

COLOR & THEME GENERATION WORKFLOW:
1. First, identify 10-20 key emotional standalone words from the source text that represent the core mood and atmosphere of the song.
2. Assign a specific, representative color to each of these key emotional standalone words under 'wordColors'.
3. Based on the emotional direction and colors of these identified words, construct the overall color palettes (backgroundColor, primaryColor, secondaryColor, accentColor) for the light and dark themes.
4. Coordinated Colors: The colors assigned in 'wordColors' must be designed in coordination and harmony with the overall color schemes of the themes.

LIGHT THEME RULES:
- Use LIGHT backgrounds. Avoid defaulting to pure white background for every light theme. Generate diverse and rich light-colored backgrounds (e.g., warm creams, soft pastel blues, pale sage greens, gentle peach, warm sands, pale lavenders) that directly match the song's mood.
- Ensure text/icons are dark enough for contrast, but avoid defaulting to pure black (#000000). Generate a very dark tone that coordinates with the background color's hue (e.g., deep navy, dark charcoal, dark plum).
- 'accentColor' must be visible against the light background.

DARK THEME RULES:
- Use DARK backgrounds. Avoid generic pure black backgrounds; use rich, diverse dark colors (e.g., deep midnight blue, dark forest green, charcoal gray, dark plum, deep chocolate, burgundy) matching the song's mood.
- Ensure text/icons are light enough for contrast, but avoid defaulting to pure white (#ffffff). Generate a very bright, soft tone that coordinates with the background color's hue (e.g., soft sky blue, pale mint green, light warm cream).
- 'accentColor' must contrast with the dark background and should be creatively derived from the song's specific mood (e.g., soft blues, mint greens, warm corals, lavender, pale gold) rather than defaulting to generic bright yellow.

SHARED RULES FOR BOTH THEMES:
1. 'secondaryColor': MUST have sufficient contrast against 'backgroundColor'.
2. 'wordColors' and 'lyricsIcons' should be the SAME for both themes (they represent the source text's meaning).

IMPORTANT for 'wordColors':
1. Extract 10-20 emotional standalone words. For Latin-script text, each 'word' MUST be one complete word only, not a phrase.
2. CRITICAL: Do NOT include punctuation, apostrophes, curly quotes, hyphens, or spaces in Latin-script 'word' values. Use clean whole words like "train", "gone", "hidden", "cities"; do NOT return "train’s gone", "well-hidden", "set me free", or "shun the light".
3. Avoid function words such as articles, prepositions, pronouns, particles, and auxiliaries (for example: the, a, an, to, me, and, of, in, on).
4. For CJK lyrics, short meaningful semantic terms may contain multiple CJK characters, but do not select single particles unless they are emotionally meaningful.
5. The 'word' field MUST match text from the source snippet after removing surrounding punctuation. If the pure-instrumental title is very short, using the exact full title as a phrase is allowed.

IMPORTANT for 'lyricsIcons':
1. Identify 3-5 visual concepts/objects mentioned in or strongly implied by the source text.
2. Return them as valid Lucide React icon names (PascalCase).`;

  const schemaPrompt = includeSchemaText ? `
Response MUST be a valid JSON object. Do not include markdown formatting like \`\`\`json. Just the raw JSON.

JSON Schema:
${JSON.stringify(THEME_JSON_SCHEMA, null, 2)}` : '';

  return `${instructionPrompt}${schemaPrompt}`;
}

function buildThemeSourcePrompt(snippet, isPureMusic, songTitle) {
  return `Pure instrumental: ${isPureMusic ? 'yes' : 'no'}
${isPureMusic && songTitle ? `Song title: ${songTitle}\n` : ''}Source snippet:
${snippet}`;
}

// Provide Netease API unblock parameter as requested
process.env.ENABLE_GENERAL_UNBLOCK = 'false';

// Issue: Netease API module reads 'anonymous_token' synchronously from tmp dir upon require.
// If not present, Electron crashes with ENOENT. Pre-create the file, then hydrate the
// package's runtime state in the order required by the current api-enhanced build.
const fsp = fs.promises;
const os = require('os');
const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
const xeapiPublicKeyPath = path.resolve(os.tmpdir(), 'xeapi_public_key');
if (!fs.existsSync(tokenPath)) {
  fs.writeFileSync(tokenPath, '', 'utf-8');
}

async function ensureAudioCacheDirectory() {
  await fsp.mkdir(getAudioCacheDirectory(), { recursive: true });
}

async function hasAudioCacheEntry(cacheKey) {
  const { dataPath } = getAudioCachePaths(cacheKey);

  try {
    await fsp.access(dataPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readAudioCacheEntry(cacheKey) {
  const { dataPath, metaPath } = getAudioCachePaths(cacheKey);

  try {
    const [dataBuffer, rawMeta] = await Promise.all([
      fsp.readFile(dataPath),
      fsp.readFile(metaPath, 'utf-8').catch(() => null),
    ]);

    // Mark it as recently used, so pruning evicts by last play rather than by first download.
    // Access time would say this without a write, but Windows ships with atime updates off, so
    // the only field that survives a round trip is the one we set ourselves.
    const now = new Date();
    fsp.utimes(dataPath, now, now).catch(() => {});

    let mimeType = 'audio/mpeg';
    if (rawMeta) {
      try {
        const parsedMeta = JSON.parse(rawMeta);
        if (typeof parsedMeta.mimeType === 'string' && parsedMeta.mimeType.trim()) {
          mimeType = parsedMeta.mimeType;
        }
      } catch {
        // Ignore malformed metadata and keep the default content type.
      }
    }

    return {
      found: true,
      data: dataBuffer,
      mimeType,
    };
  } catch {
    return {
      found: false,
      data: null,
      mimeType: null,
    };
  }
}

/**
 * Lists original cached files for shared pruning and storage statistics.
 */
async function listAudioCacheEntries() {
  const audioDirectory = getAudioCacheDirectory();
  try {
    const names = (await fsp.readdir(audioDirectory)).filter((name) => name.endsWith('.bin'));
    return Promise.all(names.map(async (name) => {
      const stat = await fsp.stat(path.join(audioDirectory, name));
      return { name, size: stat.size, usedAt: stat.mtimeMs };
    }));
  } catch {
    return [];
  }
}

async function removeAudioCacheEntry(name) {
  if (!/^[a-zA-Z0-9_-]+\.bin$/.test(String(name || ''))) return;
  const base = path.join(getAudioCacheDirectory(), name.replace(/\.bin$/, ''));
  await Promise.allSettled([
    fsp.rm(`${base}.bin`, { force: true }),
    fsp.rm(`${base}.json`, { force: true }),
  ]);
}

/** Prunes original and transcoded audio as one media-cache budget. */
async function pruneMediaCache(limitBytes, protectedTranscodeEntry = null) {
  const resolvedLimit = resolveCacheLimit(limitBytes);
  if (resolvedLimit === Infinity) return;

  try {
    const [audioEntries, transcodeEntries] = await Promise.all([
      listAudioCacheEntries(),
      transcodeService.listCacheEntries(),
    ]);
    let entries = [
      ...audioEntries.map(entry => ({ ...entry, name: `audio:${entry.name}` })),
      ...transcodeEntries.map(entry => ({ ...entry, name: `transcode:${entry.name}` })),
    ];
    // Entries the renderer is streaming are unevictable but still spend the budget: a fully
    // buffered media element stops touching its file, so LRU alone would drop it mid-playback.
    const protectedNames = new Set(transcodeService.getPinnedCacheKeys().map(key => `transcode:${key}`));
    if (protectedTranscodeEntry) protectedNames.add(`transcode:${protectedTranscodeEntry.cacheKey}`);
    const protectedEntries = entries.filter(entry => protectedNames.has(entry.name));
    let protectedBytes = protectedEntries.reduce((total, entry) => total + entry.size, 0);
    if (protectedTranscodeEntry && !protectedEntries.some(entry => entry.name === `transcode:${protectedTranscodeEntry.cacheKey}`)) {
      protectedBytes += protectedTranscodeEntry.size;
    }
    entries = entries.filter(entry => !protectedNames.has(entry.name));
    const effectiveLimit = protectedBytes > 0 ? Math.max(1, resolvedLimit - protectedBytes) : resolvedLimit;

    for (const name of selectEvictions(entries, effectiveLimit)) {
      if (name.startsWith('audio:')) await removeAudioCacheEntry(name.slice('audio:'.length));
      else if (name.startsWith('transcode:')) await transcodeService.removeCacheEntry(name.slice('transcode:'.length));
    }
  } catch (error) {
    console.warn('[AudioCache] Failed to prune media cache directories', error);
  }
}

async function writeAudioCacheEntry(cacheKey, data, mimeType, limitBytes) {
  const { dataPath, metaPath } = getAudioCachePaths(cacheKey);
  await ensureAudioCacheDirectory();

  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);

  await Promise.all([
    fsp.writeFile(dataPath, buffer),
    fsp.writeFile(metaPath, JSON.stringify({
      cacheKey,
      mimeType: mimeType || 'audio/mpeg',
      size: buffer.byteLength,
      updatedAt: Date.now(),
    }), 'utf-8'),
  ]);

  await pruneMediaCache(limitBytes);
}

async function getAudioCacheUsageBytes() {
  try {
    const [audioEntries, transcodeEntries] = await Promise.all([
      listAudioCacheEntries(),
      transcodeService.listCacheEntries(),
    ]);
    return [...audioEntries, ...transcodeEntries].reduce((total, entry) => total + entry.size, 0);
  } catch {
    return 0;
  }
}

async function getAudioCacheStats() {
  try {
    const [audioEntries, transcodeEntries] = await Promise.all([
      listAudioCacheEntries(),
      transcodeService.listCacheEntries(),
    ]);
    const entries = [...audioEntries, ...transcodeEntries];

    return {
      size: entries.reduce((total, entry) => total + entry.size, 0),
      count: entries.length,
    };
  } catch {
    return {
      size: 0,
      count: 0,
    };
  }
}

async function clearAudioCacheDirectory() {
  try {
    await Promise.all([
      fsp.rm(getAudioCacheDirectory(), { recursive: true, force: true }),
      transcodeService.clearCache(),
    ]);
  } catch (error) {
    console.warn('[AudioCache] Failed to clear cache directory', error);
  }
}

async function ensureCoverCacheDirectory() {
  await fsp.mkdir(getCoverCacheDirectory(), { recursive: true });
}

async function readCoverCacheEntry(cacheKey) {
  const { dataPath, metaPath } = getCoverCachePaths(cacheKey);
  try {
    const [dataBuffer, rawMeta] = await Promise.all([
      fsp.readFile(dataPath),
      fsp.readFile(metaPath, 'utf-8').catch(() => null),
    ]);
    if (dataBuffer.byteLength === 0) {
      await Promise.allSettled([fsp.rm(dataPath, { force: true }), fsp.rm(metaPath, { force: true })]);
      return { found: false, data: null, mimeType: null };
    }
    try {
      const parsedMeta = rawMeta ? JSON.parse(rawMeta) : null;
      const validMeta = parsedMeta
        && parsedMeta.cacheKey === cacheKey
        && typeof parsedMeta.mimeType === 'string'
        && parsedMeta.mimeType.startsWith('image/')
        && parsedMeta.size === dataBuffer.byteLength;
      if (!validMeta) throw new Error('Invalid cover cache metadata');
      return { found: true, data: dataBuffer, mimeType: parsedMeta.mimeType };
    } catch {
      await Promise.allSettled([fsp.rm(dataPath, { force: true }), fsp.rm(metaPath, { force: true })]);
      return { found: false, data: null, mimeType: null };
    }
  } catch {
    return { found: false, data: null, mimeType: null };
  }
}

async function writeCoverCacheEntry(cacheKey, data, mimeType) {
  const { dataPath, metaPath } = getCoverCachePaths(cacheKey);
  await ensureCoverCacheDirectory();
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  if (buffer.byteLength === 0) throw new Error('Cannot persist an empty cover payload');
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
    throw new Error('Cover cache only accepts image payloads');
  }
  await Promise.all([
    fsp.writeFile(dataPath, buffer),
    fsp.writeFile(metaPath, JSON.stringify({
      cacheKey,
      mimeType: mimeType || 'application/octet-stream',
      size: buffer.byteLength,
      updatedAt: Date.now(),
    }), 'utf-8'),
  ]);
}

async function removeCoverCacheEntry(cacheKey) {
  const { dataPath, metaPath } = getCoverCachePaths(cacheKey);
  await Promise.allSettled([fsp.rm(dataPath, { force: true }), fsp.rm(metaPath, { force: true })]);
}

async function getCoverCacheUsageBytes() {
  try {
    const entries = await fsp.readdir(getCoverCacheDirectory(), { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.bin')) continue;
      total += (await fsp.stat(path.join(getCoverCacheDirectory(), entry.name))).size;
    }
    return total;
  } catch {
    return 0;
  }
}

async function clearCoverCacheDirectory() {
  try {
    await fsp.rm(getCoverCacheDirectory(), { recursive: true, force: true });
  } catch (error) {
    console.warn('[CoverCache] Failed to clear cache directory', error);
  }
}

const { register_anonimous } = require('@neteasecloudmusicapienhanced/api/main');
const { getXeapiPublicKey } = require('@neteasecloudmusicapienhanced/api/util/xeapiKey');
const {
  cookieToJson,
  generateDeviceId,
  generateRandomChineseIP,
} = require('@neteasecloudmusicapienhanced/api/util/index');
const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api/server');
const {
  refreshAnonymousToken,
  resolveXeapiPublicKey,
} = require('./neteaseApiStartup.cjs');
const {
  isModuleNotFound: isQqApiModuleNotFound,
  startQqApi: startQqApiServer,
} = require('./qqApiStartup.cjs');

const net = require('net');
// null until serveNcmApi is actually listening. A numeric fallback used to be handed to the
// renderer on failure, which turned "backend never started" into an opaque fetch error.
let assignedPort = null;
const NETEASE_API_STATUS_CHANNEL = 'netease-api-status-changed';
let neteaseApiStatus = {
  status: 'starting',
  port: null,
  error: null,
  updatedAt: Date.now(),
};

function serializeError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Unknown error';
}

function updateNeteaseApiStatus(nextStatus) {
  neteaseApiStatus = {
    ...neteaseApiStatus,
    ...nextStatus,
    updatedAt: Date.now(),
  };

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(NETEASE_API_STATUS_CHANNEL, neteaseApiStatus);
    }
  });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

// Initializes the Netease API runtime files before the local server starts handling requests.
async function initializeNcmApiRuntime() {
  global.cnIp = generateRandomChineseIP();

  if (!global.deviceId) {
    global.deviceId = generateDeviceId();
  }

  let currentPublicKey = {};
  if (fs.existsSync(xeapiPublicKeyPath)) {
    try {
      currentPublicKey = JSON.parse(fs.readFileSync(xeapiPublicKeyPath, 'utf-8'));
    } catch (error) {
      console.warn('[Netease API] Failed to read cached xeapi public key, regenerating', error);
    }
  }

  const { publicKey: nextPublicKey, refreshed } = await resolveXeapiPublicKey({
    currentPublicKey,
    deviceId: global.deviceId,
    getXeapiPublicKey,
  });
  if (refreshed) {
    fs.writeFileSync(xeapiPublicKeyPath, JSON.stringify(nextPublicKey), 'utf-8');
  }
  console.log(
    `[Netease API] xeapi public key ready (source=${refreshed ? 'network' : 'cache'}, version=${nextPublicKey?.version ?? 'unknown'})`,
  );

  await refreshAnonymousToken({
    registerAnonymous: register_anonimous,
    cookieToJson,
    persistToken: (token) => fs.writeFileSync(tokenPath, token, 'utf-8'),
  });
}

async function startApi() {
  updateNeteaseApiStatus({ status: 'starting', port: null, error: null });
  try {
    const freePort = await getFreePort();
    await initializeNcmApiRuntime();
    await serveNcmApi({ port: freePort });
    assignedPort = freePort;
    updateNeteaseApiStatus({ status: 'running', port: assignedPort, error: null });
    console.log('Netease API started on port', assignedPort);
  } catch (e) {
    assignedPort = null;
    updateNeteaseApiStatus({ status: 'error', port: null, error: serializeError(e) });
    console.error('Failed to start Netease API', e);
  }

  return neteaseApiStatus;
}

let neteaseApiStartPromise = null;

// Serializes start attempts. The renderer can now ask for a restart, and serveNcmApi has no
// shutdown hook, so a second concurrent attempt would leak a listening server on another port.
function startNeteaseApi() {
  if (neteaseApiStatus.status === 'running') {
    return Promise.resolve(neteaseApiStatus);
  }

  if (!neteaseApiStartPromise) {
    neteaseApiStartPromise = startApi().finally(() => {
      neteaseApiStartPromise = null;
    });
  }

  return neteaseApiStartPromise;
}

const QQ_API_STATUS_CHANNEL = 'qq-api-status-changed';
let qqApiStatus = {
  status: 'starting',
  port: null,
  error: null,
  updatedAt: Date.now(),
};

function updateQqApiStatus(nextStatus) {
  qqApiStatus = {
    ...qqApiStatus,
    ...nextStatus,
    updatedAt: Date.now(),
  };

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(QQ_API_STATUS_CHANNEL, qqApiStatus);
    }
  });
}

let qqApiHandle = null;

// Runs @yakult-green-tea/qq-music-api in-process. Device identifiers remain in their existing file;
// account credentials are owned by the API and cross this boundary only through an encrypted
// main-process repository. The renderer continues to receive only an opaque session token.
async function startQqApi() {
  updateQqApiStatus({ status: 'starting', port: null, error: null });
  try {
    const freePort = await getFreePort();
    // getFreePort only observes that the port was free a moment ago, so the bind can still lose a
    // race. Awaiting the handle means 'running' is only published once the socket is really bound.
    qqApiHandle = await startQqApiServer({
      port: freePort,
      stateFilePath: path.join(app.getPath('userData'), 'qq-auth-state', 'qq-device.json'),
      authSessionRepository: qqAuthSessionRepository,
    });
    updateQqApiStatus({ status: 'running', port: freePort, error: null });
    console.log('QQ API started on port', freePort);
  } catch (error) {
    qqApiHandle = null;

    // A build that shipped without the package can never recover, so it is reported as
    // 'unavailable' rather than 'error'; everything else (a lost port race, a throw from inside the
    // package) is a real failure and keeps the error status.
    if (isQqApiModuleNotFound(error)) {
      updateQqApiStatus({ status: 'unavailable', port: null, error: serializeError(error) });
      console.warn('[QQ API] Package not installed; QQ provider will stay unavailable in this build');
      return;
    }

    updateQqApiStatus({ status: 'error', port: null, error: serializeError(error) });
    console.error('Failed to start QQ API', error);
  }
}

async function stopQqApi() {
  const handle = qqApiHandle;
  qqApiHandle = null;
  if (!handle) {
    return;
  }

  try {
    await handle.close();
  } catch (error) {
    console.error('Failed to stop QQ API', error);
  }
}

function isElectronDevRuntime() {
  return process.env.ELECTRON_DEV === 'true' || process.env.NODE_ENV === 'development';
}

function loadAppEntry(win, query = {}) {
  if (isElectronDevRuntime()) {
    const url = new URL('http://localhost:3000');
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
    win.loadURL(url.toString());
    return;
  }

  win.loadFile(path.join(__dirname, '../dist/index.html'), { query });
}

function getStaticContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.woff') return 'font/woff';
  return 'application/octet-stream';
}

function sendObsJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function sendObsText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

function matchesObsBrowserSourceToken(requestUrl) {
  const expectedToken = getObsBrowserSourceToken({ generateIfMissing: false });
  if (!expectedToken) {
    return false;
  }
  return requestUrl.searchParams.get('token') === expectedToken;
}

function sendObsEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendSerializedObsEvent(res, eventName, serializedPayload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${serializedPayload}\n\n`);
}

function broadcastObsBrowserSourceEvent(eventName, payload) {
  const serializedPayload = JSON.stringify(payload);
  for (const client of Array.from(obsBrowserSourceClients)) {
    sendSerializedObsEvent(client, eventName, serializedPayload);
  }
}

function sendObsBrowserSourceBootstrapEvents(res) {
  if (latestObsBrowserSourceConfig) {
    sendObsEvent(res, 'config', latestObsBrowserSourceConfig);
  }
  if (latestObsBrowserSourceClock) {
    sendObsEvent(res, 'clock', latestObsBrowserSourceClock);
  }
  if (latestObsBrowserSourceAudio) {
    sendObsEvent(res, 'audio', latestObsBrowserSourceAudio);
  }
}

async function serveObsStaticFile(req, res, pathname) {
  const distRoot = path.resolve(__dirname, '../dist');
  const normalizedPath = pathname === '/' || pathname === '/obs'
    ? '/index.html'
    : pathname;
  const requestedPath = path.resolve(distRoot, `.${decodeURIComponent(normalizedPath)}`);

  if (!requestedPath.startsWith(distRoot)) {
    sendObsText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fs.promises.stat(requestedPath);
    if (!stat.isFile()) {
      sendObsText(res, 404, 'Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': getStaticContentType(requestedPath),
      'Cache-Control': requestedPath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(requestedPath).pipe(res);
  } catch {
    sendObsText(res, 404, 'Not found');
  }
}

async function handleObsBrowserSourceHttpRequest(req, res) {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${getConfiguredObsBrowserSourcePort()}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/obs/health' && req.method === 'GET') {
    sendObsJson(res, 200, buildObsBrowserSourceStatus());
    return;
  }

  if (!isObsBrowserSourceEnabled()) {
    sendObsJson(res, 503, { error: 'OBS browser source is disabled.' });
    return;
  }

  if (pathname === '/obs/events' && req.method === 'GET') {
    if (!matchesObsBrowserSourceToken(requestUrl)) {
      sendObsJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    obsBrowserSourceClients.add(res);
    sendObsBrowserSourceBootstrapEvents(res);
    broadcastObsBrowserSourceStatus();

    req.on('close', () => {
      obsBrowserSourceClients.delete(res);
      broadcastObsBrowserSourceStatus();
    });
    return;
  }

  if (pathname === '/obs' && req.method === 'GET') {
    if (!matchesObsBrowserSourceToken(requestUrl)) {
      sendObsJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    if (isElectronDevRuntime()) {
      const devUrl = new URL('http://localhost:3000');
      devUrl.searchParams.set('obs', '1');
      devUrl.searchParams.set('token', requestUrl.searchParams.get('token') || '');
      devUrl.searchParams.set('obsPort', String(getConfiguredObsBrowserSourcePort()));
      res.writeHead(302, { Location: devUrl.toString() });
      res.end();
      return;
    }
  }

  await serveObsStaticFile(req, res, pathname);
}

async function startObsBrowserSourceServerIfNeeded() {
  if (!isObsBrowserSourceEnabled()) {
    return;
  }

  getObsBrowserSourceToken({ generateIfMissing: true });
  if (obsBrowserSourceServer) {
    return;
  }

  obsBrowserSourceServer = http.createServer((req, res) => {
    Promise.resolve(handleObsBrowserSourceHttpRequest(req, res)).catch((error) => {
      console.error('[OBS] Unhandled browser source request failure.', error);
      sendObsJson(res, 500, { error: 'Internal OBS browser source error.' });
    });
  });

  await new Promise((resolve, reject) => {
    obsBrowserSourceServer.once('error', reject);
    obsBrowserSourceServer.listen(getConfiguredObsBrowserSourcePort(), '127.0.0.1', () => {
      obsBrowserSourceServer.off('error', reject);
      resolve();
    });
  });

  console.log(`[OBS] Browser source listening on ${buildObsBrowserSourceUrl()}.`);
  broadcastObsBrowserSourceStatus();
}

async function stopObsBrowserSourceServer() {
  for (const client of Array.from(obsBrowserSourceClients)) {
    client.end();
  }
  obsBrowserSourceClients.clear();

  if (!obsBrowserSourceServer) {
    broadcastObsBrowserSourceStatus();
    return;
  }

  const server = obsBrowserSourceServer;
  obsBrowserSourceServer = null;
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
  broadcastObsBrowserSourceStatus();
}

async function syncObsBrowserSourceServerState() {
  if (isObsBrowserSourceEnabled()) {
    await startObsBrowserSourceServerIfNeeded();
  } else {
    await stopObsBrowserSourceServer();
  }
  return buildObsBrowserSourceStatus();
}

function isTransparentPlayerBackgroundEnabled() {
  return Boolean(store.get(TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY));
}

function rememberWindowPlaybackHandoff(handoff) {
  if (!handoff) {
    return false;
  }

  return windowPlaybackHandoffStore.save(handoff);
}

function resolvePendingWindowPlaybackHandoffRequest(requestId, handoff) {
  const pendingRequest = pendingWindowPlaybackHandoffRequests.get(requestId);
  rememberWindowPlaybackHandoff(handoff);

  if (!pendingRequest) {
    return false;
  }

  clearTimeout(pendingRequest.timeoutId);
  pendingWindowPlaybackHandoffRequests.delete(requestId);
  pendingRequest.resolve(handoff || null);
  return true;
}

function requestWindowPlaybackHandoff(timeoutMs = WINDOW_PLAYBACK_HANDOFF_REQUEST_TIMEOUT_MS) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve(null);
  }

  const requestId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingWindowPlaybackHandoffRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);

    pendingWindowPlaybackHandoffRequests.set(requestId, {
      resolve,
      timeoutId,
    });

    try {
      mainWindow.webContents.send('window-playback-handoff-requested', { requestId });
    } catch (error) {
      clearTimeout(timeoutId);
      pendingWindowPlaybackHandoffRequests.delete(requestId);
      console.warn('[Electron] Failed to request window playback handoff', error);
      resolve(null);
    }
  });
}

function clearPendingWindowPlaybackHandoffRequests() {
  for (const [requestId, pendingRequest] of pendingWindowPlaybackHandoffRequests.entries()) {
    clearTimeout(pendingRequest.timeoutId);
    pendingRequest.resolve(null);
    pendingWindowPlaybackHandoffRequests.delete(requestId);
  }
}

function patchRemoteControlSnapshot(patch) {
  if (!latestRemoteControlSnapshot) {
    return;
  }

  latestRemoteControlSnapshot = {
    ...latestRemoteControlSnapshot,
    ...patch,
    updatedAt: Date.now(),
  };
  sendRemoteControlSnapshot(latestRemoteControlSnapshot);
}

function publishMainWindowClickThroughState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.webContents.send('main-window-click-through-changed', {
    enabled: mainWindowClickThroughEnabled,
    unlockHoverActive: mainWindowClickThroughUnlockHover,
  });
  refreshTrayMenu();
  return true;
}

function isCursorInsideMainWindowClickThroughUnlockHotspot() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const bounds = mainWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const hotspotRight = bounds.x + bounds.width - MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT.rightInset;
  const hotspotLeft = hotspotRight - MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT.width;
  const hotspotTop = bounds.y + MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT.topInset;
  const hotspotBottom = hotspotTop + MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT.height;

  return cursor.x >= hotspotLeft
    && cursor.x <= hotspotRight
    && cursor.y >= hotspotTop
    && cursor.y <= hotspotBottom;
}

function syncMainWindowClickThroughUnlockHoverFromCursor() {
  if (!mainWindowClickThroughEnabled) {
    return false;
  }

  return setMainWindowClickThroughUnlockHover(isCursorInsideMainWindowClickThroughUnlockHotspot());
}

function startMainWindowClickThroughUnlockHoverMonitor() {
  if (mainWindowClickThroughUnlockHoverTimer) {
    return;
  }

  syncMainWindowClickThroughUnlockHoverFromCursor();
  mainWindowClickThroughUnlockHoverTimer = setInterval(
    syncMainWindowClickThroughUnlockHoverFromCursor,
    MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOVER_INTERVAL_MS
  );
}

function stopMainWindowClickThroughUnlockHoverMonitor() {
  if (!mainWindowClickThroughUnlockHoverTimer) {
    return;
  }

  clearInterval(mainWindowClickThroughUnlockHoverTimer);
  mainWindowClickThroughUnlockHoverTimer = null;
}

function applyMainWindowMouseIgnoreState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.setIgnoreMouseEvents(
    mainWindowClickThroughEnabled && !mainWindowClickThroughUnlockHover,
    { forward: true }
  );
  publishMainWindowClickThroughState();
  return true;
}

function setMainWindowClickThroughEnabled(enabled) {
  // Refuse to enable on wallpaper modes: X11/Windows sink the window below the desktop-icon
  // layer, where real clicks never reach it; the live macOS session forces the window
  // mouse-transparent at the full-screen presentation layer, where an unlock hotspot would eat
  // the desktop clicks the session forwards through its tap. The state stays off.
  if (Boolean(enabled) && (isX11WallpaperMode() || isWindowsWallpaperMode() || isMacWallpaperActive)) {
    return mainWindowClickThroughEnabled;
  }

  mainWindowClickThroughEnabled = Boolean(enabled);
  if (!mainWindowClickThroughEnabled) {
    mainWindowClickThroughUnlockHover = false;
    stopMainWindowClickThroughUnlockHoverMonitor();
  }

  applyMainWindowMouseIgnoreState();
  if (mainWindowClickThroughEnabled) {
    startMainWindowClickThroughUnlockHoverMonitor();
  }
  refreshTrayMenu();
  patchRemoteControlSnapshot({
    mainWindowClickThroughEnabled,
  });
  return mainWindowClickThroughEnabled;
}

function setMainWindowClickThroughUnlockHover(active) {
  const nextActive = Boolean(active) && mainWindowClickThroughEnabled;
  if (mainWindowClickThroughUnlockHover === nextActive) {
    return mainWindowClickThroughUnlockHover;
  }

  mainWindowClickThroughUnlockHover = nextActive;
  applyMainWindowMouseIgnoreState();
  return mainWindowClickThroughUnlockHover;
}

function sendRemoteControlSnapshot(snapshot) {
  if (!remoteControlWindow || remoteControlWindow.isDestroyed()) {
    return false;
  }

  remoteControlWindow.webContents.send('remote-control-snapshot', snapshot);
  return true;
}

// Wallpaper mode (Wayland): windowtolayer turns the first window it sees into the layer
// surface and passes every later one through to xdg-shell as an ordinary window. The main
// window claims that slot at startup, but a hidden window has no surface at all, so show it
// again before building a secondary window — otherwise the secondary window would become the
// wallpaper. No-op outside a wrapped session.
function ensureWallpaperLayerHeldByMainWindow() {
  if (!isWallpaperWrapped() || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
}

function createRemoteControlWindow() {
  if (remoteControlWindow && !remoteControlWindow.isDestroyed()) {
    remoteControlWindow.setTitle(REMOTE_CONTROL_WINDOW_TITLE);
    applyRemoteControlAlwaysOnTop(remoteControlWindow);
    applyRemoteControlSkipTaskbar(remoteControlWindow);
    remoteControlWindow.show();
    remoteControlWindow.focus();
    broadcastPlaybackSyncBridgeStatus();
    refreshTrayMenu();
    return remoteControlWindow;
  }

  ensureWallpaperLayerHeldByMainWindow();

  const win = new BrowserWindow({
    modal: false,
    width: 450,
    height: 230,
    minWidth: 450,
    minHeight: 230,
    maxWidth: 450,
    maxHeight: 230,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: REMOTE_CONTROL_WINDOW_TITLE,
    name: 'folia-remote',
    autoHideMenuBar: true,
    resizable: false,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: remoteControlAlwaysOnTop,
    skipTaskbar: remoteControlSkipTaskbarEnabled,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  remoteControlWindow = win;
  broadcastPlaybackSyncBridgeStatus();
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(REMOTE_CONTROL_WINDOW_TITLE);
  });
  applyRemoteControlAlwaysOnTop(win);
  loadAppEntry(win, { remote: '1' });

  win.once('ready-to-show', () => {
    win.setTitle(REMOTE_CONTROL_WINDOW_TITLE);
    applyRemoteControlAlwaysOnTop(win);
    if (latestRemoteControlSnapshot) {
      sendRemoteControlSnapshot(latestRemoteControlSnapshot);
    }
  });

  win.on('closed', () => {
    if (remoteControlWindow === win) {
      remoteControlWindow = null;
    }
    broadcastPlaybackSyncBridgeStatus();
    refreshTrayMenu();
  });

  refreshTrayMenu();
  return win;
}

function sanitizeVideoExportSize(size) {
  const width = Math.round(Number(size?.width));
  const height = Math.round(Number(size?.height));

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 320) {
    return null;
  }

  return {
    width: Math.min(width, 3840),
    height: Math.min(height, 3840),
  };
}

// Resize the main window so that its *bounds* (the area the capture source
// actually records, which includes Windows' frameless-window DWM decoration)
// yields a content physical size >= the requested export size. We use a snap
// search around the ideal CSS size to find a value where getContentSize() * dpr
// exceeds the preset (overshoot), then the frontend Canvas crops the excess
// pixels with integer symmetric cropping — no scaling, no black bars.
// After sizing, we enter a decoration-removal loop: if DWM adds asymmetric
// borders that shift content off-center inside bounds, we grow the window by
// 1px on each edge and retry until bounds == content (decoration eliminated).
function fitMainWindowBoundsToExportSize(exportSize) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const exportDpr = mainWindow.__dpr && mainWindow.__dpr > 0 ? mainWindow.__dpr : 1;

  // Size the window so its *bounds* (the area the capture source actually records —
  // a whole-window capture includes the ~1px frameless-window DWM decoration) matches
  // the preset in physical pixels exactly. If the bounds physical size differed from the
  // preset, the capture source aspect ratio would mismatch the output and crop-and-scale
  // would add black bars. We set the rounded CSS content size, then read back the bounds
  // physical size and nudge by +/-1 CSS px until it equals the preset. The content area
  // ends up ~decoration px smaller than the preset (a minor crop), but the recording has
  // no scaling black bars and the output is exactly the requested resolution.
  let cssWidth = Math.max(1, Math.round(exportSize.width / exportDpr));
  let cssHeight = Math.max(1, Math.round(exportSize.height / exportDpr));
  mainWindow.setContentSize(cssWidth, cssHeight, false);

  // Keep the window on whichever display it already lives on instead of forcing
  // it to the primary display. getDisplayMatching resolves the display containing
  // the window's current bounds, so the export stays put (no surprise jump).
  const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  // Center the window and snap its position to a whole physical pixel. Under a non-100% DPI
  // the CSS position times dpr can land on a half-pixel, and Chromium's crop-and-scale
  // capture derives its crop rect from the window's physical bounds; a half-pixel offset
  // between the reported bounds and where the window is actually composited can leave a
  // 1-2px black strip. Aligning the physical position to whole pixels removes that drift.
  const center = (w, h) => {
    let x = Math.round(workArea.x + (workArea.width - w) / 2);
    let y = Math.round(workArea.y + (workArea.height - h) / 2);
    if (!Number.isInteger(x * exportDpr)) x += (x % 2 === 0) ? 1 : -1;
    if (!Number.isInteger(y * exportDpr)) y += (y % 2 === 0) ? 1 : -1;
    mainWindow.setBounds({ x, y, width: w, height: h }, false);
    return mainWindow.getBounds();
  };

  // The capture source is the *whole window* (bounds), which on a frameless transparent
  // window on Windows carries a 1px DWM border (decoLeftCss = 1) and, after DWM snaps the
  // window to its grid, can gain/lose a pixel on resize. So neither the rounded CSS size
  // nor a single +/-1 nudge reliably yields boundsPhys == preset. We search a small CSS
  // window around the rounded size, CENTERING THE WINDOW EACH TIME so we read the *final*
  // boundsPhys (including DWM snapping), and pick the value whose *content* physical
  // size (from getContentSize, NOT bounds) is >= preset + margin (so the Canvas crop
  // can work in pure-crop mode without upscaling).
  // Minimum overshoot (in device pixels) to guarantee pure-crop mode without upscaling.
  // This is a hard lower bound, NOT a per-resolution guess: regardless of DPR or DWM decoration
  // size, snap() only ensures contentPhys >= preset + CROP_MARGIN_PX, and the actual crop amount is
  // always derived from (video.videoWidth/videoHeight - preset) at runtime. Do not retune per resolution.
  const CROP_MARGIN_PX = 6; // Minimum extra pixels for pure crop (no scaling)
  const snap = (base, axis, otherCss) => {
    base = Math.max(1, base);
    let bestCss = base;
    let bestErr = Infinity;
    let bestContentPhys = 0;
    // Target contentPhys must be >= preset + margin to allow pure crop in Canvas
    const target = (axis === 'w' ? exportSize.width : exportSize.height) + CROP_MARGIN_PX;
    const presetVal = axis === 'w' ? exportSize.width : exportSize.height;
    let probe = '';
    // Fixed search radius around the rounded CSS size. This is an exploration window to absorb
    // 1px DWM-snap jitter, NOT a hand-tuned value for a specific resolution: we always test every
    // delta and pick the one whose measured contentPhys is closest to (preset + CROP_MARGIN_PX).
    for (let delta = -3; delta <= 5; delta++) { // Extended search range for overshoot
      const tryCss = base + delta;
      if (tryCss < 1) continue;
      if (axis === 'w') mainWindow.setContentSize(tryCss, otherCss, false);
      else mainWindow.setContentSize(otherCss, tryCss, false);
      const b = center(axis === 'w' ? tryCss : otherCss, axis === 'w' ? otherCss : tryCss);
      // Compare CONTENT physical size (not bounds) because the Canvas crop operates
      // on the content area after excluding DWM decoration pixels.
      const [cW, cH] = mainWindow.getContentSize();
      const cPhys = axis === 'w'
        ? Math.round(cW * exportDpr)
        : Math.round(cH * exportDpr);
      const bPhys = axis === 'w'
        ? Math.round(b.width * exportDpr)
        : Math.round(b.height * exportDpr);
      probe += ` [${axis} tryCss=${tryCss} boundsPhys=${bPhys} contentPhys=${cPhys}]`;
      const err = Math.abs(cPhys - target);
      if (cPhys >= presetVal && err <= bestErr) {
        // Accept any value where contentPhys >= preset, prefer closest to target (=preset+margin)
        if (err < bestErr || (err === bestErr && cPhys > bestContentPhys)) {
          bestErr = err; bestCss = tryCss; bestContentPhys = cPhys;
        }
      } else if (bestContentPhys < presetVal && cPhys > bestContentPhys) {
        // Fallback: if no valid overshoot found yet, keep the largest undershoot
        bestErr = err; bestCss = tryCss; bestContentPhys = cPhys;
      }
    }
    return bestCss;
  };

  cssWidth = snap(cssWidth, 'w', cssHeight);
  let bounds = center(cssWidth, cssHeight);

  // A frameless transparent window on Windows keeps a 1px DWM border (decoLeftCss = 1,
  // sometimes also bottom). That border makes the captured whole-window source wider/taller
  // than the content, so its aspect ratio can never exactly equal the preset and crop-and-scale
  // pads black bars. Force the content rect to fill the whole window so bounds == content;
  // retry a few times because a single setContentBounds can race with DWM. Once the decoration
  // is gone, boundsPhys equals contentPhys and the source aspect ratio matches the preset.
  for (let i = 0; i < 4; i++) {
    mainWindow.setContentBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    const cb = mainWindow.getContentBounds();
    const b2 = mainWindow.getBounds();
    const dl = cb.x - b2.x, dt = cb.y - b2.y;
    const dr = (b2.x + b2.width) - (cb.x + cb.width);
    const db = (b2.y + b2.height) - (cb.y + cb.height);
    if (dl === 0 && dt === 0 && dr === 0 && db === 0) break;
    bounds = b2;
  }
  bounds = mainWindow.getBounds();

  // With the decoration removed, bounds == content, so snapping the height now targets the
  // real content height: a CSS height of round(600/1.5)=400 yields boundsPhys==600 exactly.
  cssHeight = snap(cssHeight, 'h', cssWidth);
  bounds = center(cssWidth, cssHeight);

  let boundsPhysW = Math.round(bounds.width * exportDpr);
  let boundsPhysH = Math.round(bounds.height * exportDpr);

  return {
    exportDpr, cssWidth, cssHeight, bounds, boundsPhysW, boundsPhysH,
  };
}

async function getMainWindowCaptureSource() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const mediaSourceId = typeof mainWindow.getMediaSourceId === 'function'
    ? mainWindow.getMediaSourceId()
    : null;
  const title = mainWindow.getTitle();
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
  });

  const source =
    (mediaSourceId && sources.find(item => item.id === mediaSourceId)) ||
    sources.find(item => item.name === title && item.name !== REMOTE_CONTROL_WINDOW_TITLE) ||
    sources.find(item => item.name.toLowerCase().includes('folia') && item.name !== REMOTE_CONTROL_WINDOW_TITLE) ||
    null;

  return source ? { id: source.id, name: source.name } : null;
}

function createWindow(options = {}) {
  const { showImmediately = true } = options;
  // X11 wallpaper mode: the main window becomes a desktop window (maps to
  // _NET_WM_WINDOW_TYPE_DESKTOP) covering the whole work area. Wayland ignores the
  // type option, so this branch is mutually exclusive with the windowtolayer path.
  const useDesktopWindowType = isX11WallpaperMode();
  // Windows wallpaper mode: an ordinary frameless window that the helper parents into the
  // WorkerW layer right after creation. It shares the fullscreen-primary-display geometry with
  // the X11 branch, but the window type stays default.
  const useWindowsWallpaper = isWindowsWallpaperMode();
  const useWallpaperGeometry = useDesktopWindowType || useWindowsWallpaper;
  // On a scaled X11 desktop (KWin display scale > 1) the bounds from the screen module are
  // device-independent pixels, and Chromium clamps a window that is mapped immediately to the
  // work-area width (which excludes panels). The window must therefore be mapped hidden, sized to
  // the full display, and then shown — a fresh map at the explicit bounds covers the whole screen.
  const deferShowForDesktopSizing = useDesktopWindowType && showImmediately;
  const { bounds: storedBounds, isMaximized: storedMaximized } = getStoredWindowState();
  const windowBounds = useWallpaperGeometry
    ? screen.getPrimaryDisplay().bounds
    : ensureWindowBoundsVisible(storedBounds);
  const isMaximized = useWallpaperGeometry ? false : storedMaximized;
  // Classic-desktop wallpaper windows must be opaque (see the attach-mode note above); the
  // window remembers what it was built as so the reconcile path can detect mismatches.
  const useTransparentWindow = isTransparentPlayerBackgroundEnabled()
    && !(useWindowsWallpaper && !isWindowsWallpaperTransparentSupported());
  const enableNativeBlur = store.get('enable_player_page_native_blur') === true;
  let win;
  try {
    win = new BrowserWindow({
      ...windowBounds,
      type: useDesktopWindowType ? 'desktop' : undefined,
      minWidth: 350,
      minHeight: 100,
      frame: false,
      transparent: useTransparentWindow,
      hasShadow: !useTransparentWindow,
      // Windows wallpaper mode must drop WS_THICKFRAME entirely: with it, Windows treats the
      // window as frame-bearing and the geometry work leaves frame-width gaps at the screen
      // edges (and the pre-attach bounds get adjusted off the requested display rect).
      thickFrame: process.platform === 'win32' ? !useTransparentWindow && !useWindowsWallpaper : undefined,
      backgroundColor: (useTransparentWindow || enableNativeBlur) ? '#00000000' : '#09090b',
      vibrancy: (!useTransparentWindow && enableNativeBlur) && process.platform === 'darwin' ? 'fullscreen-ui' : undefined,
      backgroundMaterial: (!useTransparentWindow && enableNativeBlur) && process.platform === 'win32' ? 'acrylic' : undefined,
      autoHideMenuBar: true,
      icon: APP_ICON_PATH,
      skipTaskbar: mainWindowSkipTaskbarEnabled,
      // Desktop windows already live below every normal window; alwaysOnTop is meaningless here.
      alwaysOnTop: useWallpaperGeometry ? false : mainWindowAlwaysOnTop,
      // A wallpaper window must not be user-resizable; the helper owns the geometry.
      // NOTE: the key must be omitted entirely in normal mode — passing `resizable: undefined`
      // makes Electron treat the option as false and create a non-resizable window.
      ...(useWindowsWallpaper ? { resizable: false } : {}),
      // Same for dragging: moving a wallpaper window out of the desktop geometry (e.g. out of the
      // WorkerW hierarchy on Windows) breaks the wallpaper. Key omitted in normal mode, same
      // undefined-option caveat as `resizable` above.
      ...(useWallpaperGeometry ? { movable: false } : {}),
      show: showImmediately && !deferShowForDesktopSizing,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true, // Disable for local app
        backgroundThrottling: false
      }
    });
  } catch (error) {
    // Watchdog trigger point 1: failing to build the window means the wallpaper session
    // never connected to the compositor; recover instead of leaving the app dead.
    console.error('[Wallpaper] Failed to create main window', error);
    wallpaperWatchdog.handleWindowBuildFailure();
    throw error;
  }
  win.__wallpaperWindowTransparent = useTransparentWindow;
  win.__wallpaperGeometry = useWallpaperGeometry;

  if (useDesktopWindowType) {
    x11WallpaperWindows.add(win);
  }

  // Watchdog trigger point 1: a crashed renderer breaks the wallpaper connection.
  win.webContents.on('render-process-gone', (_event, details) => {
    wallpaperWatchdog.handleRendererGone(details);
    // Windows: a renderer crash kills only the page — the BrowserWindow (and its place in the
    // WorkerW) survives, so the helper keeps the still-valid hwnd and must NOT be touched.
    // Reloading the webContents restores the UI in place; the full window rebuild
    // (rebuildWindowsWallpaperSession) is reserved for the window-destroyed case where the
    // WorkerW teardown took the window with it.
    // macOS: same in-place reload — the desktop level / all-spaces / click-through live on the
    // BrowserWindow, which a page crash does not destroy, and the new page re-reads the stored
    // wallpaper_mode through the usual settings sync.
    const crashed = details?.reason === 'crashed' && !win.isDestroyed();
    const macWallpaperCrash = process.platform === 'darwin' && isMacWallpaperMode();
    if ((useWindowsWallpaper || macWallpaperCrash) && crashed) {
      win.webContents.reload();
    }
  });

  // Wallpaper desktop windows: re-assert the full display bounds while still hidden, then show.
  // Without the re-assert the initial map would be clamped to the work area (see
  // deferShowForDesktopSizing), leaving an uncovered strip. When showImmediately is false the
  // caller (e.g. recreateMainWindowWithTransparencyMode) owns the show, but the bounds fix still
  // applies so the window is full-size by the time it appears.
  if (useWallpaperGeometry) {
    win.setBounds(screen.getPrimaryDisplay().bounds);
  }
  if (deferShowForDesktopSizing) {
    win.show();
  }

  // 首屏加载遮罩是不透明的（index.html 里的 #app-splash）。透明播放背景和壁纸窗口在挂载前
  // 本来就该透出桌面，盖一层黑底会在桌面上闪一个黑块，所以这两种窗口显式关掉它。
  loadAppEntry(win, (useTransparentWindow || useWallpaperGeometry) ? { splash: '0' } : {});
  if (isElectronDevRuntime()) {
    win.webContents.openDevTools();
  }

  if (isMaximized) {
    win.maximize();
  }

  mainWindow = win;
  ensureTray();
  setMainWindowSkipTaskbarEnabled(mainWindowSkipTaskbarEnabled);
  // Full initializer, not just applyMainWindowMouseIgnoreState(): when click-through is on at
  // startup (Wayland wallpaper mode) this also starts the unlock-hotspot monitor, so hover near
  // the titlebar corner can temporarily restore mouse interaction even though the lock toggle
  // itself is no longer rendered in wallpaper mode.
  setMainWindowClickThroughEnabled(mainWindowClickThroughEnabled);
  updateWindowThumbarButtons();
  win.on('resize', () => {
    saveWindowState(win, { deferred: true });
  });
  win.on('move', () => {
    saveWindowState(win, { deferred: true });
  });
  win.on('maximize', () => {
    saveWindowState(win);
  });
  win.on('unmaximize', () => {
    saveWindowState(win);
  });
  win.on('close', () => {
    saveWindowState(win);
  });
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      // macOS wallpaper mode is window-bound: when the window goes away (external destroy, a
      // path that bypasses the normal toggles) the session must stop its tap and restore the
      // Dock, otherwise the app keeps running with a hidden Dock and a stale wallpaper flag.
      if (process.platform === 'darwin' && isMacWallpaperActive) {
        try {
          exitMacWallpaperMode();
        } catch (error) {
          console.warn('[WallpaperMac] exit on window close failed:', error && error.message);
        }
      }
      displaySleepBlocker.stop();
      mainWindowClickThroughUnlockHover = false;
      stopMainWindowClickThroughUnlockHoverMonitor();
      if (remoteControlWindow && !remoteControlWindow.isDestroyed()) {
        remoteControlWindow.close();
      }
      refreshTrayMenu();
    }
  });
  win.on('show', refreshTrayMenu);
  win.on('hide', refreshTrayMenu);
  win.on('minimize', refreshTrayMenu);
  win.on('restore', refreshTrayMenu);

  return win;
}

function recreateMainWindowWithTransparencyMode(enabled, handoff = null) {
  store.set(TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY, Boolean(enabled));
  rememberWindowPlaybackHandoff(handoff);

  // Windows wallpaper mode: whatever window ends up as the main window must be re-attached —
  // the helper holds the old window's hwnd, which is about to be destroyed. Detach (graceful)
  // so the old window is un-parented from the WorkerW before its destroy — killing the helper
  // instead would leave the destroyed window's last frame stuck on the desktop layer.
  const reattachWindowsWallpaper = process.platform === 'win32' && isWindowsWallpaperMode();
  if (reattachWindowsWallpaper) {
    windowsWallpaper.detach();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    const createdWindow = createWindow();
    if (process.platform === 'darwin' && rebindMacWallpaperSessionToCurrentWindow()) {
      return createdWindow;
    }
    focusMainWindow();
    if (reattachWindowsWallpaper) {
      windowsWallpaper.attach();
    }
    return createdWindow;
  }

  const previousWindow = mainWindow;
  saveWindowState(previousWindow);
  mainWindow = null;

  // Wallpaper mode: windowtolayer only hands the layer surface to a window created while no
  // other window holds it (see ensureWallpaperLayerHeldByMainWindow), so the old wallpaper
  // window must be gone before the replacement is built — otherwise the rebuilt main window
  // comes back as an ordinary window and the wallpaper disappears with the old one.
  if (isWallpaperWrapped()) {
    isSwappingMainWindow = true;
    try {
      previousWindow.destroy();
      const createdWindow = createWindow();
      focusMainWindow();
      return createdWindow;
    } finally {
      isSwappingMainWindow = false;
    }
  }

  const nextWindow = createWindow({ showImmediately: false });
  nextWindow.once('ready-to-show', () => {
    nextWindow.show();
    if (!previousWindow.isDestroyed()) {
      previousWindow.destroy();
    }
    // macOS wallpaper mode never rebuilds the window anywhere else, so a transparent toggle
    // reaching this path would otherwise sink the wallpaper together with the destroyed window.
    // Re-sink the replacement; a wallpaper window never takes key focus, so skip it on success.
    // If the re-sink fails, exit the session so the rebuilt window is not left flagged as a
    // wallpaper it is not actually running (the renderer keys its chrome off that flag).
    const macWallpaperLiveBeforeSwap = process.platform === 'darwin' && isMacWallpaperActive;
    if (macWallpaperLiveBeforeSwap) {
      const rebound = rebindMacWallpaperSessionToCurrentWindow();
      if (!rebound) {
        try {
          exitMacWallpaperMode();
        } catch (error) {
          // ignore
        }
      }
    }
    if (!macWallpaperLiveBeforeSwap || !isMacWallpaperActive) {
      focusMainWindow();
    }
    if (reattachWindowsWallpaper) {
      windowsWallpaper.attach();
    }
  });

  return nextWindow;
}

async function setMainWindowTransparentMode(enabled, handoff = null) {
  const nextEnabled = Boolean(enabled);
  // Classic-desktop wallpaper windows cannot present a transparent surface after SetParent
  // (the wallpaper goes black); refuse the toggle instead of recreating into a broken state.
  // The renderer keeps its previous state and shows the unsupported hint.
  if (nextEnabled && process.platform === 'win32' && isWindowsWallpaperMode() && !isWindowsWallpaperTransparentSupported()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wallpaper-transparent-refused', getPublicSettings());
    }
    return false;
  }
  patchRemoteControlSnapshot({
    transparentModeEnabled: nextEnabled,
    mainWindowClickThroughEnabled: false,
  });
  mainWindowClickThroughEnabled = false;
  mainWindowClickThroughUnlockHover = false;
  stopMainWindowClickThroughUnlockHoverMonitor();
  recreateMainWindowWithTransparencyMode(nextEnabled, handoff);
  return true;
}

async function setMainWindowTransparentModeFromRemote(enabled) {
  const handoff = await requestWindowPlaybackHandoff();
  return setMainWindowTransparentMode(enabled, handoff);
}

app.whenReady().then(async () => {
  const startupResult = await mainProcessStartupPromise;
  if (startupResult === 'duplicate') {
    app.quit();
    return;
  }
  if (startupResult === 'spawned') {
    return;
  }

  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }

  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    const backend = safeStorage.getSelectedStorageBackend();
    // Without a real backend the KuGou and QQ repositories keep credentials in memory only, so this
    // line is the fastest way to tell a lost-login report apart from an authentication bug.
    if (backend === 'basic_text' || !safeStorage.isEncryptionAvailable()) {
      console.warn('[Electron] No OS credential encryption available; online accounts will not persist', {
        backend,
        desktop: process.env.XDG_CURRENT_DESKTOP || null,
      });
    }
  }

  setupFileSystemAccessPermissionHandlers();
  setupCorsBypassHandlers();
  localCoverAssetStore.registerProtocolHandler(protocol, electronNet);
  // Transcode fallback is an optional degradation path; a failure preparing it must never keep
  // the rest of this handler, createWindow() included, from running.
  try {
    await transcodeService.initialize();
  } catch (error) {
    console.warn('[TranscodeFallback] Initialization failed; playback fallback is unavailable', error);
  }

  session.defaultSession.on('file-system-access-restricted', (event, details, callback) => {
    if (details.isDirectory) {
      const locale = getMainLocale();
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: locale.dialogImportTitle,
        message: locale.dialogImportMessage,
        buttons: [locale.dialogChooseOther, locale.dialogCancel],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) {
          callback('tryAgain');
        } else {
          callback('deny');
        }
      });
      return;
    }
    callback('deny');
  });

  setupAutoUpdater();
  // Not awaited: this performs network round trips (xeapi key, anonymous token) that used to keep
  // the window from appearing at all on a slow or blocked route. Status reaches the renderer over
  // NETEASE_API_STATUS_CHANNEL, and get-netease-port reports null until the server is listening.
  void startNeteaseApi();
  await startQqApi();
  try {
    await stageApi.startStageServerIfNeeded();
  } catch (error) {
    console.error('[Stage] Failed to start stage server during app startup', error);
  }
  try {
    await startObsBrowserSourceServerIfNeeded();
  } catch (error) {
    console.error('[OBS] Failed to start browser source server during app startup', error);
  }
  await lyricApi.start();
  ensureTray();
  // macOS wallpaper: create the controller once userData is available and recover a Dock left
  // auto-hidden by a crashed wallpaper session. Recovery is enqueued FIRST on the Dock op queue
  // (this runs before any enter can hide the Dock again), so the re-enter's hide reads the
  // restored state — never the still-hidden crash state — as the user's own preference.
  if (process.platform === 'darwin') {
    const macController = getMacWallpaperController();
    if (macController) {
      macController.configureDockRecovery();
      void macController.recoverStrandedDock();
    }
  }
  createWindow();
  focusMainWindow();
  if (process.env.FOLIA_PENDING_DESKTOP_LYRIC === '1') {
    delete process.env.FOLIA_PENDING_DESKTOP_LYRIC;
    if (!isWallpaperModeEnabled()) {
      void setDesktopLyricMode(true).then(() => {
        refreshTrayMenu();
      });
    }
  }
  // Windows wallpaper mode: attach the helper once the window exists (startup with the setting
  // on; runtime toggles go through scheduleWallpaperModeRelaunch → relaunchForWallpaperModeChange).
  if (isWindowsWallpaperMode()) {
    const attachResult = windowsWallpaper.attach();
    if (attachResult === 'missing') {
      // Clearing the setting is not enough: the window above was already created with the
      // wallpaper options (thickFrame:false, resizable:false, movable:false). It must be
      // recreated as an ordinary window or the user is left with a borderless, immovable
      // shell — same recovery the degrade path performs.
      store.set(WALLPAPER_MODE_SETTING_KEY, false);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wallpaper-mode-changed', getPublicSettings());
      }
      recreateMainWindowWithTransparencyMode(isTransparentPlayerBackgroundEnabled(), null);
    }
  }
  // macOS wallpaper mode is an in-place sink that dies with the window, so a `wallpaper_mode`
  // left on by a previous session must be re-applied to the fresh window here. If the FFI bridge
  // or the Input Monitoring permission is unavailable, degrade to a normal window and DROP the
  // stale flag — otherwise the renderer would keep its custom chrome off and its window-control
  // IPC refused for a mode the window is not actually in.
  if (process.platform === 'darwin') {
    if (isMacWallpaperMode() && !enterMacWallpaperMode()) {
      store.set(WALLPAPER_MODE_SETTING_KEY, false);
      notifyMacWallpaperModeChanged();
    }
  }
  // Display hotplug / resolution change: re-assert the fullscreen geometry (DIP) and ask the
  // helper to re-fill the monitor in physical pixels.
  // Registered outside the startup-mode branch: the Windows toggle recreates the window
  // without a process relaunch, so wallpaper mode can be entered long after startup and the
  // geometry must keep following display changes.
  if (process.platform === 'win32') {
    // Display changes arrive as event bursts with different shapes: a resolution edit emits
    // display-metrics-changed, but a topology switch (monitor plug/unplug, Win+P, lid) emits
    // only display-removed + display-added — a metrics-changed listener alone misses it and the
    // wallpaper keeps the dead monitor's size. Coalesce the burst and re-assert the geometry
    // once it settles: DIP bounds follow getPrimaryDisplay(), physical geometry is delegated to
    // the helper `move` (MonitorFromWindow also covers the window sitting on a removed display).
    let wallpaperGeometryTimer = null;
    const reassertWallpaperGeometry = () => {
      if (!isWindowsWallpaperMode() || !windowsWallpaper.isAttached()) {
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
      }
      const helperPath = resolveWallpaperHelperPath();
      const hwnd = getMainWindowNativeHwnd();
      if (helperPath && hwnd !== null) {
        const child = spawn(helperPath, ['move', '--hwnd', String(hwnd)], { stdio: 'ignore' });
        child.on('error', (err) => {
          console.warn('[WallpaperWin] helper move failed', err);
        });
      }
    };
    const scheduleWallpaperGeometryReassert = () => {
      if (wallpaperGeometryTimer) {
        clearTimeout(wallpaperGeometryTimer);
      }
      wallpaperGeometryTimer = setTimeout(() => {
        wallpaperGeometryTimer = null;
        reassertWallpaperGeometry();
      }, 200);
    };
    screen.on('display-added', scheduleWallpaperGeometryReassert);
    screen.on('display-removed', scheduleWallpaperGeometryReassert);
    screen.on('display-metrics-changed', scheduleWallpaperGeometryReassert);
  }
  // macOS: resolution / display-topology changes must re-assert the wallpaper frame (simple-full
  // screen geometry) while the session is live. Registered once like the Windows block above,
  // because the toggle does not restart the process.
  if (process.platform === 'darwin') {
    let macWallpaperGeometryTimer = null;
    const scheduleMacWallpaperFrameReassert = () => {
      if (macWallpaperGeometryTimer) {
        clearTimeout(macWallpaperGeometryTimer);
      }
      macWallpaperGeometryTimer = setTimeout(() => {
        macWallpaperGeometryTimer = null;
        // A deferred entry owns the frame until the full-screen exit lands; do not race it.
        if (isMacWallpaperActive && !macWallpaperPendingEnter && mainWindow && !mainWindow.isDestroyed()) {
          applyMacWallpaperFrame();
          applyMacAmbientLevel();
        }
      }, 200);
    };
    screen.on('display-added', scheduleMacWallpaperFrameReassert);
    screen.on('display-removed', scheduleMacWallpaperFrameReassert);
    screen.on('display-metrics-changed', scheduleMacWallpaperFrameReassert);
  }
  scheduleStartupUpdateCheck();
  voiceInputPauseMonitor.syncState();

  try {
    modSystem = createModSystem({
      app,
      BrowserWindow,
      getMainWindow: () => mainWindow,
      getLocaleKey: getMainLocaleKey,
      isFeatureEnabled: () => readStoredBoolean(MOD_SYSTEM_ENABLED_SETTING_KEY, false),
    });
    modSystem.registerIpc();
    modSystem.loadAll();
    if (readStoredBoolean(MOD_SYSTEM_ENABLED_SETTING_KEY, false)) {
      void modSystem.probeFfmpeg();
    }
  } catch (error) {
    console.error('[Mods] Failed to initialize the mod system', error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // The mac wallpaper sink is window-bound: a window rebuilt under an active (stored)
      // wallpaper mode must be sunk again once it exists.
      if (process.platform === 'darwin' && isMacWallpaperMode()) {
        enterMacWallpaperMode();
      }
    } else {
      focusMainWindow();
    }
  });
});

// Set in before-quit so window-all-closed can tell an intentional shutdown apart from the main
// window being destroyed externally (see the Windows wallpaper branch below).
let isAppQuitting = false;

let isSwappingMainWindow = false;

app.on('window-all-closed', () => {
  if (isSwappingMainWindow) {
    return;
  }
  clearPendingWindowPlaybackHandoffRequests();
  // Windows wallpaper mode: the main window is a child of a WorkerW, so an explorer restart
  // destroys it together with the desktop hierarchy. Quitting here would turn a recoverable
  // session into a dead wallpaper — rebuild the window instead (the helper's own
  // window-destroyed recovery may also arrive later over the pipe; whichever wins, the
  // attach latch and the stdout ownership guard dedupe the two paths). Intentional quits run
  // before-quit first and take the regular path below.
  if (process.platform === 'win32' && isWindowsWallpaperMode() && !isAppQuitting) {
    rebuildWindowsWallpaperSession();
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  transcodeService.dispose();
  isAppQuitting = true;
  clearPendingWindowPlaybackHandoffRequests();
  if (modSystem) {
    try {
      modSystem.dispose();
    } catch (error) {
      console.error('[Mods] Failed to dispose the mod system', error);
    }
  }
  voiceInputPauseMonitor.stop();
  displaySleepBlocker.stop();
  // Detach (graceful) instead of killing: the helper un-parents the window from the WorkerW
  // and repaints the layer before the window is destroyed — a window torn down while still
  // parented leaves its last frame stuck on the desktop. killHelper() is the fallback for
  // anything that races the graceful path (the helper also self-detaches on stdin EOF).
  windowsWallpaper.detach();
  // macOS wallpaper: stop the event tap and restore the Dock. Tap/level state dies with the
  // process, but the Dock is SYSTEM state — the async restore chain could be cut short by the
  // process exiting mid-way, so restore synchronously (execFileSync + killall Dock).
  if (process.platform === 'darwin') {
    if (macWallpaperTapRetryTimer) {
      clearTimeout(macWallpaperTapRetryTimer);
      macWallpaperTapRetryTimer = null;
    }
    if (macWallpaperDragTimer) {
      clearTimeout(macWallpaperDragTimer);
      macWallpaperDragTimer = null;
    }
    macWallpaperPendingDrag = null;
    isMacWallpaperActive = false;
    isMacWallpaperInteractionEnabled = false;
    macWallpaperSavedState = null;
    const macController = getMacWallpaperController();
    if (macController) {
      try {
        macController.stop();
      } catch (error) {
        // ignore
      }
      try {
        macController.restoreDockSync();
      } catch (error) {
        // ignore
      }
    }
  }
  void discordPresence.destroy();
  void stopQqApi();
  void lyricApi.stop();
});

// Settings Management IPC
ipcMain.handle('window-set-native-theme', (event, themeSource) => {
  nativeTheme.themeSource = themeSource;
});

// Cache the main window's device pixel ratio so export window sizing can be
// expressed in physical pixels (see resize-main-window / video-export-prepare-window).
ipcMain.handle('report-device-pixel-ratio', (event, ratio) => {
  if (!isTrustedMainWindowContents(event.sender)) return;
  const dpr = Number(ratio);
  if (Number.isFinite(dpr) && dpr > 0) {
    mainWindow.__dpr = dpr;
  }
});

ipcMain.handle('get-settings', () => {
  return getPublicSettings();
});

ipcMain.handle('playback-display-sleep-set-active', (event, active) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }
  return displaySleepBlocker.setActive(Boolean(active));
});

ipcMain.handle('set-app-locale', (event, localeKey) => {
  if (localeKey === 'zh-CN' || localeKey === 'en' || localeKey === 'in') {
    store.set(APP_LOCALE_KEY, localeKey);
    refreshTrayMenu();
  }
  return localeKey;
});

ipcMain.handle('save-settings', (event, key, value) => {
  if (key === 'DISCORD_RICH_PRESENCE_APPLICATION_ID') {
    return getPublicSettings();
  }

  let nextValue = value;
  if (key === UPDATE_CHANNEL_SETTING_KEY) {
    const channel = normalizeUpdateChannelSelection(value);
    if (!channel) {
      return getPublicSettings();
    }
    nextValue = channel;
  }
  if (
    key === MINIMIZE_TO_TRAY_SETTING_KEY ||
    key === HIDE_TASKBAR_ICON_SETTING_KEY ||
    key === REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY ||
    key === REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY ||
    key === TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY ||
    key === DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY ||
    key === VOICE_INPUT_PAUSE_ENABLED_SETTING_KEY ||
    key === PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_SETTING_KEY ||
    key === MOD_SYSTEM_ENABLED_SETTING_KEY ||
    key === WALLPAPER_MODE_SETTING_KEY ||
    key === WALLPAPER_FORWARD_MOUSE_SETTING_KEY ||
    key === WALLPAPER_ZGUARD_SETTING_KEY ||
    key === WALLPAPER_MAC_AUTOHIDE_DOCK_SETTING_KEY
  ) {
    nextValue = Boolean(value);
  }
  store.set(key, nextValue);

  if (key === MOD_SYSTEM_ENABLED_SETTING_KEY && modSystem) {
    // Turning the switch off deactivates every running mod immediately rather
    // than only hiding the UI; turning it on discovers and activates whatever
    // the user had already confirmed.
    try {
      modSystem.loadAll();
    } catch (error) {
      console.error('[Mods] Failed to apply the mod system switch', error);
    }
  }

  if (key === WALLPAPER_MODE_SETTING_KEY) {
    // Let the renderer receive its save-settings response before the process relaunches, while
    // coalescing rapid toggles into one handoff/relaunch operation.
    scheduleWallpaperModeRelaunch(Boolean(nextValue));
  }

  // Windows helper flags are process launch arguments: restart the helper in place so the new
  // switch takes effect. Kill + re-attach keeps the window welded to the WorkerW throughout
  // (a graceful detach would race the fresh attach over the same window).
  if (
    process.platform === 'win32' &&
    (key === WALLPAPER_FORWARD_MOUSE_SETTING_KEY || key === WALLPAPER_ZGUARD_SETTING_KEY) &&
    isWindowsWallpaperMode()
  ) {
    windowsWallpaper.killHelper();
    windowsWallpaper.attach();
  }

  // macOS: the forward-mouse switch is the in-place interactivity toggle — start/stop the tap on
  // the live wallpaper session (no helper to restart).
  if (
    process.platform === 'darwin' &&
    key === WALLPAPER_FORWARD_MOUSE_SETTING_KEY &&
    isMacWallpaperMode()
  ) {
    if (isMacWallpaperActive) {
      isMacWallpaperInteractionEnabled = Boolean(nextValue);
      if (isMacWallpaperInteractionEnabled) {
        startMacWallpaperInteraction();
      } else {
        stopMacWallpaperInteraction();
      }
    }
  }

  // macOS: the Dock auto-hide switch applies live to the wallpaper session. Turning it off always
  // restores the Dock; turning it on hides only while the Dock is at the bottom edge (same rule the
  // wallpaper entry uses — a side Dock is never touched).
  if (
    process.platform === 'darwin' &&
    key === WALLPAPER_MAC_AUTOHIDE_DOCK_SETTING_KEY &&
    isMacWallpaperMode()
  ) {
    if (isMacWallpaperActive) {
      const macController = getMacWallpaperController();
      if (macController) {
        if (Boolean(nextValue)) {
          try {
            if (macController.isDockAtBottom()) {
              void macController.setDockAutohide(true);
            }
          } catch (error) {
            // ignore
          }
        } else {
          void macController.restoreDock();
        }
      }
    }
  }

  if (key === 'enable_player_page_native_blur') {
    if (!isTransparentPlayerBackgroundEnabled()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const enableNativeBlur = Boolean(nextValue);
        mainWindow.setBackgroundColor(enableNativeBlur ? '#00000000' : '#09090b');
        if (process.platform === 'darwin') {
          // A wallpaper session holds the window at the desktop layer, where vibrancy renders
          // behind the icons (the "wallpaper stuck" AppKit trap the entry path clears). The
          // stored choice is re-applied on session exit, so a mid-session toggle must not apply
          // vibrancy live — the session keeps it suppressed throughout.
          if (!isMacWallpaperActive) {
            mainWindow.setVibrancy(enableNativeBlur ? 'fullscreen-ui' : null);
          }
        } else if (process.platform === 'win32') {
          mainWindow.setBackgroundMaterial(enableNativeBlur ? 'acrylic' : 'none');
        }
      }
    }
  }

  if (key === ENABLE_UPDATE_CHECK_SETTING_KEY) {
    if (Boolean(nextValue)) {
      checkForUpdates().catch((error) => {
        setUpdateState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } else {
      setUpdateState({ status: 'disabled', error: null, availableVersion: null, downloadProgress: null });
    }
  }

  if (key === ENABLE_AUTO_UPDATE_SETTING_KEY) {
    publishUpdateStatus();
    if (Boolean(nextValue) && updateState.availableVersion) {
      downloadAvailableUpdate().catch((error) => {
        setUpdateState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  if (key === UPDATE_CHANNEL_SETTING_KEY) {
    const updater = ensureAutoUpdater();
    if (updater) {
      configureAutoUpdaterChannel(updater);
    }

    setUpdateState({
      status: getUpdateCheckEnabled() && isUpdateCheckSupported() ? 'idle' : 'unsupported',
      availableVersion: null,
      updateUrl: FOLIA_RELEASES_URL,
      error: null,
      downloadProgress: null,
    });

    if (getUpdateCheckEnabled() && isPackagedUpdateRuntime() && isUpdateCheckSupported()) {
      checkForUpdates().catch((error) => {
        setUpdateState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  if (key === HIDE_TASKBAR_ICON_SETTING_KEY) {
    setMainWindowSkipTaskbarEnabled(nextValue);
  }

  if (key === REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY) {
    remoteControlAlwaysOnTop = Boolean(nextValue);
    applyRemoteControlAlwaysOnTop(remoteControlWindow);
  }

  if (key === REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY) {
    remoteControlSkipTaskbarEnabled = Boolean(nextValue);
    applyRemoteControlSkipTaskbar(remoteControlWindow);
  }

  if (key === STAGE_MODE_SOURCE_SETTING_KEY) {
    void stageApi.syncStageModeState?.().catch((error) => {
      console.error('[Stage] Failed to sync Stage mode source setting', error);
    });
  }

  if (key === DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY) {
    void discordPresence.refresh();
    broadcastPlaybackSyncBridgeStatus();
  }

  if (key === VOICE_INPUT_PAUSE_ENABLED_SETTING_KEY) {
    voiceInputPauseMonitor.syncState();
  }

  return getPublicSettings();
});

ipcMain.handle('get-cache-directory', () => {
  return {
    path: getConfiguredCacheDirectory(),
    isDefault: !store.has(CACHE_DIRECTORY_SETTING_KEY),
  };
});

ipcMain.handle('choose-cache-directory', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      canceled: true,
      path: getConfiguredCacheDirectory(),
      isDefault: !store.has(CACHE_DIRECTORY_SETTING_KEY),
    };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose cache directory',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getConfiguredCacheDirectory(),
  });

  if (result.canceled || result.filePaths.length === 0) {
    return {
      canceled: true,
      path: getConfiguredCacheDirectory(),
      isDefault: !store.has(CACHE_DIRECTORY_SETTING_KEY),
    };
  }

  const selectedPath = result.filePaths[0];
  store.set(CACHE_DIRECTORY_SETTING_KEY, selectedPath);

  return {
    canceled: false,
    path: selectedPath,
    isDefault: false,
  };
});

ipcMain.handle('reset-cache-directory', () => {
  store.delete(CACHE_DIRECTORY_SETTING_KEY);
  return {
    path: getConfiguredCacheDirectory(),
    isDefault: true,
  };
});

// Where a fetched model is written: the directory the user pointed us at, or the app's own under
// userData. Never the bundled copy - that lives in the install folder and is not ours to write into.
// The settings page reads the live location off `automix-model-status`, so these handlers only DO
// the change and let the page re-read; their own return value is not consumed.
const modelsDownloadDir = () => getConfiguredModelsDirectory() ?? getDefaultModelsDirectory();

ipcMain.handle('choose-models-directory', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose model directory',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: modelsDownloadDir(),
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  store.set(MODELS_DIRECTORY_SETTING_KEY, result.filePaths[0]);
  // The running worker took its directories as argv, so it has to be restarted to see the new one.
  analysisHost.reload();
  return { canceled: false };
});

ipcMain.handle('reset-models-directory', () => {
  store.delete(MODELS_DIRECTORY_SETTING_KEY);
  analysisHost.reload();
});

// Getting the weights onto this machine. Everything about HOW is in analysis/modelStore.cjs; what
// is here is the window it reports progress to and the file picker it cannot open for itself.
const modelStore = createModelStore({
  getModelsDirs: getModelsDirectories,
  // Never the bundled directory: that one lives inside the install folder and is not ours to write
  // into, and on a packaged app it may not even be writable.
  getDownloadDir: modelsDownloadDir,
  onProgress: (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('automix-model-progress', event);
    }
  },
  // A model appearing or moving has to reach the worker, which took its directories as argv when it
  // was forked. Restarting is how; it is what the idle timer does anyway.
  onChanged: () => { analysisHost.reload(); },
});

ipcMain.handle('automix-model-status', () => modelStore.status());
ipcMain.handle('automix-model-download', (_event, name) => modelStore.download(name));
ipcMain.handle('automix-model-cancel', (_event, name) => modelStore.cancel(name));
ipcMain.handle('automix-model-scan', () => modelStore.scan(scanHintDirectories()));
ipcMain.handle('automix-model-install', (_event, name, source) => modelStore.installLocal(name, source));

ipcMain.handle('automix-model-remove-all', () => modelStore.removeAll());

// Where a manually downloaded file is likely to be. Passed to the scan rather than baked into it,
// because these come from Electron's own path lookups and modelStore is plain Node.
function scanHintDirectories() {
  return ['downloads', 'desktop', 'documents']
    .map((key) => { try { return app.getPath(key); } catch { return null; } })
    .filter(Boolean);
}

ipcMain.handle('updates-get-status', () => {
  return getUpdateStatus();
});

ipcMain.handle('updates-check', () => {
  return checkForUpdates({ manual: true });
});

ipcMain.handle('updates-mark-seen', (event, version) => {
  return markUpdateSeen(version);
});

ipcMain.handle('updates-open-release-page', (event, version) => {
  return openUpdateReleasePage(version);
});

ipcMain.handle('open-external-url', (event, url) => {
  return openExternalUrl(url);
});

ipcMain.handle('updates-download', () => {
  return downloadAvailableUpdate();
});

ipcMain.handle('updates-quit-and-install', () => {
  const updater = ensureAutoUpdater();
  if (!isAutoUpdaterSupported() || !updater || updateState.status !== 'downloaded') {
    return false;
  }

  // Wallpaper mode is process-wide state: quitAndInstall relaunches the app without letting us
  // clear env, and a wrapped session's WAYLAND_SOCKET is a dead fd after restart. Drop the mode
  // first so the updated app comes back as a normal window.
  if (isWallpaperModeEnabled()) {
    store.set(WALLPAPER_MODE_SETTING_KEY, false);
  }

  updater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle('get-audio-cache', async (event, cacheKey) => {
  return readAudioCacheEntry(cacheKey);
});

ipcMain.handle('has-audio-cache', async (event, cacheKey) => {
  return hasAudioCacheEntry(cacheKey);
});

ipcMain.handle('save-audio-cache', async (event, cacheKey, data, mimeType, limitBytes) => {
  await writeAudioCacheEntry(cacheKey, data, mimeType, limitBytes);
  return true;
});

ipcMain.handle('get-audio-cache-usage', async () => {
  return getAudioCacheUsageBytes();
});

ipcMain.handle('get-audio-cache-stats', async () => {
  return getAudioCacheStats();
});

ipcMain.handle('clear-audio-cache', async () => {
  await clearAudioCacheDirectory();
  return true;
});

ipcMain.handle('transcode-fallback-request', async (_event, request) => {
  return transcodeService.request(request);
});

ipcMain.handle('transcode-fallback-cancel', (_event, requestId) => {
  return transcodeService.cancel(requestId);
});

ipcMain.handle('get-cover-cache', async (event, cacheKey) => {
  return readCoverCacheEntry(cacheKey);
});

ipcMain.handle('save-cover-cache', async (event, cacheKey, data, mimeType) => {
  await writeCoverCacheEntry(cacheKey, data, mimeType);
  return true;
});

ipcMain.handle('remove-cover-cache', async (event, cacheKey) => {
  await removeCoverCacheEntry(cacheKey);
  return true;
});

ipcMain.handle('get-cover-cache-usage', async () => {
  return getCoverCacheUsageBytes();
});

ipcMain.handle('clear-cover-cache', async () => {
  await clearCoverCacheDirectory();
  return true;
});

ipcMain.handle('has-local-cover-asset', async (_event, assetId) => {
  return localCoverAssetStore.has(assetId);
});

ipcMain.handle('save-local-cover-asset', async (_event, assetId, data, mimeType) => {
  await localCoverAssetStore.write(assetId, data, mimeType);
  return true;
});

ipcMain.handle('remove-local-cover-asset', async (_event, assetId) => {
  return localCoverAssetStore.remove(assetId);
});

ipcMain.handle('clear-local-cover-assets', async () => {
  return localCoverAssetStore.clear();
});

// Retrieve dynamic port of local Netease API Server
ipcMain.handle('get-netease-port', () => {
  return assignedPort;
});

ipcMain.handle('restart-netease-api', () => startNeteaseApi());

ipcMain.handle('get-netease-api-status', () => {
  return neteaseApiStatus;
});

// Retrieve dynamic port of the embedded QQ API server; null until it is running.
ipcMain.handle('get-qq-port', () => qqApiStatus.port);

ipcMain.handle('get-qq-api-status', () => qqApiStatus);

ipcMain.handle('kugou-api-status', () => kugouApiBridge.getStatus());
ipcMain.handle('kugou-api-request', (_event, operation, params) => kugouApiBridge.request(operation, params));

ipcMain.handle('window-minimize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  // Wallpaper windows have no minimize semantics; leaving wallpaper mode goes through the setting.
  if (isWallpaperModeEnabled()) {
    return false;
  }

  if (isMinimizeToTrayEnabled()) {
    return hideMainWindow();
  }

  mainWindow.minimize();
  refreshTrayMenu();
  return true;
});

ipcMain.handle('window-toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (isWallpaperModeEnabled()) {
    return mainWindow.isMaximized();
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }

  mainWindow.maximize();
  return true;
});

ipcMain.handle('window-toggle-fullscreen', (event) => {
  if (!isTrustedMainWindowContents(event.sender) || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  // Fullscreen would tear the wallpaper window out of its desktop-layer geometry.
  if (isWallpaperModeEnabled()) {
    return mainWindow.isFullScreen();
  }

  const nextFullscreen = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextFullscreen);
  return nextFullscreen;
});

ipcMain.handle('window-close', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  // Closing a wallpaper window is meaningless; exit goes through the wallpaper mode setting.
  if (isWallpaperModeEnabled()) {
    return false;
  }

  mainWindow.close();
  return true;
});

// Sleep timer and other explicit "exit the whole app" paths. Unlike window-close this
// quits even when closing-to-tray is enabled, and runs the before-quit cleanup.
ipcMain.handle('app-quit', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }
  app.quit();
  return true;
});

ipcMain.handle('window-is-maximized', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  return mainWindow.isMaximized();
});

ipcMain.handle('window-get-transparent-mode', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }

  return isTransparentPlayerBackgroundEnabled();
});

ipcMain.handle('window-set-transparent-mode', async (event, enabled, handoff) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }

  return setMainWindowTransparentMode(Boolean(enabled), handoff);
});

ipcMain.handle('window-playback-handoff-consume', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return null;
  }

  return windowPlaybackHandoffStore.consume();
});

ipcMain.handle('window-playback-handoff-submit', (event, requestId, handoff) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }

  if (typeof requestId !== 'string' || !requestId.trim()) {
    return rememberWindowPlaybackHandoff(handoff);
  }

  return resolvePendingWindowPlaybackHandoffRequest(requestId, handoff);
});

ipcMain.handle('window-get-click-through', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }

  return mainWindowClickThroughEnabled;
});

ipcMain.handle('window-set-click-through', (event, enabled) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }

  return setMainWindowClickThroughEnabled(enabled);
});

ipcMain.handle('window-set-click-through-unlock-hover', (event, active) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }

  return setMainWindowClickThroughUnlockHover(active);
});

ipcMain.handle('window-get-always-on-top', (event) => {
  if (!isTrustedMainWindowContents(event.sender) && !isTrustedRemoteControlContents(event.sender)) {
    return false;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindowAlwaysOnTop = mainWindow.isAlwaysOnTop();
  }

  return mainWindowAlwaysOnTop;
});

ipcMain.handle('window-set-always-on-top', (event, enabled) => {
  if (!isTrustedMainWindowContents(event.sender) && !isTrustedRemoteControlContents(event.sender)) {
    return false;
  }

  return setMainWindowAlwaysOnTop(enabled);
});

ipcMain.handle('obs-browser-source-get-status', () => {
  return buildObsBrowserSourceStatus();
});

ipcMain.handle('obs-browser-source-set-enabled', async (event, enabled) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to toggle OBS browser source.');
  }

  store.set(OBS_BROWSER_SOURCE_ENABLED_SETTING_KEY, Boolean(enabled));
  return syncObsBrowserSourceServerState();
});

ipcMain.handle('obs-browser-source-regenerate-token', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to regenerate OBS browser source token.');
  }

  const nextToken = crypto.randomBytes(32).toString('base64url');
  store.set(OBS_BROWSER_SOURCE_TOKEN_SETTING_KEY, nextToken);
  broadcastObsBrowserSourceStatus();
  return buildObsBrowserSourceStatus();
});

ipcMain.handle('obs-browser-source-publish-config', (event, config) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to publish OBS browser source config.');
  }

  latestObsBrowserSourceConfig = config || null;
  if (latestObsBrowserSourceConfig) {
    broadcastObsBrowserSourceEvent('config', latestObsBrowserSourceConfig);
  }
  return true;
});

ipcMain.handle('obs-browser-source-publish-clock', (event, clock) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to publish OBS browser source clock.');
  }

  latestObsBrowserSourceClock = clock || null;
  if (latestObsBrowserSourceClock) {
    broadcastObsBrowserSourceEvent('clock', latestObsBrowserSourceClock);
  }
  return true;
});

ipcMain.handle('obs-browser-source-publish-audio', (event, audio) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to publish OBS browser source audio.');
  }

  latestObsBrowserSourceAudio = audio || null;
  if (latestObsBrowserSourceAudio) {
    broadcastObsBrowserSourceEvent('audio', latestObsBrowserSourceAudio);
  }
  return true;
});

ipcMain.handle('lyric-api-get-status', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read Lyrics API status.');
  }
  return lyricApi.buildStatus();
});

ipcMain.handle('lyric-api-set-enabled', (event, enabled) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to change Lyrics API state.');
  }
  return lyricApi.setEnabled(Boolean(enabled));
});

ipcMain.handle('lyric-api-publish', (event, lyrics, offset) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    return false;
  }
  return lyricApi.publishLyricData(lyrics, offset);
});

ipcMain.handle('discord-presence-get-status', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read Discord presence status.');
  }

  return discordPresence.getStatus();
});

ipcMain.handle('discord-presence-publish-snapshot', (event, snapshot) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to publish Discord presence state.');
  }

  return discordPresence.publishSnapshot(snapshot);
});

ipcMain.handle('playback-sync-bridge-get-status', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read playback sync bridge status.');
  }

  return buildPlaybackSyncBridgeStatus();
});

ipcMain.handle('voice-input-pause-get-status', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read voice input pause status.');
  }

  return voiceInputPauseMonitor.getStatus();
});

ipcMain.handle('stage-get-status', () => {
  return stageApi.buildStageStatus();
});

ipcMain.handle('stage-set-enabled', async (_event, enabled) => {
  return stageApi.setStageEnabled(enabled);
});

ipcMain.handle('stage-regenerate-token', async () => {
  return stageApi.regenerateStageToken();
});

ipcMain.handle('stage-clear-state', async () => {
  return stageApi.clearStageState();
});

ipcMain.handle('stage-complete-external-play', (event, result) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to complete a Stage external play request.');
  }

  return stageApi.completeStageExternalPlayRequest(result);
});

ipcMain.handle('stage-publish-player-snapshot', (event, snapshot, options) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to publish Stage player state.');
  }

  return stageApi.publishStagePlayerSnapshot(snapshot, options);
});

ipcMain.handle('stage-complete-player-control', (event, result) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to complete a Stage player control request.');
  }

  return stageApi.completeStagePlayerControlRequest(result);
});

ipcMain.handle('stage-complete-player-queue', (event, result) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to complete a Stage player queue request.');
  }

  return stageApi.completeStagePlayerQueueRequest(result);
});

ipcMain.handle('thumbar-update-buttons', (event, state) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to update taskbar controls.');
  }

  return updateWindowThumbarButtons({
    hasActiveTrack: Boolean(state?.hasActiveTrack),
    canGoPrevious: Boolean(state?.canGoPrevious),
    canGoNext: Boolean(state?.canGoNext),
    isPlaying: Boolean(state?.isPlaying),
  });
});

ipcMain.handle('remote-control-open', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to open the remote control window.');
  }

  createRemoteControlWindow();
  return true;
});

ipcMain.handle('remote-control-toggle', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to toggle the remote control window.');
  }

  if (remoteControlWindow && !remoteControlWindow.isDestroyed()) {
    remoteControlWindow.close();
    return false;
  }

  createRemoteControlWindow();
  return true;
});

ipcMain.handle('remote-control-close', (event) => {
  if (!isTrustedRemoteControlContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to close the remote control window.');
  }

  if (!remoteControlWindow || remoteControlWindow.isDestroyed()) {
    return false;
  }

  remoteControlWindow.close();
  return true;
});

ipcMain.handle('remote-control-get-always-on-top', (event) => {
  if (!isTrustedRemoteControlContents(event.sender) && !isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read remote control always-on-top state.');
  }

  if (remoteControlWindow && !remoteControlWindow.isDestroyed()) {
    remoteControlAlwaysOnTop = remoteControlWindow.isAlwaysOnTop();
  }

  return remoteControlAlwaysOnTop;
});

ipcMain.handle('remote-control-set-always-on-top', (event, nextAlwaysOnTop) => {
  if (!isTrustedRemoteControlContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to update remote control always-on-top state.');
  }

  remoteControlAlwaysOnTop = Boolean(nextAlwaysOnTop);
  store.set(REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY, remoteControlAlwaysOnTop);

  applyRemoteControlAlwaysOnTop(remoteControlWindow);

  return remoteControlAlwaysOnTop;
});

ipcMain.handle('remote-control-publish-snapshot', (event, snapshot) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to publish remote control state.');
  }

  latestRemoteControlSnapshot = snapshot
    ? {
      ...(latestRemoteControlSnapshot && !Object.prototype.hasOwnProperty.call(snapshot, 'lyrics')
        ? { lyrics: latestRemoteControlSnapshot.lyrics }
        : {}),
      ...snapshot,
      mainWindowClickThroughEnabled,
      mainWindowAlwaysOnTop,
    }
    : null;
  if (latestRemoteControlSnapshot) {
    sendRemoteControlSnapshot(latestRemoteControlSnapshot);
  }
  return true;
});

ipcMain.handle('remote-control-get-snapshot', (event) => {
  if (!isTrustedRemoteControlContents(event.sender) && !isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read remote control state.');
  }

  return latestRemoteControlSnapshot;
});

ipcMain.handle('remote-control-send-command', (event, command) => {
  if (!isTrustedRemoteControlContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to send a remote control command.');
  }

  if (command?.type === 'set-main-window-click-through') {
    return setMainWindowClickThroughEnabled(Boolean(command.enabled));
  }

  if (command?.type === 'set-main-window-always-on-top') {
    return setMainWindowAlwaysOnTop(Boolean(command.enabled));
  }

  if (command?.type === 'set-transparent-mode-enabled') {
    const nextEnabled = Boolean(command.enabled);
    return setMainWindowTransparentModeFromRemote(nextEnabled);
  }

  if (command?.type === 'disable-transparent-mode') {
    return setMainWindowTransparentModeFromRemote(false);
  }

  if (command?.type === 'resize-main-window') {
    const exportSize = sanitizeVideoExportSize(command);
    if (!mainWindow || mainWindow.isDestroyed() || !exportSize) {
      return false;
    }

    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }

    const fit = fitMainWindowBoundsToExportSize(exportSize);
    if (!fit) {
      return false;
    }
    mainWindow.focus();
    return true;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.webContents.send('remote-control-command', command);
  return true;
});

ipcMain.handle('video-export-choose-path', async (event, defaultName, extension, displayName) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to choose a video export path.');
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, filePath: null };
  }

  const safeExtension = extension === 'mp4' ? 'mp4' : 'webm';
  const safeDisplayName = typeof displayName === 'string' && displayName.trim()
    ? displayName.trim()
    : (safeExtension === 'mp4' ? 'MP4 Video' : 'WebM Video');
  const safeDefaultName = typeof defaultName === 'string' && defaultName.trim()
    ? defaultName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    : `folia-export.${safeExtension}`;
  const defaultFileName = safeDefaultName.endsWith(`.${safeExtension}`)
    ? safeDefaultName
    : `${safeDefaultName.replace(/\.[^.]+$/, '')}.${safeExtension}`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save video export',
    defaultPath: path.join(app.getPath('videos'), defaultFileName),
    filters: [{ name: safeDisplayName, extensions: [safeExtension] }],
  });

  return {
    canceled: result.canceled || !result.filePath,
    filePath: result.filePath || null,
  };
});

ipcMain.handle('video-export-get-main-window-source', async (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read the main window capture source.');
  }

  return getMainWindowCaptureSource();
});

ipcMain.handle('video-export-prepare-window', (event, size) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to resize the main window for export.');
  }

  const exportSize = sanitizeVideoExportSize(size);
  if (!mainWindow || mainWindow.isDestroyed() || !exportSize) {
    return false;
  }

  if (!videoExportWindowRestoreState) {
    videoExportWindowRestoreState = {
      bounds: mainWindow.getBounds(),
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  }

  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }

  const fit = fitMainWindowBoundsToExportSize(exportSize);
  if (!fit) {
    return false;
  }
  const { exportDpr } = fit;
  mainWindow.focus();
  return {
    success: true,
    dpr: exportDpr,
  };
});

ipcMain.handle('video-export-restore-window', (event) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to restore the main window after export.');
  }

  if (!mainWindow || mainWindow.isDestroyed() || !videoExportWindowRestoreState) {
    videoExportWindowRestoreState = null;
    return false;
  }

  const restoreState = videoExportWindowRestoreState;
  videoExportWindowRestoreState = null;
  mainWindow.setBounds(restoreState.bounds, true);

  if (restoreState.isFullScreen) {
    mainWindow.setFullScreen(true);
  } else if (restoreState.isMaximized) {
    mainWindow.maximize();
  }

  return true;
});

ipcMain.handle('video-export-write-file', async (event, filePath, data) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to write a video export file.');
  }

  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('Missing video export path.');
  }

  await fsp.writeFile(filePath, Buffer.from(data));
  return true;
});

ipcMain.handle('debug-get-rendered-fonts', async (event, selector) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read rendered font data.');
  }

  return getRenderedFontReport(selector);
});

ipcMain.handle('lyric-proxy-fetch', async (event, url, init) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to fetch lyric proxy data.');
  }

  if (typeof url !== 'string' || !url) {
    throw new Error('Missing lyric proxy url.');
  }

  return proxyLyricRequest(url, init);
});

// Integrate AI logic locally into Electron
ipcMain.handle('generate-theme', async (event, lyricsText, options = {}) => {
  try {
    const { isPureMusic = false, songTitle } = options;
    const provider = store.get('AI_PROVIDER') || 'gemini';
    const useSystemProxy = store.get('USE_SYSTEM_PROXY_FOR_AI') || false;
    const customFetch = (url, options) => fetchWithOptionalSystemProxy(url, options, useSystemProxy);
    const snippet = lyricsText.slice(0, 2000);

    let dualTheme = null;

    if (provider === 'openai') {
      const systemPrompt = buildThemeSystemPrompt(true);
      const sourcePrompt = buildThemeSourcePrompt(snippet, isPureMusic, songTitle);
      const content = await runAiJsonCompletion({
        store,
        systemPrompt,
        sourcePrompt,
        schema: THEME_JSON_SCHEMA,
        schemaName: THEME_JSON_SCHEMA_NAME,
        customFetch,
        maxTokens: detectOpenAICompatibleProvider(normalizeOpenAIChatCompletionsUrl(store.get('OPENAI_API_URL')), '') === 'openai' ? THEME_MAX_OUTPUT_TOKENS : 8192,
      });
      dualTheme = sanitizeGeneratedDualTheme(parseAiJsonObject(content, ['light', 'dark']));

      dualTheme.light.provider = 'OpenAI Compatible (Local)';
      dualTheme.dark.provider = 'OpenAI Compatible (Local)';

    } else {
      const apiKey = store.get('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured in settings");
      }
      const systemPrompt = buildThemeSystemPrompt(true);
      const sourcePrompt = buildThemeSourcePrompt(snippet, isPureMusic, songTitle);
      dualTheme = sanitizeGeneratedDualTheme(await generateGeminiTheme({
        apiKey,
        systemPrompt,
        sourcePrompt,
        customFetch
      }));

      dualTheme.light.provider = 'Google Gemini (Local)';
      dualTheme.dark.provider = 'Google Gemini (Local)';
    }

    dualTheme.light.fontStyle = 'sans';
    dualTheme.light.animationIntensity = 'normal';
    dualTheme.dark.fontStyle = 'sans';
    dualTheme.dark.animationIntensity = 'normal';
    return dualTheme;
  } catch (e) {
    console.error(e);
    throw new Error(e instanceof Error ? e.message : String(e));
  }
});

// Word-segments the current song's lyric lines with whichever model the user configured. Shares
// its prompt with the web handlers and with the client's copy-to-a-model-site path through
// shared/lyricSegmentationPrompt.cjs, so all four routes ask for exactly the same thing.
ipcMain.handle('segment-lyrics', async (event, lines) => {
  // Held outside the try so the failure path can print what the model actually said. Without it a
  // rejected response gives the user a stack trace and nothing to act on.
  let rawResponse = null;
  try {
    const sourceLines = Array.isArray(lines) ? lines.map((line) => String(line == null ? '' : line)) : [];
    if (sourceLines.length === 0) {
      throw new Error('No lyric lines to segment');
    }

    const useSystemProxy = store.get('USE_SYSTEM_PROXY_FOR_AI') || false;
    const customFetch = (url, options) => fetchWithOptionalSystemProxy(url, options, useSystemProxy);
    console.log(`[segment-lyrics] segmenting ${sourceLines.length} lines`
      + ` via ${store.get('AI_PROVIDER') || 'gemini'}${useSystemProxy ? ' (system proxy)' : ''}`);

    rawResponse = await runAiJsonCompletion({
      store,
      systemPrompt: buildSegmentationSystemPrompt(),
      sourcePrompt: buildSegmentationSourcePrompt(sourceLines),
      schema: SEGMENTATION_JSON_SCHEMA,
      schemaName: SEGMENTATION_SCHEMA_NAME,
      // Gemini takes its own dialect plus a zero thinking budget; see the config's comment for
      // the measurements. Sending neither is what made this take 40s.
      geminiGenerationConfig: SEGMENTATION_GEMINI_GENERATION_CONFIG,
      customFetch,
      maxTokens: SEGMENTATION_MAX_OUTPUT_TOKENS,
      // Preserve the existing segmentation-only suppression ladder and final 4x budget.
      disableReasoning: true,
    });

    const { boundaries, rejections } = parseSegmentationResponse(rawResponse, sourceLines);
    if (rejections.length > 0) {
      // Not fatal: those lines keep the default split. Logged because a model that mangles many
      // lines is worth noticing, and the renderer only sees a count.
      console.warn(`[segment-lyrics] ${rejections.length}/${sourceLines.length} lines rejected;`
        + ` first: ${rejections[0]}`);
    }
    return boundaries;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[segment-lyrics] failed:', message);
    if (rawResponse) {
      console.error('[segment-lyrics] raw model response:', String(rawResponse).slice(0, 4000));
    }
    throw new Error(message);
  }
});
