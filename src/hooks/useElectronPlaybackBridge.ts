import { useEffect } from 'react';
import type React from 'react';
import type { RefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { PlayerState } from '../types';
import type { SongResult } from '../types';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../types/remoteControl';
import type { VideoExportState } from '../types/videoExport';

// Bridges Electron-specific shell features without coupling to UI components.
type UseElectronPlaybackBridgeOptions = {
    isElectronWindow: boolean;
    setIsTitlebarRevealed: React.Dispatch<React.SetStateAction<boolean>>;
    isNowPlayingControlDisabledRef: RefObject<boolean>;
    audioRef: RefObject<HTMLAudioElement | null>;
    currentTime: MotionValue<number>;
    duration: number;
    currentSong: SongResult | null;
    cachedCoverUrl: string | null;
    playerState: PlayerState;
    playQueue: SongResult[];
    effectiveLoopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isNowPlayingStageActive: boolean;
    mediaSessionPlayRef: RefObject<() => Promise<void>>;
    mediaSessionPauseRef: RefObject<() => void>;
    mediaSessionPrevRef: RefObject<() => void>;
    mediaSessionNextRef: RefObject<() => Promise<void> | void>;
    taskbarHasTrackRef: RefObject<boolean>;
    taskbarPlayerStateRef: RefObject<PlayerState>;
    exportState: VideoExportState;
    onRemoteExportCommand?: (command: RemoteControlCommand) => boolean;
    onExternalPlayRequest?: (request: any) => Promise<void>;
};

export const useElectronPlaybackBridge = ({
    isElectronWindow,
    setIsTitlebarRevealed,
    isNowPlayingControlDisabledRef,
    audioRef,
    currentTime,
    duration,
    currentSong,
    cachedCoverUrl,
    playerState,
    playQueue,
    effectiveLoopMode,
    isFmMode,
    isNowPlayingStageActive,
    mediaSessionPlayRef,
    mediaSessionPauseRef,
    mediaSessionPrevRef,
    mediaSessionNextRef,
    taskbarHasTrackRef,
    taskbarPlayerStateRef,
    exportState,
    onRemoteExportCommand,
    onExternalPlayRequest,
}: UseElectronPlaybackBridgeOptions) => {
    const buildRemoteSnapshot = (): RemoteControlSnapshot => {
        const hasActiveTrack = !isNowPlayingStageActive && Boolean(currentSong);
        const currentIndex = currentSong ? playQueue.findIndex(song => song.id === currentSong.id) : -1;
        const canGoPrevious = hasActiveTrack && (currentIndex > 0 || (effectiveLoopMode === 'all' && playQueue.length > 1));
        const canGoNext = hasActiveTrack && (
            isFmMode ||
            currentIndex >= 0 && currentIndex < playQueue.length - 1 ||
            (effectiveLoopMode === 'all' && playQueue.length > 1)
        );

        return {
            hasTrack: hasActiveTrack,
            title: currentSong?.name ?? null,
            artist: currentSong?.artists?.map(artist => artist.name).join(', ') || null,
            coverUrl: cachedCoverUrl,
            currentTime: audioRef.current?.currentTime ?? currentTime.get(),
            duration,
            playerState,
            canGoPrevious,
            canGoNext,
            controlsDisabled: isNowPlayingControlDisabledRef.current || !hasActiveTrack,
            isStageActive: isNowPlayingStageActive,
            exportState,
            updatedAt: Date.now(),
        };
    };

    useEffect(() => {
        if (!isElectronWindow) {
            setIsTitlebarRevealed(false);
            return;
        }

        const revealThreshold = 56;
        const handleMouseMove = (event: MouseEvent) => {
            const nextVisible = event.clientY <= revealThreshold;
            setIsTitlebarRevealed(prev => (prev === nextVisible ? prev : nextVisible));
        };
        const handleMouseLeave = () => setIsTitlebarRevealed(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [isElectronWindow, setIsTitlebarRevealed]);

    useEffect(() => {
        if (!window.electron?.onTaskbarControl) {
            return;
        }

        return window.electron.onTaskbarControl((action) => {
            if (isNowPlayingControlDisabledRef.current || !audioRef.current || !taskbarHasTrackRef.current) {
                return;
            }

            if (action === 'previous') {
                mediaSessionPrevRef.current();
                return;
            }

            if (action === 'next') {
                void mediaSessionNextRef.current();
                return;
            }

            if (taskbarPlayerStateRef.current === PlayerState.PLAYING) {
                mediaSessionPauseRef.current();
            } else {
                void mediaSessionPlayRef.current();
            }
        });
    }, [audioRef, isNowPlayingControlDisabledRef, mediaSessionNextRef, mediaSessionPauseRef, mediaSessionPlayRef, mediaSessionPrevRef, taskbarHasTrackRef, taskbarPlayerStateRef]);

    useEffect(() => {
        if (!window.electron?.updateTaskbarControls) {
            return;
        }

        const hasActiveTrack = !isNowPlayingStageActive && Boolean(currentSong);
        const currentIndex = currentSong ? playQueue.findIndex(song => song.id === currentSong.id) : -1;
        const canGoPrevious = !isNowPlayingStageActive && (currentIndex > 0 || (effectiveLoopMode === 'all' && playQueue.length > 1));
        const canGoNext = hasActiveTrack && (
            isFmMode ||
            currentIndex >= 0 && currentIndex < playQueue.length - 1 ||
            (effectiveLoopMode === 'all' && playQueue.length > 1)
        );

        void window.electron.updateTaskbarControls({
            hasActiveTrack,
            canGoPrevious,
            canGoNext,
            isPlaying: !isNowPlayingStageActive && hasActiveTrack && playerState === PlayerState.PLAYING,
        }).catch((error) => {
            console.warn('[Electron] Failed to update Windows taskbar controls', error);
        });
    }, [currentSong, effectiveLoopMode, isFmMode, isNowPlayingStageActive, playQueue, playerState]);

    useEffect(() => {
        if (!window.electron?.publishRemoteControlSnapshot) {
            return;
        }

        const publish = () => {
            void window.electron?.publishRemoteControlSnapshot(buildRemoteSnapshot()).catch((error) => {
                console.warn('[Electron] Failed to publish remote control snapshot', error);
            });
        };

        publish();
        const intervalId = window.setInterval(publish, 500);
        return () => window.clearInterval(intervalId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cachedCoverUrl, currentSong, duration, effectiveLoopMode, exportState, isFmMode, isNowPlayingStageActive, playQueue, playerState]);

    useEffect(() => {
        if (!window.electron?.onRemoteControlCommand) {
            return;
        }

        const runCommand = (command: RemoteControlCommand) => {
            if (onRemoteExportCommand?.(command)) {
                return;
            }

            if (command.type === 'open-export') {
                return;
            }

            if (isNowPlayingControlDisabledRef.current || !taskbarHasTrackRef.current) {
                return;
            }

            if (command.type === 'previous') {
                mediaSessionPrevRef.current();
                return;
            }

            if (command.type === 'next') {
                void mediaSessionNextRef.current();
                return;
            }

            if (command.type === 'seek') {
                const audioElement = audioRef.current;
                if (!audioElement || !Number.isFinite(command.time)) {
                    return;
                }

                const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : audioElement.duration;
                const upperBound = Number.isFinite(safeDuration) && safeDuration > 0 ? safeDuration : command.time;
                const nextTime = Math.max(0, Math.min(command.time, upperBound));
                audioElement.currentTime = nextTime;
                currentTime.set(nextTime);
                void window.electron?.publishRemoteControlSnapshot(buildRemoteSnapshot());
                return;
            }

            if (taskbarPlayerStateRef.current === PlayerState.PLAYING) {
                mediaSessionPauseRef.current();
            } else {
                void mediaSessionPlayRef.current();
            }
        };

        return window.electron.onRemoteControlCommand(runCommand);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioRef, currentTime, duration, isNowPlayingControlDisabledRef, mediaSessionNextRef, mediaSessionPauseRef, mediaSessionPlayRef, mediaSessionPrevRef, onRemoteExportCommand, taskbarHasTrackRef, taskbarPlayerStateRef]);

    useEffect(() => {
        if (!window.electron?.onStageExternalPlayRequest || !onExternalPlayRequest) {
            return;
        }

        return window.electron.onStageExternalPlayRequest((request) => {
            void onExternalPlayRequest(request);
        });
    }, [onExternalPlayRequest]);
};
