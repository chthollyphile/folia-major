import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { applyOnlineAudioSourceMetadata, loadOnlineSongAudioSource } from '../../../services/onlinePlayback';
import { classifyPlaybackError } from '../../../services/playbackRecovery/onlinePlaybackFailure';
import type { SongResult } from '../../../types';
import type { AudioQualityPreference } from '../../../types/onlineMusic';
import type { OnlineRecoveryOptions, OnlineRecoveryResult } from '../../../types/playbackFailure';
import {
    getOnlineProviderIdForSong,
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    isStagePlaybackSong,
    replacePlaybackSongInQueue,
} from '../../../utils/appPlaybackGuards';
import { setAudioSrc, setCurrentSong, setPlayQueue, usePlaybackStore } from '../../../stores/usePlaybackStore';

// src/components/app/playback/createOnlineRecoveryController.ts

type RecoveryControllerParams = {
    audioQuality: AudioQualityPreference;
    currentSong: SongResult | null;
    audioSrc: string | null;
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSongRef: MutableRefObject<string | number | null>;
    /** Bumped on every commit of the current song, a replay of the same song included (see usePlaybackRuntimeRefs). */
    playbackGenerationRef: MutableRefObject<number>;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    /** In-flight refreshes keyed by playback song key plus generation, so a recovery for one playback never answers for another. */
    onlinePlaybackRecoveryRef: MutableRefObject<Map<string, Promise<OnlineRecoveryResult>>>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    /** Queue at creation. No longer read: a successful refresh replaces the song inside the store's live queue. */
    playQueue: SongResult[];
    onlineAudioUrlTtlMs: number;
    onlineAudioUrlRefreshBufferMs: number;
};

