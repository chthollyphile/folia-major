const crypto = require('node:crypto');
const { createSessionRepository } = require('./session.cjs');

// electron/huawei/huaweiApiBridge.cjs
//
// Huawei Music keeps its account session in the main process. The renderer sends only an
// operation name and parameters; credentials never cross the IPC boundary.
//
// Protocol reference: github.com/talongao/tinglan (AGPL-3.0-only), native/internal/huawei.
// The OAuth identity is Huawei Music's own AppGallery client (101444301). It is not ours and
// may stop working at any time.

const MUSIC_ENDPOINT = 'https://api-drcn.music.dbankcloud.cn';
const AUTHORIZE_ENDPOINT = 'https://oauth-login.platform.hicloud.com/oauth2/v3/authorize';
const TOKEN_ENDPOINT = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const CLIENT_ID = '101444301';
const REDIRECT_URI = 'hms://redirect_uri';
const LOGIN_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 25 * 1000;
const LOGIN_PARTITION = 'persist:huawei-music-login';
const PROVIDER_USER_AGENT = 'model=MRO-W00,brand=huawei,rom=,emui=,os=12,apilevel=32,manufacturer=huawei,useBrandCust=0,extChannel=,cpucore=4,memory=6.0G,srceenHeight=2160,screenWidth=3840,harmonyApiLevel=,huaweiOsBrand=';

const ALLOWED_RESOURCE_SUFFIXES = ['.dbankcdn.cn', '.tingmall.com', '.kuke.com'];
const ALLOWED_LOGIN_HOSTS = new Set([
    'oauth-login.platform.hicloud.com',
    'oauth-login.cloud.huawei.com',
    'oauth-login1.cloud.huawei.com',
    'id1.cloud.huawei.com',
    'account.huawei.com',
    'consumer.huawei.com',
]);

class HuaweiBridgeError extends Error {
    constructor(code, message, extra = {}) {
        super(message);
        this.name = 'HuaweiBridgeError';
        this.code = code;
        Object.assign(this, extra);
    }
}

const randomString = bytes => crypto.randomBytes(bytes).toString('base64url');
const challenge = verifier => crypto.createHash('sha256').update(verifier).digest('base64url');
const utcStamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function allowedResourceUrl(raw) {
    try {
        const url = new URL(String(raw));
        if (url.protocol !== 'https:' || url.username || url.password) return false;
        if (url.port && url.port !== '443') return false;
        const host = url.hostname.toLowerCase();
        return ALLOWED_RESOURCE_SUFFIXES.some(suffix => host.length > suffix.length && host.endsWith(suffix));
    } catch {
        return false;
    }
}

function allowedLoginUrl(raw) {
    try {
        const url = new URL(String(raw));
        if (url.protocol !== 'https:' || url.username || url.password) return false;
        if (url.port && url.port !== '443') return false;
        if (!ALLOWED_LOGIN_HOSTS.has(url.hostname.toLowerCase())) return false;
        if (url.hostname.toLowerCase() === 'oauth-login1.cloud.huawei.com') {
            return url.pathname === '/oauth2/v3/loginCallback';
        }
        return true;
    } catch {
        return false;
    }
}

function musicHeaders(token) {
    if (typeof token === 'string' && /[\r\n,]/.test(token)) {
        throw new HuaweiBridgeError('invalid-response', 'Invalid Huawei session');
    }
    let value = `Digest username=app-music-baseline, nonce=${randomString(18)}, created=${utcStamp()}`;
    if (token) value += `, token=${token}`;
    return value;
}

