// src/services/audioEffects/effectNodes.ts
// Creates and wires the always-on part of the effect chain; every stage stays neutral until settings ask for it.

export type AudioEffectNodes = {
    highpass: BiquadFilterNode;
    lowpass: BiquadFilterNode;
    /** Carries the signal around the two cutoff filters while both sit at their neutral ends. */
    filterBypass: GainNode;
    /** Carries the filtered signal once either cutoff is moved; crossfaded against filterBypass. */
    filterReturn: GainNode;
    drive: WaveShaperNode;
    crush: WaveShaperNode;
    wowDelay: DelayNode;
    stereoInput: GainNode;
    splitter: ChannelSplitterNode;
    merger: ChannelMergerNode;
    leftDirect: GainNode;
    rightDirect: GainNode;
    leftCross: GainNode;
    rightCross: GainNode;
    compressor: DynamicsCompressorNode;
    makeup: GainNode;
    dry: GainNode;
    wetSend: GainNode;
    wet: GainNode;
    noiseGain: GainNode;
};

export const WOW_BASE_DELAY_SECONDS = 0.012;

// Allocates every persistent node with neutral defaults.
export const createAudioEffectNodes = (context: AudioContext): AudioEffectNodes => {
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.Q.value = 0.7;
    highpass.frequency.value = 20;

    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0.7;
    lowpass.frequency.value = Math.min(20000, context.sampleRate * 0.475);

    const drive = context.createWaveShaper();
    // Harmonics from soft clipping reach past Nyquist, and aliased ones are what make waveshaping
    // sound harsh rather than warm, so this stage runs at the highest oversampling available.
    drive.oversample = '4x';

    const crush = context.createWaveShaper();

    const wowDelay = context.createDelay(0.2);
    wowDelay.delayTime.value = 0;

    // Forces a stereo frame so mono sources still feed both mid/side legs.
    const stereoInput = context.createGain();
    stereoInput.channelCount = 2;
    stereoInput.channelCountMode = 'explicit';
    stereoInput.channelInterpretation = 'speakers';

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = 0;
    compressor.knee.value = 30;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;

    const createGain = (value: number) => {
        const node = context.createGain();
        node.gain.value = value;
        return node;
    };

    return {
        highpass,
        lowpass,
        filterBypass: createGain(1),
        filterReturn: createGain(0),
        drive,
        crush,
        wowDelay,
        stereoInput,
        splitter: context.createChannelSplitter(2),
        merger: context.createChannelMerger(2),
        leftDirect: createGain(1),
        rightDirect: createGain(1),
        leftCross: createGain(0),
        rightCross: createGain(0),
        compressor,
        makeup: createGain(1),
        dry: createGain(1),
        wetSend: createGain(1),
        wet: createGain(0),
        noiseGain: createGain(0),
    };
};

// Connects the serial path plus the parallel reverb and noise returns.
export const connectAudioEffectNodes = (nodes: AudioEffectNodes, input: AudioNode, output: AudioNode) => {
    // The cutoff filters sit on a branch of their own instead of in line. Even at their neutral ends
    // (20 Hz, 20 kHz) a biquad is not transparent: the 20 Hz high-pass turns the phase of the bass
    // by tens of degrees, which moves where the peaks land. On a loud master that lifted peaks just
    // under full scale to well past it (about +1.3 dB on one track), clipped at the output while every
    // effect was off. Neutral now takes the bypass, which is the signal untouched.
    input.connect(nodes.filterBypass);
    input.connect(nodes.highpass);
    nodes.highpass.connect(nodes.lowpass);
    nodes.lowpass.connect(nodes.filterReturn);
    nodes.filterBypass.connect(nodes.drive);
    nodes.filterReturn.connect(nodes.drive);
    nodes.drive.connect(nodes.crush);
    nodes.crush.connect(nodes.wowDelay);
    nodes.wowDelay.connect(nodes.stereoInput);
    nodes.stereoInput.connect(nodes.splitter);

    nodes.splitter.connect(nodes.leftDirect, 0, 0);
    nodes.splitter.connect(nodes.rightCross, 1, 0);
    nodes.splitter.connect(nodes.leftCross, 0, 0);
    nodes.splitter.connect(nodes.rightDirect, 1, 0);
    nodes.leftDirect.connect(nodes.merger, 0, 0);
    nodes.rightCross.connect(nodes.merger, 0, 0);
    nodes.leftCross.connect(nodes.merger, 0, 1);
    nodes.rightDirect.connect(nodes.merger, 0, 1);

    nodes.merger.connect(nodes.compressor);
    nodes.compressor.connect(nodes.makeup);
    nodes.makeup.connect(nodes.dry);
    nodes.makeup.connect(nodes.wetSend);
    nodes.dry.connect(output);
    nodes.wet.connect(output);
    nodes.noiseGain.connect(output);
};

export const disconnectAudioEffectNodes = (nodes: AudioEffectNodes, input: AudioNode) => {
    for (const entry of [nodes.highpass, nodes.filterBypass]) {
        try {
            input.disconnect(entry);
        } catch {
            // The source may already be torn down with the audio context.
        }
    }
    Object.values(nodes).forEach(node => node.disconnect());
};
