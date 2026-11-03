import { OnlineProviderError } from '../../../types/onlineMusic';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';
import { withLoginRequestLimit } from '../login/loginRequestLimit';
import { withOnlineRequestLimit } from '../failure/onlineRequestLimit';
import { lyricProxyWebUrl } from '../../lyricProxy';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/qq/qqTransport.ts

export const QQ_OPERATIONS = [
    'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_qr_cancel', 'login_status', 'logout',
    'login_channels', 'login_refresh',
    'user_detail', 'user_playlist', 'user_albums', 'user_liked_songs', 'user_playlist_detail',
    'user_guess_you_like', 'user_daily_songs', 'recommend_playlists',
    'user_playlist_tracks', 'user_playlist_subscribe', 'user_subscription_status',
    'user_song_like', 'user_album_subscribe',
    'user_vip', 'user_cloud', 'user_playlist_create',
    'recommend_new_songs', 'recommend_new_albums', 'recommend_toplists', 'recommend_toplist',
    'recommend_categories', 'recommend_category_playlists', 'recommend_radar',
    'radio_list', 'radio_tracks', 'song_similar',
    'music_play', 'song_list_detail', 'song_info',
    'album_info', 'artist_albums', 'artist_songs',
    'search',
] as const;

export type QqOperation = typeof QQ_OPERATIONS[number];
export type QqParams = Record<string, string | number | boolean | undefined>;

// 写入路由只收 POST + JSON 正文；GET 会回 405。
const POST_OPERATIONS: ReadonlySet<QqOperation> = new Set<QqOperation>([
    'login_refresh',
    'user_playlist_tracks', 'user_playlist_subscribe', 'user_song_like', 'user_album_subscribe',
    'user_playlist_create',
]);

const ENDPOINTS: Record<QqOperation, string> = {
    login_qr_key: '/login/qr/key',
    login_qr_create: '/login/qr/create',
    login_qr_check: '/login/qr/check',
    login_qr_cancel: '/login/qr/cancel',
    login_status: '/login/status',
    logout: '/logout',
    // 只有 3.0.0 之后的后端有这条路由，旧后端回 404，调用方要把它当成「没有声明」而不是错误。
    login_channels: '/login/channels',
    // 3.3.2 起的主动续期：Serverless 在快到期时换新 token。旧后端照例 404 → `unsupported`（qqSessionRefresh.ts）。
    login_refresh: '/login/refresh',
    user_detail: '/user/detail',
    user_playlist: '/user/playlist',
    user_albums: '/user/albums',
    user_liked_songs: '/user/liked-songs',
    // 带凭据地读登录用户自己的歌单。匿名的 `song_list_detail` 读不了不公开的歌单，这条可以。
    // 与 `login_channels` 同样的处境：旧后端没有这条路由，回 404，调用方要当成「没有声明」。
    user_playlist_detail: '/user/playlist-detail',
    // 以下是 3.2.0 / 3.3.0 新增的路由：推荐三条要登录（推荐歌单可匿名），写入两条只对本人的歌单生效。
    // 旧后端一律 404，transport 照例报成 `unsupported`，由调用方决定回落还是报错。
    user_guess_you_like: '/user/guess-you-like',
    user_daily_songs: '/user/daily-songs',
    recommend_playlists: '/recommend/playlists',
    user_playlist_tracks: '/user/playlist/tracks',
    user_playlist_subscribe: '/user/playlist/subscribe',
    user_subscription_status: '/user/subscription-status',
    // 3.3.1 的红心与收藏专辑：写一次、读回确认后才回成功，结果不明回 502。
    user_song_like: '/user/song/like',
    user_album_subscribe: '/user/album/subscribe',
    // 3.3.3：会员等级、音乐云盘、建自己的歌单，都要登录。
    user_vip: '/user/vip',
    user_cloud: '/user/cloud',
    user_playlist_create: '/user/playlist/create',
    // 3.3.3 探索页用的路由。新歌、新碟、排行榜、歌单分类读的是公开内容，刷歌模式没登录也能读；
    // 电台和相似歌曲要登录。没有数据回 422，旧后端没有这些路由回 404。
    recommend_new_songs: '/recommend/new-songs',
    recommend_new_albums: '/recommend/new-albums',
    recommend_toplists: '/recommend/toplists',
    recommend_toplist: '/recommend/toplist',
    recommend_categories: '/recommend/categories',
    recommend_category_playlists: '/recommend/category-playlists',
    recommend_radar: '/recommend/radar',
    radio_list: '/radio/list',
    radio_tracks: '/radio/tracks',
    song_similar: '/song/similar',
    music_play: '/getMusicPlay',
    song_list_detail: '/getSongListDetail',
    song_info: '/getSongInfo',
    // 曲库端点用领域语汇命名，与 provider 的 getAlbum* / getArtist* 一一对应，不沿用上游的 singer_* 路径名。
    // 上游这三条路由虽然声明了路径参数，但 controller 只读 ctx.query，所以一律走 query string。
    album_info: '/getAlbumInfo',
    artist_albums: '/getSingerAlbum',
    artist_songs: '/getSingerHotsong',
    // 3.3.1 的关键字搜索：有会话就带会话搜。匿名搜歌常被上游以 2001 拒绝（#473），带会话的不受这个限额影响。
    // 拒绝回 502 `search.rejected`；旧后端没有这条路由，照例 404 → `unsupported`。
    search: '/search',
};

