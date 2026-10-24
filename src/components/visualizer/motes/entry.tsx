import React from 'react';
import { defineVisualizer } from '../definition';
import MotesSettingsPanel from './MotesSettingsPanel';
import motesTuning from './tuning';

// Registers Motes: particles gather into lyric glyphs, then disperse with the lyric clock.
const VisualizerMotes = React.lazy(() => import('./VisualizerMotes'));

export default defineVisualizer({
    mode: 'motes',
    order: 145,
    labelKey: 'ui.visualizerMotes',
    labelFallback: 'Motes',
    previewSeed: 'motes',
    previewStartOffset: 0,
    glyph: (
        <>
            <path d="M8 17V7h5M8 12h4" />
            <circle cx="16" cy="7" r="0.7" />
            <circle cx="16" cy="12" r="0.7" />
            <circle cx="19" cy="9" r="0.7" />
            <circle cx="14" cy="17" r="0.7" />
            <circle cx="18" cy="16" r="0.7" />
        </>
    ),
    command: {
        title: 'Visualizer: Motes',
        description: 'Switch to Motes particle lyrics',
        keywords: ['motes', 'particles', '尘语', '粒子', '聚散成字'],
    },
    render: props => <VisualizerMotes {...props} tuning={motesTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => <MotesSettingsPanel {...props} />,
});
