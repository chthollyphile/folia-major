import type { SmartBeatSettings, VisualizerBackgroundMode, VisualizerMode } from '../../types';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '../../types/visualizerModes';
import { getVisualizerRegistryEntry } from './registry';
import { getVisualizerBackgroundRegistryEntry } from './backgrounds/registry';
import { isBeatEffectLive, resolveBeatEffectSetting, type BeatEffectDef, type BeatEffectSource } from '../../services/beatFx/beatEffects';

// src/components/visualizer/beatClockTargets.ts
// Whether anything on screen draws beat FX, which is when the beat clock (services/beatFx) runs, and
// which models run for the playing track. 智能动感模式 is one switch; what it drives is whatever the
// mode and the background on screen declare (`beatEffects` on their registry entries), each effect
// on or off and scaled by its own setting, and each reading beat_this' beats or htdemucs' drum hits:
// a model runs only while a live effect on screen reads it. Apart from both registries so neither
// imports the other.

export interface BeatClockSettings {
    smartBeat: SmartBeatSettings;
    visualizerMode: VisualizerMode;
    /** Null is the default background (Latent), as everywhere a background is resolved. */
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
}

/** The beat effects of the mode on screen and of its background, when it shows one. */
const effectsOnScreen = (settings: BeatClockSettings): readonly BeatEffectDef[] => {
    const entry = getVisualizerRegistryEntry(settings.visualizerMode);
    const own = entry.beatEffects ?? [];
    if (entry.background === false) return own;
    const background = settings.visualizerBackgroundMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;
    const behind = getVisualizerBackgroundRegistryEntry(background).beatEffects ?? [];
    return behind.length ? [...own, ...behind] : own;
};

/** The effects on screen that play now: 智能动感模式 on, the effect not retired and switched on. */
export const liveBeatEffects = (settings: BeatClockSettings): BeatEffectDef[] =>
    effectsOnScreen(settings).filter(effect => isBeatEffectLive(settings.smartBeat, effect));

/** True while a live effect on screen reads beat_this' beats: the beat list is analysed and installed. */
export const visualizerWantsBeats = (settings: BeatClockSettings): boolean =>
    liveBeatEffects(settings).some(effect => effect.source === 'beats');

/** True while a live effect on screen plays drum hits (时计's 仿真鼓面): htdemucs separates the track. */
export const visualizerWantsDrumHits = (settings: BeatClockSettings): boolean =>
    liveBeatEffects(settings).some(effect => effect.source === 'drums');

/**
 * True while either model is wanted, which is when the beat clock steps: it carries the heard time
 * and the track key that drum hits are read against, too.
 */
export const visualizerWantsBeatClock = (settings: BeatClockSettings): boolean =>
    visualizerWantsBeats(settings) || visualizerWantsDrumHits(settings);

/**
 * The strength of the live effect reading `source`, 0 with none. One per source per picture for
 * now (a beat-list effect's strength is the clock's 轻拍 / 重拍 scale); a picture with two would
 * read each effect's own (`getBeatEffectStrength`).
 */
export const liveBeatEffectStrength = (settings: BeatClockSettings, source: BeatEffectSource): number => {
    const effect = liveBeatEffects(settings).find(candidate => candidate.source === source);
    return effect ? resolveBeatEffectSetting(settings.smartBeat, effect.id).strength : 0;
};
