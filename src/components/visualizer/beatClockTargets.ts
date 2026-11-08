import type { SmartBeatSettings, VisualizerBackgroundMode, VisualizerMode } from '../../types';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '../../types/visualizerModes';
import { getVisualizerRegistryEntry } from './registry';
import { getVisualizerBackgroundRegistryEntry } from './backgrounds/registry';
import { collectVisualizerTunings } from './tuningRegistry';
import type { VisualizerTuningSettings } from './tuningDefinition';
import { isBeatEffectLive, resolveBeatEffectSetting, type BeatEffectDef, type BeatEffectSource } from '../../services/beatFx/beatEffects';

// src/components/visualizer/beatClockTargets.ts
// Whether anything on screen draws beat FX, which is when the beat clock (services/beatFx) runs, and
// which models run for the playing track. 智能动感模式 is one switch; what it drives is whatever the
// mode and the background on screen declare (`beatEffects` on their registry entries), each effect
// on or off and scaled by its own setting, and each reading beat_this' beats or htdemucs' drum hits:
// a model runs only while a live effect on screen reads it. Apart from both registries so neither
// imports the other.

/** The modes' tunings come as the settings store holds them (`nebbiaTuning`, ...); one left out reads as its defaults. */
export interface BeatClockSettings extends Partial<VisualizerTuningSettings> {
    smartBeat: SmartBeatSettings;
    visualizerMode: VisualizerMode;
    /** Null is the default background (Latent), as everywhere a background is resolved. */
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    /** The player page is see-through (透明背景 or the native blur): no background is drawn under any mode. */
    pageTransparent?: boolean;
}

/**
 * Whether the background is drawn under the mode on screen: not under one without (Still), not on a
 * see-through page, and not where the mode's tunings say so (雾笺 drawing its own night street).
 */
export const backgroundOnScreen = (settings: BeatClockSettings): boolean => {
    const entry = getVisualizerRegistryEntry(settings.visualizerMode);
    if (entry.background === false || settings.pageTransparent) return false;
    return entry.showsBackground?.(collectVisualizerTunings(settings as unknown as Record<string, unknown>)) ?? true;
};

/**
 * The beat effects of the mode on screen, those its tunings draw (`beatEffectOnScreen`), and of its
 * background, when it shows one.
 */
const effectsOnScreen = (settings: BeatClockSettings): readonly BeatEffectDef[] => {
    const entry = getVisualizerRegistryEntry(settings.visualizerMode);
    const shown = entry.beatEffectOnScreen;
    const tunings = shown ? collectVisualizerTunings(settings as unknown as Record<string, unknown>) : null;
    const own = shown
        ? (entry.beatEffects ?? []).filter(effect => shown(effect.id, tunings!, Boolean(settings.pageTransparent)))
        : entry.beatEffects ?? [];
    if (!backgroundOnScreen(settings)) return own;
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
 * True while a live effect on screen reads the drum hits and the vocal envelope (雾笺's 疏雨轻车):
 * htdemucs separates the track with the vocal stem too.
 */
export const visualizerWantsStems = (settings: BeatClockSettings): boolean =>
    liveBeatEffects(settings).some(effect => effect.source === 'stems');

/**
 * True while either model is wanted, which is when the beat clock steps: it carries the heard time
 * and the track key that drum hits and the vocal envelope are read against, too.
 */
export const visualizerWantsBeatClock = (settings: BeatClockSettings): boolean =>
    visualizerWantsBeats(settings) || visualizerWantsDrumHits(settings) || visualizerWantsStems(settings);

/**
 * The strength of the live effect reading `source`, 0 with none. One per source per picture for
 * now (a beat-list effect's strength is the clock's 轻拍 / 重拍 scale); a picture with two would
 * read each effect's own (`getBeatEffectStrength`).
 */
export const liveBeatEffectStrength = (settings: BeatClockSettings, source: BeatEffectSource): number => {
    const effect = liveBeatEffects(settings).find(candidate => candidate.source === source);
    return effect ? resolveBeatEffectSetting(settings.smartBeat, effect.id).strength : 0;
};
