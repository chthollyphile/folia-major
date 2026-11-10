import type { OnlineExternalPlaybackProvider } from '../../../types/onlineMusic';
import { spotifyClientPlayback } from './spotifyClientPlayback';
import { readSpotifyPlaybackMode, setSpotifyPlaybackMode, spotifyPlaybackMode, spotifySoloistPlayback } from './spotifySoloistPlayback';

// src/services/onlineMusic/spotify/spotifyExternalPlayback.ts
// Spotify's external player is one of two programs, by the way Spotify plays (spotifySoloistPlayback.ts
// keeps which): Soloist, or Spotify's own desktop app. Every call goes to the one that is on at that
// moment. The standard way has no external player at all: the provider's `externalPlayback`
// capability is off then, and nothing here is called.

const current = (): OnlineExternalPlaybackProvider => (spotifyPlaybackMode() === 'client' ? spotifyClientPlayback : spotifySoloistPlayback);

export const spotifyExternalPlayback: OnlineExternalPlaybackProvider = {
    // Spotify's own app is not started again by an advance of Folia's own; Soloist's failures are reported.
    stopsAutoAdvanceWhenUnreachable: () => spotifyPlaybackMode() === 'client',
    // The way back out: an app that is not installed, or a build whose player Folia no longer finds,
    // is played by Folia itself instead (the standard way). The other program is left as it is.
    async useStandardPlayback() {
        await setSpotifyPlaybackMode('standard');
    },
    isUnreachableFailure: error => (current().isUnreachableFailure?.(error) ?? false),
    // Both programs sound the song outside every page of the app, so both take the machine's own
    // sound for a real spectrum; the other three are the official app's alone. Read from whichever
    // way is on, so the answers follow a change of it.
    get capturesSystemAudio() {
        return current().capturesSystemAudio === true;
    },
    get startsWithoutWaiting() {
        return current().startsWithoutWaiting === true;
    },
    get backsOffStatusPolls() {
        return current().backsOffStatusPolls === true;
    },
    get holdsMediaKeysWhilePlaying() {
        return current().holdsMediaKeysWhilePlaying === true;
    },
    canPlay: song => current().canPlay?.(song) ?? true,
    isPrepared: song => current().isPrepared?.(song) ?? false,
    async prepareNext(song, upcoming, options) {
        await current().prepareNext?.(song, upcoming, options);
    },
    play: (song, startSec, options) => current().play(song, startSec, options),
    adopt: song => current().adopt?.(song),
    pause: () => current().pause(),
    resume: () => current().resume(),
    seek: seconds => current().seek(seconds),
    setVolume: volume => current().setVolume?.(volume) ?? Promise.resolve(),
    // Only the way that runs Spotify's own app can be running a track Folia is not: Soloist's player
    // is steered by Folia alone, so it answers nothing here.
    runningPositionMs: async song => (await current().runningPositionMs?.(song)) ?? null,
    // The app left running by an earlier run, which this run may have found no port for yet: its own
    // read brings the one search for that port. Soloist is steered by Folia alone and answers nothing.
    runningStatus: song => current().runningStatus?.(song) ?? Promise.resolve(null),
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
