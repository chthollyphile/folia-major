const { app, BrowserWindow, ipcMain, session, screen, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store').default || require('electron-store');
const crypto = require('crypto');
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

const store = new Store();
let mainWindow = null;
const DEFAULT_WINDOW_BOUNDS = {
  width: 1200,
  height: 800,
};
const CACHE_DIRECTORY_SETTING_KEY = 'CACHE_DIRECTORY';

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

function saveWindowState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const isMaximized = win.isMaximized();
  store.set('WINDOW_IS_MAXIMIZED', isMaximized);

  if (isMaximized) {
    return;
  }

  store.set('WINDOW_BOUNDS', win.getBounds());
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

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
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

function isAllowedMainWindowPermission(permission) {
  return isFileSystemPermission(permission) || isFontAccessPermission(permission) || permission === 'unknown';
}

function isTrustedMainWindowContents(webContents) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    webContents &&
    webContents.id === mainWindow.webContents.id
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
    const allowedPermission = isAllowedMainWindowPermission(permission);

    if (!trustedMainWindow || !allowedPermission) {
      return false;
    }

    return true;
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trustedMainWindow = isTrustedMainWindowRequest(webContents, details?.requestingUrl, details);
    const allowedPermission = isAllowedMainWindowPermission(permission);

    if (!trustedMainWindow || !allowedPermission) {
      return callback(false);
    }

    callback(true);
  });
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

function getGeminiResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      light: {
        type: 'OBJECT',
        description: 'Theme optimized for light/daylight mode',
        properties: {
          name: { type: 'STRING', description: 'A creative name for this light theme' },
          backgroundColor: { type: 'STRING', description: 'Hex code for light background (whites, creams, pastels)' },
          primaryColor: { type: 'STRING', description: 'Hex code for main text (dark color for contrast)' },
          accentColor: { type: 'STRING', description: 'Hex code for highlighted text/effects' },
          secondaryColor: { type: 'STRING', description: 'Hex code for secondary elements (must contrast with light bg)' },
          wordColors: {
            type: 'ARRAY',
            description: 'List of exact emotional words or phrases from the source text and their specific colors',
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
          name: { type: 'STRING', description: 'A creative name for this dark theme' },
          backgroundColor: { type: 'STRING', description: 'Hex code for dark background (deep colors)' },
          primaryColor: { type: 'STRING', description: 'Hex code for main text (light color for contrast)' },
          accentColor: { type: 'STRING', description: 'Hex code for highlighted text/effects' },
          secondaryColor: { type: 'STRING', description: 'Hex code for secondary elements (must contrast with dark bg)' },
          wordColors: {
            type: 'ARRAY',
            description: 'List of exact emotional words or phrases from the source text and their specific colors',
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

async function generateGeminiTheme({ apiKey, promptText, customFetch }) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
  const response = await customFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: promptText }
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

// Provide Netease API unblock parameter as requested
process.env.ENABLE_GENERAL_UNBLOCK = 'false';

// Issue: Netease API module reads 'anonymous_token' synchronously from tmp dir upon require.
// If not present, Electron crashes with ENOENT. We pre-create it safely.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
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

const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api/server');

const net = require('net');
let assignedPort = 30000; // default fallback

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

async function startApi() {
  try {
     const freePort = await getFreePort();
     await serveNcmApi({ port: freePort });
     assignedPort = freePort;
     console.log('Netease API started on port', assignedPort);
  } catch (e) {
     console.error('Failed to start Netease API', e);
  }
}

function createWindow() {
  const { bounds: storedBounds, isMaximized } = getStoredWindowState();
  const windowBounds = ensureWindowBoundsVisible(storedBounds);
  const win = new BrowserWindow({
    ...windowBounds,
    minWidth: 350,
    minHeight: 100,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true // Disable for local app
    }
  });

  // Check custom env var for dev
  if (process.env.ELECTRON_DEV === 'true' || process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (isMaximized) {
    win.maximize();
  }

  mainWindow = win;
  win.on('resize', () => {
    saveWindowState(win);
  });
  win.on('move', () => {
    saveWindowState(win);
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
    }
  });

  return win;
}

app.whenReady().then(async () => {
  setupFileSystemAccessPermissionHandlers();
  await startApi();
  createWindow();
  focusMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      focusMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Settings Management IPC
ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('save-settings', (event, key, value) => {
  store.set(key, value);
  return store.store;
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

// Retrieve dynamic port of local Netease API Server
ipcMain.handle('get-netease-port', () => {
  return assignedPort;
});

ipcMain.handle('window-minimize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.minimize();
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

ipcMain.handle('debug-get-rendered-fonts', async (event, selector) => {
  if (!isTrustedMainWindowContents(event.sender)) {
    throw new Error('Untrusted renderer attempted to read rendered font data.');
  }

  return getRenderedFontReport(selector);
});

// Integrate AI logic locally into Electron
ipcMain.handle('generate-theme', async (event, lyricsText, options = {}) => {
  try {
    const { isPureMusic = false, songTitle } = options;
    const provider = store.get('AI_PROVIDER') || 'gemini';
    const useSystemProxy = store.get('USE_SYSTEM_PROXY_FOR_AI') || false;
    const customFetch = (url, options) => fetchWithOptionalSystemProxy(url, options, useSystemProxy);
    const snippet = lyricsText.slice(0, 2000);

    const promptText = `Analyze the mood of the provided song source text and generate TWO visual theme configurations for a music player - one for LIGHT mode and one for DARK mode.\n\n` +
      `DUAL THEME REQUIREMENTS:\n` +
      `1. Generate TWO complete themes: one optimized for LIGHT/DAYLIGHT mode, one for DARK/MIDNIGHT mode.\n` +
      `2. Both themes should capture the SAME emotional essence of the source text, but with appropriate color palettes for their respective modes.\n` +
      `3. The theme names should reflect both the mood AND the mode.\n\n` +
      `SOURCE MODE:\n` +
      `1. If 'Pure instrumental' is yes, the source text below is the song title of a pure instrumental track, not lyrics.\n` +
      `2. If 'Pure instrumental' is no, the source text below is a lyrics snippet.\n` +
      `3. Base your mood inference only on the provided source text.\n\n` +
      `LIGHT THEME RULES:\n- Use LIGHT backgrounds.\n- Ensure text/icons are dark enough for contrast.\n- 'accentColor' must be visible.\n\n` +
      `DARK THEME RULES:\n- Use DARK backgrounds.\n- Ensure text/icons are light enough for contrast.\n\n` +
      `SHARED RULES:\n` +
      `1. 'secondaryColor': MUST have sufficient contrast against 'backgroundColor'.\n` +
      `2. 'wordColors' and 'lyricsIcons' should be the SAME for both themes (they represent the source text's meaning).\n\n` +
      `IMPORTANT for 'wordColors':\n` +
      `1. Identify 5-10 key emotional words or phrases from the source text.\n` +
      `2. If the source text is a very short pure-instrumental title, you may return fewer entries.\n` +
      `3. Assign a specific color to each word.\n` +
      `4. CRITICAL: The 'word' field MUST match the EXACT text in the source snippet (case-insensitive). If the pure-instrumental title is very short, using the exact full title as a phrase is allowed.\n\n` +
      `IMPORTANT for 'lyricsIcons':\n` +
      `1. Identify 3-5 visual concepts/objects mentioned in or strongly implied by the source text.\n` +
      `2. Return them as valid Lucide React icon names (PascalCase).\n\n` +
      `Pure instrumental: ${isPureMusic ? 'yes' : 'no'}\n` +
      `${isPureMusic && songTitle ? `Song title: ${songTitle}\n` : ''}` +
      `Source snippet:\n${snippet}`;

    let dualTheme = null;

    if (provider === 'openai') {
        const apiKey = store.get('OPENAI_API_KEY');
        const apiUrl = store.get('OPENAI_API_URL') || "https://api.openai.com/v1/chat/completions";
        
        if (!apiKey) {
           throw new Error("OPENAI_API_KEY is not configured in settings");
        }

        const response = await customFetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "You are a helpful assistant that generates JSON themes for music players." },
                    { role: "user", content: promptText + "\n\nResponse MUST be exactly raw JSON matching { light: {...}, dark: {...} } structure, with no markdown wrappers." }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" }
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        if (!content) throw new Error("Failed to generate theme JSON");
        
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
        }
        dualTheme = JSON.parse(jsonStr);

        dualTheme.light.provider = 'OpenAI Compatible (Local)';
        dualTheme.dark.provider = 'OpenAI Compatible (Local)';

    } else {
        const apiKey = store.get('GEMINI_API_KEY');
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not configured in settings");
        }
        dualTheme = await generateGeminiTheme({
            apiKey,
            promptText,
            customFetch
        });

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
