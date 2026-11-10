import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';
import { backgroundTuningConfig, getBackgroundTunings } from './tuningRegistry';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';

// src/components/visualizer/useVisualizerBackgroundConfig.ts
//
// The background half of the visualizer's configuration, assembled from the two stores that own it.
// Two surfaces need it - the on-screen renderer and the OBS browser source - and App.tsx used to
// build it for both, which is the only reason it ever lived there.

export const useVisualizerBackgroundConfig = (): VisualizerBackgroundConfig => {
    const settings = useVisualizerSettingsStore(useShallow(state => ({
        mode: state.visualizerBackgroundMode,
        opacity: state.backgroundOpacity,
        disableGeometricBackground: state.disableVisualizerGeometricBackground,
        disableVignette: state.disableVisualizerVignette,
        urlBackgroundList: state.urlBackgroundList,
        urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    })));
    // The backgrounds' tunings, under the store's field names: which there are, their declarations say.
    const tunings = useVisualizerSettingsStore(useShallow(state => Object.fromEntries(
        getBackgroundTunings().map(tuning => [tuning.settingsKey, (state as unknown as Record<string, unknown>)[tuning.settingsKey]]),
    )));
    const monetBackgroundImage = useVisualizerAssetStore(state => state.monetBackgroundImage);
    // Cover-derived tinting is a theme preference, not a visualizer one.
    const useCoverColorBg = useThemeSettingsStore(state => state.useCoverColorBg);

    return useMemo(() => ({
        mode: settings.mode,
        common: {
            useCoverColorBg,
            opacity: settings.opacity,
            disableGeometricBackground: settings.disableGeometricBackground,
            disableVignette: settings.disableVignette,
        },
        customImage: monetBackgroundImage,
        ...backgroundTuningConfig(tunings),
        url: {
            items: settings.urlBackgroundList,
            selectedId: settings.urlBackgroundSelectedId,
        },
    }), [settings, tunings, monetBackgroundImage, useCoverColorBg]);
};
