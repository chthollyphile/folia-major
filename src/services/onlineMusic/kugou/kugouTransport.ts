import md5 from 'blueimp-md5';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';
import { lyricProxyWebUrl, requestLyricProxyOnDesktop } from '../../lyricProxy';
import { withLoginRequestLimit } from '../login/loginRequestLimit';

// src/services/onlineMusic/kugou/kugouTransport.ts

export const KUGOU_OPERATIONS = [
    'register_dev', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'logout',
    'user_detail', 'user_vip_detail', 'youth_union_vip', 'youth_day_vip', 'youth_day_vip_upgrade',
    'user_playlist', 'user_cloud', 'user_cloud_url', 'search',
    'audio', 'krm_audio', 'song_url', 'song_climax', 'search_lyric', 'lyric', 'playlist_track_all',
    'playlist_detail',
    'album_detail', 'album_songs', 'artist_detail', 'artist_albums', 'artist_audios',
    'everyday_recommend', 'everyday_history', 'personal_fm', 'top_card_youth', 'playlist_add',
    'playlist_del', 'playlist_tracks_add', 'playlist_tracks_del',
] as const;

export type KugouOperation = typeof KUGOU_OPERATIONS[number];
export type KugouParams = Record<string, string | number | boolean | undefined>;

// The requests a sign-in waits for. They get the sign-in's time limit; no other request does.
const LOGIN_REQUESTS: ReadonlySet<KugouOperation> = new Set(['login_qr_key', 'login_qr_create', 'login_qr_check']);

const ENDPOINTS: Record<KugouOperation, string> = {
    register_dev: '/register/dev',
    login_qr_key: '/login/qr/key',
    login_qr_create: '/login/qr/create',
    login_qr_check: '/login/qr/check',
    logout: '/logout',
    user_detail: '/user/detail',
    user_vip_detail: '/user/vip/detail',
    youth_union_vip: '/youth/union/vip',
    youth_day_vip: '/youth/day/vip',
    youth_day_vip_upgrade: '/youth/day/vip/upgrade',
    user_playlist: '/user/playlist',
    user_cloud: '/user/cloud',
    user_cloud_url: '/user/cloud/url',
    search: '/search',
    audio: '/audio',
    krm_audio: '/krm/audio',
    song_url: '/song/url',
    song_climax: '/song/climax',
    search_lyric: '/search/lyric',
    lyric: '/lyric',
    playlist_track_all: '/playlist/track/all',
    playlist_detail: '/playlist/detail',
    album_detail: '/album/detail',
    album_songs: '/album/songs',
    artist_detail: '/artist/detail',
    artist_albums: '/artist/albums',
    artist_audios: '/artist/audios',
    everyday_recommend: '/everyday/recommend',
    everyday_history: '/everyday/history',
    personal_fm: '/personal/fm',
    top_card_youth: '/top/card/youth',
    playlist_add: '/playlist/add',
    playlist_del: '/playlist/del',
    playlist_tracks_add: '/playlist/tracks/add',
    playlist_tracks_del: '/playlist/tracks/del',
};

const getWebApiBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_KUGOU_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_KUGOU_API_BASE || '')
        : '';
    const value = viteValue || processValue;
    return value.trim().replace(/\/$/, '');
};

const isDeviceVerificationRequired = (body: any): boolean => {
    const errorCode = Number(body?.errcode ?? body?.error_code);
    const message = String(body?.error ?? body?.error_msg ?? body?.msg ?? '');
    return errorCode === 20028 || message.includes('本次请求需要验证');
};

// The web build has no KuGouMusicApi address configured: KuGou cannot be used there at all.
export const KUGOU_API_BASE_MISSING = 'VITE_KUGOU_API_BASE is not configured';

// HTTP-like statuses that unambiguously mean the account session is no longer accepted.
const KUGOU_AUTH_FAILURE_STATUSES: ReadonlySet<number> = new Set([401, 403]);

// docs/ku-go-api-docs.md: an authenticated request without valid cookie credentials fails with error_code 152.
// KuGouMusicApi reports every other upstream failure (including plain network errors) as status 502 with
// no stable login-expired code, so anything outside this set must not be treated as a logout signal.
const KUGOU_AUTH_FAILURE_ERROR_CODES: ReadonlySet<number> = new Set([152]);

