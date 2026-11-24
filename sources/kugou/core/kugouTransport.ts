import type { FoliumSourceAvailability, FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails, FoliumSourcePageStore } from '@folia/folium';
import { withLoginRequestLimit } from '@folia/folium-source-kit';
import { buildKugouAnonymousSearch, buildKugouLegacyPlayInfo, type KugouPlainAnswer } from './kugouRequests';

// sources/kugou/core/kugouTransport.ts
// 酷狗的请求怎么发。两条路，createSource 按 env 选一条：
//   - 桌面版（模组的 client）：经 folium.rpc 交给 main 入口（main/index.ts 登记的 `request`），那边的 kugouApiBridge.cjs
//     调 KuGouMusicApi；凭据只在主进程里（加密存着），窗口这边只留一个账号 id 的提示（页面存储的 userid，D604 登记的写入口）。
//     匿名搜索和旧的播放信息接口也由 main 去问（`anonymousSearch`、`legacyPlayInfo`）：main 自己拼地址，不开任意地址的中转。
//   - 网页版（src/services/onlineMusic/web/kugou.ts）：直接问配好的 KuGouMusicApi（VITE_KUGOU_API_BASE），会话放在页面存储里
//     （online_provider:kugou:*，和迁之前同一组键），匿名搜索和旧接口经歌词代理去问。
// 错误一律是宿主的错（env.error）；酷狗自己说了什么写在错的那句话和 cause 里，kugouFailure.ts 按结构读回来
// （宿主给错换上音源名时换的是一个新对象，留着 message、cause、httpStatus）。

export const KUGOU_OPERATIONS = [
    'register_dev', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'logout',
    'user_detail', 'user_vip_detail', 'youth_union_vip', 'youth_day_vip', 'youth_day_vip_upgrade',
    'user_playlist', 'user_cloud', 'user_cloud_url', 'user_listen', 'search',
    'audio', 'krm_audio', 'song_url', 'song_url_new', 'song_climax', 'search_lyric', 'lyric', 'playlist_track_all',
    'playlist_detail',
    'album_detail', 'album_songs', 'artist_detail', 'artist_albums', 'artist_audios',
    'everyday_recommend', 'everyday_history', 'personal_fm', 'top_card_youth', 'playlist_add',
    'playlist_del', 'playlist_tracks_add', 'playlist_tracks_del',
] as const;

export type KugouOperation = typeof KUGOU_OPERATIONS[number];
export type KugouParams = Record<string, string | number | boolean | undefined>;

