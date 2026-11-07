import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { restorePlaybackSourceForSong, type RestorePlaybackSourceOutcome } from './restorePlaybackSource';
import { PlayerState } from '../../../../types';
import type { LyricData, SongResult, StageSource, StageStatus, StatusMessage } from '../../../../types';
import type { AudioQualityPreference, MediaId } from '../../../../types/onlineMusic';
import type { ThemeCacheSongKey } from '../../../../services/themeCache';
import { getOnlineProviderIdForSong, getPlaybackSongKey, isStagePlaybackSong } from '../../../../utils/appPlaybackGuards';
import type {
    PlaybackSnapshot,
    StageLyricsClockState,
    WindowPlaybackHandoff,
} from '../../../../types/appPlayback';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { setActivePlaybackContext, setAudioSrc, setCachedCoverUrl, setCurrentLineIndex, setDuration, setIsFmMode, setPlayQueue, setPlayerState } from '../../../../stores/usePlaybackStore';
import { askedSongKeyRef, makeSongCurrent, startRestore } from '../currentSong';
import { useStableActionSurface } from '../../../../hooks/useStableCallbacks';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { captureActiveStations, restoreActiveStations } from '../../../../stores/usePersonalFmModeStore';
import { useAppViewStore } from '../../../../stores/useAppViewStore';
import { useAppChromeStore } from '../../../../stores/useAppChromeStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { currentTime } from '../../../../stores/motionSignals';
import { untransformedLyrics } from '../../../../services/hostExtensionHooks';
import { lyricsBeforeRules } from '../../../../utils/lyrics/lyricLineRules';
import { reportYieldedQueue, wholeQueueWritesSoFar } from '../../../../services/wholeQueueWrites';
import { getHifiPosition, installHifiPlayback, isHifiRoute, releaseUnclaimedHifiTrack } from '../../../../services/hifi/hifiPlayback';
import { adoptExternalPlayback, getExternalPosition, getExternalSong, handOverExternalPlayback, isExternalPlaybackSounding, isExternalRoute, pauseExternalPlayback, reclaimExternalPlayback, releaseUnclaimedExternalTrack } from '../../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../../services/onlineMusic/omni';
import { hifiEngine } from '../../../../services/hifi/hifiEngine';

// src/components/app/playback/restore/useElectronWindowPlaybackHandoff.ts
// Captures and restores renderer playback state across Electron BrowserWindow rebuilds. The players
// outside the renderer (mpv, a provider's own player) outlive the window: the snapshot records them
// as they are, and the new window takes the running track over rather than starting it again.

// Snapshots cross IPC, so the lyrics on screen arrive as a new object the new window's pipeline
// cannot recognise and would transform and filter again. Hand off the lyrics as they were before
// the extension transform and the line rules instead; the restore goes through setLyrics, which
// applies both once.
export const withUntransformedLyrics = <Snapshot extends PlaybackSnapshot | null>(snapshot: Snapshot): Snapshot => {
    if (!snapshot) return snapshot;
    const lyrics = lyricsBeforeRules(untransformedLyrics(snapshot.lyrics));
    return lyrics === snapshot.lyrics ? snapshot : { ...snapshot, lyrics };
};

/**
 * Nothing the old window played is restored here, so a track it left playing in mpv is nobody's now:
 * stopped. The hand-off is asked for before this window's first look at mpv (the HiFi bridge, which
 * takes that look, mounts further down in App), and the main process answers in order: a snapshot asked
 * for after that look comes back after it, once the track the old window left is known.
 */
const releaseTrackLeftInMpv = async () => {
    installHifiPlayback();
    await hifiEngine.getSnapshot();
    releaseUnclaimedHifiTrack('nothing to restore');
};

type SetState<T> = Dispatch<SetStateAction<T>>;
export type WindowPlaybackHandoffRestoreStatus = 'checking' | 'none' | 'restored';

