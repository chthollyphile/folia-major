import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    acquireExternalPlayback,
    releaseAllExternalPlayback,
    releaseExternalPlayback,
    releaseExternalPlaybackForMod,
    routeExternalPlayback,
    hasExternalPlayback,
    captureExternalPlaybackBoundary,
    subscribeExternalPlayback,
    setExternalPlaybackCapabilities,
} from '@/services/externalPlaybackSession';
import { beginPlaybackRequest, invalidatePlaybackRequest } from '@/services/playbackRequest';

// test/unit/mod-system/externalPlaybackSession.test.ts
const acquire = (overrides: Partial<Parameters<typeof acquireExternalPlayback>[0]> = {}) =>
    acquireExternalPlayback({ modId: 'test', dispatch: vi.fn(), cleanup: vi.fn(), report: vi.fn(), ...overrides });
afterEach(() => {
    releaseAllExternalPlayback();
    invalidatePlaybackRequest();
});

describe('external playback ownership', () => {
    it('separates natural end, next and queue intent and prevents a second owner', () => {
        const dispatch = vi.fn();
        acquire({ dispatch });
        expect(() => acquire()).toThrow('external-playback-busy');
        routeExternalPlayback({ type: 'next' });
        routeExternalPlayback({ type: 'ended' });
        routeExternalPlayback({ type: 'enqueue', songs: [] });
        expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(['next', 'ended', 'enqueue']);
    });
    it('reports and releases a throwing/rejecting owner without executing a local command', async () => {
        const cleanup = vi.fn(),
            report = vi.fn();
        acquire({
            dispatch: () => {
                throw Error('broken');
            },
            cleanup,
            report,
        });
        expect(routeExternalPlayback({ type: 'next' })).toBe(true);
        expect(hasExternalPlayback()).toBe(false);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledOnce();
        acquire({
            dispatch: async () => {
                throw Error('async broken');
            },
            cleanup,
            report,
        });
        routeExternalPlayback({ type: 'next' });
        await Promise.resolve();
        expect(hasExternalPlayback()).toBe(false);
        expect(report).toHaveBeenCalledTimes(2);
    });
    it('always releases on cleanup failure and only disposes the correct mod', () => {
        const report = vi.fn();
        acquire({
            cleanup: () => {
                throw Error('stop failed');
            },
            report,
        });
        releaseExternalPlaybackForMod('another');
        expect(hasExternalPlayback()).toBe(true);
        releaseExternalPlaybackForMod('test');
        expect(hasExternalPlayback()).toBe(false);
        expect(report).toHaveBeenCalledOnce();
        expect(routeExternalPlayback({ type: 'next' })).toBe(false);
    });
    it('invalidates work across an acquire/release round trip and notifies only transitions', () => {
        const changed = vi.fn(),
            stop = subscribeExternalPlayback(changed);
        const current = captureExternalPlaybackBoundary();
        const token = acquire();
        expect(current()).toBe(false);
        releaseExternalPlayback(token);
        releaseExternalPlayback(token);
        expect(current()).toBe(false);
        expect(changed).toHaveBeenCalledTimes(2);
        stop();
    });
});

describe('shared playback requests', () => {
    it('cancels pending normal loads on acquire and lease loads on release, cleaning resources', async () => {
        const normal = beginPlaybackRequest(),
            cleanup = vi.fn();
        normal.onCancel(cleanup);
        const token = acquire();
        expect(await normal.result).toEqual({ status: 'cancelled' });
        expect(cleanup).toHaveBeenCalledOnce();
        expect(normal.isCurrent()).toBe(false);
        const own = beginPlaybackRequest(token);
        releaseExternalPlayback(token);
        expect(await own.result).toEqual({ status: 'cancelled' });
    });
    it('does not let a normal or expired-lease load supersede the current owner', async () => {
        const token = acquire(),
            own = beginPlaybackRequest(token);
        const rogue = beginPlaybackRequest();
        expect(await rogue.result).toEqual({ status: 'cancelled' });
        expect(own.isCurrent()).toBe(true);
        releaseExternalPlayback(token);
        const local = beginPlaybackRequest();
        expect(await beginPlaybackRequest(token).result).toEqual({ status: 'cancelled' });
        expect(local.isCurrent()).toBe(true);
    });
    it('supersedes earlier loads, preserves committed resources and acknowledges only once', async () => {
        const a = beginPlaybackRequest(),
            cleanup = vi.fn();
        const handoff = a.onCancel(cleanup);
        handoff();
        a.finish('source-committed');
        a.finish('cancelled');
        expect(await a.result).toEqual({ status: 'source-committed' });
        const b = beginPlaybackRequest();
        expect(a.isCurrent()).toBe(false);
        expect(cleanup).not.toHaveBeenCalled();
        beginPlaybackRequest();
        expect(await b.result).toEqual({ status: 'superseded' });
    });
    it('cleans late resources immediately and exposes unavailable/failed outcomes', async () => {
        const request = beginPlaybackRequest();
        request.finish('unavailable');
        const cleanup = vi.fn();
        request.onCancel(cleanup);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(await request.result).toEqual({ status: 'unavailable' });
        const failed = beginPlaybackRequest();
        failed.finish('failed');
        expect(await failed.result).toEqual({ status: 'failed' });
    });
});


it('keeps cleanup exclusive when a synchronous subscriber tries to reacquire', () => {
    const dispatch = vi.fn();
    const token = acquire({ dispatch, cleanup: () => {
        expect(() => acquire()).toThrow('external-playback-busy');
        expect(() => setExternalPlaybackCapabilities(token, { canNext: false, canPrevious: false, canSeek: false })).toThrow('playback-session-released');
        expect(routeExternalPlayback({ type: 'next' })).toBe(true);
        expect(dispatch).not.toHaveBeenCalled();
    }});
    releaseExternalPlayback(token);
    expect(hasExternalPlayback()).toBe(false);
    expect(() => acquire()).not.toThrow();
});
