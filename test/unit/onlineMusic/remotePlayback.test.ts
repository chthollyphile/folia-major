import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/onlineMusic/remotePlayback.test.ts

const start = vi.hoisted(() => vi.fn());
const command = vi.hoisted(() => vi.fn());
const queueNext = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    startRemotePlayback: start, remotePlaybackCommand: command, queueRemotePlaybackNext: queueNext,
    usesRemotePlayback: (song: SongResult | null) => song?.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'applemusic',
} }));
const song = (id: string, providerId: 'applemusic' | 'netease' = 'applemusic'): SongResult => ({ id, name: id, artists: [], album: { id: 0, name: '' }, durationMs: 10000, sourceRef: { kind: 'online', providerId, mediaId: id } });
beforeEach(() => { vi.resetModules(); start.mockReset().mockResolvedValue(undefined); command.mockReset().mockResolvedValue(undefined); queueNext.mockReset().mockResolvedValue(undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('remote playback handover', () => {
    it('lines the next song up on the same backend and continues it without a reload or a pause', async () => {
        const runtime = await import('@/services/remotePlayback');
        await runtime.startRemotePlayback(song('1'), { quality: 'standard' });
        expect(start).toHaveBeenLastCalledWith(song('1'), { quality: 'standard', continueIfCurrent: false });
        expect(await runtime.queueRemotePlaybackNext(song('2'))).toBe(true);
        expect(queueNext).toHaveBeenCalledWith(song('1'), song('2'));
        expect(runtime.getQueuedRemoteNext()).toEqual(song('2'));
        await runtime.startRemotePlayback(song('2'), { quality: 'high' });
        expect(start).toHaveBeenLastCalledWith(song('2'), { quality: 'high', continueIfCurrent: true });
        expect(command).not.toHaveBeenCalledWith(song('1'), 'pause');
        expect(runtime.getQueuedRemoteNext()).toBeNull();
    });
    it('refuses to queue across providers and still pauses the old backend when the provider changes', async () => {
        const runtime = await import('@/services/remotePlayback');
        await runtime.startRemotePlayback(song('1'));
        expect(await runtime.queueRemotePlaybackNext(song('n', 'netease'))).toBe(false);
        expect(queueNext).not.toHaveBeenCalled();
        await runtime.startRemotePlayback(song('n', 'netease'));
        expect(command).toHaveBeenCalledWith(song('1'), 'pause');
        expect(start).toHaveBeenLastCalledWith(song('n', 'netease'), { continueIfCurrent: false });
    });
    it('starts a song that was not the queued one fresh', async () => {
        const runtime = await import('@/services/remotePlayback');
        await runtime.startRemotePlayback(song('1'));
        await runtime.queueRemotePlaybackNext(song('2'));
        await runtime.startRemotePlayback(song('3'));
        expect(start).toHaveBeenLastCalledWith(song('3'), { continueIfCurrent: false });
    });
});

describe('remote playback clock', () => {
    it('does not cross a lyric boundary backwards when a poll trails the interpolated clock', async () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const runtime = await import('@/services/remotePlayback');
        const snapshot = { mediaId: '1', position: 9.8, duration: 100, playing: true };
        runtime.updateRemotePlaybackClock(snapshot);
        now = 500;
        expect(runtime.getRemotePlaybackTime()).toBeCloseTo(10.3);
        runtime.updateRemotePlaybackClock({ ...snapshot, position: 9.95 });
        expect(runtime.getRemotePlaybackTime()).toBeCloseTo(10.3);
        now = 700;
        expect(runtime.getRemotePlaybackTime()).toBeCloseTo(10.3);
        now = 1000;
        expect(runtime.getRemotePlaybackTime()).toBeCloseTo(10.45);
    });

    it('does not accumulate extrapolated time when the backend keeps reporting the same position', async () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const runtime = await import('@/services/remotePlayback');
        const snapshot = { mediaId: '1', position: 10, duration: 100, playing: true };
        runtime.updateRemotePlaybackClock(snapshot);
        for (let poll = 1; poll <= 20; poll += 1) {
            now = poll * 500;
            runtime.updateRemotePlaybackClock(snapshot);
            expect(runtime.getRemotePlaybackTime()).toBeCloseTo(10.5);
        }
        now += 10000;
        expect(runtime.getRemotePlaybackTime()).toBeCloseTo(11.5);
    });

    it('keeps a slightly late pause snapshot from reversing the displayed time', async () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const runtime = await import('@/services/remotePlayback');
        runtime.updateRemotePlaybackClock({ mediaId: '1', position: 9.8, duration: 100, playing: true });
        now = 500;
        runtime.updateRemotePlaybackClock({ mediaId: '1', position: 9.95, duration: 100, playing: false });
        now = 5000;
        expect(runtime.getRemotePlaybackTime()).toBeCloseTo(10.3);
    });

    it('applies explicit short backward seeks and large external jumps immediately', async () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const runtime = await import('@/services/remotePlayback');
        await runtime.startRemotePlayback(song('1'));
        const snapshot = { mediaId: '1', position: 10.3, duration: 100, playing: true };
        runtime.updateRemotePlaybackClock(snapshot);
        await runtime.commandRemotePlayback('seek', 9.9);
        expect(runtime.getRemotePlaybackTime()).toBe(9.9);
        runtime.updateRemotePlaybackClock({ ...snapshot, position: 2 });
        expect(runtime.getRemotePlaybackTime()).toBe(2);
        runtime.updateRemotePlaybackClock({ ...snapshot, position: 80 });
        expect(runtime.getRemotePlaybackTime()).toBe(80);
        runtime.updateRemotePlaybackClock({ ...snapshot, mediaId: '2', position: 79.5 });
        expect(runtime.getRemotePlaybackTime()).toBe(79.5);
        await runtime.startRemotePlayback(song('2'));
        expect(runtime.getRemotePlaybackTime()).toBe(0);
    });

    it('notifies subscribers on polled snapshots, local commands and stops', async () => {
        const runtime = await import('@/services/remotePlayback');
        const listener = vi.fn();
        const unsubscribe = runtime.subscribeRemotePlaybackClock(listener);
        await runtime.startRemotePlayback(song('1'));
        runtime.updateRemotePlaybackClock({ mediaId: '1', position: 10, duration: 100, playing: true });
        expect(runtime.getRemotePlaybackDuration()).toBe(100);
        await runtime.commandRemotePlayback('seek', 40);
        expect(runtime.getRemotePlaybackTime()).toBeGreaterThanOrEqual(40);
        await runtime.stopRemotePlayback();
        expect(runtime.getRemotePlaybackDuration()).toBe(0);
        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
        unsubscribe();
        runtime.updateRemotePlaybackClock({ mediaId: '1', position: 1, duration: 100, playing: true });
        expect(listener.mock.calls.length).toBeLessThanOrEqual(5);
    });
});

