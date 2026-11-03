// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumEqualizerChangeOrigin, FoliumEqualizerService, FoliumEqualizerState, FoliumEqualizerUserMode } from '@/mods/folium/contract';
import { createFoliumClientApi } from '@/mods/folium/api';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import {
    FOLIUM_EQUALIZER_CUSTOM_IDS,
    FOLIUM_EQUALIZER_PRESET_IDS,
    registerFoliumEqualizerSource,
    resetFoliumEqualizerWriteLimitsForTest,
} from '@/mods/folium/equalizer/service';
import { FOLIUM_HOST_EQUALIZER_SOURCE, installFoliumHostEqualizer } from '@/mods/runtime/equalizer/hostEqualizer';
import { reconcileFoliumClients } from '@/mods/runtime/clientLoader';
import { AUDIO_EQUALIZER_STORAGE_KEY, resolveAudioEqualizerSettings, type AudioEqualizerSettings } from '@/utils/audioEqualizer';
import { normalizeAudioEffects } from '@/utils/audioEffects';
import { AUDIO_SOUND_PRESETS } from '@/utils/audioPresets';
import { AUDIO_EQUALIZER_MOD_CURVE_KEY, useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumEqualizer.test.ts
// Folium 1.7 `folium.equalizer` and `equalizer.changed`, end to end over the real audio settings store and
// the real host source: the frozen state as it is heard; a curve held back while its mod is disabled or
// removed in the mod list (a reload changes nothing); the checks in the contract's order, a write that
// changes nothing accepted whatever else holds; the allowance per mod; one event per task with the origin a
// mod can step back by; and the toast that says which mod took the sound over, once.

installFoliumHostEqualizer();

const audio = () => useAudioSettingsStore.getState();
const initialAudio = audio();
const initialPlayback = usePlaybackStore.getState();
const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });
const SMILE = [4, 3, 1, 0, -1, -1, 0, 1, 3, 4];

const ownSound = (overrides: Partial<AudioEqualizerSettings> = {}): AudioEqualizerSettings => resolveAudioEqualizerSettings({
    enabled: true,
    preset: 'custom1',
    gains: [2, 2, 1, 0, 0, 0, 0, 1, 2, 2],
    effects: normalizeAudioEffects({ width: 1.2 }),
    customSlots: [
        { gains: [2, 2, 1, 0, 0, 0, 0, 1, 2, 2], effects: normalizeAudioEffects({ width: 1.2 }) },
        { gains: [-3, -3, 0, 0, 0, 0, 0, 0, -3, -3], effects: normalizeAudioEffects({ space: 0.3 }) },
    ],
    ...overrides,
});

const modInfo = (id: string, overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id, name: `Mod ${id}`, version: '1.0.0', author: null, description: null, permissions: ['equalizer.control'],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null,
    ...overrides,
});

const equalizerOf = (mod: ModRuntimeInfo, options = clientApiOptions('main')): FoliumEqualizerService => (
    createFoliumClientApi(mod, options).equalizer
);
const eqMod = () => equalizerOf(modInfo('eq-mod'));
const otherMod = () => equalizerOf(modInfo('other-mod'));

/* The main window's mod list, as reconcileFoliumClients gets it; no entry has a client, so nothing starts. */
const feedModList = (mods: ModRuntimeInfo[]) => {
    void reconcileFoliumClients(mods, 'main');
};
const DEFAULT_LIST = () => [modInfo('eq-mod'), modInfo('other-mod')];

const seen: Array<{ state: FoliumEqualizerState; origin: FoliumEqualizerChangeOrigin }> = [];
const listen = () => {
    addFoliumEventHandler('listener-mod', 'equalizer.changed', (event) => { seen.push(event); });
};

const toast = () => useStatusMessageStore.getState().message;

beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    storage.clear();
    useAudioSettingsStore.setState(initialAudio, true);
    usePlaybackStore.setState(initialPlayback, true);
    useAudioSettingsStore.setState({ audioEqualizerSettings: ownSound() });
    storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify(ownSound()));
    feedModList(DEFAULT_LIST());
    // What the resets set off goes out with no one listening.
    await flush();
    useStatusMessageStore.setState({ message: null });
    seen.length = 0;
});

