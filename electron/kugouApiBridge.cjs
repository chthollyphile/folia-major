const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// electron/kugouApiBridge.cjs

const SESSION_KEY = 'KUGOU_API_SESSION_V1';
const AUTH_COOKIE_KEYS = new Set(['token', 'userid', 'user_id', 'dfid']);
const DIAGNOSTIC_OPERATIONS = new Set([
  'login_qr_key', 'login_qr_create', 'login_qr_check', 'user_detail', 'user_playlist', 'logout',
]);
const OPERATION_MODULES = {
  register_dev: ['register_dev'],
  login_qr_key: ['login_qr_key'],
  login_qr_create: ['login_qr_create'],
  login_qr_check: ['login_qr_check'],
  logout: [],
  user_detail: ['user_detail'],
  user_playlist: ['user_playlist'],
  user_cloud: ['user_cloud'],
  user_cloud_url: ['user_cloud_url'],
  search: ['search'],
  audio: ['audio'],
  song_url: ['song_url'],
  search_lyric: ['search_lyric'],
  lyric: ['lyric'],
  playlist_track_all: ['playlist_track_all', 'playlist_track_all_new'],
  album_detail: ['album_detail'],
  album_songs: ['album_songs'],
  artist_detail: ['artist_detail'],
  artist_albums: ['artist_albums'],
  artist_audios: ['artist_audios'],
  everyday_recommend: ['everyday_recommend'],
  everyday_history: ['everyday_history'],
  personal_fm: ['personal_fm'],
  playlist_add: ['playlist_add'],
  playlist_del: ['playlist_del'],
  playlist_tracks_add: ['playlist_tracks_add'],
  playlist_tracks_del: ['playlist_tracks_del'],
};

const randomUpperHex = (bytes) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

// Builds the stable lite-client identity expected by KuGouMusicApi without starting its HTTP server.
function createDeviceCookies() {
  const guid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const digest = crypto.createHash('md5').update(guid).digest('hex');
  const mac = Array.from(crypto.randomBytes(6)).map(value => value.toString(16).padStart(2, '0')).join(':').toUpperCase();
  return {
    KUGOU_API_PLATFORM: 'lite',
    KUGOU_API_GUID: guid,
    KUGOU_API_MID: BigInt(`0x${digest}`).toString(10),
    KUGOU_API_DEV: randomUpperHex(5),
    KUGOU_API_MAC: mac,
    KUGOU_API_WEBGL: BigInt(`0x${randomUpperHex(8)}`).toString(10),
  };
}

function parseCookieEntry(entry) {
  const firstPart = String(entry || '').split(';', 1)[0];
  const separator = firstPart.indexOf('=');
  if (separator <= 0) return null;
  return [firstPart.slice(0, separator).trim(), firstPart.slice(separator + 1).trim()];
}

function sanitizeBody(value, hiddenKeys = new Set(['token', 'dfid', 'cookie'])) {
  if (Array.isArray(value)) return value.map(child => sanitizeBody(child, hiddenKeys));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !hiddenKeys.has(key.toLowerCase()))
    .map(([key, child]) => [key, sanitizeBody(child, hiddenKeys)]));
}

function logDiagnostic(logger, operation, stage, details = {}) {
  if (!DIAGNOSTIC_OPERATIONS.has(operation)) return;
  logger.info(`[KuGouApi] ${operation}:${stage}`, details);
}

const errorSummary = (error) => ({
  name: error instanceof Error ? error.name : 'Error',
  message: error instanceof Error ? error.message : String(error),
});

const redactLogValue = (value) => {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => (
      AUTH_COOKIE_KEYS.has(key.toLowerCase()) || key.toLowerCase() === 'cookie'
        ? [key, '[REDACTED]']
        : [key, redactLogValue(child)]
    )));
  }
  if (typeof value === 'string') {
    return value.replace(/(token|userid|user_id|dfid|cookie)=([^&\s;]+)/gi, '$1=[REDACTED]');
  }
  return value;
};

// Creates a compact JSON-lines logger for packaged builds while retaining terminal output in development.
function createKugouFileLogger(filePath, consoleLogger = console) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const write = (level, message, details) => {
    const safeDetails = redactLogValue(details);
    try {
      const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        details: safeDetails,
      });
      fs.appendFileSync(filePath, `${line}\n`, 'utf8');
    } catch (error) {
      consoleLogger.warn('[KuGouApi] log-file:error', errorSummary(error));
    }
    consoleLogger[level]?.(message, safeDetails);
  };
  return {
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
  };
}

