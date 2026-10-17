import React from 'react';
import { defineVisualizer } from '../definition';
import PendoloSettingsPanel from './PendoloSettingsPanel';

const VisualizerPendolo = React.lazy(() => import('./VisualizerPendolo'));

// src/components/visualizer/pendolo/entry.tsx

export default defineVisualizer({
    mode: 'pendolo',
    order: 100,
    labelKey: 'ui.visualizerPendolo',
    labelFallback: 'Pendolo',
    previewSeed: 'pendolo',
    previewStartOffset: 0,
    // 时计：左侧齿轮，右侧歌词
    glyph: (
        <>
            <circle cx="8" cy="12" r="5" />
            <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <path d="M16 10h5" opacity="0.55" />
            <path d="M16 14h4" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Visualizer: Pendolo',
        description: 'Switch to Pendolo visualizer',
        keywords: ['pendolo', '擒纵', '摆轮', 'pd', '切换到可视化：擒纵', '切换到可视化擒纵'],
    },
    seeksOnLineClick: true,
    // 智能动感模式: the clockwork steps on the beats and draws its beat FX (pendolo/pendoloBeatFx.ts).
    drawsBeatFx: true,
    // ...and, once the track's drum stem is read (htdemucs_gpu), plays its drum hits instead.
    drawsDrumHits: true,
    // The song-scoped seed resets Pendolo's lyric rail state before the next track starts.
    render: props => <VisualizerPendolo key={props.seed} {...props} />,
    renderSettingsPanel: props => <PendoloSettingsPanel {...props} />,
});
