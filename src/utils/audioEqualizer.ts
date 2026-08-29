import {
    areAudioEffectsEqual,
    createNeutralAudioEffects,
    normalizeAudioEffects,
    type AudioEffectSettings,
} from './audioEffects';
import { AUDIO_SOUND_PRESETS, isAudioSoundPresetId, type AudioSoundPresetId } from './audioPresets';

export type AudioEqualizerCustomSlot = {
    gains: number[];
    effects: AudioEffectSettings;
};

export type AudioEqualizerSettings = {
    enabled: boolean;
    gains: number[];
    preset: AudioEqualizerModeId;
    effects: AudioEffectSettings;
    customSlots: AudioEqualizerCustomSlot[];
};

// src/utils/audioEqualizer.ts
// Defines the persisted ten-band equalizer model shared by UI and Web Audio runtime.

export const AUDIO_EQUALIZER_STORAGE_KEY = 'audio_equalizer_settings';
export const AUDIO_EQUALIZER_MIN_GAIN_DB = -12;
export const AUDIO_EQUALIZER_MAX_GAIN_DB = 12;

export const AUDIO_EQUALIZER_BANDS = [
    { frequency: 31, label: '31' },
    { frequency: 62, label: '62' },
    { frequency: 125, label: '125' },
    { frequency: 250, label: '250' },
    { frequency: 500, label: '500' },
    { frequency: 1000, label: '1k' },
    { frequency: 2000, label: '2k' },
    { frequency: 4000, label: '4k' },
    { frequency: 8000, label: '8k' },
    { frequency: 16000, label: '16k' },
] as const;

export type AudioEqualizerPresetId = AudioSoundPresetId;
export const AUDIO_EQUALIZER_CUSTOM_SLOT_IDS = ['custom1', 'custom2'] as const;
export type AudioEqualizerCustomSlotId = typeof AUDIO_EQUALIZER_CUSTOM_SLOT_IDS[number];
export type AudioEqualizerModeId = AudioEqualizerPresetId | AudioEqualizerCustomSlotId;

export const AUDIO_EQUALIZER_PRESETS = Object.fromEntries(
    Object.entries(AUDIO_SOUND_PRESETS).map(([presetId, preset]) => [presetId, preset.gains]),
) as Record<AudioEqualizerPresetId, readonly number[]>;

export const isAudioEqualizerCustomSlotId = (value: unknown): value is AudioEqualizerCustomSlotId => (
    AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.includes(value as AudioEqualizerCustomSlotId)
);

export const getAudioEqualizerCustomSlotIndex = (slotId: AudioEqualizerCustomSlotId) => (
    AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.indexOf(slotId)
);

const createEmptyCustomSlot = (): AudioEqualizerCustomSlot => ({
    gains: [...AUDIO_SOUND_PRESETS.flat.gains],
    effects: createNeutralAudioEffects(),
});

const createEmptyCustomSlots = (): AudioEqualizerCustomSlot[] => (
    AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.map(createEmptyCustomSlot)
);

export const DEFAULT_AUDIO_EQUALIZER_SETTINGS: AudioEqualizerSettings = {
    enabled: false,
    gains: [...AUDIO_EQUALIZER_PRESETS.flat],
    preset: 'flat',
    effects: createNeutralAudioEffects(),
    customSlots: createEmptyCustomSlots(),
};

const clampGain = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.min(AUDIO_EQUALIZER_MAX_GAIN_DB, Math.max(AUDIO_EQUALIZER_MIN_GAIN_DB, parsed));
};

const normalizeGains = (value: unknown): number[] => {
    const rawGains = Array.isArray(value) ? value : [];
    return AUDIO_EQUALIZER_BANDS.map((_, index) => clampGain(rawGains[index]));
};

// Built-in presets that used to exist; their persisted settings migrate into a custom slot.
const RETIRED_PRESET_IDS = ['tape', 'vinyl'];

const isRetiredPresetId = (value: unknown) => typeof value === 'string' && RETIRED_PRESET_IDS.includes(value);

type LegacyCustomFields = {
    customGains?: unknown;
    customEffects?: unknown;
};

const normalizeCustomSlot = (value: unknown): AudioEqualizerCustomSlot => {
    const candidate = (value && typeof value === 'object' ? value : {}) as Partial<AudioEqualizerCustomSlot>;
    return {
        gains: normalizeGains(candidate.gains),
        effects: normalizeAudioEffects(candidate.effects),
    };
};

const resolveModeId = (
    value: unknown,
    gains: number[],
    effects: AudioEffectSettings,
): AudioEqualizerModeId => {
    if (isAudioSoundPresetId(value) || isAudioEqualizerCustomSlotId(value)) {
        return value;
    }

    // The former single custom slot and the retired built-ins all land in the first custom slot.
    if (value === 'custom' || isRetiredPresetId(value)) {
        return 'custom1';
    }

    return (Object.entries(AUDIO_SOUND_PRESETS) as Array<[AudioEqualizerPresetId, typeof AUDIO_SOUND_PRESETS[AudioEqualizerPresetId]]>)
        .find(([, preset]) => (
            preset.gains.every((gain, index) => gain === gains[index])
            && areAudioEffectsEqual(preset.effects, effects)
        ))?.[0]
        ?? 'custom1';
};

