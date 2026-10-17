import type { SmartBeatSettings, VisualizerBackgroundMode, VisualizerMode } from '../../types';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '../../types/visualizerModes';
import { getVisualizerRegistryEntry } from './registry';
import { getVisualizerBackgroundRegistryEntry } from './backgrounds/registry';

// src/components/visualizer/beatClockTargets.ts
// Whether anything on screen draws beat FX, which is when the beat clock (services/beatFx) runs and
// the playing track's beats are analysed. 智能动感模式 is one switch; what it drives is whatever the
// mode and the background on screen declare (`drawsBeatFx` on their registry entries). Apart from
// both registries so neither imports the other.

export interface BeatClockSettings {
    smartBeat: SmartBeatSettings;
    visualizerMode: VisualizerMode;
    /** Null is the default background (Latent), as everywhere a background is resolved. */
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
}

/**
 * True while 智能动感模式 is on and the mode on screen draws beat FX, or shows the shell background
 * and that background draws them.
 */
export const visualizerWantsBeatClock = (settings: BeatClockSettings): boolean => {
    if (!settings.smartBeat.enabled) return false;
    const entry = getVisualizerRegistryEntry(settings.visualizerMode);
    if (entry.drawsBeatFx) return true;
    if (entry.background === false) return false;
    const background = settings.visualizerBackgroundMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;
    return Boolean(getVisualizerBackgroundRegistryEntry(background).drawsBeatFx);
};

/** True while the beat clock runs for a mode that also plays drum hits (`drawsDrumHits`: 时计). */
export const visualizerWantsDrumHits = (settings: BeatClockSettings): boolean =>
    visualizerWantsBeatClock(settings) && Boolean(getVisualizerRegistryEntry(settings.visualizerMode).drawsDrumHits);