// The requests a sign-in waits for. They get the sign-in's time limit.
const LOGIN_REQUESTS: ReadonlySet<QqOperation> = new Set(['login_qr_key', 'login_qr_create', 'login_qr_check']);
// The requests for a song's address and a collection's tracks. They get the limit below; no other
// backend request has one. The requests sent to musicu directly (`requestQqMusicu`) have a limit of
// their own, `QQ_MUSICU_REQUEST_LIMIT_MS`.
const ONLINE_REQUESTS: ReadonlySet<QqOperation> = new Set([
    'music_play', 'song_list_detail', 'user_playlist_detail', 'user_liked_songs', 'album_info',
    'user_cloud', 'recommend_toplist', 'radio_tracks',
]);
// Their limit, above the backend's own slowest answer. A signed-in play link is at worst four steps in a
// row (qq-music-api, services/auth/qrLogin.js): GetVkey, a 5 s CDN probe, GetCdnDispatch and a second
// 5 s probe, each call to QQ limited to 25 s (services/auth/httpClient.js): 60 s in all.
export const QQ_ONLINE_REQUEST_LIMIT_MS = 70_000;

// qq-music-api translates the native QR states into the Netease codes; 803 is the only one carrying a session.
const QR_CONFIRMED_CODE = 803;

const getWebApiBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_QQ_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_QQ_API_BASE || '')
        : '';
    const value = viteValue || processValue;
    return value.trim().replace(/\/$/, '');
};

// Electron embeds qq-music-api and starts it on a free port, so the base is only known at runtime.
const getElectronQqPortReader = (): (() => Promise<number | null>) | null => {
    if (typeof window === 'undefined') return null;
    const reader = window.electron?.getQqPort;
    return typeof reader === 'function' ? () => reader() : null;
};

// What a request fails with where the desktop app's embedded backend has no port: the sentence
// starts with it, and goes on with the status the main process gives (`describeEmbeddedStatus`).
// The sign-in dialog tells this failure apart by it (qqLoginFailure.ts).
export const QQ_API_NOT_RUNNING = 'Embedded QQMusicApi is not running';

// What a request fails with where the web build has no backend address configured.
export const QQ_API_BASE_MISSING = 'VITE_QQ_API_BASE is not configured';

let electronApiBase: string | null = null;

export const resetQqTransportRuntimeCache = (): void => {
    electronApiBase = null;
};

// 内嵌后端没在监听时，把主进程报的状态与故障原因带进错误：时间线里直接能看到它为什么没起来。
const describeEmbeddedStatus = async (): Promise<string> => {
    try {
        const status = await window.electron?.getQqApiStatus?.();
        return status ? ` (status ${status.status}${status.error ? `: ${status.error}` : ''})` : '';
    } catch {
        return '';
    }
};