afterEach(() => {
    removeFoliumEventHandlers('listener-mod');
    resetFoliumEqualizerWriteLimitsForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('getState', () => {
    it('is frozen, with the same frozen bands on every read', () => {
        const state = eqMod().getState();
        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.mode)).toBe(true);
        expect(Object.isFrozen(state.gains)).toBe(true);
        expect(Object.isFrozen(state.bands)).toBe(true);
        state.bands.forEach((band) => expect(Object.isFrozen(band)).toBe(true));
        expect(eqMod().getState().bands).toBe(state.bands);
    });

    it('describes ten bands from 31 Hz to 16 kHz, shelves at both ends, and the gain range', () => {
        const { bands, minGain, maxGain } = eqMod().getState();
        expect(bands.map((band) => band.frequency)).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
        expect(bands.map((band) => band.shape)).toEqual([
            'lowshelf', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'highshelf',
        ]);
        expect([minGain, maxGain]).toEqual([-12, 12]);
    });

    it('reports a custom sound, a built-in one and a mod\'s curve as their modes', () => {
        expect(eqMod().getState().mode).toEqual({ kind: 'custom', id: 'custom1' });
        audio().handleApplyAudioSoundPreset('bass');
        expect(eqMod().getState().mode).toEqual({ kind: 'preset', id: 'bass' });
        expect(eqMod().applyCurve(SMILE).ok).toBe(true);
        expect(eqMod().getState()).toMatchObject({ mode: { kind: 'mod', modId: 'eq-mod' }, gains: SMILE });
    });

    it('gives the gains also while processing is off, and nothing of the custom slots or the effects', () => {
        useAudioSettingsStore.setState({ audioEqualizerSettings: ownSound({ enabled: false }) });
        const state = eqMod().getState();
        expect(state.enabled).toBe(false);
        expect(state.gains).toEqual(ownSound().gains);
        expect(Object.keys(state).sort()).toEqual(['bands', 'enabled', 'gains', 'hostPlaysAudio', 'maxGain', 'minGain', 'mode', 'writable']);
    });

    it('is writable while the audio effects window is closed', () => {
        expect(eqMod().getState().writable).toBe(true);
        audio().openAudioEqualizer();
        expect(eqMod().getState().writable).toBe(false);
        audio().closeAudioEqualizer();
        expect(eqMod().getState().writable).toBe(true);
    });

    it('says whether the host\'s own audio plays: not during external Stage playback', () => {
        expect(eqMod().getState().hostPlaysAudio).toBe(true);
        usePlaybackStore.setState({ activePlaybackContext: 'stage', audioSrc: null });
        expect(eqMod().getState().hostPlaysAudio).toBe(false);
        usePlaybackStore.setState({ activePlaybackContext: 'stage', audioSrc: 'blob:stage-media' });
        expect(eqMod().getState().hostPlaysAudio).toBe(true);
        usePlaybackStore.setState({ activePlaybackContext: 'main', audioSrc: null });
        expect(eqMod().getState().hostPlaysAudio).toBe(true);
    });

    it('needs no permission', () => {
        expect(() => equalizerOf(modInfo('reader', { permissions: [] })).getState()).not.toThrow();
    });
});

