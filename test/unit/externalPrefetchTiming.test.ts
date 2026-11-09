// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { clearPrefetchRuntime, prefetchNearbySongs } from '@/services/prefetchService';

// External-player metadata prefetch must wait for actual progress and release its subscriptions.
const gate = vi.hoisted(() => ({ ready: false, listeners: new Set<() => void>(), canPlay: vi.fn(() => false) }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    canPlayExternally: () => true,
    canPlaySong: gate.canPlay,
} }));
vi.mock('@/services/onlineMusic/externalPlayback', () => ({
    getExternalSong: () => ({ id: 'a', sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'a' } }),
    isExternalPlaybackReadyForPrefetch: () => gate.ready,
    subscribeExternalPlayback: (listener: () => void) => { gate.listeners.add(listener); return () => gate.listeners.delete(listener); },
}));
const song: SongResult = { id: 'a', name: 'A', artists: [], album: { id: '', name: '' }, durationMs: 100000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'a' } };

afterEach(() => { clearPrefetchRuntime(); gate.ready = false; gate.canPlay.mockClear(); vi.useRealTimers(); });

describe('external prefetch timing', () => {
    it('defers nearby work until playback has advanced', async () => {
        vi.useFakeTimers();
        const next = { ...song, id: 'b', sourceRef: { kind: 'online' as const, providerId: 'appleMusic', mediaId: 'b' } };
        const pending = prefetchNearbySongs(song, [song, next], 'high');
        expect(gate.listeners.size).toBe(1);
        expect(gate.canPlay).not.toHaveBeenCalled();
        // A restored session can remain paused for minutes before the listener starts it.
        await vi.advanceTimersByTimeAsync(60000);
        expect(gate.listeners.size).toBe(1);
        gate.ready = true;
        gate.listeners.forEach(listener => listener());
        await pending;
        await vi.runAllTimersAsync();
        expect(gate.listeners.size).toBe(0);
        expect(gate.canPlay).toHaveBeenCalled();
    });

    it('cancels the deferred job when prefetch is cleared', async () => {
        vi.useFakeTimers();
        const pending = prefetchNearbySongs(song, [song], 'high');
        clearPrefetchRuntime();
        await pending;
        expect(gate.listeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(gate.canPlay).not.toHaveBeenCalled();
    });
});
