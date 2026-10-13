const crypto = require('crypto');

// electron/kugouApiBridge.cjs

const LEGACY_SESSION_KEY = 'KUGOU_API_SESSION_V1';
const SESSION_KEY = 'KUGOU_API_SESSION_V2';
const SESSION_ENVELOPE_VERSION = 2;
const AUTH_COOKIE_KEYS = new Set(['token', 'userid', 'user_id', 'dfid']);
const OPERATION_MODULES = {
  register_dev: ['register_dev'],
  login_qr_key: ['login_qr_key'],
  login_qr_create: ['login_qr_create'],
  login_qr_check: ['login_qr_check'],
  logout: [],
  user_detail: ['user_detail'],
  user_vip_detail: ['user_vip_detail'],
  youth_union_vip: ['youth_union_vip'],
  youth_day_vip: ['youth_day_vip'],
  youth_day_vip_upgrade: ['youth_day_vip_upgrade'],
  user_playlist: ['user_playlist'],
  user_cloud: ['user_cloud'],
  user_cloud_url: ['user_cloud_url'],
  search: ['search'],
  search_suggest: ['search_suggest'],
  top_playlist: ['top_playlist'],
  comment_music: ['comment_music'],
  audio: ['audio'],
  krm_audio: ['krm_audio'],
  song_url: ['song_url'],
  song_climax: ['song_climax'],
  search_lyric: ['search_lyric'],
  lyric: ['lyric'],
  playlist_track_all: ['playlist_track_all', 'playlist_track_all_new'],
  playlist_detail: ['playlist_detail'],
  album_detail: ['album_detail'],
  album_songs: ['album_songs'],
  artist_detail: ['artist_detail'],
  artist_albums: ['artist_albums'],
  artist_audios: ['artist_audios'],
  everyday_recommend: ['everyday_recommend'],
  everyday_history: ['everyday_history'],
  personal_fm: ['personal_fm'],
  top_card_youth: ['top_card_youth'],
  playlist_add: ['playlist_add'],
  playlist_del: ['playlist_del'],
  playlist_tracks_add: ['playlist_tracks_add'],
  playlist_tracks_del: ['playlist_tracks_del'],
};

const randomUpperHex = (bytes) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Electron may expose Linux's `basic_text` password backend as available even though it only
 * obfuscates data. Refusing it keeps KuGou account tokens out of Folia's plaintext config file.
 */
function assertEncryptionAvailable(safeStorage, platform) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new Error('Electron safeStorage is unavailable');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is unavailable');
  }
  const backend = platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : null;
  if (backend === 'basic_text') {
    throw new Error('Electron safeStorage selected the unencrypted basic_text backend');
  }
}

/**
 * Stores one encrypted cookie map. Failures deliberately degrade to the bridge's in-memory copy:
 * login keeps working for the current run, but no credential is written without OS encryption.
 */
function createSessionPersistence({ store, safeStorage, platform, warn }) {
  const remove = key => {
    if (typeof store.delete === 'function') store.delete(key);
    else store.set(key, undefined);
  };
  const report = (event, error) => warn(`[KuGouSession] ${event}`, {
    name: error instanceof Error ? error.name : 'Error',
  });

  return {
    load() {
      const encoded = store.get(SESSION_KEY);
      if (typeof encoded === 'string' && encoded.length > 0) {
        try {
          assertEncryptionAvailable(safeStorage, platform);
          const plaintext = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
          const envelope = JSON.parse(plaintext);
          if (
            !isRecord(envelope) ||
            envelope.version !== SESSION_ENVELOPE_VERSION ||
            !isRecord(envelope.cookies)
          ) {
            throw new Error('Stored KuGou session envelope is invalid');
          }
          return { ...envelope.cookies };
        } catch (error) {
          report('load-failed', error);
        }
      }

      const legacy = store.get(LEGACY_SESSION_KEY);
      if (!isRecord(legacy)) return null;
      // Load the old value into memory once, then remove the plaintext immediately. `save` below
      // either upgrades it to V2 or leaves it process-local when secure encryption is unavailable.
      remove(LEGACY_SESSION_KEY);
      return { ...legacy };
    },
    save(cookies) {
      try {
        assertEncryptionAvailable(safeStorage, platform);
        const plaintext = JSON.stringify({
          version: SESSION_ENVELOPE_VERSION,
          cookies,
        });
        const encrypted = safeStorage.encryptString(plaintext);
        store.set(SESSION_KEY, encrypted.toString('base64'));
        remove(LEGACY_SESSION_KEY);
      } catch (error) {
        report('save-failed', error);
      }
    },
  };
}

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

