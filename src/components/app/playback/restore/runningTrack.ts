import type { LyricData, SongResult } from '../../../../types';
import type { MediaId, OnlineProviderId, ProviderExternalPlaybackStatus } from '../../../../types/onlineMusic';
import { omni } from '../../../../services/onlineMusic/omni';
import { isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import { useOnlineProviderAccountStore } from '../../../../stores/useOnlineProviderAccountStore';
import { setCachedCoverUrl, setCurrentSong } from '../../../../stores/usePlaybackStore';
import { getOnlineProviderIdForSong, getPlaybackSongKey, isSamePlaybackSong } from '../../../../utils/appPlaybackGuards';

// src/components/app/playback/restore/runningTrack.ts
// The track a player that outlived the app is on, when it is not the song the session remembered:
// looked up by the id the player names, put in the queue where that song stood, and shown with its
// own cover and lyrics.

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
    if (!providerId) return null;
    return await lookUpTrackOf(providerId, running, isWanted);
};

/**
 * The same lookup for a player whose song this app cannot name: the way of playing that follows its
 * listener is read off the provider, while the screen holds a song no player of that kind could hold.
 */
export const resolveRunningTrackOf = async (
    providerId: OnlineProviderId,
    running: ProviderExternalPlaybackStatus,
    isWanted: () => boolean,
): Promise<SongResult | null> => lookUpTrackOf(providerId, running, isWanted);

const lookUpTrackOf = async (
    providerId: OnlineProviderId,
    running: ProviderExternalPlaybackStatus,
    isWanted: () => boolean,
): Promise<SongResult | null> => {
    if (!running.mediaId) return null;
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

/**
 * The words and the cover of a track this app took over from a player's own window, loaded the way a
 * song change loads them: the song's own, and nothing once the listener moved on to another song
 * while one of them was on its way. A pure-music track and the state of its lyric lookup are patches
 * of the song on screen, and land only on that one.
 */
export const loadTakenTrackDetails = async (
    track: SongResult,
    stillCurrent: () => boolean,
    applyLyrics: (lyrics: LyricData | null) => void,
    /** The account the caller already holds, where it holds one: a restore has its own. */
    knownAccount?: { userId?: MediaId | null },
): Promise<void> => {
    const providerId = getOnlineProviderIdForSong(track);
    // The account of the track's own platform, where one is signed in: the lyric lookup of a
    // platform that has none is asked without it, as every other caller does.
    const account = providerId ? useOnlineProviderAccountStore.getState().accounts[providerId] : undefined;
    const userId: MediaId | null | undefined = knownAccount
        ? knownAccount.userId
        : account ? account.user?.id ?? null : null;
    try {
        // Loaded here rather than beside the bridge: these reach the whole lyric and catalogue side of
        // the app, and the bridge that watches a player is mounted for the whole run.
        const [{ getCachedSongCoverUrl }, { getSongCoverUrl }, { loadOnlineSongLyrics }] = await Promise.all([
            import('../../../../services/onlineMusic/resourceCache'),
            import('../../../../services/onlineMusic/songMetadata'),
            import('../../../../services/onlinePlayback'),
        ]);
        const coverUrl = await getCachedSongCoverUrl(track);
        if (!stillCurrent()) return;
        setCachedCoverUrl(coverUrl ?? getSongCoverUrl(track) ?? null);
        await loadOnlineSongLyrics(track, null, userId, {
            isCurrent: stillCurrent,
            onLyrics: nextLyrics => {
                if (stillCurrent()) applyLyrics(nextLyrics);
            },
            onPureMusicChange: isPureMusic => {
                if (!stillCurrent()) return;
                setCurrentSong(previous => (
                    !previous || !isSamePlaybackSong(previous, track) ? previous : { ...previous, isPureMusic }
                ));
            },
            onStateChange: state => {
                if (!stillCurrent()) return;
                setCurrentSong(previous => (
                    !previous || !isSamePlaybackSong(previous, track) ? previous : { ...previous, onlineLyricsState: state ?? undefined }
                ));
            },
            onDone: () => undefined,
        });
    } catch (error) {
        console.warn('[runningTrack] the track taken over could not be shown with its own cover and lyrics', error);
    }
};