const BRIDGE_ERROR_PREFIX = /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/;
const BRIDGE_FIELDS = /KuGouApi\[([^\]]*)\](?::\s*(.*))?/;

export type KugouFailureDetails = {
    operation?: string;
    status?: number;
    errorCode?: number;
    detail?: string;
    // The main process could not load KuGouMusicApi (`api=unloaded`).
    apiUnloaded?: boolean;
    // A session is stored that the main process cannot load in this run (`session=unreadable`).
    sessionUnreadable?: boolean;
};

const toFiniteNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Reads operation/status/error_code from whatever an Electron `kugouRequest` rejection looks like:
 * the bridge's `KuGouApi[operation=.. status=.. error_code=..]` error message (the only part of an
 * Error that survives IPC), or a raw `{ status, body }` answer object from an unpatched main process.
 */
export const extractKugouFailureDetails = (error: unknown): KugouFailureDetails => {
    if (error && typeof error === 'object' && !(error instanceof Error)) {
        const answer = error as { status?: unknown; body?: { error_code?: unknown; errcode?: unknown } | null };
        return {
            status: toFiniteNumber(answer.status),
            errorCode: toFiniteNumber(answer.body?.error_code ?? answer.body?.errcode),
        };
    }

    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const match = BRIDGE_FIELDS.exec(message);
    if (!match) {
        const detail = message.replace(BRIDGE_ERROR_PREFIX, '').trim();
        return { detail: detail && detail !== '[object Object]' ? detail : undefined };
    }
    const fields = new Map(
        match[1].split(/\s+/).filter(Boolean).map(entry => {
            const separator = entry.indexOf('=');
            return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
        }),
    );
    return {
        operation: fields.get('operation'),
        status: toFiniteNumber(fields.get('status')),
        errorCode: toFiniteNumber(fields.get('error_code')),
        detail: match[2]?.trim() || undefined,
        ...(fields.get('api') === 'unloaded' ? { apiUnloaded: true } : {}),
        ...(fields.get('session') === 'unreadable' ? { sessionUnreadable: true } : {}),
    };
};

/** Whether a KuGou failure means the session is really rejected, as opposed to a transient/unknown error. */
export const isKugouAuthFailure = (details: Pick<KugouFailureDetails, 'status' | 'errorCode'>): boolean => (
    (details.status !== undefined && KUGOU_AUTH_FAILURE_STATUSES.has(details.status))
    || (details.errorCode !== undefined && KUGOU_AUTH_FAILURE_ERROR_CODES.has(details.errorCode))
);

/**
 * Wraps an Electron IPC rejection into an OnlineProviderError so callers can tell a rejected login
 * (`auth-required`) from everything else (`network`) instead of seeing "[object Object]".
 * A stored session the main process cannot load now is `unavailable`: the account is not known, not gone.
 */
export const toKugouProviderError = (operation: KugouOperation, error: unknown): OnlineProviderError => {
    if (error instanceof OnlineProviderError) return error;
    const details = extractKugouFailureDetails(error);
    const summary = [
        `operation=${details.operation ?? operation}`,
        details.status !== undefined ? `status=${details.status}` : '',
        details.errorCode !== undefined ? `error_code=${details.errorCode}` : '',
    ].filter(Boolean).join(' ');
    const suffix = details.detail ? `: ${details.detail}` : '';
    const authFailure = isKugouAuthFailure(details);
    return new OnlineProviderError(
        authFailure ? 'auth-required' : details.sessionUnreadable ? 'unavailable' : 'network',
        `${authFailure ? 'KuGou login required' : 'KuGou request failed'} (${summary})${suffix}`,
        'kugou',
        error,
    );
};

// Reads a Web 429 Retry-After (delta seconds or HTTP date); anything unreadable is left out.
const readRetryAfterMs = (response: Response): number | undefined => {
    const raw = response.headers?.get?.('Retry-After')?.trim();
    if (!raw) return undefined;
    if (/^\d+$/.test(raw)) {
        const ms = Number(raw) * 1000;
        return Number.isSafeInteger(ms) ? ms : undefined;
    }
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
};

