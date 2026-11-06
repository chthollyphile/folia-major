import type { OnlineExternalPlaybackProvider } from '../../../types/onlineMusic';
import { spotifyClientPlayback } from './spotifyClientPlayback';
import { readSpotifyPlaybackMode, spotifyPlaybackMode, spotifySoloistPlayback } from './spotifySoloistPlayback';

// src/services/onlineMusic/spotify/spotifyExternalPlayback.ts
// Spotify's external player is one of two programs, by the way Spotify plays (spotifySoloistPlayback.ts
// keeps which): Soloist, or Spotify's own desktop app. Every call goes to the one that is on at that
// moment. The standard way has no external player at all: the provider's `externalPlayback`
// capability is off then, and nothing here is called.

const current = (): OnlineExternalPlaybackProvider => (spotifyPlaybackMode() === 'client' ? spotifyClientPlayback : spotifySoloistPlayback);

export const spotifyExternalPlayback: OnlineExternalPlaybackProvider = {
    canPlay: song => current().canPlay?.(song) ?? true,
    isPrepared: song => current().isPrepared?.(song) ?? false,
    async prepareNext(song, upcoming) {
        await current().prepareNext?.(song, upcoming);
    },
    play: (song, startSec, options) => current().play(song, startSec, options),
    pause: () => current().pause(),
    resume: () => current().resume(),
    seek: seconds => current().seek(seconds),
    setVolume: volume => current().setVolume?.(volume) ?? Promise.resolve(),
    getStatus: song => current().getStatus(song),
    isStatusForSong: (song, status) => current().isStatusForSong(song, status),
    // Only Spotify's own app has to be running before a song can sound in it; Soloist is started by
    // the setup checklist, not by the wake-up setting.
    async warmUp() {
        // The way Spotify plays may not be read yet this early in the run.
        await readSpotifyPlaybackMode();
        if (spotifyPlaybackMode() === 'client') await spotifyClientPlayback.warmUp?.();
    },
};
