import { describe, expect, it } from 'vitest';
import { PlayerState, type StageControlRequest, type StageRealtimeState } from '@/types';
import {
    applyStageControlRequestWithClock,
    createStageControllerClock,
    getControllerClockTimeMs,
    syncControllerClockFromState,
} from '../../../test/manual/stage-client/controllerClock';

// Controller clock tests keep the manual stage-client aligned with realtime pause/play semantics.

describe('stageControllerClock', () => {
    const baseState: StageRealtimeState = {
        revision: 10,
        sessionId: 'session-1',
        tracks: [
            {
                trackId: 'track-1',
                title: 'Track 1',
                artist: 'Artist',
                album: 'Album',
                coverUrl: null,
                durationMs: 120000,
            },
        ],
        currentTrackId: 'track-1',
        playerState: PlayerState.PLAYING,
        currentTimeMs: 30000,
        durationMs: 120000,
        loopMode: 'off',
        canGoNext: false,
        canGoPrev: false,
        updatedAt: 1,
    };

    it('advances playing time from the controller wall clock', () => {
        const clock = syncControllerClockFromState(createStageControllerClock(), baseState, 1000);

        expect(getControllerClockTimeMs(clock, 1600)).toBe(30600);
    });

    it('prefers player supplied pause time when resolving a pause request', () => {
        const clock = syncControllerClockFromState(createStageControllerClock(), baseState, 1000);
        const pauseRequest: StageControlRequest = {
            requestId: 'pause-1',
            originPlayerId: 'folia-player-1',
            requestedAt: 1700,
            baseRevision: 10,
            type: 'pause',
            payload: {
                timeMs: 33970,
            },
        };

        const { nextState, nextClock } = applyStageControlRequestWithClock(baseState, pauseRequest, clock, 1700);

        expect(nextState.playerState).toBe('PAUSED');
        expect(nextState.currentTimeMs).toBe(33970);
        expect(getControllerClockTimeMs(nextClock, 2300)).toBe(33970);
    });

    it('wraps controller time back to zero for single-track looping playback', () => {
        const loopingState: StageRealtimeState = {
            ...baseState,
            loopMode: 'one',
            currentTimeMs: 119500,
        };

        const clock = syncControllerClockFromState(createStageControllerClock(), loopingState, 1000);

        expect(getControllerClockTimeMs(clock, 1700)).toBe(200);
    });
});
