// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '../../../src/types';
import { useRemoteSeekRevision } from '../../../src/components/remote/useRemoteSeekRevision';
import { MediaShim } from '../../../src/services/mediaShim';
import { useRemoteClock, type RemoteClock } from '../../../src/components/remote/useRemoteClock';

// test/unit/remote/remoteLyricStuck.test.ts
// The remote window's lyric stuck on one line: the clock ran back a little at every snapshot that
// took longer to arrive than the one before, so a line boundary could flip A -> B -> A within a
// few frames.

let root: Root | null = null;
let host: HTMLElement | null = null;

const render = async (element: React.ReactElement) => {
    if (!root) {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(element);
    });
};

afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
});

describe('remote clock', () => {
    it('does not run back when a snapshot takes longer to arrive than the one before', async () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + now);

        let clock: RemoteClock | null = null;
        const Probe: React.FC<{ updatedAt: number; currentTime: number }> = ({ updatedAt, currentTime }) => {
            clock = useRemoteClock({ updatedAt, currentTime, duration: 200, playerState: PlayerState.PLAYING });
            return null;
        };
        // The main window reads 10 s at 1000 ms; it arrives 10 ms later.
        now = 1010;
        await render(React.createElement(Probe, { updatedAt: 1_700_000_000_000 + 1000, currentTime: 10 }));
        // It reads 10.5 s at 1500 ms; this one arrives 60 ms later.
        now = 1560;
        const before = clock!.getTime();
        await render(React.createElement(Probe, { updatedAt: 1_700_000_000_000 + 1500, currentTime: 10.5 }));
        const after = clock!.getTime();
        expect(after).toBeGreaterThanOrEqual(before);
        // The time is the player's time now, not the time it had when the snapshot left.
        expect(after).toBeCloseTo(10.56, 6);
    });
    it('holds coarse samples across playing, buffering pause and resume without reversing lyric time', async () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + now);
        let clock!: RemoteClock;
        const Probe = ({ time, playing = true }: { time: number; playing?: boolean }) => {
            clock = useRemoteClock({ updatedAt: Date.now(), currentTime: time, duration: 200,
                playerState: playing ? PlayerState.PLAYING : PlayerState.PAUSED, trackKey: 'a' });
            return null;
        };
        await render(React.createElement(Probe, { time: 10 }));
        now = 1500;
        const before = clock.getTime();
        await render(React.createElement(Probe, { time: 10 }));
        expect(clock.getTime()).toBeGreaterThanOrEqual(before);
        await render(React.createElement(Probe, { time: 10, playing: false }));
        expect(clock.getTime()).toBeGreaterThanOrEqual(before);
        now = 2000;
        await render(React.createElement(Probe, { time: 10, playing: true }));
        expect(clock.getTime()).toBeGreaterThanOrEqual(before);
        now = 2500;
        await render(React.createElement(Probe, { time: 11 }));
        // The resume ran on from the spot it showed, a little slower while ahead of the player: it is
        // on the player within the bend, and the next answer is not a step.
        expect(clock.getTime()).toBeGreaterThan(10.9);
        expect(clock.getTime()).toBeLessThanOrEqual(11);
    });

    it('continues smoothly after a repeated snapshot without renewing the stall deadline', async () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + now);
        let clock!: RemoteClock;
        const Probe = () => {
            clock = useRemoteClock({ updatedAt: Date.now(), currentTime: 10, duration: 200,
                playerState: PlayerState.PLAYING, trackKey: 'a' });
            return null;
        };
        await render(React.createElement(Probe));
        now = 1500;
        await render(React.createElement(Probe));
        now = 1750;
        expect(clock.getTime()).toBeCloseTo(10.75);
        now = 2500;
        await render(React.createElement(Probe));
        now = 3000;
        expect(clock.getTime()).toBe(11);
    });

    it('permits a small explicit seek and a same-duration new track to reset the clock', async () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + now);
        let clock!: RemoteClock;
        const Probe = ({ time, revision = 0, track = 'a' }: { time: number; revision?: number; track?: string }) => {
            clock = useRemoteClock({ updatedAt: Date.now(), currentTime: time, duration: 200,
                playerState: PlayerState.PLAYING, trackKey: track, clockRevision: revision });
            return null;
        };
        await render(React.createElement(Probe, { time: 10 }));
        now = 1500;
        await render(React.createElement(Probe, { time: 9.8, revision: 1 }));
        expect(clock.getTime()).toBeCloseTo(9.8);
        await render(React.createElement(Probe, { time: 0.7, revision: 1, track: 'b' }));
        await render(React.createElement(Probe, { time: 0, revision: 1, track: 'c' }));
        expect(clock.getTime()).toBeCloseTo(0);
        now = 10000;
        expect(clock.getTime()).toBeLessThanOrEqual(1);
    });

    it('allows the local released seek instead of smoothing it away', async () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(Date, 'now').mockImplementation(() => 1_700_000_000_000 + now);
        let clock!: RemoteClock;
        const Probe = ({ time }: { time: number }) => {
            clock = useRemoteClock({ updatedAt: Date.now(), currentTime: time, duration: 200, playerState: PlayerState.PLAYING });
            return null;
        };
        await render(React.createElement(Probe, { time: 10 }));
        clock.previewSeek(9.8);
        expect(clock.releaseSeek()).toBe(9.8);
        now = 1100;
        await render(React.createElement(Probe, { time: 9.8 }));
        expect(clock.getTime()).toBeCloseTo(9.8);
    });

    it('records intentional media changes without rendering and cleans old media listeners', async () => {
        const a = new MediaShim('test-a:'), b = new MediaShim('test-b:');
        let revision!: { current: number };
        let renders = 0;
        const Probe = ({ media }: { media: MediaShim }) => {
            renders++;
            revision = useRemoteSeekRevision(media);
            return null;
        };
        await render(React.createElement(Probe, { media: a }));
        const initial = revision.current;
        a.dispatchEvent(new Event('seeked'));
        expect(revision.current).toBe(initial + 1);
        expect(renders).toBe(1);
        await render(React.createElement(Probe, { media: b }));
        const switched = revision.current;
        a.dispatchEvent(new Event('seeked'));
        expect(revision.current).toBe(switched);
        b.dispatchEvent(new Event('loadedmetadata'));
        expect(revision.current).toBe(switched + 1);
        act(() => root?.unmount());
        root = null;
        b.dispatchEvent(new Event('seeked'));
        expect(revision.current).toBe(switched + 1);
    });

});
