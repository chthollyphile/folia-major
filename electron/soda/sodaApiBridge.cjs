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
const { readPcSession, findPcDeviceId } = require('./pcSession.cjs');
const { createSodaSigner, md5Upper } = require('./sodaSigner.cjs');
const { decryptAudio } = require('./decrypt.cjs');
const path = require('node:path');

const API_HOST = 'https://api.qishui.com';
const SHARE_HOST = 'https://music.douyin.com';
const UA_LUNA = 'LunaPC/3.4.0(388267242)';
// 拿不到客户端版本时的默认值（音乐库社区实现一直用这一版，服务端认）。
const DEFAULT_CLIENT_VERSION = '3.4.0';
/** 3.7.0 → 30070000：官方 version_code 是 major*1e7 + minor*1e4 + patch*1e2。 */
const versionCodeOf = (version) => {
    const parts = String(version || '').split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return '30040000';
    const [major, minor, patch = 0] = parts;
    return String(major * 10000000 + minor * 10000 + patch * 100);
};
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
    'login_cookie_import',
    'pc_login',
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
    const signer = createSodaSigner();

    /**
     * 带应用签名的 VIP 取流。未签名时平台返回 HTTP 200 + 0 字节，所以这里必须先把
     * X-Helios / X-Medusa 签上；播放地址（MainPlayUrl）拿到后下载并用 playAuth 解密。
     */
    const signedPlay = async (trackId, quality) => {
        const session = sessionStore?.get();
        const cookie = session?.platforms?.qishui?.cookie || '';
        if (!cookie) throw new Error('签名取流需要登录 cookie');
        const deviceId = findPcDeviceId() || String(session?.platforms?.qishui?.deviceId || '');
        if (!deviceId) throw new Error('没有找到客户端的 device_id');
        // 客户端版本跟着实际安装的走：签名覆盖全部请求头，UA 与 version 参数必须和别的头对得上。
        const versionName = signer.version || DEFAULT_CLIENT_VERSION;
        const ua = signer.version ? `LunaPC/${versionName}` : UA_LUNA;
        const body = JSON.stringify({
            track_id: String(trackId), media_type: 'track', queue_type: 'search_one_track', scene_name: 'search',
        });
        const params = new URLSearchParams({
            aid: '386088', app_name: 'luna_pc', region: 'cn', geo_region: 'cn', os_region: 'cn',
            sim_region: '', device_id: deviceId, cdid: '', iid: '', version_name: versionName, version_code: versionCodeOf(versionName),
            channel: 'official', build_mode: 'master', network_carrier: '', ac: 'wifi',
            tz_name: 'Asia/Shanghai', resolution: '', device_platform: 'windows', device_type: 'Windows',
            os_version: 'Windows 10', fp: deviceId,
        });
        const url = `${API_HOST}/luna/pc/track_v2?${params}`;
        const headers = {
            'User-Agent': ua,
            'Content-Type': 'application/json; charset=utf-8',
            'X-SS-STUB': md5Upper(body),
            Cookie: cookie,
            'X-Luna-Background-Type': 'foreground',
            'X-Luna-Is-Background-Req': '0',
            'X-Luna-Is-Local-User': '1',
        };
        const signature = signer.sign({ url, headers, deviceId });
        const answer = await requestFactory(url, { method: 'POST', headers: { ...headers, ...signature }, body });
        const text = await answer.text();
        console.info('[Soda] signed track_v2:', answer.status, text.length, 'bytes', '| client', versionName);
        if (!text) throw new Error(`签名请求被清空（HTTP ${answer.status}，0 字节）`);
        const payload = JSON.parse(text);
        const trackPlayer = payload?.track_player ?? payload?.trackPlayer ?? {};
        const wanted = quality === 'standard' ? 128000 : quality === 'high' ? 320000 : 999999;
        const pick = (list) => (Array.isArray(list) ? list : [])
            .map((item) => ({
                url: item?.main_url || item?.MainPlayUrl || item?.backup_url || item?.BackupPlayUrl || '',
                auth: item?.encrypt_info?.spade_a || item?.PlayAuth || item?.encrypt_info?.SpadeA || '',
                bitrate: Number(item?.bitrate ?? item?.bit_rate ?? item?.Bitrate ?? item?.BitRate ?? 0),
                keys: item && typeof item === 'object' ? Object.keys(item).join(',') : '',
            }))
            .filter((item) => item.url)
            // 先取离目标码率最近的一档，同距离时取码率高的。
            .sort((a, b) => Math.abs((a.bitrate || wanted) - wanted) - Math.abs((b.bitrate || wanted) - wanted) || b.bitrate - a.bitrate);

        // 现行 LunaPC 的整曲信息在 track_player.video_model.video_list；老的 url_player_info 也留着兜底。
        let streams = [];
        const videoModel = trackPlayer.video_model ?? trackPlayer.videoModel;
        if (videoModel) {
            let parsed = videoModel;
            if (typeof videoModel === 'string') {
                try { parsed = JSON.parse(videoModel); } catch { parsed = null; }
            }
            streams = pick(parsed?.video_list ?? parsed?.VideoList ?? parsed?.data?.play_info_list ?? parsed?.PlayInfoList);
        }
        const playerUrl = trackPlayer.url_player_info ?? trackPlayer.urlPlayerInfo;
        if (streams.length === 0 && playerUrl) {
            const player = await (await requestFactory(playerUrl, { headers: { 'User-Agent': UA_LUNA } })).json();
            streams = pick(player?.Result?.Data?.PlayInfoList ?? player?.data?.play_info_list);
        }
        if (streams.length === 0) {
            console.info('[Soda] signed track_v2 shape:', Object.keys(trackPlayer).join(','));
            throw new Error('没找到可播的流（video_model 与 url_player_info 都没有流）');
        }
        const best = streams[0];
        console.info('[Soda] signed stream: bitrate', best.bitrate || 'unknown', '| auth', best.auth ? 'yes' : 'no', '| keys', best.keys || '');
        const playAuth = best.auth;
        const audioUrl = best.url;
        const streamAnswer = await requestFactory(audioUrl, { headers: { 'User-Agent': UA_LUNA } });
        const media = Buffer.from(await streamAnswer.arrayBuffer());
        console.info('[Soda] stream fetch:', streamAnswer.status, media.length, 'bytes', streamAnswer.headers?.get?.('content-type') || '');
        if (!media.length) throw new Error(`音频流是空的（HTTP ${streamAnswer.status}）`);
        let decrypted = media;
        if (playAuth) {
            decrypted = decryptAudio(media, playAuth);
            console.info('[Soda] decrypted:', decrypted.length, 'bytes');
            if (!decrypted.length) throw new Error('解密结果是空的（playAuth 可能不匹配）');
        }
        const dir = typeof cacheDir === 'function' ? cacheDir() : cacheDir;
        if (!dir || !audio) throw new Error('没有缓存目录');
        mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${trackId}-${quality || 'higher'}.m4a`);
        writeFileSync(filePath, decrypted);
        console.info('[Soda] signed play ok:', decrypted.length, 'bytes');
        return { url: audio.register(filePath, 'audio/mp4'), quality, ext: 'm4a' };
    };

    // ly-music-source 是纯 ESM，主进程是 CJS：用动态 import 加载一次（和 electron/ytm 引 youtubei.js 一样）。
    let clientPromise = null;
    const musicClient = () => {
        if (!clientPromise) {
            clientPromise = (async () => {
                const { createMusicSource } = await import('ly-music-source');
                const client = createMusicSource({ timeoutMs });
                const saved = sessionStore?.get();
                const cookie = saved?.platforms?.qishui?.cookie || '';
                if (saved) {
                    try { client.importSession(saved); } catch (error) {
                        console.warn('[Soda] session restore failed:', error?.message || error);
                    }
                }
                // importSession 认不回来（包内部校验或旧格式）时，用 cookie 再装一次：
                // 两条路都试过还是没登录，才把账号当成没人。
                if (cookie && !client.getAuthState()?.authenticated) {
                    try { client.importCookie('qishui', cookie); } catch (error) {
                        console.warn('[Soda] cookie restore failed:', error?.message || error);
                    }
                }
                console.info('[Soda] restored session:', client.getAuthState()?.authenticated ? 'signed in' : 'nobody');
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
            console.info('[Soda] QR created; expires', session?.expireTime ?? 'unknown');
            return { token: String(session?.token ?? ''), qrcode: session?.qrcode ? String(session.qrcode) : '', expireTime: Number(session?.expireTime) || undefined };
        },
        async login_qr_poll({ token }) {
            if (!token) throw new Error('missing QR token');
            const client = await musicClient();
            const result = await client.pollQrLogin('qishui', token);
            if (result?.status === 'confirmed') sessionStore?.set(client.exportSession());
            // 只记状态和平台的提示，不记 cookie。
            console.info('[Soda] QR poll:', result?.status, result?.message ? `(${result.message})` : '');
            return { status: String(result?.status ?? 'failed'), message: result?.message ? String(result.message) : undefined };
        },
        /**
         * 从汽水音乐 PC 客户端（SodaMusic，Electron）里读出已登录的会话并导入。
         * 平台会拒绝第三方客户端的扫码登录（passport 回 1049），所以官方客户端那份是唯一可靠的来源。
         */
        async pc_login() {
            const found = readPcSession();
            const client = await musicClient();
            client.importCookie('qishui', found.cookie);
            const profile = await client.getProfile('qishui');
            if (!profile?.id) throw new Error('客户端会话没有被平台接受（profile 为空）');
            sessionStore?.set(client.exportSession());
            // 只记 cookie 的名字，值不进日志。
            console.info('[Soda] PC client session imported:', found.userDataDir, '| cookies:', found.names.join(','));
            return { ok: true, profile, cookies: found.names };
        },
        /** 扫码走不通时的退路：把浏览器里登录后的 cookie 整串交进来。 */
        async login_cookie_import({ cookie }) {
            const text = String(cookie || '').trim();
            if (!text) throw new Error('missing cookie');
            const client = await musicClient();
            client.importCookie('qishui', text);
            const profile = await client.getProfile('qishui');
            sessionStore?.set(client.exportSession());
            console.info('[Soda] Cookie imported for', profile?.nickname ? 'an account' : 'an unknown account');
            return { ok: true, profile };
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
            const items = await client.listUserPlaylists({ limit, cursor });
            // 只记种类，不记名字：用来确认「我喜欢」在包里叫什么。
            console.info('[Soda] user playlists:', (items || []).map((item) => item?.kind || 'unknown').join(','));
            return { items };
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
            const wanted = quality || 'higher';
            // 有官方签名模块时先走签名：需要 resolve 的绝大多数是付费歌，包那条必然拿不到。
            if (signer.available) {
                try {
                    return await signedPlay(String(songId), wanted);
                } catch (error) {
                    console.info('[Soda] signed play failed:', error?.message || error);
                }
            }
            // 再走包（免签名的路径）：能拿到地址或解密后的整首就用它。
            try {
                const client = await musicClient();
                const result = await client.resolve({ ids: { qishui: String(songId) }, quality: wanted });
                if (result?.url) {
                    return { url: String(result.url), quality: result.quality ?? quality, preview: Boolean(result.preview) };
                }
                let filePath = result?.filePath ? String(result.filePath) : '';
                const ext = String(result?.ext || 'm4a').replace(/[^a-z0-9]/gi, '') || 'm4a';
                if (!filePath && result?.data) {
                    const dir = typeof cacheDir === 'function' ? cacheDir() : cacheDir;
                    if (!dir) throw new Error('no cache directory for Soda audio');
                    mkdirSync(dir, { recursive: true });
                    filePath = path.join(dir, `${songId}-${wanted}.${ext}`);
                    writeFileSync(filePath, result.data);
                }
                if (filePath && audio) {
                    return { url: audio.register(filePath, String(result?.mimeType || 'audio/mp4')), quality: result?.quality ?? quality, ext };
                }
            } catch (error) {
                console.info('[Soda] package resolve failed:', error?.message || error);
            }
            // 再走官方客户端的应用签名（VIP 整首只有这条路）。
            try {
                return await signedPlay(String(songId), wanted);
            } catch (error) {
                console.info('[Soda] signed play failed:', error?.message || error);
                return { url: '' };
            }
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
