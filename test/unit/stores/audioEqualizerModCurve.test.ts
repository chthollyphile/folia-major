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

import { AUDIO_EQUALIZER_MOD_CURVE_KEY, useAudioSettingsStore, type AudioSettingsState } from '@/stores/useAudioSettingsStore';
import { AUDIO_EQUALIZER_STORAGE_KEY, resolveAudioEqualizerSettings, type AudioEqualizerSettings } from '@/utils/audioEqualizer';
import { createNeutralAudioEffects, normalizeAudioEffects } from '@/utils/audioEffects';
import { AUDIO_SOUND_PRESETS } from '@/utils/audioPresets';
import { serializeAudioEqualizerModCurve } from '@/utils/audioEqualizerModCurve';

// test/unit/stores/audioEqualizerModCurve.test.ts
// A mod's equalizer curve in the audio settings store (Folium 1.7): a layer of its own over the listener's
// sound, which is never written by it; every equalizer action ends or keeps it as the spec says, says
// whether anything changed (and when nothing did, neither sets nor saves), and writes who made the change in
// the same set. At start the saved curve comes back only over the sound it was put on, and a later
// version's value is left where it is.

const initial = useAudioSettingsStore.getState();
const store = () => useAudioSettingsStore.getState();
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

/** Puts the listener's own sound in place as if it had been read at start, saved under its key. */
const startWith = (settings: AudioEqualizerSettings) => {
    useAudioSettingsStore.setState({ audioEqualizerSettings: settings });
    storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify(settings));
};

const applySmile = (modId = 'eq-mod') => store().handleApplyModEqualizerCurve({ modId, modName: 'EQ mod', gains: SMILE });

/** Counts the store's sets from here on, keeping each state a listener saw. */
const watchSets = () => {
    const seen: AudioSettingsState[] = [];
    const stop = useAudioSettingsStore.subscribe((state) => { seen.push(state); });
    return { seen, stop };
};

beforeEach(() => {
    useAudioSettingsStore.setState(initial, true);
    storage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a mod\'s curve', () => {
    it('is saved under its own key and leaves the listener\'s settings untouched', () => {
        startWith(ownSound({ enabled: false }));
        const settingsBefore = storage.get(AUDIO_EQUALIZER_STORAGE_KEY);
        useAudioSettingsStore.setState({ audioEqualizerModCurveSuspended: true });

        expect(applySmile()).toBe(true);
        expect(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)).toBe(settingsBefore);
        expect(store().audioEqualizerSettings).toEqual(ownSound({ enabled: false }));
        expect(store().audioEqualizerSettings.enabled).toBe(false);
        expect(store().audioEqualizerModCurve).toMatchObject({ modId: 'eq-mod', modName: 'EQ mod', gains: SMILE });
        expect(store().audioEqualizerModCurveSuspended).toBe(false);
        expect(JSON.parse(storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY)!)).toMatchObject({
            v: 1, modId: 'eq-mod', gains: SMILE, base: { preset: 'custom1', gains: ownSound().gains },
        });
    });

    it('comes off whole: the listener\'s sound is what it was, and the key is gone', () => {
        startWith(ownSound());
        const before = structuredClone(store().audioEqualizerSettings);
        applySmile();

        expect(store().handleReleaseModEqualizerCurve({ kind: 'user' })).toBe(true);
        expect(store().audioEqualizerSettings).toEqual(before);
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(false);
        expect(store().handleReleaseModEqualizerCurve({ kind: 'user' })).toBe(false);
    });
});

