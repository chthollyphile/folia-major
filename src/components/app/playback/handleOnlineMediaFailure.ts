import type { SongResult } from '../../../types';
import { distrustCachedSongAudio } from '../../../services/playbackRecovery/mediaCacheGuard';
import { logOnlineFailure, mediaFailureOf, type OnlineFailure } from '../../../services/onlineMusic/failure/onlineFailureCase';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { startOfAskedSong } from './currentSong';
import type { OnlineRecovery, OnlineRecoveryOptions } from './restore/createOnlineRecoveryController';
import type { PlaybackFailureSkipOptions } from './start/usePlaybackQueueController';

// src/components/app/playback/handleOnlineMediaFailure.ts
// The player could not play an online song's audio (its media element's `error`): the address is asked
// for once more, and where that cannot help either, why the song does not play is handed to the queue
// (skipAfterPlaybackFailure), which tells it and decides whether to skip.

// The load was stopped on purpose (a new source was set): not a failure.
const MEDIA_ERR_ABORTED = 1;

export interface OnlineMediaFailureInput {
    audioElement: HTMLAudioElement;
    failedSrc: string;
    // An online song (not a local, Navidrome or stage one).
    song: SongResult;
    autoplay: boolean;
    recoverOnlinePlaybackSource: (options: OnlineRecoveryOptions) => Promise<OnlineRecovery>;
    skipAfterPlaybackFailure: (shown?: OnlineFailure, options?: PlaybackFailureSkipOptions) => void;
}

export const handleOnlineMediaFailure = async ({
    audioElement,
    failedSrc,
    song,
    autoplay,
    recoverOnlinePlaybackSource,
    skipAfterPlaybackFailure,
}: OnlineMediaFailureInput): Promise<void> => {
    // All read before the first wait: by then the element may have a new source, and another song may play.
    const mediaError = audioElement.error;
    if (mediaError?.code === MEDIA_ERR_ABORTED) return;
    const resumeAt = audioElement.currentTime;
    const failedSongKey = getPlaybackSongKey(song);
    // The same song played again keeps its key but is another start: this failure is not about it.
    const failedStart = startOfAskedSong();
    const mediaFailure = mediaFailureOf(mediaError, getOnlineProviderIdForSong(song) ?? undefined);
    logOnlineFailure(mediaFailure);

    // A copy from the media cache that cannot be decoded is not trusted again in this session: the
    // address is asked of the platform, past the cache.
    const isBlob = failedSrc.startsWith('blob:');
    if (isBlob) distrustCachedSongAudio(song);

    // The retry the listener can press: the address once more (the same file may be asked for again),
    // from where it failed. Failing again, the reason is told again, with this same retry.
    const retry = (): void => {
        void recoverOnlinePlaybackSource({ force: true, autoplay: true, resumeAt, bypassMediaCache: isBlob })
            .then(retried => {
                if (!retried.recovered && !retried.stale) {
                    skipAfterPlaybackFailure(retried.failure ?? mediaFailure, { failedSongKey, failedStart, retry });
                }
            });
    };

    const recovery = await recoverOnlinePlaybackSource({ failedSrc, resumeAt, autoplay, bypassMediaCache: isBlob });
    if (recovery.recovered || recovery.stale) return;
    // An online song that cannot be played says why: what asking for its address again came to, or
    // else the media error's code.
    skipAfterPlaybackFailure(recovery.failure ?? mediaFailure, { failedSongKey, failedStart, retry });
};
