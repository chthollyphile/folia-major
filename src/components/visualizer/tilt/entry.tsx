import React from 'react';
import { defineVisualizer } from '../definition';
import { TiltSettingsPanel } from '../settingsPanels';
import VisualizerTilt from './VisualizerTilt';

// src/components/visualizer/tilt/entry.tsx
// Registers Tilt and its preview tuning panel.
export default defineVisualizer({
    mode: 'tilt',
    order: 40,
    labelKey: 'ui.visualizerTilt',
    labelFallback: 'Tilt',
    previewSeed: 'tilt',
    previewStartOffset: 0,
    tuningKind: 'tilt',
    render: props => <VisualizerTilt {...props} />,
    renderSettingsPanel: props => <TiltSettingsPanel {...props} />,
    resetSettings: ({ resetTiltTuning }) => {
        resetTiltTuning?.();
    },
});
