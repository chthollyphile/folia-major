import React from 'react';
import { defineVisualizer } from '../definition';
import VisualizerCladdagh from './VisualizerCladdagh';

// src/components/visualizer/claddagh/entry.tsx

export default defineVisualizer({
    mode: 'claddagh',
    order: 45,
    labelKey: 'ui.visualizerCladdagh',
    labelFallback: '指环',
    previewSeed: 'claddagh',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <VisualizerCladdagh {...props} />,
});
