import type { BeatEffectSetting, SmartBeatSettings } from '../../types';

// src/services/beatFx/beatEffects.ts
// The beat effects of 智能动感模式, each one a named thing a picture does on the music: declared on
// the visualizer or background registry entry that draws it (`beatEffects`), switched and scaled one
// by one in that mode's own settings (BeatEffectsGroup.tsx), under the one 智能动感模式 switch.
//
// An effect reads one source, and the source is what decides which model runs for the track on
// screen (components/visualizer/beatClockTargets.ts): 'beats' is Beat This!' beat list (final0, the
// beat clock in beatFxLive.ts), 'drums' htdemucs' drum hits (analysis/drumHits.ts). A picture whose
// live effects read only drums never runs beat_this, and the other way round.
//
// A retired effect keeps its code and its declaration but never plays and is not offered: the user
// set it aside (2026-10-17: 时计's 齿轮随拍 and the Latent background's 潮汐脉动) rather than deleting
// it, so it can come back by dropping `retired`.

export type BeatEffectSource = 'beats' | 'drums';

export interface BeatEffectDef {
    /** Stable, stored in settings and exported configs: `<mode>.<name>`. */
    id: string;
    /** i18n key of its four-character name (options.beatEffect_*). */
    nameKey: string;
    /** i18n key of what it does. */
    descKey: string;
    source: BeatEffectSource;
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
} as const;

/**
 * The effects the old 轻拍 / 重拍 strengths scaled (one pair for every picture, before effects had
 * their own): a stored or imported pair is folded into these.
 */
export const LEGACY_BEAT_LIST_EFFECT_IDS: readonly string[] = [BEAT_EFFECT_IDS.sonnetLensTear, BEAT_EFFECT_IDS.dioramaRipple];

/** The effect's setting, or the default for one never touched. */
export const resolveBeatEffectSetting = (settings: SmartBeatSettings, id: string): BeatEffectSetting =>
    settings.effects[id] ?? BEAT_EFFECT_DEFAULT;

/** Whether the effect plays: the switch on, the effect not retired and switched on itself. */
export const isBeatEffectLive = (settings: SmartBeatSettings, effect: BeatEffectDef): boolean =>
    settings.enabled && !effect.retired && resolveBeatEffectSetting(settings, effect.id).on;

/** The effects a registry entry offers in its settings: every one not retired. */
export const offeredBeatEffects = (effects: readonly BeatEffectDef[] | undefined): readonly BeatEffectDef[] =>
    (effects ?? []).filter(effect => !effect.retired);
