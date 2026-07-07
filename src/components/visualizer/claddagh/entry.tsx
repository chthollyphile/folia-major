import React from 'react';
import { DEFAULT_CLADDAGH_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import { CladdaghSettingsPanel } from '../settingsPanels';
import VisualizerCladdagh from './VisualizerCladdagh';

// src/components/visualizer/claddagh/entry.tsx

export default defineVisualizer({
    mode: 'claddagh',
    order: 45,
    labelKey: 'ui.visualizerCladdagh',
    labelFallback: 'Claddagh',
    previewSeed: 'claddagh',
    previewStartOffset: 0,
    tuningKind: 'claddagh',
    render: props => <VisualizerCladdagh {...props} />,
    renderSettingsPanel: props => <CladdaghSettingsPanel {...props} />,
    resetSettings: ({ resetCladdaghTuning, setDraftCladdaghTuning }) => {
        setDraftCladdaghTuning?.(DEFAULT_CLADDAGH_TUNING);
        resetCladdaghTuning?.();
    },
});