/**
 * Turns a non-2xx Web answer into an OnlineProviderError. 401/403 still mean the login was rejected; anything else
 * stays `network`, its status in the sentence (kugouFailure.ts reads it), the error_code KuGou answered with in
 * the cause where the body has one, and the wait a 429 asks for. A 152 in the body is deliberately not promoted
 * to auth-required, keeping the current Web logout behavior.
 */
const toKugouWebHttpError = async (response: Response): Promise<OnlineProviderError> => {
    const message = `KuGouMusicApi request failed: ${response.status}`;
    if (KUGOU_AUTH_FAILURE_STATUSES.has(response.status)) {
        return new OnlineProviderError('auth-required', message, 'kugou');
    }
    let responseBody: any;
    try {
        responseBody = await response.json();
    } catch {
        responseBody = undefined;
    }
    const body = responseBody?.body ?? responseBody;
    const errorCode = toFiniteNumber(body?.error_code ?? body?.errcode);
    return new OnlineProviderError(
        'network',
        message,
        'kugou',
        errorCode === undefined ? undefined : { errorCode },
        response.status,
        response.status === 429 ? readRetryAfterMs(response) : undefined,
    );
};

const getWebSessionCookie = (): string => {
    const values = new Map<string, string>();
    const storedCookie = readProviderSessionValue('kugou', 'cookie');
    storedCookie?.split(';').forEach(entry => {
        const separator = entry.indexOf('=');
        if (separator <= 0) return;
        values.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
    });

    const token = readProviderSessionValue('kugou', 'token');
    const userId = readProviderSessionValue('kugou', 'userid');
    const dfid = readProviderSessionValue('kugou', 'dfid');
    if (dfid) values.set('dfid', dfid);
    if (token) values.set('token', token);
    if (userId) values.set('userid', userId);
    return Array.from(values, ([key, value]) => `${key}=${value}`).join(';');
};

export const hasKugouAuthenticatedSearchSession = (): boolean => {
    // Electron keeps the reusable token/dfid in the encrypted main-process bridge. The account id
    // is only a non-secret hint that lets this synchronous selector choose authenticated search.
    if (typeof window !== 'undefined' && window.electron?.kugouRequest) {
        return Boolean(readProviderSessionValue('kugou', 'userid'));
    }
    const cookie = getWebSessionCookie();
    return ['token', 'userid', 'dfid'].every(key => (
        new RegExp(`(?:^|;)\\s*${key}=[^;]+`, 'i').test(cookie)
    ));
};

// Reproduces KuGou's anonymous Android search signature used before account-backed provider search.
export const requestKugouAnonymousSearch = async (
    keyword: string,
    page: number,
    pagesize: number,
): Promise<any> => {
    const clientTimeMs = Date.now();
    const clientTimeSec = Math.floor(clientTimeMs / 1000);
    const mid = md5(String(clientTimeMs));
    const params: Record<string, string | number> = {
        sorttype: '0',
        keyword,
        pagesize,
        page,
        userid: '0',
        appid: '3116',
        token: '',
        clienttime: clientTimeSec,
        iscorrection: '1',
        uuid: '-',
        mid,
        dfid: '-',
        clientver: '11070',
        platform: 'AndroidFilter',
    };
    const signatureSource = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('');
    params.signature = md5(
        `LnT6xpN3khm36zse0QzvmgTZ3waWdRSA${signatureSource}LnT6xpN3khm36zse0QzvmgTZ3waWdRSA`,
    );

    const targetUrl = new URL('http://complexsearch.kugou.com/v2/search/song');
    Object.entries(params).forEach(([key, value]) => targetUrl.searchParams.set(key, String(value)));
    const requestUrl = typeof window !== 'undefined' && window.electron
        ? targetUrl.toString()
        : lyricProxyWebUrl(targetUrl.toString());
    const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'omit',
        headers: {
            'User-Agent': 'Android14-1070-11070-201-0-SearchSong-wifi',
            'KG-Rec': '1',
            'KG-RC': '1',
            'KG-CLIENTTIMEMS': String(clientTimeMs),
            mid,
            'x-router': 'complexsearch.kugou.com',
        },
    });
    if (!response.ok) {
        throw new OnlineProviderError(
            'network',
            `KuGou anonymous search failed: ${response.status}`,
            'kugou',
        );
    }
    const body = await response.json();
    const errorCode = Number(body?.error_code);
    if (Number.isFinite(errorCode) && errorCode !== 0 && errorCode !== 200) {
        throw new OnlineProviderError(
            'network',
            `KuGou anonymous search failed: ${errorCode}`,
            'kugou',
        );
    }
    return body;
};

