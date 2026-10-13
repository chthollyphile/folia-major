import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { applyOnlineAudioSourceMetadata, loadOnlineSongAudioSource, loadOnlineSongLyrics } from '../services/onlinePlayback';
import { getSongReplacement, isSongUnavailable } from '../services/onlineMusic/songAvailability';
import { getSongResourceCacheKey } from '../services/onlineMusic/resourceKeys';
import { omni } from '../services/onlineMusic/omni';
import { getCachedSongCoverUrl, hasCachedSongAudio } from '../services/onlineMusic/resourceCache';
import { getPrefetchedData, invalidateAndRefetch, prefetchNearbySongs, refreshPrefetchAfterQueueEdit } from '../services/prefetchService';
import { getLocalSong } from '../services/db';
import { retireBlobUrl } from '../services/playbackBlobUrls';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { loadOnlineLyricsState } from '../utils/onlineLyricsState';
import { PlayerState, type StagePlayerQueueDiffOp, type StagePlayerQueueRequest, type StagePlayerSnapshot } from '../types';
import type { LocalSong, QueueAddBehavior, SongResult, StatusMessage, UnifiedSong } from '../types';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import type { NextTrackOptions, PlaybackNavigationOptions, SkipPromptMessageKey, UnavailableReplacementRequest } from '../types/appPlayback';
import type { PlaybackFailure, PlaybackFailureSkipOptions } from '../types/playbackFailure';
import type { NavidromeSong } from '../types/navidrome';
import {
    getOnlineProviderIdForSong,
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
    resolveNavidromePlaybackCarrier,
} from '../utils/appPlaybackGuards';
import { applyQueueAddBehavior } from '../utils/queueAddBehavior';
import { moveQueueItem } from '../utils/queueReorder';
import { buildStagePlayerSnapshot, resolveStagePlayerQueueItemIndex } from '../utils/stagePlayerSnapshot';
import type { LocalLibraryDisplayCatalog } from '../services/playbackAdapters';
import type { SearchReturnView, SearchSource } from '../stores/useSearchNavigationStore';
import { dispatchSearchTrackAction } from '../components/app/search/searchTrackActions';
import { playbackFade } from '../services/playbackFade';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';
import { setAudioSrc, setCachedCoverUrl, setCurrentLineIndex, setCurrentSong, setDuration, setIsFmMode, setPlayQueue, setPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { useTranslation } from 'react-i18next';
import { currentTime } from '../stores/motionSignals';
import { setIsPanelOpen, setPanelTab } from '../stores/useAppViewStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { showLatticeFmNotice, usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import { useStableActionSurface } from './useStableCallbacks';
import { hasBeforePlayHook, runBeforePlayHook } from '../services/hostExtensionHooks';
import { classifyPlaybackError, isTransientPlaybackFailure } from '../services/playbackRecovery/onlinePlaybackFailure';
import { PLAYBACK_RETRYING_MESSAGE_KEY } from '../services/playbackRecovery/playbackFailurePolicy';
import { presentPlaybackFailure, type PlaybackFailurePresenterDeps } from '../components/app/playback/presentPlaybackFailure';

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

    isNowPlayingStageActive: boolean;
    shouldNavigateToPlayerOnTrackChange: boolean;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryDisplayCatalog;
    userId?: MediaId;
    setLyrics: (nextLyrics: any) => void;
    setIsLyricsLoading: SetState<boolean>;
    navigateToPlaybackView: () => void;
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
    /** Bumped on every commit of the current song, a replay of the same song included (see usePlaybackRuntimeRefs). */
    playbackGenerationRef: MutableRefObject<number>;
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
    playbackAutoSkipCountRef: MutableRefObject<number>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
    /**
     * The track the LISTENER is on, or null when that is just `currentSong`.
     *
     * Non-null only while an automix blend holds the now-playing picture, where the queue has
     * already advanced to the arriving track seconds before anyone hears it. Queue navigation has
     * to step from what is on screen, or it is off by a song in both directions.
     */
    getDisplaySong?: () => SongResult | null;
    /** Ends a blend that a manual skip has overtaken. Called before navigating away from it. */
    endHeldTransition?: () => void;
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
    isNowPlayingStageActive,
    shouldNavigateToPlayerOnTrackChange,
    localSongs,
    localLibraryCatalog,
    userId,
    setLyrics,
    setIsLyricsLoading,
    navigateToPlaybackView,
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
    playbackGenerationRef,
    mainPlaybackSnapshotRef,
    playbackAutoSkipCountRef,
    pendingResumeTimeRef,
    currentOnlineAudioUrlFetchedAtRef,
    lastAudioRecoverySourceRef,
    getDisplaySong,
    endHeldTransition,
}: UsePlaybackQueueControllerParams) {
    // Owned here, not passed in: nothing outside this hook reads or writes them. They were declared
    // in App.tsx only because everything about playback used to be.
    /** Rising id that lets a newer load invalidate an in-flight older one. */
    const playbackRequestIdRef = useRef(0);
    /** Rising id per playSong call: a newer call supersedes an older one still awaiting `beforePlay`. */
    const playSongCallIdRef = useRef(0);
    /** FM state from before the oldest play request that has not landed yet; a failed latest request puts it back. */
    const fmModeBeforePendingPlayRef = useRef<boolean | null>(null);
    const pendingUnavailableSkipTimerRef = useRef<number | null>(null);
    const pendingUnavailableSkipIntervalRef = useRef<number | null>(null);

    // Stage 接管同一个 audio 元素：还没落地的主播放请求就此作废（loader 不再重试，迟到的结果按陈旧丢弃）。否则迟到的失败
    // 会暂停 Stage 的音频并在 Stage 上弹出重试 / 跳过，迟到的成功会落进 Stage 上下文、离开 Stage 时又被旧主快照盖掉。
    // 进入 Stage 的入口（openStagePlayer 各分支、restoreStagePlaybackHandoff）都在碰 audio 之前同步切换 context，订阅 store
    // 能一并覆盖；作废靠递增请求 id，离开 Stage 后旧请求也不会重新变成「最新」。
    useEffect(() => usePlaybackStore.subscribe((state, previous) => {
        if (state.activePlaybackContext !== 'stage' || previous.activePlaybackContext === 'stage') return;
        playbackRequestIdRef.current += 1;
        // 被作废的请求不会再跑 restoreFmModeIfNotLanded：openStagePlayer 刚存的主快照可能带着它写进去的 FM 状态，改回请求之前的值。
        const fmModeBeforeRequest = fmModeBeforePendingPlayRef.current;
        fmModeBeforePendingPlayRef.current = null;
        const mainSnapshot = mainPlaybackSnapshotRef.current;
        if (fmModeBeforeRequest !== null && mainSnapshot && mainSnapshot.isFmMode !== fmModeBeforeRequest) {
            mainPlaybackSnapshotRef.current = { ...mainSnapshot, isFmMode: fmModeBeforeRequest };
        }
    }), [mainPlaybackSnapshotRef]);

    // Read here rather than passed in: every one of these lives in a store, a module-level setter or
    // i18n, and App.tsx was naming 15 of them purely to hand them straight back.
    const { t } = useTranslation();
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const queueAddBehavior = useAudioSettingsStore(state => state.queueAddBehavior);
    const loopMode = useAudioSettingsStore(state => state.loopMode);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const playerState = usePlaybackStore(state => state.playerState);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const searchQuery = useSearchNavigationStore(state => state.searchQuery);
    const searchSourceTab = useSearchNavigationStore(state => state.searchSourceTab);
    const searchReturnView = useSearchNavigationStore(state => state.searchReturnView);

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

    // Batch variant; returns how many songs the queue actually took so callers that want their own toast can count.
    const addOnlineSongsToQueue = useCallback((songs: SongResult[], options?: { suppressToast?: boolean }) => {
        return appendOnlineSongsToMainQueue(songs, options).affectedCount;
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

        let lastBuilt = buildMessage(remainingSeconds);
        setStatusMsg(lastBuilt);
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

            // 只更新本次倒计时自己发出的那条消息；期间出现的其他常驻消息不覆盖。
            setStatusMsg(current => {
                if (current !== lastBuilt) {
                    return current;
                }
                lastBuilt = buildMessage(remainingSeconds);
                return lastBuilt;
            });
        }, UNAVAILABLE_SKIP_CONFIRM_INTERVAL_MS);
    }, [clearPendingUnavailableSkip, pendingUnavailableSkipIntervalRef, pendingUnavailableSkipTimerRef, setStatusMsg, t]);

    const presenterDeps = useMemo<PlaybackFailurePresenterDeps>(() => ({
        t, setStatusMsg, setPlayerState, audioRef, shouldAutoPlayRef, setIsLyricsLoading, showTimedSkipPrompt,
        maxAutoSkipCount: MAX_UNAVAILABLE_AUTO_SKIP_COUNT,
    }), [audioRef, setIsLyricsLoading, shouldAutoPlayRef, showTimedSkipPrompt, t]);

    // Loads one requested song and normalizes queue behavior across sources.
    const playSong = useCallback(async (
        requestedSong: SongResult,
        queue: SongResult[] = [],
        isFmCall: boolean = false,
        options: PlaybackNavigationOptions = {}
    ) => {
        // Extension layers (Folium `playback.beforePlay`) may cancel or redirect this play.
        // Without an installed hook this is skipped entirely, so the common path stays synchronous.
        // The hook is async, so a later playSong may finish its hook first; this call then drops
        // out instead of replacing the song the user picked last.
        // An automix advance skips the hook (see `isAutomixAdvance`).
        const playSongCallId = ++playSongCallIdRef.current;
        // 没传队列，或传的就是 store 里的当前队列（下一首 / 上一首 / 队列面板 / FM 续歌）：失败按钮按点击时的最新队列走。
        // 只有还没写进 store 的显式队列（如从歌单点歌）才用快照。在 beforePlay 的 await 之前取，比较的是调用方看到的队列。
        const queueFollowsStore = queue.length === 0 || queue === usePlaybackStore.getState().playQueue;
        const allowedSong = !options.isAutomixAdvance && hasBeforePlayHook()
            ? await runBeforePlayHook(requestedSong)
            : requestedSong;
        if (!allowedSong || playSongCallIdRef.current !== playSongCallId) {
            return;
        }
        const song = allowedSong;
        // A pause still fading out belongs to the song being replaced. Run it now instead of
        // dropping it: the old song is still sounding and the new one can take seconds to load, so
        // dropping it would leave the old song at full volume under a PAUSED player. The fade node
        // is back at unity afterwards, so the new song does not start silent. The automix advance is
        // left alone: that is the blend's own handover, and a pause pressed during it is still meant.
        if (!options.isAutomixAdvance) {
            playbackFade.flush();
        }
        interruptStagePlaybackForMainTransition();

        console.log('[App] playSong initiated:', song.name, song.id, 'isFm:', isFmCall);
        // 新请求取代上一首的替代版本弹窗。
        setPendingUnavailableReplacement(null);
        clearPendingUnavailableSkip();
        setStatusMsg(prev => prev?.persistent ? null : prev);
        const shouldNavigateToPlayer = options.shouldNavigateToPlayer ?? true;
        const wasFmMode = usePlaybackStore.getState().isFmMode;
        // 前面还有没落地的请求时沿用它记下的值：那次请求写进去的 FM 状态从没对应过真正在播的歌。
        const fmModeToRestore = fmModeBeforePendingPlayRef.current ?? wasFmMode;
        fmModeBeforePendingPlayRef.current = fmModeToRestore;
        setIsFmMode(isFmCall);
        if (isFmCall && !wasFmMode) {
            setPanelTab('queue');
            setIsPanelOpen(true);
            if (usePlaybackEntryViewStore.getState().playbackEntryView === 'lattice') {
                showLatticeFmNotice();
            }
        }

        const playbackRequestId = ++playbackRequestIdRef.current;
        const isLatestPlaybackRequest = () => playbackRequestIdRef.current === playbackRequestId;
        // 点歌没有落地：FM 状态退回本次请求之前的值，否则会和仍在播的上一首、旧队列对不上，handleNextTrack 会按错的模式选歌。
        // 重试 / 跳过 / 替代版本都带着 isFmCall 重新调用 playSong，会再设一次；更新的请求已经写了自己的值，不能覆盖。
        const restoreFmModeIfNotLanded = () => {
            if (!isLatestPlaybackRequest()) return;
            fmModeBeforePendingPlayRef.current = null;
            if (usePlaybackStore.getState().isFmMode !== fmModeToRestore) setIsFmMode(fmModeToRestore);
        };
        const isLocal = isLocalPlaybackSong(song);
        const isNavidrome = isNavidromePlaybackSong(song);
        let prefetched: ReturnType<typeof getPrefetchedData> = null;
        let preloadedOnlineAudioResult: Awaited<ReturnType<typeof loadOnlineSongAudioSource>> | null = null;
        const queueContext = queue.length > 0 ? queue : playQueue.length === 0 ? [song] : playQueue;
        const newQueue = getPlayableOnlineQueue(queueContext);
        const skipCount = options.unavailableSkipCount ?? 0;
        playbackAutoSkipCountRef.current = skipCount;
        // For the plays this one defers (the replacement dialog, the timed skip): they start after a
        // prompt or a countdown, so they are not the blend's advance even when this call was.
        const deferredPlayOptions: PlaybackNavigationOptions = { ...options, isAutomixAdvance: undefined };
        const providerId = getOnlineProviderIdForSong(song) ?? undefined;

        // 按策略表展示这次点歌的失败；“跳过”只在有下一首可播歌曲时提供，只有 taken-down 才累计连跳次数。
        const presentOnlineFailure = (failure: PlaybackFailure) => {
            restoreFmModeIfNotLanded();
            const nextSong = getNextPlayableQueueSong(queueContext, song);
            // 按钮可能很久以后才被点：队列跟着 store 走时，读点击那一刻的主队列（Stage 期间主队列在 mainPlaybackSnapshotRef 里）。
            const readClickTimeQueue = (): SongResult[] | null => {
                if (!queueFollowsStore) return null;
                const live = usePlaybackStore.getState();
                const liveQueue = live.activePlaybackContext === 'stage' ? mainPlaybackSnapshotRef.current?.playQueue ?? [] : live.playQueue;
                return liveQueue.length > 0 ? liveQueue : null;
            };
            // 两个按钮都经 latestQueueActionsRef 调用最新一次渲染的 playSong，用的是点击时的音质、Stage 中断和队列。
            presentPlaybackFailure({
                failure, context: 'play', isCurrent: isLatestPlaybackRequest, skipCount,
                // 原本没传队列时仍传空队列，保持“不改写 store 队列”的语义；队列已被清空时同样交给 playSong 自己处理。
                retry: () => void latestQueueActionsRef.current.playSong(
                    song, queue.length > 0 && queueFollowsStore ? readClickTimeQueue() ?? [] : queue, isFmCall,
                    { ...deferredPlayOptions, unavailableSkipCount: 0 },
                ),
                skip: nextSong ? () => {
                    if (!isLatestPlaybackRequest()) return;
                    // 显式传入的队列还没写进 store，用快照；否则读最新队列，期间的编辑不被旧快照覆盖。
                    // 传入的就是 store 队列时同样读最新队列（见 queueFollowsStore），只有从未写进 store 的队列才用快照。
                    const targetQueue = readClickTimeQueue() ?? newQueue;
                    void latestQueueActionsRef.current.playSong(getNextPlayableQueueSong(targetQueue, song) ?? nextSong, targetQueue, isFmCall, {
                        ...deferredPlayOptions,
                        unavailableSkipCount: failure.reason === 'taken-down' ? skipCount + 1 : 0,
                    });
                } : undefined,
            }, presenterDeps);
        };

        // 下架：先查替代版本；查询本身暂时失败时只提示该失败、不倒计时，查不到才进入下架倒计时。
        const presentTakenDown = async (failure: PlaybackFailure) => {
            setIsLyricsLoading(false);
            setStatusMsg({ type: 'info', text: t('status.loadingSong') });
            let replacement: Awaited<ReturnType<typeof getSongReplacement>> = null;
            let lookupFailure: PlaybackFailure | null = null;
            try {
                replacement = await getSongReplacement(song);
            } catch (error) {
                console.error('[App] Failed to load replacement song before dialog:', error);
                lookupFailure = classifyPlaybackError(error, { stage: 'replacement', providerId });
            }
            if (!isLatestPlaybackRequest()) return;

            if (replacement?.song && !isSongUnavailable(replacement.song)) {
                restoreFmModeIfNotLanded();
                setStatusMsg(null);
                setPendingUnavailableReplacement({
                    originalSong: song,
                    replacementSong: replacement.song,
                    replacementSongId: replacement.song.id,
                    typeDesc: replacement.label,
                    queue: queueContext,
                    isFmCall,
                    options: deferredPlayOptions,
                });
                return;
            }
            presentOnlineFailure(lookupFailure && isTransientPlaybackFailure(lookupFailure) ? lookupFailure : failure);
        };

        if (!isLocal && !isNavidrome && isSongUnavailable(song)) {
            await presentTakenDown({ reason: 'taken-down', stage: 'static', providerId });
            return;
        }

        if (isLocal) {
            // 从库里按 id 取这一首的最新记录，而不是只信 localSongs 状态：邻近预热、匹配写回都先落库，
            // 状态里的对象可能还是旧快照，拿旧快照会在出声前重新提取封面、出声后重新联网匹配。读不到时退回状态里的记录。
            const localData = (await getLocalSong(song.localRef.songId))
                ?? localSongs.find(ls => ls.id === song.localRef.songId)
                ?? null;
            if (!isLatestPlaybackRequest()) return;

            if (!localData) {
                restoreFmModeIfNotLanded();
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
            fmModeBeforePendingPlayRef.current = null;
            await onPlayLocalSong(resolvedLocalData, localQueue, {
                shouldNavigateToPlayer,
                unifiedQueue: newQueue,
            });
            return;
        }

        if (isNavidrome) {
            const navidromeSong = resolveNavidromePlaybackCarrier(song);
            if (!navidromeSong) {
                restoreFmModeIfNotLanded();
                setStatusMsg({ type: 'error', text: t('status.playbackError') });
                return;
            }

            const navidromeQueue = queueContext
                .map(queuedSong => resolveNavidromePlaybackCarrier(queuedSong))
                .filter((queuedSong): queuedSong is NavidromeSong => Boolean(queuedSong));
            fmModeBeforePendingPlayRef.current = null;
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
            preloadedOnlineAudioResult = await loadOnlineSongAudioSource(song, audioQuality, prefetched, {
                retry: {
                    isCurrent: isLatestPlaybackRequest,
                    onRetrying: () => {
                        if (isLatestPlaybackRequest()) setStatusMsg({ type: 'info', text: t(PLAYBACK_RETRYING_MESSAGE_KEY) });
                    },
                },
            });
            if (!isLatestPlaybackRequest()) {
                if (preloadedOnlineAudioResult.kind === 'ok' && preloadedOnlineAudioResult.blobUrl) {
                    URL.revokeObjectURL(preloadedOnlineAudioResult.blobUrl);
                }
                return;
            }

            // 只有 taken-down 走替代版本与倒计时；其余原因按策略表停播并给出重试 / 跳过，保留队列。
            if (preloadedOnlineAudioResult.kind === 'failed') {
                if (preloadedOnlineAudioResult.failure.reason === 'taken-down') await presentTakenDown(preloadedOnlineAudioResult.failure);
                else presentOnlineFailure(preloadedOnlineAudioResult.failure);
                return;
            }
        } catch (error) {
            if (!isLatestPlaybackRequest()) return;
            console.error('[App] Failed to fetch song URL:', error);
            presentOnlineFailure(classifyPlaybackError(error, { stage: 'resolve-url', providerId }));
            return;
        }

        // 先等歌词状态，再确认仍是最新请求，之后才写各个 ref：被取代的请求不得改动当前歌曲。
        const onlineLyricsState = await loadOnlineLyricsState(song);
        const audioResult = preloadedOnlineAudioResult;
        if (!isLatestPlaybackRequest()) {
            if (audioResult.blobUrl) URL.revokeObjectURL(audioResult.blobUrl);
            return;
        }
        // 加载期间上一首的播放中失败可能已弹出常驻消息或倒计时；新歌落地后它们不再适用，与开头的清理一致。
        clearPendingUnavailableSkip();
        setStatusMsg(prev => prev?.persistent ? null : prev);

        fmModeBeforePendingPlayRef.current = null;
        shouldAutoPlayRef.current = true;
        const songKey = getPlaybackSongKey(song);
        const resolvedSong = applyOnlineAudioSourceMetadata(song, audioResult.replayGain);
        const resolvedQueue = replacePlaybackSongInQueue(newQueue, resolvedSong);
        currentSongRef.current = songKey;
        // 同一首歌重新点播也是一次新的播放：之前那次播放在途的刷新和失败据此作废（见 usePlaybackRuntimeRefs）。
        const landedGeneration = ++playbackGenerationRef.current;
        pendingResumeTimeRef.current = null;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;

        setLyrics(null);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setDuration(0);
        setCurrentSong({ ...resolvedSong, onlineLyricsState: onlineLyricsState ?? undefined });
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setIsLyricsLoading(true);

        // Handed over rather than revoked here: during a blend the song this replaces is still
        // sounding on the other deck, and taking its URL away leaves that deck unable to seek. See
        // `retireBlobUrl` - the failure is silent and permanent, with no error event to notice it by.
        retireBlobUrl(blobUrlRef.current);
        blobUrlRef.current = null;

        if (queue.length > 0 || playQueue.length === 0) {
            setPlayQueue(resolvedQueue);
        }

        void persistLastPlaybackCache({ ...resolvedSong, onlineLyricsState: onlineLyricsState ?? undefined }, resolvedQueue);

        if (shouldNavigateToPlayer) {
            navigateToPlaybackView();
        }
        setPlayerState(PlayerState.IDLE);

        const cachedCoverUrl = await getCachedSongCoverUrl(song);
        // 本次请求已经落地（当前歌曲、队列都已写入、audioSrc 已置空）：只有别的播放也落地了才放弃，
        // 并回收这个还没交给任何 deck 的 blob。更新的请求只是开始、尚未落地不算取代，仍要接上音源，
        // 否则那次请求失败时，当前歌会停在没有音源的半落地状态。
        if (currentSongRef.current !== songKey || playbackGenerationRef.current !== landedGeneration) {
            if (audioResult.blobUrl) URL.revokeObjectURL(audioResult.blobUrl);
            return;
        }
        if (cachedCoverUrl) {
            setCachedCoverUrl(cachedCoverUrl);
        } else if (prefetched?.coverUrl) {
            setCachedCoverUrl(prefetched.coverUrl);
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
            if (currentSongRef.current !== songKey || !isLatestPlaybackRequest()) return;
        } catch (error) {
            console.warn('Theme load error', error);
        }

        if (newQueue.length > 1) {
            prefetchNearbySongs(resolvedSong, resolvedQueue, audioQuality, userId);
        }
    }, [
        audioQuality,
        audioRef,
        blobUrlRef,
        clearPendingUnavailableSkip,
        currentOnlineAudioUrlFetchedAtRef,
        currentSongRef,
        currentTime,
        getNextPlayableQueueSong,
        getPlayableOnlineQueue,
        interruptStagePlaybackForMainTransition,
        isFmMode,
        lastAudioRecoverySourceRef,
        localSongs,
        mainPlaybackSnapshotRef,
        navigateToPlaybackView,
        onPlayLocalSong,
        onPlayNavidromeSong,
        pendingResumeTimeRef,
        persistLastPlaybackCache,
        playQueue,
        playbackAutoSkipCountRef,
        playbackGenerationRef,
        playbackRequestIdRef,
        presenterDeps,
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

        const stopAtQueueEnd = () => {
            if (audioRef.current) {
                audioRef.current.pause();
            }
            setPlayerState(PlayerState.IDLE);
        };

        // An emptied queue still has to stop playback at the end of the current track; returning
        // early here left the audio element `ended` while playerState stayed PLAYING.
        if (!currentSong || playQueue.length === 0) {
            if (options?.allowStopOnMissing) {
                stopAtQueueEnd();
            }
            return;
        }

        const shouldNavigateToPlayer = options?.shouldNavigateToPlayer ?? shouldNavigateToPlayerOnTrackChange;
        // Which track to step from. During a blend the queue has already advanced, so `currentSong`
        // is the one ARRIVING while the listener is still hearing - and pressing next about - the
        // one that is finishing. Stepping from the internal one is off by a song: "next" jumps over
        // the track being blended in. Non-null only while a blend holds the picture, and skipped
        // entirely for the callers that really do mean the internal track (see `fromSong`).
        const heldSong = options?.fromSong ? null : getDisplaySong?.() ?? null;
        // A skip the listener asked for overtakes the blend, and the blend has to be told. Without
        // this, "next" targets the very track being blended in - which `handleSongChanged` waves
        // through as the transition's own doing - leaving the fade running against a deck that is
        // reloading underneath it.
        if (heldSong) endHeldTransition?.();
        const currentSongKey = getPlaybackSongKey(heldSong ?? options?.fromSong ?? currentSong);
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
                        isAutomixAdvance: options?.isAutomixAdvance,
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
                isAutomixAdvance: options?.isAutomixAdvance,
            });
        } else if (options?.allowStopOnMissing) {
            stopAtQueueEnd();
        }
    }, [audioRef, currentSong, endHeldTransition, getDisplaySong, isFmMode, isNowPlayingStageActive, loopMode, playQueue, playSong, setPlayQueue, setPlayerState, shouldNavigateToPlayerOnTrackChange]);

    const handlePrevTrack = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!currentSong || playQueue.length === 0) return;

        // Same as handleNextTrack, and more visibly wrong without it: stepping back from the track
        // a blend has already advanced to lands on the one the listener is hearing, so "previous"
        // replays the current song instead of going past it.
        const heldSong = getDisplaySong?.() ?? null;
        if (heldSong) endHeldTransition?.();
        const currentSongKey = getPlaybackSongKey(heldSong ?? currentSong);
        const currentIndex = playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey);
        let prevIndex = -1;

        if (currentIndex > 0) {
            prevIndex = currentIndex - 1;
        } else if (loopMode === 'all') {
            prevIndex = playQueue.length - 1;
        }

        if (prevIndex >= 0) {
            void playSong(playQueue[prevIndex], playQueue, isFmMode, {
                shouldNavigateToPlayer: shouldNavigateToPlayerOnTrackChange,
            });
        }
    }, [currentSong, endHeldTransition, getDisplaySong, isFmMode, isNowPlayingStageActive, loopMode, playQueue, playSong, shouldNavigateToPlayerOnTrackChange]);

    // 失败消息可能挂很久才被点：按钮经这里调用最新一次渲染的 handleNextTrack / playSong，按点击时的队列走，期间的编辑不被旧快照覆盖。
    // 点歌失败（playSong 里的 presentOnlineFailure）的重试 / 跳过也用它；那些闭包只在点击时读 .current，晚于这里的声明。
    const latestQueueActionsRef = useRef({ handleNextTrack, playSong });
    latestQueueActionsRef.current = { handleNextTrack, playSong };

    // 不带 failure：本地、Navidrome、转码的旧路径，倒计时跳歌，行为不变。
    // 带 failure：在线源播放中失败，按策略表展示（PAUSED），失败歌曲已不是当前歌曲时什么都不做。
    const skipAfterPlaybackFailure = useCallback((failure?: PlaybackFailure, options: PlaybackFailureSkipOptions = {}) => {
        const { failedSongKey, failedGeneration } = options;
        // 失败所属的那次播放是否仍在：歌曲没换，而且没有重新点播同一首（代次没变）。
        const isFailedPlaybackCurrent = () => (!failedSongKey || currentSongRef.current === failedSongKey)
            && (failedGeneration === undefined || playbackGenerationRef.current === failedGeneration);
        if (failure && !isFailedPlaybackCurrent()) return;
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

        if (failure) {
            presentPlaybackFailure({
                failure, context: 'mid-playback', skipCount,
                isCurrent: isFailedPlaybackCurrent,
                retry: options.retry ?? (currentSong ? () => {
                    const live = usePlaybackStore.getState();
                    void latestQueueActionsRef.current.playSong(currentSong, live.playQueue, live.isFmMode, { shouldNavigateToPlayer: false });
                } : undefined),
                skip: hasNextTrack ? () => void latestQueueActionsRef.current.handleNextTrack({
                    allowStopOnMissing: true,
                    shouldNavigateToPlayer: false,
                    unavailableSkipCount: failure.reason === 'taken-down' ? skipCount + 1 : 0,
                    fromSong: currentSong ?? undefined,
                }) : undefined,
            }, presenterDeps);
            return;
        }

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
                // The track that failed is the one on the active deck, which mid-blend is NOT the
                // one on screen. Skipping from the displayed track would step onto the broken one.
                fromSong: currentSong ?? undefined,
            });
        });
    }, [clearPendingUnavailableSkip, currentSong, currentSongRef, handleNextTrack, loopMode, playQueue, playbackAutoSkipCountRef, playbackGenerationRef, presenterDeps, setPlayerState, showTimedSkipPrompt]);

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
                if (!baseQueue[fromIndex]) {
                    throw new Error('Queue item was not found.');
                }
                nextQueue = moveQueueItem(baseQueue, fromIndex, toIndex);
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
            // 舞台的就地编辑（move / remove）与应用里的就地编辑（createQueueMutations.updateQueueOrder）一样：
            // 正在播放那首前后的预取窗口变了就重新预取。
            if (request.action === 'move' || request.action === 'remove') {
                refreshPrefetchAfterQueueEdit(currentSong, baseQueue, nextQueue, audioQuality, userId);
            }
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
    }, [activePlaybackContext, audioQuality, buildStageQueueOperationSnapshot, currentSong, isFmMode, isNowPlayingStageActive, loadStageQueueSongs, persistLastPlaybackCache, playQueue, playSong, resolveStageQueueIndex, setPlayQueue, setStatusMsg, t, userId]);

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

    const clearQueue = useCallback(() => {
        if (isNowPlayingStageActive) return;
        if (!playQueue || playQueue.length === 0) return;

        setPlayQueue([]);
        void persistLastPlaybackCache(currentSong, []);
        setStatusMsg({ type: 'success', text: t('status.queueCleared') || 'Queue cleared', nonce: Date.now(), durationMs: 1200 });
    }, [currentSong, isNowPlayingStageActive, persistLastPlaybackCache, playQueue, setPlayQueue, setStatusMsg, t]);

    // Wrapped so the callbacks this hook hands back keep one identity for the app's lifetime. They
    // are all invoked from events or effects, and their churn was what kept every build*Model memo
    // in App.tsx from ever holding - see useStableCallbacks.ts.
    return useStableActionSurface({
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
        clearQueue,
    });
}