type UseElectronWindowPlaybackHandoffParams = {

    isElectronWindow: boolean;
    userId?: MediaId;
    navigateToPlayer: () => void;
    audioRef: RefObject<HTMLAudioElement | null>;
    mainPlaybackSnapshotRef: MutableRefObject<PlaybackSnapshot | null>;
    stageStatus: StageStatus | null;
    stageSource: StageSource | null;
    stageLyricsClockRef: MutableRefObject<StageLyricsClockState>;
    nowPlayingTrack: WindowPlaybackHandoff['nowPlaying']['track'];
    nowPlayingLyricPayload: WindowPlaybackHandoff['nowPlaying']['lyricPayload'];
    nowPlayingPaused: boolean;
    nowPlayingProgressMs: number;
    nowPlayingProgressQuality: 'precise' | 'coarse';
    getNowPlayingDisplayTime: () => number;
    restoreStagePlaybackHandoff: (handoff: WindowPlaybackHandoff) => Promise<void>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setIsLyricsLoading: SetState<boolean>;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    applyTransparentPlayerBackground: (enabled: boolean) => void;
    restoreCachedThemeForSong: (songId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
};

const buildPlaybackSnapshot = ({
    audioRef,
    audioSrc,
    cachedCoverUrl,
    currentLineIndex,
    currentSong,
    currentTime,
    duration,
    isFmMode,
    lyrics,
    playQueue,
    playerState,
// Spelled out rather than Pick<Params, ...>: the playback fields are read from the store inside the
// hook now, so they are no longer part of its parameter type.
}: Omit<PlaybackSnapshot, 'currentTime'> & {
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    /** The signal, not a value: the snapshot resolves it to a number on the way out. */
    currentTime: MotionValue<number>;
}): PlaybackSnapshot => ({
    currentSong,
    lyrics,
    cachedCoverUrl,
    audioSrc,
    playQueue,
    isFmMode,
    playerState,
    // On the HiFi route <audio> sits idle: the position is mpv's, as its clock reads it now.
    // The external player's clock answers for itself the same way.
    currentTime: isHifiRoute() ? getHifiPosition() : isExternalPlaybackSounding() ? getExternalPosition() : (audioRef.current?.currentTime ?? currentTime.get()),
    duration,
    currentLineIndex,
});

export function useElectronWindowPlaybackHandoff({
    isElectronWindow,
    userId,
    navigateToPlayer,
    audioRef,
    mainPlaybackSnapshotRef,
    stageStatus,
    stageSource,
    stageLyricsClockRef,
    nowPlayingTrack,
    nowPlayingLyricPayload,
    nowPlayingPaused,
    nowPlayingProgressMs,
    nowPlayingProgressQuality,
    getNowPlayingDisplayTime,
    restoreStagePlaybackHandoff,
    setLyrics,
    setIsLyricsLoading,
    blobUrlRef,
    shouldAutoPlayRef,
    pendingResumeTimeRef,
    lastAudioRecoverySourceRef,
    currentOnlineAudioUrlFetchedAtRef,
    applyTransparentPlayerBackground,
    restoreCachedThemeForSong,
    persistLastPlaybackCache,
}: UseElectronWindowPlaybackHandoffParams) {
    // Read here rather than passed in: all store fields or a module-level motion signal.
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const currentView = useAppViewStore(state => state.view);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const cachedCoverUrl = usePlaybackStore(state => state.cachedCoverUrl);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);
    const currentLineIndex = usePlaybackStore(state => state.currentLineIndex);
    const isPlayerChromeHidden = useAppChromeStore(state => state.isPlayerChromeHidden);
    const setIsPlayerChromeHidden = useAppChromeStore(state => state.setIsPlayerChromeHidden);
    const showTransparentWindowBorder = useAppChromeStore(state => state.showTransparentWindowBorder);
    const setShowTransparentWindowBorder = useAppChromeStore(state => state.setShowTransparentWindowBorder);
    const transparentPlayerBackground = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground);

    const [restoreStatus, setRestoreStatus] = useState<WindowPlaybackHandoffRestoreStatus>(() => (
        isElectronWindow && window.electron?.consumeWindowPlaybackHandoff ? 'checking' : 'none'
    ));
    const consumeHandoffPromiseRef = useRef<Promise<WindowPlaybackHandoff | null> | null>(null);
    const hasCompletedRestoreCheckRef = useRef(false);
    const isRestoringHandoffRef = useRef(false);
    const restoreWindowPlaybackHandoffRef = useRef<((handoff: WindowPlaybackHandoff) => Promise<boolean>) | null>(null);
    // The whole-queue writes when the handoff began to be read. A mod that replaced the queue in this new
    // window meanwhile (from its `activate`) keeps its queue, and the FM it ended, over the late handoff's.
    const handoffQueueWritesRef = useRef<number | null>(null);

    const captureWindowPlaybackHandoff = useCallback((): WindowPlaybackHandoff => {
        // The provider's player keeps sounding through the rebuild (its process is the main
        // process's, not this window's): the snapshot says playing, and the next window adopts it.
        // This window stops following the player once the snapshot is taken: a track ending in the
        // second or two before it is destroyed must not start the next song from here.
        // Only the song the snapshot names is handed over. A start still on its way (the song on
        // screen is the one before it) is one the next window knows nothing of: the player is
        // stopped, and the snapshot reads the state that leaves.
        const externalSong = getExternalSong();
        const handsOverExternal = isExternalPlaybackSounding() && externalSong !== null && currentSong !== null
            && getPlaybackSongKey(externalSong) === getPlaybackSongKey(currentSong);
        if (isExternalRoute() && !handsOverExternal) pauseExternalPlayback();
        const activePlayback = withUntransformedLyrics(buildPlaybackSnapshot({
            audioRef,
            audioSrc,
            cachedCoverUrl,
            currentLineIndex,
            currentSong,
            currentTime,
            duration,
            isFmMode,
            lyrics,
            playQueue,
            playerState: isExternalRoute() && !handsOverExternal ? usePlaybackStore.getState().playerState : playerState,
        }));
        if (handsOverExternal) handOverExternalPlayback();
        const mainPlayback = activePlaybackContext === 'main'
            ? activePlayback
            : withUntransformedLyrics(mainPlaybackSnapshotRef.current);

        return {
            version: 1,
            capturedAt: Date.now(),
            activePlaybackContext,
            mainPlayback,
            activePlayback,
            // Which extra radio the FM queue came from, so the new window tops it up from the same one.
            ...(mainPlayback?.isFmMode ? { fmStations: captureActiveStations(getOnlineProviderIdForSong(mainPlayback.currentSong)) } : {}),
            stage: {
                status: stageStatus,
                source: stageSource,
                playback: activePlaybackContext === 'stage' ? activePlayback : null,
                lyricsClock: { ...stageLyricsClockRef.current },
            },
            nowPlaying: {
                track: nowPlayingTrack,
                lyricPayload: nowPlayingLyricPayload,
                paused: nowPlayingPaused,
                progressMs: Math.max(0, nowPlayingProgressMs),
                progressQuality: nowPlayingProgressQuality,
                displayTimeSec: getNowPlayingDisplayTime(),
            },
            ui: {
                currentView,
                playerChromeHidden: isPlayerChromeHidden,
                mainWindowBorderVisible: showTransparentWindowBorder,
                transparentModeEnabled: transparentPlayerBackground,
            },
        };
    }, [
        activePlaybackContext,
        audioRef,
        audioSrc,
        cachedCoverUrl,
        currentLineIndex,
        currentSong,
        currentTime,
        currentView,
        duration,
        getNowPlayingDisplayTime,
        isFmMode,
        isPlayerChromeHidden,
        lyrics,
        mainPlaybackSnapshotRef,
        nowPlayingLyricPayload,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        nowPlayingTrack,
        playQueue,
        playerState,
        showTransparentWindowBorder,
        stageLyricsClockRef,
        stageSource,
        stageStatus,
        transparentPlayerBackground,
    ]);

    const restoreMainPlaybackSnapshot = useCallback(async (snapshot: PlaybackSnapshot | null, fmStations?: unknown) => {
        mainPlaybackSnapshotRef.current = snapshot;
        // A song asked for in the new window while the handoff was being read stands.
        if (askedSongKeyRef.current !== null) {
            void releaseTrackLeftInMpv();
            if (snapshot?.currentSong) releaseUnclaimedExternalTrack(snapshot.currentSong, 'another song was asked for');
            return;
        }
        const queueWritesAtStart = handoffQueueWritesRef.current ?? undefined;
        const queueRewritten = queueWritesAtStart !== undefined && wholeQueueWritesSoFar() !== queueWritesAtStart;
        if (!snapshot?.currentSong) {
            void releaseTrackLeftInMpv();
            pendingResumeTimeRef.current = null;
            shouldAutoPlayRef.current = false;
            lastAudioRecoverySourceRef.current = null;
            currentOnlineAudioUrlFetchedAtRef.current = null;
            makeSongCurrent(null);
            setLyrics(null);
            setCachedCoverUrl(null);
            setAudioSrc(null);
            if (!queueRewritten) {
                setPlayQueue([]);
                setIsFmMode(false);
            } else {
                // The old window's empty queue is the listener's: the replacement's undo puts it back.
                reportYieldedQueue({ queue: [], isFmMode: false, song: null });
            }
            setIsLyricsLoading(false);
            setPlayerState(PlayerState.IDLE);
            setCurrentLineIndex(-1);
            currentTime.set(0);
            setDuration(0);
            return;
        }

        const restoredQueue = snapshot.playQueue.length > 0 ? snapshot.playQueue : [snapshot.currentSong];
        pendingResumeTimeRef.current = Math.max(0, snapshot.currentTime);
        shouldAutoPlayRef.current = snapshot.playerState === PlayerState.PLAYING;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;
        makeSongCurrent(snapshot.currentSong);
        const stillWanted = startRestore();
        setLyrics(snapshot.lyrics);
        setCachedCoverUrl(snapshot.cachedCoverUrl);
        setAudioSrc(null);
        if (!queueRewritten) {
            setPlayQueue(restoredQueue);
            setIsFmMode(snapshot.isFmMode);
            if (snapshot.isFmMode) restoreActiveStations(fmStations);
        } else {
            // Saved again now that a song is current, as the session restore does: the replacement's own save
            // found none, so it kept nothing, and the source's restore saves only on some of its paths.
            void persistLastPlaybackCache(snapshot.currentSong, usePlaybackStore.getState().playQueue);
            // The handed-over queue and FM are the listener's: the replacement's undo puts them back.
            reportYieldedQueue({ queue: restoredQueue, isFmMode: snapshot.isFmMode, song: snapshot.currentSong });
        }
        setIsLyricsLoading(false);
        setPlayerState(snapshot.playerState);
        setCurrentLineIndex(snapshot.currentLineIndex);
        currentTime.set(Math.max(0, snapshot.currentTime));
        setDuration(snapshot.duration);

        if (isStagePlaybackSong(snapshot.currentSong)) {
            // A Stage song never plays through mpv.
            void releaseTrackLeftInMpv();
            if (snapshot.audioSrc && !snapshot.audioSrc.startsWith('blob:')) {
                setAudioSrc(snapshot.audioSrc);
            }
            return;
        }

        // The snapshot URL was playing moments ago: falling back to it beats seconds of silence spent on retries.
        const fallbackAudioSrc = snapshot.audioSrc && !snapshot.audioSrc.startsWith('blob:') ? snapshot.audioSrc : null;
        const restored = await restorePlaybackSourceForSong(snapshot.currentSong, {
            audioQuality,
            userId,
            blobUrlRef,
            currentOnlineAudioUrlFetchedAtRef,
            setPlayQueue,
            setLyrics,
            restoreCachedThemeForSong,
            persistLastPlaybackCache,
            queue: restoredQueue,
            stillWanted,
            hasFallbackSource: fallbackAudioSrc !== null,
            queueWritesAtStart,
            pendingResumeTimeRef,
        }).catch((error): RestorePlaybackSourceOutcome => {
            console.warn('[Electron] Failed to restore window playback handoff source', error);
            return 'failed';
        });

        // The old window's address is the fallback of a restore that failed, for the handed-over song
        // only: not for a restore that was overtaken, nor for a song that was asked for while its source
        // was being fetched again, another one or this same one.
        const stillThatSong = stillWanted() && askedSongKeyRef.current === getPlaybackSongKey(snapshot.currentSong);
        if (restored === 'failed' && stillThatSong && fallbackAudioSrc) {
            setAudioSrc(fallbackAudioSrc);
        }
        // A provider's own player kept sounding the song through the rebuild: take it over as it
        // stands. With another track or none there, the player is stopped (as mpv's track is
        // released above when nothing restores it), the song is shown paused, and the play path
        // starts it when the listener asks.
        if (!omni.canPlayExternally(snapshot.currentSong)) return;
        if (restored === 'restored' && stillThatSong) {
            // Nothing of this window starts the player by itself; the adoption says whether it plays.
            shouldAutoPlayRef.current = false;
            if (await adoptExternalPlayback(snapshot.currentSong)) return;
            releaseUnclaimedExternalTrack(snapshot.currentSong, 'not taken over');
        } else {
            releaseUnclaimedExternalTrack(snapshot.currentSong, stillThatSong ? `restore ${restored}` : 'the restore was overtaken');
            // A failed restore fell back to the old window's address above: that source plays it.
            if (fallbackAudioSrc) return;
        }
        // The snapshot said playing; nothing here sounds the song now. A song asked for meanwhile
        // keeps the state its own play gives it.
        if (stillWanted() && askedSongKeyRef.current === getPlaybackSongKey(snapshot.currentSong)) {
            shouldAutoPlayRef.current = false;
            if (usePlaybackStore.getState().playerState === PlayerState.PLAYING) setPlayerState(PlayerState.PAUSED);
        }
    }, [
        audioQuality,
        blobUrlRef,
        currentOnlineAudioUrlFetchedAtRef,
        currentTime,
        lastAudioRecoverySourceRef,
        mainPlaybackSnapshotRef,
        pendingResumeTimeRef,
        persistLastPlaybackCache,
        restoreCachedThemeForSong,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        setStatusMsg,
        shouldAutoPlayRef,
        userId,
    ]);

    const restoreWindowPlaybackHandoff = useCallback(async (handoff: WindowPlaybackHandoff) => {
        if (!handoff || handoff.version !== 1) {
            return false;
        }

        setIsPlayerChromeHidden(handoff.ui.playerChromeHidden);
        setShowTransparentWindowBorder(handoff.ui.mainWindowBorderVisible);
        if (handoff.ui.currentView === 'player') {
            navigateToPlayer();
        }

        if (handoff.activePlaybackContext === 'stage') {
            mainPlaybackSnapshotRef.current = handoff.mainPlayback;
            if (handoff.mainPlayback?.isFmMode) restoreActiveStations(handoff.fmStations);
            // The Stage plays on the Web engine, and the main song waits in the snapshot until it ends:
            // a track the old window left playing in mpv is stopped before the Stage sounds.
            await releaseTrackLeftInMpv();
            await restoreStagePlaybackHandoff(handoff);
            return true;
        }

        setActivePlaybackContext('main');
        await restoreMainPlaybackSnapshot(handoff.mainPlayback ?? handoff.activePlayback, handoff.fmStations);
        return true;
    }, [
        mainPlaybackSnapshotRef,
        navigateToPlayer,
        restoreMainPlaybackSnapshot,
        restoreStagePlaybackHandoff,
        setActivePlaybackContext,
        setIsPlayerChromeHidden,
        setShowTransparentWindowBorder,
    ]);
    restoreWindowPlaybackHandoffRef.current = restoreWindowPlaybackHandoff;

    const toggleTransparentModeWithHandoff = useCallback(async (enabled: boolean) => {
        if (isElectronWindow && window.electron?.setWindowTransparentMode) {
            const handoff = captureWindowPlaybackHandoff();
            let applied: boolean;
            try {
                applied = await window.electron.setWindowTransparentMode(enabled, handoff);
            } catch (error) {
                // No rebuild: this window keeps the player it handed over.
                reclaimExternalPlayback('the rebuild failed');
                throw error;
            }
            // Main refuses the enable toggle when the current desktop cannot present a
            // transparent wallpaper window (classic Windows wallpaper mode); keep the old state.
            if (applied === false) {
                reclaimExternalPlayback('the rebuild was refused');
                return;
            }
        }
        applyTransparentPlayerBackground(enabled);
    }, [applyTransparentPlayerBackground, captureWindowPlaybackHandoff, isElectronWindow]);

    useEffect(() => {
        if (!isElectronWindow || !window.electron?.onWindowPlaybackHandoffRequested || !window.electron?.submitWindowPlaybackHandoff) {
            return;
        }

        return window.electron.onWindowPlaybackHandoffRequested(({ requestId }) => {
            void window.electron?.submitWindowPlaybackHandoff(requestId, captureWindowPlaybackHandoff());
        });
    }, [captureWindowPlaybackHandoff, isElectronWindow]);

    useEffect(() => {
        if (!isElectronWindow || !window.electron?.consumeWindowPlaybackHandoff) {
            setRestoreStatus('none');
            return;
        }

        if (hasCompletedRestoreCheckRef.current || isRestoringHandoffRef.current) {
            return;
        }

        isRestoringHandoffRef.current = true;

        if (!consumeHandoffPromiseRef.current) {
            handoffQueueWritesRef.current = wholeQueueWritesSoFar();
            consumeHandoffPromiseRef.current = window.electron.consumeWindowPlaybackHandoff();
        }

        const consumeHandoff = async () => {
            try {
                const handoff = await consumeHandoffPromiseRef.current;

                if (!handoff) {
                    hasCompletedRestoreCheckRef.current = true;
                    isRestoringHandoffRef.current = false;
                    setRestoreStatus('none');
                    return;
                }

                const restored = await restoreWindowPlaybackHandoffRef.current?.(handoff) ?? false;
                hasCompletedRestoreCheckRef.current = true;
                isRestoringHandoffRef.current = false;
                setRestoreStatus(restored ? 'restored' : 'none');
            } catch (error) {
                console.warn('[Electron] Failed to consume window playback handoff', error);
                hasCompletedRestoreCheckRef.current = true;
                isRestoringHandoffRef.current = false;
                setRestoreStatus('none');
            }
        };

        void consumeHandoff();
    }, [isElectronWindow]);

    // Stable identity: both are invoked from events, and their churn reached buildPlayerPanelModel.
    return useStableActionSurface({
        captureWindowPlaybackHandoff,
        restoreStatus,
        toggleTransparentModeWithHandoff,
    });
}
