import React from 'react';
import { Contrast, Scissors } from 'lucide-react';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import { QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import metaphorTuning from './tuning';
import type { MetaphorTuning } from './types';

const VisualizerMetaphor = React.lazy(() => import('./VisualizerMetaphor'));
// 面板也按需加载：它的「渲染」一组读设置 store，store 又认注册表，直接 import 会把这个 entry 接进那个循环依赖的环里
const MetaphorSettingsPanel = React.lazy(() => import('./MetaphorSettingsPanel'));

// src/components/visualizer/metaphor/entry.tsx
// Registers 隐喻 (Metaphor), a three.js style in the manner of a conceptual, experimental lyric animation: the lyrics and the
// ornaments around them are amorphous ink — metaballs and glyphs drawn into one field and thresholded, so they fuse and part —
// developed through a flow field, a halftone screen and a coarse sandpaper grain. Everything in it is slow. The picture moves by
// editing, not by tweening: a shot list compiled from the song cuts hard between camera positions on the sung words (wide, close,
// macro, dutch, far with empty paper, a pull-back at the end of a line). The camera always faces the page — no yaw or pitch — and
// inside a shot it only creeps; a move that covers distance (following a word, pulling back, crashing in) is done as a few jump
// cuts on the words. The ink does not drip: blobs collide like beams in an accelerator and throw fragments out on spiral tracks.

export default defineVisualizer({
    mode: 'metaphor',
    order: 29.5,
    labelKey: 'ui.visualizerMetaphor',
    labelFallback: '隐喻',
    previewSeed: 'metaphor',
    previewStartOffset: 0,
    // 隐喻：两颗融在一起的墨球，旁边一小滴，底下一排网点
    glyph: (
        <>
            <path d="M4.5 10.5a4 4 0 0 1 7.2-2.4c.9 1.1 1.9 1.1 2.8.3a3 3 0 1 1 1.2 5c-1.6-.5-2.7.2-3.4 1.4A4 4 0 0 1 4.5 10.5z" />
            <circle cx="19.5" cy="6" r="1" opacity="0.6" />
            <path d="M5 20h.01M9 20h.01M13 20h.01M17 20h.01" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Metaphor',
        description: 'Switch to the Metaphor ink, halftone and hard-cut visualizer',
        keywords: ['metaphor', 'metaball', 'halftone', 'grain', 'fluid ink', 'experimental', 'hard cut', '隐喻', '融球', '半调', '颗粒', '实验', '硬切'],
    },
    // 画面自己铺纸：不要共用背景。播放页透明时纸不画（VisualizerMetaphor.tsx 的 seeThrough）。
    background: false,
    usesWordSegmentation: true,
    beatEffects: [
        {
            id: BEAT_EFFECT_IDS.metaphorAnnihilation,
            nameKey: 'options.beatEffect_metaphorAnnihilation',
            descKey: 'options.beatEffect_metaphorAnnihilationDesc',
            source: 'beats',
        },
    ],
    // Deliberately unkeyed on the seed: the runtime takes a track change in place (pixiRuntimeHost.ts).
    render: props => <VisualizerMetaphor {...props} metaphorTuning={metaphorTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}>
            <MetaphorSettingsPanel {...props} />
        </React.Suspense>
    ),
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<MetaphorTuning>) => (
        <>
            <QuickControlToggle
                active={tuning.flip}
                label={t('options.metaphorFlip')}
                onToggle={() => onTuningChange({ flip: !tuning.flip })}
            >
                <Contrast size={14} />
            </QuickControlToggle>
            <QuickControlToggle
                active={tuning.transitions}
                label={t('options.metaphorTransitions')}
                onToggle={() => onTuningChange({ transitions: !tuning.transitions })}
            >
                <Scissors size={14} />
            </QuickControlToggle>
        </>
    ),
    ownFontSizeNoticeKey: 'options.metaphorFontSizeAutoNotice',
});