// Legacy playInfo failures: a non-2xx answer is `network`, an unreadable body is `invalid-response`. A non-2xx is
// still a real HTTP answer, though, so its status rides along as `httpStatus` whenever it is m.kugou.com's own
// (kugouFailure.ts sorts it by the shared rules); left without one it is a plain network failure.
export const KUGOU_LEGACY_PLAY_INFO_FAILED = 'KuGou legacy playInfo failed';

const legacyPlayInfoHttpError = (status: number, httpStatus?: number): OnlineProviderError => new OnlineProviderError(
    'network',
    `${KUGOU_LEGACY_PLAY_INFO_FAILED}: ${status}`,
    'kugou',
    undefined,
    httpStatus,
);

// The Web lyric proxies answer 500 / 502 themselves when their own fetch upstream fails, so those two say nothing
// about m.kugou.com and are passed on without a status.
const isLyricProxyOwnFailureStatus = (status: number): boolean => status === 500 || status === 502;

const legacyPlayInfoBodyError = (cause: unknown): OnlineProviderError => new OnlineProviderError(
    'invalid-response',
    'KuGou legacy playInfo returned an unreadable body',
    'kugou',
    cause,
);

/**
 * Legacy mobile play-info fallback used when the current /song/url endpoint refuses a hash.
 * It is intentionally kept outside the signed Web API transport because it calls KuGou's old
 * public mobile endpoint and works without the configured VITE_KUGOU_API_BASE.
 */
export const requestKugouLegacyPlayInfo = async (hash: string): Promise<any> => {
    const targetUrl = new URL('https://m.kugou.com/app/i/getSongInfo.php');
    targetUrl.searchParams.set('cmd', 'playInfo');
    targetUrl.searchParams.set('hash', hash);
    const targetUrlString = targetUrl.toString();

    // In Electron, route through the main-process lyric proxy so CORS cannot block this
    // last-resort mobile endpoint. The Web build uses the same relay through its web address.
    const relayed = requestLyricProxyOnDesktop(targetUrlString, { method: 'GET' });
    if (relayed) {
        const response = await relayed;
        if (!response.ok) {
            // The main process rejects when it cannot reach the endpoint, so ok:false is always m.kugou.com's answer.
            throw legacyPlayInfoHttpError(response.status, response.status);
        }
        try {
            return JSON.parse(response.bodyText) as any;
        } catch (error) {
            throw legacyPlayInfoBodyError(error);
        }
    }

    const requestUrl = typeof window !== 'undefined' && window.electron
        ? targetUrlString
        : lyricProxyWebUrl(targetUrlString);
    const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'omit',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
        },
    });
    if (!response.ok) {
        throw legacyPlayInfoHttpError(
            response.status,
            requestUrl === targetUrlString || !isLyricProxyOwnFailureStatus(response.status) ? response.status : undefined,
        );
    }
    try {
        return await response.json();
    } catch (error) {
        throw legacyPlayInfoBodyError(error);
    }
};

const clearWebDeviceIdentity = (): void => {
    removeProviderSessionValue('kugou', 'dfid');
    const storedCookie = readProviderSessionValue('kugou', 'cookie');
    if (!storedCookie) return;
    const retained = storedCookie.split(';').filter(entry => entry.trim() && !/^\s*dfid=/i.test(entry));
    if (retained.length > 0) {
        writeProviderSessionValue('kugou', 'cookie', retained.join(';'));
    } else {
        removeProviderSessionValue('kugou', 'cookie');
    }
};

