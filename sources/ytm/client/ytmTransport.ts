import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';

// sources/ytm/client/ytmTransport.ts
// The boundary to the main entry (main/index.ts, which hands the operations to ytmApiBridge.cjs): requests go
// through folium.rpc's `request`. Google credentials stay in the main process; only the shapes below cross over.
// The bridge's code and sentence reach the host as they are (folium.sources.error); the desktop side's own word
// for why a sign-in failed rides on the error as its cause (ytmReasonOf), which ytmLoginFailure.ts reads.

export type YtmOperation =
    | 'login_status' | 'logout'
    | 'web_login_start' | 'web_login_check' | 'web_login_cancel' | 'web_login_open'
    | 'search_songs' | 'search_albums' | 'search_playlists' | 'song_detail' | 'song_detail_en' | 'song_detail_zh' | 'lyrics' | 'album' | 'artist' | 'playlist' | 'public_playlist' | 'user_playlists' | 'user_albums' | 'audio'
    | 'explore' | 'mix' | 'playlist_edit' | 'list_save' | 'list_saved' | 'song_like' | 'song_versions' | 'played_as';
export type YtmParams = Record<string, string | undefined>;
// `reason`: the desktop side's own word for why a sign-in failed, where it has one.
export type YtmBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; reason?: string } };

export interface YtmWireArtist { id: string; name: string }
export interface YtmWireSong {
    id: string;
    name: string;
    artists: YtmWireArtist[];
    album: { id: string; name: string; coverUrl: string };
    durationMs: number;
    // The id of the song's row in the playlist it was read from as the account (`playlist`).
    setVideoId?: string;
    // The track is a video, and its audio the video's: a music video no song was shown for, or one somebody uploaded.
    video?: boolean;
}
export interface YtmWireCollection {
    id: string;
    type: 'playlist' | 'album' | 'artist';
    name: string;
    coverUrl: string;
    description?: string;
    trackCount?: number;
    artists?: YtmWireArtist[];
    publishedAt?: number;
    year?: number;
    isLiked?: boolean;
    isOwned?: boolean;
    playlistId?: string;
    // A mix is the queue YouTube makes up for this id, read with the `mix` operation; `videoId`
    // is its first song where the card names one.
    mix?: boolean;
    videoId?: string;
}
// `wideCoverUrl`: the entry's picture where it is a video still, wider than tall.
export type YtmWireExploreItem =
    | { kind: 'song'; song: YtmWireSong; wideCoverUrl?: string }
    | { kind: 'collection'; collection: YtmWireCollection; wideCoverUrl?: string };
export interface YtmWireExplorePage {
    sections: Array<{ title: string; items: YtmWireExploreItem[] }>;
    continuation?: string;
}
// YouTube pages by an opaque token: a page with no `continuation` is the last one.
export interface YtmWirePage<T> { items: T[]; continuation?: string }
// A page of a playlist (`playlist`). The first one carries the song count its header names, where it names one.
export interface YtmWirePlaylistPage extends YtmWirePage<YtmWireSong> { trackCount?: number }
export interface YtmWireAlbum { collection: YtmWireCollection; items: YtmWireSong[] }
export interface YtmWireArtistPage { collection: YtmWireCollection; songs: YtmWireSong[]; albums: YtmWireCollection[] }
// The sign-in in the person's own browser: one at a time, with no key. `web_login_start` (which
// fails with `unsupported` where no browser it can open is installed), `web_login_open` and
// `web_login_cancel` answer `{}`. `web_login_check` answers how the sign-in stands: `expired` is
// a window closed without a sign-in, or ten minutes gone by; an `error` comes as a failed request
// does, with its code, its sentence and the reason where there is one.
export type YtmWireWebLoginState =
    | { state: 'waiting' | 'expired' }
    | { state: 'confirmed'; account: unknown }
    | { state: 'error'; message: string; code?: string; reason?: string };

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface YtmTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: YtmTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectYtmTransport = (next: YtmTransportEnv): void => {
    env = next;
};

const host = (): YtmTransportEnv => {
    if (!env) throw new Error('[Ytm] the transport is not connected (activate has not run)');
    return env;
};

// The codes the host reads; the bridge gives only these (main/errors.cjs). One it might add later is read as an
// answer that could not be read, as the host would not know it either.
const CODES: ReadonlySet<string> = new Set<FoliumSourceErrorCode>([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
]);

/**
 * The desktop side's word for why a request failed, where it said one. Rides on the error as its `cause`, which
 * the host keeps when it names the source on the error (a new object), so it is recognised by identity here.
 */
export interface YtmReason { readonly reason: string }
const reasons = new WeakSet();

/** The desktop side's reason an error of a YouTube Music request carries, or null. */
export const ytmReasonOf = (error: unknown): string | null => {
    const cause: unknown = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
    return typeof cause === 'object' && cause !== null && reasons.has(cause) ? (cause as YtmReason).reason : null;
};

/** An error of the host's, with the bridge's code (or `invalid-response` for one the host does not know) and sentence. */
export const ytmError = (code: string | undefined, message: string, reason?: string): FoliumSourceError => {
    const known = code !== undefined && CODES.has(code) ? code as FoliumSourceErrorCode : 'invalid-response';
    if (!reason) return host().error(known, message);
    const cause: YtmReason = Object.freeze({ reason });
    reasons.add(cause);
    return host().error(known, message, { cause });
};

export async function requestYtm<T = unknown>(operation: YtmOperation, params: YtmParams = {}): Promise<T> {
    const transport = host();
    const startedAt = Date.now();
    let result: YtmBridgeResult;
    try { result = await transport.call<YtmBridgeResult>('request', operation, params); }
    catch (error) {
        console.warn(`[Ytm] ${operation} did not reach the desktop app`, error);
        throw ytmError('network', 'YouTube Music desktop request failed');
    }
    if (!result.ok) {
        console.warn(`[Ytm] ${operation} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message})`);
        throw ytmError(result.error.code, result.error.message, result.error.reason);
    }
    // A page YouTube has changed reads as an empty list, which nothing else would tell from a real one.
    const items = (result.data as { items?: unknown } | null)?.items;
    if (Array.isArray(items) && items.length === 0) console.log(`[Ytm] ${operation} returned no items`);
    return result.data as T;
}
