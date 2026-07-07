import React from 'react';
import { defineVisualizer } from '../definition';
import { ClassicSettingsPanel } from '../settingsPanels';
import Visualizer from './Visualizer';

// src/components/visualizer/classic/entry.tsx
// Registers the classic visualizer mode.
export default defineVisualizer({
    mode: 'classic',
    order: 10,
    labelKey: 'ui.visualizerClassic',
    labelFallback: 'Luminous',
    previewSeed: 'classic',
    previewStartOffset: 0,
    tuningKind: 'classic',
    render: props => <Visualizer {...props} />,
    renderSettingsPanel: props => <ClassicSettingsPanel {...props} />,
    resetSettings: ({ resetClassicTuning }) => {
        resetClassicTuning?.();
    },
});