describe('a curve whose mod is disabled or removed', () => {
    it('is held back while the mod list has its mod disabled, and plays again once it is enabled', async () => {
        expect(eqMod().applyCurve(SMILE).ok).toBe(true);
        await flush();
        listen();

        feedModList([modInfo('eq-mod', { enabled: false, status: 'disabled' }), modInfo('other-mod')]);
        expect(eqMod().getState()).toMatchObject({ mode: { kind: 'custom', id: 'custom1' }, gains: ownSound().gains });
        expect(audio().audioEqualizerModCurve).not.toBeNull();
        await flush();
        expect(seen.map((event) => event.origin)).toEqual([{ kind: 'host', modId: null }]);

        feedModList(DEFAULT_LIST());
        expect(eqMod().getState()).toMatchObject({ mode: { kind: 'mod', modId: 'eq-mod' }, gains: SMILE });
        await flush();
        expect(seen.map((event) => event.origin)).toEqual([{ kind: 'host', modId: null }, { kind: 'host', modId: null }]);
    });

    it('is held back while its mod is removed, or this run was started without mods', () => {
        eqMod().applyCurve(SMILE);
        feedModList([modInfo('other-mod')]);
        expect(eqMod().getState().mode).toEqual({ kind: 'custom', id: 'custom1' });
        feedModList(DEFAULT_LIST());
        expect(eqMod().getState().mode).toEqual({ kind: 'mod', modId: 'eq-mod' });
        feedModList([modInfo('eq-mod', { status: 'skipped' }), modInfo('other-mod')]);
        expect(eqMod().getState().mode).toEqual({ kind: 'custom', id: 'custom1' });
    });

    it('is not touched by the same list again, as when the mod reloads', async () => {
        eqMod().applyCurve(SMILE);
        await flush();
        listen();
        feedModList(DEFAULT_LIST());
        feedModList([modInfo('eq-mod', { clientUrl: null, version: '1.0.1' }), modInfo('other-mod')]);
        await flush();
        expect(seen).toEqual([]);
        expect(eqMod().getState().gains).toEqual(SMILE);
    });
});

describe('the checks', () => {
    it('refuse a write without equalizer.control', () => {
        const reader = equalizerOf(modInfo('reader', { permissions: [] }));
        expect(() => reader.setMode({ kind: 'preset', id: 'bass' })).toThrow('permission-denied:equalizer.control');
        expect(() => reader.applyCurve(SMILE)).toThrow('permission-denied:equalizer.control');
        expect(() => reader.releaseCurve()).toThrow('permission-denied:equalizer.control');
        expect(audio().audioEqualizerSettings).toEqual(ownSound());
    });

    it('throw in the export window, the permission first', () => {
        const exported = equalizerOf(modInfo('eq-mod'), clientApiOptions('export'));
        expect(() => exported.getState()).toThrow('equalizer-unavailable-in-export-context');
        expect(() => exported.setMode({ kind: 'preset', id: 'bass' })).toThrow('equalizer-unavailable-in-export-context');
        expect(() => exported.applyCurve(SMILE)).toThrow('equalizer-unavailable-in-export-context');
        expect(() => exported.releaseCurve()).toThrow('equalizer-unavailable-in-export-context');
        const reader = equalizerOf(modInfo('reader', { permissions: [] }), clientApiOptions('export'));
        expect(() => reader.applyCurve(SMILE)).toThrow('permission-denied:equalizer.control');
    });

    it('throw in the main window before the source is installed', () => {
        registerFoliumEqualizerSource(null);
        try {
            expect(() => eqMod().getState()).toThrow('equalizer-unavailable-in-main-context');
            expect(() => eqMod().applyCurve(SMILE)).toThrow('equalizer-unavailable-in-main-context');
        } finally {
            registerFoliumEqualizerSource(FOLIUM_HOST_EQUALIZER_SOURCE);
        }
    });

    it('answer `stopped` once the activation was torn down', () => {
        const stopped = equalizerOf(modInfo('eq-mod'), clientApiOptions('main', { stopped: () => true }));
        expect(stopped.setMode({ kind: 'preset', id: 'bass' })).toEqual({ ok: false, reason: 'stopped' });
        expect(stopped.applyCurve(SMILE)).toEqual({ ok: false, reason: 'stopped' });
        eqMod().applyCurve(SMILE);
        expect(stopped.releaseCurve()).toBe(false);
        expect(audio().audioEqualizerModCurve).not.toBeNull();
    });
});

