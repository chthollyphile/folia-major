import { describe, expect, it, vi } from 'vitest';
import { applyAudioEqualizerSettings, connectAudioEqualizerGraph } from '@/services/audioEqualizerGraph';
import {
    AUDIO_EQUALIZER_BANDS,
    AUDIO_EQUALIZER_PRESETS,
    DEFAULT_AUDIO_EQUALIZER_SETTINGS,
    areAudioEqualizerSettingsEqual,
    audioEqualizerBandShape,
    normalizeAudioEqualizerGains,
    planAudioSoundPreset,
    resolveAudioEqualizerSettings,
    type AudioEqualizerModeId,
    type AudioEqualizerSettings,
} from '@/utils/audioEqualizer';
import { createNeutralAudioEffects, normalizeAudioEffects } from '@/utils/audioEffects';
import { AUDIO_SOUND_PRESETS } from '@/utils/audioPresets';

// test/unit/utils/audioEqualizer.test.ts
// Verifies persisted equalizer normalization and the ten-node Web Audio chain.

const createAudioParam = () => ({
    value: 0,
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
});

const createFilter = () => ({
    type: 'peaking',
    frequency: createAudioParam(),
    Q: createAudioParam(),
    gain: createAudioParam(),
    connect: vi.fn(),
});

describe('audio equalizer model', () => {
    it('normalizes malformed persisted values into ten safe bands', () => {
        const settings = resolveAudioEqualizerSettings({
            enabled: true,
            gains: [20, -20, '4', Number.NaN],
        });

        expect(settings.enabled).toBe(true);
        expect(settings.gains).toHaveLength(AUDIO_EQUALIZER_BANDS.length);
        expect(settings.gains.slice(0, 5)).toEqual([12, -12, 4, 0, 0]);
        expect(settings.preset).toBe('custom1');
        expect(settings.customSlots[0].gains).toEqual(settings.gains);
    });

    it('returns an independent flat default for invalid input', () => {
        const first = resolveAudioEqualizerSettings(null);
        first.gains[0] = 6;
        const second = resolveAudioEqualizerSettings(null);

        expect(second).toEqual(DEFAULT_AUDIO_EQUALIZER_SETTINGS);
        expect(second.gains).not.toBe(DEFAULT_AUDIO_EQUALIZER_SETTINGS.gains);
        expect(second.customSlots[0].gains).not.toBe(DEFAULT_AUDIO_EQUALIZER_SETTINGS.customSlots[0].gains);
    });

    it('preserves the custom slots while a built-in preset is active', () => {
        const settings = resolveAudioEqualizerSettings({
            enabled: true,
            gains: AUDIO_EQUALIZER_PRESETS.lofi,
            preset: 'lofi',
            customSlots: [{ gains: [3, 2, 1, 0, -1, -2, -3, -4, -5, -6] }, {}],
        });

        expect(settings.preset).toBe('lofi');
        expect(settings.gains).toEqual(AUDIO_EQUALIZER_PRESETS.lofi);
        expect(settings.customSlots).toHaveLength(2);
        expect(settings.customSlots[0].gains).toEqual([3, 2, 1, 0, -1, -2, -3, -4, -5, -6]);
        expect(settings.customSlots[1].gains).toEqual(Array(10).fill(0));
    });
});

