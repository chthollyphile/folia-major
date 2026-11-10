import { describe, expect, it } from 'vitest';
import { resolveAudioEqualizerSettings, type AudioEqualizerSettings } from '@/utils/audioEqualizer';
import { AUDIO_EFFECT_CONTROLS, createNeutralAudioEffects, normalizeAudioEffects } from '@/utils/audioEffects';
import { AUDIO_SOUND_PRESETS } from '@/utils/audioPresets';
import {
    areAudioEqualizerModCurvesEqual,
    isSameOwnSound,
    normalizeAudioEqualizerModCurveGains,
    parseStoredAudioEqualizerModCurve,
    resolveHeardAudioEqualizerSettings,
    saveAudioEqualizerModCurveToSlot,
    serializeAudioEqualizerModCurve,
    type AudioEqualizerModCurve,
} from '@/utils/audioEqualizerModCurve';

// test/unit/utils/audioEqualizerModCurve.test.ts
// The pure half of a mod's equalizer curve (Folium 1.7): what is heard with it, how its gains are
// normalized, when two curves are the same, whether the listener's sound is still the one it went on over,
// saving it into a custom slot, and reading the stored value back without throwing away a later version's.

const own = (overrides: Partial<AudioEqualizerSettings> = {}): AudioEqualizerSettings => resolveAudioEqualizerSettings({
    enabled: true,
    preset: 'hall',
    gains: [...AUDIO_SOUND_PRESETS.hall.gains],
    effects: AUDIO_SOUND_PRESETS.hall.effects,
    customSlots: [
        { gains: [3, 3, 3, 0, 0, 0, 0, 0, 0, 0], effects: normalizeAudioEffects({ drive: 0.3 }) },
        { gains: [-2, -2, 0, 0, 0, 0, 0, 0, 2, 2], effects: normalizeAudioEffects({ space: 0.2 }) },
    ],
    ...overrides,
});

const SMILE = [4, 3, 1, 0, -1, -1, 0, 1, 3, 4];

const curveOver = (settings: AudioEqualizerSettings, overrides: Partial<AudioEqualizerModCurve> = {}): AudioEqualizerModCurve => ({
    modId: 'eq-mod',
    modName: 'EQ mod',
    gains: [...SMILE],
    base: { preset: settings.preset, gains: [...settings.gains], effects: { ...settings.effects } },
    ...overrides,
});

describe('what is heard', () => {
    it('is the listener\'s own settings, the very object, without a curve or while it is held back', () => {
        const settings = own();
        expect(resolveHeardAudioEqualizerSettings(settings, null, false)).toBe(settings);
        expect(resolveHeardAudioEqualizerSettings(settings, undefined, undefined)).toBe(settings);
        expect(resolveHeardAudioEqualizerSettings(settings, curveOver(settings), true)).toBe(settings);
    });

    it('takes only the gains from a curve that plays', () => {
        const settings = own();
        const heard = resolveHeardAudioEqualizerSettings(settings, curveOver(settings), false);
        expect(heard.gains).toEqual(SMILE);
        expect(heard).toMatchObject({ preset: 'hall', enabled: true, effects: settings.effects, customSlots: settings.customSlots });
        // The listener's own gains are left as they were.
        expect(settings.gains).toEqual([...AUDIO_SOUND_PRESETS.hall.gains]);
        expect(resolveHeardAudioEqualizerSettings(own({ enabled: false }), curveOver(settings), undefined).enabled).toBe(false);
    });
});

