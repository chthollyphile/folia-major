import { PlayerState, type StageControlRequest, type StageLoopMode, type StageRealtimeState } from '../../../src/types';

// Controller clock helpers keep one authoritative wall-clock timeline so stage-client can resolve play/pause/seek accurately.

export interface StageControllerClock {
    sessionId: string | null;
    currentTrackId: string | null;
    playerState: PlayerState;
    baseCurrentTimeMs: number;
    baseWallClockMs: number;
    durationMs: number;
    loopMode: StageLoopMode;
    trackCount: number;
    revision: number;
}

const clampTimeMs = (timeMs: number, durationMs: number) => {
    const normalized = Math.max(0, Math.floor(Number(timeMs) || 0));
    if (durationMs > 0) {
        return Math.min(normalized, durationMs);
    }
    return normalized;
};

export const createStageControllerClock = (): StageControllerClock => ({
    sessionId: null,
    currentTrackId: null,
    playerState: PlayerState.IDLE,
    baseCurrentTimeMs: 0,
    baseWallClockMs: Date.now(),
    durationMs: 0,
    loopMode: 'off',
    trackCount: 0,
    revision: 0,
});

export const syncControllerClockFromState = (
    clock: StageControllerClock,
    state: StageRealtimeState,
    now = Date.now(),
): StageControllerClock => ({
    ...clock,
    sessionId: state.sessionId,
    currentTrackId: state.currentTrackId,
    playerState: state.playerState,
    baseCurrentTimeMs: clampTimeMs(state.currentTimeMs, state.durationMs),
    baseWallClockMs: now,
    durationMs: Math.max(0, Math.floor(state.durationMs || 0)),
    loopMode: state.loopMode,
    trackCount: state.tracks.length,
    revision: Math.max(clock.revision, state.revision),
});

const shouldWrapClockTime = (clock: StageControllerClock) =>
    clock.durationMs > 0 && (clock.loopMode === 'one' || (clock.loopMode === 'all' && clock.trackCount <= 1));

export const getControllerClockTimeMs = (
    clock: StageControllerClock,
    now = Date.now(),
) => {
    if (clock.playerState !== 'PLAYING') {
        return clampTimeMs(clock.baseCurrentTimeMs, clock.durationMs);
    }

    const elapsedMs = Math.max(0, now - clock.baseWallClockMs);
    const rawTimeMs = clock.baseCurrentTimeMs + elapsedMs;
    if (shouldWrapClockTime(clock)) {
        return rawTimeMs >= clock.durationMs
            ? rawTimeMs % clock.durationMs
            : rawTimeMs;
    }

    return clampTimeMs(rawTimeMs, clock.durationMs);
};

export const formatControllerClockStatus = (clock: StageControllerClock, now = Date.now()) =>
    `${clock.playerState} · ${getControllerClockTimeMs(clock, now)} ms${clock.durationMs > 0 ? ` / ${clock.durationMs} ms` : ''}`;

export const computeNavigationFlags = (state: StageRealtimeState) => {
    if (state.tracks.length <= 1) {
        const hasSingleTrackLoop = state.tracks.length === 1 && state.loopMode === 'all';
        return {
            canGoNext: hasSingleTrackLoop,
            canGoPrev: hasSingleTrackLoop,
        };
    }

    const currentIndex = Math.max(
        0,
        state.tracks.findIndex((track) => track.trackId === state.currentTrackId),
    );

    if (state.loopMode === 'all') {
        return { canGoNext: true, canGoPrev: true };
    }

    return {
        canGoNext: currentIndex < state.tracks.length - 1,
        canGoPrev: currentIndex > 0,
    };
};

export const cycleLoopMode = (loopMode: StageLoopMode): StageLoopMode => {
    if (loopMode === 'off') return 'all';
    if (loopMode === 'all') return 'one';
    return 'off';
};

const resolveRequestTimeMs = (
    clock: StageControllerClock,
    state: StageRealtimeState,
    request: StageControlRequest,
    now: number,
) => {
    if (Number.isFinite(request.payload?.timeMs)) {
        return clampTimeMs(request.payload?.timeMs || 0, state.durationMs);
    }

    const sameTimeline =
        clock.sessionId === state.sessionId &&
        clock.currentTrackId === state.currentTrackId;

    if (sameTimeline) {
        return getControllerClockTimeMs(clock, now);
    }

    return clampTimeMs(state.currentTimeMs, state.durationMs);
};

// Resolve a new authoritative stage_state from a control request while advancing the controller clock.
export const applyStageControlRequestWithClock = (
    state: StageRealtimeState,
    request: StageControlRequest,
    clock: StageControllerClock,
    now = Date.now(),
) => {
    const nextState: StageRealtimeState = {
        ...state,
        tracks: state.tracks.map((track) => ({ ...track })),
        revision: Math.max(state.revision + 1, clock.revision + 1, 1),
        updatedAt: now,
        currentTimeMs: resolveRequestTimeMs(clock, state, request, now),
    };

    const tracks = nextState.tracks;
    const currentIndex = Math.max(
        0,
        tracks.findIndex((track) => track.trackId === nextState.currentTrackId),
    );

    switch (request.type) {
        case 'play':
            nextState.playerState = PlayerState.PLAYING;
            break;
        case 'pause':
            nextState.playerState = PlayerState.PAUSED;
            break;
        case 'seek':
            nextState.currentTimeMs = clampTimeMs(request.payload?.timeMs || 0, nextState.durationMs);
            break;
        case 'set_loop_mode':
            nextState.loopMode = request.payload?.loopMode || nextState.loopMode;
            break;
        case 'next': {
            if (tracks.length === 0) {
                break;
            }

            if (nextState.loopMode === 'one') {
                nextState.currentTimeMs = 0;
                break;
            }

            let targetIndex = currentIndex;
            if (currentIndex < tracks.length - 1) {
                targetIndex = currentIndex + 1;
            } else if (nextState.loopMode === 'all') {
                targetIndex = 0;
            }

            const targetTrack = tracks[targetIndex];
            nextState.currentTrackId = targetTrack?.trackId || nextState.currentTrackId;
            nextState.durationMs = Math.max(0, Math.floor(targetTrack?.durationMs || 0));
            nextState.currentTimeMs = 0;
            break;
        }
        case 'prev': {
            if (tracks.length === 0) {
                break;
            }

            if (nextState.loopMode === 'one') {
                nextState.currentTimeMs = 0;
                break;
            }

            let targetIndex = currentIndex;
            if (currentIndex > 0) {
                targetIndex = currentIndex - 1;
            } else if (nextState.loopMode === 'all') {
                targetIndex = tracks.length - 1;
            }

            const targetTrack = tracks[targetIndex];
            nextState.currentTrackId = targetTrack?.trackId || nextState.currentTrackId;
            nextState.durationMs = Math.max(0, Math.floor(targetTrack?.durationMs || 0));
            nextState.currentTimeMs = 0;
            break;
        }
        default:
            break;
    }

    const navigationFlags = computeNavigationFlags(nextState);
    nextState.canGoNext = navigationFlags.canGoNext;
    nextState.canGoPrev = navigationFlags.canGoPrev;

    return {
        nextState,
        nextClock: syncControllerClockFromState(clock, nextState, now),
    };
};
