import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { loadOnlineSongAudioSource, loadOnlineSongLyrics } from '../services/onlinePlayback';
import { getSongReplacement, isSongUnavailable } from '../services/onlineMusic/songAvailability';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import { omni } from '../services/onlineMusic/omni';
import { getCachedSongCoverUrl, hasCachedSongAudio } from '../services/onlineMusic/resourceCache';
import { getPrefetchedData, invalidateAndRefetch, prefetchNearbySongs } from '../services/prefetchService';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { loadOnlineLyricsState } from '../utils/onlineLyricsState';
import { PlayerState, type StagePlayerQueueDiffOp, type StagePlayerQueueRequest, type StagePlayerSnapshot } from '../types';
import type { LocalSong, QueueAddBehavior, SongResult, StatusMessage, UnifiedSong } from '../types';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import type { NextTrackOptions, PlaybackNavigationOptions, SkipPromptMessageKey, UnavailableReplacementRequest } from '../types/appPlayback';
import type { NavidromeSong } from '../types/navidrome';
import {
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    resolveNavidromePlaybackCarrier,
} from '../utils/appPlaybackGuards';
import { applyQueueAddBehavior } from '../utils/queueAddBehavior';
import { buildStagePlayerSnapshot, resolveStagePlayerQueueItemIndex } from '../utils/stagePlayerSnapshot';
import type { LocalLibraryDisplayCatalog } from '../services/playbackAdapters';
import type { SearchReturnView, SearchSource } from '../stores/useSearchNavigationStore';
import { dispatchSearchTrackAction } from '../components/app/search/searchTrackActions';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';

// src/hooks/usePlaybackQueueController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type SearchDeps = {
    submitSearch: (args: {
        query: string;
        sourceTab: SearchSource;
        deps: {
            localSongs: LocalSong[];
            localLibraryCatalog?: LocalLibraryDisplayCatalog;
            t: (key: string, fallback?: string) => string;
        };
        returnView?: SearchReturnView;
    }) => Promise<boolean>;
    loadMoreSearchResults: (args: {
        deps: {
            localSongs: LocalSong[];
            localLibraryCatalog?: LocalLibraryDisplayCatalog;
            t: (key: string, fallback?: string) => string;
        };
    }) => Promise<void>;
};

