const { BrowserWindow, app, components } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateDeveloperToken } = require('./credentials.cjs');
const { createDeveloperTokenSource } = require('./developerTokenSource.cjs');
const { developerTokenEndpoint } = require('./config.cjs');
const { createAuthorization } = require('./authorization.cjs');
const { createTokenUpdater } = require('./tokenUpdater.cjs');

// electron/appleMusic/host.cjs

const ORIGIN = 'http://127.0.0.1:10768';
const ASSETS = { '/': ['player.html', 'text/html'], '/player.js': ['player.js', 'text/javascript'], '/player.css': ['player.css', 'text/css'] };
const ERROR_CODES = new Set(['token-service-unavailable', 'developer-token-invalid', 'developer-token-expired', 'developer-token-required', 'developer-token-rejected',
  'credential-storage-unavailable', 'widevine-unavailable', 'musickit-load-failed', 'auth-required',
  'subscription-required', 'authorization-failed', 'authorization-incomplete', 'login-cancelled', 'login-timeout', 'player-port-unavailable', 'invalid-request', 'playback-failed',
  'lyrics-network-error', 'lyrics-service-unavailable']);

// Read paths stay on the public catalog and the user's own library, ratings, history and recommendations.
const API_PATH = /^\/v1\/(catalog\/[a-z]{2}\/|me\/(storefront|library(\/|\?)|ratings\/|recommendations|recent\/played\/|history\/heavy-rotation))/;
const API_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