describe('a mod\'s gains', () => {
    it('fill the bands left out with 0', () => {
        expect(normalizeAudioEqualizerModCurveGains([1, 2, 3])).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('are clamped to the window\'s range', () => {
        expect(normalizeAudioEqualizerModCurveGains([40, -40])).toEqual([12, -12, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('are rounded to 0.1 dB, and a gain that rounds to nothing is 0', () => {
        const gains = normalizeAudioEqualizerModCurveGains([1.24, 1.25, -2.06, 0.333, -0.04, 11.96]);
        expect(gains.slice(0, 6)).toEqual([1.2, 1.3, -2.1, 0.3, 0, 12]);
        expect(Object.is(gains[4], -0)).toBe(false);
    });
});

describe('the same curve', () => {
    const settings = own();

    it('is the same mod with the same gains, whatever its name and base', () => {
        const curve = curveOver(settings);
        expect(areAudioEqualizerModCurvesEqual(curve, curveOver(settings))).toBe(true);
        expect(areAudioEqualizerModCurvesEqual(curve, curveOver(settings, { modName: 'renamed' }))).toBe(true);
        expect(areAudioEqualizerModCurvesEqual(curve, curveOver(own({ preset: 'flat', gains: Array(10).fill(0) })))).toBe(true);
        expect(areAudioEqualizerModCurvesEqual(null, null)).toBe(true);
    });

    it('is not another mod\'s, nor one band off, nor none', () => {
        const curve = curveOver(settings);
        expect(areAudioEqualizerModCurvesEqual(curve, curveOver(settings, { modId: 'other' }))).toBe(false);
        expect(areAudioEqualizerModCurvesEqual(curve, curveOver(settings, { gains: SMILE.map((gain, index) => (index === 3 ? gain + 0.1 : gain)) }))).toBe(false);
        expect(areAudioEqualizerModCurvesEqual(curve, null)).toBe(false);
        expect(areAudioEqualizerModCurvesEqual(null, curve)).toBe(false);
    });
});

describe('the listener\'s own sound since a curve went on', () => {
    it('is the same for the same settings, also with the switch flipped', () => {
        const settings = own();
        const { base } = curveOver(settings);
        expect(isSameOwnSound(base, settings)).toBe(true);
        expect(isSameOwnSound(base, { ...settings, enabled: false })).toBe(true);
    });

    it('is not after the mode, a gain or an effect changed', () => {
        const settings = own();
        const { base } = curveOver(settings);
        expect(isSameOwnSound(base, { ...settings, preset: 'custom1' })).toBe(false);
        expect(isSameOwnSound(base, { ...settings, gains: settings.gains.map((gain, index) => (index === 0 ? gain + 1 : gain)) })).toBe(false);
        expect(isSameOwnSound(base, { ...settings, effects: { ...settings.effects, punch: 0.9 } })).toBe(false);
    });

    it('is the same when the base was saved before an effect existed that is neutral now', () => {
        const settings = own({ effects: normalizeAudioEffects({ width: 1.3, space: 0.55 }) });
        const { base } = curveOver(settings);
        // Leave one effect out, as a value saved by a build that did not have it yet.
        const missing = AUDIO_EFFECT_CONTROLS.find((control) => settings.effects[control.id] === control.neutral)!;
        const older = { ...base.effects } as Record<string, number>;
        delete older[missing.id];
        expect(isSameOwnSound({ ...base, effects: older as typeof base.effects }, settings)).toBe(true);
    });
});

describe('saving a curve to a custom slot', () => {
    it('writes only that slot, with the listener\'s effects, chooses it and leaves the switch', () => {
        const settings = own({ enabled: false });
        const saved = saveAudioEqualizerModCurveToSlot(settings, curveOver(settings), 'custom2');
        expect(saved.preset).toBe('custom2');
        expect(saved.gains).toEqual(SMILE);
        expect(saved.effects).toEqual(settings.effects);
        expect(saved.enabled).toBe(false);
        expect(saved.customSlots[1]).toEqual({ gains: SMILE, effects: settings.effects });
        expect(saved.customSlots[0]).toEqual(settings.customSlots[0]);
    });
});

describe('the stored value', () => {
    const settings = own();

    it('reads back what was saved', () => {
        const curve = curveOver(settings);
        const stored = parseStoredAudioEqualizerModCurve(serializeAudioEqualizerModCurve(curve));
        expect(stored).toEqual({ curve });
        expect(JSON.parse(serializeAudioEqualizerModCurve(curve))).toMatchObject({ v: 1, modId: 'eq-mod', modName: 'EQ mod' });
    });

    it('is dropped when it is not JSON, or not an object', () => {
        expect(parseStoredAudioEqualizerModCurve('{"v":1,')).toEqual({ drop: true });
        expect(parseStoredAudioEqualizerModCurve('null')).toEqual({ drop: true });
        expect(parseStoredAudioEqualizerModCurve('[1]')).toEqual({ drop: true });
    });

    it('is dropped when a version 1 value lacks what it needs', () => {
        const valid = JSON.parse(serializeAudioEqualizerModCurve(curveOver(settings)));
        const broken = [
            { ...valid, modId: '' },
            { ...valid, modId: 4 },
            { ...valid, gains: 'flat' },
            { ...valid, base: undefined },
            { ...valid, base: { ...valid.base, preset: undefined } },
            { ...valid, base: { ...valid.base, preset: 'jazz' } },
            { ...valid, base: { ...valid.base, gains: undefined } },
            { ...valid, base: { ...valid.base, effects: undefined } },
        ];
        for (const value of broken) {
            expect(parseStoredAudioEqualizerModCurve(JSON.stringify(value)), JSON.stringify(value)).toEqual({ drop: true });
        }
    });

    it('is left alone, not dropped, when a later version wrote it', () => {
        expect(parseStoredAudioEqualizerModCurve(JSON.stringify({ v: 2, anything: 'new' }))).toEqual({ ignore: true, version: 2 });
    });

    it('normalizes what it reads', () => {
        const valid = JSON.parse(serializeAudioEqualizerModCurve(curveOver(settings)));
        const stored = parseStoredAudioEqualizerModCurve(JSON.stringify({ ...valid, modName: 7, gains: [20, 1.26], base: { ...valid.base, effects: {} } }));
        expect(stored).toEqual({
            curve: {
                modId: 'eq-mod',
                modName: 'eq-mod',
                gains: [12, 1.3, 0, 0, 0, 0, 0, 0, 0, 0],
                base: { preset: 'hall', gains: [...AUDIO_SOUND_PRESETS.hall.gains], effects: createNeutralAudioEffects() },
            },
        });
    });
});