describe('audio effect model', () => {
    // Deliberately the opposite of upstream, which restores the preset's effects here. Someone who
    // picked "Lo-Fi" in a build where it was a tone curve gets vinyl crackle and bit crush pushed
    // into their music by an update they did not read - reported on this branch as severe noise.
    // The preset id survives (see below), so the modern character is one deliberate click away.
    it('leaves the chain neutral for settings persisted before the effect chain existed', () => {
        const settings = resolveAudioEqualizerSettings({
            enabled: true,
            gains: AUDIO_EQUALIZER_PRESETS.lofi,
            preset: 'lofi',
            customGains: Array(10).fill(0),
        });

        expect(settings.effects).toEqual(createNeutralAudioEffects());
        // The tone curve they chose is still theirs, and the panel still shows which one it is.
        expect(settings.gains).toEqual(AUDIO_EQUALIZER_PRESETS.lofi);
        expect(settings.preset).toBe('lofi');
        expect(settings.customSlots[0].effects).toEqual(createNeutralAudioEffects());
    });

    it('keeps honouring effects that were actually persisted', () => {
        const settings = resolveAudioEqualizerSettings({
            enabled: true,
            gains: AUDIO_EQUALIZER_PRESETS.lofi,
            preset: 'lofi',
            effects: AUDIO_SOUND_PRESETS.lofi.effects,
        });

        expect(settings.effects).toEqual(AUDIO_SOUND_PRESETS.lofi.effects);
    });

    it('clamps malformed effect values and fills missing ones with their neutral value', () => {
        const effects = normalizeAudioEffects({ drive: 4, width: -1, space: 'x', lowpass: 8000 });

        expect(effects.drive).toBe(1);
        expect(effects.width).toBe(0);
        expect(effects.space).toBe(0);
        expect(effects.lowpass).toBe(8000);
        expect(effects.highpass).toBe(20);
    });

    it('detects a built-in preset only when gains and effects both match', () => {
        const matched = resolveAudioEqualizerSettings({
            enabled: true,
            gains: AUDIO_SOUND_PRESETS.hall.gains,
            effects: AUDIO_SOUND_PRESETS.hall.effects,
        });
        const mismatched = resolveAudioEqualizerSettings({
            enabled: true,
            gains: AUDIO_SOUND_PRESETS.hall.gains,
            effects: { ...AUDIO_SOUND_PRESETS.hall.effects, space: 0 },
        });

        expect(matched.preset).toBe('hall');
        expect(mismatched.preset).toBe('custom1');
    });

    it('moves a retired preset into the first custom slot without losing the older custom sound', () => {
        const retiredSound = {
            gains: [3, 2, 1, 0, -1, -1, -2, -3, -5, -7],
            effects: normalizeAudioEffects({ noise: 0.38, wow: 0.22, lowpass: 11000 }),
        };
        const settings = resolveAudioEqualizerSettings({
            enabled: true,
            preset: 'vinyl',
            gains: retiredSound.gains,
            effects: retiredSound.effects,
            customGains: [6, 6, 6, 0, 0, 0, 0, 0, 0, 0],
        });

        expect(settings.preset).toBe('custom1');
        expect(settings.gains).toEqual(retiredSound.gains);
        expect(settings.effects).toEqual(retiredSound.effects);
        expect(settings.customSlots[0]).toEqual(retiredSound);
        expect(settings.customSlots[1].gains).toEqual([6, 6, 6, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('maps the former single custom slot onto the first of the two slots', () => {
        const settings = resolveAudioEqualizerSettings({
            enabled: true,
            preset: 'custom',
            gains: Array(10).fill(2),
            customGains: Array(10).fill(2),
        });

        expect(settings.preset).toBe('custom1');
        expect(settings.customSlots[0].gains).toEqual(Array(10).fill(2));
        expect(settings.customSlots[1].gains).toEqual(Array(10).fill(0));
    });
});

describe('audio equalizer graph', () => {
    it('connects ten filters between the existing gain and analyser nodes', () => {
        const filters = AUDIO_EQUALIZER_BANDS.map(() => createFilter());
        const context = {
            sampleRate: 48_000,
            createBiquadFilter: vi.fn(() => filters.shift()),
        } as unknown as AudioContext;
        const input = { connect: vi.fn() } as unknown as AudioNode;
        const output = {} as AudioNode;
        const nodesRef = { current: [] as BiquadFilterNode[] };

        connectAudioEqualizerGraph({
            context,
            input,
            output,
            nodesRef,
            settings: {
                enabled: true,
                gains: Array.from({ length: 10 }, (_, index) => index - 5),
                preset: 'custom1',
                effects: createNeutralAudioEffects(),
                customSlots: [],
            },
        });

        expect(nodesRef.current).toHaveLength(10);
        expect(input.connect).toHaveBeenCalledWith(nodesRef.current[0]);
        expect(nodesRef.current[0].type).toBe('lowshelf');
        expect(nodesRef.current[9].type).toBe('highshelf');
        expect(nodesRef.current[9].connect).toHaveBeenCalledWith(output);
        expect(nodesRef.current[0].gain.value).toBe(-5);
        expect(nodesRef.current[9].gain.value).toBe(4);
    });

    it('smoothly bypasses every band when disabled', () => {
        const nodes = AUDIO_EQUALIZER_BANDS.map(() => createFilter()) as unknown as BiquadFilterNode[];
        const context = { currentTime: 2 } as AudioContext;

        applyAudioEqualizerSettings(context, nodes, {
            enabled: false,
            gains: Array(10).fill(6),
            preset: 'custom1',
            effects: createNeutralAudioEffects(),
            customSlots: [],
        });

        nodes.forEach(node => {
            expect(node.gain.cancelScheduledValues).toHaveBeenCalledWith(2);
            expect(node.gain.setTargetAtTime).toHaveBeenCalledWith(0, 2, 0.015);
        });
    });
});

describe('the equalizer helpers Folium 1.7 shares', () => {
    const settingsOf = (overrides: Partial<AudioEqualizerSettings> = {}): AudioEqualizerSettings => (
        resolveAudioEqualizerSettings({
            enabled: true,
            preset: 'custom1',
            gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            effects: createNeutralAudioEffects(),
            customSlots: [
                { gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], effects: createNeutralAudioEffects() },
                { gains: Array(10).fill(-3), effects: normalizeAudioEffects({ space: 0.4 }) },
            ],
            ...overrides,
        })
    );

    it('normalizes gains as the persisted settings always did', () => {
        // resolveAudioEqualizerSettings reads its gains through the very function, renamed and exported.
        for (const raw of [undefined, null, 'x', [], [20, -20, '4', Number.NaN], Array(14).fill(3), [1.25, -0.5]]) {
            expect(normalizeAudioEqualizerGains(raw), JSON.stringify(raw)).toEqual(resolveAudioEqualizerSettings({ gains: raw }).gains);
        }
        expect(normalizeAudioEqualizerGains([20, -20, '4'])).toEqual([12, -12, 4, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('shapes the first band as a low shelf, the last as a high shelf and the others as peaking', () => {
        expect(AUDIO_EQUALIZER_BANDS.map((_, index) => audioEqualizerBandShape(index))).toEqual([
            'lowshelf', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'highshelf',
        ]);
    });

    it('plans a sound with processing turned on, or with the switch left as it is', () => {
        const off = settingsOf({ enabled: false });
        const turnedOn = planAudioSoundPreset(off, 'bass');
        expect(turnedOn).toMatchObject({ enabled: true, preset: 'bass', gains: [...AUDIO_SOUND_PRESETS.bass.gains], effects: AUDIO_SOUND_PRESETS.bass.effects });
        expect(planAudioSoundPreset(off, 'bass', { keepEnabled: true })).toMatchObject({ enabled: false, preset: 'bass' });
        expect(planAudioSoundPreset(settingsOf(), 'bass', { keepEnabled: true })?.enabled).toBe(true);
        // A custom slot plays what it holds; neither slot is written.
        const second = planAudioSoundPreset(off, 'custom2', { keepEnabled: true });
        expect(second).toMatchObject({ enabled: false, preset: 'custom2', gains: Array(10).fill(-3), effects: off.customSlots[1].effects });
        expect(second?.customSlots).toEqual(off.customSlots);
        expect(turnedOn?.customSlots).toEqual(off.customSlots);
    });

    it('plans nothing for a sound there is not', () => {
        expect(planAudioSoundPreset(settingsOf(), 'jazz' as AudioEqualizerModeId)).toBeNull();
        expect(planAudioSoundPreset(settingsOf(), 'constructor' as AudioEqualizerModeId)).toBeNull();
        expect(planAudioSoundPreset({ ...settingsOf(), customSlots: [] }, 'custom2')).toBeNull();
    });

    it('tells two settings apart by any one field, down to one gain or one effect of a custom slot', () => {
        const base = settingsOf();
        expect(areAudioEqualizerSettingsEqual(base, settingsOf())).toBe(true);
        const slotGain = settingsOf();
        slotGain.customSlots[1].gains[4] = 2;
        const slotEffect = settingsOf();
        slotEffect.customSlots[0].effects = { ...slotEffect.customSlots[0].effects, drive: 0.5 };
        const changed: Array<[string, AudioEqualizerSettings]> = [
            ['enabled', { ...base, enabled: false }],
            ['preset', { ...base, preset: 'custom2' }],
            ['gains', { ...base, gains: base.gains.map((gain, index) => (index === 9 ? gain - 1 : gain)) }],
            ['effects', { ...base, effects: { ...base.effects, width: 1.5 } }],
            ['a custom slot gain', slotGain],
            ['a custom slot effect', slotEffect],
            ['the number of custom slots', { ...base, customSlots: base.customSlots.slice(0, 1) }],
        ];
        for (const [what, other] of changed) {
            expect(areAudioEqualizerSettingsEqual(base, other), what).toBe(false);
            expect(areAudioEqualizerSettingsEqual(other, base), what).toBe(false);
        }
    });
});
