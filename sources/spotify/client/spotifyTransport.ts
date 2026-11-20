import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';

// sources/spotify/client/spotifyTransport.ts
// The boundary to the main entry (main/index.ts, which hands the operations to spotifyApiBridge.cjs): requests go
// through folium.rpc's `request`. The Spotify token stays in the main process; a query is named here and sent
// there, and its answer comes back as Spotify gave it. The bridge's code and sentence reach the host as they are
// (folium.sources.error); the desktop side's own word for why something failed (a sign-in's reason, Soloist's
// `soloist-*` words) rides on the error as its cause (spotifyReasonOf), which spotifyLoginFailure.ts and
// spotifyFailure.ts read.

export type SpotifyOperation =
    | 'login_start' | 'login_check' | 'login_cancel' | 'login_open' | 'login_status' | 'logout'
    | 'query' | 'radio' | 'lyrics' | 'audio' | 'audio_kept' | 'audio_keep' | 'audio_probe' | 'library' | 'playlist_edit' | 'playlist_create'
    | 'playback_mode' | 'soloist_state' | 'soloist_pick' | 'soloist_key' | 'soloist_restart' | 'soloist_open'
    | 'soloist_play' | 'soloist_pause' | 'soloist_resume' | 'soloist_seek' | 'soloist_volume' | 'soloist_status'
    | 'soloist_repeat';
// The queries the main process sends for the client (`RENDERER_QUERIES` in the bridge).
export type SpotifyQuery =
    | 'home' | 'homeSection' | 'browsePage' | 'queryWhatsNewFeed' | 'libraryV3' | 'fetchLibraryTracks' | 'fetchPlaylist'
    | 'getAlbum' | 'queryArtistOverview' | 'queryArtistDiscographyAll' | 'searchTracks' | 'getTrack' | 'areEntitiesInLibrary';
export type SpotifyParams = Record<string, unknown>;
// `reason`: the desktop side's own word for why it failed, where it has one.
export type SpotifyBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; reason?: string } };

export interface SpotifyWireLoginStart { key: string; expiresInMs: number }
/** The playlist Spotify keeps of the songs like one song. */
export interface SpotifyWireRadio { uri: string }
/** The app's own URL for a track's audio, and the file Spotify chose for it ("OGG_VORBIS_320"). */
export interface SpotifyWireAudio { url: string; format: string }
/** The playlist that was made. */
export interface SpotifyWireMadePlaylist { uri: string }
export interface SpotifyWireLyrics { timed: boolean; lines: Array<{ startMs: number; words: string }> }

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface SpotifyTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: SpotifyTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectSpotifyTransport = (next: SpotifyTransportEnv): void => {
    env = next;
};

const host = (): SpotifyTransportEnv => {
    if (!env) throw new Error('[Spotify] the transport is not connected (activate has not run)');
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
export interface SpotifyReason { readonly reason: string }
const reasons = new WeakSet();

/** The desktop side's reason an error of a Spotify request carries, or null. */
export const spotifyReasonOf = (error: unknown): string | null => {
    const cause: unknown = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
    return typeof cause === 'object' && cause !== null && reasons.has(cause) ? (cause as SpotifyReason).reason : null;
};

/** The code and sentence of an error made with folium.sources.error; nothing for any other. */
export const spotifyCodeOf = (error: unknown): { code: string; message: string } | null => {
    if (!(error instanceof Error)) return null;
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? { code, message: error.message } : null;
};

/** An error of the host's, with the bridge's code (or `invalid-response` for one the host does not know) and sentence. */
export const spotifyError = (code: string | undefined, message: string, reason?: string): FoliumSourceError => {
    const known = code !== undefined && CODES.has(code) ? code as FoliumSourceErrorCode : 'invalid-response';
    if (!reason) return host().error(known, message);
    const cause: SpotifyReason = Object.freeze({ reason });
    reasons.add(cause);
    return host().error(known, message, { cause });
};

export async function requestSpotify<T = unknown>(operation: SpotifyOperation, params: SpotifyParams = {}): Promise<T> {
    const transport = host();
    const named = operation === 'query' ? `${operation} ${String(params.name)}` : operation;
    const startedAt = Date.now();
    let result: SpotifyBridgeResult;
    try { result = await transport.call<SpotifyBridgeResult>('request', operation, params); }
    catch (error) {
        console.warn(`[Spotify] ${named} did not reach the desktop app`, error);
        throw spotifyError('network', 'Spotify desktop request failed');
    }
    if (!result.ok) {
        console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message ?? ''})`);
        throw spotifyError(result.error.code, result.error.message, result.error.reason);
    }
    return result.data as T;
}

// One of Spotify's named queries, answered with the `data` of its reply.
export const querySpotify = <T = unknown>(name: SpotifyQuery, variables: Record<string, unknown> = {}): Promise<T> => (
    requestSpotify<T>('query', { name, variables })
);