describe('remote playback ownership', () => {
    it('queues a stop behind a pending start so late replies cannot restart playback', async () => {
        let release!: () => void;
        start.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        const runtime = await import('@/services/remotePlayback');
        const pending = runtime.startRemotePlayback(song('1'));
        await vi.waitFor(() => expect(start).toHaveBeenCalled());
        const stopped = runtime.stopRemotePlayback();
        expect(runtime.isRemotePlaybackActive()).toBe(false);
        release();
        await expect(pending).resolves.toBe(false);
        await stopped;
        expect(command).toHaveBeenCalledWith(song('1'), 'pause');
    });
    it('suppresses obsolete starts when two songs are selected quickly', async () => {
        const runtime = await import('@/services/remotePlayback');
        const first = runtime.startRemotePlayback(song('1'));
        const second = runtime.startRemotePlayback(song('2'));
        expect(await first).toBe(false);
        expect(await second).toBe(true);
        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith(song('2'), { continueIfCurrent: false });
    });
    it('freezes the clock on pause and clamps extrapolation when updates stop', async () => {
        const runtime = await import('@/services/remotePlayback');
        await runtime.startRemotePlayback(song('1'));
        runtime.updateRemotePlaybackClock({ mediaId: '1', position: 3, duration: 10, playing: true });
        await runtime.commandRemotePlayback('pause');
        const paused = runtime.getRemotePlaybackTime();
        expect(runtime.getRemotePlaybackTime()).toBe(paused);
        await runtime.commandRemotePlayback('seek', 7);
        expect(runtime.getRemotePlaybackTime()).toBe(7);
        await runtime.stopRemotePlayback();
        expect(runtime.getRemotePlaybackTime()).toBe(0);
    });
});
