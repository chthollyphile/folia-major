// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '../../../src/types';
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
});
