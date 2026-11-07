import type { OnlineExternalPlaybackProvider } from '../../../types/onlineMusic';
import { spotifyClientPlayback } from './spotifyClientPlayback';
import { readSpotifyPlaybackMode, spotifyPlaybackMode, spotifySoloistPlayback, subscribeSpotifyPlaybackMode } from './spotifySoloistPlayback';

// src/services/onlineMusic/spotify/spotifyExternalPlayback.ts
// Spotify's external player is one of two programs, by the way Spotify plays (spotifySoloistPlayback.ts
// keeps which): Soloist, or Spotify's own desktop app. Every call goes to the one that is on at that
// moment. The standard way has no external player at all: the provider's `externalPlayback`
// capability is off then, and nothing here is called.

const current = (): OnlineExternalPlaybackProvider => (spotifyPlaybackMode() === 'client' ? spotifyClientPlayback : spotifySoloistPlayback);

export const spotifyExternalPlayback: OnlineExternalPlaybackProvider = {
    // Spotify's own app is not started again by an advance of Folia's own; Soloist's failures are reported.
    stopsAutoAdvanceWhenUnreachable: () => spotifyPlaybackMode() === 'client',
    isUnreachableFailure: error => (current().isUnreachableFailure?.(error) ?? false),
    // Only the official app keeps a media session of its own with its own queue in it: the keys are
    // held while that session sounds, so a press cannot reach Spotify's queue instead of Folia's.
    // Soloist registers no such session, and its keys stay the ones the app's own media session has.
    holdsMediaKeys: () => current().holdsMediaKeys?.() === true,
    // Spotify's own app keeps its media session between Folia's songs too, so while it is the way
    // Spotify plays, the keys stay Folia's for as long as Folia runs (the setting that asks for them
    // is the desktop settings'). Soloist registers no session of its own: its keys stay the app's.
    holdsMediaKeysWhileRunning: () => current().holdsMediaKeysWhileRunning?.() === true,
    // The way Spotify plays is picked in Folia's own setup, which changes nothing else the app reads.
    subscribeMediaKeysWanted: listener => subscribeSpotifyPlaybackMode(listener),
    canPlay: song => current().canPlay?.(song) ?? true,
    isPrepared: song => current().isPrepared?.(song) ?? false,
    async prepareNext(song, upcoming) {
        await current().prepareNext?.(song, upcoming);
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