function validateRequest(action, input = {}) {
  if (action === 'api') {
    if (typeof input.path !== 'string' || !API_PATH.test(input.path) || /[\x00-\x20'"\\]/.test(input.path) || input.path.includes('..')) throw new Error('invalid-request');
    const method = input.method === undefined ? 'GET' : input.method;
    if (!API_METHODS.has(method)) throw new Error('invalid-request');
    // Bodies only travel with writes, and only as plain JSON objects the player serializes itself.
    if (input.body !== undefined && (method === 'GET' || !input.body || typeof input.body !== 'object' || Array.isArray(input.body))) throw new Error('invalid-request');
  }
  if ((action === 'start' || action === 'queueNext') && (typeof input.id !== 'string' || !/^[\w.-]+$/.test(input.id))) throw new Error('invalid-request');
  if (action === 'start') {
    if (input.bitrate !== undefined && ![64, 256].includes(input.bitrate)) throw new Error('invalid-request');
    if (input.continueIfCurrent !== undefined && typeof input.continueIfCurrent !== 'boolean') throw new Error('invalid-request');
  }
  if (action === 'command') {
    if (!['play', 'pause', 'seek', 'volume'].includes(input.command)) throw new Error('invalid-request');
    if (['seek', 'volume'].includes(input.command) && (!Number.isFinite(input.value) || input.value < 0 || (input.command === 'volume' && input.value > 1))) throw new Error('invalid-request');
  }
  if (!['api', 'start', 'queueNext', 'command', 'snapshot', 'connect', 'logout'].includes(action)) throw new Error('invalid-request');
}

function createAppleMusicHost({ onDiagnostic = () => {}, getParentWindow = () => null }) {
  const resolveDeveloperToken = createDeveloperTokenSource({
    endpoint: process.env.FOLIA_APPLE_MUSIC_TOKEN_URL || developerTokenEndpoint,
    fallback: () => {
      const token = process.env.FOLIA_APPLE_MUSIC_DEVELOPER_TOKEN;
      if (!token) throw new Error('developer-token-required');
      return validateDeveloperToken(token);
    },
  });
  let player;
  let server;
  let preparing;
  let connecting;
  let closing = false;
  const invoke = (action, input = {}, userGesture = false) => {
    if (!player || player.isDestroyed() || player.webContents.getURL() !== `${ORIGIN}/`) throw new Error('musickit-load-failed');
    return player.webContents.executeJavaScript(`window.foliaMusic(${JSON.stringify(action)}, ${JSON.stringify(input)})`, userGesture);
  };
  const authorization = createAuthorization({ getParentWindow, invoke });
  const tokenUpdater = createTokenUpdater({ resolveToken: resolveDeveloperToken,
    configure: token => invoke('configure', { token, restorePlayback: true }) });
  async function prepare() {
    if (preparing) return preparing;
    preparing = (async () => {
      await resolveDeveloperToken();
      if (!components?.whenReady) throw new Error('widevine-unavailable');
      try { await components.whenReady(); } catch { throw new Error('widevine-unavailable'); }
      if (!server) {
        server = http.createServer(async (request, response) => {
          const asset = ASSETS[request.url];
          if (request.headers.host !== '127.0.0.1:10768' || request.method !== 'GET' || !asset) { response.writeHead(404).end(); return; }
          try {
            response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://js-cdn.music.apple.com 'wasm-unsafe-eval'; connect-src 'self' https:; media-src https: blob:; img-src https: data:; frame-src https://*.apple.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
            response.end(await fs.readFile(path.join(__dirname, asset[0])));
          } catch { response.end(); }
        });
        await new Promise((resolve, reject) => { server.once('error', () => reject(new Error('player-port-unavailable'))); server.listen(10768, '127.0.0.1', resolve); });
        server.unref();
      }
      player = new BrowserWindow({ show: false, width: 560, height: 480, title: 'Folia · Apple Music',
        webPreferences: { partition: 'persist:folia-apple-music', nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      authorization.attach(player.webContents);
      player.webContents.on('will-navigate', (event, url) => { if (url !== `${ORIGIN}/`) event.preventDefault(); });
      player.on('close', event => { if (!closing) { event.preventDefault(); player.hide(); } });
      player.on('closed', () => { authorization.dispose(); tokenUpdater.reset(); player = undefined; preparing = undefined; });
      await player.loadURL(`${ORIGIN}/`);
      await tokenUpdater.update();
    })().catch(error => {
      preparing = undefined;
      if (player && !player.isDestroyed()) player.destroy();
      if (server) { server.close(); server = undefined; }
      throw error;
    });
    return preparing;
  }
  // Await the SDK authorization result; window closure alone does not determine success.
  async function connect() {
    await prepare();
    await tokenUpdater.update();
    if ((await invoke('status')).authorized) return true;
    try { await authorization.authorize(); }
    catch (error) {
      const status = await invoke('status').catch(() => ({}));
      // Log only a small state snapshot, never SDK errors, tokens, or account data.
      console.info('apple-music.authorization', JSON.stringify({
        authorized: Boolean(status.authorized),
        authorizationStatus: Number.isInteger(status.authorizationStatus) ? status.authorizationStatus : null,
        sdkReason: status.lastAuthorizationError || null,
      }));
      if (!status.authorized) throw error;
    }
    if (!(await invoke('status')).authorized) throw new Error('authorization-incomplete');
    return true;
  }
  app.on('before-quit', () => { closing = true; authorization.dispose(); player?.destroy(); server?.close(); });
  return {
    isAvailable: () => Boolean(components?.whenReady && (process.env.FOLIA_APPLE_MUSIC_TOKEN_URL || developerTokenEndpoint || process.env.FOLIA_APPLE_MUSIC_DEVELOPER_TOKEN)),
    async request(action, input = {}) {
      try {
        validateRequest(action, input);
        let data;
        if (action === 'connect') {
          if (!connecting) connecting = connect().finally(() => { connecting = undefined; });
          data = await connecting;
        } else {
          await prepare();
          await tokenUpdater.update();
          data = await invoke(action, input);
        }
        return { ok: true, data };
      } catch (error) {
        onDiagnostic(error);
        // SDK exceptions can include request headers: only return known codes across the bridge.
        const code = [...ERROR_CODES].find(code => error.message?.includes(code)) || 'musickit-failed';
        return { ok: false, error: code };
      }
    },
  };
}
module.exports = { createAppleMusicHost, validateRequest };
