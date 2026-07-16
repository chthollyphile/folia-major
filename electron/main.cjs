const { app, BrowserWindow, ipcMain, session, screen, dialog, shell, nativeImage, desktopCapturer, Menu, Tray, nativeTheme } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const Store = require('electron-store').default || require('electron-store');
const crypto = require('crypto');
const { createStageApi } = require('./stageApi.cjs');
const { createWindowPlaybackHandoffStore } = require('./windowPlaybackHandoff.cjs');
const { DEFAULT_DISCORD_APPLICATION_ID, createDiscordPresenceController } = require('./discordPresence.cjs');
const { sanitizeDualTheme: sanitizeGeneratedDualTheme } = require('../shared/themeSanitizer.cjs');
const useLinuxGraphicsDebugMode = process.env.ELECTRON_LINUX_PACKAGED_GRAPHICS === 'true';
const isAppImageRuntime =
  process.platform === 'linux' &&
  (Boolean(process.env.APPIMAGE) || Boolean(process.env.APPDIR) || useLinuxGraphicsDebugMode);
const linuxGraphicsMode =
  process.platform !== 'linux'
    ? 'system'
    : (process.env.FOLIA_LINUX_GRAPHICS_MODE || (isAppImageRuntime ? 'swiftshader' : 'system'));