describe('setMode', () => {
    it('switches the sound, writes no custom slot, leaves the switch and ends another mod\'s curve', () => {
        useAudioSettingsStore.setState({ audioEqualizerSettings: ownSound({ enabled: false }) });
        otherMod().applyCurve(SMILE);
        const result = eqMod().setMode({ kind: 'preset', id: 'bass' });
        expect(result).toMatchObject({ ok: true, state: { mode: { kind: 'preset', id: 'bass' }, enabled: false, gains: [...AUDIO_SOUND_PRESETS.bass.gains] } });
        expect(audio().audioEqualizerSettings.customSlots).toEqual(ownSound().customSlots);
        expect(audio().audioEqualizerSettings.effects).toEqual(AUDIO_SOUND_PRESETS.bass.effects);
        expect(audio().audioEqualizerModCurve).toBeNull();
        expect(JSON.parse(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)!)).toMatchObject({ preset: 'bass', enabled: false });
    });

    it('switches to one of the user\'s own sounds', () => {
        expect(eqMod().setMode({ kind: 'custom', id: 'custom2' })).toMatchObject({
            ok: true,
            state: { mode: { kind: 'custom', id: 'custom2' }, gains: ownSound().customSlots[1].gains },
        });
    });

    it('answers `unknown-mode` for a sound this host has not, also while the window is open', () => {
        const future = [{ kind: 'preset', id: 'jazz' }, { kind: 'future' }, { kind: 'custom', id: 'custom9' }] as unknown as FoliumEqualizerUserMode[];
        for (const mode of future) {
            expect(eqMod().setMode(mode), JSON.stringify(mode)).toEqual({ ok: false, reason: 'unknown-mode' });
        }
        audio().openAudioEqualizer();
        expect(eqMod().setMode(future[0])).toEqual({ ok: false, reason: 'unknown-mode' });
    });

    it('throws a TypeError for a malformed mode', () => {
        for (const mode of [{ kind: 'mod', modId: 'eq-mod' }, null, 'bass', { kind: 'preset', id: 5 }, { id: 'bass' }]) {
            expect(() => eqMod().setMode(mode as unknown as FoliumEqualizerUserMode), JSON.stringify(mode)).toThrow(TypeError);
        }
        expect(() => eqMod().setMode(null as unknown as FoliumEqualizerUserMode)).toThrow(/^invalid-arguments: /);
    });
});

describe('the contract\'s ids stay usable in 1.x', () => {
    it('takes every built-in and custom id the contract promises', () => {
        for (const id of FOLIUM_EQUALIZER_PRESET_IDS) {
            expect(FOLIUM_HOST_EQUALIZER_SOURCE.hasMode({ kind: 'preset', id }), id).toBe(true);
            resetFoliumEqualizerWriteLimitsForTest();
            expect(eqMod().setMode({ kind: 'preset', id }).ok, id).toBe(true);
        }
        for (const id of FOLIUM_EQUALIZER_CUSTOM_IDS) {
            expect(FOLIUM_HOST_EQUALIZER_SOURCE.hasMode({ kind: 'custom', id }), id).toBe(true);
            resetFoliumEqualizerWriteLimitsForTest();
            expect(eqMod().setMode({ kind: 'custom', id }).ok, id).toBe(true);
        }
    });
});

describe('applyCurve', () => {
    it('puts the normalized curve in place and leaves the user\'s settings as they are', () => {
        const before = storage.get(AUDIO_EQUALIZER_STORAGE_KEY);
        const result = eqMod().applyCurve([40, -40, 1.26]);
        expect(result).toMatchObject({ ok: true, state: { mode: { kind: 'mod', modId: 'eq-mod' }, gains: [12, -12, 1.3, 0, 0, 0, 0, 0, 0, 0] } });
        expect(audio().audioEqualizerSettings).toEqual(ownSound());
        expect(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)).toBe(before);
        expect(JSON.parse(storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY)!)).toMatchObject({ modId: 'eq-mod', modName: 'Mod eq-mod' });
    });

    it('throws a TypeError for gains it cannot take', () => {
        // A hole in the array is no number either (new Array(3), [1, , 3]), though forEach would skip it.
        for (const gains of [[], Array(11).fill(1), [1, Number.NaN], [1, Infinity], ['3'], 'flat', null, new Array(3), [1, , 3]]) {
            expect(() => eqMod().applyCurve(gains as unknown as number[]), JSON.stringify(gains)).toThrow(TypeError);
        }
        expect(audio().audioEqualizerModCurve).toBeNull();
    });
});

describe('the open window', () => {
    it('refuses a write that would change something, takes one that would not, and lets a mod release its curve', () => {
        eqMod().applyCurve(SMILE);
        resetFoliumEqualizerWriteLimitsForTest();
        audio().openAudioEqualizer();
        expect(eqMod().setMode({ kind: 'preset', id: 'bass' })).toEqual({ ok: false, reason: 'panel-open' });
        expect(eqMod().applyCurve([1])).toEqual({ ok: false, reason: 'panel-open' });
        expect(eqMod().applyCurve(SMILE)).toMatchObject({ ok: true, state: { gains: SMILE, writable: false } });
        expect(eqMod().releaseCurve()).toBe(true);
        expect(audio().audioEqualizerModCurve).toBeNull();
        expect(eqMod().setMode({ kind: 'custom', id: 'custom1' })).toMatchObject({ ok: true });
    });
});

