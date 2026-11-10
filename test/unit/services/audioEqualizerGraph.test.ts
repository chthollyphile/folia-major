import { describe, expect, it, vi } from 'vitest';
import {
    MOD_EQUALIZER_GLIDE_SECONDS,
    applyAudioEqualizerSettings,
    connectAudioEqualizerGraph,
    planAudioEqualizerApply,
} from '@/services/audioEqualizerGraph';
import { AUDIO_EQUALIZER_BANDS, audioEqualizerBandShape, type AudioEqualizerSettings } from '@/utils/audioEqualizer';
import { createNeutralAudioEffects } from '@/utils/audioEffects';

// test/unit/services/audioEqualizerGraph.test.ts
// How an equalizer change reaches the filters (Folium 1.7): a mod's change waits for an audible automix
// blend to end and glides in; everyone else's is applied at once with the short time constant it always
// had. And the filters take their shapes from the one helper the Folium snapshot reads too.

const settings = (gains: number[]): AudioEqualizerSettings => ({
    enabled: true,
    gains,
    preset: 'custom1',
    effects: createNeutralAudioEffects(),
    customSlots: [],
});

const createFilter = () => ({
    type: 'peaking',
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
    connect: vi.fn(),
});

describe('planAudioEqualizerApply', () => {
    it('holds a mod\'s change back while a blend can be heard, and glides it in', () => {
        expect(planAudioEqualizerApply({ origin: { kind: 'mod', modId: 'eq-mod' }, transitionAudible: true }))
            .toEqual({ defer: true, timeConstant: MOD_EQUALIZER_GLIDE_SECONDS });
        expect(planAudioEqualizerApply({ origin: { kind: 'mod', modId: 'eq-mod' }, transitionAudible: false }))
            .toEqual({ defer: false, timeConstant: MOD_EQUALIZER_GLIDE_SECONDS });
    });

    it('applies everyone else\'s change at once, blend or not', () => {
        for (const origin of [{ kind: 'user' }, { kind: 'command' }, { kind: 'host' }] as const) {
            for (const transitionAudible of [true, false]) {
                expect(planAudioEqualizerApply({ origin, transitionAudible }), `${origin.kind} ${transitionAudible}`)
                    .toEqual({ defer: false, timeConstant: 0.015 });
            }
        }
    });

    it('reads a missing origin as not a mod\'s', () => {
        expect(planAudioEqualizerApply({ origin: undefined, transitionAudible: true })).toEqual({ defer: false, timeConstant: 0.015 });
    });

    it('glides over about a second', () => {
        expect(MOD_EQUALIZER_GLIDE_SECONDS).toBe(0.25);
    });
});

describe('applyAudioEqualizerSettings', () => {
    it('hands the time constant to every band', () => {
        const nodes = AUDIO_EQUALIZER_BANDS.map(() => createFilter()) as unknown as BiquadFilterNode[];
        const gains = AUDIO_EQUALIZER_BANDS.map((_, index) => index - 4);
        applyAudioEqualizerSettings({ currentTime: 3 } as AudioContext, nodes, settings(gains), MOD_EQUALIZER_GLIDE_SECONDS);
        nodes.forEach((node, index) => {
            expect(node.gain.cancelScheduledValues).toHaveBeenCalledWith(3);
            expect(node.gain.setTargetAtTime).toHaveBeenCalledWith(gains[index], 3, MOD_EQUALIZER_GLIDE_SECONDS);
        });
    });

    it('keeps the short time constant when none is given', () => {
        const nodes = AUDIO_EQUALIZER_BANDS.map(() => createFilter()) as unknown as BiquadFilterNode[];
        applyAudioEqualizerSettings({ currentTime: 1 } as AudioContext, nodes, settings(Array(10).fill(2)));
        nodes.forEach((node) => {
            expect(node.gain.setTargetAtTime).toHaveBeenCalledWith(2, 1, 0.015);
        });
    });
});

describe('connectAudioEqualizerGraph', () => {
    it('shapes the filters as audioEqualizerBandShape says', () => {
        const filters = AUDIO_EQUALIZER_BANDS.map(() => createFilter());
        const context = { sampleRate: 48_000, createBiquadFilter: vi.fn(() => filters.shift()) } as unknown as AudioContext;
        const nodesRef = { current: [] as BiquadFilterNode[] };
        connectAudioEqualizerGraph({
            context,
            input: { connect: vi.fn() } as unknown as AudioNode,
            output: {} as AudioNode,
            nodesRef,
            settings: settings(Array(10).fill(0)),
        });
        expect(nodesRef.current.map((node) => node.type)).toEqual(AUDIO_EQUALIZER_BANDS.map((_, index) => audioEqualizerBandShape(index)));
    });
});
