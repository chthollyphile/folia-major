import React from 'react';
import { AlignLeft, AudioWaveform, Move } from 'lucide-react';
import { DEFAULT_MONET_TUNING, type MonetTuning } from '../../../types';
import { QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { MonetSettingsPanel } from './MonetSettingsPanel';

const VisualizerMonet = React.lazy(() => import('./VisualizerMonet'));

// src/components/visualizer/monet/entry.tsx
// Registers the Monet poster visualizer and its mode-owned settings panel.
export default defineVisualizer({
    mode: 'monet',
    order: 90,
    labelKey: 'ui.visualizerMonet',
    labelFallback: 'Monet',
    previewSeed: 'monet',
    previewStartOffset: 0,
    // 莫奈：左侧关键字，右侧立绘
    glyph: (
        <>
            <path d="M3 9.5h7" />
            <path d="M3 13.5h5" opacity="0.55" />
            <rect x="14" y="5" width="7" height="14" rx="1.5" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Visualizer: Monet',
        description: 'Switch to Monet visualizer',
        keywords: ['monet', '莫奈', '切换到可视化：莫奈', '切换到可视化莫奈'],
    },
    seeksOnLineClick: true,
    // 混音过渡时背景和封面随过渡换成下一首，文字和歌词在交叉点换（VisualizerMonet）
    followsSongHandoff: true,
    render: props => {
        const monetTuning = props.monetTuning ?? DEFAULT_MONET_TUNING;
        const lyricsFontScale = props.lyricsFontScale ?? 1;
        return (
            <VisualizerMonet
                {...props}
                monetTuning={{
                    ...monetTuning,
                    fontScale: monetTuning.fontScale * lyricsFontScale,
                }}
            />
        );
    },
    renderSettingsPanel: props => <MonetSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<MonetTuning>) => {
        const showHanger = tuning.showPortraitDragHanger ?? true;
        return (
            <>
                <QuickControlToggle
                    active={tuning.showDescription}
                    label={t('options.monetShowDescription')}
                    onToggle={() => onTuningChange({ showDescription: !tuning.showDescription })}
                >
                    <AlignLeft size={14} />
                </QuickControlToggle>
                <QuickControlToggle
                    active={showHanger}
                    label={t('options.monetPortraitDragHanger')}
                    onToggle={() => onTuningChange({ showPortraitDragHanger: !showHanger })}
                >
                    <Move size={14} />
                </QuickControlToggle>
                <QuickControlToggle
                    active={tuning.showAudioVisualization}
                    label={t('options.monetShowAudioVisualization')}
                    onToggle={() => onTuningChange({ showAudioVisualization: !tuning.showAudioVisualization })}
                >
                    <AudioWaveform size={14} />
                </QuickControlToggle>
            </>
        );
    },
});
