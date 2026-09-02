import React from 'react';
import { defineVisualizer } from '../definition';

const VisualizerStill = React.lazy(() => import('./VisualizerStill'));

// src/components/visualizer/still/entry.tsx
// Registers the static low-resource visualizer mode.
export default defineVisualizer({
    mode: 'still',
    order: 130,
    labelKey: 'ui.visualizerStill',
    labelFallback: 'Still',
    previewSeed: 'still',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <VisualizerStill {...props} />,
});
