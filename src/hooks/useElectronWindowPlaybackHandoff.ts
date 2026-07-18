import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { restorePlaybackSourceForSong } from '../components/app/playback/restorePlaybackSource';
import { PlayerState } from '../types';
import type { LyricData, SongResult, StageSource, StageStatus, StatusMessage } from '../types';
import type { AudioQualityPreference } from '../types/onlineMusic';
import type { ThemeCacheSongKey } from '../services/themeCache';
import { isStagePlaybackSong } from '../utils/appPlaybackGuards';
import type {
    PlaybackSnapshot,
    StageLyricsClockState,
    WindowPlaybackHandoff,
} from '../types/appPlayback';

// src/hooks/useElectronWindowPlaybackHandoff.ts
// Captures and restores renderer playback state across Electron BrowserWindow rebuilds.

type SetState<T> = Dispatch<SetStateAction<T>>;
export type WindowPlaybackHandoffRestoreStatus = 'checking' | 'none' | 'restored';

type UseElectronWindowPlaybackHandoffParams = {
    isElectronWindow: boolean;
    audioQuality: AudioQualityPreference;
    userId?: number;
    activePlaybackContext: 'main' | 'stage';
    setActivePlaybackContext: SetState<'main' | 'stage'>;
    currentView: 'home' | 'player';
    navigateToPlayer: () => void;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    cachedCoverUrl: string | null;
    audioSrc: string | null;
    playQueue: SongResult[];
    isFmMode: boolean;
    playerState: PlayerState;
    duration: number;
    currentLineIndex: number;
    currentTime: MotionValue<number>;
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
    setCurrentSong: SetState<SongResult | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setPlayQueue: SetState<SongResult[]>;
    setIsFmMode: SetState<boolean>;
    setIsLyricsLoading: SetState<boolean>;
    setPlayerState: SetState<PlayerState>;
    setCurrentLineIndex: SetState<number>;
    setDuration: SetState<number>;
    setStatusMsg: SetState<StatusMessage | null>;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    isPlayerChromeHidden: boolean;
    setIsPlayerChromeHidden: SetState<boolean>;
    showTransparentWindowBorder: boolean;
    setShowTransparentWindowBorder: SetState<boolean>;
    transparentPlayerBackground: boolean;
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
}: Pick<
    UseElectronWindowPlaybackHandoffParams,
    | 'audioRef'
    | 'audioSrc'
    | 'cachedCoverUrl'
    | 'currentLineIndex'
    | 'currentSong'
    | 'currentTime'
    | 'duration'
    | 'isFmMode'
    | 'lyrics'
    | 'playQueue'
    | 'playerState'
>): PlaybackSnapshot => ({
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
    audioQuality,
    userId,
    activePlaybackContext,
    setActivePlaybackContext,
    currentView,
    navigateToPlayer,
    currentSong,
    lyrics,
    cachedCoverUrl,
    audioSrc,
    playQueue,
    isFmMode,
    playerState,
    duration,
    currentLineIndex,
    currentTime,
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
    setCurrentSong,
    setLyrics,
    setCachedCoverUrl,
    setAudioSrc,
    setPlayQueue,
    setIsFmMode,
    setIsLyricsLoading,
    setPlayerState,
    setCurrentLineIndex,
    setDuration,
    setStatusMsg,
    blobUrlRef,
    shouldAutoPlayRef,
    pendingResumeTimeRef,
    lastAudioRecoverySourceRef,
    currentOnlineAudioUrlFetchedAtRef,
    isPlayerChromeHidden,
    setIsPlayerChromeHidden,
    showTransparentWindowBorder,
    setShowTransparentWindowBorder,
    transparentPlayerBackground,
    applyTransparentPlayerBackground,
    restoreCachedThemeForSong,
    persistLastPlaybackCache,
}: UseElectronWindowPlaybackHandoffParams) {
    const [restoreStatus, setRestoreStatus] = useState<WindowPlaybackHandoffRestoreStatus>(() => (
        isElectronWindow && window.electron?.consumeWindowPlaybackHandoff ? 'checking' : 'none'
    ));
    const consumeHandoffPromiseRef = useRef<Promise<WindowPlaybackHandoff | null> | null>(null);
    const hasCompletedRestoreCheckRef = useRef(false);
    const isRestoringHandoffRef = useRef(false);
    const restoreWindowPlaybackHandoffRef = useRef<((handoff: WindowPlaybackHandoff) => Promise<boolean>) | null>(null);

    const captureWindowPlaybackHandoff = useCallback((): WindowPlaybackHandoff => {
        const activePlayback = buildPlaybackSnapshot({
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
        });
        const mainPlayback = activePlaybackContext === 'main'
            ? activePlayback
            : mainPlaybackSnapshotRef.current;

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
            setCurrentSong,
            setCachedCoverUrl,
            setAudioSrc,
            setLyrics,
            setStatusMsg,
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
            await window.electron.setWindowTransparentMode(enabled, handoff);
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

    return {
        captureWindowPlaybackHandoff,
        restoreStatus,
        toggleTransparentModeWithHandoff,
    };
}
