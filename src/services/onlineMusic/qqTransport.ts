import { OnlineProviderError } from '../../types/onlineMusic';
import { dedupedRequest } from '../../utils/requestDedup';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from './providerStorage';

// src/services/onlineMusic/qqTransport.ts

export const QQ_OPERATIONS = [
    'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_qr_cancel', 'login_status', 'logout',
    'login_channels',
    'user_detail', 'user_playlist', 'user_albums', 'user_liked_songs', 'user_playlist_detail',
    'music_play', 'song_list_detail', 'song_info',
    'album_info', 'artist_albums', 'artist_songs',
    'smartbox',
    'recommend_radio', 'recommend_feed', 'recommend_radar', 'recommend_playlists', 'recommend_new_songs',
    'recommend_similar', 'recommend_radio_dislike',
    'like_song', 'unlike_song', 'playlist_songs', 'playlist_create',
    'song_list_categories', 'song_lists',
    'get_comments',
] as const;

export type QqOperation = typeof QQ_OPERATIONS[number];
export type QqParams = Record<string, string | number | boolean | undefined>;

const ENDPOINTS: Record<QqOperation, string> = {
    login_qr_key: '/login/qr/key',
    login_qr_create: '/login/qr/create',
    login_qr_check: '/login/qr/check',
    login_qr_cancel: '/login/qr/cancel',
    login_status: '/login/status',
    logout: '/logout',
    // 只有 3.0.0 之后的后端有这条路由，旧后端回 404，调用方要把它当成「没有声明」而不是错误。
    login_channels: '/login/channels',
    user_detail: '/user/detail',
    user_playlist: '/user/playlist',
    user_albums: '/user/albums',
    user_liked_songs: '/user/liked-songs',
    // 带凭据地读登录用户自己的歌单。匿名的 `song_list_detail` 读不了不公开的歌单，这条可以。
    // 与 `login_channels` 同样的处境：旧后端没有这条路由，回 404，调用方要当成「没有声明」。
    user_playlist_detail: '/user/playlist-detail',
    music_play: '/getMusicPlay',
    song_list_detail: '/getSongListDetail',
    song_info: '/getSongInfo',
    // 曲库端点用领域语汇命名，与 provider 的 getAlbum* / getArtist* 一一对应，不沿用上游的 singer_* 路径名。
    // 上游这三条路由虽然声明了路径参数，但 controller 只读 ctx.query，所以一律走 query string。
    album_info: '/getAlbumInfo',
    artist_albums: '/getSingerAlbum',
    artist_songs: '/getSingerHotsong',
    // 搜索联想（上游 splcloud 的 smartbox_new.fcg，匿名可调）。后端控制器读的是 query 里的
    // `key`，虽然路由声明了可选路径参数 —— 传 key 必须走 query string，路径里塞会得到 response: null。
    smartbox: '/getSmartbox',
    // 推荐面向的五路。这五条只存在于打过 recommend 补丁的后端；旧后端一律 404，调用方要按
    // 「这个后端没有推荐能力」降级，而不是当错误抛给用户。
    recommend_radio: '/recommend/radio',
    recommend_feed: '/recommend/feed',
    recommend_radar: '/recommend/radar',
    recommend_playlists: '/recommend/playlists',
    recommend_new_songs: '/recommend/new-songs',
    recommend_similar: '/recommend/similar',
    // 电台「不感兴趣」：把单曲从猜你喜欢画像拉黑。写操作，同样只在打过补丁的后端有，旧后端 404 降级。
    recommend_radio_dislike: '/recommend/radio/dislike',
    // 写操作族：红心 = 写进官方「我喜欢」目录（dirid 201）；歌单写 = 自建目录的加/删歌与新建。
    like_song: '/like/song',
    unlike_song: '/unlike/song',
    playlist_songs: '/playlist/songs',
    playlist_create: '/playlist/create',
    // 歌曲评论（legacy h5 通道，匿名回空、需登录态）。路由声明了路径参数但 controller 只读 query，走 query string。
    get_comments: '/getComments',
    song_list_categories: '/getSongListCategories',
    song_lists: '/getSongLists',
};

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

