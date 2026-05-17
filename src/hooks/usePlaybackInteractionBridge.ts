import { useCallback, useEffect } from 'react';
import type React from 'react';
import type { MotionValue } from 'framer-motion';
import { neteaseApi } from '../services/netease';
import { PlayerState } from '../types';
import type { ReplayGainMode, SongResult, StageLoopMode, StatusMessage } from '../types';
import { replayGainModeLabels } from '../utils/appPlaybackHelpers';

// src/hooks/usePlaybackInteractionBridge.ts

type UsePlaybackInteractionBridgeParams = {
    isDev: boolean;
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
    stageLyricsClockRef: React.MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    setIsDevDebugOverlayVisible: React.Dispatch<React.SetStateAction<boolean>>;
    setIsPlayerChromeHidden: React.Dispatch<React.SetStateAction<boolean>>;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setReplayGainMode: React.Dispatch<React.SetStateAction<ReplayGainMode>>;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    handleNextTrack: () => Promise<void> | void;
    handlePrevTrack: () => void;
    handleToggleLoopMode: () => void;
    pausePlayback: () => void;
    resumePlayback: () => Promise<void>;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
};

// Bridges playback-related keyboard and click interactions without leaving them inline in App.tsx.
export function usePlaybackInteractionBridge({
    isDev,
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
    stageLyricsClockRef,
    setIsDevDebugOverlayVisible,
    setIsPlayerChromeHidden,
    setIsPanelOpen,
    setReplayGainMode,
    setStatusMsg,
    handleNextTrack,
    handlePrevTrack,
    handleToggleLoopMode,
    pausePlayback,
    resumePlayback,
    syncStageLyricsClock,
}: UsePlaybackInteractionBridgeParams) {
    const togglePlay = useCallback((event?: React.MouseEvent | KeyboardEvent) => {
        event?.stopPropagation();

        if (isNowPlayingStageActive) {
            return;
        }

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            if (playerState === PlayerState.PLAYING) {
                pausePlayback();
            } else {
                void resumePlayback();
            }
            return;
        }

        if (audioRef.current) {
            if (!audioRef.current.paused && !audioRef.current.ended) {
                pausePlayback();
            } else {
                void resumePlayback();
            }
        }
    }, [activePlaybackContext, audioRef, audioSrc, isNowPlayingStageActive, pausePlayback, playerState, resumePlayback, stageActiveEntryKind]);

    const toggleLoop = useCallback((event?: React.MouseEvent) => {
        event?.stopPropagation();
        if (isNowPlayingStageActive) {
            return;
        }

        handleToggleLoopMode();
    }, [handleToggleLoopMode, isNowPlayingStageActive]);

    const handleChangeReplayGainMode = useCallback((mode: ReplayGainMode) => {
        setReplayGainMode(mode);
        setStatusMsg({ type: 'info', text: replayGainModeLabels[mode] });
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
                await neteaseApi.fmTrash(currentSong.id);
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

            if (isDev && event.altKey && event.shiftKey && event.code === 'KeyD') {
                event.preventDefault();
                setIsDevDebugOverlayVisible(prev => !prev);
                return;
            }

            switch (event.code) {
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
                    if (event.ctrlKey && !event.altKey && !event.metaKey) {
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
                    } else if (audioRef.current) {
                        const nextTime = Math.max(0, audioRef.current.currentTime - 5);
                        audioRef.current.currentTime = nextTime;
                    }
                    break;
                case 'ArrowRight':
                    if (event.ctrlKey && !event.altKey && !event.metaKey) {
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
                    } else if (audioRef.current) {
                        const nextTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
                        audioRef.current.currentTime = nextTime;
                    }
                    break;
                case 'KeyH':
                    if (currentView !== 'player' || isPanelOpen || hasBlockingWindow()) return;
                    if (event.ctrlKey || event.altKey || event.metaKey) return;
                    event.preventDefault();
                    setIsPlayerChromeHidden(prev => !prev);
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
        isDev,
        isNowPlayingStageActive,
        isPanelOpen,
        pausePlayback,
        playerState,
        resumePlayback,
        setIsDevDebugOverlayVisible,
        setIsPanelOpen,
        setIsPlayerChromeHidden,
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
