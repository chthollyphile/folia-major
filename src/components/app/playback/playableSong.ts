import type { SongResult } from '../../../types';
import { omni } from '../../../services/onlineMusic/omni';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { isLocalPlaybackSong, isNavidromePlaybackSong } from '../../../utils/appPlaybackGuards';
// src/components/app/playback/playableSong.ts
// The two "can this track be played" checks. They are two functions because they do not give the
// same answer: a track its platform marks unavailable fails the queue's check and passes the
// restore's. Both read the provider registry through omni, which is why they are not in
// utils/playbackNeighbors.ts with the index rules.

/**
 * The queue's check, for stepping past tracks that cannot play: local and Navidrome tracks always
 * pass; any other track passes when it is not marked unavailable and its provider can play it.
 */
export const isQueueSongPlayable = (song: SongResult): boolean => {
    if (isLocalPlaybackSong(song) || isNavidromePlaybackSong(song)) {
        return true;
    }
    return !isSongUnavailable(song) && omni.canPlaySong(song);
};

/**
 * The session restore's check, for what is kept of the stored last song and queue: a track whose
 * stored source is not an online one always passes; an online track passes when its provider can
 * play it, marked unavailable or not.
 */
export const isRestoredSongPlayable = (song: SongResult): boolean => (
    song.sourceRef?.kind !== 'online' || omni.canPlaySong(song)
);
