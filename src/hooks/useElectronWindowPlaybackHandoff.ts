import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { restorePlaybackSourceForSong } from '../components/app/playback/restorePlaybackSource';
import { PlayerState } from '../types';
import type { LyricData, SongResult, StageSource, StageStatus, StatusMessage } from '../types';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { isStagePlaybackSong } from '../utils/appPlaybackGuards';
import type {
    PlaybackSnapshot,
    StageLyricsClockState,
    WindowPlaybackHandoff,
} from '../types/appPlayback';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';
import { setActivePlaybackContext, setAudioSrc, setCachedCoverUrl, setCurrentLineIndex, setCurrentSong, setDuration, setIsFmMode, setPlayQueue, setPlayerState } from '../stores/usePlaybackStore';
import { useStableActionSurface } from './useStableCallbacks';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useAppViewStore } from '../stores/useAppViewStore';
import { useAppChromeStore } from '../stores/useAppChromeStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { currentTime } from '../stores/motionSignals';
import { untransformedLyrics } from '../services/hostExtensionHooks';

// src/hooks/useElectronWindowPlaybackHandoff.ts
// Captures and restores renderer playback state across Electron BrowserWindow rebuilds.

// Snapshots cross IPC, so transformed lyrics arrive as a new object the new window's pipeline
// cannot recognise and would transform again. Hand off the pre-transform lyrics instead; the
// restore goes through setLyrics, which applies the extension transform once. Without an
// extension transform in play this returns the snapshot unchanged.
const withUntransformedLyrics = <Snapshot extends PlaybackSnapshot | null>(snapshot: Snapshot): Snapshot => {
    if (!snapshot) return snapshot;
    const lyrics = untransformedLyrics(snapshot.lyrics);
    return lyrics === snapshot.lyrics ? snapshot : { ...snapshot, lyrics };
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
    currentTime: audioRef.current?.currentTime ?? currentTime.get(),
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

    const captureWindowPlaybackHandoff = useCallback((): WindowPlaybackHandoff => {
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
            playerState,
        }));
        const mainPlayback = activePlaybackContext === 'main'
            ? activePlayback
            : withUntransformedLyrics(mainPlaybackSnapshotRef.current);

        return {
            version: 1,
            capturedAt: Date.now(),
            activePlaybackContext,
            mainPlayback,
            activePlayback,
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

    const restoreMainPlaybackSnapshot = useCallback(async (snapshot: PlaybackSnapshot | null) => {
        mainPlaybackSnapshotRef.current = snapshot;
        if (!snapshot?.currentSong) {
            pendingResumeTimeRef.current = null;
            shouldAutoPlayRef.current = false;
            lastAudioRecoverySourceRef.current = null;
            currentOnlineAudioUrlFetchedAtRef.current = null;
            setCurrentSong(null);
            setLyrics(null);
            setCachedCoverUrl(null);
            setAudioSrc(null);
            setPlayQueue([]);
            setIsFmMode(false);
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
        setCurrentSong(snapshot.currentSong);
        setLyrics(snapshot.lyrics);
        setCachedCoverUrl(snapshot.cachedCoverUrl);
        setAudioSrc(null);
        setPlayQueue(restoredQueue);
        setIsFmMode(snapshot.isFmMode);
        setIsLyricsLoading(false);
        setPlayerState(snapshot.playerState);
        setCurrentLineIndex(snapshot.currentLineIndex);
        currentTime.set(Math.max(0, snapshot.currentTime));
        setDuration(snapshot.duration);

        if (isStagePlaybackSong(snapshot.currentSong)) {
            if (snapshot.audioSrc && !snapshot.audioSrc.startsWith('blob:')) {
                setAudioSrc(snapshot.audioSrc);
            }
            return;
        }

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
        }).catch((error) => {
            console.warn('[Electron] Failed to restore window playback handoff source', error);
            return false;
        });

        if (!restored && snapshot.audioSrc && !snapshot.audioSrc.startsWith('blob:')) {
            setAudioSrc(snapshot.audioSrc);
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
        setCurrentSong,
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
            await restoreStagePlaybackHandoff(handoff);
            return true;
        }

        setActivePlaybackContext('main');
        await restoreMainPlaybackSnapshot(handoff.mainPlayback ?? handoff.activePlayback);
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
            const applied = await window.electron.setWindowTransparentMode(enabled, handoff);
            // Main refuses the enable toggle when the current desktop cannot present a
            // transparent wallpaper window (classic Windows wallpaper mode); keep the old state.
            if (applied === false) {
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
