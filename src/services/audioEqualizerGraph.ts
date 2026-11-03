import type { MutableRefObject } from 'react';
import { AUDIO_EQUALIZER_BANDS, audioEqualizerBandShape, type AudioEqualizerSettings } from '../utils/audioEqualizer';
import type { AudioEqualizerChangeOrigin } from '../utils/audioEqualizerModCurve';

// src/services/audioEqualizerGraph.ts
// Owns the Web Audio filter chain without introducing React updates into the audio path.

type ConnectAudioEqualizerGraphParams = {
    context: AudioContext;
    input: AudioNode;
    output: AudioNode;
    nodesRef: MutableRefObject<BiquadFilterNode[]>;
    settings: AudioEqualizerSettings;
};

const resolveFilterFrequency = (context: AudioContext, frequency: number) => (
    Math.min(frequency, context.sampleRate * 0.475)
);

// Creates one stable ten-filter chain for the lifetime of the MediaElementAudioSourceNode.
export const connectAudioEqualizerGraph = ({
    context,
    input,
    output,
    nodesRef,
    settings,
}: ConnectAudioEqualizerGraphParams) => {
    const nodes = AUDIO_EQUALIZER_BANDS.map((band, index) => {
        const filter = context.createBiquadFilter();
        filter.type = audioEqualizerBandShape(index);
        filter.frequency.value = resolveFilterFrequency(context, band.frequency);
        filter.Q.value = 1.4;
        filter.gain.value = settings.enabled ? settings.gains[index] : 0;
        return filter;
    });

    nodes.reduce<AudioNode>((previousNode, filter) => {
        previousNode.connect(filter);
        return filter;
    }, input).connect(output);
    nodesRef.current = nodes;
};

/** The time constant of a change that is not a mod's: a slider commit, a preset, the switch. */
const EQUALIZER_TIME_CONSTANT_SECONDS = 0.015;

/**
 * The time constant a mod's gains glide in with (Folium 1.7 `folium.equalizer`): about a second to arrive,
 * so a curve a mod puts in place between songs or after a blend does not jump.
 */
export const MOD_EQUALIZER_GLIDE_SECONDS = 0.25;

// Smoothly applies discrete slider commits while keeping React out of the audio processing loop.
export const applyAudioEqualizerSettings = (
    context: AudioContext,
    nodes: BiquadFilterNode[],
    settings: AudioEqualizerSettings,
    timeConstant = EQUALIZER_TIME_CONSTANT_SECONDS,
) => {
    nodes.forEach((filter, index) => {
        const nextGain = settings.enabled ? (settings.gains[index] ?? 0) : 0;
        filter.gain.cancelScheduledValues(context.currentTime);
        filter.gain.setTargetAtTime(nextGain, context.currentTime, timeConstant);
    });
};

/**
 * How a change of the equalizer reaches the sound. A mod's change waits while an automix blend can be heard
 * (the effect chain switches at once, and mid-blend it would change both songs' sound: the equalizer sits
 * after the mix point) and glides its gains in; every other change (the listener's, a command's, the host's)
 * is applied at once, as before. An origin that is not given reads as not a mod's.
 */
export const planAudioEqualizerApply = ({ origin, transitionAudible }: {
    origin: AudioEqualizerChangeOrigin | undefined;
    transitionAudible: boolean;
}): { defer: boolean; timeConstant: number } => (
    origin?.kind === 'mod'
        ? { defer: transitionAudible, timeConstant: MOD_EQUALIZER_GLIDE_SECONDS }
        : { defer: false, timeConstant: EQUALIZER_TIME_CONSTANT_SECONDS }
);
