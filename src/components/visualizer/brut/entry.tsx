import React from 'react';
import { defineVisualizer } from '../definition';
import VisualizerBrut from './VisualizerBrut';

// src/components/visualizer/brut/entry.tsx
// Registers the experimental endless brutalist concrete lyric wall.

export default defineVisualizer({
    mode: 'brut',
    order: 65,
    labelKey: 'ui.visualizerBrut',
    labelFallback: 'Brut',
    previewSeed: 'brut',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <VisualizerBrut {...props} />,
});
