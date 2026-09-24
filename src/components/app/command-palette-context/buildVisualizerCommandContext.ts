import type { CommandPaletteContext } from '../../command-palette/types';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { useLyricSegmentationStore } from '../../../stores/useLyricSegmentationStore';
import { useVideoLayerSettingsStore } from '../../../stores/useVideoLayerSettingsStore';
import { getVisualizerRegistryEntry } from '../../visualizer/registry';
import { isLyricSegmentationAiAvailable } from '../../../services/lyricSegmentationAi';
import type { LyricSegmentationActions } from '../playback/createLyricSegmentationActions';

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
        setVisualizerBackgroundMode: visualizer.handleSetVisualizerBackgroundMode,
        setMonetBackgroundTuning: visualizer.handleSetMonetBackgroundTuning,
        setLatentBackgroundTuning: visualizer.handleSetLatentBackgroundTuning,
        toggleVideoLayer: () => {
            const videoLayer = useVideoLayerSettingsStore.getState();
            videoLayer.setVideoLayerEnabled(!videoLayer.videoLayerEnabled);
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
