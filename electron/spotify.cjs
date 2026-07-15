const http = require('http');
const crypto = require('crypto');

// electron/spotify.cjs
// Owns Spotify PKCE authentication and Web API access in the trusted main process.

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_CALLBACK_PORT = 43827;
const SPOTIFY_CALLBACK_PATH = '/callback';
const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}${SPOTIFY_CALLBACK_PATH}`;
const SPOTIFY_SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];
const SPOTIFY_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const CLIENT_ID_SETTING_KEY = 'SPOTIFY_CLIENT_ID';
const TOKEN_RECORD_SETTING_KEY = 'SPOTIFY_TOKEN_RECORD';

const base64UrlEncode = (value) => Buffer.from(value)
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const buildCodeChallenge = (codeVerifier) => (
  base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest())
);

const normalizeClientId = (value) => (typeof value === 'string' ? value.trim() : '');

const isValidSpotifyClientId = (value) => /^[a-zA-Z0-9]{16,64}$/.test(normalizeClientId(value));

const readGrantedScopes = (tokenRecord) => (
  typeof tokenRecord?.scope === 'string'
    ? tokenRecord.scope.split(/\s+/).filter(Boolean)
    : []
);

// Converts the renderer's small command union into fixed Spotify Web API requests.
const buildSpotifyPlaybackControlRequest = (command) => {
  const action = command && typeof command === 'object' ? command.action : null;
  switch (action) {
    case 'resume':
      return { method: 'PUT', pathname: '/me/player/play' };
    case 'pause':
      return { method: 'PUT', pathname: '/me/player/pause' };
    case 'next':
      return { method: 'POST', pathname: '/me/player/next' };
    case 'previous':
      return { method: 'POST', pathname: '/me/player/previous' };
    case 'seek': {
      const positionMs = Math.floor(Number(command.positionMs));
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw new Error('Spotify seek position must be a non-negative number.');
      }
      return {
        method: 'PUT',
        pathname: `/me/player/seek?position_ms=${encodeURIComponent(positionMs)}`,
      };
    }
    case 'repeat': {
      const state = command.state;
      if (state !== 'off' && state !== 'context' && state !== 'track') {
        throw new Error('Spotify repeat state must be off, context, or track.');
      }
      return {
        method: 'PUT',
        pathname: `/me/player/repeat?state=${encodeURIComponent(state)}`,
      };
    }
    case 'shuffle': {
      if (typeof command.state !== 'boolean') {
        throw new Error('Spotify shuffle state must be true or false.');
      }
      return {
        method: 'PUT',
        pathname: `/me/player/shuffle?state=${command.state ? 'true' : 'false'}`,
      };
    }
    default:
      throw new Error('Unsupported Spotify playback command.');
  }
};

const normalizeSpotifyPlayback = (payload) => {
  if (!payload || typeof payload !== 'object' || !payload.item || typeof payload.item !== 'object') {
    return null;
  }

  const item = payload.item;
  const artists = Array.isArray(item.artists)
    ? item.artists.map((artist) => artist?.name).filter(Boolean)
    : [];
  const album = item.album && typeof item.album === 'object' ? item.album : null;
  const images = Array.isArray(album?.images) ? album.images : [];
  const coverUrl = images.find((image) => typeof image?.url === 'string')?.url || null;

  return {
    id: typeof item.id === 'string' && item.id ? item.id : (typeof item.uri === 'string' ? item.uri : null),
    uri: typeof item.uri === 'string' ? item.uri : null,
    type: typeof item.type === 'string' ? item.type : 'track',
    title: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Spotify',
    artist: artists.join(', ') || (typeof item.show?.name === 'string' ? item.show.name : 'Spotify'),
    album: typeof album?.name === 'string' ? album.name : '',
    coverUrl,
    durationMs: Number.isFinite(Number(item.duration_ms)) ? Math.max(0, Math.floor(Number(item.duration_ms))) : 0,
    progressMs: Number.isFinite(Number(payload.progress_ms)) ? Math.max(0, Math.floor(Number(payload.progress_ms))) : 0,
    isPlaying: payload.is_playing === true,
    sampledAtMs: Date.now(),
    device: payload.device && typeof payload.device === 'object'
      ? {
        id: typeof payload.device.id === 'string' ? payload.device.id : null,
        name: typeof payload.device.name === 'string' ? payload.device.name : '',
        type: typeof payload.device.type === 'string' ? payload.device.type : '',
        isRestricted: payload.device.is_restricted === true,
      }
      : null,
  };
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const htmlResponse = (title, message) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;background:#101113;color:#f5f5f5;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:34rem;padding:2rem;text-align:center}h1{font-size:1.5rem}p{opacity:.72;line-height:1.6}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;

function createSpotifyController({ privateStore, shell, safeStorage, getMainWindow }) {
  let authServer = null;
  let authTimeout = null;
  let pendingAuthorization = false;
  let lastError = null;

  const getClientId = () => normalizeClientId(privateStore.get(CLIENT_ID_SETTING_KEY));

  const readTokenRecord = () => {
    const stored = privateStore.get(TOKEN_RECORD_SETTING_KEY);
    if (typeof stored !== 'string' || !stored) {
      return null;
    }

    try {
      const json = stored.startsWith('encrypted:') && safeStorage?.isEncryptionAvailable?.()
        ? safeStorage.decryptString(Buffer.from(stored.slice('encrypted:'.length), 'base64'))
        : stored.startsWith('plain:')
          ? Buffer.from(stored.slice('plain:'.length), 'base64').toString('utf8')
          : '';
      const record = JSON.parse(json);
      return record && typeof record === 'object' ? record : null;
    } catch (error) {
      console.warn('[Spotify] Failed to read stored token record', error);
      return null;
    }
  };

  const writeTokenRecord = (record) => {
    const json = JSON.stringify(record);
    if (safeStorage?.isEncryptionAvailable?.()) {
      const encrypted = safeStorage.encryptString(json).toString('base64');
      privateStore.set(TOKEN_RECORD_SETTING_KEY, `encrypted:${encrypted}`);
      return;
    }

    privateStore.set(TOKEN_RECORD_SETTING_KEY, `plain:${Buffer.from(json, 'utf8').toString('base64')}`);
  };

  const clearTokenRecord = () => {
    privateStore.delete(TOKEN_RECORD_SETTING_KEY);
  };

  const buildStatus = () => {
    const tokenRecord = readTokenRecord();
    const clientId = getClientId();
    const authenticated = Boolean(tokenRecord?.refreshToken || (tokenRecord?.accessToken && tokenRecord?.expiresAt > Date.now()));
    const scopes = readGrantedScopes(tokenRecord);
    const controlsAuthorized = scopes.includes('user-modify-playback-state');
    return {
      configured: isValidSpotifyClientId(clientId),
      authenticated,
      controlsAuthorized,
      requiresReauthorization: authenticated && !controlsAuthorized,
      authorizationPending: pendingAuthorization,
      clientId,
      redirectUri: SPOTIFY_REDIRECT_URI,
      expiresAt: Number.isFinite(Number(tokenRecord?.expiresAt)) ? Number(tokenRecord.expiresAt) : null,
      scopes,
      error: lastError,
    };
  };

  const broadcastStatus = () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('spotify-status-changed', buildStatus());
    }
  };

  const stopAuthServer = () => {
    if (authTimeout) {
      clearTimeout(authTimeout);
      authTimeout = null;
    }
    if (authServer) {
      authServer.close();
      authServer = null;
    }
    pendingAuthorization = false;
  };

  const requestToken = async (params) => {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error_description || payload?.error || `Spotify token request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  };

  const persistTokenResponse = (payload, previousRecord = null) => {
    const expiresIn = Number(payload.expires_in);
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!accessToken) {
      throw new Error('Spotify did not return an access token.');
    }

    const nextRecord = {
      accessToken,
      refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token
        ? payload.refresh_token
        : previousRecord?.refreshToken || null,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? Math.max(1, expiresIn) : 3600) * 1000,
      scope: typeof payload.scope === 'string' ? payload.scope : previousRecord?.scope || SPOTIFY_SCOPES.join(' '),
      tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
    };
    writeTokenRecord(nextRecord);
    return nextRecord;
  };

  const refreshAccessToken = async () => {
    const clientId = getClientId();
    const current = readTokenRecord();
    if (!isValidSpotifyClientId(clientId) || !current?.refreshToken) {
      clearTokenRecord();
      throw new Error('Spotify authorization is required.');
    }

    const payload = await requestToken({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    });
    lastError = null;
    const nextRecord = persistTokenResponse(payload, current);
    broadcastStatus();
    return nextRecord.accessToken;
  };

  const getAccessToken = async ({ forceRefresh = false } = {}) => {
    const record = readTokenRecord();
    if (!forceRefresh && record?.accessToken && Number(record.expiresAt) - Date.now() > TOKEN_REFRESH_SKEW_MS) {
      return record.accessToken;
    }
    return refreshAccessToken();
  };

  const spotifyFetch = async (pathname, init = {}) => {
    const execute = async (forceRefresh) => {
      const accessToken = await getAccessToken({ forceRefresh });
      return fetch(`${SPOTIFY_API_BASE_URL}${pathname}`, {
        ...init,
        headers: {
          ...(init.headers || {}),
          Authorization: `Bearer ${accessToken}`,
        },
      });
    };

    let response = await execute(false);
    if (response.status === 401) {
      response = await execute(true);
    }
    if (response.status === 429) {
      const retryAfterSec = Number(response.headers.get('retry-after'));
      const error = new Error('Spotify rate limit reached.');
      error.retryAfterMs = Number.isFinite(retryAfterSec) ? Math.max(1000, retryAfterSec * 1000) : 5000;
      throw error;
    }
    return response;
  };

  const connect = async (rawClientId) => {
    const clientId = normalizeClientId(rawClientId);
    if (!isValidSpotifyClientId(clientId)) {
      throw new Error('Enter a valid Spotify Client ID.');
    }

    const previousClientId = getClientId();
    privateStore.set(CLIENT_ID_SETTING_KEY, clientId);
    if (previousClientId && previousClientId !== clientId) {
      clearTokenRecord();
    }

    stopAuthServer();
    lastError = null;
    const state = crypto.randomBytes(24).toString('base64url');
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = buildCodeChallenge(codeVerifier);

    authServer = http.createServer(async (req, res) => {
      const callbackUrl = new URL(req.url || '/', SPOTIFY_REDIRECT_URI);
      if (callbackUrl.pathname !== SPOTIFY_CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      try {
        if (callbackUrl.searchParams.get('state') !== state) {
          throw new Error('Spotify authorization state did not match.');
        }
        const callbackError = callbackUrl.searchParams.get('error');
        if (callbackError) {
          throw new Error(callbackError === 'access_denied' ? 'Spotify authorization was cancelled.' : callbackError);
        }
        const code = callbackUrl.searchParams.get('code');
        if (!code) {
          throw new Error('Spotify did not return an authorization code.');
        }

        const payload = await requestToken({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: SPOTIFY_REDIRECT_URI,
          code_verifier: codeVerifier,
        });
        persistTokenResponse(payload);
        lastError = null;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlResponse('Spotify connected', 'You can close this browser tab and return to Folia.'));
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlResponse('Spotify connection failed', lastError));
      } finally {
        stopAuthServer();
        broadcastStatus();
      }
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        authServer?.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        authServer?.removeListener('error', onError);
        resolve();
      };
      authServer.once('error', onError);
      authServer.once('listening', onListening);
      authServer.listen(SPOTIFY_CALLBACK_PORT, '127.0.0.1');
    }).catch((error) => {
      stopAuthServer();
      throw new Error(`Could not start the Spotify callback server on port ${SPOTIFY_CALLBACK_PORT}: ${error.message}`);
    });

    pendingAuthorization = true;
    authTimeout = setTimeout(() => {
      lastError = 'Spotify authorization timed out.';
      stopAuthServer();
      broadcastStatus();
    }, SPOTIFY_AUTH_TIMEOUT_MS);

    const authUrl = new URL(SPOTIFY_AUTHORIZE_URL);
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SPOTIFY_SCOPES.join(' '),
      redirect_uri: SPOTIFY_REDIRECT_URI,
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      show_dialog: 'true',
    }).toString();
    try {
      await shell.openExternal(authUrl.toString());
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      stopAuthServer();
      broadcastStatus();
      throw error;
    }
    broadcastStatus();
    return buildStatus();
  };

  const disconnect = () => {
    stopAuthServer();
    clearTokenRecord();
    lastError = null;
    broadcastStatus();
    return buildStatus();
  };

  const getPlayback = async () => {
    try {
      const response = await spotifyFetch('/me/player?additional_types=track,episode');
      if (response.status === 204) {
        lastError = null;
        return { playback: null, retryAfterMs: null };
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error?.message || `Spotify playback request failed (${response.status}).`;
        throw new Error(message);
      }
      lastError = null;
      return { playback: normalizeSpotifyPlayback(payload), retryAfterMs: null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/authorization is required/i.test(lastError)) {
        broadcastStatus();
      }
      return {
        playback: null,
        retryAfterMs: Number.isFinite(Number(error?.retryAfterMs)) ? Number(error.retryAfterMs) : null,
        error: lastError,
      };
    }
  };

  const controlPlayback = async (command) => {
    try {
      const tokenRecord = readTokenRecord();
      if (!readGrantedScopes(tokenRecord).includes('user-modify-playback-state')) {
        throw new Error('Reconnect Spotify in Integration settings to enable playback controls.');
      }

      const request = buildSpotifyPlaybackControlRequest(command);
      const response = await spotifyFetch(request.pathname, { method: request.method });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload?.error?.message || `Spotify playback control failed (${response.status}).`;
        throw new Error(message);
      }

      lastError = null;
      return { ok: true, retryAfterMs: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/authorization is required|reconnect spotify/i.test(message)) {
        broadcastStatus();
      }
      return {
        ok: false,
        retryAfterMs: Number.isFinite(Number(error?.retryAfterMs)) ? Number(error.retryAfterMs) : null,
        error: message,
      };
    }
  };

  return {
    buildStatus,
    connect,
    controlPlayback,
    disconnect,
    getPlayback,
    stop: stopAuthServer,
  };
}

module.exports = {
  SPOTIFY_REDIRECT_URI,
  buildCodeChallenge,
  buildSpotifyPlaybackControlRequest,
  createSpotifyController,
  isValidSpotifyClientId,
  normalizeSpotifyPlayback,
};