// Rebuilds both custom slots, folding the older single-slot and retired-preset layouts into them.
const resolveCustomSlots = (
    candidate: Partial<AudioEqualizerSettings> & LegacyCustomFields,
    gains: number[],
    effects: AudioEffectSettings,
    mode: AudioEqualizerModeId,
): AudioEqualizerCustomSlot[] => {
    const storedSlots = Array.isArray(candidate.customSlots) ? candidate.customSlots : null;
    const hasLegacyCustom = Array.isArray(candidate.customGains)
        || Boolean(candidate.customEffects && typeof candidate.customEffects === 'object');

    const slots = storedSlots
        ? AUDIO_EQUALIZER_CUSTOM_SLOT_IDS.map((_, index) => normalizeCustomSlot(storedSlots[index]))
        : [
            hasLegacyCustom
                ? normalizeCustomSlot({ gains: candidate.customGains, effects: candidate.customEffects })
                : createEmptyCustomSlot(),
            createEmptyCustomSlot(),
        ];

    // A sound saved under a retired built-in keeps playing as the first custom slot, and whatever the
    // older single custom slot held moves into the second one so neither of them is lost.
    if (isRetiredPresetId(candidate.preset)) {
        slots[1] = slots[0];
        slots[0] = { gains: [...gains], effects: { ...effects } };
        return slots;
    }

    if (isAudioEqualizerCustomSlotId(mode) && !storedSlots && !hasLegacyCustom) {
        slots[getAudioEqualizerCustomSlotIndex(mode)] = { gains: [...gains], effects: { ...effects } };
    }

    return slots;
};

// Normalizes untrusted persisted or imported data into ten safe gain values plus a complete effect chain.
export const resolveAudioEqualizerSettings = (value: unknown): AudioEqualizerSettings => {
    if (!value || typeof value !== 'object') {
        return {
            enabled: DEFAULT_AUDIO_EQUALIZER_SETTINGS.enabled,
            gains: [...DEFAULT_AUDIO_EQUALIZER_SETTINGS.gains],
            preset: DEFAULT_AUDIO_EQUALIZER_SETTINGS.preset,
            effects: createNeutralAudioEffects(),
            customSlots: createEmptyCustomSlots(),
        };
    }

    const candidate = value as Partial<AudioEqualizerSettings> & LegacyCustomFields;
    const gains = normalizeGains(candidate.gains);
    const hasStoredEffects = Boolean(candidate.effects) && typeof candidate.effects === 'object';
    const storedEffects = hasStoredEffects ? normalizeAudioEffects(candidate.effects) : createNeutralAudioEffects();
    const preset = resolveModeId(candidate.preset, gains, storedEffects);
    // Settings written before the effect chain existed keep a NEUTRAL chain, even when the preset
    // id they carry is one that now has effects attached to it.
    //
    // Upstream adopts the preset's effects here, on the reading that the id names a character and
    // the character now includes them. The stored value is a record of what someone chose, though,
    // and what they chose in that build was a tone curve: "Lo-Fi" meant a shape, not vinyl crackle
    // and bit crush. Honouring the name changes what their music sounds like during an update,
    // with no notice and no consent - reported here as "severe noise" by someone who never asked
    // for any.
    //
    // The two mistakes are not the same size. Adding an effect costs the listener noticing it,
    // finding the panel and switching it off; withholding one costs a click on a preset that is
    // still right there, still named the same, and still selected - resolveModeId keeps the id,
    // so re-picking it applies the full modern character deliberately.
    const effects = storedEffects;

    return {
        enabled: candidate.enabled === true,
        gains,
        preset,
        effects,
        customSlots: resolveCustomSlots(candidate, gains, effects, preset),
    };
};

export const readStoredAudioEqualizerSettings = (): AudioEqualizerSettings => {
    if (typeof window === 'undefined') {
        return resolveAudioEqualizerSettings(DEFAULT_AUDIO_EQUALIZER_SETTINGS);
    }

    const saved = window.localStorage.getItem(AUDIO_EQUALIZER_STORAGE_KEY);
    if (!saved) {
        return resolveAudioEqualizerSettings(DEFAULT_AUDIO_EQUALIZER_SETTINGS);
    }

    try {
        return resolveAudioEqualizerSettings(JSON.parse(saved));
    } catch {
        return resolveAudioEqualizerSettings(DEFAULT_AUDIO_EQUALIZER_SETTINGS);
    }
};

export const writeStoredAudioEqualizerSettings = (settings: AudioEqualizerSettings) => {
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(AUDIO_EQUALIZER_STORAGE_KEY, JSON.stringify(settings));
    }
};
