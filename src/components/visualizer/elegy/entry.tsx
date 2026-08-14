import React from 'react';
import { defineVisualizer } from '../definition';
import VisualizerElegy from './VisualizerElegy';

// src/components/visualizer/elegy/entry.tsx
// Auto-registers the experimental arbitrary-font handwriting visualizer.
export default defineVisualizer({
    mode: 'elegy',
    order: 75,
    labelKey: 'ui.visualizerElegy',
    labelFallback: 'Elegy',
    previewSeed: 'elegy',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <VisualizerElegy {...props} />,
});