// 主进程这次启动没能读出加密的登录仓库（electron/qq/qqAuthSessionRepository.cjs：这次没有系统加密），这次运行里也还没有
// 新登录替掉它：内嵌后端里没有一个会话是这次运行之前的。网页版没有这个仓库；状态问不到时也当作读出来了，和以前一样。
// 读得出（或被替掉）以后整次运行都不会再变回去，所以只记下「读得出」；读不出时每次现问，这次运行里的新登录一到，下一个
// 请求就照常带上它（页面重新载入以后也是）。lastStoreUnreadable 是最近一次问到的答案，给要同步判断的地方用（hasUsableQqSession）。
let storeReadable = false;
let lastStoreUnreadable = false;
const isQqSessionStoreUnreadable = async (): Promise<boolean> => {
    if (storeReadable) return false;
    const readStatus = typeof window === 'undefined' ? undefined : window.electron?.getQqApiStatus;
    if (typeof readStatus !== 'function') {
        storeReadable = true;
        return false;
    }
    try {
        const status = await readStatus();
        const unreadable = Boolean(status?.sessionStoreUnreadable);
        if (status?.status === 'running' && !unreadable) storeReadable = true;
        lastStoreUnreadable = unreadable;
        return unreadable;
    } catch {
        return false;
    }
};

const resolveApiBase = async (): Promise<string> => {
    const readPort = getElectronQqPortReader();
    if (readPort) {
        if (electronApiBase) return electronApiBase;
        const port = await readPort();
        if (!port) {
            throw new OnlineProviderError('unavailable', `${QQ_API_NOT_RUNNING}${await describeEmbeddedStatus()}`, 'qq');
        }
        electronApiBase = `http://127.0.0.1:${port}`;
        return electronApiBase;
    }

    const base = getWebApiBase();
    if (!base) {
        // 网页版没配后端地址：这里用不了 QQ 音乐，再试也一样（qqFailure.ts 说它是「没有配置」）。
        throw new OnlineProviderError('unavailable', QQ_API_BASE_MISSING, 'qq');
    }
    return base;
};

// The stored value is the backend's opaque `qqmusic_session=<token>` string, never a QQ credential.
const getWebSessionCookie = (): string => readProviderSessionValue('qq', 'cookie') || '';

const SESSION_COOKIE_NAME = 'qqmusic_session';
const SESSION_HEADER_NAME = 'X-QQ-Session';

// 后端两个入口的语义不同，不能互换：header 收的是裸 token，`?cookie=` 收的是整串 cookie。
const tokenFromCookieString = (cookie: string): string => {
    for (const entry of cookie.split(';')) {
        const separator = entry.indexOf('=');
        if (separator <= 0) continue;
        if (entry.slice(0, separator).trim() === SESSION_COOKIE_NAME) return entry.slice(separator + 1).trim();
    }
    return '';
};

// 同源部署（`/api/qq`、`/qq`）改走 header：sealed token 是密文本身，query 是它唯一会被 CDN 与
// edge access log 完整记下来的地方 —— 那是 sealed 相对不透明 token 唯一真正新增的泄漏面。
// 外部 URL 与 Electron 维持 `?cookie=`：跨源发自定义头会触发 preflight，而后端是
// `Access-Control-Allow-Origin: *`，按规范不允许搭配 credentials。
const isSameOriginBase = (base: string): boolean => base.startsWith('/');

export const hasQqSession = (): boolean => Boolean(getWebSessionCookie());

/**
 * 存着的 session 是不是停用的那个：主进程这次启动没读出加密的登录仓库、这次运行里也还没有新登录（isQqSessionStoreUnreadable），
 * 存着的就只能是之前一次运行的，后端不可能认得，带上它每个要登录的请求（连播放）都回 401。所以这次不带它（requestQq），按游客播放；
 * 它照旧存着，等能读出仓库的那次启动，读账号时报「查不到」而不是「没登录」（qqProvider 的 getLoginStatus）。这次运行里扫码登录过，
 * 仓库里读不出的那份就被替掉了：之后存着的 session 照常带，到期了也照常清掉。
 */
export const isQqSessionParked = async (): Promise<boolean> => hasQqSession() && await isQqSessionStoreUnreadable();

/**
 * 有 session，而且这次请求会带上它：只有登录才有的栏目、推荐、收藏状态、试听按它分开走，停用的 session（isQqSessionParked）照游客走。
 * 要同步回答，用的是最近一次问到的仓库状态；还没问过时当作能带。读账号、退出登录、续期仍看 hasQqSession。
 */
export const hasUsableQqSession = (): boolean => hasQqSession() && !lastStoreUnreadable;

export const clearQqSession = (): void => removeProviderSessionValue('qq', 'cookie');

