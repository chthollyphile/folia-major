const crypto = require('crypto');

// electron/kugouApiBridge.cjs

const SESSION_KEY = 'KUGOU_API_SESSION_V1';
const AUTH_COOKIE_KEYS = new Set(['token', 'userid', 'user_id', 'dfid']);
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
  krm_audio: ['krm_audio'],
  song_url: ['song_url'],
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

const isDeviceVerificationRequired = (body) => {
  const errorCode = Number(body?.errcode ?? body?.error_code);
  const message = String(body?.error ?? body?.error_msg ?? body?.msg ?? '');
  return errorCode === 20028 || message.includes('本次请求需要验证');
};

function createKugouApiBridge({ store, apiLoader = () => require('kugoumusicapi') }) {
  let api = null;
  let loadError = null;
  let registrationPromise = null;
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

  const ensureRegistered = async (force = false) => {
    if (registrationPromise) return registrationPromise;
    if (!force && cookies.dfid) return;

    if (force) {
      delete cookies.dfid;
      persist();
    }

    registrationPromise = (async () => {
      try {
        await invokeModule('register_dev');
        if (!cookies.dfid) throw new Error('KuGou device registration did not return a dfid');
      } finally {
        registrationPromise = null;
      }
    })();
    return registrationPromise;
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
      if (operation === 'logout') {
        cookies = Object.fromEntries(Object.entries(cookies).filter(([key]) => !AUTH_COOKIE_KEYS.has(key.toLowerCase())));
        persist();
        return { code: 200 };
      }
      if (operation !== 'register_dev') await ensureRegistered(false);
      let body = await invokeModule(operation, params);
      if (operation !== 'register_dev' && isDeviceVerificationRequired(body)) {
        await ensureRegistered(true);
        body = await invokeModule(operation, params);
      }
      return operation === 'user_detail' && body?.data && (cookies.userid || cookies.user_id)
        ? { ...body, data: { ...body.data, userid: String(cookies.userid || cookies.user_id) } }
        : body;
    },
  };
}

module.exports = { createKugouApiBridge, OPERATION_MODULES };