const isDeviceVerificationRequired = (body) => {
  const errorCode = Number(body?.errcode ?? body?.error_code);
  const message = String(body?.error ?? body?.error_msg ?? body?.msg ?? '');
  return errorCode === 20028 || message.includes('本次请求需要验证');
};

const MAX_ERROR_DETAIL_LENGTH = 160;

// Reduces an upstream failure detail to a short plain string; credentials never travel in it.
const describeErrorDetail = (value) => {
  let text = '';
  if (value instanceof Error) {
    text = value.code ? `${value.code}: ${value.message}` : value.message;
  } else if (typeof value === 'string' || typeof value === 'number') {
    text = String(value);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_ERROR_DETAIL_LENGTH ? `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}...` : text;
};

/**
 * KuGouMusicApi rejects with a bare `{ status, body, cookie, headers }` answer object, and Electron
 * IPC only carries an Error's message across the process boundary, so such a rejection reaches the
 * renderer as "[object Object]". This turns any failure into an Error whose message holds the
 * operation, HTTP-like status and upstream error_code in a `KuGouApi[k=v ...]` prefix the renderer
 * transport parses. The original answer is deliberately not attached: it carries cookies.
 */
function normalizeBridgeError(operation, error) {
  const answer = isRecord(error) && !(error instanceof Error) ? error : null;
  const body = isRecord(answer?.body) ? answer.body : null;
  const rawStatus = Number(answer?.status);
  const status = answer && Number.isFinite(rawStatus) ? rawStatus : undefined;
  const rawErrorCode = body?.error_code ?? body?.errcode;
  const errorCode = rawErrorCode === undefined || rawErrorCode === null || rawErrorCode === ''
    ? undefined
    : rawErrorCode;
  const detail = describeErrorDetail(
    answer
      ? (body?.msg ?? body?.error ?? body?.error_msg)
      : error,
  );

  const fields = [`operation=${operation}`];
  if (status !== undefined) fields.push(`status=${status}`);
  if (errorCode !== undefined) fields.push(`error_code=${errorCode}`);
  const normalized = new Error(`KuGouApi[${fields.join(' ')}]${detail ? `: ${detail}` : ''}`);
  normalized.name = 'KuGouApiError';
  normalized.operation = operation;
  normalized.status = status;
  normalized.errorCode = errorCode;
  return normalized;
}

function createKugouApiBridge({
  store,
  safeStorage,
  platform = process.platform,
  warn = console.warn,
  apiLoader = () => require('kugoumusicapi'),
}) {
  let api = null;
  let loadError = null;
  let registrationPromise = null;
  let cookies = null;
  const persistence = createSessionPersistence({ store, safeStorage, platform, warn });

  // The bridge is constructed before Electron's ready event, while safeStorage cannot be used yet.
  // Loading lazily on the first IPC call guarantees OS encryption is initialized before migration.
  const ensureCookies = () => {
    if (cookies) return cookies;
    cookies = persistence.load() ?? createDeviceCookies();
    persistence.save(cookies);
    return cookies;
  };
  const persist = () => {
    if (cookies) persistence.save(cookies);
  };

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
    const sessionCookies = ensureCookies();
    const nextCookies = Array.isArray(result?.cookie) ? result.cookie : [];
    nextCookies.forEach(entry => {
      const parsed = parseCookieEntry(entry);
      if (parsed) sessionCookies[parsed[0]] = parsed[1];
    });
    const body = result?.body ?? result;
    const data = body?.data ?? body;
    if (data?.token) sessionCookies.token = String(data.token);
    if (data?.userid ?? data?.user_id) sessionCookies.userid = String(data.userid ?? data.user_id);
    if (data?.dfid) sessionCookies.dfid = String(data.dfid);
    persist();
    return body;
  };

  // Login responses need their status and account id in the renderer, but not the reusable token
  // or device credential. Other operation bodies are left untouched to avoid changing provider
  // response contracts unrelated to authentication.
  const sanitizeRendererBody = (operation, body) => {
    if (!['login_qr_check', 'register_dev'].includes(operation) || !isRecord(body)) return body;
    const removeSecrets = value => {
      if (!isRecord(value)) return value;
      return Object.fromEntries(
        Object.entries(value).filter(([key]) => !['token', 'dfid', 'cookie'].includes(key.toLowerCase())),
      );
    };
    return {
      ...removeSecrets(body),
      ...(isRecord(body.data) ? { data: removeSecrets(body.data) } : {}),
    };
  };

  const invokeModule = async (operation, params = {}) => {
    const loaded = loadApi();
    const candidates = OPERATION_MODULES[operation];
    if (!candidates) throw new Error(`Unsupported KuGou operation: ${operation}`);
    const moduleName = candidates.find(name => typeof loaded[name] === 'function');
    if (!moduleName) throw new Error(`KuGouMusicApi module is unavailable: ${operation}`);
    const sessionCookies = ensureCookies();
    const userId = sessionCookies.userid || sessionCookies.user_id;
    const token = sessionCookies.token;
    const result = await loaded[moduleName]({
      ...params,
      ...(userId ? { userid: userId, uid: userId } : {}),
      // Renderer no longer stores the token in Electron mode. Supplying it here preserves modules
      // such as concept-VIP calls that historically received an explicit token parameter.
      ...(token ? { token } : {}),
      cookie: { ...sessionCookies },
    });
    return mergeResponseSession(result);
  };

  const ensureRegistered = async (force = false) => {
    const sessionCookies = ensureCookies();
    if (registrationPromise) return registrationPromise;
    if (!force && sessionCookies.dfid) return;

    if (force) {
      delete sessionCookies.dfid;
      persist();
    }

    registrationPromise = (async () => {
      try {
        await invokeModule('register_dev');
        if (!sessionCookies.dfid) throw new Error('KuGou device registration did not return a dfid');
      } finally {
        registrationPromise = null;
      }
    })();
    return registrationPromise;
  };

  const performRequest = async (operation, params) => {
    if (!OPERATION_MODULES[operation]) throw new Error(`Unsupported KuGou operation: ${operation}`);
    if (operation === 'logout') {
      const sessionCookies = ensureCookies();
      cookies = Object.fromEntries(Object.entries(sessionCookies).filter(([key]) => !AUTH_COOKIE_KEYS.has(key.toLowerCase())));
      persist();
      return { code: 200 };
    }
    if (operation !== 'register_dev') await ensureRegistered(false);
    let body = await invokeModule(operation, params);
    if (operation !== 'register_dev' && isDeviceVerificationRequired(body)) {
      await ensureRegistered(true);
      body = await invokeModule(operation, params);
    }
    const sessionCookies = ensureCookies();
    const responseBody = operation === 'user_detail' && body?.data && (sessionCookies.userid || sessionCookies.user_id)
      ? { ...body, data: { ...body.data, userid: String(sessionCookies.userid || sessionCookies.user_id) } }
      : body;
    return sanitizeRendererBody(operation, responseBody);
  };

  return {
    getStatus() {
      try {
        ensureCookies();
        loadApi();
        return {
          available: true,
          authenticated: Boolean(cookies?.token && (cookies.userid || cookies.user_id)),
          error: null,
        };
      } catch (error) {
        return {
          available: false,
          authenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async request(operation, params) {
      try {
        return await performRequest(operation, params);
      } catch (error) {
        throw normalizeBridgeError(operation, error);
      }
    },
  };
}

module.exports = {
  LEGACY_SESSION_KEY,
  SESSION_KEY,
  createKugouApiBridge,
  normalizeBridgeError,
  OPERATION_MODULES,
};
