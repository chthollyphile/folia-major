// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SongResult, Theme } from '@/types';
import { PlayerState } from '@/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { currentTime } from '@/stores/motionSignals';
import { useFoliumHostBridge } from '@/mods/folium/hostBridge';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';

// test/unit/mod-system/foliumSeekDetection.test.ts
// playback.seeked is inferred from position jumps (useFoliumHostBridge). It
// must stay quiet on resume-after-pause and on track changes, and still report
// a seek that cancels an automix blend, where the displayed song flips away and
// back inside the same tick.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = (id: number) => ({ id, name: `s${id}`, artists: [], album: { name: '' } }) as unknown as SongResult;

const Probe = () => {
    useFoliumHostBridge({} as Theme, false);
    return null;
};

let root: Root | null = null;
let now = 0;
const seeked = vi.fn();

const flushMicrotasks = () => act(async () => { await Promise.resolve(); });

beforeEach(async () => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    act(() => {
        usePlaybackStore.setState({ currentSong: song(1), transitionDisplay: null, playerState: PlayerState.PLAYING });
        currentTime.set(10);
    });
    seeked.mockClear();
    addFoliumEventHandler('mod-a', 'playback.seeked', seeked);
    root = createRoot(document.createElement('div'));
    await act(async () => { root!.render(React.createElement(Probe)); });
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    removeFoliumEventHandlers('mod-a');
    vi.restoreAllMocks();
});

describe('playback.seeked detection', () => {
    it('reports a jump while playing', async () => {
        now += 100;
        currentTime.set(60);
        await flushMicrotasks();
        expect(seeked).toHaveBeenCalledWith({ position: 60 });
    });

    it('stays quiet when playback resumes after a long pause', async () => {
        act(() => usePlaybackStore.setState({ playerState: PlayerState.PAUSED }));
        now += 10_000;
        act(() => usePlaybackStore.setState({ playerState: PlayerState.PLAYING }));
        now += 250;
        currentTime.set(10.25);
        await flushMicrotasks();
        expect(seeked).not.toHaveBeenCalled();
    });

    it('stays quiet when a new track resets the position, in either order', async () => {
        now += 100;
        act(() => {
            currentTime.set(0);
            usePlaybackStore.setState({ currentSong: song(2) });
        });
        await flushMicrotasks();
        now += 30_000;
        currentTime.set(30);
        await flushMicrotasks();
        seeked.mockClear();
        now += 100;
        act(() => {
            usePlaybackStore.setState({ currentSong: song(3) });
            currentTime.set(0);
        });
        await flushMicrotasks();
        expect(seeked).not.toHaveBeenCalled();
    });

    it('reports a seek that cancels an automix blend', async () => {
        // Blend in progress: the outgoing track (1) is held on screen while the arriving one (2) loads.
        act(() => usePlaybackStore.setState({
            currentSong: song(2),
            transitionDisplay: { song: song(1), lyrics: null, coverUrl: null, duration: 200 },
        }));
        await flushMicrotasks();
        now += 100;
        currentTime.set(180);
        await flushMicrotasks();
        seeked.mockClear();
        // cancelBlendToDisplayedTrack + seek: drop the hold, put the outgoing track back, seek it.
        now += 100;
        act(() => {
            usePlaybackStore.setState({ transitionDisplay: null });
            usePlaybackStore.setState({ currentSong: song(1) });
            currentTime.set(120);
        });
        await flushMicrotasks();
        expect(seeked).toHaveBeenCalledWith({ position: 120 });
    });
});