// Provider stream URLs carry a per-request token in the query (QQ mints a fresh `vkey`/`guid`
// every call), so comparing whole URLs never matches and the error -> refresh -> error cycle
// runs unbounded. The origin+path identifies the media file itself, which is what "we already
// refreshed this and it still failed" actually means. Cleared again once playback succeeds.
export const getOnlineRecoveryKey = (src: string | null | undefined): string | null => {
    if (!src) {
        return null;
    }

    try {
        const parsedUrl = new URL(src);
        // Only remote streams carry a token in the query; blob: and friends have no meaningful origin.
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return src;
        }
        return `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
        return src;
    }
};

// Creates online-stream refresh and recovery helpers without tying them to a React hook.
export const createOnlineRecoveryController = ({
    audioQuality,
    currentSong,
    audioSrc,
    audioRef,
    currentSongRef,
    playbackGenerationRef,
    blobUrlRef,
    shouldAutoPlayRef,
    pendingResumeTimeRef,
    onlinePlaybackRecoveryRef,
    lastAudioRecoverySourceRef,
    currentOnlineAudioUrlFetchedAtRef,
    persistLastPlaybackCache,
    onlineAudioUrlTtlMs,
    onlineAudioUrlRefreshBufferMs,
}: RecoveryControllerParams) => {
    const shouldRefreshCurrentOnlineAudioSource = () => {
        if (!currentSong || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong) || isStagePlaybackSong(currentSong)) {
            return false;
        }

        if (!audioSrc || audioSrc.startsWith('blob:')) {
            return false;
        }

        const fetchedAt = currentOnlineAudioUrlFetchedAtRef.current;
        if (!fetchedAt) {
            return false;
        }

        return Date.now() - fetchedAt >= onlineAudioUrlTtlMs - onlineAudioUrlRefreshBufferMs;
    };

    // Fetches a fresh source for the current online song and reports a structured outcome: the
    // caller decides what a failure means, and a result for a song that is no longer playing (or
    // has been played again since the refresh started) is reported as stale so nothing acts on it. A failure never touches the queue or the cache.
    const recoverOnlinePlaybackSource = async ({
        failedSrc,
        resumeAt,
        autoplay,
        shouldAutoplay,
        force = false,
        bypassMediaCache = false,
    }: OnlineRecoveryOptions): Promise<OnlineRecoveryResult> => {
        const song = currentSong;
        const audioElement = audioRef.current;

        if (!song || !audioElement || isLocalPlaybackSong(song) || isNavidromePlaybackSong(song) || isStagePlaybackSong(song)) {
            return { status: 'not-attempted' };
        }

        const normalizedFailedSrc = getOnlineRecoveryKey(failedSrc || audioElement.currentSrc || audioSrc || null);
        // A manual retry (force) is the listener asking again, so it may refresh the same file once more.
        if (!force && normalizedFailedSrc && lastAudioRecoverySourceRef.current === normalizedFailedSrc) {
            return { status: 'not-attempted' };
        }

        const songKey = getPlaybackSongKey(song);
        // 同一首歌重新点播落地也算换了一次播放，只比歌曲 key 不够：旧任务的结果会套到新播放上，失败时暂停它，
        // 成功时把进度拉回第一次出错的位置。所以按「歌曲 key + 播放代次」去重：代次变了就新开任务，不接手旧任务
        // （否则重播自己的出错会拿到旧任务的 stale 而被吞掉），旧任务的结果也按陈旧处理。
        const generation = playbackGenerationRef.current;
        const recoveryKey = `${songKey}#${generation}`;
        const pendingRecovery = onlinePlaybackRecoveryRef.current.get(recoveryKey);
        if (pendingRecovery) {
            return pendingRecovery;
        }

        const providerId = getOnlineProviderIdForSong(song) ?? undefined;
        const recoveryTask = (async (): Promise<OnlineRecoveryResult> => {
            if (normalizedFailedSrc) {
                lastAudioRecoverySourceRef.current = normalizedFailedSrc;
            }

            try {
                const audioResult = await loadOnlineSongAudioSource(song, audioQuality, null, { stage: 'refresh', bypassMediaCache });
                if (playbackGenerationRef.current !== generation || currentSongRef.current !== songKey || !audioRef.current) {
                    if (audioResult.kind === 'ok' && audioResult.blobUrl) {
                        URL.revokeObjectURL(audioResult.blobUrl);
                    }
                    return { status: 'stale' };
                }

                if (audioResult.kind === 'failed') {
                    return { status: 'failed', failure: { ...audioResult.failure, stage: 'refresh' } };
                }

                if (blobUrlRef.current && blobUrlRef.current !== audioResult.blobUrl) {
                    URL.revokeObjectURL(blobUrlRef.current);
                    blobUrlRef.current = null;
                }

                if (audioResult.blobUrl) {
                    blobUrlRef.current = audioResult.blobUrl;
                }

                const resolvedSong = applyOnlineAudioSourceMetadata(song, audioResult.replayGain);
                const replayGain = resolvedSong.replayGain;
                if (replayGain) {
                    setCurrentSong(prev => {
                        if (!prev || !isSamePlaybackSong(prev, song)) return prev;
                        return { ...prev, replayGain };
                    });
                    // The store's queue as of now, not the one captured at creation: a manual retry can be
                    // pressed long after the error, and queue edits made meanwhile must survive it.
                    const resolvedQueue = replacePlaybackSongInQueue(usePlaybackStore.getState().playQueue, resolvedSong);
                    setPlayQueue(resolvedQueue);
                    void persistLastPlaybackCache(
                        resolvedSong,
                        resolvedQueue,
                    );
                }

                pendingResumeTimeRef.current = Math.max(0, resumeAt ?? audioRef.current.currentTime ?? 0);
                // Resolving a fresh source must not undo a pause while the request
                // was in flight. Other recovery callers retain their autoplay policy.
                shouldAutoPlayRef.current = autoplay && (shouldAutoplay?.() ?? true);
                currentOnlineAudioUrlFetchedAtRef.current = audioResult.audioSrc.startsWith('blob:')
                    ? null
                    : Date.now();
                setAudioSrc(audioResult.audioSrc);
                return { status: 'recovered' };
            } catch (error) {
                console.error('[App] Failed to recover online playback source', error);
                return { status: 'failed', failure: classifyPlaybackError(error, { stage: 'refresh', providerId }) };
            } finally {
                onlinePlaybackRecoveryRef.current.delete(recoveryKey);
            }
        })();

        onlinePlaybackRecoveryRef.current.set(recoveryKey, recoveryTask);
        return recoveryTask;
    };

    return {
        shouldRefreshCurrentOnlineAudioSource,
        recoverOnlinePlaybackSource,
    };
};
