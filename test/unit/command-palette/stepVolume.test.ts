// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see audioSettingsSetters.test.ts.
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

import { buildPlaybackCommandContext, type PlaybackCommandContextDeps } from '@/components/app/command-palette-context/buildAppOwnedCommandContext';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';

// test/unit/command-palette/stepVolume.test.ts
// Volume up and down from the palette or a global shortcut: each step starts from the store's value
// at the press, stays within 0–1 on a whole percent, and turning it up unmutes.

const stepVolume = (delta: number) => buildPlaybackCommandContext({} as PlaybackCommandContextDeps).stepVolume(delta);

describe('stepVolume', () => {
    beforeEach(() => {
        useAudioSettingsStore.setState({ volume: 0.5, isMuted: false });
    });

    it('starts each step where the last one ended, even from one built context', () => {
        const context = buildPlaybackCommandContext({} as PlaybackCommandContextDeps);
        context.stepVolume(0.05);
        context.stepVolume(0.05);
        expect(useAudioSettingsStore.getState().volume).toBe(0.6);
    });

    it('stays within 0 and 1 on a whole percent', () => {
        useAudioSettingsStore.setState({ volume: 0.98 });
        stepVolume(0.05);
        expect(useAudioSettingsStore.getState().volume).toBe(1);

        useAudioSettingsStore.setState({ volume: 0.03 });
        stepVolume(-0.05);
        expect(useAudioSettingsStore.getState().volume).toBe(0);

        useAudioSettingsStore.setState({ volume: 0.1 });
        stepVolume(0.05);
        expect(useAudioSettingsStore.getState().volume).toBe(0.15);
    });

    it('unmutes when turned up, and leaves mute alone when turned down', () => {
        useAudioSettingsStore.setState({ isMuted: true });
        stepVolume(-0.05);
        expect(useAudioSettingsStore.getState().isMuted).toBe(true);
        stepVolume(0.05);
        expect(useAudioSettingsStore.getState().isMuted).toBe(false);
    });
});
