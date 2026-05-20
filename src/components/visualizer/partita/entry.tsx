import React from 'react';
import { defineVisualizer } from '../definition';
import { PartitaSettingsPanel } from '../settingsPanels';
import VisualizerPartita from './VisualizerPartita';

// src/components/visualizer/partita/entry.tsx
// Registers Partita and its preview tuning panel.
export default defineVisualizer({
    mode: 'partita',
    order: 30,
    labelKey: 'ui.visualizerPartita',
    labelFallback: '云阶',
    previewSeed: 'partita',
    previewStartOffset: 0,
    tuningKind: 'partita',
    render: props => <VisualizerPartita {...props} />,
    renderSettingsPanel: props => <PartitaSettingsPanel {...props} />,
    resetSettings: ({ resetPartitaTuning }) => {
        resetPartitaTuning?.();
    },
});
