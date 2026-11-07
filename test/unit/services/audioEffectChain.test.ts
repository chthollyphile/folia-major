import { describe, expect, it, vi } from 'vitest';
import { createAudioEffectChain } from '@/services/audioEffects/effectChain';
import { createNeutralAudioEffects } from '@/utils/audioEffects';
import { AUDIO_SOUND_PRESETS } from '@/utils/audioPresets';

// test/unit/services/audioEffectChain.test.ts
// Verifies the post-EQ effect chain stays neutral when idle and only allocates optional branches on demand.

const createParam = (value = 0) => ({
    value,
    cancelScheduledValues: vi.fn(),
    // Mirrors the scheduled target so assertions can read the requested value directly.
    setTargetAtTime: vi.fn(function (this: { value: number }, target: number) {
        this.value = target;
    }),
});

const createNode = <T extends object>(extra: T) => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...extra,
});

const createFakeContext = () => {
    const created = {
        convolvers: [] as unknown[],
        bufferSources: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
        oscillators: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
        gains: [] as Array<{ gain: ReturnType<typeof createParam> }>,
    };

    const context = {
        sampleRate: 48_000,
        currentTime: 0,
        createBiquadFilter: () => createNode({ type: 'peaking', frequency: createParam(), Q: createParam() }),
        createWaveShaper: () => createNode({ curve: null as Float32Array | null, oversample: 'none' }),
        createDelay: () => createNode({ delayTime: createParam() }),
        createGain: () => {
            const node = createNode({ gain: createParam(1), channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' });
            created.gains.push(node);
            return node;
        },
        createChannelSplitter: () => createNode({}),
        createChannelMerger: () => createNode({}),
        createDynamicsCompressor: () => createNode({
            threshold: createParam(),
            knee: createParam(),
            ratio: createParam(),
            attack: createParam(),
            release: createParam(),
        }),
        createConvolver: () => {
            const node = createNode({ normalize: true, buffer: null as unknown });
            created.convolvers.push(node);
            return node;
        },
        createBufferSource: () => {
            const node = createNode({ buffer: null as unknown, loop: false, start: vi.fn(), stop: vi.fn() });
            created.bufferSources.push(node);
            return node;
        },
        createOscillator: () => {
            const node = createNode({ frequency: createParam(), start: vi.fn(), stop: vi.fn() });
            created.oscillators.push(node);
            return node;
        },
        createBuffer: (channels: number, length: number) => ({
            numberOfChannels: channels,
            getChannelData: () => new Float32Array(length),
        }),
    } as unknown as AudioContext;

    return { context, created };
};

const createChain = (effects = createNeutralAudioEffects(), enabled = true) => {
    const { context, created } = createFakeContext();
    const input = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
    const output = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
    const chain = createAudioEffectChain({ context, input, output, effects, enabled });
    return { chain, context, created, input, output };
};

describe('audio effect chain', () => {
    it('leaves the optional branches unallocated for a neutral chain', () => {
        const { created } = createChain();

        expect(created.convolvers).toHaveLength(0);
        expect(created.bufferSources).toHaveLength(0);
        expect(created.oscillators).toHaveLength(0);
    });

    it('allocates reverb, noise and modulation only once the preset asks for them', () => {
        const { chain, created } = createChain();

        chain.apply(AUDIO_SOUND_PRESETS.lofi.effects, true);

        expect(created.convolvers).toHaveLength(1);
        expect(created.bufferSources).toHaveLength(1);
        expect(created.oscillators).toHaveLength(2);

        chain.apply(AUDIO_SOUND_PRESETS.lofi.effects, true);

        expect(created.convolvers).toHaveLength(1);
        expect(created.bufferSources).toHaveLength(1);
    });

    it('bypasses every effect while processing is disabled', () => {
        const { chain, created } = createChain();
        const expectedCross = (1 - AUDIO_SOUND_PRESETS.radio.effects.width) / 2;

        chain.apply(AUDIO_SOUND_PRESETS.radio.effects, true);
        expect(created.gains.some(node => node.gain.value === expectedCross)).toBe(true);

        chain.apply(AUDIO_SOUND_PRESETS.radio.effects, false);

        // A disabled chain falls back to the neutral set, so the mid/side cross feed goes silent again.
        expect(created.gains.some(node => node.gain.value === expectedCross)).toBe(false);
        expect(created.gains.filter(node => node.gain.value === 1).length).toBeGreaterThanOrEqual(4);
    });

    it('routes around the cutoff filters while both sit at their neutral ends', () => {
        const { chain, input } = createChain();
        type FakeGain = { gain: { value: number } };
        type FakeNode = { connect: ReturnType<typeof vi.fn> };
        const fromInput = vi.mocked(input.connect).mock.calls.map(([node]) => node as unknown);
        const bypass = fromInput.find(node => 'gain' in (node as object)) as FakeGain;
        const highpass = fromInput.find(node => 'frequency' in (node as object)) as FakeNode;
        const lowpass = highpass.connect.mock.calls[0][0] as FakeNode;
        const filterReturn = lowpass.connect.mock.calls[0][0] as FakeGain;

        // Neutral: the signal goes round the biquads, whose phase turn at 20 Hz lifts a loud master's peaks.
        expect(bypass.gain.value).toBe(1);
        expect(filterReturn.gain.value).toBe(0);

        chain.apply({ ...createNeutralAudioEffects(), highpass: 120 }, true);
        expect(bypass.gain.value).toBe(0);
        expect(filterReturn.gain.value).toBe(1);

        chain.apply({ ...createNeutralAudioEffects(), lowpass: 8000 }, true);
        expect(bypass.gain.value).toBe(0);
        expect(filterReturn.gain.value).toBe(1);

        // A disabled chain is neutral whatever its settings say.
        chain.apply({ ...createNeutralAudioEffects(), highpass: 120 }, false);
        expect(bypass.gain.value).toBe(1);
        expect(filterReturn.gain.value).toBe(0);
    });

    it('releases the noise source and oscillators on dispose', () => {
        const { chain, created, input } = createChain();

        chain.apply(AUDIO_SOUND_PRESETS.lofi.effects, true);
        chain.dispose();

        // Both of the input's taps are let go: the filter branch and the bypass round it.
        const tapped = vi.mocked(input.connect).mock.calls.map(([node]) => node);
        tapped.forEach(node => expect(input.disconnect).toHaveBeenCalledWith(node));
        expect(created.bufferSources[0].stop).toHaveBeenCalled();
        created.oscillators.forEach(oscillator => expect(oscillator.stop).toHaveBeenCalled());
    });
});
