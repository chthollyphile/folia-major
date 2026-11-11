import type { OnlineExternalPlaybackProvider, ProviderExternalPlaybackStatus } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { getSpotifyTransportAvailability, requestSpotify } from './spotifyTransport';
import { requireSpotifySong, spotifyUri } from './spotifyNormalize';

// src/services/onlineMusic/spotify/spotifySoloistPlayback.ts
// The ways Spotify plays here, and the second of them. 'standard' is librespot in the desktop
// side (an audio URL, the web route); 'soloist' is Spotify's own Soloist program on this computer,
// for accounts Spotify gives no audio key: it plays to the system's output itself, and the app
// steers it on the external route (services/onlineMusic/externalPlayback.ts) and follows its clock.
// 'client' is the third, Spotify's desktop app steered the same way (spotifyClientPlayback.ts);
// spotifyExternalPlayback.ts picks the one of the two that is on.
// The way is kept by the desktop side (electron/spotify/spotifyApiBridge.cjs, `playback_mode`); it
// is read once at start and after each change, and kept here so the route can be chosen at once.

export type SpotifyPlaybackMode = 'standard' | 'soloist' | 'client';

/** What the desktop side says of the way Spotify plays: the way, and which of the other two are offered at all. */
export interface SpotifyWirePlaybackMode { mode: SpotifyPlaybackMode; soloist: boolean; client?: boolean }

/** What Soloist plays now (electron/spotify/soloist.cjs `status`). */
interface SoloistWireStatus {
    running: boolean;
    paired: boolean;
    uri: string | null;
    status: 'idle' | 'playing' | 'paused' | 'buffering' | string;
    positionMs: number;
    durationMs: number;
    ended: boolean;
}

let mode: SpotifyPlaybackMode = 'standard';
let soloistOffered = false;
let clientOffered = false;
let reading: Promise<SpotifyWirePlaybackMode | null> | null = null;

const MODE_NAMES: Record<SpotifyPlaybackMode, string> = { standard: 'the standard way', soloist: 'Soloist', client: 'the Spotify app' };

/** Told when the way Spotify plays changes: the media keys answered from it follow at once. */
const modeListeners = new Set<() => void>();

export const subscribeSpotifyPlaybackMode = (listener: () => void): (() => void) => {
    modeListeners.add(listener);
    return () => {
        modeListeners.delete(listener);
    };
};

const keep = (answer: SpotifyWirePlaybackMode): SpotifyWirePlaybackMode => {
    const next: SpotifyPlaybackMode = answer.mode === 'soloist' || answer.mode === 'client' ? answer.mode : 'standard';
    const changed = next !== mode;
    if (changed) console.info(`[Spotify] Plays through ${MODE_NAMES[next]}`);
    mode = next;
    soloistOffered = answer.soloist === true;
    clientOffered = answer.client === true;
    // After the answers above are in force: a listener reads the new way, not the one it replaced.
    if (changed) {
        for (const listener of modeListeners) {
            try {
                listener();
            } catch (error) {
                console.warn('[Spotify] a listener of the way Spotify plays threw', error);
            }
        }
    }
    return answer;
};

/** Reads the way Spotify plays from the desktop side; resolves to null where it cannot be asked. */
export const readSpotifyPlaybackMode = (): Promise<SpotifyWirePlaybackMode | null> => {
    if (!getSpotifyTransportAvailability().configured) return Promise.resolve(null);
    if (!reading) {
        const asked = Promise.resolve()
            .then(() => requestSpotify<SpotifyWirePlaybackMode>('playback_mode'))
            .then(answer => (answer && typeof answer === 'object' ? keep(answer) : null), error => {
                console.warn('[Spotify] The way Spotify plays could not be read', error);
                return null;
            })
            .finally(() => { if (reading === asked) reading = null; });
        reading = asked;
    }
    return reading;
};

export const setSpotifyPlaybackMode = async (next: SpotifyPlaybackMode): Promise<void> => {
    keep(await requestSpotify<SpotifyWirePlaybackMode>('playback_mode', { mode: next }));
};

/** Whether Spotify plays through Soloist now (the provider's `externalPlayback` capability). */
export const spotifyPlaysThroughSoloist = (): boolean => mode === 'soloist';
/** Whether Spotify plays on the external route now: through Soloist or through Spotify's own app. */
export const spotifyPlaysExternally = (): boolean => mode !== 'standard';
/** Whether Spotify plays through Spotify's own desktop app now. */
export const spotifyPlaysThroughClient = (): boolean => mode === 'client';
export const spotifySoloistOffered = (): boolean => soloistOffered;
export const spotifyClientOffered = (): boolean => clientOffered;
export const spotifyPlaybackMode = (): SpotifyPlaybackMode => mode;

export const spotifySoloistPlayback: OnlineExternalPlaybackProvider = {
    // The program sounds the song on its own, so a real spectrum needs the machine's own sound. Its
    // start does answer, its status is cheap, and it registers no media session of its own. The
    // commands that move it are taken one after another (the `inTurn` chain in
    // electron/spotify/soloist.cjs), and a seek behind a play waits for that play to take the track:
    // PLAY_LIMIT_MS, ten seconds, is how long the one before it may hold it.
    capturesSystemAudio: true,
    seekLimitMs: 10000,
    canPlay: song => {
        try {
            requireSpotifySong(song);
            return true;
        } catch {
            return false;
        }
    },
    async play(song, startSec) {
        const id = requireSpotifySong(song);
        // The program is told the track's length: it has no event for the end of a track, and the
        // end is read from its position against it.
        const durationMs = createProviderSongMetadata(song).durationMs || 0;
        await requestSpotify('soloist_play', { id, startMs: Math.max(0, Math.round(startSec * 1000)), durationMs });
    },
    async pause() {
        await requestSpotify('soloist_pause');
    },
    async resume() {
        await requestSpotify('soloist_resume');
    },
    async seek(seconds) {
        await requestSpotify('soloist_seek', { positionMs: Math.max(0, Math.round(seconds * 1000)) });
    },
    async setVolume(volume) {
        await requestSpotify('soloist_volume', { volume: Math.round(Math.max(0, Math.min(1, volume)) * 100) });
    },
    async getStatus(): Promise<ProviderExternalPlaybackStatus> {
        const status = await requestSpotify<SoloistWireStatus>('soloist_status');
        if (!status.running) throw new OnlineProviderError('unavailable', 'Spotify Soloist is not running', 'spotify', 'soloist-gone');
        return {
            mediaId: status.uri ?? '',
            isPlaying: status.status === 'playing',
            positionMs: Math.max(0, status.positionMs),
            durationMs: Math.max(0, status.durationMs),
            ended: status.ended,
            starting: status.status === 'buffering',
        };
    },
    isStatusForSong(song, status) {
        try {
            return status.mediaId === spotifyUri('track', requireSpotifySong(song));
        } catch {
            return false;
        }
    },
};
