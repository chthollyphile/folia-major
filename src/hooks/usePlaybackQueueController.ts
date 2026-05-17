import { useCallback, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { getCachedCoverUrl } from '../services/coverCache';
import { hasCachedAudio } from '../services/audioCache';
import { loadOnlineSongAudioSource, loadOnlineSongLyrics } from '../services/onlinePlayback';
import { getOnlineSongCacheKey, isSongMarkedUnavailable, neteaseApi } from '../services/netease';
import { getPrefetchedData, invalidateAndRefetch, prefetchNearbySongs } from '../services/prefetchService';
import { PlayerState } from '../types';
import type { LocalSong, SongResult, StatusMessage, UnifiedSong } from '../types';
import type { NextTrackOptions, PlaybackNavigationOptions, SkipPromptMessageKey, UnavailableReplacementRequest } from '../types/appPlayback';
import type { NavidromeSong } from '../types/navidrome';
import { isLocalPlaybackSong, isNavidromePlaybackSong, resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';

// src/hooks/usePlaybackQueueController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type SearchDeps = {
    submitSearch: (args: {
        query: string;
        sourceTab: string;
        deps: {
            localSongs: LocalSong[];
            t: (key: string, fallback?: string) => string;
        };
    }) => Promise<boolean>;
    loadMoreSearchResults: (args: {
        deps: {
            localSongs: LocalSong[];
            t: (key: string, fallback?: string) => string;
        };
    }) => Promise<void>;
};

type UsePlaybackQueueControllerParams = {
    t: (key: string, options?: any) => string;
    audioQuality: string;
    activePlaybackContext: 'main' | 'stage';
    currentSong: SongResult | null;
    playQueue: SongResult[];
    playerState: PlayerState;
    loopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isNowPlayingStageActive: boolean;
    searchQuery: string;
    searchSourceTab: string;
    localSongs: LocalSong[];
    userId?: number;
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
    setPanelTab: SetState<'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi'>;
    setIsPanelOpen: SetState<boolean>;
    navigateToPlayer: () => void;
    navigateToSearch: (args: { query: string; sourceTab: string; replace?: boolean }) => void;
    hideSearchOverlay: () => void;
    setHomeViewTab: (tab: string) => void;
    setPendingNavidromeSelection: (selection: { type: 'artist'; artistId: string } | { type: 'album'; albumId: string }) => void;
    handleArtistSelect: (artistId: number) => void;
    handleAlbumSelect: (albumId: number) => void;
    openLocalArtistByName: (artistName: string) => void;
    openLocalAlbumByName: (albumName: string) => void;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    restoreCachedThemeForSong: (songId: number, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    interruptStagePlaybackForMainTransition: () => unknown;
    onPlayLocalSong: (localSong: LocalSong, queue?: LocalSong[]) => Promise<void>;
    onPlayNavidromeSong: (
        navidromeSong: NavidromeSong,
        queue?: NavidromeSong[],
        options?: PlaybackNavigationOptions,
    ) => Promise<void>;
    searchDeps: SearchDeps;
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    currentSongRef: MutableRefObject<number | null>;
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
    searchQuery,
    searchSourceTab,
    localSongs,
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
    hideSearchOverlay,
    setHomeViewTab,
    setPendingNavidromeSelection,
    handleArtistSelect,
    handleAlbumSelect,
    openLocalArtistByName,
    openLocalAlbumByName,
    persistLastPlaybackCache,
    restoreCachedThemeForSong,
    interruptStagePlaybackForMainTransition,
    onPlayLocalSong,
    onPlayNavidromeSong,
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

    const appendNeteaseSongsToMainQueue = useCallback((songs: SongResult[]) => {
        if (songs.length === 0) {
            return false;
        }

        const mainSnapshot = activePlaybackContext === 'stage' ? mainPlaybackSnapshotRef.current : null;
        const queueAnchorSong = mainSnapshot?.currentSong ?? (activePlaybackContext === 'main' ? currentSong : null);
        const existingQueue = mainSnapshot?.playQueue ?? (activePlaybackContext === 'main' ? playQueue : []);
        const baseQueue = existingQueue.length > 0 ? existingQueue : (queueAnchorSong ? [queueAnchorSong] : []);
        const existingIds = new Set(baseQueue.map(song => song.id));
        const appendedSongs = songs.filter(song => !isSongMarkedUnavailable(song) && !existingIds.has(song.id));
        const nextQueue = appendedSongs.length > 0 ? [...baseQueue, ...appendedSongs] : baseQueue;

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

        if (appendedSongs.length > 0) {
            void persistLastPlaybackCache(queueAnchorSong, nextQueue);
            setStatusMsg({ type: 'success', text: t('status.queueUpdated') || '已添加到播放队列' });
            return true;
        }

        return false;
    }, [activePlaybackContext, currentSong, mainPlaybackSnapshotRef, persistLastPlaybackCache, playQueue, setPlayQueue, setStatusMsg, t]);

    const addNeteaseSongToQueue = useCallback((song: SongResult) => {
        if (isSongMarkedUnavailable(song)) {
            return;
        }

        appendNeteaseSongsToMainQueue([song]);
    }, [appendNeteaseSongsToMainQueue]);

    const addNeteaseSongsToQueue = useCallback((songs: SongResult[]) => {
        appendNeteaseSongsToMainQueue(songs);
    }, [appendNeteaseSongsToMainQueue]);

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

    const getPlayableOnlineQueue = useCallback((queue: SongResult[]) => {
        return queue.filter(queuedSong => {
            if (isLocalPlaybackSong(queuedSong) || isNavidromePlaybackSong(queuedSong)) {
                return true;
            }
            return !isSongMarkedUnavailable(queuedSong);
        });
    }, []);

    const getNextPlayableQueueSong = useCallback((queue: SongResult[], songId: number) => {
        const currentIndex = queue.findIndex(queuedSong => queuedSong.id === songId);
        if (currentIndex === -1) {
            return null;
        }

        for (let index = currentIndex + 1; index < queue.length; index += 1) {
            const candidate = queue[index];
            if (isLocalPlaybackSong(candidate) || isNavidromePlaybackSong(candidate) || !isSongMarkedUnavailable(candidate)) {
                return candidate;
            }
        }

        if (loopMode === 'all' && queue.length > 1) {
            for (let index = 0; index < currentIndex; index += 1) {
                const candidate = queue[index];
                if (isLocalPlaybackSong(candidate) || isNavidromePlaybackSong(candidate) || !isSongMarkedUnavailable(candidate)) {
                    return candidate;
                }
            }
        }

        return null;
    }, [loopMode]);

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

            if (queuedSong.id === originalSong.id) {
                return [replacementSong];
            }

            if (isSongMarkedUnavailable(queuedSong)) {
                return [];
            }

            return [queuedSong];
        });

        if (replacedQueue.length === 0) {
            return [replacementSong];
        }

        if (!replacedQueue.some(queuedSong => queuedSong.id === replacementSong.id)) {
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
            const replacement = await neteaseApi.getUnavailableSongReplacement(song);

            if (!replacement || !replacement.replacementSong || isSongMarkedUnavailable(replacement.replacementSong)) {
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                return true;
            }

            setStatusMsg(null);
            setPendingUnavailableReplacement({
                originalSong: song,
                replacementSong: replacement.replacementSong,
                replacementSongId: replacement.replacementSongId,
                typeDesc: replacement.typeDesc,
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

        if (!isLocal && !isNavidrome && isSongMarkedUnavailable(song)) {
            if (await handleMarkedUnavailableSong(song, queueContext, isFmCall, options)) {
                return;
            }
        }

        if (isLocal) {
            let localData = song.localData ?? null;

            if (!localData) {
                localData = localSongs.find(ls =>
                    (ls.title || ls.fileName) === song.name &&
                    Math.abs(ls.duration - song.duration) < 1000
                ) ?? null;
            }

            if (!localData) {
                setStatusMsg({ type: 'error', text: '无法播放本地文件 (文件可能已移动或权限丢失)' });
                return;
            }

            const localQueue = queueContext
                .map(queuedSong => queuedSong.localData)
                .filter((queuedSong): queuedSong is LocalSong => Boolean(queuedSong));
            await onPlayLocalSong(localData, localQueue);
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
            await onPlayNavidromeSong(navidromeSong, navidromeQueue, { shouldNavigateToPlayer });
            return;
        }

        prefetched = getPrefetchedData(song, audioQuality);

        const hasImmediatePrefetchedAudio = Boolean(
            prefetched?.audioUrl &&
            prefetched.audioUrl !== 'CACHED_IN_DB'
        );
        const hasCachedAudioBlob = hasImmediatePrefetchedAudio
            ? null
            : await hasCachedAudio(getOnlineSongCacheKey('audio', song));

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
                const nextSong = getNextPlayableQueueSong(queueContext, song.id);
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
        currentSongRef.current = song.id;
        pendingResumeTimeRef.current = null;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;

        setLyrics(null);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setDuration(0);
        setCurrentSong(song);
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

        void persistLastPlaybackCache(song, newQueue);

        if (shouldNavigateToPlayer) {
            navigateToPlayer();
        }
        setPlayerState(PlayerState.IDLE);

        const cachedCoverUrl = await getCachedCoverUrl(getOnlineSongCacheKey('cover', song));
        if (currentSongRef.current !== song.id) return;
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
                isCurrent: () => currentSongRef.current === song.id,
                onLyrics: resolvedLyrics => setLyrics(resolvedLyrics),
                onPureMusicChange: isPureMusic => {
                    setCurrentSong(prev => prev?.id === song.id ? { ...prev, isPureMusic } : prev);
                },
                onDone: () => setIsLyricsLoading(false),
            });
        } catch (error) {
            console.warn('[App] Lyric fetch failed', error);
            setLyrics(null);
            setIsLyricsLoading(false);
        }

        try {
            await restoreCachedThemeForSong(song.id);
            if (currentSongRef.current !== song.id) return;
        } catch (error) {
            console.warn('Theme load error', error);
        }

        if (newQueue.length > 1) {
            prefetchNearbySongs(song.id, newQueue, audioQuality, userId);
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
        const playableSongs = getPlayableOnlineQueue(songs);
        if (playableSongs.length === 0) {
            setStatusMsg({ type: 'error', text: t('status.noPlayableSongs') });
            return;
        }

        void playSong(playableSongs[0], playableSongs, false);
    }, [getPlayableOnlineQueue, playSong, setStatusMsg, t]);

    const handleQueueAddAndPlay = useCallback((song: SongResult) => {
        const existingIndex = playQueue.findIndex(candidate => candidate.id === song.id);
        const nextQueue = [...playQueue];

        if (existingIndex === -1) {
            nextQueue.push(song);
        }

        void playSong(song, nextQueue, false);
    }, [playQueue, playSong]);

    const handleSearchOverlaySubmit = useCallback(async () => {
        const trimmedQuery = searchQuery.trim();
        if (!trimmedQuery) {
            return;
        }

        const didSearch = await searchDeps.submitSearch({
            query: trimmedQuery,
            sourceTab: searchSourceTab,
            deps: {
                localSongs,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });

        if (didSearch) {
            navigateToSearch({
                query: trimmedQuery,
                sourceTab: searchSourceTab,
                replace: Boolean(window.history.state?.search),
            });
        }
    }, [localSongs, navigateToSearch, searchDeps, searchQuery, searchSourceTab, t]);

    const handleSearchLoadMore = useCallback(async () => {
        await searchDeps.loadMoreSearchResults({
            deps: {
                localSongs,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });
    }, [localSongs, searchDeps, t]);

    const handleSearchResultPlay = useCallback((track: UnifiedSong) => {
        if (track.isLocal && track.localData) {
            void onPlayLocalSong(track.localData);
            return;
        }

        if (track.isNavidrome && track.navidromeData) {
            void onPlayNavidromeSong(track as NavidromeSong);
            return;
        }

        handleQueueAddAndPlay(track);
    }, [handleQueueAddAndPlay, onPlayLocalSong, onPlayNavidromeSong]);

    const handleUnavailableReplacementConfirm = useCallback(async () => {
        if (!pendingUnavailableReplacement) {
            return;
        }

        const { originalSong, replacementSong, replacementSongId, queue, isFmCall, options } = pendingUnavailableReplacement;
        setPendingUnavailableReplacement(null);

        try {
            if (!replacementSong || replacementSong.id !== replacementSongId || isSongMarkedUnavailable(replacementSong)) {
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

    const handleSearchResultArtistSelect = useCallback((track: UnifiedSong, artistName: string, artistId?: number) => {
        if (track.isLocal) {
            hideSearchOverlay();
            openLocalArtistByName(artistName);
            return;
        }

        if (track.isNavidrome && track.navidromeData?.artistId) {
            hideSearchOverlay();
            setHomeViewTab('navidrome');
            setPendingNavidromeSelection({ type: 'artist', artistId: track.navidromeData.artistId });
            return;
        }

        if (artistId) {
            handleArtistSelect(artistId);
        }
    }, [handleArtistSelect, hideSearchOverlay, openLocalArtistByName, setHomeViewTab, setPendingNavidromeSelection]);

    const handleSearchResultAlbumSelect = useCallback((track: UnifiedSong, albumName: string, albumId?: number) => {
        if (track.isLocal) {
            hideSearchOverlay();
            openLocalAlbumByName(albumName);
            return;
        }

        if (track.isNavidrome && track.navidromeData?.albumId) {
            hideSearchOverlay();
            setHomeViewTab('navidrome');
            setPendingNavidromeSelection({ type: 'album', albumId: track.navidromeData.albumId });
            return;
        }

        if (albumId) {
            handleAlbumSelect(albumId);
        }
    }, [handleAlbumSelect, hideSearchOverlay, openLocalAlbumByName, setHomeViewTab, setPendingNavidromeSelection]);

    const handleNextTrack = useCallback(async (options?: NextTrackOptions) => {
        if (isNowPlayingStageActive) return;
        if (!currentSong || playQueue.length === 0) return;

        const shouldNavigateToPlayer = options?.shouldNavigateToPlayer ?? true;
        const currentIndex = playQueue.findIndex(song => song.id === currentSong.id);

        if (isFmMode && currentIndex >= playQueue.length - 2) {
            try {
                const fmRes = await neteaseApi.getPersonalFm();
                if (fmRes.data && fmRes.data.length > 0) {
                    const nextQueue = [...playQueue, ...fmRes.data];
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

        const currentIndex = playQueue.findIndex(song => song.id === currentSong.id);
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
        const currentIndex = currentSong ? playQueue.findIndex(song => song.id === currentSong.id) : -1;
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

    const handleStageExternalPlayRequest = useCallback(async (request: { requestId: string; songId: number; appendToQueue?: boolean; }) => {
        try {
            const detail = await neteaseApi.getSongDetail(request.songId);
            const song = (detail?.songs || [])[0] as SongResult | undefined;
            if (!song) {
                throw new Error(`Song ${request.songId} was not found.`);
            }

            if (request.appendToQueue) {
                appendNeteaseSongsToMainQueue([song]);
            } else {
                await playSong(song, [song], false, { shouldNavigateToPlayer: true });
            }
            await window.electron?.completeStageExternalPlayRequest?.({
                requestId: request.requestId,
                ok: true,
            });
        } catch (error) {
            console.warn('[Stage] Failed to handle external play request', error);
            await window.electron?.completeStageExternalPlayRequest?.({
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }, [appendNeteaseSongsToMainQueue, playSong]);

    const shuffleQueue = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!playQueue || playQueue.length <= 1) return;

        const currentId = currentSong?.id;
        let songsToShuffle: SongResult[] = [];
        let firstSong: SongResult | null = null;

        if (currentId) {
            firstSong = playQueue.find(song => song.id === currentId) || null;
            songsToShuffle = playQueue.filter(song => song.id !== currentId);
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

        if (currentId && nextQueue.length > 1) {
            invalidateAndRefetch(currentId, nextQueue, audioQuality, userId);
        }
    }, [audioQuality, currentSong, isNowPlayingStageActive, playQueue, setPlayQueue, setStatusMsg, t, userId]);

    return {
        pendingUnavailableReplacement,
        setPendingUnavailableReplacement,
        clearPendingUnavailableSkip,
        addNeteaseSongToQueue,
        addNeteaseSongsToQueue,
        playSong,
        playOnlineQueueFromStart,
        handleQueueAddAndPlay,
        handleSearchOverlaySubmit,
        handleSearchLoadMore,
        handleSearchResultPlay,
        handleUnavailableReplacementConfirm,
        handleSearchResultArtistSelect,
        handleSearchResultAlbumSelect,
        handleNextTrack,
        handlePrevTrack,
        skipAfterPlaybackFailure,
        handleStageExternalPlayRequest,
        shuffleQueue,
    };
}
