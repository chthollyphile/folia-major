import React from 'react';
import { Spline } from 'lucide-react';
import type { PartitaTuning } from '../../../types';
import { QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { PartitaSettingsPanel } from '../settingsPanels';

const VisualizerPartita = React.lazy(() => import('./VisualizerPartita'));

// src/components/visualizer/partita/entry.tsx
// Registers Partita and its preview tuning panel.
export default defineVisualizer({
    mode: 'partita',
    order: 50,
    labelKey: 'ui.visualizerPartita',
    labelFallback: '云阶',
    previewSeed: 'partita',
    previewStartOffset: 0,
    // 云阶：逐行向右下错落的阶梯
    glyph: (
        <>
            <path d="M4 7h7" />
            <path d="M8.5 12h7" opacity="0.7" />
            <path d="M13 17h7" opacity="0.45" />
        </>
    ),
    command: {
        title: 'Visualizer: Partita',
        description: 'Switch to partita visualizer',
        keywords: ['partita', '云阶'],
    },
    usesWordSegmentation: true,
    render: props => <VisualizerPartita {...props} />,
    renderSettingsPanel: props => <PartitaSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<PartitaTuning>) => (
        <QuickControlToggle
            active={tuning.showGuideLines}
            label={t('options.partitaGuideLines')}
            onToggle={() => onTuningChange({ showGuideLines: !tuning.showGuideLines })}
        >
            <Spline size={14} />
        </QuickControlToggle>
    ),
});
