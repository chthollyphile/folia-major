import React from 'react';
import { defineVisualizer } from '../definition';
import Visualizer from './Visualizer';

// src/components/visualizer/classic/entry.tsx
// Registers the classic visualizer mode.
export default defineVisualizer({
    mode: 'classic',
    order: 10,
    labelKey: 'ui.visualizerClassic',
    labelFallback: '流光',
    previewSeed: 'classic',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <Visualizer {...props} />,
});
