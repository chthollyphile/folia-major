import {
    DEFAULT_AUDIO_EFFECT_SETTINGS,
    normalizeAudioEffects,
    type AudioEffectSettings,
} from '../../utils/audioEffects';
import { createBitCrushCurve, createSaturationCurve } from './effectSources';
import { createNoiseBranch } from './noiseBranch';
import { createReverbBranch } from './reverbBranch';
import { createWowBranch } from './wowBranch';
import { dbToLinear, rampParam } from './effectParams';
import { connectAudioEffectNodes, createAudioEffectNodes, disconnectAudioEffectNodes } from './effectNodes';

// src/services/audioEffects/effectChain.ts
// Owns the post-EQ effect chain: cutoff filters, saturation, bit crush, wow/flutter,
// vinyl noise, stereo width, dynamics and reverb, without routing audio through React.

type CreateAudioEffectChainParams = {
    context: AudioContext;
    input: AudioNode;
    output: AudioNode;
    effects: AudioEffectSettings;
    enabled: boolean;
};

export type AudioEffectChain = {
    apply: (effects: AudioEffectSettings, enabled: boolean) => void;
    dispose: () => void;
};

// Creates the effect chain between two existing nodes and returns a handle for later updates.
export const createAudioEffectChain = ({
    context,
    input,
    output,
    effects,
    enabled,
}: CreateAudioEffectChainParams): AudioEffectChain => {
    const nodes = createAudioEffectNodes(context);
    connectAudioEffectNodes(nodes, input, output);

    const reverb = createReverbBranch(context, nodes);
    const noise = createNoiseBranch(context, nodes);
    const wow = createWowBranch(context, nodes);
    let lastDrive = -1;
    let lastCrush = -1;

    // Maps normalized settings onto every stage; a disabled chain falls back to the neutral set.
    const apply = (nextEffects: AudioEffectSettings, nextEnabled: boolean) => {
        const active = nextEnabled ? normalizeAudioEffects(nextEffects) : DEFAULT_AUDIO_EFFECT_SETTINGS;

        rampParam(context, nodes.highpass.frequency, active.highpass);
        rampParam(context, nodes.lowpass.frequency, Math.min(active.lowpass, context.sampleRate * 0.475));
        // Both cutoffs at their neutral ends take the bypass (see connectAudioEffectNodes); moving
        // either one crossfades over to the filtered branch, so the switch itself makes no click.
        const filtersNeutral = active.highpass <= DEFAULT_AUDIO_EFFECT_SETTINGS.highpass
            && active.lowpass >= DEFAULT_AUDIO_EFFECT_SETTINGS.lowpass;
        rampParam(context, nodes.filterBypass.gain, filtersNeutral ? 1 : 0);
        rampParam(context, nodes.filterReturn.gain, filtersNeutral ? 0 : 1);

        if (active.drive !== lastDrive) {
            lastDrive = active.drive;
            nodes.drive.curve = createSaturationCurve(active.drive);
        }
        if (active.crush !== lastCrush) {
            lastCrush = active.crush;
            nodes.crush.curve = createBitCrushCurve(active.crush);
        }

        wow.set(active.wow);
        noise.set(active.noise);
        reverb.set(active.space);

        const direct = (1 + active.width) / 2;
        const cross = (1 - active.width) / 2;
        rampParam(context, nodes.leftDirect.gain, direct);
        rampParam(context, nodes.rightDirect.gain, direct);
        rampParam(context, nodes.leftCross.gain, cross);
        rampParam(context, nodes.rightCross.gain, cross);

        rampParam(context, nodes.compressor.threshold, -6 - active.punch * 26);
        rampParam(context, nodes.compressor.ratio, 1 + active.punch * 7);
        rampParam(context, nodes.compressor.knee, 30 - active.punch * 18);
        // Compression pulls peaks down, so the makeup stage gives that headroom back.
        // Saturation needs no term here: its transfer curve is already loudness matched.
        rampParam(context, nodes.makeup.gain, dbToLinear(active.punch * 3));
    };

    apply(effects, enabled);

    return {
        apply,
        dispose: () => {
            wow.dispose();
            noise.dispose();
            reverb.dispose();
            disconnectAudioEffectNodes(nodes, input);
        },
    };
};
