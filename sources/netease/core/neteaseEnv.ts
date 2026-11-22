import type {
    FoliumSourceError,
    FoliumSourceErrorCode,
    FoliumSourceNotice,
    FoliumSourcePageStore,
    FoliumText,
} from '@folia/folium';

// sources/netease/core/neteaseEnv.ts
// What the core is handed (createSource's env, core/index.ts) and the few things every file of the core asks of it: the
// mod's texts, the host's errors and the page store the cookies are kept in. The core's files keep the state they had
// in the host (module variables), so the env is kept here too: the last createSource stands, and createSource drops what
// the earlier one kept (index.ts). Desktop and web each make one source per window.

/** The web build's piece: the API at a configured address (VITE_NETEASE_API_BASE). */
export interface NeteaseWebEnv {
    /** An address, or a same-origin path; empty where none is configured. */
    apiBase: string;
}

/** What createSource is handed: the desktop client's env, and on the web the web build's pieces. */
export interface NeteaseSourceEnv {
    modId: string;
    /** The main entry's rpc (folium.rpc.call); the web build has none, and gives `web`. */
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    /** A text of the mod's locale files, as a FoliumText (folium.i18n.key). */
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** The same written out in the UI language now (folium.i18n.text). */
    translate(key: string, params?: Record<string, string | number>): string;
    error(code: FoliumSourceErrorCode, message: string, details?: { cause?: unknown; httpStatus?: number; retryAfterMs?: number }): FoliumSourceError;
    isPureMusicText(text: string | null | undefined): boolean;
    pageStore(sourceId: string): FoliumSourcePageStore;
    /** Tells the listener something unasked (handle.notify, once the source is registered); left out in tests. */
    notify?(notice: FoliumSourceNotice): void;
    /** The web build: the API at a configured address instead of the main entry's embedded one. */
    web?: NeteaseWebEnv;
}

let current: NeteaseSourceEnv | null = null;

export const setNeteaseEnv = (env: NeteaseSourceEnv): void => {
    current = env;
};

/** The env of the last createSource. */
export const neteaseEnv = (): NeteaseSourceEnv => {
    if (!current) throw new Error('[NetEase] the source was not created (createSource)');
    return current;
};

/** The desktop app: requests go to the main entry's embedded API. */
export const isNeteaseDesktop = (): boolean => !neteaseEnv().web;

/** The mod's text `key`, written out in the UI language now. */
export const neteaseText = (key: string, params?: Record<string, string | number>): string => neteaseEnv().translate(key, params);

/** The mod's text `key` as a FoliumText, for what the host writes out itself. */
export const neteaseTextKey = (key: string, params?: Record<string, string | number>): FoliumText => neteaseEnv().text(key, params);

/** An error the host reads (folium.sources.error): `cause` is NetEase's code and words where there are some. */
export const neteaseError = (code: FoliumSourceErrorCode, message: string, cause?: unknown): FoliumSourceError => (
    neteaseEnv().error(code, message, cause === undefined ? {} : { cause })
);

/**
 * An error of neteaseError (with `code`, where given). Read by its shape, not by who made it: the host hands the error
 * back to describeFailure as a copy named after the source (sourceAdapter/kit.ts), and no other source's errors reach
 * here.
 */
export const isNeteaseError = (error: unknown, code?: FoliumSourceErrorCode): error is FoliumSourceError & { cause?: unknown } => {
    const own = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    return typeof own === 'string' && ERROR_CODES.has(own) && (code === undefined || own === code);
};

// The codes of folium.sources.error: the transport's own marks (NETEASE_API_UNAVAILABLE and the like) are no such error.
const ERROR_CODES: ReadonlySet<string> = new Set<FoliumSourceErrorCode>([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
]);

// The sign-in is kept where the host's provider kept it: the page store's `cookie` (online_provider:netease:cookie), and
// the anonymous one under `anonymous_cookie`. The sign-in cookie is written only in the functions
// dev/dedicatus/credentialWriters.mjs lists (neteaseProvider's checkLogin and dropNeteaseSignIn), each with the key
// written out, so the check sees them.

/** The stored sign-in cookie; empty for none. */
export const readNeteaseCookie = (): string => neteaseEnv().pageStore('netease').get('cookie') || '';

/** The stored anonymous cookie; empty for none. */
export const readNeteaseAnonymousCookie = (): string => neteaseEnv().pageStore('netease').get('anonymous_cookie') || '';
