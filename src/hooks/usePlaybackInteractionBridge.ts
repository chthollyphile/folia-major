import { useCallback, useEffect } from 'react';
import type React from 'react';
import type { MotionValue } from 'framer-motion';
import { omni } from '../services/onlineMusic/omni';
import { PlayerState } from '../types';
import type { ReplayGainMode, SongResult, StageLoopMode, StatusMessage } from '../types';
import { getReplayGainModeLabel } from '../utils/appPlaybackHelpers';

// src/hooks/usePlaybackInteractionBridge.ts

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');

type PlayerEscapeAction = 'ignore' | 'allow-fullscreen-exit' | 'close-panel' | 'navigate-back';

export const resolvePlayerEscapeAction = ({
    currentView,
    hasBlockingWindow,
    isFullscreen,
    isPanelOpen,
    isRepeat,
}: {
    currentView: string;
    hasBlockingWindow: boolean;
    isFullscreen: boolean;
    isPanelOpen: boolean;
    isRepeat: boolean;
}): PlayerEscapeAction => {
    if (currentView !== 'player' || hasBlockingWindow || isRepeat) return 'ignore';
    if (isFullscreen) return 'allow-fullscreen-exit';
    return isPanelOpen ? 'close-panel' : 'navigate-back';
};

type UsePlaybackInteractionBridgeParams = {
    currentSong: SongResult | null;
    currentView: string;
    audioSrc: string | null;
    activePlaybackContext: 'main' | 'stage';
    stageActiveEntryKind: string | null;
    isNowPlayingStageActive: boolean;
    isPanelOpen: boolean;
    isFmMode: boolean;
    playerState: PlayerState;
    duration: number;
    currentTime: MotionValue<number>;
    audioRef: React.RefObject<HTMLAudioElement | null>;
    /**
     * Whether an automix blend is sounding, which settles play-vs-pause on its own.
     *
     * `audioRef` is the ACTIVE deck, and mid-blend that is the track ARRIVING - silent for the whole
     * lead while it loads, and `ended` on the outgoing deck by the tail end of the fade. Either way
     * the element reads "not playing", so pressing pause was taken for "start it": the blend was
     * dropped and the next song jumped straight in. There is no such thing as a paused blend to
     * toggle out of - every pause path cancels one - so an audible blend can only mean pause.
     */
    isTransitionAudible?: () => boolean;
    /**
     * Takes a seek that lands during a blend, returning true when it did.
     *
     * Mid-blend `audioRef` is the incoming deck: writing to it moves a track the listener cannot
     * hear yet, while the bar they are watching belongs to the outgoing one. The same port the
     * progress bar and the remote use, so all three land on the same deck. Returns false outside a
     * blend, and the ordinary write below runs - deliberately not the bar's whole seek, which
     * resumes a paused deck; an arrow key on a paused track has always left it paused.
     */
    seekDuringTransition?: (time: number) => boolean;
    stageLyricsClockRef: React.MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    setIsDevDebugOverlayVisible: React.Dispatch<React.SetStateAction<boolean>>;
    setIsMemoryMonitorVisible: React.Dispatch<React.SetStateAction<boolean>>;
    cyclePlayerChromeVisibilityMode: () => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setReplayGainMode: React.Dispatch<React.SetStateAction<ReplayGainMode>>;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    handleNextTrack: () => Promise<void> | void;
    handlePrevTrack: () => void;
    handleToggleLoopMode: () => void;
    navigateBackFromPlayer: () => void;
    pausePlayback: () => void;
    resumePlayback: () => Promise<void>;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
};