/** What main's `request` answers: the body KuGouMusicApi gave, or the bridge's one-line failure (kugouApiBridge.cjs). */
export type KugouBridgeResult = { ok: true; data: unknown } | { ok: false; message: string };

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
    user_listen: '/user/listen',
    search: '/search',
    audio: '/audio',
    krm_audio: '/krm/audio',
    song_url: '/song/url',
    song_url_new: '/song/url/new',
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
 * Reads operation/status/error_code from the bridge's one-line failure: `KuGouApi[operation=.. status=..
 * error_code=..]: detail` (kugouApiBridge.cjs normalizeBridgeError), which main hands back as the message of
 * its answer and the desktop transport keeps as the cause of the error it throws.
 */
export const extractKugouFailureDetails = (error: unknown): KugouFailureDetails => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const match = BRIDGE_FIELDS.exec(message);
    if (!match) {
        const detail = message.trim();
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

/** The host's errors, as env.error makes them. */
export type KugouErrorFactory = (code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails) => FoliumSourceError;

/**
 * Turns the bridge's failure into the host's error so callers can tell a rejected login (`auth-required`) from
 * everything else (`network`). A stored session the main process cannot load now is `unavailable`: the account is
 * not known, not gone. The bridge's line stays on the error as its cause (an Error), where kugouFailure.ts reads it.
 */
export const toKugouProviderError = (error: KugouErrorFactory, operation: KugouOperation, cause: Error): FoliumSourceError => {
    const details = extractKugouFailureDetails(cause);
    const summary = [
        `operation=${details.operation ?? operation}`,
        details.status !== undefined ? `status=${details.status}` : '',
        details.errorCode !== undefined ? `error_code=${details.errorCode}` : '',
    ].filter(Boolean).join(' ');
    const suffix = details.detail ? `: ${details.detail}` : '';
    const authFailure = isKugouAuthFailure(details);
    return error(
        authFailure ? 'auth-required' : details.sessionUnreadable ? 'unavailable' : 'network',
        `${authFailure ? 'KuGou login required' : 'KuGou request failed'} (${summary})${suffix}`,
        { cause },
    );
};

// Reads a Web 429 Retry-After (delta seconds or HTTP date); anything unreadable is left out.
const readRetryAfterMs = (response: Response): number | undefined => {
    const raw = response.headers.get('Retry-After')?.trim();
    if (!raw) return undefined;
    if (/^\d+$/.test(raw)) {
        const ms = Number(raw) * 1000;
        return Number.isSafeInteger(ms) ? ms : undefined;
    }
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
};

// Legacy playInfo failures: a non-2xx answer is `network`, an unreadable body is `invalid-response`. A non-2xx is
// still a real HTTP answer, though, so its status rides along as `httpStatus` whenever it is m.kugou.com's own
// (kugouFailure.ts sorts it by the shared rules); left without one it is a plain network failure.
export const KUGOU_LEGACY_PLAY_INFO_FAILED = 'KuGou legacy playInfo failed';

// The Web lyric proxies answer 500 / 502 themselves when their own fetch upstream fails, so those two say nothing
// about m.kugou.com and are passed on without a status.
const isLyricProxyOwnFailureStatus = (status: number): boolean => status === 500 || status === 502;

const parseJson = (text: string): unknown => JSON.parse(text) as unknown;

/** How the source reaches KuGou; one of two, chosen once by createSource. */
export interface KugouTransport {
    readonly runtime: 'electron' | 'web';
    request<T = unknown>(operation: KugouOperation, params?: KugouParams): Promise<T>;
    /** KuGou's anonymous Android search (no account): the answer's body. */
    anonymousSearch(keyword: string, page: number, pagesize: number): Promise<unknown>;
    /** The old mobile play-info endpoint, the last resort for a hash /song/url refuses: the answer's body. */
    legacyPlayInfo(hash: string): Promise<unknown>;
    /** Whether a search can go with the account (synchronous: the search picks its way with it). */
    hasAuthenticatedSearchSession(): boolean;
    /**
     * Whether the privileged URL endpoint (song_url_new) is worth asking: eligibility, not proof of entitlement. The
     * desktop says so for any signed-in account (main renews the VIP credential and answers without one itself).
     */
    hasVipSession(): boolean;
    /** The signed-in account's id as this window knows it ('' for none). */
    userId(): string;
    /** The web session's token, for the requests that take it as a parameter; the desktop keeps it in main. */
    sessionToken(): string | undefined;
    /** The account goes from this window: the sign-out, or a sign-in KuGou no longer takes. */
    forgetAccount(): void;
    getAvailability(): FoliumSourceAvailability;
}

const responsePayload = (response: any): any => response?.data || response?.body?.data || response?.body || response;

/**
 * The account a confirmed QR sign-in (status 4) brings, as a whole pair, or null. Other answers
 * carry the userid of whoever owns what was read (a public playlist's creator), not of who is
 * signed in, so they never change the account (#1101).
 */
const confirmedSignIn = (operation: KugouOperation, response: any): { token?: string; userId: string } | null => {
    if (operation !== 'login_qr_check') return null;
    const payload = responsePayload(response);
    if (Number(payload?.status) !== 4) return null;
    const userId = payload?.userid ?? payload?.user_id;
    return userId ? { token: payload?.token ? String(payload.token) : undefined, userId: String(userId) } : null;
};

/** What the transports need of the host: the main entry, the host's errors and the page store. */
export interface KugouTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error: KugouErrorFactory;
    pageStore(sourceId: string): FoliumSourcePageStore;
}

/** The web build's pieces (src/services/onlineMusic/web/kugou.ts hands them in). */
export interface KugouWebEnv {
    /** KuGouMusicApi's address (VITE_KUGOU_API_BASE); '' where none is configured. */
    apiBase: string;
    md5(text: string): string;
    /** The lyric proxy's address for `url` (lyricProxyWebUrl). */
    relayUrl(url: string): string;
}

/**
 * The desktop transport. Account credentials are injected by the main-process bridge; the window keeps only the
 * account id as a hint (the synchronous search and the library ask it).
 */
export const createDesktopKugouTransport = (env: KugouTransportEnv): KugouTransport => {
    const store = env.pageStore('kugou');

    /**
     * The desktop app's hint of who is signed in (registered for Dedicatus D604): passed only the account id
     * of a confirmed sign-in, or the one the bridge writes into the profile answer from its own session.
     */
    const rememberSignedInAccountId = (userId: string): void => {
        store.set('userid', userId);
    };

    /**
     * Removes credentials written by older desktop builds into the window's storage (registered for Dedicatus
     * D604, it writes only nothing): every reusable credential stays in the encrypted main-process bridge.
     */
    const dropRendererCredentials = (): void => {
        store.set('cookie', null);
        store.set('token', null);
        store.set('dfid', null);
    };

    /** The account hint goes (registered for Dedicatus D604, it writes only nothing). */
    const forgetSignedInAccountId = (): void => {
        store.set('userid', null);
    };

    const persistAccountHint = (operation: KugouOperation, response: unknown): void => {
        dropRendererCredentials();
        if (operation === 'logout') {
            forgetSignedInAccountId();
            return;
        }
        // The bridge strips the token from the sign-in answer, and writes the session's own account id
        // into the profile answer: those two are the only answers that say who is signed in.
        const userId: unknown = operation === 'user_detail'
            ? responsePayload(response)?.userid
            : confirmedSignIn(operation, response)?.userId;
        if (typeof userId === 'string' || typeof userId === 'number') rememberSignedInAccountId(String(userId));
    };

    // Main answers what it was asked, or the bridge's one line. A call that does not get there (the main entry
    // is not running) is the local service stopping: the bridge's own `api=unloaded`.
    const callBridge = async (operation: KugouOperation, params: KugouParams): Promise<unknown> => {
        let result: KugouBridgeResult;
        try {
            result = await env.call<KugouBridgeResult>('request', operation, params);
        } catch (failure) {
            const detail = failure instanceof Error ? failure.message : String(failure);
            throw toKugouProviderError(env.error, operation, new Error(`KuGouApi[operation=${operation} api=unloaded]: ${detail}`));
        }
        if (!result.ok) throw toKugouProviderError(env.error, operation, new Error(result.message));
        return result.data;
    };

    // What main answers for a plain request (anonymous search, legacy playInfo): KuGou's status and body text,
    // or that it could not ask.
    const callPlain = async (name: string, ...args: unknown[]): Promise<KugouPlainAnswer> => {
        try {
            return await env.call<KugouPlainAnswer>(name, ...args);
        } catch (failure) {
            return { unreachable: true, message: failure instanceof Error ? failure.message : String(failure) };
        }
    };

    return {
        runtime: 'electron',
        async request<T>(operation: KugouOperation, params: KugouParams = {}): Promise<T> {
            // Drop legacy renderer values at the boundary so an old stored token cannot keep circulating.
            const electronParams = Object.fromEntries(
                Object.entries(params).filter(([key]) => !['token', 'vip_token', 'vip_type', 'viptype', 'dfid', 'cookie'].includes(key.toLowerCase())),
            );
            // The desktop side cannot be told to stop: past the limit its answer is no longer waited for.
            // A confirmation that arrives after that is still kept by the main process while the dialog
            // says there was no answer; the account then shows at the next read of it.
            const send = () => callBridge(operation, electronParams);
            const response = await (LOGIN_REQUESTS.has(operation) ? withLoginRequestLimit(send) : send());
            persistAccountHint(operation, response);
            return response as T;
        },
        async anonymousSearch(keyword, page, pagesize) {
            const answer = await callPlain('anonymousSearch', keyword, page, pagesize);
            if ('unreachable' in answer) throw env.error('network', `KuGou anonymous search failed: ${answer.message}`);
            return readAnonymousSearch(env.error, answer.status, answer.bodyText);
        },
        async legacyPlayInfo(hash) {
            const answer = await callPlain('legacyPlayInfo', hash);
            // Main could not reach the endpoint: no status, a plain network failure (kugouFailure.ts: unreachable).
            if ('unreachable' in answer) throw env.error('network', `${KUGOU_LEGACY_PLAY_INFO_FAILED}: ${answer.message}`);
            // Main reached it, so a non-2xx is always m.kugou.com's answer.
            if (answer.status < 200 || answer.status > 299) {
                throw env.error('network', `${KUGOU_LEGACY_PLAY_INFO_FAILED}: ${answer.status}`, { httpStatus: answer.status });
            }
            try {
                return parseJson(answer.bodyText);
            } catch (cause) {
                throw env.error('invalid-response', 'KuGou legacy playInfo returned an unreadable body', { cause });
            }
        },
        // The account id is a non-secret hint that lets this synchronous selector choose authenticated search.
        hasAuthenticatedSearchSession: () => Boolean(store.get('userid')),
        hasVipSession: () => Boolean(store.get('userid')),
        userId: () => store.get('userid') ?? '',
        sessionToken: () => undefined,
        forgetAccount() {
            dropRendererCredentials();
            forgetSignedInAccountId();
        },
        getAvailability: () => ({ configured: true }),
    };
};

/** The anonymous search's answer, as both transports read it. */
const readAnonymousSearch = (error: KugouErrorFactory, status: number, bodyText: string): unknown => {
    if (status < 200 || status > 299) throw error('network', `KuGou anonymous search failed: ${status}`);
    let body: unknown;
    try {
        body = parseJson(bodyText);
    } catch (cause) {
        throw error('invalid-response', 'KuGou anonymous search returned an unreadable body', { cause });
    }
    const errorCode = Number((body as { error_code?: unknown } | null | undefined)?.error_code);
    if (Number.isFinite(errorCode) && errorCode !== 0 && errorCode !== 200) {
        throw error('network', `KuGou anonymous search failed: ${errorCode}`);
    }
    return body;
};

/** The web transport: KuGouMusicApi at the configured address, the session in the page store. */
export const createWebKugouTransport = (env: KugouTransportEnv, web: KugouWebEnv): KugouTransport => {
    const store = env.pageStore('kugou');
    const base = web.apiBase.trim().replace(/\/$/, '');

    /**
     * Turns a non-2xx Web answer into the host's error. 401/403 still mean the login was rejected; anything else
     * stays `network`, its status in the sentence (kugouFailure.ts reads it), the error_code KuGou answered with in
     * the cause where the body has one, and the wait a 429 asks for. A 152 in the body is deliberately not promoted
     * to auth-required, keeping the current Web logout behavior.
     */
    const toKugouWebHttpError = async (response: Response): Promise<FoliumSourceError> => {
        const message = `KuGouMusicApi request failed: ${response.status}`;
        if (KUGOU_AUTH_FAILURE_STATUSES.has(response.status)) {
            return env.error('auth-required', message);
        }
        let responseBody: any;
        try {
            responseBody = await response.json();
        } catch {
            responseBody = undefined;
        }
        const body = responseBody?.body ?? responseBody;
        const errorCode = toFiniteNumber(body?.error_code ?? body?.errcode);
        const retryAfterMs = response.status === 429 ? readRetryAfterMs(response) : undefined;
        return env.error('network', message, {
            ...(errorCode === undefined ? {} : { cause: { errorCode } }),
            httpStatus: response.status,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        });
    };

    const getWebSessionCookie = (): string => {
        const values = new Map<string, string>();
        const storedCookie = store.get('cookie');
        storedCookie?.split(';').forEach(entry => {
            const separator = entry.indexOf('=');
            if (separator <= 0) return;
            values.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
        });

        const token = store.get('token');
        const userId = store.get('userid');
        const dfid = store.get('dfid');
        if (dfid) values.set('dfid', dfid);
        if (token) values.set('token', token);
        if (userId) values.set('userid', userId);
        return Array.from(values, ([key, value]) => `${key}=${value}`).join(';');
    };

    // Clears the device id; the other cookies are written back as they were (registered for Dedicatus D604).
    const clearWebDeviceIdentity = (): void => {
        store.set('dfid', null);
        const storedCookie = store.get('cookie');
        if (!storedCookie) return;
        const retained = storedCookie.split(';').filter(entry => entry.trim() && !/^\s*dfid=/i.test(entry));
        if (retained.length > 0) {
            store.set('cookie', retained.join(';'));
        } else {
            store.set('cookie', null);
        }
    };

    /**
     * The one place the web session's account is written (registered for Dedicatus D604): the cookies,
     * the token and the account id of a confirmed sign-in, the token and the id as a whole pair.
     */
    const rememberConfirmedSignIn = (signIn: { token: string; userId: string }, cookieEntries: string[]): void => {
        if (cookieEntries.length) store.set('cookie', cookieEntries.join('; '));
        store.set('token', signIn.token);
        store.set('userid', signIn.userId);
    };

    const ACCOUNT_COOKIE_ENTRY = /^(token|userid|user_id)=/i;

    /**
     * The cookies any other answer brings (registered for Dedicatus D604): it drops the account ones
     * itself, which only a confirmed sign-in writes (#1101).
     */
    const rememberSessionCookies = (cookieEntries: string[]): void => {
        const kept = cookieEntries.filter(entry => !ACCOUNT_COOKIE_ENTRY.test(entry));
        if (kept.length) store.set('cookie', kept.join('; '));
    };

    /** The web session goes whole: the sign-out, or a sign-in KuGou no longer takes (registered for Dedicatus D604). */
    const forgetWebSession = (): void => {
        store.set('cookie', null);
        store.set('token', null);
        store.set('userid', null);
        store.set('dfid', null);
    };

    const persistWebSession = (operation: KugouOperation, response: any): void => {
        const signIn = confirmedSignIn(operation, response);
        const cookies = response?.cookie || response?.data?.cookie;
        const cookieEntries = (typeof cookies === 'string' ? cookies.split(';')
            : Array.isArray(cookies) ? cookies.map(String) : [])
            .map(entry => entry.trim())
            .filter(Boolean);
        // Half of a pair is not taken: the other half would be the previous account's. Account cookies of
        // any other answer are left out, like its account fields.
        if (signIn?.token) rememberConfirmedSignIn({ token: signIn.token, userId: signIn.userId }, cookieEntries);
        else rememberSessionCookies(cookieEntries);
        const dfid = responsePayload(response)?.dfid;
        if (dfid) store.set('dfid', String(dfid));
    };

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
                return await response.json() as unknown;
            } catch (cause) {
                throw env.error('invalid-response', `KuGouMusicApi ${targetOperation} returned an unreadable body`, { cause });
            }
        };
        // Every request made for a sign-in operation is limited, the device registration it may need too.
        const responseBody: unknown = await (LOGIN_REQUESTS.has(targetOperation) ? withLoginRequestLimit(send) : send());
        // What a sign-out is answered with is the session that just left: it is not written back.
        if (targetOperation !== 'logout') persistWebSession(targetOperation, responseBody);
        return (responseBody as { body?: unknown } | null | undefined)?.body ?? responseBody;
    };

    return {
        runtime: 'web',
        async request<T>(operation: KugouOperation, params: KugouParams = {}): Promise<T> {
            if (!base) throw env.error('unavailable', KUGOU_API_BASE_MISSING);
            let body = await execute(operation, params);
            if (operation !== 'register_dev' && isDeviceVerificationRequired(body)) {
                clearWebDeviceIdentity();
                await execute('register_dev', {});
                body = await execute(operation, params);
            }
            return body as T;
        },
        async anonymousSearch(keyword, page, pagesize) {
            const request = buildKugouAnonymousSearch(keyword, page, pagesize, text => web.md5(text));
            const response = await fetch(web.relayUrl(request.url), { method: 'GET', credentials: 'omit', headers: request.headers });
            return readAnonymousSearch(env.error, response.status, await response.text());
        },
        async legacyPlayInfo(hash) {
            const request = buildKugouLegacyPlayInfo(hash);
            const response = await fetch(web.relayUrl(request.url), { method: 'GET', credentials: 'omit', headers: request.headers });
            if (!response.ok) {
                const status = isLyricProxyOwnFailureStatus(response.status) ? undefined : response.status;
                throw env.error('network', `${KUGOU_LEGACY_PLAY_INFO_FAILED}: ${response.status}`, status === undefined ? undefined : { httpStatus: status });
            }
            try {
                return await response.json() as unknown;
            } catch (cause) {
                throw env.error('invalid-response', 'KuGou legacy playInfo returned an unreadable body', { cause });
            }
        },
        hasAuthenticatedSearchSession() {
            const cookie = getWebSessionCookie();
            return ['token', 'userid', 'dfid'].every(key => (
                new RegExp(`(?:^|;)\\s*${key}=[^;]+`, 'i').test(cookie)
            ));
        },
        // The web session has a VIP credential only where the configured service's answers brought one.
        hasVipSession: () => /(?:^|;)\s*vip_token=[^;\s]+/i.test(getWebSessionCookie()),
        userId: () => store.get('userid') ?? '',
        sessionToken: () => store.get('token') ?? undefined,
        forgetAccount: forgetWebSession,
        getAvailability: () => (base ? { configured: true } : { configured: false, reason: 'not-configured' }),
    };
};
