import React from 'react';
import { DEFAULT_CADENZA_TUNING } from '../../../types';
import { defineVisualizer, type VisualizerSharedProps } from '../definition';
import CadenzaSettingsPanel from './CadenzaSettingsPanel';

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
    // 心象：字符散落成云，焦点字被光圈套住
    glyph: (
        <>
            <circle cx="9.5" cy="12.5" r="3.5" />
            <path d="M4 6.5h3.5" opacity="0.45" />
            <path d="M16 8h4" opacity="0.45" />
            <path d="M15 17h4.5" opacity="0.45" />
        </>
    ),
    command: {
        title: 'Visualizer: Mindscape',
        description: 'Switch to cadenza visualizer',
        keywords: ['visualizer cadenza', 'cadenza', 'mindscape', '心象'],
    },
    render: renderCadenza,
    renderSettingsPanel: props => <CadenzaSettingsPanel {...props} />,
});