function createKugouApiBridge({ store, apiLoader = () => require('kugoumusicapi'), logger = console }) {
  let api = null;
  let loadError = null;
  let registered = false;
  const stored = store.get(SESSION_KEY);
  let cookies = stored && typeof stored === 'object' ? { ...stored } : createDeviceCookies();

  const persist = () => store.set(SESSION_KEY, cookies);
  persist();

  const loadApi = () => {
    if (api) return api;
    if (loadError) throw loadError;
    try {
      process.env.platform = 'lite';
      api = apiLoader();
      return api;
    } catch (error) {
      loadError = error instanceof Error ? error : new Error(String(error));
      throw loadError;
    }
  };

  const mergeResponseSession = (result) => {
    const nextCookies = Array.isArray(result?.cookie) ? result.cookie : [];
    nextCookies.forEach(entry => {
      const parsed = parseCookieEntry(entry);
      if (parsed) cookies[parsed[0]] = parsed[1];
    });
    const body = result?.body ?? result;
    const data = body?.data ?? body;
    if (data?.token) cookies.token = String(data.token);
    if (data?.userid ?? data?.user_id) cookies.userid = String(data.userid ?? data.user_id);
    if (data?.dfid) cookies.dfid = String(data.dfid);
    persist();
    return body;
  };

  const invokeModule = async (operation, params = {}) => {
    const loaded = loadApi();
    const candidates = OPERATION_MODULES[operation];
    if (!candidates) throw new Error(`Unsupported KuGou operation: ${operation}`);
    const moduleName = candidates.find(name => typeof loaded[name] === 'function');
    if (!moduleName) throw new Error(`KuGouMusicApi module is unavailable: ${operation}`);
    const userId = cookies.userid || cookies.user_id;
    const result = await loaded[moduleName]({
      ...params,
      ...(userId ? { userid: userId, uid: userId } : {}),
      cookie: { ...cookies },
    });
    return mergeResponseSession(result);
  };

  const ensureRegistered = async () => {
    if (registered || cookies.dfid) return;
    registered = true;
    try {
      await invokeModule('register_dev');
    } catch (error) {
      registered = false;
      logger.warn('[KuGouApi] register_dev:error', errorSummary(error));
    }
  };

  return {
    getStatus() {
      try {
        loadApi();
        return { available: true, error: null };
      } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async request(operation, params) {
      if (!OPERATION_MODULES[operation]) throw new Error(`Unsupported KuGou operation: ${operation}`);
      logDiagnostic(logger, operation, 'start', {
        parameterKeys: Object.keys(params || {}),
        hasToken: Boolean(cookies.token),
        hasUserId: Boolean(cookies.userid || cookies.user_id),
        hasDfid: Boolean(cookies.dfid),
      });
      if (operation === 'logout') {
        cookies = Object.fromEntries(Object.entries(cookies).filter(([key]) => !AUTH_COOKIE_KEYS.has(key.toLowerCase())));
        persist();
        logDiagnostic(logger, operation, 'success', { credentialsCleared: true });
        return { code: 200 };
      }
      try {
        if (operation !== 'register_dev') await ensureRegistered();
        const body = await invokeModule(operation, params);
        const responseBody = operation === 'user_detail' && body?.data && (cookies.userid || cookies.user_id)
          ? { ...body, data: { ...body.data, userid: String(cookies.userid || cookies.user_id) } }
          : body;
        const hiddenKeys = operation === 'login_qr_check'
          ? new Set(['token', 'dfid', 'cookie', 'userid', 'user_id'])
          : undefined;
        const sanitized = sanitizeBody(responseBody, hiddenKeys);
        const dataKeys = sanitized?.data && typeof sanitized.data === 'object' ? Object.keys(sanitized.data) : [];
        logDiagnostic(logger, operation, 'success', {
          status: sanitized?.status ?? sanitized?.code ?? sanitized?.data?.status,
          dataKeys: dataKeys.slice(0, 20),
          dataKeyCount: dataKeys.length,
          hasToken: Boolean(cookies.token),
          hasUserId: Boolean(cookies.userid || cookies.user_id),
        });
        return sanitized;
      } catch (error) {
        logDiagnostic(logger, operation, 'error', errorSummary(error));
        throw error;
      }
    },
  };
}

module.exports = { createKugouApiBridge, createKugouFileLogger, OPERATION_MODULES };