// Fix for Arch Linux / Wayland & Vulkan compatibility issues
if (process.platform === 'linux') {
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

// macOS: GPU 加速优化，解决 Intel Mac + AMD 独显在 Retina 屏幕下的渲染卡顿
if (process.platform === 'darwin' && process.arch === 'x64') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('use-angle', 'gl');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

const store = new Store({ projectName: 'Folia' });

// --- Electron main process locale map ---
const APP_LOCALE_KEY = 'APP_LOCALE';
const mainLocale = {
  'zh-CN': {
    trayShowHide: '显示/隐藏主窗口',
    trayOpenRemote: '打开 遥控窗口',
    trayToggleClickThrough: '切换点击穿透',
    trayHideTaskbar: '隐藏任务栏图标',
    trayQuit: '退出',
    dialogImportTitle: '无法导入此文件夹',
    dialogImportMessage: '不能直接导入系统目录或常用用户目录。\n请选择一个专门存放音乐的文件夹。',
    dialogChooseOther: '选择其他文件夹',
    dialogCancel: '取消',
  },
  en: {
    trayShowHide: 'Show/Hide Main Window',
    trayOpenRemote: 'Open Remote Window',
    trayToggleClickThrough: 'Toggle Click-Through',
    trayHideTaskbar: 'Hide Taskbar Icon',
    trayQuit: 'Quit',
    dialogImportTitle: 'Cannot import this folder',
    dialogImportMessage: 'Cannot directly import system or common user directories.\nPlease choose a dedicated music folder.',
    dialogChooseOther: 'Choose Another Folder',
    dialogCancel: 'Cancel',
  },
  in: {
    trayShowHide: 'Tampilkan/Sembunyikan Jendela Utama',
    trayOpenRemote: 'Buka Jendela Remote',
    trayToggleClickThrough: 'Alihkan Click-Through',
    trayHideTaskbar: 'Sembunyikan Ikon Taskbar',
    trayQuit: 'Keluar',
    dialogImportTitle: 'Tidak dapat mengimpor folder ini',
    dialogImportMessage: 'Folder sistem atau folder pengguna umum tidak dapat diimpor langsung.\nPilih folder khusus untuk menyimpan musik.',
    dialogChooseOther: 'Pilih Folder Lain',
    dialogCancel: 'Batal',
  },
};

function getMainLocale() {
  const stored = store.get(APP_LOCALE_KEY);
  if (stored === 'zh-CN' || stored === 'en' || stored === 'in') {
    return mainLocale[stored];
  }
  return mainLocale.en;
}


let mainWindow = null;
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
const windowPlaybackHandoffStore = createWindowPlaybackHandoffStore();
const pendingWindowPlaybackHandoffRequests = new Map();
let pendingWindowStateSave = null;
let windowStateSaveTimer = null;
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
const ENABLE_UPDATE_CHECK_SETTING_KEY = 'ENABLE_UPDATE_CHECK';
const ENABLE_AUTO_UPDATE_SETTING_KEY = 'ENABLE_AUTO_UPDATE';
const LAST_SEEN_UPDATE_VERSION_SETTING_KEY = 'LAST_SEEN_UPDATE_VERSION';
const STAGE_MODE_ENABLED_SETTING_KEY = 'STAGE_MODE_ENABLED';
const STAGE_MODE_SOURCE_SETTING_KEY = 'STAGE_MODE_SOURCE';
const STAGE_API_TOKEN_SETTING_KEY = 'STAGE_API_TOKEN';
const STAGE_API_PORT_SETTING_KEY = 'STAGE_API_PORT';
const OBS_BROWSER_SOURCE_ENABLED_SETTING_KEY = 'OBS_BROWSER_SOURCE_ENABLED';
const OBS_BROWSER_SOURCE_TOKEN_SETTING_KEY = 'OBS_BROWSER_SOURCE_TOKEN';
const OBS_BROWSER_SOURCE_PORT_SETTING_KEY = 'OBS_BROWSER_SOURCE_PORT';
const DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY = 'DISCORD_RICH_PRESENCE_ENABLED';
const MINIMIZE_TO_TRAY_SETTING_KEY = 'MINIMIZE_TO_TRAY';
const HIDE_TASKBAR_ICON_SETTING_KEY = 'HIDE_TASKBAR_ICON';
const REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY = 'REMOTE_CONTROL_ALWAYS_ON_TOP';
const REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY = 'REMOTE_CONTROL_SKIP_TASKBAR';
const MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY = 'MAIN_WINDOW_ALWAYS_ON_TOP';
const TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY = 'TRANSPARENT_PLAYER_BACKGROUND';

const DEFAULT_STAGE_API_PORT = 32107;
const DEFAULT_OBS_BROWSER_SOURCE_PORT = 32108;
const FOLIA_RELEASES_URL = 'https://github.com/chthollyphile/folia-major/releases';
const FOLIA_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/chthollyphile/folia-major/releases/latest';
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
    'enable_player_page_native_blur': store.get('enable_player_page_native_blur') === true,
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

const discordPresence = createDiscordPresenceController({
  getApplicationId: () => DEFAULT_DISCORD_APPLICATION_ID,
  isEnabled: () => readStoredBoolean(DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY, false),
  onStatusChange: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('discord-presence-status-changed', status);
    }
  },
});

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
  if (!win || win.isDestroyed()) {
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

function getAudioCacheDirectory() {
  return path.join(getConfiguredCacheDirectory(), 'audio');
}

function getCoverCacheDirectory() {
  return path.join(getConfiguredCacheDirectory(), 'cover');
}

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
  if (mainWindowAlwaysOnTop && typeof mainWindow.moveTop === 'function') {
    mainWindow.moveTop();
  }
  return mainWindowAlwaysOnTop;
}

function setMainWindowAlwaysOnTop(enabled) {
  mainWindowAlwaysOnTop = Boolean(enabled);
  store.set(MAIN_WINDOW_ALWAYS_ON_TOP_SETTING_KEY, mainWindowAlwaysOnTop);
  applyMainWindowAlwaysOnTop();
  patchRemoteControlSnapshot({
    mainWindowAlwaysOnTop,
  });
  return mainWindowAlwaysOnTop;
}

