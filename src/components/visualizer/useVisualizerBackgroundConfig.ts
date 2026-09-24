import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';
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
        monetBackgroundTuning: state.monetBackgroundTuning,
        nomandBackgroundTuning: state.nomandBackgroundTuning,
        latentBackgroundTuning: state.latentBackgroundTuning,
        soraBackgroundTuning: state.soraBackgroundTuning,
        urlBackgroundList: state.urlBackgroundList,
        urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    })));
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
        monet: { tuning: settings.monetBackgroundTuning },
        nomand: { tuning: settings.nomandBackgroundTuning },
        latent: { tuning: settings.latentBackgroundTuning },
        sora: { tuning: settings.soraBackgroundTuning },
        url: {
            items: settings.urlBackgroundList,
            selectedId: settings.urlBackgroundSelectedId,
        },
    }), [settings, monetBackgroundImage, useCoverColorBg]);
};
