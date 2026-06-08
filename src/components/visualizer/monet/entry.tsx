import React from 'react';
import { defineVisualizer } from '../definition';
import VisualizerMonet from './VisualizerMonet';
import { MonetSettingsPanel } from './MonetSettingsPanel';

// src/components/visualizer/monet/entry.tsx
// Registers the Monet poster visualizer and its mode-owned settings panel.
export default defineVisualizer({
    mode: 'monet',
    order: 45,
    labelKey: 'ui.visualizerMonet',
    labelFallback: '莫奈',
    previewSeed: 'monet',
    previewStartOffset: 0,
    tuningKind: 'monet',
    render: props => <VisualizerMonet {...props} />,
    renderSettingsPanel: props => <MonetSettingsPanel {...props} />,
    resetSettings: ({ resetMonetTuning }) => {
        resetMonetTuning?.();
    },
});