function refreshTrayMenu() {
  if (!appTray) {
    return;
  }

  const locale = getMainLocale();
  const menu = Menu.buildFromTemplate([
    {
      label: locale.trayShowHide,
      click: () => {
        toggleMainWindowVisibility();
      },
    },
    {
      label: locale.trayOpenRemote,
      click: () => {
        createRemoteControlWindow();
      },
    },
    {
      label: locale.trayToggleClickThrough,
      type: 'checkbox',
      checked: mainWindowClickThroughEnabled,
      enabled: Boolean(mainWindow && !mainWindow.isDestroyed()),
      click: () => {
        setMainWindowClickThroughEnabled(!mainWindowClickThroughEnabled);
      },
    },
    {
      label: locale.trayHideTaskbar,
      type: 'checkbox',
      checked: mainWindowSkipTaskbarEnabled,
      enabled: Boolean(mainWindow && !mainWindow.isDestroyed()),
      click: () => {
        persistMainWindowSkipTaskbarEnabled(!mainWindowSkipTaskbarEnabled);
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

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
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

function isUpdateCheckSupported() {
  return process.platform === 'win32';
}

function isAutoUpdaterSupported() {
  return (
    process.platform === 'win32' &&
    app.isPackaged &&
    process.env.ELECTRON_DEV !== 'true' &&
    process.env.NODE_ENV !== 'development'
  );
}

function normalizeVersion(value) {
  return typeof value === 'string' ? value.trim().replace(/^v/i, '') : '';
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length, 3);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
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

  return {
    ...updateState,
    supported: isAutoUpdaterSupported(),
    updateCheckSupported: isUpdateCheckSupported(),
    updateCheckEnabled: getUpdateCheckEnabled(),
    autoUpdateEnabled: getAutoUpdateEnabled(),
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

async function fetchLatestReleaseMetadata() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  if (process.env.FOLIA_MOCK_UPDATE === 'true') {
    return {
      tag_name: 'v99.99.99',
      html_url: 'https://github.com/chthollyphile/folia-major/releases/tag/v99.99.99',
    };
  }

  try {
    const ses = await ensureSystemProxySession();
    const response = await ses.fetch(FOLIA_LATEST_RELEASE_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Folia/${app.getVersion()}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub release check failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
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
  updater.allowPrerelease = false;
  updater.autoInstallOnAppQuit = false;

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

async function downloadAvailableUpdate() {
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
    updater.autoDownload = true;
    await updater.checkForUpdates();
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
  if (!getUpdateCheckEnabled() && !manual) {
    setUpdateState({ status: 'disabled', error: null, downloadProgress: null });
    return getUpdateStatus();
  }

  if (!isUpdateCheckSupported()) {
    setUpdateState({ status: 'unsupported', error: null, downloadProgress: null });
    return getUpdateStatus();
  }

  setUpdateState({ status: 'checking', error: null, downloadProgress: null });

  try {
    const release = await fetchLatestReleaseMetadata();
    const latestVersion = normalizeVersion(release?.tag_name || release?.name);
    const releaseUrl = typeof release?.html_url === 'string' ? release.html_url : FOLIA_RELEASES_URL;

    if (!latestVersion) {
      throw new Error('Latest release did not include a version tag.');
    }

    const hasUpdate = compareVersions(latestVersion, app.getVersion()) > 0;
    setUpdateState({
      status: hasUpdate ? 'available' : 'latest',
      availableVersion: hasUpdate ? latestVersion : null,
      updateUrl: releaseUrl,
      error: null,
      lastCheckedAt: Date.now(),
      downloadProgress: null,
    });

    if (hasUpdate && getAutoUpdateEnabled() && isAutoUpdaterSupported()) {
      const updater = ensureAutoUpdater();
      if (updater) {
        updater.autoDownload = true;
        await updater.checkForUpdates();
      } else {
        setUpdateState({
          status: 'error',
          error: 'Failed to initialize auto updater.',
          downloadProgress: null,
        });
      }
    }
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
    ? `${FOLIA_RELEASES_URL}/tag/v${normalizedVersion}`
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
  if (!getUpdateCheckEnabled()) {
    setUpdateState({ status: 'disabled', error: null });
    return;
  }

  if (!isUpdateCheckSupported()) {
    setUpdateState({ status: 'unsupported', error: null });
    return;
  }

  if (!isAutoUpdaterSupported()) {
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

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const THEME_JSON_SCHEMA_NAME = 'dual_theme';
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
      required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons'],
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
      required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons'],
    },
  },
  required: ['light', 'dark'],
};

function normalizeOpenAIChatCompletionsUrl(rawUrl) {
  const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmedUrl) {
    return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
  }

  try {
    const parsed = new URL(trimmedUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/v1/chat/completions';
      return parsed.toString();
    }

    if (/\/v\d+$/.test(normalizedPath)) {
      parsed.pathname = `${normalizedPath}/chat/completions`;
      return parsed.toString();
    }

    parsed.pathname = normalizedPath;
    return parsed.toString();
  } catch {
    return trimmedUrl.replace(/\/+$/, '');
  }
}

function resolveOpenAICompatibleModel(apiUrl, configuredModel) {
  const trimmedModel = typeof configuredModel === 'string' ? configuredModel.trim() : '';
  if (trimmedModel) {
    return trimmedModel;
  }

  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return DEEPSEEK_DEFAULT_MODEL;
    }
  } catch {
    // Fall back to the generic OpenAI default when URL parsing fails.
  }

  return DEFAULT_OPENAI_MODEL;
}

function detectOpenAICompatibleProvider(apiUrl, model) {
  const normalizedModel = model.trim().toLowerCase();
  if (normalizedModel.startsWith('deepseek-')) {
    return 'deepseek';
  }

  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return 'deepseek';
    }
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return 'openai';
    }
  } catch {
    // Fall through to generic provider handling.
  }

  if (/^(gpt|o[1-9]|o[1-9]-|chatgpt-)/.test(normalizedModel)) {
    return 'openai';
  }

  return 'generic';
}

function providerSupportsStructuredOutputs(provider) {
  return provider === 'openai';
}

function extractProviderErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = payload.error;
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return typeof payload.message === 'string' ? payload.message : null;
}

async function formatOpenAICompatibleError(response) {
  const rawText = await response.text();
  let detail = rawText.trim();

  try {
    const parsed = JSON.parse(rawText);
    detail = extractProviderErrorMessage(parsed) || detail;
  } catch {
    // Leave non-JSON responses as-is.
  }

  return detail
    ? `OpenAI compatible API error (${response.status}): ${detail}`
    : `OpenAI compatible API error (${response.status}): ${response.statusText}`;
}

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

function buildOpenAICompatibleRequestBody(model, provider, systemPrompt, sourcePrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: sourcePrompt }
  ];

  if (providerSupportsStructuredOutputs(provider)) {
    return {
      model,
      messages,
      temperature: 0.7,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: THEME_JSON_SCHEMA_NAME,
          strict: true,
          schema: THEME_JSON_SCHEMA,
        },
      },
    };
  }

  return {
    model,
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  };
}

