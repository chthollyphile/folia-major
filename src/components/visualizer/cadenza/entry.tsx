import React from 'react';
import { DEFAULT_CADENZA_TUNING } from '../../../types';
import { defineVisualizer, type VisualizerSharedProps } from '../definition';

const VisualizerCadenza = React.lazy(() => import('./VisualizerCadenza'));

// src/components/visualizer/cadenza/entry.tsx
// Registers Cadenza and keeps its font-scale adaptation local to the mode.
const renderCadenza = ({
    cadenzaTuning = DEFAULT_CADENZA_TUNING,
    lyricsFontScale = 1,
    ...props
}: VisualizerSharedProps) => (
    <VisualizerCadenza
        {...props}
        lyricsFontScale={lyricsFontScale}
        cadenzaTuning={{
            ...cadenzaTuning,
            fontScale: cadenzaTuning.fontScale * lyricsFontScale,
        }}
    />
);

export default defineVisualizer({
    mode: 'cadenza',
    order: 40,
    labelKey: 'ui.visualizerCadenze',
    labelFallback: 'Mindscape',
    previewSeed: 'cadenza',
    previewStartOffset: 0,
    tuningKind: 'cadenza',
    render: renderCadenza,
});
