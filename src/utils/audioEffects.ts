// src/utils/audioEffects.ts
// Defines the non-EQ audio effect model shared by presets, UI sliders and the Web Audio runtime.

export type AudioEffectId =
    | 'highpass'
    | 'lowpass'
    | 'drive'
    | 'crush'
    | 'wow'
    | 'noise'
    | 'width'
    | 'space'
    | 'punch';

export type AudioEffectSettings = Record<AudioEffectId, number>;

export type AudioEffectControl = {
    id: AudioEffectId;
    min: number;
    max: number;
    step: number;
    neutral: number;
    scale: 'linear' | 'log';
    unit: 'hz' | 'ratio';
    /**
     * This control adds a noise floor of its own, rather than shaping the music.
     *
     * The two that do are easy to mistake for a fault, because that is exactly what they sound
     * like: hiss and crackle that is loudest where the music is quietest, which on a soft intro
     * reads as a broken build rather than as an effect. Both were reported that way. The panel
     * marks them so the answer to "where is this noise coming from" is on screen next to the
     * slider that is causing it.
     *
     * Saturation and wow are deliberately NOT marked: they distort and detune the signal, which
     * is audible but is not a noise floor - turn the music off and they make no sound at all.
     */
    addsNoise?: boolean;
};

// Slider order follows the signal flow: tone shaping, then colour, then space.
export const AUDIO_EFFECT_CONTROLS: readonly AudioEffectControl[] = [
    { id: 'highpass', min: 20, max: 2000, step: 1, neutral: 20, scale: 'log', unit: 'hz' },
    { id: 'lowpass', min: 500, max: 20000, step: 1, neutral: 20000, scale: 'log', unit: 'hz' },
    { id: 'drive', min: 0, max: 1, step: 0.01, neutral: 0, scale: 'linear', unit: 'ratio' },
    { id: 'crush', min: 0, max: 1, step: 0.01, neutral: 0, scale: 'linear', unit: 'ratio', addsNoise: true },
    { id: 'wow', min: 0, max: 1, step: 0.01, neutral: 0, scale: 'linear', unit: 'ratio' },
    { id: 'noise', min: 0, max: 1, step: 0.01, neutral: 0, scale: 'linear', unit: 'ratio', addsNoise: true },
    { id: 'width', min: 0, max: 2, step: 0.01, neutral: 1, scale: 'linear', unit: 'ratio' },
    { id: 'space', min: 0, max: 1, step: 0.01, neutral: 0, scale: 'linear', unit: 'ratio' },
    { id: 'punch', min: 0, max: 1, step: 0.01, neutral: 0, scale: 'linear', unit: 'ratio' },
];

export const AUDIO_EFFECT_CONTROL_MAP = AUDIO_EFFECT_CONTROLS.reduce((map, control) => {
    map[control.id] = control;
    return map;
}, {} as Record<AudioEffectId, AudioEffectControl>);

export const DEFAULT_AUDIO_EFFECT_SETTINGS: AudioEffectSettings = AUDIO_EFFECT_CONTROLS.reduce((settings, control) => {
    settings[control.id] = control.neutral;
    return settings;
}, {} as AudioEffectSettings);

const clampEffectValue = (control: AudioEffectControl, value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return control.neutral;
    }
    return Math.min(control.max, Math.max(control.min, parsed));
};

// Normalizes untrusted persisted or imported effect values into a complete, in-range set.
export const normalizeAudioEffects = (value: unknown): AudioEffectSettings => {
    const candidate = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    return AUDIO_EFFECT_CONTROLS.reduce((settings, control) => {
        settings[control.id] = Object.hasOwn(candidate, control.id)
            ? clampEffectValue(control, candidate[control.id])
            : control.neutral;
        return settings;
    }, {} as AudioEffectSettings);
};

export const areAudioEffectsEqual = (left: AudioEffectSettings, right: AudioEffectSettings): boolean => (
    AUDIO_EFFECT_CONTROLS.every(control => left[control.id] === right[control.id])
);

export const isNeutralAudioEffects = (effects: AudioEffectSettings): boolean => (
    areAudioEffectsEqual(effects, DEFAULT_AUDIO_EFFECT_SETTINGS)
);

export const createNeutralAudioEffects = (): AudioEffectSettings => ({ ...DEFAULT_AUDIO_EFFECT_SETTINGS });

// Maps a stored value onto the 0-1000 slider domain so logarithmic cutoffs stay usable.
export const audioEffectToSliderPosition = (control: AudioEffectControl, value: number): number => {
    const clamped = clampEffectValue(control, value);
    if (control.scale === 'log') {
        const min = Math.log(control.min);
        const span = Math.log(control.max) - min;
        return Math.round(((Math.log(clamped) - min) / span) * 1000);
    }
    return Math.round(((clamped - control.min) / (control.max - control.min)) * 1000);
};

// Inverse of audioEffectToSliderPosition, rounded onto the control step grid.
export const sliderPositionToAudioEffect = (control: AudioEffectControl, position: number): number => {
    const ratio = Math.min(1, Math.max(0, position / 1000));
    if (control.scale === 'log') {
        const min = Math.log(control.min);
        const span = Math.log(control.max) - min;
        return Math.round(Math.exp(min + ratio * span));
    }
    const raw = control.min + ratio * (control.max - control.min);
    return Number((Math.round(raw / control.step) * control.step).toFixed(4));
};

// Produces the short readout shown next to each effect slider.
export const formatAudioEffectValue = (control: AudioEffectControl, value: number): string => {
    if (control.unit === 'hz') {
        return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
    }
    return `${Math.round(value * 100)}%`;
};