const persistWebSession = (response: any): void => {
    const cookies = response?.cookie || response?.data?.cookie;
    if (typeof cookies === 'string' && cookies) writeProviderSessionValue('kugou', 'cookie', cookies);
    if (Array.isArray(cookies) && cookies.length) writeProviderSessionValue('kugou', 'cookie', cookies.join('; '));

    const payload = response?.data || response?.body?.data || response?.body || response;
    const token = payload?.token;
    const userId = payload?.userid ?? payload?.user_id;
    const dfid = payload?.dfid;
    if (token) writeProviderSessionValue('kugou', 'token', String(token));
    if (userId) writeProviderSessionValue('kugou', 'userid', String(userId));
    if (dfid) writeProviderSessionValue('kugou', 'dfid', String(dfid));
};

/**
 * Removes credentials written by older desktop builds. Electron only retains the non-sensitive
 * account id in renderer storage; every reusable credential stays in the encrypted IPC bridge.
 */
const persistElectronAccountHint = (operation: KugouOperation, response: any): void => {
    ['cookie', 'token', 'dfid'].forEach(key => removeProviderSessionValue('kugou', key));
    if (operation === 'logout') {
        removeProviderSessionValue('kugou', 'userid');
        return;
    }
    const payload = response?.data || response?.body?.data || response?.body || response;
    const userId = payload?.userid ?? payload?.user_id;
    if (userId) writeProviderSessionValue('kugou', 'userid', String(userId));
};

export const getKugouTransportAvailability = () => {
    if (typeof window !== 'undefined' && window.electron?.kugouRequest) return { configured: true } as const;
    return getWebApiBase()
        ? { configured: true } as const
        : { configured: false, reason: 'not-configured' as const };
};

// Routes one provider request through Electron IPC or an explicitly configured Web backend.
export const requestKugou = async <T = unknown>(operation: KugouOperation, params: KugouParams = {}): Promise<T> => {
    const limited = LOGIN_REQUESTS.has(operation);
    if (typeof window !== 'undefined' && window.electron?.kugouRequest) {
        // Account credentials are injected by the main-process bridge. Drop legacy renderer values
        // at the IPC boundary so an old localStorage token cannot keep circulating after migration.
        const electronParams = Object.fromEntries(
            Object.entries(params).filter(([key]) => !['token', 'dfid', 'cookie'].includes(key.toLowerCase())),
        );
        const send = async (): Promise<unknown> => {
            try {
                return await window.electron!.kugouRequest(operation, electronParams);
            } catch (error) {
                throw toKugouProviderError(operation, error);
            }
        };
        // The desktop side cannot be told to stop: past the limit its answer is no longer waited for.
        // A confirmation that arrives after that is still kept by the main process while the dialog
        // says there was no answer; the account then shows at the next read of it.
        const response = await (limited ? withLoginRequestLimit(send) : send());
        persistElectronAccountHint(operation, response);
        return response as T;
    }

    const base = getWebApiBase();
    if (!base) {
        throw new OnlineProviderError('unavailable', KUGOU_API_BASE_MISSING, 'kugou');
    }
    const execute = async (targetOperation: KugouOperation, targetParams: KugouParams): Promise<any> => {
        const query = new URLSearchParams();
        Object.entries(targetParams).forEach(([key, value]) => {
            if (value !== undefined) query.set(key, String(value));
        });
        const cookie = getWebSessionCookie();
        if (cookie) query.set('cookie', cookie);
        query.set('timestamp', String(Date.now()));

        const send = async (signal?: AbortSignal) => {
            const response = await fetch(`${base}${ENDPOINTS[targetOperation]}?${query}`, { credentials: 'include', ...(signal ? { signal } : {}) });
            if (!response.ok) throw await toKugouWebHttpError(response);
            try {
                return await response.json();
            } catch (error) {
                throw new OnlineProviderError('invalid-response', `KuGouMusicApi ${targetOperation} returned an unreadable body`, 'kugou', error);
            }
        };
        // Every request made for a sign-in operation is limited, the device registration it may need too.
        const responseBody = await (limited ? withLoginRequestLimit(send) : send());
        // What a sign-out is answered with is the session that just left: it is not written back.
        if (targetOperation !== 'logout') persistWebSession(responseBody);
        const body = responseBody?.body ?? responseBody;
        return body;
    };

    let body = await execute(operation, params);
    if (operation !== 'register_dev' && isDeviceVerificationRequired(body)) {
        clearWebDeviceIdentity();
        await execute('register_dev', {});
        body = await execute(operation, params);
    }
    return body as T;
};
