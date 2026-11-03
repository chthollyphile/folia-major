import type { MutableRefObject, RefObject } from 'react';
import { applyOnlineAudioSourceMetadata } from '../../../../services/onlinePlayback';
import type { SongResult } from '../../../../types';
import type { AudioQualityPreference } from '../../../../types/onlineMusic';
import {
    getOnlineProviderIdForSong,
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    isStagePlaybackSong,
    replacePlaybackSongWhereQueued,
} from '../../../../utils/appPlaybackGuards';
import { setAudioSrc, setCurrentSong, setPlayQueue, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { askedSongKeyRef, startOfAskedSong } from '../currentSong';
import { loadOnlineSongAudio } from '../source/songAudioSource';
import { onlineFailureOf, type OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';

// src/components/app/playback/restore/createOnlineRecoveryController.ts

// What asking for the song's address again came to. `failure` is there where the address was asked
// for and could not be had: it says why, where the media error alone would not. `stale`: the song
// changed, or started again, while its address was asked for: nothing is to be done with the answer.
export type OnlineRecovery = { recovered: true } | { recovered: false; stale?: true; failure?: OnlineFailure };

export interface OnlineRecoveryOptions {
    failedSrc?: string | null;
    resumeAt?: number;
    autoplay: boolean;
    // Asked again when the address has come: a pause pressed while it was asked for stands.
    shouldAutoplay?: () => boolean;
    // A retry the listener asked for: the same file may be asked for once more.
    force?: boolean;
    // The media cache's copy is the one that failed to play: the platform is asked, not the cache.
    bypassMediaCache?: boolean;
}

type RecoveryControllerParams = {
    audioQuality: AudioQualityPreference;
    currentSong: SongResult | null;
    audioSrc: string | null;
    audioRef: RefObject<HTMLAudioElement | null>;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    // The recoveries in flight, one per start of a song (its key and `startOfAskedSong`): one for a
    // start never answers for another, also when the same song was started again.
    onlinePlaybackRecoveryRef: MutableRefObject<Map<string, Promise<OnlineRecovery>>>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
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
        // The desktop app's own YouTube Music and Spotify stream URLs are new on every request too:
        // without this a track that keeps failing would be refreshed forever, each time under a
        // different string.
        if (parsedUrl.protocol === 'folia-ytm:' || parsedUrl.protocol === 'folia-spotify:') {
            return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
        }
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

    // Asks for a fresh address for the current online song. What a failure means is the caller's to
    // decide; a failure never touches the queue or the cache.
    const recoverOnlinePlaybackSource = async ({
        failedSrc,
        resumeAt,
        autoplay,
        shouldAutoplay,
        force = false,
        bypassMediaCache = false,
    }: OnlineRecoveryOptions): Promise<OnlineRecovery> => {
        const song = currentSong;
        const audioElement = audioRef.current;

        if (!song || !audioElement || isLocalPlaybackSong(song) || isNavidromePlaybackSong(song) || isStagePlaybackSong(song)) {
            return { recovered: false };
        }

        const normalizedFailedSrc = getOnlineRecoveryKey(failedSrc || audioElement.currentSrc || audioSrc || null);
        if (!force && normalizedFailedSrc && lastAudioRecoverySourceRef.current === normalizedFailedSrc) {
            return { recovered: false };
        }

        const songKey = getPlaybackSongKey(song);
        const start = startOfAskedSong();
        const recoveryKey = `${songKey}#${start}`;
        const pendingRecovery = onlinePlaybackRecoveryRef.current.get(recoveryKey);
        if (pendingRecovery) {
            return pendingRecovery;
        }

        const recoveryTask = (async (): Promise<OnlineRecovery> => {
            if (normalizedFailedSrc) {
                lastAudioRecoverySourceRef.current = normalizedFailedSrc;
            }

            try {
                const audioResult = await loadOnlineSongAudio(song, audioQuality, null, { bypassMediaCache });
                if (askedSongKeyRef.current !== songKey || startOfAskedSong() !== start || !audioRef.current) {
                    if (audioResult.kind === 'ok' && audioResult.blobUrl) {
                        URL.revokeObjectURL(audioResult.blobUrl);
                    }
                    return { recovered: false, stale: true };
                }

                if (audioResult.kind === 'unavailable') {
                    return { recovered: false, failure: audioResult.failure };
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
                    // The queue as it is now: a retry can be pressed long after the error, and the
                    // queue's edits made meanwhile stay.
                    // Only the entry is refreshed with its gain: a song the queue no longer holds (the user
                    // removed it, or a mod replaced the queue) is not put back in front of it.
                    const liveQueue = usePlaybackStore.getState().playQueue;
                    const resolvedQueue = replacePlaybackSongWhereQueued(liveQueue, resolvedSong);
                    if (resolvedQueue) setPlayQueue(resolvedQueue);
                    void persistLastPlaybackCache(
                        resolvedSong,
                        resolvedQueue ?? liveQueue,
                    );
                }

                pendingResumeTimeRef.current = Math.max(0, resumeAt ?? audioRef.current.currentTime ?? 0);
                // A fresh address must not undo a pause pressed while it was asked for.
                shouldAutoPlayRef.current = autoplay && (shouldAutoplay?.() ?? true);
                currentOnlineAudioUrlFetchedAtRef.current = audioResult.fetchedAt;
                setAudioSrc(audioResult.audioSrc);
                return { recovered: true };
            } catch (error) {
                console.error('[App] Failed to recover online playback source', error);
                const providerId = getOnlineProviderIdForSong(song) ?? undefined;
                return { recovered: false, failure: onlineFailureOf({ operation: 'audio', providerId }, { error }) };
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
