import React from 'react';
import { AlignLeft, AudioWaveform, Move } from 'lucide-react';
import { DEFAULT_MONET_TUNING, MONET_CHROME_VISIBILITIES, type MonetChromeVisibility, type MonetTuning } from '../../../types';
import { cycleValue, QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { MonetSettingsPanel } from './MonetSettingsPanel';
import { resolveMonetChromeVisibility } from './tuning';

const CHROME_VISIBILITY_LABEL_KEYS: Record<MonetChromeVisibility, string> = {
    auto: 'options.monetChromeVisibilityAuto',
    always: 'options.monetChromeVisibilityAlways',
    hidden: 'options.monetChromeVisibilityHidden',
};

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
        // The description and the drag handle each step through auto-hide, always shown and hidden on a click.
        const description = resolveMonetChromeVisibility(tuning.descriptionVisibility, tuning.showDescription);
        const hanger = resolveMonetChromeVisibility(tuning.portraitHangerVisibility, tuning.showPortraitDragHanger);
        return (
            <>
                <QuickControlToggle
                    active={description !== 'hidden'}
                    label={`${t('options.monetShowDescription')}: ${t(CHROME_VISIBILITY_LABEL_KEYS[description])}`}
                    onToggle={() => onTuningChange({ descriptionVisibility: cycleValue(MONET_CHROME_VISIBILITIES, description) })}
                >
                    <AlignLeft size={14} />
                </QuickControlToggle>
                <QuickControlToggle
                    active={hanger !== 'hidden'}
                    label={`${t('options.monetPortraitDragHanger')}: ${t(CHROME_VISIBILITY_LABEL_KEYS[hanger])}`}
                    onToggle={() => onTuningChange({ portraitHangerVisibility: cycleValue(MONET_CHROME_VISIBILITIES, hanger) })}
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