function extractResponseContentText(message) {
  if (!message) {
    return null;
  }

  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new Error(`Model refused request: ${message.refusal}`);
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((part) => part && typeof part === 'object')
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    return text || null;
  }

  return null;
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

async function writeAudioCacheEntry(cacheKey, data, mimeType) {
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
}

async function getAudioCacheUsageBytes() {
  const audioDirectory = getAudioCacheDirectory();

  try {
    const entries = await fsp.readdir(audioDirectory, { withFileTypes: true });
    let total = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.bin')) {
        continue;
      }

      const stat = await fsp.stat(path.join(audioDirectory, entry.name));
      total += stat.size;
    }

    return total;
  } catch {
    return 0;
  }
}

async function getAudioCacheStats() {
  const audioDirectory = getAudioCacheDirectory();

  try {
    const entries = await fsp.readdir(audioDirectory, { withFileTypes: true });
    let totalSize = 0;
    let totalCount = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.bin')) {
        continue;
      }

      const stat = await fsp.stat(path.join(audioDirectory, entry.name));
      totalSize += stat.size;
      totalCount += 1;
    }

    return {
      size: totalSize,
      count: totalCount,
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
    await fsp.rm(getAudioCacheDirectory(), { recursive: true, force: true });
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

const net = require('net');
let assignedPort = 30000; // default fallback
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

  const nextPublicKey = await getXeapiPublicKey(currentPublicKey, global.deviceId);
  fs.writeFileSync(xeapiPublicKeyPath, JSON.stringify(nextPublicKey), 'utf-8');

  const anonymousRegistration = await register_anonimous();
  const anonymousCookie = anonymousRegistration?.body?.cookie;
  if (typeof anonymousCookie === 'string' && anonymousCookie.trim()) {
    const cookieObject = cookieToJson(anonymousCookie);
    if (typeof cookieObject.MUSIC_A === 'string') {
      fs.writeFileSync(tokenPath, cookieObject.MUSIC_A, 'utf-8');
    }
  }
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
    updateNeteaseApiStatus({ status: 'error', port: null, error: serializeError(e) });
    console.error('Failed to start Netease API', e);
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

function createRemoteControlWindow() {
  if (remoteControlWindow && !remoteControlWindow.isDestroyed()) {
    remoteControlWindow.setTitle(REMOTE_CONTROL_WINDOW_TITLE);
    applyRemoteControlAlwaysOnTop(remoteControlWindow);
    applyRemoteControlSkipTaskbar(remoteControlWindow);
    remoteControlWindow.show();
    remoteControlWindow.focus();
    broadcastPlaybackSyncBridgeStatus();
    return remoteControlWindow;
  }

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
  });

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
  const { bounds: storedBounds, isMaximized } = getStoredWindowState();
  const windowBounds = ensureWindowBoundsVisible(storedBounds);
  const useTransparentWindow = isTransparentPlayerBackgroundEnabled();
  const enableNativeBlur = store.get('enable_player_page_native_blur') === true;
  const win = new BrowserWindow({
    ...windowBounds,
    minWidth: 350,
    minHeight: 100,
    frame: false,
    transparent: useTransparentWindow,
    hasShadow: !useTransparentWindow,
    thickFrame: process.platform === 'win32' ? !useTransparentWindow : undefined,
    backgroundColor: (useTransparentWindow || enableNativeBlur) ? '#00000000' : '#09090b',
    vibrancy: (!useTransparentWindow && enableNativeBlur) && process.platform === 'darwin' ? 'fullscreen-ui' : undefined,
    backgroundMaterial: (!useTransparentWindow && enableNativeBlur) && process.platform === 'win32' ? 'acrylic' : undefined,
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    skipTaskbar: mainWindowSkipTaskbarEnabled,
    alwaysOnTop: mainWindowAlwaysOnTop,
    show: showImmediately,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Disable for local app
      backgroundThrottling: false
    }
  });

  loadAppEntry(win);
  if (isElectronDevRuntime()) {
    win.webContents.openDevTools();
  }

  if (isMaximized) {
    win.maximize();
  }

  mainWindow = win;
  ensureTray();
  setMainWindowSkipTaskbarEnabled(mainWindowSkipTaskbarEnabled);
  applyMainWindowMouseIgnoreState();
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

  if (!mainWindow || mainWindow.isDestroyed()) {
    const createdWindow = createWindow();
    focusMainWindow();
    return createdWindow;
  }

  const previousWindow = mainWindow;
  saveWindowState(previousWindow);
  mainWindow = null;

  const nextWindow = createWindow({ showImmediately: false });
  nextWindow.once('ready-to-show', () => {
    nextWindow.show();
    if (!previousWindow.isDestroyed()) {
      previousWindow.destroy();
    }
    focusMainWindow();
  });

  return nextWindow;
}

