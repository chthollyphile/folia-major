import React from 'react';
import StylePackManager from './StylePackManager';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';

// A command surface can install, choose and activate a pack without opening the settings window.
export default function StylePackSurface() {
    const pack = useVisualizerSettingsStore(state => state.stylePackTuning.pack);
    return <StylePackManager pack={pack} onApply={next => {
        const store = useVisualizerSettingsStore.getState();
        store.handleSetStylePackTuning({ pack: next });
        store.handleSetVisualizerMode('stylePack');
    }} />;
}
