// electron/soda/sodaApiBridge.cjs
//
// 汽水音乐（Soda / Luna）的匿名接口，全部在主进程发出。api.qishui.com 只要请求带 Origin 头就答 403，
// 渲染进程里的 fetch 一定失败，所以这一层是必须的，不是可选的优化。
//
// 两段活：
//   1. 匿名接口（搜索 / 歌单搜索 / 歌单详情 / 分享页）——直接发 HTTP，字段怎么读由 sodaNormalize.ts 决定。
//   2. 账号（扫码登录、我的歌单、红心、歌单增删）——交给 ly-music-source，它管签名（a-bogus）、passport
//      扫码和 cookie；会话在这里用 safeStorage 加密存着，之后每次请求前重新装回客户端。
// 播放地址的解析（VIP 整首要解密）留给后续的 audio.cjs，不在这里。

const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const API_HOST = 'https://api.qishui.com';
const SHARE_HOST = 'https://music.douyin.com';
const UA_LUNA = 'LunaPC/3.4.0(388267242)';
const UA_WEB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

// 搜索接口要的一整套安卓设备参数，被限流时换一组。
const DEVICE = {
    device_platform: 'android', os: 'android', ssmix: 'a',
    aid: '386088', app_name: 'luna', channel: 'xiaomi_8478_64',
    version_code: '100198030', version_name: '19.8.0',
    manifest_version_code: '100198030', update_version_code: '100198030',
    resolution: '1080*1920', dpi: '480',
    device_type: 'ABR-AL80', device_brand: 'HUAWEI', device_model: 'ABR-AL80',
    os_api: '35', os_version: '15', ac: 'wifi', language: 'zh',
    package: 'com.luna.music', is_car_play: '0', is_teen_mode: '0',
    need_personal_recommend: '1', sim_region: 'cn', tz_name: 'Asia/Shanghai', tz_offset: '28800',
    iid: '2204957404569386', device_id: '2204957404565290',
};

const OPERATIONS = [
    'search', 'playlist_search', 'playlist_detail', 'share',
    'status', 'login_qr_create', 'login_qr_poll', 'logout', 'profile', 'membership',
    'user_playlists', 'liked_ids', 'like',
    'playlist_create', 'playlist_append', 'playlist_remove',
    'resolve',
];

const query = (params) => new URLSearchParams(Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
)).toString();

/** 分享页把数据放在 `_ROUTER_DATA = {...};` 里，按大括号配对取，跳过字符串内的括号。 */
function readRouterData(html) {
    const marker = html.indexOf('_ROUTER_DATA');
    if (marker < 0) return null;
    const start = html.indexOf('{', marker);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i += 1) {
        const ch = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}' && --depth === 0) {
            try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}

