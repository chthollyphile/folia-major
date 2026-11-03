// Copyright (c) 2026 chthollyphile
import React from 'react';
import { EyeOff, Frame } from 'lucide-react';
import type { LumiereTuning } from '../../../types';
import { QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import LumiereSettingsPanel from './LumiereSettingsPanel';

const VisualizerLumiere = React.lazy(() => import('./VisualizerLumiere'));

// src/components/visualizer/lumiere/entry.tsx
// Registers 绘光, the stage-lighting lyric director: volumetric light, fog, line art and lyrics lit by the beams.
export default defineVisualizer({
    mode: 'lumiere',
    order: 25,
    labelKey: 'ui.visualizerLumiere',
    labelFallback: '绘光',
    previewSeed: 'lumiere',
    previewStartOffset: 0,
    // 绘光：自顶而下的光柱照亮一行字
    glyph: (
        <>
            <path d="M10 3.5 6 15M14 3.5 18 15" opacity="0.5" />
            <path d="M6 19h12" />
        </>
    ),
    command: {
        title: 'Visualizer: Lumiere',
        description: 'Switch to Lumiere visualizer',
        keywords: ['lumiere', '绘光', '光束', '舞台光', 'stage light', 'light pv'],
    },
    usesWordSegmentation: true,
    // Deliberately unkeyed on the seed, like tempera: the runtime hands a track change over in
    // place (songHandover.ts / pixiRuntimeHost.ts) instead of throwing the WebGL context away.
    render: props => <VisualizerLumiere {...props} />,
    renderSettingsPanel: props => <LumiereSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<LumiereTuning>) => (
        <>
            <QuickControlToggle
                active={tuning.overlayFrame}
                label={t('options.lumiereOverlayFrame')}
                onToggle={() => onTuningChange({ overlayFrame: !tuning.overlayFrame })}
            >
                <Frame size={14} />
            </QuickControlToggle>
            <QuickControlToggle
                active={tuning.hideTrails}
                label={t('options.lumiereHideTrails')}
                onToggle={() => onTuningChange({ hideTrails: !tuning.hideTrails })}
            >
                <EyeOff size={14} />
            </QuickControlToggle>
        </>
    ),
    ownFontSizeNoticeKey: 'options.lumiereFontSizeAutoNotice',
});
