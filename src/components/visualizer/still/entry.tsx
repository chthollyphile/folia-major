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
    // Draws no shell background, so the default background's beat FX must not run behind it.
    rendersBackground: false,
    render: props => <VisualizerStill {...props} />,
});
