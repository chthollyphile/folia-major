import { OnlineProviderError } from '../../types/onlineMusic';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from './providerStorage';

// src/services/onlineMusic/qqTransport.ts

export const QQ_OPERATIONS = [
    'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_qr_cancel', 'login_status', 'logout',
    'user_detail', 'user_playlist', 'user_albums', 'user_liked_songs', 'music_play', 'song_list_detail', 'song_info',
    'album_info', 'artist_albums', 'artist_songs',
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
    user_detail: '/user/detail',
    user_playlist: '/user/playlist',
    user_albums: '/user/albums',
    user_liked_songs: '/user/liked-songs',
    music_play: '/getMusicPlay',
    song_list_detail: '/getSongListDetail',
    song_info: '/getSongInfo',
    // 曲库端点用领域语汇命名，与 provider 的 getAlbum* / getArtist* 一一对应，不沿用上游的 singer_* 路径名。
    // 上游这三条路由虽然声明了路径参数，但 controller 只读 ctx.query，所以一律走 query string。
    album_info: '/getAlbumInfo',
    artist_albums: '/getSingerAlbum',
    artist_songs: '/getSingerHotsong',
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

const resolveApiBase = async (): Promise<string> => {
    const readPort = getElectronQqPortReader();
    if (readPort) {
        if (electronApiBase) return electronApiBase;
        const port = await readPort();
        if (!port) {
            throw new OnlineProviderError('unavailable', 'Embedded QQMusicApi is not running', 'qq');
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

export const hasQqSession = (): boolean => Boolean(getWebSessionCookie());

export const clearQqSession = (): void => removeProviderSessionValue('qq', 'cookie');

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
    if (cookie) query.set('cookie', cookie);
    query.set('timestamp', String(Date.now()));

    // qq-music-api answers with `Access-Control-Allow-Origin: *` and no credentials, so a cross-origin browser
    // can neither receive nor replay its HttpOnly cookie; the session is carried by the `cookie` query instead.
    const response = await fetch(`${base}${endpoint.path}?${query}`, { credentials: 'omit' });
    if (!response.ok) {
        const failure = await readJsonBody(response);
        // The backend session lives in one Node process, so 401 also covers a restart or an expired 24h TTL.
        if (response.status === 401) {
            clearQqSession();
            throw new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', failure);
        }
        throw new OnlineProviderError('network', `QQMusicApi request failed: ${response.status}`, 'qq', failure);
    }

    const body = await readJsonBody(response);
    if (body === undefined) {
        throw new OnlineProviderError('invalid-response', `QQMusicApi returned an unreadable ${operation} body`, 'qq');
    }
    assertUpstreamAccepted(operation, body);
    persistConfirmedSession(operation, body);
    return body as T;
};