// 后端的退避时长（qq-music-api 在 429 的响应体里给 retryAfterMs，同时带 Retry-After 头，单位是秒）。
// 只收非负安全整数，读不出就不给，调用方按普通失败处理。
const readRetryAfterMs = (body: unknown, response: Response): number | undefined => {
    const fromBody = body && typeof body === 'object' ? (body as { retryAfterMs?: unknown }).retryAfterMs : undefined;
    if (typeof fromBody === 'number' && Number.isSafeInteger(fromBody) && fromBody >= 0) return fromBody;
    const raw = response.headers?.get?.('Retry-After')?.trim();
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : undefined;
};

const readJsonBody = async (response: Response): Promise<any> => {
    try {
        return await response.json();
    } catch {
        return undefined;
    }
};

// 后端失败正文的原文：多数路由写在 `message`，播放等路由的 500 只给 `{ error }`（observability.js），两处都认。
// 3.2.0 起的新路由另带固定的 `errorKey`（如 `playlist.already-applied`）与可选的上游数字码，`message` 只是通用英文，
// 所以把这两样一起写进原文，诊断里才看得出是哪一类失败。
export const readBackendMessage = (failure: any): string => {
    let text = '';
    for (const candidate of [failure?.message, failure?.error]) {
        if (typeof candidate === 'string' && candidate.trim()) {
            text = candidate.trim();
            break;
        }
    }
    const errorKey = typeof failure?.errorKey === 'string' ? failure.errorKey.trim() : '';
    const upstreamCode = Number.isSafeInteger(failure?.upstreamCode) ? ` upstream ${failure.upstreamCode}` : '';
    if (!errorKey) return text;
    return `${errorKey}${upstreamCode}${text ? `: ${text}` : ''}`;
};

// qq-music-api 的 QqProtocolError 模板（dist/src/services/auth/qrLogin.js 的 callMusicu）：musicu 已经应答（HTTP 2xx），
// 只是带了非零的全局码或 req_0 码，后端的 handleControllerError 一律把它包成 500 `{ error }`。
const QQ_PROTOCOL_REFUSAL = /\bfailed \(HTTP 2\d\d, global=(-?\d+), code=(-?\d+|unknown)\)/;

// 从 500 正文里认出「上游有应答、只是业务拒绝」，返回上游码：req_0 的码优先，缺失时退回全局码，
// 两者都没有（应答里没有 req_0）记作 'missing'。认不出就返回 undefined，按普通 5xx 处理。
export const readUpstreamRefusalCode = (backendText: string): number | string | undefined => {
    const match = QQ_PROTOCOL_REFUSAL.exec(backendText);
    if (!match) return undefined;
    const [, globalCode, requestCode] = match;
    if (requestCode !== 'unknown' && Number(requestCode) !== 0) return Number(requestCode);
    if (Number(globalCode) !== 0) return Number(globalCode);
    return 'missing';
};

// 曲库三条路由被上游拒收时仍然回 HTTP 200，状态码藏在响应体里，而且层级还不一样：
// `/getAlbumInfo` 直接是 `response.code`（参数类型错时是 1101 `para error!`），
// 两条歌手路由的 `response.code` 恒为 0，真正的状态在 `response.singer.code`（400 / 104400）。
// 不看这两层就会把「被拒收」当成「这个专辑没有曲目」，UI 只剩一片空白，线上很难定位。
// 登录与播放路由用的是另一套码值（如 `login_status` 回 200），故不纳入此检查。
const CATALOG_STATUS_NODES: Partial<Record<QqOperation, string[][]>> = {
    album_info: [['response']],
    // 歌单详情的上游是匿名 CGI：歌单不存在、不公开或参数不被接受时它照样回 HTTP 200，
    // 差别只在这个 `code` 上。不登记的话拒绝会一路变成空歌单，UI 只剩「暂无内容」。
    song_list_detail: [['response']],
    artist_songs: [['response'], ['response', 'singer']],
    artist_albums: [['response'], ['response', 'singer']],
};

const readNode = (body: any, path: string[]): any => (
    path.reduce((node, key) => (node === null || node === undefined ? node : node[key]), body)
);

const assertUpstreamAccepted = (operation: QqOperation, body: any): void => {
    for (const path of CATALOG_STATUS_NODES[operation] ?? []) {
        const node = readNode(body, path);
        const code = Number(node?.code);
        if (!Number.isFinite(code) || code === 0) continue;

        const subcode = Number(node?.subcode);
        const message = typeof node?.message === 'string' ? node.message.trim() : '';
        throw new OnlineProviderError(
            'invalid-response',
            `QQMusicApi ${operation} was rejected upstream at ${path.join('.')} (code ${code}`
            + `${Number.isFinite(subcode) && subcode !== code ? `, subcode ${subcode}` : ''})`
            + `${message ? `: ${message}` : ''}`,
            'qq',
            node,
        );
    }
};

