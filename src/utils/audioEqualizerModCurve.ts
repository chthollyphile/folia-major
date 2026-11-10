import { areAudioEffectsEqual, normalizeAudioEffects, type AudioEffectSettings } from './audioEffects';
import {
    getAudioEqualizerCustomSlotIndex,
    isAudioEqualizerCustomSlotId,
    normalizeAudioEqualizerGains,
    resolveAudioEqualizerSettings,
    type AudioEqualizerCustomSlotId,
    type AudioEqualizerModeId,
    type AudioEqualizerSettings,
} from './audioEqualizer';
import { isAudioSoundPresetId } from './audioPresets';

// src/utils/audioEqualizerModCurve.ts
// A curve a mod put in place over the listener's own sound (Folium 1.7 `folium.equalizer.applyCurve`), as
// plain data and pure functions. The listener's own settings (audio_equalizer_settings) never hold it: the
// audio settings store keeps it in a field of its own.

/** Who made an equalizer change: the window, a host command, the host itself, or a mod. */
export type AudioEqualizerChangeOrigin =
    | { kind: 'user' } | { kind: 'command' } | { kind: 'host' } | { kind: 'mod'; modId: string };

/** The listener's own sound when a curve went on: what the start-up check compares. */
export type AudioEqualizerOwnSound = { preset: AudioEqualizerModeId; gains: number[]; effects: AudioEffectSettings };

export type AudioEqualizerModCurve = {
    modId: string;
    /** The mod's name when it applied the curve, for the window after the mod is gone. */
    modName: string;
    /** Ten gains, normalized (normalizeAudioEqualizerModCurveGains). */
    gains: number[];
    base: AudioEqualizerOwnSound;
};

/** The version of the stored value this build writes and reads. */
export const AUDIO_EQUALIZER_MOD_CURVE_VERSION = 1;

/**
 * A mod's gains as the host keeps them: ten bands (one left out reads 0), each clamped to ±12 dB like the
 * window's, then rounded to 0.1 dB so the window shows no long fractions and the same curve compares the same.
 */
export const normalizeAudioEqualizerModCurveGains = (gains: unknown): number[] => (
    normalizeAudioEqualizerGains(gains).map((gain) => {
        const rounded = Math.round(gain * 10) / 10;
        // -0 reads and saves as 0.
        return rounded === 0 ? 0 : rounded;
    })
);

/** Whether two curve records are the same curve: both none, or the same mod with the same gains. The name and the base are not compared. */
export const areAudioEqualizerModCurvesEqual = (
    left: Pick<AudioEqualizerModCurve, 'modId' | 'gains'> | null,
    right: Pick<AudioEqualizerModCurve, 'modId' | 'gains'> | null,
): boolean => {
    if (!left || !right) {
        return left === right;
    }
    return left.modId === right.modId
        && left.gains.length === right.gains.length
        && left.gains.every((gain, index) => gain === right.gains[index]);
};

/**
 * Whether the listener's own sound is still the one a curve went on over. `base` is put through this
 * build's normalization first, so an effect added since it was saved reads as neutral and is no change.
 * The switch is not part of it: turning processing off and on under a curve is allowed.
 */
export const isSameOwnSound = (base: AudioEqualizerOwnSound, settings: AudioEqualizerSettings): boolean => {
    const then = resolveAudioEqualizerSettings({ ...settings, preset: base.preset, gains: base.gains, effects: base.effects });
    return then.preset === settings.preset
        && then.gains.length === settings.gains.length
        && then.gains.every((gain, index) => gain === settings.gains[index])
        && areAudioEffectsEqual(then.effects, settings.effects);
};

/**
 * The settings the audio graph and the window use: the listener's own, with a mod's curve over the gains
 * unless that curve is suspended. The same object when no curve is heard. `curve` may be undefined (a test's
 * partial store mock), read as none.
 */
export const resolveHeardAudioEqualizerSettings = (
    settings: AudioEqualizerSettings,
    curve: AudioEqualizerModCurve | null | undefined,
    suspended: boolean | undefined,
): AudioEqualizerSettings => {
    if (!curve || suspended) {
        return settings;
    }
    return { ...settings, gains: [...curve.gains] };
};

/**
 * The window's "save to custom N": that slot becomes the curve with the listener's current effects and is
 * chosen, the other slot and the switch stay as they are.
 */
export const saveAudioEqualizerModCurveToSlot = (
    settings: AudioEqualizerSettings,
    curve: Pick<AudioEqualizerModCurve, 'gains'>,
    slotId: AudioEqualizerCustomSlotId,
): AudioEqualizerSettings => {
    const slotIndex = getAudioEqualizerCustomSlotIndex(slotId);
    return resolveAudioEqualizerSettings({
        ...settings,
        preset: slotId,
        gains: [...curve.gains],
        effects: { ...settings.effects },
        customSlots: settings.customSlots.map((slot, index) => (
            index === slotIndex ? { gains: [...curve.gains], effects: { ...settings.effects } } : slot
        )),
    });
};

/** The stored form of a curve: JSON with a version, so a later build's value is told apart from a broken one. */
export const serializeAudioEqualizerModCurve = (curve: AudioEqualizerModCurve): string => JSON.stringify({
    v: AUDIO_EQUALIZER_MOD_CURVE_VERSION,
    modId: curve.modId,
    modName: curve.modName,
    gains: curve.gains,
    base: { preset: curve.base.preset, gains: curve.base.gains, effects: curve.base.effects },
});

/**
 * What a stored value is: a curve; broken (`drop`: remove the key); or saved by a later version (`ignore`:
 * not used here, and the key is kept, so going back to that version finds the curve again).
 */
export type StoredAudioEqualizerModCurve =
    | { curve: AudioEqualizerModCurve }
    | { drop: true }
    | { ignore: true; version: unknown };

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Reads a stored curve (see StoredAudioEqualizerModCurve). Throws nothing. */
export const parseStoredAudioEqualizerModCurve = (raw: string): StoredAudioEqualizerModCurve => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // No version to tell it by: it cannot be a later version's valid value.
        return { drop: true };
    }
    if (!isPlainObject(parsed)) {
        return { drop: true };
    }
    if (parsed.v !== AUDIO_EQUALIZER_MOD_CURVE_VERSION) {
        return { ignore: true, version: parsed.v };
    }
    const { modId, modName, gains, base } = parsed;
    if (typeof modId !== 'string' || modId === '' || !Array.isArray(gains) || !isPlainObject(base)) {
        return { drop: true };
    }
    const { preset, gains: baseGains, effects } = base;
    if (
        !(isAudioSoundPresetId(preset) || isAudioEqualizerCustomSlotId(preset))
        || !Array.isArray(baseGains)
        || !isPlainObject(effects)
    ) {
        return { drop: true };
    }
    return {
        curve: {
            modId,
            modName: typeof modName === 'string' && modName !== '' ? modName : modId,
            gains: normalizeAudioEqualizerModCurveGains(gains),
            base: { preset, gains: normalizeAudioEqualizerGains(baseGains), effects: normalizeAudioEffects(effects) },
        },
    };
};
