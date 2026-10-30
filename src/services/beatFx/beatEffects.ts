import type { BeatEffectSetting, SmartBeatSettings } from '../../types';

// src/services/beatFx/beatEffects.ts
// The beat effects of 智能动感模式, each one a named thing a picture does on the music: declared on
// the visualizer or background registry entry that draws it (`beatEffects`), switched and scaled one
// by one in that mode's own settings (BeatEffectsGroup.tsx), under the one 智能动感模式 switch.
//
// An effect reads one source, and the source is what decides which model runs for the track on
// screen (components/visualizer/beatClockTargets.ts): 'beats' is Beat This!' beat list (final0, the
// beat clock in beatFxLive.ts), 'drums' htdemucs' drum hits (analysis/drumHits.ts), 'stems' the drum
// hits and the vocal envelope the same htdemucs run reads with them (analysis/vocalEnvelope.ts; 雾笺's
// 疏雨轻车). A picture whose live effects read only htdemucs never runs beat_this, and the other way round.
//
// An effect can be made of parts (`parts`), each with its own slider in place of the one strength:
// 疏雨轻车 is the rain on the voice and the bus jolting on the kicks, one switch, two strengths. A
// part plays at `getBeatEffectStrength(beatEffectPartId(id, key))` (beatFxLive.ts).
//
// A retired effect keeps its code and its declaration but never plays and is not offered: the user
// set it aside (2026-10-17: 时计's 齿轮随拍 and the Latent background's 潮汐脉动) rather than deleting
// it, so it can come back by dropping `retired`.

export type BeatEffectSource = 'beats' | 'drums' | 'stems';

/** A part of an effect with its own slider: a stable key (stored) and the i18n key of its name. */
export interface BeatEffectPart {
    key: string;
    nameKey: string;
}

export interface BeatEffectDef {
    /** Stable, stored in settings and exported configs: `<mode>.<name>`. */
    id: string;
    /** i18n key of its four-character name (options.beatEffect_*). */
    nameKey: string;
    /** i18n key of what it does. */
    descKey: string;
    source: BeatEffectSource;
    /** Its parts, each with its own strength slider in place of the one; see the header. */
    parts?: readonly BeatEffectPart[];
    /** Never plays and is not offered; see the header. */
    retired?: boolean;
}

/** The strength range of every effect; 1 is the look it was tuned to, the middle of the slider. */
export const BEAT_EFFECT_STRENGTH_MAX = 2;
export const BEAT_EFFECT_DEFAULT: BeatEffectSetting = { on: true, strength: 1 };

/** Every effect id in the app, so code that plays one names it rather than spelling it. */
export const BEAT_EFFECT_IDS = {
    sonnetLensTear: 'sonnet.lensTear',
    dioramaRipple: 'diorama.ripple',
    pendoloDrumhead: 'pendolo.drumhead',
    pendoloGearBeats: 'pendolo.gearBeats',
    latentPulse: 'latent.pulse',
    hanabiBeatBursts: 'hanabi.beatBursts',
    hanabiBeatPulse: 'hanabi.beatPulse',
    temperaInkFlash: 'tempera.inkFlash',
    machiNeonPulse: 'machi.neonPulse',
    machiDrumRipple: 'machi.drumRipple',
    machiScreenFlash: 'machi.screenFlash',
    nebbiaDrizzleRide: 'nebbia.drizzleRide',
} as const;

/**
 * The effects the old 轻拍 / 重拍 strengths scaled (one pair for every picture, before effects had
 * their own): a stored or imported pair is folded into these.
 */
export const LEGACY_BEAT_LIST_EFFECT_IDS: readonly string[] = [BEAT_EFFECT_IDS.sonnetLensTear, BEAT_EFFECT_IDS.dioramaRipple];

/** The id a part plays under in the live strengths (beatFxLive.ts `getBeatEffectStrength`). */
export const beatEffectPartId = (id: string, part: string): string => `${id}:${part}`;

/** A part's strength in an effect's setting, 1 for one never touched. */
export const resolveBeatEffectPartStrength = (setting: BeatEffectSetting, part: string): number => setting.parts?.[part] ?? 1;

/** The effect's setting, or the default for one never touched. */
export const resolveBeatEffectSetting = (settings: SmartBeatSettings, id: string): BeatEffectSetting =>
    settings.effects[id] ?? BEAT_EFFECT_DEFAULT;

/**
 * The effects that read drum hits (`source: 'drums'`), on any picture. Their declarations live on the
 * registry entries, which this service may not import, so the list is spelled out here.
 */
export const DRUM_BEAT_EFFECT_IDS: readonly string[] = [
    BEAT_EFFECT_IDS.pendoloDrumhead,
    BEAT_EFFECT_IDS.temperaInkFlash,
    BEAT_EFFECT_IDS.machiDrumRipple,
    BEAT_EFFECT_IDS.machiScreenFlash,
];

/** Whether any drum-hit effect is switched on, whichever picture is on screen. */
export const anyDrumBeatEffectOn = (settings: SmartBeatSettings): boolean =>
    DRUM_BEAT_EFFECT_IDS.some(id => resolveBeatEffectSetting(settings, id).on);

/** Whether the effects play at all: 智能动感模式 on, or on what is already stored (`cached`). */
export const smartBeatActive = (settings: SmartBeatSettings): boolean => settings.mode !== 'off';

/**
 * Whether a track with nothing stored is analysed now (`on`). Under `cached` no run is ever started
 * for the beat FX - see SmartBeatMode.
 */
export const smartBeatMayAnalyse = (settings: SmartBeatSettings): boolean => settings.mode === 'on';

/** Whether the effect plays: 智能动感模式 active, the effect not retired and switched on itself. */
export const isBeatEffectLive = (settings: SmartBeatSettings, effect: BeatEffectDef): boolean =>
    smartBeatActive(settings) && !effect.retired && resolveBeatEffectSetting(settings, effect.id).on;

/** The effects a registry entry offers in its settings: every one not retired. */
export const offeredBeatEffects = (effects: readonly BeatEffectDef[] | undefined): readonly BeatEffectDef[] =>
    (effects ?? []).filter(effect => !effect.retired);
