import React from 'react';
import { DEFAULT_SONNET_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import SonnetSettingsPanel from './SonnetSettingsPanel';
import VisualizerSonnet from './VisualizerSonnet';

// src/components/visualizer/sonnet/entry.tsx
// Registers 商籁, the deterministic Japanese MG lyric-PV director.
export default defineVisualizer({
    mode: 'sonnet',
    order: 70,
    labelKey: 'ui.visualizerSonnet',
    labelFallback: '商籁',
    previewSeed: 'sonnet',
    previewStartOffset: 0,
    tuningKind: 'sonnet',
    render: props => <VisualizerSonnet key={props.seed} {...props} />,
    renderSettingsPanel: props => <SonnetSettingsPanel {...props} />,
    resetSettings: ({ resetSonnetTuning, setDraftSonnetTuning }) => {
        setDraftSonnetTuning?.(DEFAULT_SONNET_TUNING);
        resetSonnetTuning?.();
    },
});
