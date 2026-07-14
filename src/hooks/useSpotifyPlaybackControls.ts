import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { PlayerState } from '../types';
import type { StageLoopMode, StatusMessage } from '../types';
import { SPOTIFY_PLAYBACK_REFRESH_EVENT } from '../services/spotifyProvider';

// src/hooks/useSpotifyPlaybackControls.ts
// Routes Folia's existing transport surface to the active Spotify Connect device.

type UseSpotifyPlaybackControlsParams = {
    active: boolean;
    currentTime: MotionValue<number>;
    duration: number;
    playerState: PlayerState;
    loopMode: StageLoopMode;
    setPlayerState: Dispatch<SetStateAction<PlayerState>>;
    setStatusMsg: Dispatch<SetStateAction<StatusMessage | null>>;
    handleToggleLoopMode: () => void;
    syncNowPlayingClock: (progressSec: number, durationSec: number, paused: boolean) => void;
    getNowPlayingDisplayTime: () => number;
    t: (key: string, options?: Record<string, unknown>) => string;
};

const nextLoopMode = (loopMode: StageLoopMode): StageLoopMode => (
    loopMode === 'off' ? 'all' : loopMode === 'all' ? 'one' : 'off'
);

const toSpotifyRepeatState = (loopMode: StageLoopMode): 'off' | 'context' | 'track' => (
    loopMode === 'all' ? 'context' : loopMode === 'one' ? 'track' : 'off'
);

export function useSpotifyPlaybackControls({
    active,
    currentTime,
    duration,
    playerState,
    loopMode,
    setPlayerState,
    setStatusMsg,
    handleToggleLoopMode,
    syncNowPlayingClock,
    getNowPlayingDisplayTime,
    t,
}: UseSpotifyPlaybackControlsParams) {
    const requestControl = useCallback(async (command: ElectronSpotifyPlaybackControlCommand) => {
        if (!active) {
            return false;
        }

        try {
            const bridge = window.electron?.controlSpotifyPlayback;
            if (!bridge) {
                throw new Error('Spotify playback controls are unavailable in this build.');
            }
            const response = await bridge(command);
            if (!response.ok) {
                throw new Error(response.error || 'Spotify rejected the playback command.');
            }
            window.dispatchEvent(new Event(SPOTIFY_PLAYBACK_REFRESH_EVENT));
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatusMsg({
                type: 'error',
                text: t('status.spotifyControlFailed', { error: message }),
                nonce: Date.now(),
            });
            return false;
        }
    }, [active, setStatusMsg, t]);

    const resumeSpotify = useCallback(async () => {
        if (await requestControl({ action: 'resume' })) {
            const displayTime = getNowPlayingDisplayTime();
            syncNowPlayingClock(displayTime, duration, false);
            currentTime.set(displayTime);
            setPlayerState(PlayerState.PLAYING);
        }
    }, [currentTime, duration, getNowPlayingDisplayTime, requestControl, setPlayerState, syncNowPlayingClock]);

    const pauseSpotify = useCallback(async () => {
        if (await requestControl({ action: 'pause' })) {
            const displayTime = getNowPlayingDisplayTime();
            syncNowPlayingClock(displayTime, duration, true);
            currentTime.set(displayTime);
            setPlayerState(PlayerState.PAUSED);
        }
    }, [currentTime, duration, getNowPlayingDisplayTime, requestControl, setPlayerState, syncNowPlayingClock]);

    const seekSpotify = useCallback(async (timeSec: number) => {
        const safeTime = Math.min(Math.max(0, timeSec), Math.max(0, duration) || Math.max(0, timeSec));
        if (await requestControl({ action: 'seek', positionMs: Math.round(safeTime * 1000) })) {
            const paused = playerState !== PlayerState.PLAYING;
            syncNowPlayingClock(safeTime, duration, paused);
            currentTime.set(safeTime);
        }
    }, [currentTime, duration, playerState, requestControl, syncNowPlayingClock]);

    const nextSpotify = useCallback(async () => {
        await requestControl({ action: 'next' });
    }, [requestControl]);

    const previousSpotify = useCallback(async () => {
        await requestControl({ action: 'previous' });
    }, [requestControl]);

    const toggleSpotifyLoop = useCallback(async () => {
        const nextMode = nextLoopMode(loopMode);
        if (await requestControl({ action: 'repeat', state: toSpotifyRepeatState(nextMode) })) {
            handleToggleLoopMode();
        }
    }, [handleToggleLoopMode, loopMode, requestControl]);

    return {
        resumeSpotify,
        pauseSpotify,
        seekSpotify,
        nextSpotify,
        previousSpotify,
        toggleSpotifyLoop,
    };
}

export const spotifyPlaybackControlHelpers = {
    nextLoopMode,
    toSpotifyRepeatState,
};