describe('the sound commands', () => {
    it('with keepEnabled leave the switch off, write no slot and end the curve', () => {
        startWith(ownSound({ enabled: false }));
        applySmile();

        expect(store().handleApplyAudioSoundPreset('bass', { keepEnabled: true, origin: { kind: 'mod', modId: 'eq-mod' } })).toBe(true);
        expect(store().audioEqualizerSettings).toMatchObject({ enabled: false, preset: 'bass', gains: [...AUDIO_SOUND_PRESETS.bass.gains] });
        expect(store().audioEqualizerSettings.customSlots).toEqual(ownSound().customSlots);
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(false);
    });

    it('turn processing on when the palette picks the sound already chosen while it is off', () => {
        startWith(resolveAudioEqualizerSettings({ enabled: false, preset: 'bass', gains: [...AUDIO_SOUND_PRESETS.bass.gains], effects: AUDIO_SOUND_PRESETS.bass.effects }));

        expect(store().handleApplyAudioSoundPreset('bass')).toBe(true);
        expect(store().audioEqualizerSettings.enabled).toBe(true);
        expect(JSON.parse(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)!).enabled).toBe(true);
        expect(store().audioEqualizerChangeOrigin).toEqual({ kind: 'command' });
        // Now it is all in place: the same choice again changes nothing.
        expect(store().handleApplyAudioSoundPreset('bass')).toBe(false);
    });

    it('give an older Lo-Fi its effects when it is picked again, with or without keepEnabled', async () => {
        // Saved before the effect chain existed: the id is Lo-Fi, the chain neutral (audioEqualizer.ts).
        storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify({ enabled: true, preset: 'lofi', gains: [...AUDIO_SOUND_PRESETS.lofi.gains] }));
        for (const options of [undefined, { keepEnabled: true }]) {
            vi.resetModules();
            const { useAudioSettingsStore: fresh } = await import('@/stores/useAudioSettingsStore');
            expect(fresh.getState().audioEqualizerSettings).toMatchObject({ preset: 'lofi', effects: createNeutralAudioEffects() });

            expect(fresh.getState().handleApplyAudioSoundPreset('lofi', options)).toBe(true);
            expect(fresh.getState().audioEqualizerSettings.effects).toEqual(AUDIO_SOUND_PRESETS.lofi.effects);
            storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify({ enabled: true, preset: 'lofi', gains: [...AUDIO_SOUND_PRESETS.lofi.gains] }));
        }
    });
});

describe('the window\'s actions', () => {
    it('end the curve when they write the listener\'s settings', () => {
        startWith(ownSound());
        applySmile();
        expect(store().handleSetAudioEqualizerSettings(ownSound({ preset: 'custom2', gains: ownSound().customSlots[1].gains }))).toBe(true);
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(store().audioEqualizerChangeOrigin).toEqual({ kind: 'user' });
    });

    it('keep the curve when only the switch is flipped', () => {
        startWith(ownSound());
        applySmile();
        expect(store().handleSetAudioEqualizerEnabled(false)).toBe(true);
        expect(store().audioEqualizerSettings).toEqual(ownSound({ enabled: false }));
        expect(store().audioEqualizerModCurve).toMatchObject({ modId: 'eq-mod', gains: SMILE });
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(true);
        expect(store().audioEqualizerChangeOrigin).toEqual({ kind: 'user' });
    });

    it('save the curve into the one slot asked for, choose it, end the curve and leave the switch', () => {
        startWith(ownSound({ enabled: false }));
        applySmile();
        expect(store().handleSaveModEqualizerCurveToSlot('custom2')).toBe(true);
        const settings = store().audioEqualizerSettings;
        expect(settings).toMatchObject({ enabled: false, preset: 'custom2', gains: SMILE, effects: ownSound().effects });
        expect(settings.customSlots[1]).toEqual({ gains: SMILE, effects: ownSound().effects });
        expect(settings.customSlots[0]).toEqual(ownSound().customSlots[0]);
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(store().audioEqualizerChangeOrigin).toEqual({ kind: 'user' });
        expect(store().handleSaveModEqualizerCurveToSlot('custom1')).toBe(false);
    });
});

