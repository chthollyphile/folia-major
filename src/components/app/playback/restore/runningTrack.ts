import type { SongResult } from '../../../../types';
import type { ProviderExternalPlaybackStatus } from '../../../../types/onlineMusic';
import { omni } from '../../../../services/onlineMusic/omni';
import { isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';

// src/components/app/playback/restore/runningTrack.ts
// The track a player that outlived the app is on, when it is not the song the session remembered:
// looked up by the id the player names, and put in the queue in front of that song.

/**
 * The track the player names, looked up in its own platform's catalogue the way any song is looked
 * up by id - no search, no second way into the platform. Null where the player named a track the
 * platform no longer has, where the lookup failed, and where the restore is no longer wanted.
 */
export const resolveRunningTrack = async (
    song: SongResult,
    running: ProviderExternalPlaybackStatus,
    isWanted: () => boolean,
): Promise<SongResult | null> => {
    const providerId = getOnlineProviderIdForSong(song);
    if (!providerId || !running.mediaId) return null;
    let track: SongResult | null;
    try {
        track = await omni.getSongDetail(providerId, running.mediaId);
    } catch (error) {
        console.warn('[runningTrack] The track the player moved on to could not be looked up', error);
        return null;
    }
    if (!track || isSongUnavailable(track) || !isWanted()) return null;
    return track;
};

/**
 * The queue with that track in the place of the remembered song, which stays right behind it with
 * everything that followed it: what the app plays when the track ends is the queue the session
 * remembered. A track the queue already holds is not held twice.
 */
export const queueWithRunningTrack = (
    queue: SongResult[],
    track: SongResult,
    rememberedSong: SongResult,
): SongResult[] => {
    const trackKey = getPlaybackSongKey(track);
    const rememberedKey = getPlaybackSongKey(rememberedSong);
    const rest = queue.filter(song => getPlaybackSongKey(song) !== trackKey);
    const at = rest.findIndex(song => getPlaybackSongKey(song) === rememberedKey);
    return at < 0 ? [track, ...rest] : [...rest.slice(0, at), track, ...rest.slice(at)];
};
