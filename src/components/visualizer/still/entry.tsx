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
    // 静止：三行静态歌词
    glyph: (
        <>
            <path d="M5 7.5h14" opacity="0.35" />
            <path d="M3 12h18" />
            <path d="M6 16.5h12" opacity="0.35" />
        </>
    ),
    command: {
        title: 'Visualizer: Still',
        description: 'Switch to the static low-resource visualizer',
        keywords: ['still', 'static', 'low resource', '静止', '静态', '低占用'],
    },
    // No background, as VisualizerStill's own shell has none.
    background: false,
    render: props => <VisualizerStill {...props} />,
});
