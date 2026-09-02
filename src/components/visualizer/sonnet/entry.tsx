import React from 'react';
import { DEFAULT_SONNET_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import SonnetSettingsPanel from './SonnetSettingsPanel';

const VisualizerSonnet = React.lazy(() => import('./VisualizerSonnet'));

// src/components/visualizer/sonnet/entry.tsx
// Registers 商籁, the deterministic Japanese MG lyric-PV director.
export default defineVisualizer({
    mode: 'sonnet',
    order: 10,
    labelKey: 'ui.visualizerSonnet',
    labelFallback: '商籁',
    previewSeed: 'sonnet',
    previewStartOffset: 0,
    tuningKind: 'sonnet',
    // Deliberately unkeyed on the seed: the runtime hands a track change over in place
    // (see songHandover.ts / pixiRuntimeHost.ts). Remounting here would throw the WebGL
    // context away mid-transition and leave the frame empty for the whole rebuild.
    render: props => <VisualizerSonnet {...props} />,
    renderSettingsPanel: props => <SonnetSettingsPanel {...props} />,
    resetSettings: ({ resetSonnetTuning, setDraftSonnetTuning }) => {
        setDraftSonnetTuning?.(DEFAULT_SONNET_TUNING);
        resetSonnetTuning?.();
    },
});