function parseEnvelope(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function resultFailure(payload) {
    const result = payload?.result;
    if (!result || result.resultCode === '000000') return null;
    const message = String(result.resultMessage || '');
    const code = String(result.resultCode || '');
    if (code === '142400' || /vip|会员|subscription/i.test(message)) {
        return new HuaweiBridgeError('subscription-required', message || 'Huawei Music VIP is required', { upstreamCode: code });
    }
    if (/token.*(expired|invalid)|登录已过期|会话已过期|token已过期/i.test(message)) {
        return new HuaweiBridgeError('auth-required', message || 'Huawei Music sign-in expired', { upstreamCode: code });
    }
    return new HuaweiBridgeError('not-playable', message || `Huawei Music refused the request (${code})`, { upstreamCode: code });
}

function createHuaweiApiBridge({ store, safeStorage, fetch, BrowserWindow, session, parentWindow = () => null,
    onAudioSource = () => {}, now = Date.now, warn = console.warn }) {
    const sessions = createSessionRepository({ store, safeStorage, warn });
    const attempts = new Map();
    // Partitions exist once Electron is ready; the bridge is created before that.
    let loginSession = null;
    const getLoginSession = () => {
        if (!loginSession) loginSession = session.fromPartition(LOGIN_PARTITION);
        return loginSession;
    };

    const httpFetch = async (url, options = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT_MS);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } catch (error) {
            throw new HuaweiBridgeError('network', 'Huawei Music network request failed', { cause: error });
        } finally {
            clearTimeout(timer);
        }
    };

    const musicRequest = async ({ method = 'POST', path, query, body, token = '', stage = 'request' }) => {
        let url = MUSIC_ENDPOINT + path;
        if (query) url += `?${new URLSearchParams(query).toString()}`;
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': PROVIDER_USER_AGENT,
            Authorization: musicHeaders(token),
        };
        const response = await httpFetch(url, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        const payload = parseEnvelope(text);
        if (payload?.error) {
            throw new HuaweiBridgeError('not-playable', `Huawei Music ${stage} failed`, { httpStatus: response.status });
        }
        if (!response.ok) {
            throw new HuaweiBridgeError(
                response.status === 401 || response.status === 403 ? 'auth-required'
                    : response.status === 429 ? 'unavailable' : 'not-playable',
                `Huawei Music ${stage} failed (HTTP ${response.status})`,
                { httpStatus: response.status },
            );
        }
        if (!payload) throw new HuaweiBridgeError('invalid-response', `Huawei Music ${stage} returned no JSON`);
        const failure = resultFailure(payload);
        if (failure) throw failure;
        return payload;
    };

    const requireSession = () => {
        const current = sessions.get();
        if (!current?.token || !current?.userId) {
            throw new HuaweiBridgeError('auth-required', 'Sign in to Huawei Music first');
        }
        return current;
    };

    const exchangeCode = async ({ code, verifier }) => {
        const form = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code,
            code_verifier: verifier,
        });
        const tokenResponse = await httpFetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        const tokenText = await tokenResponse.text();
        const tokenPayload = parseEnvelope(tokenText);
        if (!tokenResponse.ok || !tokenPayload?.access_token) {
            const codeValue = tokenPayload?.error !== undefined ? String(tokenPayload.error) : undefined;
            throw new HuaweiBridgeError('auth-required', 'Huawei account authorization was refused', {
                httpStatus: tokenResponse.status,
                upstreamCode: codeValue,
            });
        }
        const loginPayload = await musicRequest({
            path: '/music-odpapp-service/v5/service/userinfo/loginex',
            body: { accessToken: tokenPayload.access_token },
            stage: 'account exchange',
        });
        const token = loginPayload.token;
        const userId = loginPayload.snsUserID;
        if (typeof token !== 'string' || !token || typeof userId !== 'string' || !userId) {
            throw new HuaweiBridgeError('invalid-response', 'Huawei Music session is incomplete');
        }
        // A token that cannot read favourites is not a usable session.
        await musicRequest({
            path: '/music-userbehavior-service/v3/service/favorite/simple/all',
            body: { targetSnsUserID: userId, start: 0, limit: 1, contentTypes: [1] },
            token,
            stage: 'session validation',
        });
        return { token, userId, expireTime: String(loginPayload.expireTime || ''), nickname: '华为音乐账号' };
    };

    const settleCallback = async (attempt, rawUrl) => {
        if (attempt.settled) return;
        attempt.settled = true;
        try {
            const callback = new URL(rawUrl);
            if (!/^hms:/i.test(callback.protocol) || callback.hostname !== 'redirect_uri'
                || callback.username || callback.password || callback.pathname !== '' || callback.hash) {
                throw new HuaweiBridgeError('auth-required', 'Huawei Music callback destination rejected');
            }
            if (now() - attempt.createdAt > LOGIN_TTL_MS) {
                throw new HuaweiBridgeError('auth-required', 'Huawei Music sign-in expired');
            }
            const params = callback.searchParams;
            if (params.getAll('state').length !== 1 || params.getAll('code').length > 1 || params.getAll('error').length > 1) {
                throw new HuaweiBridgeError('auth-required', 'Huawei Music callback is malformed');
            }
            const state = params.get('state') || '';
            const expected = attempt.oauthState;
            const matches = state.length === expected.length
                && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected));
            if (!matches) throw new HuaweiBridgeError('auth-required', 'Huawei Music sign-in state mismatch');
            if (params.has('error')) throw new HuaweiBridgeError('auth-required', 'Huawei account authorization was refused');
            const code = params.get('code') || '';
            if (!code) throw new HuaweiBridgeError('auth-required', 'Huawei Music authorization code missing');
            const value = await exchangeCode({ code, verifier: attempt.verifier });
            sessions.set(value);
            attempt.status = 'confirmed';
            attempt.error = null;
            if (attempt.window && !attempt.window.isDestroyed()) attempt.window.destroy();
        } catch (error) {
            attempt.status = 'error';
            attempt.error = error instanceof Error ? error.message : 'Huawei Music sign-in failed';
            if (attempt.window && !attempt.window.isDestroyed()) attempt.window.destroy();
        }
    };

    const openLoginWindow = key => {
        const attempt = attempts.get(key);
        if (!attempt) throw new HuaweiBridgeError('auth-required', 'Huawei Music sign-in is not active');
        if (attempt.status === 'confirmed') return true;
        if (attempt.window && !attempt.window.isDestroyed()) {
            attempt.window.focus();
            return true;
        }
        getLoginSession();
        const win = new BrowserWindow({
            width: 980,
            height: 760,
            show: false,
            parent: parentWindow() || undefined,
            modal: false,
            autoHideMenuBar: true,
            title: '华为音乐登录',
            webPreferences: {
                partition: LOGIN_PARTITION,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
            },
        });
        attempt.window = win;
        win.once('ready-to-show', () => win.show());
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const judge = (event, url) => {
            if (/^hms:/i.test(url)) {
                event.preventDefault();
                void settleCallback(attempt, url);
                return;
            }
            if (!allowedLoginUrl(url)) event.preventDefault();
        };
        win.webContents.on('will-navigate', judge);
        win.webContents.on('will-redirect', judge);
        win.on('closed', () => {
            attempt.window = null;
            if (attempt.status !== 'confirmed') {
                attempt.status = 'error';
                attempt.error = attempt.error || '登录窗口已关闭';
            }
        });
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            access_type: 'offline',
            scope: 'openid',
            state: attempt.oauthState,
            code_challenge: challenge(attempt.verifier),
            code_challenge_method: 'S256',
            countryCode: 'cn',
            ui_locales: 'zh-cn',
        });
        win.loadURL(`${AUTHORIZE_ENDPOINT}?${params.toString()}`).catch(() => {
            attempt.status = 'error';
            attempt.error = '登录页面打不开';
            if (!win.isDestroyed()) win.destroy();
        });
        return true;
    };

    const requireAttempt = key => {
        const attempt = attempts.get(String(key));
        if (!attempt) throw new HuaweiBridgeError('auth-required', 'Huawei Music sign-in is not active');
        return attempt;
    };

    return {
        async request(operation, params = {}) {
            try {
                if (operation === 'login_start') {
                    const key = randomString(18);
                    const verifier = randomString(48);
                    const oauthState = randomString(24);
                    attempts.set(key, {
                        verifier, oauthState, status: 'waiting', createdAt: now(), window: null, error: null, settled: false,
                    });
                    for (const [oldKey, attempt] of attempts) {
                        if (!attempt.window && now() - attempt.createdAt > LOGIN_TTL_MS) attempts.delete(oldKey);
                    }
                    while (attempts.size > 20) attempts.delete(attempts.keys().next().value);
                    return { ok: true, data: { key } };
                }
                if (operation === 'login_open') {
                    return { ok: true, data: { opened: openLoginWindow(params.key) } };
                }
                if (operation === 'login_check') {
                    const attempt = requireAttempt(params.key);
                    if (attempt.status === 'confirmed') return { ok: true, data: { state: 'confirmed' } };
                    if (attempt.status === 'error') {
                        return { ok: false, error: { code: 'auth-required', message: attempt.error || 'Huawei Music sign-in failed' } };
                    }
                    if (now() - attempt.createdAt > LOGIN_TTL_MS) return { ok: true, data: { state: 'expired' } };
                    return { ok: true, data: { state: 'waiting' } };
                }
                if (operation === 'login_cancel') {
                    const attempt = attempts.get(String(params.key));
                    attempts.delete(String(params.key));
                    if (attempt?.window && !attempt.window.isDestroyed()) attempt.window.destroy();
                    return { ok: true, data: { canceled: true } };
                }
                if (operation === 'login_status') {
                    const current = sessions.get();
                    if (!current?.userId) return { ok: true, data: null };
                    return {
                        ok: true,
                        data: {
                            id: current.userId,
                            nickname: current.nickname || '华为音乐账号',
                        },
                    };
                }
                if (operation === 'logout') {
                    sessions.clear({ signOut: true });
                    await getLoginSession().clearStorageData().catch(() => {});
                    return { ok: true, data: { signedOut: true } };
                }
                if (operation === 'search') {
                    const query = String(params.query || '').trim();
                    if (!query || Array.from(query).length > 80) {
                        throw new HuaweiBridgeError('invalid-response', 'Huawei Music search query is invalid');
                    }
                    const start = Math.min(1000, Math.max(0, Number(params.offset) || 0));
                    const limit = Math.min(50, Math.max(1, Number(params.limit) || 30));
                    const kind = params.kind === 'album' ? 'album' : params.kind === 'playlist' ? 'playlist' : 'song';
                    const contentType = kind === 'album' ? '2' : kind === 'playlist' ? '4' : '1';
                    const field = kind === 'album' ? 'albumSimpleInfos'
                        : kind === 'playlist' ? 'musicListSimpleInfos' : 'songSimpleInfos';
                    const current = sessions.peek();
                    const payload = await musicRequest({
                        path: '/music-search-service/v10/service/fuzzysearch',
                        body: { contentType, correct: '1', queryWord: query, start: String(start), limit: String(limit) },
                        token: current?.token || '',
                        stage: 'search',
                    });
                    const items = Array.isArray(payload[field]) ? payload[field] : [];
                    const more = ['true', '1', '"true"', '"1"'].includes(String(payload.hasNextPage ?? '').trim());
                    return {
                        ok: true,
                        data: {
                            items,
                            total: Number(payload.totalNum) || undefined,
                            hasMore: more && items.length > 0,
                            nextOffset: start + items.length,
                        },
                    };
                }
                if (operation === 'album') {
                    const id = String(params.id || '');
                    if (!id) throw new HuaweiBridgeError('invalid-response', 'Huawei Music album id is missing');
                    const start = Math.min(1000, Math.max(0, Number(params.offset) || 0));
                    const limit = Math.min(50, Math.max(1, Number(params.limit) || 30));
                    const payload = await musicRequest({
                        method: 'GET',
                        path: '/music-metacontent-service/v1/service/album/detail/byalbumcode',
                        query: { albumCode: id, start: String(start), limit: String(limit) },
                        stage: 'album',
                    });
                    const detail = payload.albumInfoEx || {};
                    const info = detail.albumInfo || {};
                    const items = Array.isArray(detail.songSimpleInfos) ? detail.songSimpleInfos : [];
                    const total = Number(info.totalCount) || undefined;
                    return {
                        ok: true,
                        data: {
                            id,
                            name: String(info.contentName || info.albumName || ''),
                            coverUrl: info.picture?.bigImgURL || info.picture?.middleImgURL || info.picture?.smallImgURL || '',
                            totalCount: total,
                            items,
                            hasMore: Number.isFinite(total) ? start + items.length < total : items.length === limit,
                            nextOffset: start + items.length,
                        },
                    };
                }
                if (operation === 'artist') {
                    const id = String(params.id || '');
                    if (!id) throw new HuaweiBridgeError('invalid-response', 'Huawei Music artist id is missing');
                    const payload = await musicRequest({
                        path: '/music-metacontent-service/v2/service/artist/detail/byartistcode',
                        body: { artistCode: id, songNum: 50, albumNum: 50 },
                        stage: 'artist',
                    });
                    const detail = payload.artistInfoEx || {};
                    const info = detail.artistInfo || {};
                    return {
                        ok: true,
                        data: {
                            id,
                            name: String(info.artistName || ''),
                            coverUrl: info.picture?.bigImgURL || info.picture?.middleImgURL || info.picture?.smallImgURL || '',
                            items: Array.isArray(detail.songSimpleInfos) ? detail.songSimpleInfos : [],
                            albums: Array.isArray(detail.albumSimpleInfos)
                                ? detail.albumSimpleInfos.map(album => ({
                                    id: String(album.contentID || album.albumCode || ''),
                                    name: String(album.contentName || album.albumName || ''),
                                    coverUrl: album.picture?.bigImgURL || album.picture?.middleImgURL || album.picture?.smallImgURL || '',
                                })).filter(album => album.id && album.name)
                                : [],
                        },
                    };
                }
                if (operation === 'recommendations') {
                    const current = sessions.peek();
                    const payload = await musicRequest({
                        method: 'GET',
                        path: '/music-operation-service/v1/service/page/detail/all',
                        query: { pageType: '7', hasRecommend: '1' },
                        token: current?.token || '',
                        stage: 'recommendations',
                    });
                    const columns = Array.isArray(payload?.columnInfoExs) ? payload.columnInfoExs : [];
                    const wanted = ['今日为你推荐', '歌单推荐'];
                    const rows = columns
                        .filter(column => wanted.includes(String(column?.columnInfo?.contentName || '')))
                        .flatMap(column => Array.isArray(column?.contentSimpleInfos) ? column.contentSimpleInfos : []);
                    const items = rows.flatMap(row => {
                        if (String(row?.contentType || '') !== '4') return [];
                        const id = String(row?.contentID || '');
                        const name = String(row?.contentName || '');
                        if (!id || !name) return [];
                        let daily = id === 'a001';
                        try {
                            const extra = JSON.parse(String(row?.extendInfo || ''));
                            if (extra?.serviceType === 'dailyrecommend') daily = true;
                        } catch {
                            // A row without extendInfo is an ordinary playlist.
                        }
                        return [{
                            id,
                            name,
                            kind: 'collected',
                            daily,
                            coverUrl: row?.picture?.bigImgURL || row?.picture?.middleImgURL || row?.picture?.smallImgURL || '',
                            trackCount: Number(row?.totalCount) || undefined,
                            playCount: Number(row?.playNum) || undefined,
                            description: String(row?.description || ''),
                        }];
                    });
                    const dailyId = items.find(item => item.daily)?.id || 'a001';
                    return { ok: true, data: { items, dailyId } };
                }
                if (operation === 'similar_songs') {
                    const id = String(params.id || '');
                    if (!id || id.length > 200) {
                        throw new HuaweiBridgeError('invalid-response', 'Huawei Music seed song id is invalid');
                    }
                    const current = sessions.peek();
                    const payload = await musicRequest({
                        path: '/music-recommend-service/v1/service/recommend/querysimilar',
                        body: { contentCode: id, contentType: '1', type: '2' },
                        token: current?.token || '',
                        stage: 'similar songs',
                    });
                    const items = Array.isArray(payload?.similarRecInfos) ? payload.similarRecInfos : [];
                    return { ok: true, data: { items } };
                }
                if (operation === 'library_albums') {
                    const current = requireSession();
                    const start = Math.min(1000, Math.max(0, Number(params.offset) || 0));
                    const limit = Math.min(50, Math.max(1, Number(params.limit) || 30));
                    const payload = await musicRequest({
                        path: '/music-userbehavior-service/v3/service/favorite/simple/all',
                        body: {
                            targetSnsUserID: current.userId, start, limit, contentTypes: [2],
                        },
                        token: current.token,
                        stage: 'albums',
                    });
                    const rows = Array.isArray(payload.favoriteInfos) ? payload.favoriteInfos : [];
                    const items = rows.flatMap(row => {
                        const id = String(row?.contentID || '');
                        const name = String(row?.contentName || '');
                        if (!id || !name) return [];
                        return [{
                            id,
                            name,
                            kind: 'album',
                            coverUrl: row?.picture?.bigImgURL || row?.picture?.middleImgURL || row?.picture?.smallImgURL || '',
                            trackCount: Number(row?.totalCount) || undefined,
                            artistName: String(row?.artistName || ''),
                            description: String(row?.description || ''),
                        }];
                    });
                    return {
                        ok: true,
                        data: {
                            items,
                            hasMore: rows.length === limit,
                            nextOffset: start + rows.length,
                        },
                    };
                }
                if (operation === 'library_playlists') {
                    const current = requireSession();
                    const payload = await musicRequest({
                        path: '/music-userbehavior-service/v3/service/favorite/simple/all',
                        body: {
                            targetSnsUserID: current.userId, start: 0, limit: 50, contentTypes: [4, 5, 7],
                        },
                        token: current.token,
                        stage: 'playlists',
                    });
                    const rows = Array.isArray(payload.favoriteInfos) ? payload.favoriteInfos : [];
                    const items = rows.flatMap(row => {
                        const kind = String(row?.contentType || '');
                        if (kind !== '4' && kind !== '5') return [];
                        const id = String(row?.contentID || '');
                        const name = String(row?.contentName || '');
                        if (!id || !name) return [];
                        return [{
                            id,
                            name,
                            kind: kind === '5' ? 'owned' : 'collected',
                            coverUrl: row?.picture?.bigImgURL || row?.picture?.middleImgURL || row?.picture?.smallImgURL || '',
                            trackCount: Number(row?.totalCount) || undefined,
                            description: String(row?.listDesc || ''),
                        }];
                    });
                    return { ok: true, data: { items } };
                }
                if (operation === 'playlist_tracks') {
                    const id = String(params.id || '');
                    const kind = String(params.kind || '');
                    if (!id || id.length > 200) throw new HuaweiBridgeError('invalid-response', 'Huawei Music playlist id is invalid');
                    if (kind !== 'owned' && kind !== 'collected') {
                        throw new HuaweiBridgeError('unsupported', 'Huawei Music playlist kind is unsupported');
                    }
                    const start = Math.min(1000, Math.max(0, Number(params.offset) || 0));
                    const limit = Math.min(50, Math.max(1, Number(params.limit) || 30));
                    let rows = [];
                    if (kind === 'owned') {
                        const current = requireSession();
                        const payload = await musicRequest({
                            method: 'GET',
                            path: '/music-userbehavior-service/v1/service/playlist/detail/all',
                            query: { playListID: id, start: '0', limit: '999' },
                            token: current.token,
                            stage: 'playlist',
                        });
                        rows = Array.isArray(payload?.playListInfoEx?.playListSongInfoList)
                            ? payload.playListInfoEx.playListSongInfoList : [];
                    } else {
                        const payload = await musicRequest({
                            path: '/music-operation-service/v2/service/musiclist/detail/bymusiclistid',
                            body: { musicListID: id, copyrightSwitch: '1', start, limit: String(limit) },
                            stage: 'playlist',
                        });
                        rows = Array.isArray(payload?.musicListInfoEx?.songSimpleInfos)
                            ? payload.musicListInfoEx.songSimpleInfos : [];
                    }
                    const total = rows.length;
                    const items = rows.slice(start, start + limit);
                    return {
                        ok: true,
                        data: {
                            items,
                            total,
                            hasMore: start + items.length < total,
                            nextOffset: start + items.length,
                        },
                    };
                }
                if (operation === 'audio') {
                    const current = requireSession();
                    const id = String(params.id || '');
                    if (!id) throw new HuaweiBridgeError('invalid-response', 'Huawei Music song id is missing');
                    const quality = String(params.quality || 'standard');
                    const qualityType = quality === 'lossless' ? '3'
                        : quality === 'hires' ? '5'
                            : quality === 'high' || quality === 'ultra' ? '2' : '1';
                    const payload = await musicRequest({
                        path: '/music-play-service/v3/service/file/bycontentcode',
                        body: { contentCode: id, contentType: '1', qualityType },
                        token: current.token,
                        stage: 'playback',
                    });
                    const url = String(payload.fileURL || '');
                    if (!allowedResourceUrl(url)) {
                        throw new HuaweiBridgeError('not-playable', 'Huawei Music returned no playable audio URL');
                    }
                    const servedCode = String(payload.playQuality || '');
                    const servedQuality = servedCode === '3' || servedCode === '7' ? 'lossless'
                        : servedCode === '4' || servedCode === '5' ? 'hires'
                            : servedCode === '2' ? 'high'
                                : servedCode === '1' ? 'standard'
                                    : quality;
                    onAudioSource(url);
                    return {
                        ok: true,
                        data: {
                            url,
                            quality: servedQuality,
                            preview: /\/preview\//i.test(url),
                            fetchedAt: now(),
                        },
                    };
                }
                if (operation === 'song_detail') {
                    const current = requireSession();
                    const id = String(params.id || '');
                    if (!id) throw new HuaweiBridgeError('invalid-response', 'Huawei Music song id is missing');
                    const payload = await musicRequest({
                        path: '/music-play-service/v3/service/file/bycontentcode',
                        body: { contentCode: id, contentType: '1', qualityType: '1' },
                        token: current.token,
                        stage: 'song detail',
                    });
                    const song = typeof payload.songInfo === 'string' ? parseEnvelope(payload.songInfo) : payload.songInfo;
                    if (!song) return { ok: true, data: null };
                    return { ok: true, data: song };
                }
                if (operation === 'lyrics') {
                    const current = sessions.peek();
                    let lrcUrl = typeof params.lyricUrl === 'string' ? params.lyricUrl : '';
                    let wordUrl = '';
                    if (current?.token) {
                        try {
                            const payload = await musicRequest({
                                path: '/music-play-service/v3/service/file/bycontentcode',
                                body: {
                                    contentCode: String(params.id || ''),
                                    contentType: '1',
                                    qualityType: '1',
                                },
                                token: current.token,
                                stage: 'lyrics',
                            });
                            const blocks = [payload.lyrics, payload.songInfo?.lyrics];
                            for (const block of blocks) {
                                const obj = typeof block === 'string' ? parseEnvelope(block) : block;
                                if (!obj || typeof obj !== 'object') continue;
                                if (!lrcUrl && allowedResourceUrl(obj.lineByLineLyric)) lrcUrl = obj.lineByLineLyric;
                                if (!wordUrl && allowedResourceUrl(obj.wordByWordLyric)) wordUrl = obj.wordByWordLyric;
                            }
                            if (allowedResourceUrl(payload.lyricAddress)) lrcUrl = payload.lyricAddress;
                        } catch {
                            // Lyrics must not fail because playback metadata could not be read.
                        }
                    }
                    const read = async url => {
                        if (!allowedResourceUrl(url)) return '';
                        try {
                            const response = await httpFetch(url, { timeout: 8000 });
                            if (!response.ok) return '';
                            const text = await response.text();
                            return text.slice(0, 512 * 1024);
                        } catch {
                            return '';
                        }
                    };
                    const [lrc, hmrc] = await Promise.all([read(lrcUrl), read(wordUrl)]);
                    return { ok: true, data: { lrc, hmrc } };
                }
                throw new HuaweiBridgeError('unsupported', `Unknown Huawei Music operation: ${operation}`);
            } catch (error) {
                if (error instanceof HuaweiBridgeError) {
                    return {
                        ok: false,
                        error: {
                            code: error.code,
                            message: error.message,
                            upstreamCode: error.upstreamCode,
                            httpStatus: error.httpStatus,
                        },
                    };
                }
                return { ok: false, error: { code: 'invalid-response', message: 'Huawei Music request failed' } };
            }
        },
    };
}

module.exports = { createHuaweiApiBridge, HUAWEI_LOGIN_PARTITION: LOGIN_PARTITION };
