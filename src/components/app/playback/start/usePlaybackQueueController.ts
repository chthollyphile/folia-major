import { useCallback, useEffect, useRef, useState } from 'react';
import { pausePlaybackOutput, playbackPosition } from '../../../../services/playbackBackend/transport';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { applyOnlineAudioSourceMetadata, loadOnlineSongLyrics } from '../../../../services/onlinePlayback';
import { isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import { getSongResourceCacheKey } from '../../../../services/onlineMusic/resourceKeys';
import { getPersonalFmSelection } from '../../../../stores/usePersonalFmModeStore';
import { omni } from '../../../../services/onlineMusic/omni';
import { getCachedSongCoverUrl, hasCachedSongAudio } from '../../../../services/onlineMusic/resourceCache';
import { getPrefetchedData, invalidateAndRefetch, prefetchNearbySongs, refreshPrefetchAfterQueueEdit } from '../../../../services/prefetchService';
import { getLocalSong } from '../../../../services/db';
import { retireBlobUrl } from '../../../../services/playbackBlobUrls';
import type { ThemeCacheSongKey } from '../../../../services/themeCache';
import { loadOnlineLyricsState } from '../../../../utils/onlineLyricsState';
import { PlayerState, type StagePlayerQueueDiffOp, type StagePlayerQueueRequest, type StagePlayerSnapshot } from '../../../../types';
import type { LocalSong, QueueAddBehavior, SongResult, StatusMessage, UnifiedSong } from '../../../../types';
import type { AudioQualityPreference, MediaId } from '../../../../types/onlineMusic';
import type { NextTrackOptions, PlaybackNavigationOptions, UnavailableReplacementRequest } from '../../../../types/appPlayback';
import type { NavidromeSong } from '../../../../types/navidrome';
import {
    getOnlineProviderIdForSong,
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
    replacePlaybackSongWhereQueued,
    resolveNavidromePlaybackCarrier,
    samePlaybackKeySequence,
} from '../../../../utils/appPlaybackGuards';
import { isQueueSongPlayable } from '../playableSong';
import { supplyLyricsAfterEmptyLoad } from '../createLyricsSetter';
import {
    canShuffleQueue,
    fmNeedsTopUpAt,
    hasTrackToSkipTo,
    nextPlayableQueueSong,
    nextQueueIndex,
    prevQueueIndex,
    queueIndexOf,
    queueLoopMode,
    resolvePlaybackNeighbors,
} from '../../../../utils/playbackNeighbors';
import { freshFmSongs } from '../../../../utils/fmQueue';
import { applyQueueAddBehavior } from '../../../../utils/queueAddBehavior';
import { moveQueueItem } from '../../../../utils/queueReorder';
import { buildStagePlayerSnapshot, resolveStagePlayerQueueItemIndex } from '../../../../utils/stagePlayerSnapshot';
import type { LocalLibraryDisplayCatalog } from '../../../../services/playbackAdapters';
import type { SearchReturnView, SearchSource } from '../../../../stores/useSearchNavigationStore';
import { dispatchSearchTrackAction } from '../../search/searchTrackActions';
import { playbackFade } from '../../../../services/playbackFade';
import { getProviderSongMetadata } from '../../../../services/onlineMusic/songMetadata';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { setAudioSrc, setCachedCoverUrl, setCurrentLineIndex, setCurrentSong, setDuration, setIsFmMode, setPlayQueue, setPlayerState, startLoadingToPlay, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { askedSongKeyRef, askForSong, playsDroppedSoFar, showSong, startOfAskedSong, startPlay, withdrawAsk } from '../currentSong';
import { loadOnlineSongAudio } from '../source/songAudioSource';
import { onlineFailureToast } from '../source/onlineFailureToast';
import { offersRetry, onlineFailureOf, stopsPlayback, type OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { openLoginWindow } from '../../../login/loginWindowStore';
import { useTranslation } from 'react-i18next';
import { currentTime } from '../../../../stores/motionSignals';
import { setIsPanelOpen, setPanelTab } from '../../../../stores/useAppViewStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { useSearchNavigationStore } from '../../../../stores/useSearchNavigationStore';
import { showLatticeFmNotice, usePlaybackEntryViewStore } from '../../../../stores/usePlaybackEntryViewStore';
import { useStableActionSurface } from '../../../../hooks/useStableCallbacks';
import { hasBeforePlayHook, notifyPlaybackFailed, runBeforePlayHook } from '../../../../services/hostExtensionHooks';
import { wholeQueueWritesSoFar } from '../../../../services/wholeQueueWrites';
import { noteQueueStart } from './queueStarts';
import { errorMessage } from '../../../../utils/errorText';

// src/components/app/playback/start/usePlaybackQueueController.ts

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
// The nonce of a skip prompt's toast: one toast for the whole count, and a new one for the next song's,
// even when it says the same.
let skipPromptCount = 0;

// 「无法播放时自动跳过」 is read when a failure happens, not subscribed to: whether a failure stops and
// whether its skip is counted are decided by the same reading.
const readAutoSkipUnplayable = () => useAudioSettingsStore.getState().autoSkipUnplayable;

// The cases where the address may come at once if asked again after a while: a lookup of another
// version that failed this way is told as that, not as the song being taken down.
const isPassingFailure = (shown: OnlineFailure) => (
    shown.case === 'unreachable' || shown.case === 'retry-later' || shown.case === 'local-service-stopped'
);

// A sign-in that has run out comes with the button that opens the sign-in window for that platform.
const withSignInAction = (
    shown: OnlineFailure,
    said: StatusMessage,
    t: (key: string) => string,
): StatusMessage => {
    const signInTo = shown.case === 'sign-in-needed' ? shown.providerId : undefined;
    return signInTo ? {
        ...said,
        actionLabel: t('failure.signIn'),
        onAction: () => {
            setStatusMsg(null);
            openLoginWindow(signInTo);
        },
    } : said;
};

/**
 * What the caller knows of a failure of the song that is playing: the song and which start of it
 * failed (its key and `startOfAskedSong`, read before the first wait: a failure of a song or a start
 * that no longer plays is dropped), and the retry it has for it (asking for the same address again
 * where it played, instead of playing the song from its start).
 */
export type PlaybackFailureSkipOptions = {
    failedSongKey?: string;
    failedStart?: number;
    retry?: () => void;
};

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
    /** Rising id per playSong call: a newer call supersedes an older one still awaiting `beforePlay`. */
    const playSongCallIdRef = useRef(0);
    /** FM state from before the oldest play that has not shown its song yet; a play that does not land puts it back. */
    // `queueWrites`: the whole-queue writes when it was kept. One that came since (a mod's replaceQueue ended FM)
    // makes it stale: no later play puts FM back to it.
    const fmModeBeforePendingPlayRef = useRef<{ isFm: boolean; queueWrites: number } | null>(null);
    const pendingUnavailableSkipTimerRef = useRef<number | null>(null);
    const pendingUnavailableSkipIntervalRef = useRef<number | null>(null);

    // The stage takes the same audio element and drops the plays in flight (`dropPlaysInFlight`): a dropped
    // play never puts back the FM state it wrote, and openStagePlayer has just kept that state in the main
    // snapshot. It goes back to what it was before that play.
    useEffect(() => usePlaybackStore.subscribe((state, previous) => {
        if (state.activePlaybackContext !== 'stage' || previous.activePlaybackContext === 'stage') return;
        const kept = fmModeBeforePendingPlayRef.current;
        const fmModeBeforeRequest = kept && kept.queueWrites === wholeQueueWritesSoFar() ? kept.isFm : null;
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
        // The queue, the song and the add setting as the stores hold them now, not as this render saw
        // them: adds made one after another before the next render (a mod's enqueue in a loop, an add
        // after an await) each add to what the one before left, instead of all starting from the same
        // queue and the last one winning.
        const live = usePlaybackStore.getState();
        const addBehavior = useAudioSettingsStore.getState().queueAddBehavior;
        const context = live.activePlaybackContext;
        if (songs.length === 0) {
            return { changed: false, deduplicated: false, affectedCount: 0, baseQueue: [], affectedSongs: [], addBehavior };
        }

        const mainSnapshot = context === 'stage' ? mainPlaybackSnapshotRef.current : null;
        const queueAnchorSong = mainSnapshot?.currentSong ?? (context === 'main' ? live.currentSong : null);
        const existingQueue = mainSnapshot?.playQueue ?? (context === 'main' ? live.playQueue : []);
        const baseQueue = existingQueue.length > 0 ? existingQueue : (queueAnchorSong ? [queueAnchorSong] : []);
        const queueableSongs = songs.filter(song => !isSongUnavailable(song));
        const { nextQueue, affectedSongs, changed } = applyQueueAddBehavior({
            queue: baseQueue,
            songs: queueableSongs,
            currentSong: queueAnchorSong,
            behavior: addBehavior,
        });

        if (context === 'stage') {
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
            if (addBehavior === 'next') {
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
            addBehavior,
        };
    }, [mainPlaybackSnapshotRef, persistLastPlaybackCache, setPlayQueue, setStatusMsg, t]);

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

    // Keeps unavailable provider entries in the queue so they can be retried after configuration changes.
    const getPlayableOnlineQueue = useCallback((queue: SongResult[]) => {
        return [...queue];
    }, []);

    const getNextPlayableQueueSong = useCallback((queue: SongResult[], song: SongResult, isFm: boolean) => {
        const currentIndex = queueIndexOf(queue, song);
        return nextPlayableQueueSong(queue, currentIndex, queueLoopMode(loopMode, isFm), isQueueSongPlayable);
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

    // `said`: what the toast says while it counts down (the failure's title, note and quote).
    const showTimedSkipPrompt = useCallback((
        said: StatusMessage,
        onSkip: () => void,
        onCancel?: () => void
    ) => {
        clearPendingUnavailableSkip();

        let remainingSeconds = Math.ceil(UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS / 1000);
        const nonce = ++skipPromptCount;
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
            ...said,
            nonce,
            countdown: { text: t('failure.skipCountdown', { seconds }), seconds, totalMs: UNAVAILABLE_SKIP_CONFIRM_TIMEOUT_MS },
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

            // Only the toast this count put up is counted down; another one that came meanwhile stays.
            setStatusMsg(current => {
                if (current !== lastBuilt) {
                    return current;
                }
                lastBuilt = buildMessage(remainingSeconds);
                return lastBuilt;
            });
        }, UNAVAILABLE_SKIP_CONFIRM_INTERVAL_MS);
    }, [clearPendingUnavailableSkip, pendingUnavailableSkipIntervalRef, pendingUnavailableSkipTimerRef, setStatusMsg, t]);

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
        // A route that empties the player while this play waits drops it too (`dropPlaysInFlight`).
        const droppedAtStart = playsDroppedSoFar();
        // No queue given, or the store's own (next / previous, a mod's playQueueItem, the FM top-up): the
        // buttons of a failure play from the queue as it is when they are pressed. Only a queue not yet in
        // the store (a playlist's song) is kept as it was given. The queue panel hands a copy with the local
        // library's display (playerDisplayQueue, a new array each time), so it is kept too. Read before the
        // hook's wait, as the caller saw it.
        const queueFollowsStore = queue.length === 0 || queue === usePlaybackStore.getState().playQueue;
        // A play of a queue of its own, or one that turns Personal FM on or off, starts something new: the FM
        // batches still on their way (a mode switch, a home card) are dropped for it. See queueStarts.ts.
        const storeAtCall = usePlaybackStore.getState();
        if (isFmCall !== storeAtCall.isFmMode
            || !(queueFollowsStore || samePlaybackKeySequence(queue, storeAtCall.playQueue))) {
            noteQueueStart();
        }
        // Read before the hook's wait too: the whole-queue writes this play must not write over.
        const queueWritesAtStart = wholeQueueWritesSoFar();
        const storeQueueAtStart = usePlaybackStore.getState().playQueue;
        // The queue this play was given is the store's, or a copy of it (the queue panel's display copy, the Stage API's select).
        const yieldsToStore = () => queue.length === 0 || queue === storeQueueAtStart || samePlaybackKeySequence(queue, storeQueueAtStart);
        // A whole-queue write (a mod's replaceQueue, its undo) came while this play waited, and this play's queue was the store's.
        const queueRewritten = () => wholeQueueWritesSoFar() !== queueWritesAtStart && yieldsToStore();
        const allowedSong = !options.isAutomixAdvance && hasBeforePlayHook()
            ? await runBeforePlayHook(requestedSong)
            : requestedSong;
        if (!allowedSong || playSongCallIdRef.current !== playSongCallId || playsDroppedSoFar() !== droppedAtStart) {
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
        // A new play takes the place of the previous song's dialog of another version.
        setPendingUnavailableReplacement(null);
        clearPendingUnavailableSkip();
        setStatusMsg(prev => prev?.persistent ? null : prev);
        const shouldNavigateToPlayer = options.shouldNavigateToPlayer ?? true;
        const wasFmMode = usePlaybackStore.getState().isFmMode;
        // With an earlier play still not landed, the FM state it kept stands: the one it wrote never
        // went with a song that played.
        const keptFmMode = fmModeBeforePendingPlayRef.current;
        const fmModeToRestore = keptFmMode && keptFmMode.queueWrites === wholeQueueWritesSoFar() ? keptFmMode.isFm : wasFmMode;
        fmModeBeforePendingPlayRef.current = { isFm: fmModeToRestore, queueWrites: wholeQueueWritesSoFar() };
        // A whole-queue write during the hook's wait has set Personal FM for the store's queue (a replacement
        // ends it): a play from that queue keeps it so, instead of the FM state it was called with.
        const playsAsFm = queueRewritten() ? wasFmMode : isFmCall;
        setIsFmMode(playsAsFm);
        // The whole-queue writes when this play wrote FM: one after it ended FM again (see restoreFmModeIfNotLanded).
        const queueWritesAtFmWrite = wholeQueueWritesSoFar();
        if (playsAsFm && !wasFmMode) {
            setPanelTab('queue');
            setIsPanelOpen(true);
            if (usePlaybackEntryViewStore.getState().playbackEntryView === 'lattice') {
                showLatticeFmNotice();
            }
        }

        // The play starts here: from now on a newer play, or a drop of the plays in flight, ends it.
        const isLatestPlaybackRequest = startPlay();
        // A play that does not land puts the FM state back as it was before it: left as it wrote it, it
        // would not go with the song that still plays and its queue, and the next track would be picked in
        // the wrong mode. A retry, a skip or another version calls playSong with `isFmCall` again; a newer
        // play has written its own state, which stays.
        const restoreFmModeIfNotLanded = () => {
            if (!isLatestPlaybackRequest()) return;
            fmModeBeforePendingPlayRef.current = null;
            // A whole-queue write while this play waited has ended Personal FM already: put back, the radio's
            // songs would be added after that queue. This holds whatever queue the play was given.
            // Counted from this play's own FM write: one during the hook's wait came before it, and
            // `fmModeToRestore` was read after it, so putting that back is right.
            if (wholeQueueWritesSoFar() !== queueWritesAtFmWrite) return;
            if (usePlaybackStore.getState().isFmMode !== fmModeToRestore) setIsFmMode(fmModeToRestore);
        };
        const isLocal = isLocalPlaybackSong(song);
        const isNavidrome = isNavidromePlaybackSong(song);
        let prefetched: ReturnType<typeof getPrefetchedData> = null;
        let preloadedOnlineAudioResult: Awaited<ReturnType<typeof loadOnlineSongAudio>> | null = null;
        // A copy from the media cache is this play's own until its address is written: a play that
        // stops before that gives the blob URL back.
        const giveBackUnusedCopy = () => {
            if (preloadedOnlineAudioResult?.kind === 'ok' && preloadedOnlineAudioResult.blobUrl) {
                URL.revokeObjectURL(preloadedOnlineAudioResult.blobUrl);
            }
        };
        const queueContext = queue.length > 0 ? queue : playQueue.length === 0 ? [song] : playQueue;
        const newQueue = getPlayableOnlineQueue(queueContext);
        const skipCount = options.unavailableSkipCount ?? 0;
        playbackAutoSkipCountRef.current = skipCount;
        // For the plays this one defers (the replacement dialog, the timed skip): they start after a
        // prompt or a countdown, so they are not the blend's advance even when this call was.
        // Nor do they carry a judgement of the queue made for another play (`queueRewritten`).
        const deferredPlayOptions: PlaybackNavigationOptions = { ...options, isAutomixAdvance: undefined, queueRewritten: undefined };
        const providerId = getOnlineProviderIdForSong(song) ?? undefined;

        // A button of a failure may be pressed long after: where the queue follows the store, the main
        // queue as it is then (the stage keeps it in mainPlaybackSnapshotRef while it plays).
        const readLiveQueue = (): SongResult[] | null => {
            const live = usePlaybackStore.getState();
            const liveQueue = live.activePlaybackContext === 'stage' ? mainPlaybackSnapshotRef.current?.playQueue ?? [] : live.playQueue;
            return liveQueue.length > 0 ? liveQueue : null;
        };
        const readClickTimeQueue = (): SongResult[] | null => (queueFollowsStore ? readLiveQueue() : null);
        const tellFailure = (shown: OnlineFailure | null, willAutoSkip: boolean) => {
            notifyPlaybackFailed({ song, reason: shown?.case ?? null, phase: 'play', willAutoSkip });
        };

        // How a failure of this play is shown. The refusals the listener can act on (sign in, a
        // membership, a purchase, a region) stop here; with 「无法播放时自动跳过」 on, those of only this
        // song count down like the rest, and a cancel of that count stops as they would have. The others
        // count down to the next playable song, or, where there is none or the skips are used up, say what
        // happened, with a retry where asking again may help. The buttons call the newest playSong (the
        // quality, the stage and the queue of the moment they are pressed).
        const presentOnlineFailure = (shown: OnlineFailure) => {
            restoreFmModeIfNotLanded();
            setIsLyricsLoading(false);
            const said = onlineFailureToast(shown, t);
            const stopHere = () => {
                shouldAutoPlayRef.current = false;
                audioRef.current?.pause();
                setPlayerState(PlayerState.IDLE);
                setStatusMsg(withSignInAction(shown, said, t));
            };
            if (stopsPlayback(shown, readAutoSkipUnplayable())) {
                stopHere();
                tellFailure(shown, false);
                return;
            }
            const nextSong = getNextPlayableQueueSong(queueContext, song, isFmCall);
            if (nextSong && skipCount < MAX_UNAVAILABLE_AUTO_SKIP_COUNT) {
                showTimedSkipPrompt(said, () => {
                    if (!isLatestPlaybackRequest()) return;
                    // The queue was replaced whole meanwhile: the skip steps through the queue and FM of now
                    // from this song (from the first entry when the new queue does not hold it), as a skip
                    // after a failure mid-song does.
                    if (queueRewritten()) {
                        void latestQueueActionsRef.current.handleNextTrack({
                            fromSong: song,
                            allowStopOnMissing: true,
                            unavailableSkipCount: skipCount + 1,
                            shouldNavigateToPlayer: deferredPlayOptions.shouldNavigateToPlayer,
                        });
                        return;
                    }
                    // A queue given here and not yet in the store is the one kept; else the queue of now,
                    // so that edits made meanwhile are not undone.
                    const targetQueue = readClickTimeQueue() ?? newQueue;
                    void latestQueueActionsRef.current.playSong(getNextPlayableQueueSong(targetQueue, song, isFmCall) ?? nextSong, targetQueue, isFmCall, {
                        ...deferredPlayOptions,
                        unavailableSkipCount: skipCount + 1,
                    });
                }, stopsPlayback(shown) ? () => { if (isLatestPlaybackRequest()) stopHere(); } : undefined);
                tellFailure(shown, true);
                return;
            }
            if (stopsPlayback(shown)) {
                stopHere();
            } else {
                setStatusMsg(offersRetry(shown) ? {
                    ...said,
                    actionLabel: t('ui.retry'),
                    onAction: () => {
                        setStatusMsg(null);
                        // After a whole-queue write the retry plays within the queue and FM of now (the song
                        // goes back in front of a queue that no longer holds it, as any replay of it does).
                        const rewritten = queueRewritten();
                        // Where no queue was given, none is given again: the store's queue is not rewritten.
                        const retryQueue = queue.length > 0 && (queueFollowsStore || rewritten) ? readLiveQueue() ?? [] : queue;
                        const retryFm = rewritten ? usePlaybackStore.getState().isFmMode : isFmCall;
                        void latestQueueActionsRef.current.playSong(song, retryQueue, retryFm, { ...deferredPlayOptions, unavailableSkipCount: 0 });
                    },
                } : said);
            }
            tellFailure(shown, false);
        };

        // A song taken down (the platform's record says so) looks for another version first: found, the
        // dialog offers it. A lookup that could not reach the platform is told as that; one that found
        // none counts down to the next song.
        const presentTakenDown = async (shown: OnlineFailure) => {
            setIsLyricsLoading(false);
            setStatusMsg({ type: 'info', text: t('status.loadingSong') });
            let replacement: Awaited<ReturnType<typeof omni.getSongReplacement>> = null;
            let lookupFailure: OnlineFailure | null = null;
            try {
                replacement = await omni.getSongReplacement(song);
            } catch (error) {
                console.error('[App] Failed to load replacement song before dialog:', error);
                lookupFailure = onlineFailureOf({ operation: 'audio', providerId }, { error });
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
                    liveQueue: () => {
                        if (!queueRewritten()) return null;
                        const live = usePlaybackStore.getState();
                        return { queue: live.playQueue, isFmCall: live.isFmMode };
                    },
                });
                // A dialog shows instead of a failure, but this song itself cannot play: told once, with no countdown.
                tellFailure(shown, false);
                return;
            }
            presentOnlineFailure(lookupFailure && isPassingFailure(lookupFailure) ? lookupFailure : shown);
        };

        if (!isLocal && !isNavidrome && isSongUnavailable(song)) {
            await presentTakenDown(onlineFailureOf({ operation: 'audio', providerId }, { detail: { case: 'taken-down' } }));
            return;
        }

        if (isLocal) {
            // The newest record of this song from the library, not only the one in `localSongs`: the warm-up
            // of the songs nearby and a match writing back land in the store first, and an older copy here
            // would extract the cover again before the sound, and match again after it. The state's record
            // where the library has none.
            const localData = (await getLocalSong(song.localRef.songId))
                ?? localSongs.find(ls => ls.id === song.localRef.songId)
                ?? null;
            if (!isLatestPlaybackRequest()) return;

            if (!localData) {
                restoreFmModeIfNotLanded();
                setStatusMsg({ type: 'error', text: t('status.localFilePlaybackError') });
                tellFailure(null, false);
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
                queueRewritten,
            });
            return;
        }

        if (isNavidrome) {
            const navidromeSong = resolveNavidromePlaybackCarrier(song);
            if (!navidromeSong) {
                restoreFmModeIfNotLanded();
                setStatusMsg({ type: 'error', text: t('status.playbackError') });
                tellFailure(null, false);
                return;
            }

            const navidromeQueue = queueContext
                .map(queuedSong => resolveNavidromePlaybackCarrier(queuedSong))
                .filter((queuedSong): queuedSong is NavidromeSong => Boolean(queuedSong));
            fmModeBeforePendingPlayRef.current = null;
            await onPlayNavidromeSong(navidromeSong, navidromeQueue, {
                shouldNavigateToPlayer,
                unifiedQueue: newQueue,
                queueRewritten,
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
            // Where the platform could not be reached the load asks again by itself while this play is
            // wanted, and says so.
            preloadedOnlineAudioResult = await loadOnlineSongAudio(song, audioQuality, prefetched, {
                retry: {
                    isCurrent: isLatestPlaybackRequest,
                    onRetrying: shown => {
                        if (isLatestPlaybackRequest()) {
                            setStatusMsg({ type: 'info', text: t('status.songRetrying'), ...(shown.providerId ? { providerId: shown.providerId } : {}) });
                        }
                    },
                },
            });
            if (!isLatestPlaybackRequest()) {
                giveBackUnusedCopy();
                return;
            }

            if (preloadedOnlineAudioResult.kind === 'unavailable') {
                const shown = preloadedOnlineAudioResult.failure;
                if (shown.case === 'taken-down') await presentTakenDown(shown);
                else presentOnlineFailure(shown);
                return;
            }
        } catch (error) {
            if (!isLatestPlaybackRequest()) return;
            console.error('[App] Failed to fetch song URL:', error);
            presentOnlineFailure(onlineFailureOf({ operation: 'audio', providerId }, { error }));
            return;
        }

        const songKey = getPlaybackSongKey(song);
        const resolvedSong = preloadedOnlineAudioResult?.kind === 'ok'
            ? applyOnlineAudioSourceMetadata(song, preloadedOnlineAudioResult.replayGain)
            : song;
        const resolvedQueue = replacePlaybackSongInQueue(newQueue, resolvedSong);
        askForSong(song);
        // Which start of the song this is: a newer play of this same song asks again under the same key.
        const askedStart = startOfAskedSong();

        const onlineLyricsState = await loadOnlineLyricsState(song);
        // Overtaken during that wait: nothing of this song is shown, and the queue stays as it is.
        if (!isLatestPlaybackRequest()) {
            // The play that overtook this one may end without asking for a song of its own.
            withdrawAsk(song);
            giveBackUnusedCopy();
            return;
        }
        // The song before may have failed while this one loaded (its countdown, its toast that stays):
        // that is no longer about what plays, as at the start of this play.
        clearPendingUnavailableSkip();
        setStatusMsg(prev => prev?.persistent ? null : prev);
        fmModeBeforePendingPlayRef.current = null;

        // Written only now: a play that gave up above leaves the intent to play, the time to resume
        // at and the address's fetch time to the song the key went back to.
        shouldAutoPlayRef.current = true;
        pendingResumeTimeRef.current = null;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setLyrics(null);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setDuration(0);
        showSong({ ...resolvedSong, onlineLyricsState: onlineLyricsState ?? undefined });
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setIsLyricsLoading(true);

        // Handed over rather than revoked here: during a blend the song this replaces is still
        // sounding on the other deck, and taking its URL away leaves that deck unable to seek. See
        // `retireBlobUrl` - the failure is silent and permanent, with no error event to notice it by.
        retireBlobUrl(blobUrlRef.current);
        blobUrlRef.current = null;

        // A whole-queue write came while this play waited: the new queue stays, with this song swapped in
        // where it holds it and left as it is where it does not.
        let landedQueue = resolvedQueue;
        if (queueRewritten()) {
            const live = usePlaybackStore.getState().playQueue;
            const swapped = replacePlaybackSongWhereQueued(live, resolvedSong);
            if ((queue.length > 0 || playQueue.length === 0) && swapped) {
                setPlayQueue(swapped);
            }
            landedQueue = swapped ?? live;
        } else if (queue.length > 0 || playQueue.length === 0) {
            setPlayQueue(resolvedQueue);
        }

        void persistLastPlaybackCache({ ...resolvedSong, onlineLyricsState: onlineLyricsState ?? undefined }, landedQueue);

        if (shouldNavigateToPlayer) {
            navigateToPlaybackView();
        }
        startLoadingToPlay();

        const cachedCoverUrl = await getCachedSongCoverUrl(song);
        if (askedSongKeyRef.current !== songKey || startOfAskedSong() !== askedStart) {
            giveBackUnusedCopy();
            return;
        }
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
        }
        // Here only an http address keeps its fetch time (the restore and the recovery keep it for
        // every address that is not a blob).
        currentOnlineAudioUrlFetchedAtRef.current = audioResult.audioSrc.startsWith('http') ? audioResult.fetchedAt : null;
        setAudioSrc(audioResult.audioSrc);

        try {
            await loadOnlineSongLyrics(song, prefetched, userId, {
                isCurrent: () => askedSongKeyRef.current === songKey,
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
                    // A preview clip plays as it comes and is told of as it starts (previewNotice.ts),
                    // which is when this search starts too: its notice would take the preview's place.
                    if (!audioResult.preview) setStatusMsg({ type: 'info', text: t('status.matchingBestLyrics') });
                },
                onDone: () => setIsLyricsLoading(false),
            });
            // The load has ended; a song still asked for that it left without lyrics may get some from a mod.
            if (askedSongKeyRef.current === songKey) supplyLyricsAfterEmptyLoad();
        } catch (error) {
            console.warn('[App] Lyric fetch failed', error);
            setLyrics(null);
            setIsLyricsLoading(false);
            if (askedSongKeyRef.current === songKey) supplyLyricsAfterEmptyLoad();
        }

        try {
            await restoreCachedThemeForSong(song);
            if (askedSongKeyRef.current !== songKey) return;
        } catch (error) {
            console.warn('Theme load error', error);
        }

        // Asked again after the waits above: after a whole-queue write during them, the songs fetched ahead
        // are those around this one in the new queue.
        if (queueRewritten()) {
            const live = usePlaybackStore.getState().playQueue;
            if (live.length > 1) {
                prefetchNearbySongs(resolvedSong, live, audioQuality, userId);
            }
        } else if (newQueue.length > 1) {
            prefetchNearbySongs(resolvedSong, resolvedQueue, audioQuality, userId);
        }
    }, [
        audioQuality,
        audioRef,
        blobUrlRef,
        clearPendingUnavailableSkip,
        currentOnlineAudioUrlFetchedAtRef,
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
    }, [getPlayableOnlineQueue, playSong, setStatusMsg, t]);

    const handleQueueAddAndPlay = useCallback((song: SongResult) => {
        const existingIndex = queueIndexOf(playQueue, song);
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

        const { originalSong, replacementSong, replacementSongId, queue, isFmCall, options, liveQueue } = pendingUnavailableReplacement;
        setPendingUnavailableReplacement(null);

        // playSong takes its call id before its first wait; a throw after a newer play took the id is
        // that of a version the listener has left.
        let replacementCallId: number | null = null;
        try {
            if (!replacementSong || String(replacementSong.id) !== String(replacementSongId) || isSongUnavailable(replacementSong)) {
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                return;
            }

            // The queue was replaced whole since the dialog opened: the other version takes the original's
            // place in the queue of now, and where that queue does not hold the original it plays without
            // touching the queue.
            const live = liveQueue?.() ?? null;
            const replacementPlay = live
                ? playSong(
                    replacementSong,
                    queueIndexOf(live.queue, originalSong) >= 0 ? buildQueueWithReplacementSong(live.queue, originalSong, replacementSong) : [],
                    live.isFmCall,
                    options,
                )
                : playSong(replacementSong, buildQueueWithReplacementSong(queue, originalSong, replacementSong), isFmCall, options);
            replacementCallId = playSongCallIdRef.current;
            await replacementPlay;
        } catch (error) {
            // Overtaken: dropped like any late result, not said over the new song, nor told.
            if (replacementCallId !== null && playSongCallIdRef.current !== replacementCallId) return;
            console.error('[App] Failed to load replacement song:', error);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            // playSong shows and tells the failures it knows of itself; this is a throw it did not catch
            // (the desktop cache, a cache entry moved). The listener sees the other version fail: told once.
            notifyPlaybackFailed({ song: replacementSong, reason: null, phase: 'play', willAutoSkip: false });
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
        // The FM top-up below waits for the radio: a whole-queue write during that wait has ended FM.
        const queueWritesAtStart = wholeQueueWritesSoFar();

        const stopAtQueueEnd = () => {
            if (audioRef.current) {
                void pausePlaybackOutput(audioRef.current).catch(error => console.error('[PlaybackBackend] Pause failed', error));
            }
            setPlayerState(PlayerState.IDLE);
        };

        // An emptied queue still has to stop playback at the end of the current track; returning
        // early here left the audio element `ended` while playerState stayed PLAYING.
        // A step from a song that never became current (the skip after a first play failed, once the
        // queue was replaced whole) names it in `fromSong`, and needs no current song to step from.
        if ((!currentSong && !options?.fromSong) || playQueue.length === 0) {
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
        const currentIndex = queueIndexOf(playQueue, heldSong ?? options?.fromSong ?? currentSong);
        // Personal FM never goes round to the queue's first track: when the fetch below fails or
        // comes back empty on the last track, there is no next track.
        const indexLoopMode = queueLoopMode(loopMode, isFmMode);

        if (isFmMode && fmNeedsTopUpAt(playQueue.length, currentIndex)) {
            let batch: SongResult[] = [];
            const stepFrom = heldSong ?? options?.fromSong ?? currentSong;
            const providerId = stepFrom ? getOnlineProviderIdForSong(stepFrom) : undefined;
            const selection = getPersonalFmSelection(providerId || undefined);
            // The main player's plays start in playSong and take a new call id there, before any wait of their
            // own (a mode switch, a home card, a next pressed meanwhile, a search result): one that came while
            // the batch did has the say over what plays next, even before it shows its song. The stage takes
            // over without playSong, and ends FM as it does.
            const playCallAtStart = playSongCallIdRef.current;
            try {
                batch = await omni.getPersonalFm();
            } catch (error) {
                console.error('Failed to fetch FM tracks', error);
            }
            if (wholeQueueWritesSoFar() !== queueWritesAtStart) {
                // The queue was replaced whole while the batch came (which ended FM): no radio songs are
                // added after it, and the newest handleNextTrack steps through the new queue instead.
                // A batch that failed comes here too: the step below would play this render's FM queue
                // (a list the store no longer holds) and write it back, FM and all.
                void latestQueueActionsRef.current.handleNextTrack(options);
                return;
            }
            const live = usePlaybackStore.getState();
            const selectedNow = getPersonalFmSelection(providerId || undefined);
            // A mode switch or a newly started queue overtakes a top-up already in flight. The queue itself
            // is not asked: an add, a removal, a library refresh or a recovery write it anew in place while
            // FM stays on air, and those are steps on through, not reasons to stop at the end of this song.
            if (playSongCallIdRef.current !== playCallAtStart || !live.isFmMode
                || (currentSong && !isSamePlaybackSong(live.currentSong, currentSong))
                || selection.mode !== selectedNow.mode || selection.scene !== selectedNow.scene) return;
            // The queue as the store holds it now, with whatever was added or edited during the wait: this
            // render's may already be an older copy of it.
            const base = live.playQueue;
            // Only songs not in the queue yet: a song twice would make finding the current one by its
            // key jump back to the earlier place. A batch of nothing new is a top-up that did not come;
            // the next track tops up again.
            const fmSongs = freshFmSongs(base, batch);
            const nextQueue = fmSongs.length > 0 ? [...base, ...fmSongs] : base;
            if (fmSongs.length > 0) setPlayQueue(nextQueue);
            // A batch that failed or brought nothing new steps on through the queue there is, and on its last
            // song stops (Personal FM does not go round).
            const nextIndex = nextQueueIndex(nextQueue.length, queueIndexOf(base, stepFrom), indexLoopMode);
            if (nextIndex >= 0) {
                void playSong(nextQueue[nextIndex], nextQueue, true, {
                    shouldNavigateToPlayer,
                    unavailableSkipCount: options?.unavailableSkipCount,
                    isAutomixAdvance: options?.isAutomixAdvance,
                });
            } else if (options?.allowStopOnMissing) {
                stopAtQueueEnd();
            }
            return;
        }

        const nextIndex = nextQueueIndex(playQueue.length, currentIndex, indexLoopMode);

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
        const currentIndex = queueIndexOf(playQueue, heldSong ?? currentSong);
        // Nor does Personal FM jump back from its first track to the newest one at the queue's end.
        const prevIndex = prevQueueIndex(playQueue.length, currentIndex, queueLoopMode(loopMode, isFmMode));

        if (prevIndex >= 0) {
            void playSong(playQueue[prevIndex], playQueue, isFmMode, {
                shouldNavigateToPlayer: shouldNavigateToPlayerOnTrackChange,
            });
        }
    }, [currentSong, endHeldTransition, getDisplaySong, isFmMode, isNowPlayingStageActive, loopMode, playQueue, playSong, shouldNavigateToPlayerOnTrackChange]);

    // A failure's buttons may be pressed long after: they call the newest handleNextTrack / playSong, with
    // the queue of that moment. The failures of playSong use it too; their closures read `.current` only
    // when pressed, after this line.
    const latestQueueActionsRef = useRef({ handleNextTrack, playSong });
    latestQueueActionsRef.current = { handleNextTrack, playSong };

    // `shown`: why an online song could not be played. A local or Navidrome song has none, and says
    // only that it could not be played. See PlaybackFailureSkipOptions for `options`.
    const skipAfterPlaybackFailure = useCallback((shown?: OnlineFailure, options: PlaybackFailureSkipOptions = {}) => {
        const { failedSongKey, failedStart, retry } = options;
        // Whether the play that failed still plays: the same song, and not started again since.
        const isFailedPlaybackCurrent = () => (!failedSongKey || askedSongKeyRef.current === failedSongKey)
            && (failedStart === undefined || startOfAskedSong() === failedStart);
        if (!isFailedPlaybackCurrent()) return;
        clearPendingUnavailableSkip();
        const skipCount = playbackAutoSkipCountRef.current;
        const currentIndex = queueIndexOf(playQueue, currentSong);
        const hasNextTrack = hasTrackToSkipTo(playQueue.length, currentIndex, loopMode, isFmMode);
        const said: StatusMessage = shown ? onlineFailureToast(shown, t) : { type: 'error', text: t('status.playbackError') };
        const tell = (willAutoSkip: boolean) => {
            notifyPlaybackFailed({ song: currentSong, reason: shown?.case ?? null, phase: 'mid-playback', willAutoSkip });
        };
        // A refusal the listener can act on stops the song where it is: it was playing, so PAUSED.
        const stopHere = (stopped: OnlineFailure) => {
            shouldAutoPlayRef.current = false;
            audioRef.current?.pause();
            setPlayerState(PlayerState.PAUSED);
            setStatusMsg(withSignInAction(stopped, said, t));
        };

        if (shown && stopsPlayback(shown, readAutoSkipUnplayable())) {
            stopHere(shown);
            tell(false);
            return;
        }

        if (!hasNextTrack || skipCount >= MAX_UNAVAILABLE_AUTO_SKIP_COUNT) {
            if (shown && stopsPlayback(shown)) {
                stopHere(shown);
                tell(false);
                return;
            }
            setPlayerState(PlayerState.IDLE);
            // Where asking again may help: the caller's retry (the same address once more, where it
            // played), else the song from its start.
            const retryPlay = shown && offersRetry(shown)
                ? retry ?? (currentSong ? () => {
                    const live = usePlaybackStore.getState();
                    void latestQueueActionsRef.current.playSong(currentSong, live.playQueue, live.isFmMode, { shouldNavigateToPlayer: false });
                } : undefined)
                : undefined;
            setStatusMsg(retryPlay ? {
                ...said,
                actionLabel: t('ui.retry'),
                onAction: () => {
                    setStatusMsg(null);
                    if (isFailedPlaybackCurrent()) retryPlay();
                },
            } : said);
            tell(false);
            return;
        }

        const nextSkipCount = skipCount + 1;
        showTimedSkipPrompt(said, () => {
            playbackAutoSkipCountRef.current = nextSkipCount;
            // The newest handleNextTrack: the queue as it is when the skip comes, edits made meanwhile kept.
            void latestQueueActionsRef.current.handleNextTrack({
                allowStopOnMissing: true,
                shouldNavigateToPlayer: false,
                unavailableSkipCount: nextSkipCount,
                // The track that failed is the one on the active deck, which mid-blend is NOT the
                // one on screen. Skipping from the displayed track would step onto the broken one.
                fromSong: currentSong ?? undefined,
            });
        }, shown && stopsPlayback(shown) ? () => { if (isFailedPlaybackCurrent()) stopHere(shown); } : undefined);
        tell(true);
    }, [audioRef, clearPendingUnavailableSkip, currentSong, isFmMode, loopMode, playQueue, playbackAutoSkipCountRef, setPlayerState, shouldAutoPlayRef, showTimedSkipPrompt, t]);

    const buildStageQueueOperationSnapshot = useCallback((
        nextCurrentSong: SongResult | null,
        nextQueue: SongResult[],
    ): StagePlayerSnapshot => {
        const neighbors = resolvePlaybackNeighbors({
            playQueue: nextQueue,
            currentSong: nextCurrentSong,
            loopMode,
            isFmMode,
            isStageActive: isNowPlayingStageActive,
        });
        const audioElement = audioRef.current;
        const audioCurrentTimeSec = playbackPosition(audioElement);
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
            canGoPrevious: neighbors.prev.canGo,
            canGoNext: neighbors.next.canGo,
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
            const targetIndex = queueIndexOf(nextQueue, song);
            if (targetIndex < 0 || targetIndex > workingQueue.length) {
                return buildReloadQueueDiffDraft();
            }

            const currentIndex = queueIndexOf(workingQueue, song);
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
                error: errorMessage(error),
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
                error: ok ? null : errorMessage(error),
                result,
                snapshot,
            });
        };

        // The adds below wait for the songs' details: a whole-queue write during that wait is not undone.
        const queueWritesAtStart = wholeQueueWritesSoFar();
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
                // Its diff is reckoned against `baseQueue`, so it fails rather than add to the queue of now.
                if (wholeQueueWritesSoFar() !== queueWritesAtStart) {
                    throw new Error('The queue changed while the request was loading.');
                }
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
            // An edit in place on the stage (move / remove), as one in the app (createQueueMutations): where
            // the songs around the one playing changed, they are fetched ahead again.
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
        if (!playQueue || !canShuffleQueue(playQueue.length, isFmMode, isNowPlayingStageActive)) return;

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
    }, [audioQuality, currentSong, isFmMode, isNowPlayingStageActive, playQueue, setPlayQueue, setStatusMsg, t, userId]);

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