const resolveApiBase = async (): Promise<string> => {
    const readPort = getElectronQqPortReader();
    if (readPort) {
        if (electronApiBase) return electronApiBase;
        const port = await readPort();
        if (!port) {
            throw new OnlineProviderError('unavailable', `Embedded QQMusicApi is not running${await describeEmbeddedStatus()}`, 'qq');
        }
        electronApiBase = `http://127.0.0.1:${port}`;
        return electronApiBase;
    }

    const base = getWebApiBase();
    if (!base) {
        throw new OnlineProviderError('unavailable', 'VITE_QQ_API_BASE is not configured', 'qq');
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

// Routes one provider request through the embedded Electron server or the configured Web base URL.
export const requestQq = async <T = unknown>(operation: QqOperation, params: QqParams = {}): Promise<T> => {
    const base = await resolveApiBase();

    const endpoint = endpointFor(operation, params);
    const query = new URLSearchParams();
    Object.entries(endpoint.query).forEach(([key, value]) => {
        if (value !== undefined) query.set(key, String(value));
    });
    const cookie = getWebSessionCookie();
    const headers: Record<string, string> = {};
    if (cookie) {
        if (isSameOriginBase(base)) {
            const token = tokenFromCookieString(cookie);
            // 同源请求不允许把未知格式的 session 放回 URL；清掉无效值，交给后端按未登录处理。
            if (token) headers[SESSION_HEADER_NAME] = token;
            else clearQqSession();
        } else {
            query.set('cookie', cookie);
        }
    }
    query.set('timestamp', String(Date.now()));

    // Same-origin serverless calls must retain deployment-protection cookies; external qq-music-api instances
    // answer with `Access-Control-Allow-Origin: *`, so those requests still omit browser credentials.
    const credentials: RequestCredentials = isSameOriginBase(base) ? 'same-origin' : 'omit';
    // 内嵌后端的上游客户端（createAuthHttpClient）是 25s axios 超时，请求打满时它会占用
    // 25s 才回 500。前端的预算必须比它长，否则前端先 abort，把一次还在飞的后端请求掐断——
    // 界面表现就是骨架挂住不动，而日志里后端那两条 25s 超时正是这么来的。
    const QQ_REQUEST_TIMEOUT_MS = 30000;
    const QQ_MAX_RETRIES = 1;

    const requestUrl = `${base}${endpoint.path}?${query}`;

    // 请求去重：相同 URL 的并发请求只发一次，其他调用方共享结果。
    // key 里**不能**带 timestamp —— 那是每次请求现生成的，带上它 key 就永远不同，
    // 去重等于没做，还白付一次 Map 写入。timestamp 只进真正的请求 URL。
    const dedupeKey = `${base}${endpoint.path}?${query.toString().replace(/[&?]timestamp=\d+/, '')}`;

    let lastFailure: unknown;

    return dedupedRequest(dedupeKey, async () => {
      for (let attempt = 0; attempt <= QQ_MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), QQ_REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(requestUrl, { credentials, headers, signal: controller.signal });
          clearTimeout(timer);

          if (!response.ok) {
            const failure = await readJsonBody(response);
            const backendMessage = typeof failure?.message === 'string' && failure.message.trim()
                ? ` (${failure.message.trim()})`
                : '';
            // A missing, expired, rejected, or non-persisted backend session is surfaced uniformly as 401.
            if (response.status === 401) {
              clearQqSession();
              throw new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', failure, response.status);
            }
            // 404 是「这个后端没有这条路由」，不是网络故障 —— 用户可以自行部署任意版本的后端，
            // 新路由在旧后端上必然 404。报成 `unsupported`，调用方才能据此回落到旧路径，
            // 而不必去解析错误文案里的状态码。
            if (response.status === 404) {
              throw new OnlineProviderError(
                'unsupported',
                `QQMusicApi has no ${operation} route`,
                'qq',
                failure,
                response.status,
              );
            }
            throw new OnlineProviderError(
              'network',
            // 429 也走这条通用分支；retryAfterMs 是第 6 参（第 5 参是 httpStatus），传错位会被当成状态码。
              `QQMusicApi ${operation} failed: HTTP ${response.status}${backendMessage}`,
              'qq',
              failure,
              response.status,
              readRetryAfterMs(failure, response),
            );
          }

          const body = await readJsonBody(response);
          if (body === undefined) {
            throw new OnlineProviderError('invalid-response', `QQMusicApi returned an unreadable ${operation} body`, 'qq');
          }
          assertUpstreamAccepted(operation, body);
          persistConfirmedSession(operation, body);
          return body as T;
        } catch (error) {
          clearTimeout(timer);
          lastFailure = error;
          // AbortError 不重试：它几乎总是前端自己掐的超时（后端慢到 25s 才回），
          // 再试一次等于让用户再等一个完整预算。超时后立刻抛出，交给调用方显示可重试的空态。
          // TypeError（fetch 网络层失败）仍重试一次。
          const isRetryable = error instanceof TypeError;
          if (isRetryable && attempt < QQ_MAX_RETRIES) {
            // 退避只走指数序列（300ms → 600ms）。429 不在这里重试：服务端已经要求退避，
            // 调用方会拿 error.retryAfterMs 进入冷却并在冷却结束后重来（beginCooldown），
            // 传输层顶着限流再发一次既撞不宽限，又会把已消费的响应体读空、丢掉后端文案。
            await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt)));
            continue;
          }
          // 重试耗尽后，把裸的 fetch 失败翻译成「连后端都没连上」——与后端回了错误码分开。
          if (error instanceof TypeError) {
            throw new OnlineProviderError(
              'network',
              `QQMusicApi ${operation} unreachable: ${error.message}`,
              'qq',
              error,
            );
          }
          throw error;
        }
      }

      throw lastFailure instanceof Error ? lastFailure : new OnlineProviderError('network', `QQMusicApi request failed after retries: ${operation}`, 'qq');
    });
};
