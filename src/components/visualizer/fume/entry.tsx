import React from 'react';
import { EyeOff } from 'lucide-react';
import type { FumeTuning } from '../../../types';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { FumeSettingsPanel } from '../settingsPanels';
import { fumeBackgroundConfig } from './backgroundConfig';

const VisualizerFume = React.lazy(() => import('./VisualizerFume'));

// src/components/visualizer/fume/entry.tsx
// Registers Fume and its preview tuning panel.
const CAMERA_TRACKING_MODES: FumeTuning['cameraTrackingMode'][] = ['stepped', 'smooth'];
const CAMERA_TRACKING_LABEL_KEYS: Record<FumeTuning['cameraTrackingMode'], string> = {
    stepped: 'options.fumeCameraTrackingStepped',
    smooth: 'options.fumeCameraTrackingSmooth',
};

export default defineVisualizer({
    mode: 'fume',
    order: 60,
    labelKey: 'ui.visualizerFume',
    labelFallback: 'Fume',
    previewSeed: 'fume',
    previewStartOffset: 18.4,
    // 浮名：主歌词超出画面边界，背后叠着淡化的上下文
    glyph: (
        <>
            <path d="M6 7.5h9" opacity="0.3" />
            <path d="M1 12h22" />
            <path d="M9 16.5h9" opacity="0.3" />
        </>
    ),
    command: {
        title: 'Visualizer: Fume',
        description: 'Switch to fume visualizer',
        keywords: ['fume', '浮名'],
    },
    background: fumeBackgroundConfig,
    render: props => <VisualizerFume {...props} />,
    renderSettingsPanel: props => <FumeSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<FumeTuning>) => {
        const trackingLabel = t(CAMERA_TRACKING_LABEL_KEYS[tuning.cameraTrackingMode]);
        return (
            <>
                <QuickControlToggle
                    active={tuning.hidePrintSymbols}
                    label={t('options.fumeHidePrintSymbols')}
                    onToggle={() => onTuningChange({ hidePrintSymbols: !tuning.hidePrintSymbols })}
                >
                    <EyeOff size={14} />
                </QuickControlToggle>
                <QuickControlChip
                    label={trackingLabel}
                    title={`${t('options.fumeCameraTrackingMode')}: ${trackingLabel}`}
                    onClick={() => onTuningChange({ cameraTrackingMode: cycleValue(CAMERA_TRACKING_MODES, tuning.cameraTrackingMode) })}
                />
            </>
        );
    },
});
