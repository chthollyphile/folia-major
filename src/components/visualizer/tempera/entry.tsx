import React from 'react';
import { DEFAULT_TEMPERA_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import TemperaSettingsPanel from './TemperaSettingsPanel';

const VisualizerTempera = React.lazy(() => import('./VisualizerTempera'));

// src/components/visualizer/tempera/entry.tsx
// Registers 凝彩, the deterministic block-composition lyric-PV director.
export default defineVisualizer({
    mode: 'tempera',
    order: 20,
    labelKey: 'ui.visualizerTempera',
    labelFallback: 'Tempera',
    previewSeed: 'tempera',
    previewStartOffset: 0,
    tuningKind: 'tempera',
    // Deliberately unkeyed on the seed: the runtime hands a track change over in place
    // (see songHandover.ts / pixiRuntimeHost.ts). Remounting here would throw the WebGL
    // context away mid-transition and leave the frame empty for the whole rebuild.
    render: props => <VisualizerTempera {...props} />,
    renderSettingsPanel: props => <TemperaSettingsPanel {...props} />,
    resetSettings: ({ resetTemperaTuning, setDraftTemperaTuning }) => {
        setDraftTemperaTuning?.(DEFAULT_TEMPERA_TUNING);
        resetTemperaTuning?.();
    },
});