const persistConfirmedSession = (operation: QqOperation, body: any): void => {
    if (operation !== 'login_qr_check' || Number(body?.code) !== QR_CONFIRMED_CODE) return;
    const cookie = body?.cookie;
    if (typeof cookie === 'string' && cookie) writeProviderSessionValue('qq', 'cookie', cookie);
};

/** 网页版配置的远端 API 地址（自检与诊断报告用）；桌面版走内嵌后端，返回 null。 */
export const getQqRemoteApiBase = (): string | null => (getElectronQqPortReader() ? null : getWebApiBase() || null);

export const getQqTransportAvailability = () => {
    if (getElectronQqPortReader()) return { configured: true } as const;
    return getWebApiBase()
        ? { configured: true } as const
        : { configured: false, reason: 'not-configured' as const };
};

const endpointFor = (operation: QqOperation, params: QqParams): { path: string; query: QqParams } => {
    const query = { ...params };
    const takeRequiredPathParam = (name: string): string => {
        const value = query[name];
        delete query[name];
        const pathValue = value === undefined ? '' : String(value).trim();
        if (!pathValue) {
            throw new OnlineProviderError(
                'invalid-response',
                `QQMusicApi ${operation} requires ${name}`,
                'qq',
            );
        }
        return encodeURIComponent(pathValue);
    };

    if (operation === 'music_play') {
        return { path: `${ENDPOINTS[operation]}/${takeRequiredPathParam('songmid')}`, query };
    }
    if (operation === 'song_list_detail') {
        return { path: `${ENDPOINTS[operation]}/${takeRequiredPathParam('disstid')}`, query };
    }
    if (operation === 'song_info') {
        const songmid = takeRequiredPathParam('songmid');
        const songid = query.songid;
        delete query.songid;
        return {
            path: `${ENDPOINTS[operation]}/${songmid}${songid === undefined ? '' : `/${encodeURIComponent(String(songid))}`}`,
            query,
        };
    }
    return { path: ENDPOINTS[operation], query };
};

// The session a request carried is dropped; one that was stored since stays.
const dropSessionSent = (sent: string): void => {
    if (getWebSessionCookie() === sent) clearQqSession();
};

// 一个不是 login_status 的请求带着 session 回了 401：问一次 login_status。后端不再认出这个用户、存着的又还是吃了 401 的
// 那个 session，就清掉它，之后的请求按游客走（免费的歌照常能播）；还认得就留着，问不到也留着。同一时间只问一次。
let sessionCheck: Promise<void> | null = null;
const checkSessionAfterRefusal = (sent: string): void => {
    if (sessionCheck || getWebSessionCookie() !== sent) return;
    sessionCheck = requestQq<any>('login_status').then(
        body => !body?.data?.profile,
        error => error instanceof OnlineProviderError && error.code === 'auth-required',
    ).then(ended => {
        console.info(`[QQ] A request was refused with 401; login_status ${ended ? 'no longer names the account, the session goes' : 'did not say the sign-in ended, the session stays'}`);
        if (ended) dropSessionSent(sent);
    }).finally(() => {
        sessionCheck = null;
    });
};