type UsePlaybackQueueControllerParams = {
    t: (key: string, options?: any) => string;
    audioQuality: AudioQualityPreference;
    activePlaybackContext: 'main' | 'stage';
    currentSong: SongResult | null;
    playQueue: SongResult[];
    playerState: PlayerState;
    loopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isNowPlayingStageActive: boolean;
    queueAddBehavior: QueueAddBehavior;
    searchQuery: string;
    searchSourceTab: SearchSource;
    searchReturnView: SearchReturnView;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryDisplayCatalog;
    userId?: MediaId;
    currentTime: MotionValue<number>;
    setCurrentSong: SetState<SongResult | null>;
    setLyrics: (nextLyrics: any) => void;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setPlayQueue: SetState<SongResult[]>;
    setPlayerState: SetState<PlayerState>;
    setCurrentLineIndex: SetState<number>;
    setDuration: SetState<number>;
    setIsLyricsLoading: SetState<boolean>;
    setStatusMsg: SetState<StatusMessage | null>;
    setIsFmMode: SetState<boolean>;
    setPanelTab: SetState<'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi' | 'onlineLyrics'>;
    setIsPanelOpen: SetState<boolean>;
    navigateToPlayer: () => void;
    navigateToSearch: (args: {
        query: string;
        sourceTab: SearchSource;
        replace?: boolean;
        returnView?: SearchReturnView;
    }) => void;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    restoreCachedThemeForSong: (songOrId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    interruptStagePlaybackForMainTransition: () => unknown;
    onPlayLocalSong: (localSong: LocalSong, queue?: LocalSong[], options?: PlaybackNavigationOptions) => Promise<void>;
    onPlayNavidromeSong: (
        navidromeSong: NavidromeSong,
        queue?: NavidromeSong[],
        options?: PlaybackNavigationOptions,
    ) => Promise<void>;
    onAddLocalSongToQueue: (localSong: LocalSong) => void;
    onAddNavidromeSongsToQueue: (songs: NavidromeSong[]) => void;
    searchDeps: SearchDeps;
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    currentSongRef: MutableRefObject<string | number | null>;
    mainPlaybackSnapshotRef: MutableRefObject<{
        currentSong: SongResult | null;
        lyrics: any;
        cachedCoverUrl: string | null;
        audioSrc: string | null;
        playQueue: SongResult[];
        isFmMode: boolean;
        playerState: PlayerState;
        currentTime: number;
        duration: number;
        currentLineIndex: number;
    } | null>;
    playbackRequestIdRef: MutableRefObject<number>;
    playbackAutoSkipCountRef: MutableRefObject<number>;
    pendingUnavailableSkipTimerRef: MutableRefObject<number | null>;
    pendingUnavailableSkipIntervalRef: MutableRefObject<number | null>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
};

const MAX_UNAVAILABLE_AUTO_SKIP_COUNT = 2;
const UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS = 5000;
const UNAVAILABLE_SKIP_CONFIRM_INTERVAL_MS = 1000;

const getStageSnapshotSongDurationMs = (song: SongResult | null, fallbackSec = 0): number => {
    return Math.max(0, Math.floor(getProviderSongMetadata(song).durationMs || fallbackSec * 1000 || 0));
};

type StagePlayerQueueDiffDraft = {
    ops: StagePlayerQueueDiffOp[];
    requiresReload?: true;
};

// Owns queue navigation, online playback loading, and search-triggered playback.
export function usePlaybackQueueController({
    t,
    audioQuality,
    activePlaybackContext,
    currentSong,
    playQueue,
    playerState,
    loopMode,
    isFmMode,
    isNowPlayingStageActive,
    queueAddBehavior,
    searchQuery,
    searchSourceTab,
    searchReturnView,
    localSongs,
    localLibraryCatalog,
    userId,
    currentTime,
    setCurrentSong,
    setLyrics,
    setCachedCoverUrl,
    setAudioSrc,
    setPlayQueue,
    setPlayerState,
    setCurrentLineIndex,
    setDuration,
    setIsLyricsLoading,
    setStatusMsg,
    setIsFmMode,
    setPanelTab,
    setIsPanelOpen,
    navigateToPlayer,
    navigateToSearch,
    persistLastPlaybackCache,
    restoreCachedThemeForSong,
    interruptStagePlaybackForMainTransition,
    onPlayLocalSong,
    onPlayNavidromeSong,
    onAddLocalSongToQueue,
    onAddNavidromeSongsToQueue,
    searchDeps,
    audioRef,
    blobUrlRef,
    shouldAutoPlayRef,
    currentSongRef,
    mainPlaybackSnapshotRef,
    playbackRequestIdRef,
    playbackAutoSkipCountRef,
    pendingUnavailableSkipTimerRef,
    pendingUnavailableSkipIntervalRef,
    pendingResumeTimeRef,
    currentOnlineAudioUrlFetchedAtRef,
    lastAudioRecoverySourceRef,
}: UsePlaybackQueueControllerParams) {
    const [pendingUnavailableReplacement, setPendingUnavailableReplacement] = useState<UnavailableReplacementRequest | null>(null);

    const appendOnlineSongsToMainQueue = useCallback((songs: SongResult[], options?: { suppressToast?: boolean }) => {
        if (songs.length === 0) {
            return { changed: false, deduplicated: false, affectedCount: 0, baseQueue: [], affectedSongs: [], addBehavior: queueAddBehavior };
        }

        const mainSnapshot = activePlaybackContext === 'stage' ? mainPlaybackSnapshotRef.current : null;
        const queueAnchorSong = mainSnapshot?.currentSong ?? (activePlaybackContext === 'main' ? currentSong : null);
        const existingQueue = mainSnapshot?.playQueue ?? (activePlaybackContext === 'main' ? playQueue : []);
        const baseQueue = existingQueue.length > 0 ? existingQueue : (queueAnchorSong ? [queueAnchorSong] : []);
        const queueableSongs = songs.filter(song => !isSongUnavailable(song));
        const { nextQueue, affectedSongs, changed } = applyQueueAddBehavior({
            queue: baseQueue,
            songs: queueableSongs,
            currentSong: queueAnchorSong,
            behavior: queueAddBehavior,
        });

        if (activePlaybackContext === 'stage') {
            mainPlaybackSnapshotRef.current = mainSnapshot
                ? { ...mainSnapshot, playQueue: nextQueue }
                : {
                    currentSong: queueAnchorSong,
                    lyrics: null,
                    cachedCoverUrl: null,
                    audioSrc: null,
                    playQueue: nextQueue,
                    isFmMode: false,
                    playerState: PlayerState.IDLE,
                    currentTime: 0,
                    duration: 0,
                    currentLineIndex: -1,
                };
        } else {
            setPlayQueue(nextQueue);
        }

        if (changed && affectedSongs.length > 0) {
            void persistLastPlaybackCache(queueAnchorSong, nextQueue);
        }

        if (changed && affectedSongs.length > 0 && !options?.suppressToast) {
            if (queueAddBehavior === 'next') {
                setStatusMsg({ type: 'success', text: t('status.added_to_next_play'), nonce: Date.now(), durationMs: 1200 });
            } else {
                setStatusMsg({ type: 'success', text: t('status.added_to_play_queue'), nonce: Date.now(), durationMs: 1200 });
            }
        }

        return {
            changed,
            deduplicated: nextQueue.length - baseQueue.length < queueableSongs.length,
            affectedCount: affectedSongs.length,
            currentSong: queueAnchorSong,
            baseQueue,
            queue: nextQueue,
            affectedSongs,
            addBehavior: queueAddBehavior,
        };
    }, [activePlaybackContext, currentSong, mainPlaybackSnapshotRef, persistLastPlaybackCache, playQueue, queueAddBehavior, setPlayQueue, setStatusMsg, t]);

    const addOnlineSongToQueue = useCallback((song: SongResult) => {
        if (isSongUnavailable(song)) {
            return;
        }

        appendOnlineSongsToMainQueue([song]);
    }, [appendOnlineSongsToMainQueue]);

    const addOnlineSongsToQueue = useCallback((songs: SongResult[]) => {
        appendOnlineSongsToMainQueue(songs);
    }, [appendOnlineSongsToMainQueue]);

    const clearPendingUnavailableSkip = useCallback(() => {
        if (pendingUnavailableSkipTimerRef.current !== null) {
            window.clearTimeout(pendingUnavailableSkipTimerRef.current);
            pendingUnavailableSkipTimerRef.current = null;
        }

        if (pendingUnavailableSkipIntervalRef.current !== null) {
            window.clearInterval(pendingUnavailableSkipIntervalRef.current);
            pendingUnavailableSkipIntervalRef.current = null;
        }
    }, [pendingUnavailableSkipIntervalRef, pendingUnavailableSkipTimerRef]);

    const isQueueSongPlayable = useCallback((queuedSong: SongResult) => {
        if (isLocalPlaybackSong(queuedSong) || isNavidromePlaybackSong(queuedSong)) {
            return true;
        }
        return !isSongUnavailable(queuedSong) && omni.canPlaySong(queuedSong);
    }, []);

    // Keeps unavailable provider entries in the queue so they can be retried after configuration changes.
    const getPlayableOnlineQueue = useCallback((queue: SongResult[]) => {
        return [...queue];
    }, []);

    const getNextPlayableQueueSong = useCallback((queue: SongResult[], song: SongResult) => {
        const currentSongKey = getPlaybackSongKey(song);
        const currentIndex = queue.findIndex(queuedSong => getPlaybackSongKey(queuedSong) === currentSongKey);
        if (currentIndex === -1) {
            return null;
        }

        for (let index = currentIndex + 1; index < queue.length; index += 1) {
            const candidate = queue[index];
            if (isQueueSongPlayable(candidate)) {
                return candidate;
            }
        }

        if (loopMode === 'all' && queue.length > 1) {
            for (let index = 0; index < currentIndex; index += 1) {
                const candidate = queue[index];
                if (isQueueSongPlayable(candidate)) {
                    return candidate;
                }
            }
        }

        return null;
    }, [isQueueSongPlayable, loopMode]);

    const buildQueueWithReplacementSong = useCallback((
        queue: SongResult[],
        originalSong: SongResult,
        replacementSong: SongResult
    ) => {
        const normalizedQueue = queue.length > 0 ? queue : [originalSong];
        const replacedQueue = normalizedQueue.flatMap((queuedSong) => {
            if (isLocalPlaybackSong(queuedSong) || isNavidromePlaybackSong(queuedSong)) {
                return [queuedSong];
            }

            if (getPlaybackSongKey(queuedSong) === getPlaybackSongKey(originalSong)) {
                return [replacementSong];
            }

            if (isSongUnavailable(queuedSong)) {
                return [];
            }

            return [queuedSong];
        });

        if (replacedQueue.length === 0) {
            return [replacementSong];
        }

        if (!replacedQueue.some(queuedSong => (
            getPlaybackSongKey(queuedSong) === getPlaybackSongKey(replacementSong)
        ))) {
            replacedQueue.push(replacementSong);
        }

        return replacedQueue;
    }, []);

    const handleMarkedUnavailableSong = useCallback(async (
        song: SongResult,
        queue: SongResult[],
        isFmCall: boolean,
        options: PlaybackNavigationOptions
    ) => {
        setIsLyricsLoading(false);
        setStatusMsg({ type: 'info', text: t('status.loadingSong') });
        try {
            const replacement = await getSongReplacement(song);

            if (!replacement || !replacement.song || isSongUnavailable(replacement.song)) {
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                return true;
            }

            setStatusMsg(null);
            setPendingUnavailableReplacement({
                originalSong: song,
                replacementSong: replacement.song,
                replacementSongId: replacement.song.id,
                typeDesc: replacement.label,
                queue,
                isFmCall,
                options,
            });
            return true;
        } catch (error) {
            console.error('[App] Failed to load replacement song before dialog:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            return true;
        }
    }, [t, setIsLyricsLoading, setStatusMsg]);

    const showTimedSkipPrompt = useCallback((
        messageKey: SkipPromptMessageKey,
        onSkip: () => void,
        onCancel?: () => void
    ) => {
        clearPendingUnavailableSkip();

        let remainingSeconds = Math.ceil(UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS / 1000);
        const skip = () => {
            clearPendingUnavailableSkip();
            setStatusMsg(null);
            onSkip();
        };
        const cancel = () => {
            clearPendingUnavailableSkip();
            setStatusMsg(null);
            onCancel?.();
        };
        const buildMessage = (seconds: number): StatusMessage => ({
            type: 'error',
            text: t(messageKey, { seconds }),
            persistent: true,
            actionLabel: t('status.skipUnavailableAction'),
            cancelLabel: t('status.cancel'),
            onAction: skip,
            onCancel: cancel,
        });

        setStatusMsg(buildMessage(remainingSeconds));
        pendingUnavailableSkipTimerRef.current = window.setTimeout(skip, UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS);
        pendingUnavailableSkipIntervalRef.current = window.setInterval(() => {
            remainingSeconds -= 1;
            if (remainingSeconds <= 0) {
                if (pendingUnavailableSkipIntervalRef.current !== null) {
                    window.clearInterval(pendingUnavailableSkipIntervalRef.current);
                    pendingUnavailableSkipIntervalRef.current = null;
                }
                return;
            }

            setStatusMsg(current => {
                if (!current?.persistent) {
                    return current;
                }
                return buildMessage(remainingSeconds);
            });
        }, UNAVAILABLE_SKIP_CONFIRM_INTERVAL_MS);
    }, [clearPendingUnavailableSkip, pendingUnavailableSkipIntervalRef, pendingUnavailableSkipTimerRef, setStatusMsg, t]);

    // Loads one requested song and normalizes queue behavior across sources.
    const playSong = useCallback(async (
        song: SongResult,
        queue: SongResult[] = [],
        isFmCall: boolean = false,
        options: PlaybackNavigationOptions = {}
    ) => {
        interruptStagePlaybackForMainTransition();

        console.log('[App] playSong initiated:', song.name, song.id, 'isFm:', isFmCall);
        clearPendingUnavailableSkip();
        setStatusMsg(prev => prev?.persistent ? null : prev);
        const shouldNavigateToPlayer = options.shouldNavigateToPlayer ?? true;
        setIsFmMode(isFmCall);
        if (isFmCall && !isFmMode) {
            setPanelTab('queue');
            setIsPanelOpen(true);
        }

        const playbackRequestId = ++playbackRequestIdRef.current;
        const isLatestPlaybackRequest = () => playbackRequestIdRef.current === playbackRequestId;
        const isLocal = isLocalPlaybackSong(song);
        const isNavidrome = isNavidromePlaybackSong(song);
        let prefetched: ReturnType<typeof getPrefetchedData> = null;
        let preloadedOnlineAudioResult: Awaited<ReturnType<typeof loadOnlineSongAudioSource>> | null = null;
        const queueContext = queue.length > 0 ? queue : playQueue.length === 0 ? [song] : playQueue;
        const newQueue = getPlayableOnlineQueue(queueContext);
        const skipCount = options.unavailableSkipCount ?? 0;
        playbackAutoSkipCountRef.current = skipCount;

        if (!isLocal && !isNavidrome && isSongUnavailable(song)) {
            if (await handleMarkedUnavailableSong(song, queueContext, isFmCall, options)) {
                return;
            }
        }

        if (isLocal) {
            const localData = localSongs.find(ls => ls.id === song.localRef.songId) ?? null;

            if (!localData) {
                setStatusMsg({ type: 'error', text: t('status.localFilePlaybackError') });
                return;
            }
            const resolvedLocalData = localData;

            const localQueue = queueContext
                .map(queuedSong => {
                    const songId = (queuedSong as UnifiedSong).localRef?.songId;
                    return songId ? localSongs.find(localSong => localSong.id === songId) : undefined;
                })
                .filter((queuedSong): queuedSong is LocalSong => Boolean(queuedSong));
            await onPlayLocalSong(resolvedLocalData, localQueue, {
                shouldNavigateToPlayer,
                unifiedQueue: newQueue,
            });
            return;
        }

        if (isNavidrome) {
            const navidromeSong = resolveNavidromePlaybackCarrier(song);
            if (!navidromeSong) {
                setStatusMsg({ type: 'error', text: t('status.playbackError') });
                return;
            }

            const navidromeQueue = queueContext
                .map(queuedSong => resolveNavidromePlaybackCarrier(queuedSong))
                .filter((queuedSong): queuedSong is NavidromeSong => Boolean(queuedSong));
            await onPlayNavidromeSong(navidromeSong, navidromeQueue, {
                shouldNavigateToPlayer,
                unifiedQueue: newQueue,
            });
            return;
        }

        prefetched = getPrefetchedData(song, audioQuality);

        const hasImmediatePrefetchedAudio = Boolean(
            prefetched?.audioUrl &&
            prefetched.audioUrl !== 'CACHED_IN_DB'
        );
        const hasCachedAudioBlob = hasImmediatePrefetchedAudio
            ? null
            : await hasCachedSongAudio(song);

        if (!isLatestPlaybackRequest()) return;

        if (!hasImmediatePrefetchedAudio && !hasCachedAudioBlob) {
            setStatusMsg({ type: 'info', text: t('status.loadingSong') });
        }

        try {
            preloadedOnlineAudioResult = await loadOnlineSongAudioSource(song, audioQuality, prefetched);
            if (!isLatestPlaybackRequest()) {
                if (preloadedOnlineAudioResult.kind === 'ok' && preloadedOnlineAudioResult.blobUrl) {
                    URL.revokeObjectURL(preloadedOnlineAudioResult.blobUrl);
                }
                return;
            }

            if (preloadedOnlineAudioResult.kind === 'unavailable') {
                const nextSong = getNextPlayableQueueSong(queueContext, song);
                const canSkip = Boolean(nextSong) && skipCount < MAX_UNAVAILABLE_AUTO_SKIP_COUNT;

                setIsLyricsLoading(false);

                if (canSkip && nextSong) {
                    showTimedSkipPrompt('status.songUnavailablePrompt', () => {
                        if (playbackRequestIdRef.current !== playbackRequestId) return;
                        void playSong(nextSong, newQueue, isFmCall, {
                            ...options,
                            unavailableSkipCount: skipCount + 1,
                        });
                    });
                } else {
                    setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                }
                return;
            }
        } catch (error) {
            console.error('[App] Failed to fetch song URL:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            setIsLyricsLoading(false);
            return;
        }

        shouldAutoPlayRef.current = true;
        const songKey = getPlaybackSongKey(song);
        currentSongRef.current = songKey;
        pendingResumeTimeRef.current = null;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;

        const onlineLyricsState = await loadOnlineLyricsState(song);

        setLyrics(null);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setDuration(0);
        setCurrentSong({ ...song, onlineLyricsState: onlineLyricsState ?? undefined });
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setIsLyricsLoading(true);

        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }

        if (queue.length > 0 || playQueue.length === 0) {
            setPlayQueue(newQueue);
        }

        void persistLastPlaybackCache({ ...song, onlineLyricsState: onlineLyricsState ?? undefined }, newQueue);

        if (shouldNavigateToPlayer) {
            navigateToPlayer();
        }
        setPlayerState(PlayerState.IDLE);

        const cachedCoverUrl = await getCachedSongCoverUrl(song);
        if (currentSongRef.current !== songKey) return;
        if (cachedCoverUrl) {
            setCachedCoverUrl(cachedCoverUrl);
        } else if (prefetched?.coverUrl) {
            setCachedCoverUrl(prefetched.coverUrl);
        }

        const audioResult = preloadedOnlineAudioResult;
        if (!audioResult || audioResult.kind !== 'ok') {
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            setPlayerState(PlayerState.IDLE);
            setIsLyricsLoading(false);
            return;
        }

        if (audioResult.blobUrl) {
            blobUrlRef.current = audioResult.blobUrl;
            currentOnlineAudioUrlFetchedAtRef.current = null;
        } else if (audioResult.audioSrc.startsWith('http')) {
            currentOnlineAudioUrlFetchedAtRef.current =
                prefetched?.audioUrl === audioResult.audioSrc
                    ? prefetched.audioUrlFetchedAt
                    : Date.now();
        } else {
            currentOnlineAudioUrlFetchedAtRef.current = null;
        }
        setAudioSrc(audioResult.audioSrc);

        try {
            await loadOnlineSongLyrics(song, prefetched, userId, {
                isCurrent: () => currentSongRef.current === songKey,
                onLyrics: resolvedLyrics => setLyrics(resolvedLyrics),
                onPureMusicChange: isPureMusic => {
                    setCurrentSong(prev => {
                        if (!prev || !isSamePlaybackSong(prev, song)) return prev;
                        return { ...prev, isPureMusic };
                    });
                },
                onStateChange: state => {
                    setCurrentSong(prev => {
                        if (!prev || !isSamePlaybackSong(prev, song)) return prev;
                        return { ...prev, onlineLyricsState: state ?? undefined };
                    });
                },
                onAutoMatchStart: () => {
                    setStatusMsg({ type: 'info', text: t('status.matchingBestLyrics') });
                },
                onDone: () => setIsLyricsLoading(false),
            });
        } catch (error) {
            console.warn('[App] Lyric fetch failed', error);
            setLyrics(null);
            setIsLyricsLoading(false);
        }

        try {
            await restoreCachedThemeForSong(song);
            if (currentSongRef.current !== songKey) return;
        } catch (error) {
            console.warn('Theme load error', error);
        }

        if (newQueue.length > 1) {
            prefetchNearbySongs(song, newQueue, audioQuality, userId);
        }
    }, [
        audioQuality,
        blobUrlRef,
        clearPendingUnavailableSkip,
        currentOnlineAudioUrlFetchedAtRef,
        currentSongRef,
        currentTime,
        getNextPlayableQueueSong,
        getPlayableOnlineQueue,
        handleMarkedUnavailableSong,
        interruptStagePlaybackForMainTransition,
        isFmMode,
        lastAudioRecoverySourceRef,
        localSongs,
        navigateToPlayer,
        onPlayLocalSong,
        onPlayNavidromeSong,
        pendingResumeTimeRef,
        persistLastPlaybackCache,
        playQueue,
        playbackAutoSkipCountRef,
        playbackRequestIdRef,
        restoreCachedThemeForSong,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setIsPanelOpen,
        setLyrics,
        setPanelTab,
        setPlayQueue,
        setPlayerState,
        setStatusMsg,
        shouldAutoPlayRef,
        showTimedSkipPrompt,
        t,
        userId,
    ]);

    const playOnlineQueueFromStart = useCallback((songs: SongResult[]) => {
        const retainedSongs = getPlayableOnlineQueue(songs);
        const firstPlayableSong = retainedSongs.find(isQueueSongPlayable);
        if (!firstPlayableSong) {
            setStatusMsg({ type: 'error', text: t('status.noPlayableSongs') });
            return;
        }

        void playSong(firstPlayableSong, retainedSongs, false);
    }, [getPlayableOnlineQueue, isQueueSongPlayable, playSong, setStatusMsg, t]);

    const handleQueueAddAndPlay = useCallback((song: SongResult) => {
        const songKey = getPlaybackSongKey(song);
        const existingIndex = playQueue.findIndex(candidate => getPlaybackSongKey(candidate) === songKey);
        const nextQueue = [...playQueue];

        if (existingIndex === -1) {
            nextQueue.push(song);
        }

        void playSong(song, nextQueue, false);
    }, [playQueue, playSong]);

    const handleSearchOverlaySubmit = useCallback(async (requestedSource?: SearchSource) => {
        const trimmedQuery = searchQuery.trim();
        if (!trimmedQuery) {
            return;
        }
        const sourceTab = requestedSource ?? searchSourceTab;

        const didSearch = await searchDeps.submitSearch({
            query: trimmedQuery,
            sourceTab,
            deps: {
                localSongs,
                localLibraryCatalog,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
            returnView: searchReturnView,
        });

        if (didSearch) {
            navigateToSearch({
                query: trimmedQuery,
                sourceTab,
                replace: Boolean(window.history.state?.search),
                returnView: searchReturnView,
            });
        }
    }, [
        localLibraryCatalog,
        localSongs,
        navigateToSearch,
        searchDeps,
        searchQuery,
        searchReturnView,
        searchSourceTab,
        t,
    ]);

    const handleSearchLoadMore = useCallback(async () => {
        await searchDeps.loadMoreSearchResults({
            deps: {
                localSongs,
                localLibraryCatalog,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });
    }, [localLibraryCatalog, localSongs, searchDeps, t]);

    const handleSearchResultPlay = useCallback((track: UnifiedSong) => {
        if (!isSongUnavailable(track)) {
            handleQueueAddAndPlay(track);
        }
    }, [handleQueueAddAndPlay]);

    const handleUnavailableReplacementConfirm = useCallback(async () => {
        if (!pendingUnavailableReplacement) {
            return;
        }

        const { originalSong, replacementSong, replacementSongId, queue, isFmCall, options } = pendingUnavailableReplacement;
        setPendingUnavailableReplacement(null);

        try {
            if (!replacementSong || String(replacementSong.id) !== String(replacementSongId) || isSongUnavailable(replacementSong)) {
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                return;
            }

            const replacementQueue = buildQueueWithReplacementSong(queue, originalSong, replacementSong);
            await playSong(replacementSong, replacementQueue, isFmCall, options);
        } catch (error) {
            console.error('[App] Failed to load replacement song:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
        }
    }, [buildQueueWithReplacementSong, pendingUnavailableReplacement, playSong, setStatusMsg, t]);

    const handleSearchResultAddToQueue = useCallback((track: UnifiedSong) => {
        dispatchSearchTrackAction(track, {
            localSongs,
            onLocal: onAddLocalSongToQueue,
            onNavidrome: navidromeSong => onAddNavidromeSongsToQueue([navidromeSong]),
            onOnline: addOnlineSongToQueue,
        });
    }, [
        addOnlineSongToQueue,
        localSongs,
        onAddLocalSongToQueue,
        onAddNavidromeSongsToQueue,
    ]);

    const handleNextTrack = useCallback(async (options?: NextTrackOptions) => {
        if (isNowPlayingStageActive) return;
        if (!currentSong || playQueue.length === 0) return;

        const shouldNavigateToPlayer = options?.shouldNavigateToPlayer ?? true;
        const currentSongKey = getPlaybackSongKey(currentSong);
        const currentIndex = playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey);

        if (isFmMode && currentIndex >= playQueue.length - 2) {
            try {
                const fmSongs = await omni.getPersonalFm();
                if (fmSongs.length > 0) {
                    const nextQueue = [...playQueue, ...fmSongs];
                    setPlayQueue(nextQueue);
                    void playSong(nextQueue[currentIndex + 1], nextQueue, true, {
                        shouldNavigateToPlayer,
                        unavailableSkipCount: options?.unavailableSkipCount,
                    });
                    return;
                }
            } catch (error) {
                console.error('Failed to fetch FM tracks', error);
            }
        }

        let nextIndex = -1;

        if (currentIndex >= 0 && currentIndex < playQueue.length - 1) {
            nextIndex = currentIndex + 1;
        } else if (currentIndex < 0 && playQueue.length > 0) {
            nextIndex = 0;
        } else if (loopMode === 'all') {
            nextIndex = 0;
        }

        if (nextIndex >= 0) {
            void playSong(playQueue[nextIndex], playQueue, isFmMode, {
                shouldNavigateToPlayer,
                unavailableSkipCount: options?.unavailableSkipCount,
            });
        } else if (options?.allowStopOnMissing) {
            if (audioRef.current) {
                audioRef.current.pause();
            }
            setPlayerState(PlayerState.IDLE);
        }
    }, [audioRef, currentSong, isFmMode, isNowPlayingStageActive, loopMode, playQueue, playSong, setPlayQueue, setPlayerState]);

    const handlePrevTrack = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!currentSong || playQueue.length === 0) return;

        const currentSongKey = getPlaybackSongKey(currentSong);
        const currentIndex = playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey);
        let prevIndex = -1;

        if (currentIndex > 0) {
            prevIndex = currentIndex - 1;
        } else if (loopMode === 'all') {
            prevIndex = playQueue.length - 1;
        }

        if (prevIndex >= 0) {
            void playSong(playQueue[prevIndex], playQueue, isFmMode);
        }
    }, [currentSong, isFmMode, isNowPlayingStageActive, loopMode, playQueue, playSong]);

    const skipAfterPlaybackFailure = useCallback(() => {
        clearPendingUnavailableSkip();
        const skipCount = playbackAutoSkipCountRef.current;
        const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        const currentIndex = currentSongKey
            ? playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey)
            : -1;
        const hasNextTrack = currentIndex >= 0 && (
            currentIndex < playQueue.length - 1 ||
            (loopMode === 'all' && playQueue.length > 1)
        );

        if (!hasNextTrack || skipCount >= MAX_UNAVAILABLE_AUTO_SKIP_COUNT) {
            setPlayerState(PlayerState.IDLE);
            return;
        }

        const nextSkipCount = skipCount + 1;
        showTimedSkipPrompt('status.playbackErrorPrompt', () => {
            playbackAutoSkipCountRef.current = nextSkipCount;
            void handleNextTrack({
                allowStopOnMissing: true,
                shouldNavigateToPlayer: false,
                unavailableSkipCount: nextSkipCount,
            });
        });
    }, [clearPendingUnavailableSkip, currentSong, handleNextTrack, loopMode, playQueue, playbackAutoSkipCountRef, setPlayerState, showTimedSkipPrompt]);

    const buildStageQueueOperationSnapshot = useCallback((
        nextCurrentSong: SongResult | null,
        nextQueue: SongResult[],
    ): StagePlayerSnapshot => {
        const nextCurrentSongKey = nextCurrentSong ? getPlaybackSongKey(nextCurrentSong) : null;
        const queueCurrentIndex = nextCurrentSongKey
            ? nextQueue.findIndex(song => getPlaybackSongKey(song) === nextCurrentSongKey)
            : -1;
        const hasQueueNeighbors = nextQueue.length > 1;
        const hasCurrentSong = Boolean(nextCurrentSong);
        const audioElement = audioRef.current;
        const audioCurrentTimeSec = Number.isFinite(audioElement?.currentTime) ? audioElement?.currentTime ?? 0 : currentTime.get();
        const audioDurationSec = Number.isFinite(audioElement?.duration) && (audioElement?.duration ?? 0) > 0
            ? audioElement?.duration ?? 0
            : 0;
        const fallbackDurationMs = getStageSnapshotSongDurationMs(nextCurrentSong, audioDurationSec);

        return buildStagePlayerSnapshot({
            activePlaybackContext,
            isExternalPlaybackSourceActive: isNowPlayingStageActive,
            currentSong: nextCurrentSong,
            playQueue: nextQueue,
            playerState,
            positionMs: Math.max(0, Math.floor(audioCurrentTimeSec * 1000)),
            durationMs: fallbackDurationMs,
            canGoPrevious: hasCurrentSong && (queueCurrentIndex > 0 || (loopMode === 'all' && hasQueueNeighbors)),
            canGoNext: hasCurrentSong && (
                isFmMode
                || queueCurrentIndex >= 0 && queueCurrentIndex < nextQueue.length - 1
                || (loopMode === 'all' && hasQueueNeighbors)
            ),
            coverUrl: getProviderSongMetadata(nextCurrentSong).coverUrl || null,
        });
    }, [activePlaybackContext, audioRef, currentTime, isFmMode, isNowPlayingStageActive, loopMode, playerState]);

    const buildReloadQueueDiffDraft = useCallback((): StagePlayerQueueDiffDraft => ({
        ops: [],
        requiresReload: true,
    }), []);

    const buildStageQueueAddDiffDraft = useCallback((
        action: 'append' | 'insert-next',
        baseQueue: SongResult[],
        nextQueue: SongResult[],
        affectedSongs: SongResult[],
        snapshot: StagePlayerSnapshot,
    ): StagePlayerQueueDiffDraft => {
        const workingQueue = [...baseQueue];
        const ops: StagePlayerQueueDiffOp[] = [];
        const orderedAffectedSongs = action === 'append' ? [...affectedSongs].reverse() : affectedSongs;

        for (const song of orderedAffectedSongs) {
            const songKey = getPlaybackSongKey(song);
            const targetIndex = nextQueue.findIndex(candidate => getPlaybackSongKey(candidate) === songKey);
            if (targetIndex < 0 || targetIndex > workingQueue.length) {
                return buildReloadQueueDiffDraft();
            }

            const currentIndex = workingQueue.findIndex(candidate => getPlaybackSongKey(candidate) === songKey);
            if (currentIndex < 0) {
                const item = snapshot.queue.items[targetIndex];
                if (!item) {
                    return buildReloadQueueDiffDraft();
                }
                ops.push({ op: 'insert', index: targetIndex, item });
                workingQueue.splice(targetIndex, 0, song);
                continue;
            }

            if (currentIndex !== targetIndex) {
                const [movedSong] = workingQueue.splice(currentIndex, 1);
                workingQueue.splice(targetIndex, 0, movedSong);
                ops.push({ op: 'move', from: currentIndex, to: targetIndex });
            }
        }

        const matchesNextQueue = workingQueue.length === nextQueue.length
            && workingQueue.every((song, index) => (
                Boolean(nextQueue[index])
                && getPlaybackSongKey(song) === getPlaybackSongKey(nextQueue[index])
            ));
        return matchesNextQueue ? { ops } : buildReloadQueueDiffDraft();
    }, [buildReloadQueueDiffDraft]);

    const handleStageExternalPlayRequest = useCallback(async (request: { requestId: string; songId: number; appendToQueue?: boolean; }) => {
        try {
            const song = await omni.getSongDetail('netease', request.songId);
            if (!song) {
                throw new Error(`Song ${request.songId} was not found.`);
            }

            let actionData: any = undefined;
            let baseSnapshot: StagePlayerSnapshot | undefined;
            let snapshot: StagePlayerSnapshot | undefined;
            if (request.appendToQueue) {
                actionData = appendOnlineSongsToMainQueue([song], { suppressToast: true });
                baseSnapshot = buildStageQueueOperationSnapshot(actionData.currentSong ?? currentSong, actionData.baseQueue ?? playQueue);
                snapshot = buildStageQueueOperationSnapshot(actionData.currentSong ?? currentSong, actionData.queue ?? playQueue);
                actionData = {
                    ...actionData,
                    diff: buildStageQueueAddDiffDraft(
                        actionData.addBehavior === 'next' ? 'insert-next' : 'append',
                        actionData.baseQueue ?? [],
                        actionData.queue ?? [],
                        actionData.affectedSongs ?? [],
                        snapshot,
                    ),
                };
            } else {
                await playSong(song, [song], false, { shouldNavigateToPlayer: true });
            }
            await window.electron?.completeStageExternalPlayRequest?.({
                requestId: request.requestId,
                ok: true,
                result: actionData,
                baseSnapshot,
                snapshot,
            });
        } catch (error) {
            console.warn('[Stage] Failed to handle external play request', error);
            await window.electron?.completeStageExternalPlayRequest?.({
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }, [appendOnlineSongsToMainQueue, buildStageQueueAddDiffDraft, buildStageQueueOperationSnapshot, currentSong, playQueue, playSong]);

    const resolveStageQueueIndex = useCallback((queue: SongResult[], request: StagePlayerQueueRequest): number => {
        const requestedIndex = typeof request.index === 'number' && Number.isInteger(request.index)
            ? request.index
            : request.fromIndex;
        if (typeof requestedIndex === 'number' && Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < queue.length) {
            return requestedIndex;
        }

        return resolveStagePlayerQueueItemIndex(queue, request.queueItemId || request.fromQueueItemId);
    }, []);

    const loadStageQueueSongs = useCallback(async (request: StagePlayerQueueRequest) => {
        const singleSongId = typeof request.songId === 'number' && Number.isInteger(request.songId) && request.songId > 0
            ? request.songId
            : null;
        const songIds = Array.isArray(request.songIds) && request.songIds.length > 0
            ? request.songIds
            : singleSongId !== null
                ? [singleSongId]
                : [];

        if (songIds.length === 0) {
            throw new Error('Queue append requires songId or songIds.');
        }

        const songs: SongResult[] = [];
        for (const songId of songIds) {
            const song = await omni.getSongDetail('netease', songId);
            if (song && !isSongUnavailable(song)) {
                songs.push(song);
            }
        }

        if (songs.length === 0) {
            throw new Error('No queueable songs were found.');
        }

        return songs;
    }, []);

    const handleStagePlayerQueueRequest = useCallback(async (request: StagePlayerQueueRequest) => {
        const complete = async (ok: boolean, error?: unknown, result?: any, snapshot?: StagePlayerSnapshot) => {
            await window.electron?.completeStagePlayerQueueRequest?.({
                requestId: request.requestId,
                ok,
                error: ok ? null : error instanceof Error ? error.message : String(error),
                result,
                snapshot,
            });
        };

        try {
            if (activePlaybackContext !== 'main' || isNowPlayingStageActive) {
                throw new Error('Queue editing is not supported in the current playback context.');
            }

            const baseQueue = playQueue.length > 0 ? [...playQueue] : (currentSong ? [currentSong] : []);
            let nextQueue = baseQueue;

            let actionData: any = undefined;
            let diffDraft: StagePlayerQueueDiffDraft | undefined;

            if (request.action === 'append' || request.action === 'insert-next') {
                const songs = await loadStageQueueSongs(request);
                const { nextQueue: newQueue, affectedSongs, changed } = applyQueueAddBehavior({
                    queue: baseQueue,
                    songs,
                    currentSong,
                    behavior: request.action === 'append' ? 'append' : 'next',
                });
                nextQueue = newQueue;
                actionData = {
                    changed,
                    affectedCount: affectedSongs.length,
                    deduplicated: nextQueue.length - baseQueue.length < songs.length,
                };
                const nextSnapshot = buildStageQueueOperationSnapshot(currentSong, nextQueue);
                diffDraft = buildStageQueueAddDiffDraft(request.action, baseQueue, nextQueue, affectedSongs, nextSnapshot);
            } else if (request.action === 'remove') {
                const removeIndex = resolveStageQueueIndex(baseQueue, request);
                if (removeIndex < 0) {
                    throw new Error('Queue item was not found.');
                }
                if (
                    currentSong
                    && baseQueue[removeIndex]
                    && getPlaybackSongKey(baseQueue[removeIndex]) === getPlaybackSongKey(currentSong)
                ) {
                    throw new Error('Removing the current track is not supported.');
                }
                nextQueue = baseQueue.filter((_, index) => index !== removeIndex);
                diffDraft = { ops: [{ op: 'remove', index: removeIndex }] };
            } else if (request.action === 'move') {
                const fromIndex = resolveStageQueueIndex(baseQueue, request);
                const toIndex = typeof request.toIndex === 'number' && Number.isInteger(request.toIndex)
                    ? request.toIndex
                    : -1;
                if (fromIndex < 0 || toIndex < 0 || toIndex >= baseQueue.length) {
                    throw new Error('Queue move requires valid from and to indexes.');
                }
                nextQueue = [...baseQueue];
                const [movedSong] = nextQueue.splice(fromIndex, 1);
                if (!movedSong) {
                    throw new Error('Queue item was not found.');
                }
                nextQueue.splice(toIndex, 0, movedSong);
                diffDraft = fromIndex === toIndex ? { ops: [] } : { ops: [{ op: 'move', from: fromIndex, to: toIndex }] };
            } else if (request.action === 'select') {
                const selectIndex = resolveStageQueueIndex(baseQueue, request);
                if (selectIndex < 0) {
                    throw new Error('Queue select requires a valid queueItemId or index.');
                }
                const selectedSong = baseQueue[selectIndex];
                if (!selectedSong) {
                    throw new Error('Queue item was not found.');
                }
                await playSong(selectedSong, baseQueue, isFmMode, { shouldNavigateToPlayer: true });
                await complete(
                    true,
                    null,
                    { diff: { ops: [{ op: 'select', index: selectIndex }] } },
                    buildStageQueueOperationSnapshot(selectedSong, baseQueue),
                );
                return;
            } else if (request.action === 'clear') {
                nextQueue = currentSong ? [currentSong] : [];
                diffDraft = currentSong ? buildReloadQueueDiffDraft() : { ops: [{ op: 'clear' }] };
            } else {
                throw new Error(`Unsupported queue action: ${request.action}`);
            }

            setPlayQueue(nextQueue);
            void persistLastPlaybackCache(currentSong, nextQueue);
            await complete(
                true,
                null,
                {
                    ...actionData,
                    ...(diffDraft ? { diff: diffDraft } : {}),
                },
                buildStageQueueOperationSnapshot(currentSong, nextQueue),
            );
        } catch (error) {
            console.warn('[Stage] Failed to handle player queue request', error);
            await complete(false, error);
        }
    }, [activePlaybackContext, buildStageQueueOperationSnapshot, currentSong, isFmMode, isNowPlayingStageActive, loadStageQueueSongs, persistLastPlaybackCache, playQueue, playSong, resolveStageQueueIndex, setPlayQueue, setStatusMsg, t]);

    useEffect(() => {
        if (!window.electron?.onStagePlayerQueueRequest) {
            return;
        }

        return window.electron.onStagePlayerQueueRequest((request) => {
            void handleStagePlayerQueueRequest(request);
        });
    }, [handleStagePlayerQueueRequest]);

    const shuffleQueue = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!playQueue || playQueue.length <= 1) return;

        const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        let songsToShuffle: SongResult[] = [];
        let firstSong: SongResult | null = null;

        if (currentSongKey) {
            firstSong = playQueue.find(song => getPlaybackSongKey(song) === currentSongKey) || null;
            songsToShuffle = playQueue.filter(song => getPlaybackSongKey(song) !== currentSongKey);
        } else {
            songsToShuffle = [...playQueue];
        }

        for (let index = songsToShuffle.length - 1; index > 0; index -= 1) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            [songsToShuffle[index], songsToShuffle[randomIndex]] = [songsToShuffle[randomIndex], songsToShuffle[index]];
        }

        const nextQueue = firstSong ? [firstSong, ...songsToShuffle] : songsToShuffle;

        setPlayQueue(nextQueue);
        setStatusMsg({ type: 'success', text: t('status.queueShuffled') || 'Queue Shuffled' });

        if (currentSong && nextQueue.length > 1) {
            invalidateAndRefetch(currentSong, nextQueue, audioQuality, userId);
        }
    }, [audioQuality, currentSong, isNowPlayingStageActive, playQueue, setPlayQueue, setStatusMsg, t, userId]);

    return {
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        clearPendingUnavailableSkip,
        addOnlineSongToQueue,
        addOnlineSongsToQueue,
        playSong,
        playOnlineQueueFromStart,
        handleQueueAddAndPlay,
        handleSearchOverlaySubmit,
        handleSearchLoadMore,
        handleSearchResultPlay,
        handleSearchResultAddToQueue,
        handleUnavailableReplacementConfirm,
        handleNextTrack,
        handlePrevTrack,
        skipAfterPlaybackFailure,
        handleStageExternalPlayRequest,
        shuffleQueue,
    };
}