describe('the allowance', () => {
    const at = (iso: string) => vi.setSystemTime(new Date(iso));

    it('refuses a second write within a second, and counts neither refused writes nor ones that change nothing', () => {
        vi.useFakeTimers();
        at('2026-10-21T08:00:00.000Z');
        expect(eqMod().applyCurve([1]).ok).toBe(true);
        at('2026-10-21T08:00:00.500Z');
        expect(eqMod().applyCurve([2])).toEqual({ ok: false, reason: 'rate-limited' });
        // The same curve again changes nothing: accepted in the cooldown, and not counted.
        expect(eqMod().applyCurve([1])).toMatchObject({ ok: true, state: { gains: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
        // A second after the one counted write, not after the refused one.
        at('2026-10-21T08:00:01.000Z');
        expect(eqMod().applyCurve([2]).ok).toBe(true);
    });

    it('takes 20 writes a minute', () => {
        vi.useFakeTimers();
        const start = Date.parse('2026-10-21T09:00:00.000Z');
        for (let index = 0; index < 20; index += 1) {
            vi.setSystemTime(start + index * 1000);
            expect(eqMod().applyCurve([(index + 1) / 10]).ok, String(index)).toBe(true);
        }
        vi.setSystemTime(start + 30_000);
        expect(eqMod().applyCurve([5])).toEqual({ ok: false, reason: 'rate-limited' });
        expect(eqMod().setMode({ kind: 'preset', id: 'bass' })).toEqual({ ok: false, reason: 'rate-limited' });
        vi.setSystemTime(start + 60_000);
        expect(eqMod().applyCurve([5]).ok).toBe(true);
    });

    it('is each mod\'s own, and the reset forgets it', () => {
        vi.useFakeTimers();
        at('2026-10-21T10:00:00.000Z');
        expect(eqMod().applyCurve([1]).ok).toBe(true);
        expect(otherMod().applyCurve([2]).ok).toBe(true);
        expect(eqMod().applyCurve([3])).toEqual({ ok: false, reason: 'rate-limited' });
        resetFoliumEqualizerWriteLimitsForTest();
        expect(eqMod().applyCurve([3]).ok).toBe(true);
    });
});

describe('releaseCurve', () => {
    it('takes off this mod\'s own curve, back to the sound before it', () => {
        audio().handleApplyAudioSoundPreset('hall');
        const before = structuredClone(audio().audioEqualizerSettings);
        eqMod().applyCurve(SMILE);
        expect(eqMod().releaseCurve()).toBe(true);
        expect(audio().audioEqualizerSettings).toEqual(before);
        expect(eqMod().getState().mode).toEqual({ kind: 'preset', id: 'hall' });
    });

    it('leaves another mod\'s curve, and answers false without one', () => {
        expect(eqMod().releaseCurve()).toBe(false);
        otherMod().applyCurve(SMILE);
        expect(eqMod().releaseCurve()).toBe(false);
        expect(audio().audioEqualizerModCurve?.modId).toBe('other-mod');
    });
});

describe('equalizer.changed', () => {
    it('comes once for all the writes of one task, from the mod', async () => {
        listen();
        eqMod().applyCurve(SMILE);
        resetFoliumEqualizerWriteLimitsForTest();
        eqMod().setMode({ kind: 'preset', id: 'bass' });
        await flush();
        expect(seen).toHaveLength(1);
        expect(seen[0].origin).toEqual({ kind: 'mod', modId: 'eq-mod' });
        expect(seen[0].state.mode).toEqual({ kind: 'preset', id: 'bass' });
        expect(Object.isFrozen(seen[0].origin)).toBe(true);
    });

    it('names the user for the window and the host command for the palette', async () => {
        listen();
        audio().handleSetAudioEqualizerSettings(ownSound({ preset: 'custom2', gains: ownSound().customSlots[1].gains }));
        await flush();
        audio().handleApplyAudioSoundPreset('vocal');
        await flush();
        expect(seen.map((event) => event.origin)).toEqual([{ kind: 'user', modId: null }, { kind: 'command', modId: null }]);
    });

    it('keeps the user as the origin when a new song follows in the same task, and says nothing for a new song alone', async () => {
        listen();
        audio().handleSetAudioEqualizerEnabled(false);
        usePlaybackStore.setState({ audioSrc: 'blob:next-song' });
        await flush();
        expect(seen.map((event) => event.origin)).toEqual([{ kind: 'user', modId: null }]);
        usePlaybackStore.setState({ audioSrc: 'blob:another-song' });
        await flush();
        expect(seen).toHaveLength(1);
    });

    it('comes from the host when the window opens and when it closes, and when the sound leaves for Stage', async () => {
        listen();
        audio().openAudioEqualizer();
        await flush();
        audio().closeAudioEqualizer();
        await flush();
        usePlaybackStore.setState({ activePlaybackContext: 'stage', audioSrc: null });
        await flush();
        expect(seen.map((event) => [event.origin.kind, event.state.writable, event.state.hostPlaysAudio])).toEqual([
            ['host', false, true],
            ['host', true, true],
            ['host', true, false],
        ]);
    });

    it('does not come for a change that changes nothing, or that ends where it began', async () => {
        listen();
        audio().handleSetAudioEqualizerSettings(ownSound());
        audio().handleSetAudioEqualizerEnabled(false);
        audio().handleSetAudioEqualizerEnabled(true);
        audio().openAudioEqualizer();
        audio().closeAudioEqualizer();
        await flush();
        expect(seen).toEqual([]);
    });

    it('tells a mod that starts listening nothing of what came before', async () => {
        audio().handleApplyAudioSoundPreset('vocal');
        await flush();
        listen();
        await flush();
        expect(seen).toEqual([]);
    });
});

describe('the toast', () => {
    it('says which mod switched the sound, and which put its curve in place', () => {
        eqMod().setMode({ kind: 'preset', id: 'bass' });
        expect(toast()).toMatchObject({
            type: 'info',
            text: i18n.t('notifications.equalizerModMode', { mod: 'Mod eq-mod', mode: i18n.t('ui.equalizerPreset.bass') }),
        });
        useStatusMessageStore.setState({ message: null });
        otherMod().applyCurve(SMILE);
        expect(toast()).toMatchObject({ type: 'info', text: i18n.t('notifications.equalizerModCurve', { mod: 'Mod other-mod' }) });
    });

    it('comes once for a mod that goes on switching or changing its own curve', () => {
        vi.useFakeTimers();
        const start = Date.parse('2026-10-21T11:00:00.000Z');
        vi.setSystemTime(start);
        eqMod().setMode({ kind: 'preset', id: 'bass' });
        expect(toast()).not.toBeNull();
        useStatusMessageStore.setState({ message: null });
        vi.setSystemTime(start + 2000);
        expect(eqMod().setMode({ kind: 'preset', id: 'vocal' }).ok).toBe(true);
        expect(toast()).toBeNull();
        vi.setSystemTime(start + 4000);
        eqMod().applyCurve(SMILE);
        vi.setSystemTime(start + 6000);
        eqMod().applyCurve([1, 2, 3]);
        expect(audio().audioEqualizerModCurve?.gains.slice(0, 3)).toEqual([1, 2, 3]);
        expect(toast()).toBeNull();
        expect(eqMod().releaseCurve()).toBe(true);
        expect(toast()).toBeNull();
    });

    it('comes again once the user changed the sound in between', () => {
        vi.useFakeTimers();
        const start = Date.parse('2026-10-21T12:00:00.000Z');
        vi.setSystemTime(start);
        eqMod().applyCurve(SMILE);
        useStatusMessageStore.setState({ message: null });
        audio().handleSetAudioEqualizerSettings(ownSound());
        vi.setSystemTime(start + 2000);
        eqMod().applyCurve(SMILE);
        expect(toast()).toMatchObject({ text: i18n.t('notifications.equalizerModCurve', { mod: 'Mod eq-mod' }) });
    });
});