async function setMainWindowTransparentMode(enabled, handoff = null) {
  const nextEnabled = Boolean(enabled);
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
  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }

  setupFileSystemAccessPermissionHandlers();
  setupCorsBypassHandlers();

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
  await startApi();
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
  ensureTray();
  createWindow();
  focusMainWindow();
  scheduleStartupUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      focusMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  clearPendingWindowPlaybackHandoffRequests();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  clearPendingWindowPlaybackHandoffRequests();
  void discordPresence.destroy();
});

// Settings Management IPC
ipcMain.handle('window-set-native-theme', (event, themeSource) => {
  nativeTheme.themeSource = themeSource;
});

ipcMain.handle('get-settings', () => {
  return getPublicSettings();
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
  if (
    key === MINIMIZE_TO_TRAY_SETTING_KEY ||
    key === HIDE_TASKBAR_ICON_SETTING_KEY ||
    key === REMOTE_CONTROL_ALWAYS_ON_TOP_SETTING_KEY ||
    key === REMOTE_CONTROL_SKIP_TASKBAR_SETTING_KEY ||
    key === TRANSPARENT_PLAYER_BACKGROUND_SETTING_KEY ||
    key === DISCORD_RICH_PRESENCE_ENABLED_SETTING_KEY
  ) {
    nextValue = Boolean(value);
  }

  store.set(key, nextValue);

  if (key === 'enable_player_page_native_blur') {
    if (!isTransparentPlayerBackgroundEnabled()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const enableNativeBlur = Boolean(nextValue);
        mainWindow.setBackgroundColor(enableNativeBlur ? '#00000000' : '#09090b');
        if (process.platform === 'darwin') {
          mainWindow.setVibrancy(enableNativeBlur ? 'fullscreen-ui' : null);
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

  updater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle('get-audio-cache', async (event, cacheKey) => {
  return readAudioCacheEntry(cacheKey);
});

ipcMain.handle('has-audio-cache', async (event, cacheKey) => {
  return hasAudioCacheEntry(cacheKey);
});

ipcMain.handle('save-audio-cache', async (event, cacheKey, data, mimeType) => {
  await writeAudioCacheEntry(cacheKey, data, mimeType);
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

// Retrieve dynamic port of local Netease API Server
ipcMain.handle('get-netease-port', () => {
  return assignedPort;
});

ipcMain.handle('get-netease-api-status', () => {
  return neteaseApiStatus;
});

ipcMain.handle('window-minimize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
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

  const nextFullscreen = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextFullscreen);
  return nextFullscreen;
});

ipcMain.handle('window-close', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.close();
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

    mainWindow.setContentSize(exportSize.width, exportSize.height, true);
    mainWindow.center();
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

  mainWindow.setContentSize(exportSize.width, exportSize.height, true);
  mainWindow.center();
  mainWindow.focus();
  return true;
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
      const apiKey = store.get('OPENAI_API_KEY');
      const apiUrl = normalizeOpenAIChatCompletionsUrl(store.get('OPENAI_API_URL'));
      const model = resolveOpenAICompatibleModel(apiUrl, store.get('OPENAI_API_MODEL'));
      const openAICompatibleProvider = detectOpenAICompatibleProvider(apiUrl, model);
      const systemPrompt = buildThemeSystemPrompt(true);
      const sourcePrompt = buildThemeSourcePrompt(snippet, isPureMusic, songTitle);

      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured in settings");
      }

      const response = await customFetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildOpenAICompatibleRequestBody(model, openAICompatibleProvider, systemPrompt, sourcePrompt)),
      });

      if (!response.ok) {
        throw new Error(await formatOpenAICompatibleError(response));
      }

      const data = await response.json();
      const content = extractResponseContentText(data.choices[0]?.message);
      if (!content) throw new Error("Failed to generate theme JSON");

      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
      }
      dualTheme = sanitizeGeneratedDualTheme(JSON.parse(jsonStr));

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
