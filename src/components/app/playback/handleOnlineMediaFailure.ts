import type { SongResult } from '../../../types';
import type {
    OnlineRecoveryOptions,
    OnlineRecoveryResult,
    PlaybackFailure,
    PlaybackFailureSkipOptions,
} from '../../../types/playbackFailure';
import { distrustCachedSongAudio } from '../../../services/playbackRecovery/mediaCacheGuard';
import { classifyMediaPlaybackFailure } from '../../../services/playbackRecovery/onlinePlaybackFailure';
import { getOnlineProviderIdForSong, getPlaybackSongKey } from '../../../utils/appPlaybackGuards';

// src/components/app/playback/handleOnlineMediaFailure.ts
// <audio> 播放在线源出错时的处理：刷新一次音源，拿不到时把结构化原因交给统一的失败策略。

export interface OnlineMediaFailureInput {
    audioElement: HTMLAudioElement;
    failedSrc: string;
    song: SongResult;                 // 在线歌曲（不是本地、Navidrome 或 stage）
    playbackGeneration: number;       // 出错时的播放代次（playbackGenerationRef.current），由调用方在 onError 里同步读取
    autoplay: boolean;
    recoverOnlinePlaybackSource: (options: OnlineRecoveryOptions) => Promise<OnlineRecoveryResult>;
    skipAfterPlaybackFailure: (failure?: PlaybackFailure, options?: PlaybackFailureSkipOptions) => void;
}

/** 在线源的媒体元素错误：先刷新一次 URL；拿到结构化原因后交给统一策略，陈旧结果直接丢弃。 */
export const handleOnlineMediaFailure = async ({
    audioElement,
    failedSrc,
    song,
    playbackGeneration,
    autoplay,
    recoverOnlinePlaybackSource,
    skipAfterPlaybackFailure,
}: OnlineMediaFailureInput): Promise<void> => {
    // 第一次 await 之前取齐现场：之后元素可能已换源，歌曲也可能已切换。
    const mediaCode = audioElement.error?.code ?? null;
    const resumeAt = audioElement.currentTime;
    const failedSongKey = getPlaybackSongKey(song);
    // 同一首歌重新点播落地后 key 不变、代次变：旧失败据此不再算当前，不会暂停或打扰新的那次播放。
    const failedGeneration = playbackGeneration;
    const providerId = getOnlineProviderIdForSong(song) ?? undefined;

    // MEDIA_ERR_ABORTED：加载被主动中止（通常是换源），不是失败。
    const mediaFailure = classifyMediaPlaybackFailure(mediaCode, { providerId });
    if (!mediaFailure) return;

    // 缓存 blob 解码失败时，本会话内不再信任这份缓存，刷新也绕过它直接问 provider。
    const isBlob = failedSrc.startsWith('blob:');
    if (isBlob) {
        distrustCachedSongAudio(song);
    }

    // 手动重试：跳过按媒体文件的去重再刷新一次，并回到出错时的位置。
    // 仍失败就再次展示原因，并再给这同一个重试：不落回队列控制器默认的重试（那会经 playSong 从头播放）。
    const retry = (): void => {
        void recoverOnlinePlaybackSource({ force: true, autoplay: true, resumeAt, bypassMediaCache: isBlob })
            .then(retried => {
                if (retried.status === 'failed') {
                    skipAfterPlaybackFailure(retried.failure, { failedSongKey, failedGeneration, retry });
                }
            });
    };

    const result = await recoverOnlinePlaybackSource({ failedSrc, resumeAt, autoplay, bypassMediaCache: isBlob });
    if (result.status === 'recovered' || result.status === 'stale') return;

    // not-attempted：同一个媒体文件刷新过仍然出错，或不适用刷新，只能按媒体错误码给出原因。
    const failure = result.status === 'failed' ? result.failure : mediaFailure;
    skipAfterPlaybackFailure(failure, { failedSongKey, failedGeneration, retry });
};