// Bridges playback-related keyboard and click interactions without leaving them inline in App.tsx.
export function usePlaybackInteractionBridge({
    currentSong,
    currentView,
    audioSrc,
    activePlaybackContext,
    stageActiveEntryKind,
    isNowPlayingStageActive,
    isPanelOpen,
    isFmMode,
    playerState,
    duration,
    currentTime,
    audioRef,
    isTransitionAudible,
    seekDuringTransition,
    stageLyricsClockRef,
    setIsDevDebugOverlayVisible,
    setIsMemoryMonitorVisible,
    cyclePlayerChromeVisibilityMode,
    setIsPanelOpen,
    setReplayGainMode,
    setStatusMsg,
    handleNextTrack,
    handlePrevTrack,
    handleToggleLoopMode,
    navigateBackFromPlayer,
    pausePlayback,
    resumePlayback,
    syncStageLyricsClock,
}: UsePlaybackInteractionBridgeParams) {
    // resumePlayback rethrows after showing the error toast so awaiting callers can react, but
    // togglePlay is fire-and-forget: without this the rejection escapes as an unhandled promise
    // rejection with no media context. Log the element state that explains why play() failed
    // (expired online stream, ended element with an empty queue, decode error, ...).
    const startPlaybackFromInteraction = useCallback(() => {
        void resumePlayback().catch(error => {
            const audioElement = audioRef.current;
            console.error('[Playback] Resume from interaction failed', {
                error,
                audioSrc,
                songId: currentSong?.id ?? null,
                playerState,
                paused: audioElement?.paused ?? null,
                ended: audioElement?.ended ?? null,
                currentTime: audioElement?.currentTime ?? null,
                duration: audioElement?.duration ?? null,
                readyState: audioElement?.readyState ?? null,
                networkState: audioElement?.networkState ?? null,
                mediaErrorCode: audioElement?.error?.code ?? null,
                mediaErrorMessage: audioElement?.error?.message ?? null,
            });
        });
    }, [audioRef, audioSrc, currentSong, playerState, resumePlayback]);

    const togglePlay = useCallback((event?: React.MouseEvent | KeyboardEvent) => {
        event?.stopPropagation();

        if (isNowPlayingStageActive) {
            return;
        }

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            if (playerState === PlayerState.PLAYING) {
                pausePlayback();
            } else {
                startPlaybackFromInteraction();
            }
            return;
        }

        if (isTransitionAudible?.()) {
            pausePlayback();
            return;
        }

        if (audioRef.current) {
            if (!audioRef.current.paused && !audioRef.current.ended) {
                pausePlayback();
            } else {
                startPlaybackFromInteraction();
            }
        }
    }, [activePlaybackContext, audioRef, audioSrc, isNowPlayingStageActive, isTransitionAudible, pausePlayback, playerState, startPlaybackFromInteraction, stageActiveEntryKind]);

    const toggleLoop = useCallback((event?: React.MouseEvent) => {
        event?.stopPropagation();
        if (isNowPlayingStageActive) {
            return;
        }

        handleToggleLoopMode();
    }, [handleToggleLoopMode, isNowPlayingStageActive]);

    const handleChangeReplayGainMode = useCallback((mode: ReplayGainMode) => {
        setReplayGainMode(mode);
        setStatusMsg({ type: 'info', text: getReplayGainModeLabel(mode) });
    }, [setReplayGainMode, setStatusMsg]);

    const handleContainerClick = useCallback(() => {
        if (isPanelOpen) {
            setIsPanelOpen(false);
        }
    }, [isPanelOpen, setIsPanelOpen]);

    const handleFmTrash = useCallback(async () => {
        if (isNowPlayingStageActive) {
            return;
        }

        if (currentSong && isFmMode) {
            try {
                await omni.dislikeSong(currentSong);
            } catch (error) {
                void error;
            }
            void handleNextTrack();
        }
    }, [currentSong, handleNextTrack, isFmMode, isNowPlayingStageActive]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.target instanceof HTMLInputElement
                || event.target instanceof HTMLTextAreaElement
                || (event.target instanceof HTMLElement && event.target.isContentEditable)
            ) {
                return;
            }

            const hasBlockingWindow = () => Boolean(
                document.querySelector('[data-folia-keyboard-window="true"]')
            );

            // Not gated on dev: the packaged desktop build has no DevTools to fall back on - the
            // window is frameless, so there is no menu to toggle them from and they only open
            // automatically under ELECTRON_DEV. This chord is the only console it has.
            if (event.altKey && event.shiftKey && event.code === 'KeyD') {
                event.preventDefault();
                setIsDevDebugOverlayVisible(prev => !prev);
                return;
            }

            // Its own window rather than a tab of the one above: the two are read together - a heap
            // that is flat while the working set climbs is the whole diagnosis - and a tab makes
            // that comparison impossible.
            if (event.altKey && event.shiftKey && event.code === 'KeyM') {
                event.preventDefault();
                setIsMemoryMonitorVisible(prev => !prev);
                return;
            }

            switch (event.code) {
                case 'Escape': {
                    const action = resolvePlayerEscapeAction({
                        currentView,
                        hasBlockingWindow: hasBlockingWindow(),
                        isFullscreen: Boolean(document.fullscreenElement),
                        isPanelOpen,
                        isRepeat: event.repeat,
                    });
                    if (action === 'ignore' || action === 'allow-fullscreen-exit') return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    if (action === 'close-panel') {
                        setIsPanelOpen(false);
                        return;
                    }
                    navigateBackFromPlayer();
                    break;
                }
                case 'Space':
                    if (currentSong && (audioSrc || isNowPlayingStageActive || (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics'))) {
                        event.preventDefault();
                        if (isNowPlayingStageActive) {
                            return;
                        }
                        togglePlay(event);
                    }
                    break;
                case 'ArrowLeft':
                    const isPrevTrackKey = isMac 
                        ? (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey)
                        : (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey);

                    if (isPrevTrackKey) {
                        if (currentSong) {
                            event.preventDefault();
                            if (isNowPlayingStageActive) {
                                return;
                            }
                            handlePrevTrack();
                        }
                        return;
                    }

                    if (currentView !== 'player') return;
                    event.preventDefault();
                    if (isNowPlayingStageActive) {
                        return;
                    }

                    if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                        const nextTime = Math.max(stageLyricsClockRef.current.startTimeSec, currentTime.get() - 5);
                        syncStageLyricsClock(nextTime, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                        currentTime.set(nextTime);
                    } else {
                        // Off the motion value, not the element: during a blend that value is driven
                        // by the deck on screen, which is the track this key is meant to move.
                        const nextTime = Math.max(0, currentTime.get() - 5);
                        if (!seekDuringTransition?.(nextTime) && audioRef.current) {
                            audioRef.current.currentTime = nextTime;
                        }
                    }
                    break;
                case 'ArrowRight':
                    const isNextTrackKey = isMac 
                        ? (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey)
                        : (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey);

                    if (isNextTrackKey) {
                        if (currentSong) {
                            event.preventDefault();
                            if (isNowPlayingStageActive) {
                                return;
                            }
                            void handleNextTrack();
                        }
                        return;
                    }

                    if (currentView !== 'player') return;
                    event.preventDefault();
                    if (isNowPlayingStageActive) {
                        return;
                    }

                    if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                        const nextTime = Math.min(duration, currentTime.get() + 5);
                        syncStageLyricsClock(nextTime, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                        currentTime.set(nextTime);
                    } else {
                        // `duration` rather than the element's own, for the same reason: mid-blend
                        // the element holds the ARRIVING track's length, and clamping this track's
                        // position against it lands past its end.
                        const nextTime = Math.min(duration || 0, currentTime.get() + 5);
                        if (!seekDuringTransition?.(nextTime) && audioRef.current) {
                            audioRef.current.currentTime = nextTime;
                        }
                    }
                    break;
                case 'KeyH':
                    if (currentView !== 'player' || isPanelOpen || hasBlockingWindow()) return;
                    if (event.ctrlKey || event.altKey || event.metaKey) return;
                    event.preventDefault();
                    cyclePlayerChromeVisibilityMode();
                    break;
                case 'KeyP':
                    if (currentView !== 'player' || hasBlockingWindow()) return;
                    if (event.ctrlKey || event.altKey || event.metaKey) return;
                    event.preventDefault();
                    setIsPanelOpen(prev => !prev);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        activePlaybackContext,
        audioRef,
        audioSrc,
        currentSong,
        currentTime,
        currentView,
        duration,
        handleNextTrack,
        handlePrevTrack,
        isNowPlayingStageActive,
        isPanelOpen,
        navigateBackFromPlayer,
        pausePlayback,
        playerState,
        resumePlayback,
        setIsDevDebugOverlayVisible,
        setIsMemoryMonitorVisible,
        setIsPanelOpen,
        cyclePlayerChromeVisibilityMode,
        seekDuringTransition,
        stageActiveEntryKind,
        stageLyricsClockRef,
        syncStageLyricsClock,
        togglePlay,
    ]);

    return {
        togglePlay,
        toggleLoop,
        handleChangeReplayGainMode,
        handleContainerClick,
        handleFmTrash,
    };
}