describe('holding a curve back', () => {
    it('does nothing without a curve', () => {
        const { seen, stop } = watchSets();
        expect(store().handleSetAudioEqualizerModCurveSuspended(true)).toBe(false);
        expect(store().audioEqualizerModCurveSuspended).toBe(false);
        expect(seen).toHaveLength(0);
        stop();
    });

    it('flips with a curve, as the host, and saves nothing', () => {
        startWith(ownSound());
        applySmile();
        const savedCurve = storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY);
        expect(store().handleSetAudioEqualizerModCurveSuspended(true)).toBe(true);
        expect(store().audioEqualizerModCurveSuspended).toBe(true);
        expect(store().audioEqualizerChangeOrigin).toEqual({ kind: 'host' });
        expect(storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(savedCurve);
        expect(store().handleSetAudioEqualizerModCurveSuspended(true)).toBe(false);
        expect(store().handleSetAudioEqualizerModCurveSuspended(false)).toBe(true);
        expect(store().audioEqualizerModCurveSuspended).toBe(false);
    });

    it('is let go with the curve: a curve that is cleared while held back leaves nothing held back', () => {
        startWith(ownSound());
        applySmile();
        store().handleSetAudioEqualizerModCurveSuspended(true);
        store().handleApplyAudioSoundPreset('flat');
        expect(store().audioEqualizerModCurve).toBeNull();
        expect(store().audioEqualizerModCurveSuspended).toBe(false);
    });
});

describe('who changed it', () => {
    it('is written by each action in the same set as the change', () => {
        startWith(ownSound());
        const steps: Array<[string, () => boolean, AudioSettingsState['audioEqualizerChangeOrigin']]> = [
            ['a mod\'s curve', () => applySmile(), { kind: 'mod', modId: 'eq-mod' }],
            ['the switch', () => store().handleSetAudioEqualizerEnabled(false), { kind: 'user' }],
            ['held back', () => store().handleSetAudioEqualizerModCurveSuspended(true), { kind: 'host' }],
            ['a command', () => store().handleApplyAudioSoundPreset('vocal'), { kind: 'command' }],
            ['another mod\'s curve', () => applySmile('other-mod'), { kind: 'mod', modId: 'other-mod' }],
            ['released by a command', () => store().handleReleaseModEqualizerCurve({ kind: 'command' }), { kind: 'command' }],
            ['the window', () => store().handleSetAudioEqualizerSettings(ownSound()), { kind: 'user' }],
            ['the switch for a host command', () => store().handleSetAudioEqualizerEnabled(false, { kind: 'command' }), { kind: 'command' }],
        ];
        for (const [what, step, origin] of steps) {
            const before = store();
            const { seen, stop } = watchSets();
            expect(step(), what).toBe(true);
            stop();
            expect(seen, what).toHaveLength(1);
            expect(seen[0].audioEqualizerChangeOrigin, what).toEqual(origin);
            const changed = seen[0].audioEqualizerSettings !== before.audioEqualizerSettings
                || seen[0].audioEqualizerModCurve !== before.audioEqualizerModCurve
                || seen[0].audioEqualizerModCurveSuspended !== before.audioEqualizerModCurveSuspended;
            expect(changed, what).toBe(true);
        }
    });

    it('is not touched by opening or closing the window', () => {
        startWith(ownSound());
        applySmile();
        const origin = store().audioEqualizerChangeOrigin;
        store().openAudioEqualizer();
        expect(store().audioEqualizerChangeOrigin).toBe(origin);
        store().closeAudioEqualizer();
        expect(store().audioEqualizerChangeOrigin).toBe(origin);
    });
});

