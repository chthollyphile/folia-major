import { useEffect } from 'react';
import type React from 'react';
import type { RefObject } from 'react';
import { PlayerState } from '../types';
import type { SongResult } from '../types';

// Bridges Electron-specific shell features without coupling to UI components.
type UseElectronPlaybackBridgeOptions = {
    isElectronWindow: boolean;
    setIsTitlebarRevealed: React.Dispatch<React.SetStateAction<boolean>>;
    isNowPlayingControlDisabledRef: RefObject<boolean>;
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
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
    onExternalPlayRequest?: (request: any) => Promise<void>;
};

export const useElectronPlaybackBridge = ({
    isElectronWindow,
    setIsTitlebarRevealed,
    isNowPlayingControlDisabledRef,
    audioRef,
    currentSong,
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
    onExternalPlayRequest,
}: UseElectronPlaybackBridgeOptions) => {
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
        if (!window.electron?.onStageExternalPlayRequest || !onExternalPlayRequest) {
            return;
        }

        return window.electron.onStageExternalPlayRequest((request) => {
            void onExternalPlayRequest(request);
        });
    }, [onExternalPlayRequest]);
};
