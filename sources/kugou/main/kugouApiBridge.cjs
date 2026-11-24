const crypto = require('crypto');

// sources/kugou/main/kugouApiBridge.cjs
// The bridge between the KuGou source's client (folium.rpc `request`) and KuGouMusicApi, run in the main entry
// (main/index.ts). Moved from electron/kugou/ as it was; what the host handed it then, the main entry hands it now:
// `store` is api.legacy.store (the trusted table's KUGOU_API_SESSION_V2 / V1), `safeStorage` is api.seal in
// safeStorage's shape, `apiLoader` gives the package the main entry loaded from the deps archive.
//
// Whether this run can seal credentials: the host's electron/osEncryption.cjs check, which a source cannot import
// (Dedicatus D130). api.seal's `available()` already reads Linux's basic_text as unavailable; the backend check stays
// for a safeStorage that has it (the tests' stand-in).
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

const encryptionAvailable = (safeStorage, platform) => {
    try {
        assertEncryptionAvailable(safeStorage, platform);
        return true;
    } catch {
        return false;
    }
};

const LEGACY_SESSION_KEY = 'KUGOU_API_SESSION_V1';
const SESSION_KEY = 'KUGOU_API_SESSION_V2';
const SESSION_ENVELOPE_VERSION = 2;
// How long a renewal (login_token) is not asked again after it answered, with a VIP credential or without one: the
// credential lapses with the subscription (KuGou then answers the privileged endpoint with previews only), and a
// renewal may hand out a new token, which is not done more often than this. Each run renews once on first use too.
const VIP_CREDENTIAL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// How long after KuGou refused a renewal (status 0, an error_code) it is asked again.
const VIP_CREDENTIAL_REFUSED_RETRY_MS = 10 * 60 * 1000;
// How soon a renewal that got no answer (KuGou unreachable, or too slow) is tried again.
const VIP_CREDENTIAL_UNANSWERED_RETRY_MS = 60 * 1000;
// How long a renewal is waited for: a playback waits on it while the session has no VIP credential yet.
const VIP_CREDENTIAL_TIMEOUT_MS = 8 * 1000;
const AUTH_COOKIE_KEYS = new Set(['token', 'userid', 'user_id', 'dfid', 'vip_token', 'vip_type', 't1']);
// The cookies that say which account is signed in; only a confirmed sign-in (or a renewal of the same
// session) writes them. t1 is the renewal's own state of that account.
const ACCOUNT_COOKIE_KEYS = new Set(['token', 'userid', 'user_id', 'vip_token', 'vip_type', 't1']);
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
    user_listen: ['user_listen'],
    search: ['search'],
    audio: ['audio'],
    krm_audio: ['krm_audio'],
    song_url: ['song_url'],
    song_url_new: ['song_url_new'],
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
    const userIdOf = cookies => cookies?.userid || cookies?.user_id || null;
    // The account of the cookies that are on disk as far as this run knows (loaded, or last saved); null for none.
    let storedUserId = null;
    // What is stored was removed in this run for want of OS encryption: nothing can be written in its place until the
    // next start, so a save that fails again does not remove it again (each removal rewrites the whole store file).
    let removedUnsealed = false;
    // Removes both stored sessions after a save that failed. A store that cannot be written now either is told of and
    // left as it is: the save itself had already failed, and the request it came with goes on.
    const removeStored = () => {
        try {
            remove(SESSION_KEY);
            remove(LEGACY_SESSION_KEY);
            storedUserId = null;
            return true;
        } catch (error) {
            report('remove-failed', error);
            return false;
        }
    };

    return {
    // Answers the stored cookies (null for none), and whether a V2 session is stored that this run
    // could not load for want of OS encryption: the bridge leaves such a session for a run that has
    // it. One that does not load while encryption works (a keychain that refused it, damaged, an
    // envelope of another version) is nothing stored.
        load() {
            let unreadable = false;
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
                    storedUserId = userIdOf(envelope.cookies);
                    return { cookies: { ...envelope.cookies }, unreadable };
                } catch (error) {
                    report('load-failed', error);
                    unreadable = !encryptionAvailable(safeStorage, platform);
                }
            }

            const legacy = store.get(LEGACY_SESSION_KEY);
            if (!isRecord(legacy)) return { cookies: null, unreadable };
            // The old plaintext value stays until `save` below has written it as V2, which removes it:
            // removed sooner, a write that fails for a moment would lose the sign-in for good. A run that
            // cannot seal at all removes it here, also beside a V2 session it keeps: the value lives on
            // in memory for this run only, and no credential stays on disk unencrypted.
            if (!encryptionAvailable(safeStorage, platform)) remove(LEGACY_SESSION_KEY);
            else storedUserId = userIdOf(legacy);
            return { cookies: { ...legacy }, unreadable };
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
                storedUserId = userIdOf(cookies);
                remove(LEGACY_SESSION_KEY);
            } catch (error) {
                report('save-failed', error);
                // Where nothing can be sealed in this run, the cookies of this run live in memory only, and
                // they replace what is stored (a save is never asked for while a stored session is kept):
                // the V2 session of an earlier sign-in is removed, so that account cannot come back at a
                // later start. Where only the write failed (a file locked for a moment), what is stored
                // stays for the next save, unless it is another account's (a sign-in of another account
                // in this run): that one goes as well.
                if (!encryptionAvailable(safeStorage, platform)) {
                    if (!removedUnsealed) removedUnsealed = removeStored();
                } else if (storedUserId && userIdOf(cookies) !== storedUserId) {
                    removeStored();
                }
            }
        },
        // A sign-out: neither the V2 session nor the old plaintext one is left for a later start to
        // sign in with, also where nothing can be sealed in this run.
        clear() {
            remove(SESSION_KEY);
            remove(LEGACY_SESSION_KEY);
            storedUserId = null;
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
 * `unloaded`: KuGouMusicApi itself could not be loaded, written as `api=unloaded`, so the renderer can
 * tell the local service being down from a request that failed.
 * An error marked `sessionUnreadable` (a stored session this run cannot load, see `keepStored`) is
 * written as `session=unreadable`: the renderer answers it as unavailable, not as a signed-out account.
 */
function normalizeBridgeError(operation, error, unloaded = false) {
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
    if (unloaded) fields.push('api=unloaded');
    if (error instanceof Error && error.sessionUnreadable) fields.push('session=unreadable');
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
    apiLoader,
}) {
    let api = null;
    let loadError = null;
    let registrationPromise = null;
    let vipCredentialPromise = null;
    // Until when the renewal is not asked again for this token (ensureVipCredential): otherwise every playback of a
    // signed-in account would pay an extra login request.
    let vipCredentialChecked = { token: '', until: 0 };
    let cookies = null;
    let sessionGeneration = 0;
    // A stored session this run could not load is not written over: the cookies of this run stay in
    // memory until a sign-in of this run brings a token of its own (mergeResponseSession).
    let keepStored = false;
    const persistence = createSessionPersistence({ store, safeStorage, platform, warn });

    // The bridge is constructed before Electron's ready event, while safeStorage cannot be used yet.
    // Loading lazily on the first IPC call guarantees OS encryption is initialized before migration.
    const ensureCookies = () => {
        if (cookies) return cookies;
        const loaded = persistence.load();
        cookies = loaded.cookies ?? createDeviceCookies();
        keepStored = loaded.unreadable;
        if (keepStored) warn('[KuGouSession] The stored session could not be loaded; it is kept until a new sign-in replaces it');
        persist();
        return cookies;
    };
    const persist = () => {
        if (cookies && !keepStored) persistence.save(cookies);
    };

    const loadApi = () => {
        if (api) return api;
        if (loadError) throw loadError;
        try {
            if (typeof apiLoader !== 'function') throw new Error('KuGouMusicApi has no loader');
            api = apiLoader();
            return api;
        } catch (error) {
            loadError = error instanceof Error ? error : new Error(String(error));
            throw loadError;
        }
    };

    // Who is signed in changes only with a confirmed QR sign-in (status 4), and only as a whole pair:
    // other answers carry the userid of whoever owns what was read (a public playlist's creator),
    // which written into the session would pair another account's id with this account's token (#1101).
    // The one place the session's account is written (registered for Dedicatus D604): called only for a
    // confirmed QR sign-in, and it takes the token and the account id only as a whole pair.
    const adoptConfirmedSignIn = (sessionCookies, data, responseCookies) => {
        const token = data?.token || responseCookies.token;
        const userId = data?.userid ?? data?.user_id ?? responseCookies.userid ?? responseCookies.user_id;
        if (token && userId) {
            // The previous account's VIP credential and renewal state do not carry over.
            delete sessionCookies.vip_token;
            delete sessionCookies.vip_type;
            delete sessionCookies.t1;
            sessionCookies.token = String(token);
            sessionCookies.userid = String(userId);
            delete sessionCookies.user_id;
            const vipToken = data?.vip_token || responseCookies.vip_token;
            const vipType = data?.vip_type ?? responseCookies.vip_type;
            if (vipToken) sessionCookies.vip_token = String(vipToken);
            if (vipType != null && vipType !== '') sessionCookies.vip_type = String(vipType);
        } else {
            // Half of a pair is not taken: the other half would be the previous account's.
            warn('[KuGouSession] A confirmed sign-in came without both a token and an account id; the session is unchanged', {
                hasToken: Boolean(token),
                hasUserId: Boolean(userId),
            });
        }
    };

    // A sign-out keeps only the device cookies (registered for Dedicatus D604 with keys known only at run
    // time): every account and device credential in AUTH_COOKIE_KEYS goes.
    const dropAccountCookies = () => {
        const sessionCookies = ensureCookies();
        cookies = Object.fromEntries(Object.entries(sessionCookies).filter(([key]) => !AUTH_COOKIE_KEYS.has(key.toLowerCase())));
    };

    // Keeps a cookie an answer brought (registered for Dedicatus D604 with keys known only at run time):
    // it refuses the account cookies itself, which only adoptConfirmedSignIn writes.
    const rememberDeviceCookie = (sessionCookies, name, value) => {
        const key = name.toLowerCase();
        if (ACCOUNT_COOKIE_KEYS.has(key)) return;
        // An empty device cookie ('dfid=') does not blank the stored one: only a new registration replaces it.
        if (value === '' && AUTH_COOKIE_KEYS.has(key)) return;
        sessionCookies[name] = value;
    };

    const mergeResponseSession = (operation, result) => {
        const sessionCookies = ensureCookies();
        const tokenBefore = sessionCookies.token;
        const body = result?.body ?? result;
        const data = body?.data ?? body;
        const responseCookies = {};
        const nextCookies = Array.isArray(result?.cookie) ? result.cookie : [];
        nextCookies.forEach(entry => {
            const parsed = parseCookieEntry(entry);
            if (!parsed) return;
            const key = parsed[0].toLowerCase();
            if (ACCOUNT_COOKIE_KEYS.has(key)) {
                // The SDK writes these cookies from the answer's fields with a template string, so a
                // missing field arrives as 'undefined'.
                if (!['', 'undefined', 'null'].includes(parsed[1])) responseCookies[key] = parsed[1];
                return;
            }
            rememberDeviceCookie(sessionCookies, parsed[0], parsed[1]);
        });
        if (operation === 'login_qr_check' && Number(data?.status) === 4) adoptConfirmedSignIn(sessionCookies, data, responseCookies);
        if (data?.dfid) sessionCookies.dfid = String(data.dfid);
        // A token this run did not have is a sign-in: it takes the place of a stored session this run could not load.
        if (sessionCookies.token && sessionCookies.token !== tokenBefore) keepStored = false;
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
                Object.entries(value).filter(([key]) => !['token', 'vip_token', 'dfid', 'cookie'].includes(key.toLowerCase())),
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
        const generation = sessionGeneration;
        const userId = sessionCookies.userid || sessionCookies.user_id;
        if (['youth_union_vip', 'youth_day_vip', 'youth_day_vip_upgrade'].includes(operation)
        && params.userid && String(params.userid) !== String(userId || '')) {
            throw new Error('KuGou account changed during VIP operation');
        }
        const token = sessionCookies.token;
        const safeParams = Object.fromEntries(Object.entries(params).filter(([key]) => !['token', 'vip_token', 'viptype', 'vip_type', 'cookie', 'dfid'].includes(key.toLowerCase())));
        const result = await loaded[moduleName]({
            ...safeParams,
            ...(userId ? { userid: userId, uid: userId } : {}),
            // Renderer no longer stores the token in Electron mode. Supplying it here preserves modules
            // such as concept-VIP calls that historically received an explicit token parameter.
            ...(token ? { token } : {}),
            cookie: { ...sessionCookies },
        });
        if (generation !== sessionGeneration) throw new Error('KuGou session changed during request');
        return mergeResponseSession(operation, result);
    };

    // A renewal of the signed-in session (registered for Dedicatus D604): called only after login_token answered
    // for the same account id and the token it was asked with is still the session's. A VIP credential the answer
    // no longer carries has lapsed and goes.
    const adoptRenewedSession = (sessionCookies, renewed) => {
        if (renewed.token) sessionCookies.token = renewed.token;
        if (renewed.t1) sessionCookies.t1 = renewed.t1;
        if (renewed.vipToken) sessionCookies.vip_token = renewed.vipToken;
        else delete sessionCookies.vip_token;
        if (renewed.vipType) sessionCookies.vip_type = renewed.vipType;
        else delete sessionCookies.vip_type;
    };

    // Renews the session for its VIP credential (login_token), which only the privileged URL endpoint uses: once per
    // run, then after VIP_CREDENTIAL_MAX_AGE_MS (sooner after a refusal or no answer, see the constants). A sign-out or
    // another sign-in while it is asked drops the answer, and so does a renewal past VIP_CREDENTIAL_TIMEOUT_MS.
    const ensureVipCredential = async () => {
        const session = ensureCookies();
        const token = session.token;
        const userid = session.userid || session.user_id;
        if (!token || !userid) return;
        if (vipCredentialChecked.token === token && Date.now() < vipCredentialChecked.until) return;
        const refresh = loadApi().login_token;
        if (typeof refresh !== 'function') return;
        let result;
        let timer;
        try {
            result = await Promise.race([
                refresh({ token, userid, cookie: { ...session } }),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`login_token took longer than ${VIP_CREDENTIAL_TIMEOUT_MS} ms`)), VIP_CREDENTIAL_TIMEOUT_MS);
                }),
            ]);
        } catch (error) {
            // KuGouMusicApi rejects with an answer object both when KuGou refuses (the body KuGou sent) and when the
            // request failed (status 502, body { status: 0, msg: <the Error> }). A refusal is about this token and is
            // asked again after VIP_CREDENTIAL_REFUSED_RETRY_MS; no answer (that, or the time limit) after
            // VIP_CREDENTIAL_UNANSWERED_RETRY_MS. Either way it is not asked before every song. The answer object
            // carries cookies: the log gets the bridge's line, which has none.
            const refused = isRecord(error) && !(error instanceof Error) && !(isRecord(error.body) && error.body.msg instanceof Error);
            vipCredentialChecked = { token, until: Date.now() + (refused ? VIP_CREDENTIAL_REFUSED_RETRY_MS : VIP_CREDENTIAL_UNANSWERED_RETRY_MS) };
            warn('[KuGouSession] The session could not be renewed for its VIP credential', {
                error: normalizeBridgeError('login_token', error).message,
            });
            return;
        } finally {
            clearTimeout(timer);
        }
        // The answer is about this token even when it grants nothing.
        vipCredentialChecked = { token, until: Date.now() + VIP_CREDENTIAL_MAX_AGE_MS };
        const current = ensureCookies();
        if (current !== session || current.token !== token || (current.userid || current.user_id) !== userid) return;
        const body = result?.body ?? result;
        const data = body?.data;
        if (Number(body?.status) !== 1 || !isRecord(data)) return;
        const responseId = data.userid ?? data.user_id;
        if (responseId && String(responseId) !== String(userid)) return;
        const responseCookies = {};
        (Array.isArray(result?.cookie) ? result.cookie : []).forEach(entry => {
            const parsed = parseCookieEntry(entry);
            if (parsed && ACCOUNT_COOKIE_KEYS.has(parsed[0].toLowerCase()) && !['', 'undefined', 'null'].includes(parsed[1])) responseCookies[parsed[0].toLowerCase()] = parsed[1];
        });
        // The SDK writes the answer's fields into cookies with template strings: a missing one is 'undefined'.
        const present = value => (value != null && !['', 'undefined', 'null'].includes(String(value)) ? String(value) : undefined);
        const vipType = present(data.vip_type ?? responseCookies.vip_type);
        adoptRenewedSession(current, {
            token: present(data.token || responseCookies.token),
            t1: present(data.t1 || responseCookies.t1),
            vipToken: present(data.vip_token || responseCookies.vip_token),
            vipType: vipType === '0' ? undefined : vipType,
        });
        // The renewed token is the one now checked: the next request does not renew it again at once.
        vipCredentialChecked = { token: current.token, until: vipCredentialChecked.until };
        persist();
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
            sessionGeneration++;
            dropAccountCookies();
            // A sign-out and an ended sign-in (the renderer's signInRanOut) both arrive here: what is
            // stored goes too, also a session this run could not load, so the next start cannot sign back in.
            persistence.clear();
            keepStored = false;
            persist();
            return { code: 200 };
        }
        // The login check, while a session is stored that this run cannot load and no sign-in of this
        // run brought a token: who is signed in is not known, which is not the same as nobody.
        if (operation === 'user_detail' && keepStored && !ensureCookies().token) {
            throw Object.assign(new Error('The stored KuGou session cannot be read now'), { sessionUnreadable: true });
        }
        if (operation !== 'register_dev') await ensureRegistered(false);
        if (operation === 'song_url_new') {
            if (!vipCredentialPromise) {
                const pending = ensureVipCredential().catch(error => {
                    // The URL module still works with the ordinary credential; a refresh failure is not its failure.
                    warn('[KuGouSession] The VIP credential could not be refreshed', { error: normalizeBridgeError('login_token', error).message });
                });
                vipCredentialPromise = pending;
                pending.then(() => { if (vipCredentialPromise === pending) vipCredentialPromise = null; });
            }
            // A stored credential is used while it is renewed; only a session without one waits for the renewal.
            if (!ensureCookies().vip_token) await vipCredentialPromise;
            // Without a VIP credential KuGou is not asked: the privileged endpoint has nothing beyond what /song/url
            // gives such an account (only previews). The answer has no URL, and the client goes on to /song/url.
            if (!ensureCookies().vip_token) return { status: 0, data: null, vip_credential: false };
        }
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
                throw normalizeBridgeError(operation, error, error === loadError);
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