describe('a call that changes nothing', () => {
    it('neither sets nor saves, and says so', () => {
        startWith(ownSound());
        applySmile();
        store().handleSetAudioEqualizerModCurveSuspended(true);
        const settingsBytes = storage.get(AUDIO_EQUALIZER_STORAGE_KEY);
        const curveBytes = storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY);
        const setItem = vi.spyOn(localStorage, 'setItem');
        const removeItem = vi.spyOn(localStorage, 'removeItem');
        const { seen, stop } = watchSets();

        expect(applySmile()).toBe(false);
        expect(store().handleApplyModEqualizerCurve({ modId: 'eq-mod', modName: 'renamed', gains: [4.04, 3, 1, 0, -1, -1, 0, 1, 3, 4] })).toBe(false);
        expect(store().handleSetAudioEqualizerEnabled(true)).toBe(false);
        expect(store().handleSetAudioEqualizerModCurveSuspended(true)).toBe(false);
        stop();

        expect(seen).toHaveLength(0);
        expect(setItem).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
        expect(storage.get(AUDIO_EQUALIZER_STORAGE_KEY)).toBe(settingsBytes);
        expect(storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(curveBytes);
    });

    it('includes the same settings written again while no curve is in place', () => {
        startWith(ownSound());
        const { seen, stop } = watchSets();
        expect(store().handleSetAudioEqualizerSettings(ownSound())).toBe(false);
        expect(store().handleReleaseModEqualizerCurve({ kind: 'user' })).toBe(false);
        expect(store().handleApplyAudioSoundPreset('custom1')).toBe(false);
        stop();
        expect(seen).toHaveLength(0);
    });

    it('does not include ending a curve, also one that is held back', () => {
        startWith(ownSound());
        applySmile();
        store().handleSetAudioEqualizerModCurveSuspended(true);
        // The listener's settings would stay the same; the curve record does not.
        expect(store().handleSetAudioEqualizerSettings(ownSound())).toBe(true);
        expect(store().audioEqualizerModCurve).toBeNull();
    });
});

describe('the curve kept from the last run', () => {
    const reopen = async () => {
        vi.resetModules();
        return (await import('@/stores/useAudioSettingsStore')).useAudioSettingsStore.getState();
    };
    const savedCurve = (settings: AudioEqualizerSettings, overrides: Record<string, unknown> = {}) => ({
        ...JSON.parse(serializeAudioEqualizerModCurve({
            modId: 'eq-mod',
            modName: 'EQ mod',
            gains: SMILE,
            base: { preset: settings.preset, gains: settings.gains, effects: settings.effects },
        })),
        ...overrides,
    });

    it('comes back over the sound it was put on', async () => {
        const settings = ownSound();
        storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify(settings));
        storage.set(AUDIO_EQUALIZER_MOD_CURVE_KEY, JSON.stringify(savedCurve(settings)));
        const state = await reopen();
        expect(state.audioEqualizerModCurve).toMatchObject({ modId: 'eq-mod', modName: 'EQ mod', gains: SMILE });
        expect(state.audioEqualizerModCurveSuspended).toBe(false);
        expect(state.audioEqualizerSettings).toEqual(settings);
    });

    it('also with the switch flipped since', async () => {
        const settings = ownSound();
        storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify({ ...settings, enabled: false }));
        storage.set(AUDIO_EQUALIZER_MOD_CURVE_KEY, JSON.stringify(savedCurve(settings)));
        expect((await reopen()).audioEqualizerModCurve).not.toBeNull();
    });

    it('is dropped, key and all, when the listener\'s sound changed since', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const settings = ownSound();
        storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify({ ...settings, preset: 'custom2', gains: settings.customSlots[1].gains }));
        storage.set(AUDIO_EQUALIZER_MOD_CURVE_KEY, JSON.stringify(savedCurve(settings)));
        expect((await reopen()).audioEqualizerModCurve).toBeNull();
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(false);
        expect(info).toHaveBeenCalledWith('[AudioEqualizer] dropped the curve of eq-mod: your own sound changed since it was applied');
    });

    it('is dropped when it cannot be read', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        storage.set(AUDIO_EQUALIZER_MOD_CURVE_KEY, '{"v":1,"modId":');
        expect((await reopen()).audioEqualizerModCurve).toBeNull();
        expect(storage.has(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(false);
    });

    it('is not used, and stays saved, when a later version wrote it', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const settings = ownSound();
        const later = JSON.stringify(savedCurve(settings, { v: 2 }));
        storage.set(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify(settings));
        storage.set(AUDIO_EQUALIZER_MOD_CURVE_KEY, later);
        expect((await reopen()).audioEqualizerModCurve).toBeNull();
        expect(storage.get(AUDIO_EQUALIZER_MOD_CURVE_KEY)).toBe(later);
        expect(info).toHaveBeenCalledWith('[AudioEqualizer] kept a mod curve saved by a later version (v=2); not used here');
    });
});
