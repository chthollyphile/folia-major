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

const pushRuntimeSnapshot = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/mods/ipc', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/mods/ipc')>()),
    isModsBridgeAvailable: () => true,
    pushRuntimeSnapshot,
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Theme } from '@/types';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { useFoliumHostBridge } from '@/mods/runtime/hostBridge';
import type { ModRuntimeSnapshot } from '@/mods/types';

// test/unit/mod-system/foliumRuntimeSnapshot.test.ts
// The snapshot main entries read with api.runtime.getPlaybackSnapshot(): the
// Folium 1.5 fields volume (clamped to 0–1), muted and loopMode come from the
// audio settings store, and a change to any of them re-pushes the snapshot.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = () => {
    useFoliumHostBridge({} as Theme, false);
    return null;
};

let root: Root | null = null;
const lastPublic = () => {
    const calls = pushRuntimeSnapshot.mock.calls as unknown as [ModRuntimeSnapshot][];
    return calls[calls.length - 1]?.[0].public;
};
const settle = () => act(() => { vi.advanceTimersByTime(200); });

beforeEach(() => {
    vi.useFakeTimers();
    pushRuntimeSnapshot.mockClear();
    useAudioSettingsStore.setState({ volume: 0.4, isMuted: true, loopMode: 'one' });
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe)));
    settle();
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.useRealTimers();
});

describe('main-entry playback snapshot', () => {
    it('carries volume, muted and loopMode', () => {
        expect(lastPublic()).toMatchObject({ volume: 0.4, muted: true, loopMode: 'one' });
    });

    it('re-pushes when any of them changes', () => {
        const pushes = pushRuntimeSnapshot.mock.calls.length;
        act(() => useAudioSettingsStore.getState().handleSetVolume(0.7));
        settle();
        expect(pushRuntimeSnapshot.mock.calls.length).toBe(pushes + 1);
        expect(lastPublic()).toMatchObject({ volume: 0.7, muted: true, loopMode: 'one' });

        act(() => useAudioSettingsStore.getState().handleSetMuted(false));
        settle();
        expect(lastPublic()).toMatchObject({ volume: 0.7, muted: false });

        act(() => useAudioSettingsStore.getState().handleSetLoopMode('all'));
        settle();
        expect(lastPublic()).toMatchObject({ loopMode: 'all' });
        expect(pushRuntimeSnapshot.mock.calls.length).toBe(pushes + 3);
    });

    it('clamps a stored volume outside 0–1', () => {
        act(() => useAudioSettingsStore.setState({ volume: 1.6 }));
        settle();
        expect(lastPublic()?.volume).toBe(1);
    });
});
