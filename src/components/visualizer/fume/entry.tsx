import React from 'react';
import { DEFAULT_FUME_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import { FumeSettingsPanel } from '../settingsPanels';
import VisualizerFume from './VisualizerFume';

// src/components/visualizer/fume/entry.tsx
// Registers Fume and its preview tuning panel.
export default defineVisualizer({
    mode: 'fume',
    order: 40,
    labelKey: 'ui.visualizerFume',
    labelFallback: 'Fume',
    previewSeed: 'fume',
    previewStartOffset: 18.4,
    tuningKind: 'fume',
    render: props => <VisualizerFume {...props} />,
    renderSettingsPanel: props => <FumeSettingsPanel {...props} />,
    resetSettings: ({ resetFumeTuning, setDraftFumeTuning }) => {
        setDraftFumeTuning?.(DEFAULT_FUME_TUNING);
        resetFumeTuning?.();
    },
});
