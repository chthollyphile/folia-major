// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see audioSettingsSetters.test.ts.
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
import { queueLoopMode } from '@/utils/playbackNeighbors';
import { loopToggleDisabledIn } from '@/components/shared/loopModeDisplay';

// test/unit/stores/fmLoopMode.test.ts
// The loop control while Personal FM is on. FM decides its own next song, so the queue is played as
// if it never repeated (queueLoopMode answers off there), yet the loop button stayed live, showed the
// stored mode and wrote a new one on every press. Here the button is pinned to off, and a press in FM
// says why instead of changing the listener's preference.

const initialAudio = useAudioSettingsStore.getState();

beforeEach(() => {
    useAudioSettingsStore.setState(initialAudio, true);
    useStatusMessageStore.setState({ message: null });
    storage.clear();
});

describe('the queue loop mode in Personal FM', () => {
    it('plays the queue as if it never repeated, whatever the stored mode is', () => {
        for (const mode of ['off', 'all', 'one'] as const) {
            expect(queueLoopMode(mode, true)).toBe('off');
            expect(queueLoopMode(mode, false)).toBe(mode);
        }
    });
});

describe('the loop switch in Personal FM', () => {
    it('keeps the preference and says why a press did nothing', () => {
        useAudioSettingsStore.setState({ loopMode: 'all' });
        useAudioSettingsStore.getState().handleSetLoopMode('one', true);

        expect(useAudioSettingsStore.getState().loopMode).toBe('all');
        expect(storage.has('player_loop_mode')).toBe(false);
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'info', text: i18n.t('player.loopUnavailableInFm') });
    });

    it('cycles nothing and writes nothing', () => {
        useAudioSettingsStore.setState({ loopMode: 'all' });
        useAudioSettingsStore.getState().handleToggleLoopMode(true);

        expect(useAudioSettingsStore.getState().loopMode).toBe('all');
        expect(storage.has('player_loop_mode')).toBe(false);
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'info', text: i18n.t('player.loopUnavailableInFm') });
    });

    it('is unchanged outside Personal FM', () => {
        useAudioSettingsStore.setState({ loopMode: 'off' });
        useAudioSettingsStore.getState().handleToggleLoopMode(false);

        expect(useAudioSettingsStore.getState().loopMode).toBe('all');
        expect(storage.get('player_loop_mode')).toBe('all');
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'success', text: i18n.t('player.loopAll') });
    });
});

describe('the loop button in Personal FM', () => {
    it('is greyed out there, and only there or on a stage that owns playback', () => {
        expect(loopToggleDisabledIn(false, true)).toBe(true);
        expect(loopToggleDisabledIn(true, false)).toBe(true);
        expect(loopToggleDisabledIn(false, false)).toBe(false);
    });
});
