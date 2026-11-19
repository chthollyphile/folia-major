import type { FoliumSourceAvailability, FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails, FoliumText } from '@folia/folium';

// sources/appleMusic/client/appleMusicTransport.ts
// The source's sole boundary to the isolated desktop companion: requests go through folium.rpc's `request` to the
// main entry (main/index.ts), which hands them to the companion's client (main/companionClient.cjs). The page and its
// signed-in session live in the companion process; only the shapes below cross over.
// The queue is Folia's: no next/previous of the companion's own.

export type AppleMusicOperation = 'showWindow' | 'hideWindow' | 'logout' | 'accountStatus' | 'search' | 'playlists' | 'playlistTracks' | 'playlistTrackCount' | 'lyrics'
    | 'songOriginal' | 'catalogSong' | 'catalogAlbum' | 'catalogAlbumTracks' | 'catalogArtist' | 'catalogArtistSongs' | 'catalogArtistAlbums' | 'libraryAlbums' | 'librarySongs' | 'libraryAlbumTracks' | 'stations' | 'station' | 'playStation' | 'personalFm' | 'addPlaylistTracks' | 'likeSong' | 'prepareNext' | 'playbackStatus' | 'playSong' | 'pause' | 'resume' | 'seek' | 'setVolume' | 'setRepeatOne';
export type AppleMusicParams = Record<string, string | number | boolean | string[] | undefined>;
export type AppleMusicBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: string; httpStatus?: number | null; playbackStage?: string };

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface AppleMusicTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: AppleMusicTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectAppleMusicTransport = (next: AppleMusicTransportEnv): void => {
    env = next;
};

const host = (): AppleMusicTransportEnv => {
    if (!env) throw new Error('[AppleMusic] the transport is not connected (activate has not run)');
    return env;
};

/**
 * An error of the host's for this source. `cause` is the companion's own word for the failure (`not-ready`,
 * `runtime-unavailable`, `stale-request`, `lyrics-unavailable`, …): the host keeps it on the error when it names the
 * source on it, and this source reads it back with `appleMusicCauseOf`.
 */
export const appleMusicError = (code: FoliumSourceErrorCode, message: string, cause?: string, httpStatus?: number): FoliumSourceError => (
    host().error(code, message, {
        ...(cause !== undefined ? { cause } : {}),
        ...(httpStatus !== undefined ? { httpStatus } : {}),
    })
);

const fieldsOf = (error: unknown): { code?: unknown; cause?: unknown; httpStatus?: unknown } | null => (
    error instanceof Error ? error : null
);

/** The companion's word for why a request failed (the error's cause), or null. */
export const appleMusicCauseOf = (error: unknown): string | null => {
    const cause = fieldsOf(error)?.cause;
    return typeof cause === 'string' ? cause : null;
};

/** The host's code of a failed request (`auth-required`, …), or null for an error that is not one of the host's. */
export const appleMusicCodeOf = (error: unknown): string | null => {
    const code = fieldsOf(error)?.code;
    return typeof code === 'string' ? code : null;
};

/** The HTTP status a failed request carries, or null. */
export const appleMusicHttpStatusOf = (error: unknown): number | null => {
    const status = fieldsOf(error)?.httpStatus;
    return typeof status === 'number' ? status : null;
};

/**
 * Whether the source can be used here. macOS and Windows ship the system-WebView host (WKWebView / WebView2
 * Evergreen); Linux stays visible with a line of the source's own and never starts an unsupported player.
 */
export const appleMusicAvailability = (platform: string, linuxUnsupported: FoliumText): FoliumSourceAvailability => {
    if (platform === 'darwin' || platform === 'win32') return { configured: true };
    if (platform === 'linux') return { configured: false, reason: 'not-configured', message: linuxUnsupported };
    return { configured: false, reason: 'runtime-unavailable' };
};

// Translate protocol failures into the common provider error without copying credentials or response bodies.
const errorCode = (error: string): FoliumSourceErrorCode => {
    if (error === 'auth-required') return 'auth-required';
    if (error === 'invalid-response' || error === 'invalid-request') return 'invalid-response';
    if (error === 'unsupported') return 'unsupported';
    // The page had the track but refused to play it: not a network failure, and retrying it at once is pointless.
    if (error === 'playback-failed') return 'not-playable';
    if (error === 'timeout' || error === 'disconnected' || error === 'request-failed') return 'network';
    return 'unavailable';
};

export async function requestAppleMusic<T>(operation: AppleMusicOperation, params: AppleMusicParams = {}): Promise<T> {
    const transport = host();
    let result: AppleMusicBridgeResult;
    try {
        result = await transport.call<AppleMusicBridgeResult>('request', operation, params);
    } catch (error) {
        console.warn('[AppleMusic] Desktop request failed', error);
        throw appleMusicError('network', 'Apple Music companion request failed');
    }
    if (!result.ok) {
        // Only fixed stage names enter the error; never forward remote exception text or URLs.
        const stages = ['prepared-queue', 'configure', 'queue', 'play', 'seek'];
        const stage = result.error === 'playback-failed' && stages.includes(result.playbackStage ?? '') ? result.playbackStage : undefined;
        throw appleMusicError(errorCode(result.error), `Apple Music companion request failed${stage ? ` (stage: ${stage})` : ''}`, result.error, result.httpStatus ?? undefined);
    }
    return result.data as T;
}
