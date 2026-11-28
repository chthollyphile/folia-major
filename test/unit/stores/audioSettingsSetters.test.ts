// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
const storage = vi.hoisted(() => {
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
    return items;
});

import i18n from '@/i18n/config';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';

// test/unit/stores/audioSettingsSetters.test.ts
// The set-to-a-value forms of mute and repeat mode (Folium's playback.setMuted /
// setLoopMode call them) and the toggles that now delegate to them: one place
// persists and toasts, the value already in effect writes nothing and toasts
// nothing, and the toggles behave exactly as before.

const initialAudio = useAudioSettingsStore.getState();

beforeEach(() => {
    useAudioSettingsStore.setState(initialAudio, true);
    useStatusMessageStore.setState({ message: null });
    storage.clear();
});

describe('handleSetMuted', () => {
    it('sets and persists the mute switch, leaving the volume alone', () => {
        useAudioSettingsStore.setState({ volume: 0.5, isMuted: false });
        useAudioSettingsStore.getState().handleSetMuted(true);
        expect(useAudioSettingsStore.getState()).toMatchObject({ isMuted: true, volume: 0.5 });
        expect(storage.get('player_is_muted')).toBe('true');
    });

    it('writes nothing for the value already in effect', () => {
        useAudioSettingsStore.setState({ isMuted: true });
        useAudioSettingsStore.getState().handleSetMuted(true);
        expect(storage.has('player_is_muted')).toBe(false);
    });

    it('backs the toggle, which still flips and persists', () => {
        useAudioSettingsStore.setState({ isMuted: false });
        useAudioSettingsStore.getState().handleToggleMute();
        expect(useAudioSettingsStore.getState().isMuted).toBe(true);
        expect(storage.get('player_is_muted')).toBe('true');
        useAudioSettingsStore.getState().handleToggleMute();
        expect(useAudioSettingsStore.getState().isMuted).toBe(false);
        expect(storage.get('player_is_muted')).toBe('false');
    });
});

describe('handleSetVolume', () => {
    it('releases mute when raised above zero, persisting both', () => {
        useAudioSettingsStore.setState({ volume: 1, isMuted: true });
        useAudioSettingsStore.getState().handleSetVolume(0.6);
        expect(useAudioSettingsStore.getState()).toMatchObject({ isMuted: false, volume: 0.6 });
        expect(storage.get('player_volume')).toBe('0.6');
        expect(storage.get('player_is_muted')).toBe('false');
    });

    it('keeps the mute switch when set to zero', () => {
        useAudioSettingsStore.setState({ isMuted: true });
        useAudioSettingsStore.getState().handleSetVolume(0);
        expect(useAudioSettingsStore.getState()).toMatchObject({ isMuted: true, volume: 0 });
        expect(storage.has('player_is_muted')).toBe(false);
    });

    it('leaves the unmuted state alone', () => {
        useAudioSettingsStore.setState({ isMuted: false });
        useAudioSettingsStore.getState().handleSetVolume(0.8);
        expect(useAudioSettingsStore.getState()).toMatchObject({ isMuted: false, volume: 0.8 });
        expect(storage.has('player_is_muted')).toBe(false);
    });
});

describe('handleSetLoopMode', () => {
    it('sets, persists and toasts the new mode', () => {
        useAudioSettingsStore.setState({ loopMode: 'off' });
        useAudioSettingsStore.getState().handleSetLoopMode('one');
        expect(useAudioSettingsStore.getState().loopMode).toBe('one');
        expect(storage.get('player_loop_mode')).toBe('one');
        expect(useStatusMessageStore.getState().message).toMatchObject({
            type: 'success',
            text: i18n.t('player.loopOne'),
            nonce: expect.any(Number),
        });
    });

    it('writes and toasts nothing for the mode already in effect', () => {
        useAudioSettingsStore.setState({ loopMode: 'all' });
        useAudioSettingsStore.getState().handleSetLoopMode('all');
        expect(storage.has('player_loop_mode')).toBe(false);
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('backs the toggle, which still cycles off, all, one and toasts each step', () => {
        useAudioSettingsStore.setState({ loopMode: 'off' });
        const seen: [string, string | undefined][] = [];
        for (let press = 0; press < 3; press += 1) {
            useAudioSettingsStore.getState().handleToggleLoopMode();
            seen.push([useAudioSettingsStore.getState().loopMode, useStatusMessageStore.getState().message?.text]);
        }
        expect(seen).toEqual([
            ['all', i18n.t('player.loopAll')],
            ['one', i18n.t('player.loopOne')],
            ['off', i18n.t('player.loopOff')],
        ]);
        expect(storage.get('player_loop_mode')).toBe('off');
    });
});