// Routes one provider request through the embedded Electron server or the configured Web base URL.
// It carries the session as the page keeps it when the request is made, before the first wait.
// 写入路由（POST_OPERATIONS）的参数放在 JSON 正文 `payload` 里；会话照旧走 header 或 `?cookie=`，后端两条路由都认。
export const requestQq = async <T = unknown>(
    operation: QqOperation,
    params: QqParams = {},
    payload?: Record<string, unknown>,
): Promise<T> => {
    const isPost = POST_OPERATIONS.has(operation);
    if (isPost !== (payload !== undefined)) {
        throw new OnlineProviderError(
            'invalid-response',
            `QQMusicApi ${operation} ${isPost ? 'requires' : 'does not take'} a request body`,
            'qq',
        );
    }
    const stored = getWebSessionCookie();
    const base = await resolveApiBase();
    // The session parked for this run is not sent (isQqSessionParked). The status is read once the backend has a port.
    const cookie = stored && await isQqSessionStoreUnreadable() ? '' : stored;

    const endpoint = endpointFor(operation, params);
    const query = new URLSearchParams();
    Object.entries(endpoint.query).forEach(([key, value]) => {
        if (value !== undefined) query.set(key, String(value));
    });
    const headers: Record<string, string> = {};
    if (cookie) {
        if (isSameOriginBase(base)) {
            const token = tokenFromCookieString(cookie);
            // 同源请求不允许把未知格式的 session 放回 URL；清掉无效值，交给后端按未登录处理。
            if (token) headers[SESSION_HEADER_NAME] = token;
            else dropSessionSent(cookie);
        } else {
            query.set('cookie', cookie);
        }
    }
    query.set('timestamp', String(Date.now()));

    // Same-origin serverless calls must retain deployment-protection cookies; external qq-music-api instances
    // answer with `Access-Control-Allow-Origin: *`, so those requests still omit browser credentials.
    const credentials: RequestCredentials = isSameOriginBase(base) ? 'same-origin' : 'omit';
    const init: RequestInit = isPost
        ? { method: 'POST', credentials, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        : { credentials, headers };
    // The answer and its body, read together: the time limit covers both.
    const send = async (signal?: AbortSignal) => {
        const answer = await fetch(`${base}${endpoint.path}?${query}`, { ...init, ...(signal ? { signal } : {}) });
        return { response: answer, body: await readJsonBody(answer) };
    };
    const { response, body } = await (LOGIN_REQUESTS.has(operation) ? withLoginRequestLimit(send)
        : ONLINE_REQUESTS.has(operation) ? withOnlineRequestLimit(send, QQ_ONLINE_REQUEST_LIMIT_MS) : send());
    if (!response.ok) {
        // A missing, expired, rejected, or non-persisted backend session is surfaced uniformly as 401.
        // The session does not go at once: any route answers 401 when QQ refuses that one call (upstream 1000 / 104401 /
        // 104400), which does not by itself say the sign-in ran out. login_status is asked once and decides
        // (checkSessionAfterRefusal); at an account read login_status itself decides (accountRead, signInRanOut).
        if (response.status === 401) {
            if (operation !== 'login_status' && cookie) checkSessionAfterRefusal(cookie);
            throw new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', body, response.status);
        }
        // 404 是「这个后端没有这条路由」，不是网络故障 —— 用户可以自行部署任意版本的后端，
        // 新路由在旧后端上必然 404。报成 `unsupported`，调用方才能据此回落到旧路径，
        // 而不必去解析错误文案里的状态码。
        if (response.status === 404) {
            throw new OnlineProviderError(
                'unsupported',
                `QQMusicApi has no ${operation} route`,
                'qq',
                body,
                response.status,
            );
        }
        // The status is in the sentence, the backend's answer in the cause (qqFailure.ts reads both), and the wait a
        // 429 asks for on the error.
        throw new OnlineProviderError('network', `QQMusicApi request failed: ${response.status}`, 'qq', body, response.status, readRetryAfterMs(body, response));
    }

    if (body === undefined) {
        throw new OnlineProviderError('invalid-response', `QQMusicApi returned an unreadable ${operation} body`, 'qq');
    }
    assertUpstreamAccepted(operation, body);
    persistConfirmedSession(operation, body);
    return body as T;
};

/** One request inside a musicu call: a module, its method and the method's parameters. */
export interface QqMusicuRequest {
    module: string;
    method: string;
    param: Record<string, unknown>;
}

/** What musicu answered for one request of the call: its own code, and its data. */
export interface QqMusicuAnswer {
    code: number | undefined;
    data: unknown;
}

// QQ 自己的 musicu 入口。QQ 歌词与匿名搜歌也发到这里（qqLyricProvider.ts）。
export const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

// 和上游 qq-music-api 的 getSongInfo 发的 comm 相同。
const QQ_MUSICU_COMM = { ct: 24, cv: 0 };

// 时限：实测一次 0.3–3.1 s；比 folium.omni 闸门每次的 30 s 短，到点是我们自己的 network（OnlineRequestTimeout），请求被中止。
export const QQ_MUSICU_REQUEST_LIMIT_MS = 20_000;

// 网页中转（api-ts/lyric-proxy.ts、worker/lyric-proxy.ts）自己连不上 QQ 时回 500 / 502，这两个说的不是 QQ 的状态
// （别的平台经这个中转的旧接口也是这样读的）。
const isLyricProxyOwnFailureStatus = (status: number): boolean => status === 500 || status === 502;

// 一个子请求的码：有数就是那个数，缺失、空值或读不成数就是 undefined（不能让 null 被读成 0）。
const readMusicuCode = (value: unknown): number | undefined => {
    if (typeof value !== 'number' && typeof value !== 'string') return undefined;
    if (typeof value === 'string' && !value.trim()) return undefined;
    const code = Number(value);
    return Number.isFinite(code) ? code : undefined;
};

/**
 * 直接向 QQ 的 musicu 发一次匿名请求（不经 qq-music-api 后端）：`requests` 的每个 key 是一个子请求，一次交给 musicu。
 * 桌面端直连（主进程给 *.qq.com 的回答补了 CORS 头，electron/main.cjs），网页版经前端同源的 `/api/lyric-proxy`；
 * 不看内嵌后端的端口和 VITE_QQ_API_BASE，两者都没有时也能发。不带会话：这里只读公开数据，也不随登录状态变。
 * 返回每个 key 的 { code, data }；整次被拒（全局 code ≠ 0）、读不出、连不上时抛 OnlineProviderError。
 */
export const requestQqMusicu = async (
    requests: Readonly<Record<string, QqMusicuRequest>>,
): Promise<Record<string, QqMusicuAnswer>> => {
    const direct = typeof window !== 'undefined' && Boolean(window.electron);
    const url = direct ? QQ_MUSICU_URL : lyricProxyWebUrl(QQ_MUSICU_URL);
    const init: RequestInit = {
        method: 'POST',
        // 网页版要带上同源的 cookie：Vercel 的部署保护靠它放行（qqLyricProvider.ts 同样这样发）。
        credentials: direct ? 'omit' : 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comm: QQ_MUSICU_COMM, ...requests }),
    };
    // The answer and its body, read together: the time limit covers both. A refused answer's body is not read.
    const send = async (signal: AbortSignal) => {
        const response = await fetch(url, { ...init, signal });
        return { response, text: response.ok ? await response.text() : '' };
    };

    let answer: { response: Response; text: string };
    try {
        answer = await withOnlineRequestLimit(send, QQ_MUSICU_REQUEST_LIMIT_MS);
    } catch (error) {
        // 到点没有回答：OnlineRequestTimeout 本身就是 network 的错，原样交出去。
        if (error instanceof OnlineProviderError) throw error;
        throw new OnlineProviderError('network', `QQ musicu unreachable: ${errorMessage(error)}`, 'qq', error);
    }

    const { response, text } = answer;
    if (!response.ok) {
        // 直连时状态就是 QQ 的；经网页中转时 500 / 502 是中转自己的失败，不带状态，其余是 QQ 的状态由中转转来
        // （没有中转的静态站点回的 404 / 405 也在这里：是 network，不是 unsupported）。
        // Retry-After 只在 Cloudflare 中转时读得到（它原样转发回答的头）；Vercel 与开发中转只转 Content-Type，桌面直连时
        // CORS 放行没有 Access-Control-Expose-Headers，渲染进程读不到这个头。读不到时 429 也照样算限流（看 httpStatus）。
        const httpStatus = direct || !isLyricProxyOwnFailureStatus(response.status) ? response.status : undefined;
        throw new OnlineProviderError(
            'network',
            `QQ musicu request failed: ${response.status}`,
            'qq',
            undefined,
            httpStatus,
            readRetryAfterMs(undefined, response),
        );
    }

    let body: any;
    try {
        body = JSON.parse(text);
    } catch (error) {
        // 例如只托管静态文件的站点把 POST 回成 index.html。
        throw new OnlineProviderError('invalid-response', 'QQ musicu returned an unreadable body', 'qq', error);
    }
    if (!body || typeof body !== 'object') {
        throw new OnlineProviderError('invalid-response', 'QQ musicu returned an unreadable body', 'qq', body);
    }
    const code = readMusicuCode(body.code);
    if (code !== 0) {
        // 实测一次超过 30 个子请求时整次 500000，各子请求也都是 500000、没有 data。
        throw new OnlineProviderError('invalid-response', `QQ musicu refused the request (code ${code ?? 'missing'})`, 'qq', { code });
    }

    const answers: Record<string, QqMusicuAnswer> = {};
    for (const key of Object.keys(requests)) {
        const node = body[key];
        answers[key] = { code: readMusicuCode(node?.code), data: node?.data };
    }
    return answers;
};
