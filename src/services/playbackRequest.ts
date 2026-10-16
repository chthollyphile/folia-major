import type { PlaybackRequest, PlaybackStartResult } from '../types/externalPlayback';

// src/services/playbackRequest.ts
// A single generation covers online, local, Navidrome and Stage source commits.
let allowRequest: (token?: symbol) => boolean = () => true;
export const configurePlaybackRequestGuard = (guard: typeof allowRequest) => {
    allowRequest = guard;
};

let current: { request: PlaybackRequest; cancel(reason: 'cancelled' | 'superseded'): void } | null = null;

export const invalidatePlaybackRequest = (reason: 'cancelled' | 'superseded' = 'cancelled') => {
    const previous = current;
    current = null;
    previous?.cancel(reason);
};

export function beginPlaybackRequest(token?: symbol): PlaybackRequest {
    if (!allowRequest(token)) {
        const controller = new AbortController();
        controller.abort('cancelled');
        return {
            external: Boolean(token),
            signal: controller.signal,
            result: Promise.resolve({ status: 'cancelled' }),
            isCurrent: () => false,
            finish: () => {},
            onCancel: (cleanup) => {
                cleanup();
                return () => {};
            },
        };
    }
    const external = Boolean(token);
    invalidatePlaybackRequest('superseded');
    const controller = new AbortController();
    const cleanups = new Set<() => void>();
    let settled = false;
    let resolve!: (result: PlaybackStartResult) => void;
    const result = new Promise<PlaybackStartResult>((done) => {
        resolve = done;
    });
    const settle = (status: PlaybackStartResult['status']) => {
        if (settled) return;
        settled = true;
        resolve({ status });
    };
    const cancel = (reason: 'cancelled' | 'superseded') => {
        controller.abort(reason);
        settle(reason);
        for (const cleanup of cleanups) {
            try {
                cleanup();
            } catch (error) {
                console.warn('[Playback] resource cleanup failed', error);
            }
        }
        cleanups.clear();
    };
    const request: PlaybackRequest = {
        external,
        signal: controller.signal,
        result,
        isCurrent: () => current?.request === request && !controller.signal.aborted,
        finish: (status) => {
            if (!request.isCurrent() || settled) return;
            settle(status);
            if (status !== 'source-committed') invalidatePlaybackRequest();
        },
        onCancel: (cleanup) => {
            if (!request.isCurrent()) {
                cleanup();
                return () => {};
            }
            cleanups.add(cleanup);
            return () => {
                cleanups.delete(cleanup);
            };
        },
    };
    current = { request, cancel };
    return request;
}
