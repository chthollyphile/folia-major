import type { FoliumSourceExternalPlayback, FoliumSourceExternalStatus } from '@folia/folium';
import { requestSpotify, spotifyError } from './spotifyTransport';
import { requireSpotifySong, spotifyUri } from './spotifyNormalize';

// sources/spotify/client/spotifySoloistPlayback.ts
// The two ways Spotify plays here, and the second of them. 'standard' is librespot in the desktop side (an audio
// URL, playback.audio@1); 'soloist' is Spotify's own Soloist program on this computer, for accounts Spotify gives
// no audio key: it plays to the system's output itself, and the host steers it as an external player
// (playback.external@1) and follows its clock. Which one plays a song is the source's `routeOf`.
// The way is kept by the desktop side (sources/spotify/main/spotifyApiBridge.cjs, `playback_mode`); it is read once
// at start and after each change, and kept here so the route can be chosen at once. A change is told to the host
// (`onModeChanged`), which reads the source again.
// No `adopt` and no `mount`: when the main window is rebuilt, the new window finds Soloist still sounding by
// `isStatusForSong` (its loaded track is the song's uri) and follows it without starting it again.

export type SpotifyPlaybackMode = 'standard' | 'soloist';

/** What the desktop side says of the way Spotify plays: the way, and whether Soloist is offered at all. */
export interface SpotifyWirePlaybackMode { mode: SpotifyPlaybackMode; soloist: boolean }

/** What Soloist plays now (sources/spotify/main/soloist.cjs `status`). */
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
let reading: Promise<SpotifyWirePlaybackMode | null> | null = null;
let onModeChanged: () => void = () => {};

/** What is told when the way Spotify plays changes (activate hands in `handle.changed`). */
export const connectSpotifyPlaybackMode = (changed: () => void): void => { onModeChanged = changed; };

const keep = (answer: SpotifyWirePlaybackMode): SpotifyWirePlaybackMode => {
    const next: SpotifyPlaybackMode = answer.mode === 'soloist' ? 'soloist' : 'standard';
    const changed = next !== mode;
    if (changed) console.info(`[Spotify] Plays through ${next === 'soloist' ? 'Soloist' : 'the standard way'}`);
    mode = next;
    soloistOffered = answer.soloist === true;
    if (changed) onModeChanged();
    return answer;
};

/** Reads the way Spotify plays from the desktop side; resolves to null where it cannot be asked. */
export const readSpotifyPlaybackMode = (): Promise<SpotifyWirePlaybackMode | null> => {
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

/** Whether Spotify plays through Soloist now (the source's `routeOf`). */
export const spotifyPlaysThroughSoloist = (): boolean => mode === 'soloist';
export const spotifySoloistOffered = (): boolean => soloistOffered;
export const spotifyPlaybackMode = (): SpotifyPlaybackMode => mode;

export const spotifySoloistPlayback: FoliumSourceExternalPlayback = {
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
        const durationMs = song.durationMs || 0;
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
    // Folia's single loop as the program's own track repeat: it goes round with no gap.
    async setRepeatOne(enabled) {
        await requestSpotify('soloist_repeat', { enabled });
    },
    async getStatus(): Promise<FoliumSourceExternalStatus> {
        const status = await requestSpotify<SoloistWireStatus>('soloist_status');
        if (!status.running) throw spotifyError('unavailable', 'Spotify Soloist is not running', 'soloist-gone');
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
