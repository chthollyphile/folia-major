import type { CommandPaletteContext } from '../../command-palette/types';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { useLyricSegmentationStore } from '../../../stores/useLyricSegmentationStore';
import { useVideoLayerSettingsStore } from '../../../stores/useVideoLayerSettingsStore';
import { getVisualizerRegistryEntry } from '../../visualizer/registry';
import { smartBeatActive } from '../../../services/beatFx/beatEffects';
import { isLyricSegmentationAiAvailable } from '../../../services/aiText';
import type { LyricSegmentationActions } from '../playback/createLyricSegmentationActions';
import { NEBBIA_BEHIND, NEBBIA_GLASS } from '../../visualizer/nebbia/types';

// src/components/app/command-palette-context/buildVisualizerCommandContext.ts
// The `visualizer` namespace. Almost entirely store-backed: App.tsx used to relay all seven
// members, and now only supplies the two segmentation actions, which need the lyric setter.

export const buildVisualizerCommandContext = (
    lyricSegmentationActions: LyricSegmentationActions,
): CommandPaletteContext['visualizer'] => {
    const visualizer = useVisualizerSettingsStore.getState();
    return {
        visualizerMode: visualizer.visualizerMode,
        visualizerBackgroundMode: visualizer.visualizerBackgroundMode,
        setVisualizerMode: visualizer.handleSetVisualizerMode,
        toggleRandomVisualizerModePerSong: () => visualizer.handleToggleRandomVisualizerModePerSong(
            !useVisualizerSettingsStore.getState().randomVisualizerModePerSong,
        ),
        toggleGlowBlurQuantize: () => visualizer.handleToggleGlowBlurQuantize(
            !useVisualizerSettingsStore.getState().glowBlurQuantize,
        ),
        setVisualizerBackgroundMode: visualizer.handleSetVisualizerBackgroundMode,
        setMonetBackgroundTuning: visualizer.handleSetMonetBackgroundTuning,
        setLatentBackgroundTuning: visualizer.handleSetLatentBackgroundTuning,
        // 和雾笺设置面板一样：换窗外不动玻璃，换玻璃不动窗外
        cycleNebbiaBehind: () => {
            const latest = useVisualizerSettingsStore.getState();
            const { behind } = latest.nebbiaTuning;
            const next = NEBBIA_BEHIND[(NEBBIA_BEHIND.indexOf(behind) + 1) % NEBBIA_BEHIND.length];
            latest.handleSetNebbiaTuning({ behind: next });
            return next;
        },
        cycleNebbiaGlass: () => {
            const latest = useVisualizerSettingsStore.getState();
            const next = NEBBIA_GLASS[(NEBBIA_GLASS.indexOf(latest.nebbiaTuning.glass) + 1) % NEBBIA_GLASS.length];
            latest.handleSetNebbiaTuning({ glass: next });
            return next;
        },
        toggleVideoLayer: () => {
            const videoLayer = useVideoLayerSettingsStore.getState();
            videoLayer.setVideoLayerEnabled(!videoLayer.videoLayerEnabled);
        },
        // One command per mode, as Latent's variants: a toggle would have to guess what "the other one" is
        // from the middle mode.
        setSmartBeatMode: mode => useVisualizerSettingsStore.getState().handleSetSmartBeat({ mode }),
        // The on / off toggle v0.7.21 shipped, kept beside them (from the PR #750 review): shortcuts and
        // pinned slots bound to its id would otherwise stop working without a word.
        toggleSmartBeat: () => {
            const latest = useVisualizerSettingsStore.getState();
            // Two ways only: any mode that plays goes off, off goes fully on. `cached` is chosen in the settings.
            latest.handleSetSmartBeat({ mode: smartBeatActive(latest.smartBeat) ? 'off' : 'on' });
        },
        pickVideoLayerFile: () => useVideoLayerSettingsStore.getState().pickLocalFile(),
        usesWordSegmentation: Boolean(getVisualizerRegistryEntry(visualizer.visualizerMode).usesWordSegmentation),
        lyricSegmentation: {
            record: useLyricSegmentationStore.getState().record,
            isAiAvailable: isLyricSegmentationAiAvailable(),
            save: lyricSegmentationActions.save,
            reset: lyricSegmentationActions.reset,
        },
    };
};
