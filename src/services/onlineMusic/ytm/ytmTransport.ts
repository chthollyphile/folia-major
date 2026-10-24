import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

// src/services/onlineMusic/ytm/ytmTransport.ts
// The IPC boundary to electron/ytm/ytmApiBridge.cjs. Google credentials stay in the main process;
// only the shapes below cross over.

export type YtmOperation =
    | 'login_status' | 'logout'
    | 'web_login_start' | 'web_login_check' | 'web_login_cancel' | 'web_login_open'
    | 'search_songs' | 'song_detail' | 'song_detail_en' | 'song_detail_zh' | 'lyrics' | 'album' | 'artist' | 'playlist' | 'public_playlist' | 'user_playlists' | 'user_albums' | 'audio'
    | 'explore' | 'mix' | 'playlist_edit' | 'list_save' | 'list_saved' | 'song_like' | 'song_versions' | 'played_as';
export type YtmParams = Record<string, string | undefined>;
// `reason`: the desktop side's own word for why a sign-in failed, where it has one.
export type YtmBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: ProviderErrorCode; message: string; reason?: string } };

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
    | { state: 'error'; message: string; code?: ProviderErrorCode; reason?: string };

export const getYtmTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.ytmRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestYtm<T = unknown>(operation: YtmOperation, params: YtmParams = {}): Promise<T> {
    if (!getYtmTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', 'YouTube Music requires the desktop app', 'ytm');
    }
    const startedAt = Date.now();
    let result: YtmBridgeResult;
    try { result = await window.electron!.ytmRequest(operation, params); }
    catch {
        console.warn(`[Ytm] ${operation} did not reach the desktop app`);
        throw new OnlineProviderError('network', 'YouTube Music desktop request failed', 'ytm');
    }
    if (!result.ok) {
        console.warn(`[Ytm] ${operation} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message ?? ''})`);
        // The reason goes with the error as its cause (ytmLoginFailure.ts reads it there).
        throw new OnlineProviderError(result.error.code, result.error.message, 'ytm', result.error.reason);
    }
    // A page YouTube has changed reads as an empty list, which nothing else would tell from a real one.
    const items = (result.data as { items?: unknown } | null)?.items;
    if (Array.isArray(items) && items.length === 0) console.log(`[Ytm] ${operation} returned no items`);
    return result.data as T;
}
