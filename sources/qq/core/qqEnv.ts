import type {
    FoliumSourceError,
    FoliumSourceErrorCode,
    FoliumSourceErrorDetails,
    FoliumSourcePageStore,
    FoliumText,
} from '@folia/folium';

// sources/qq/core/qqEnv.ts
// What the core is handed (createSource's env, core/index.ts) and the few things every file of the core asks of it: the
// mod's texts, the host's errors and the page store the session is kept in. The core's files keep the state they had
// in the host (module variables), so the env is kept here too: the last createSource stands, and createSource drops what
// the earlier one kept (resetQqRuntime in index.ts). Desktop and web each make one source per window.

/** The web build's pieces: qq-music-api at a configured address, and the lyric proxy for musicu. */
export interface QqWebEnv {
    /** VITE_QQ_API_BASE: an address, or a same-origin path (`/api/qq`); empty where none is configured. */
    apiBase: string;
    /** The address of `url` through the site's lyric proxy (the web build's own relay). */
    relayUrl(url: string): string;
}

/** What createSource is handed: the desktop client's env, and on the web the web build's pieces. */
export interface QqSourceEnv {
    modId: string;
    /** The main entry's rpc (folium.rpc.call); the web build has none, and gives `web`. */
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    /** A text of the mod's locale files, as a FoliumText (folium.i18n.key). */
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** The same written out in the UI language now (folium.i18n.text). */
    translate(key: string, params?: Record<string, string | number>): string;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
    isPureMusicText(text: string | null | undefined): boolean;
    pageStore(sourceId: string): FoliumSourcePageStore;
    /** The web build: qq-music-api at a configured address instead of the main entry's embedded one. */
    web?: QqWebEnv;
}

let current: QqSourceEnv | null = null;

export const setQqEnv = (env: QqSourceEnv): void => {
    current = env;
};

/** The env of the last createSource. */
export const qqEnv = (): QqSourceEnv => {
    if (!current) throw new Error('[QQ] the source was not created (createSource)');
    return current;
};

/** The desktop app: requests go to the main entry's embedded qq-music-api. */
export const isQqDesktop = (): boolean => !qqEnv().web;

/** The mod's text `key`, written out in the UI language now. */
export const qqText = (key: string, params?: Record<string, string | number>): string => qqEnv().translate(key, params);

/** The mod's text `key` as a FoliumText, for what the host writes out itself. */
export const qqTextKey = (key: string, params?: Record<string, string | number>): FoliumText => qqEnv().text(key, params);

/**
 * An error the host reads (folium.sources.error): `cause` is the backend's answer where there is one; `httpStatus` the
 * status of a non-2xx answer; `retryAfterMs` the wait a 429 asks for.
 */
export const qqError = (
    code: FoliumSourceErrorCode,
    message: string,
    cause?: unknown,
    httpStatus?: number,
    retryAfterMs?: number,
): FoliumSourceError => {
    const error = qqEnv().error(code, message, {
        ...(cause === undefined ? {} : { cause }),
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
    return error;
};

/**
 * An error of qqError (with `code`, where given). Read by its shape, not by who made it: the host hands the error back
 * to describeFailure as a copy named after the source (sourceAdapter/kit.ts), and no other source's errors reach here.
 */
export const isQqError = (error: unknown, code?: FoliumSourceErrorCode): error is FoliumSourceError & { cause?: unknown } => (
    error instanceof Error && typeof (error as { code?: unknown }).code === 'string'
    && (code === undefined || (error as FoliumSourceError).code === code)
);

// The session is kept where the host's provider kept it: the page store's `cookie` (online_provider:qq:cookie). It is
// written only in the functions dev/dedicatus/credentialWriters.mjs lists (qqTransport's persistConfirmedSession and
// clearQqSession, qqSessionRefresh's refreshOnce), each with the key written out, so the check sees them.

/** The stored backend session (`qqmusic_session=<token>`, never a QQ credential); empty for none. */
export const readQqStoredSession = (): string => qqEnv().pageStore('qq').get('cookie') || '';