function createSodaApiBridge({ requestFactory = globalThis.fetch, timeoutMs = 20000, sessionStore = null, audio = null, cacheDir = null } = {}) {
    // ly-music-source 是纯 ESM，主进程是 CJS：用动态 import 加载一次（和 electron/ytm 引 youtubei.js 一样）。
    let clientPromise = null;
    const musicClient = () => {
        if (!clientPromise) {
            clientPromise = (async () => {
                const { createMusicSource } = await import('ly-music-source');
                const client = createMusicSource({ timeoutMs });
                const saved = sessionStore?.get();
                if (saved) {
                    try { client.importSession(saved); } catch { /* 旧会话读不回来就当没登录 */ }
                }
                return client;
            })();
        }
        return clientPromise;
    };

    const call = async (url, headers) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await requestFactory(url, { headers, signal: controller.signal });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return response;
        } finally {
            clearTimeout(timer);
        }
    };

    const getJson = async (url, headers) => (await call(url, headers)).json();

    const search = async (path, { query: keyword, cursor = 0, count = 20 }) => {
        if (!keyword) return { group: null };
        const url = `${API_HOST}${path}?${query({ ...DEVICE, q: keyword, cursor, count })}`;
        const body = await getJson(url, { 'User-Agent': UA_LUNA });
        return { group: body?.result_groups?.[0] ?? null };
    };

    const handlers = {
        search: (params) => search('/luna/search/track', params),
        playlist_search: (params) => search('/luna/search/playlist', params),
        async playlist_detail({ playlistId, cursor = 0, count = 20 }) {
            if (!playlistId) return { playlist: null, tracks: [], nextCursor: null };
            const url = `${API_HOST}/luna/pc/playlist/detail?${query({
                playlist_id: playlistId,
                cursor,
                cnt: count,
                aid: '386088',
                device_platform: 'web',
                channel: 'pc_web',
            })}`;
            const body = await getJson(url, { 'User-Agent': UA_LUNA });
            return {
                playlist: body?.playlist ?? null,
                tracks: Array.isArray(body?.media_resources) ? body.media_resources : [],
                nextCursor: body?.next_cursor ?? null,
            };
        },
        async share({ trackId }) {
            if (!trackId) return { track: null };
            const response = await call(`${SHARE_HOST}/qishui/share/track?track_id=${encodeURIComponent(trackId)}`, { 'User-Agent': UA_WEB });
            const data = readRouterData(await response.text());
            return { track: data?.loaderData?.track_page?.audioWithLyricsOption ?? null };
        },
    };

    const account = {
        async status() {
            const client = await musicClient();
            const state = client.getAuthState();
            return { authenticated: Boolean(state?.authenticated), profile: state?.authenticated ? await client.getProfile('qishui').catch(() => null) : null };
        },
        async login_qr_create() {
            const client = await musicClient();
            const session = await client.createQrLogin('qishui');
            return { token: String(session?.token ?? ''), qrcode: session?.qrcode ? String(session.qrcode) : '', expireTime: Number(session?.expireTime) || undefined };
        },
        async login_qr_poll({ token }) {
            if (!token) throw new Error('missing QR token');
            const client = await musicClient();
            const result = await client.pollQrLogin('qishui', token);
            if (result?.status === 'confirmed') sessionStore?.set(client.exportSession());
            return { status: String(result?.status ?? 'failed'), message: result?.message ? String(result.message) : undefined };
        },
        async logout() {
            const client = await musicClient();
            client.logout('qishui');
            sessionStore?.clear();
            return { ok: true };
        },
        async profile() {
            const client = await musicClient();
            return client.getProfile('qishui');
        },
        async membership() {
            const client = await musicClient();
            return client.getMembership('qishui');
        },
        async user_playlists({ limit = 50, cursor = 0 }) {
            const client = await musicClient();
            return { items: await client.listUserPlaylists({ limit, cursor }) };
        },
        async liked_ids({ limit = 500 } = {}) {
            const client = await musicClient();
            const playlists = await client.listUserPlaylists({ limit: 200 });
            const liked = playlists.find((item) => String(item?.kind ?? '') === 'liked');
            if (!liked) return { ids: [], whole: true };
            const detail = await client.getPlaylist(String(liked.id), { limit });
            return { ids: (detail?.songs ?? []).map((song) => String(song.id)), whole: (detail?.songs ?? []).length < limit };
        },
        async like({ songId, liked }) {
            if (!songId) throw new Error('missing song id');
            const client = await musicClient();
            if (liked) await client.likeTrack(String(songId));
            else await client.unlikeTrack(String(songId));
            return { ok: true };
        },
        async playlist_create({ name, description }) {
            const client = await musicClient();
            return client.createPlaylist({ name: String(name ?? ''), ...(description ? { description: String(description) } : {}) });
        },
        async playlist_append({ playlistId, trackIds }) {
            const client = await musicClient();
            await client.appendPlaylistTracks(String(playlistId), (trackIds ?? []).map(String));
            return { ok: true };
        },
        async playlist_remove({ playlistId, trackIds }) {
            const client = await musicClient();
            await client.removePlaylistTracks(String(playlistId), (trackIds ?? []).map(String));
            return { ok: true };
        },
        /**
         * 一首歌的播放地址。免费的整首直接给 CDN 地址；VIP 的整首在包里头下载并解密，落盘后用
         * folia-soda:// 交给播放器。地址只在这次运行里有效，重启后会重新 resolve。
         */
        async resolve({ songId, quality }) {
            if (!songId) throw new Error('missing song id');
            const client = await musicClient();
            const result = await client.resolve({ ids: { qishui: String(songId) }, quality: quality || 'higher' });
            if (result?.url) {
                return { url: String(result.url), quality: result.quality ?? quality, preview: Boolean(result.preview) };
            }
            let filePath = result?.filePath ? String(result.filePath) : '';
            const ext = String(result?.ext || 'm4a').replace(/[^a-z0-9]/gi, '') || 'm4a';
            if (!filePath && result?.data) {
                const dir = typeof cacheDir === 'function' ? cacheDir() : cacheDir;
                if (!dir) throw new Error('no cache directory for Soda audio');
                mkdirSync(dir, { recursive: true });
                filePath = path.join(dir, `${songId}-${quality || 'higher'}.${ext}`);
                writeFileSync(filePath, result.data);
            }
            if (!filePath || !audio) return { url: '' };
            return {
                url: audio.register(filePath, String(result?.mimeType || 'audio/mp4')),
                quality: result?.quality ?? quality,
                ext,
            };
        },
    };

    return {
        async request(operation, params = {}) {
            if (!OPERATIONS.includes(operation)) {
                return { ok: false, error: { code: 'unsupported', message: 'Unsupported Soda operation' } };
            }
            try {
                const data = Object.prototype.hasOwnProperty.call(account, operation)
                    ? await account[operation](params)
                    : await handlers[operation](params);
                return { ok: true, data };
            } catch (error) {
                const code = typeof error?.status === 'number' && error.status >= 500 ? 'unavailable' : 'invalid-response';
                return { ok: false, error: { code, message: String(error?.message || 'Soda request failed') } };
            }
        },
    };
}

module.exports = { createSodaApiBridge, readRouterData, OPERATIONS };
