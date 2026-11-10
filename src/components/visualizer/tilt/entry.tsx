import React from 'react';
import type { TiltColorScheme, TiltTuning } from '../../../types';
import { cycleValue, QuickControlChip } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { TiltSettingsPanel } from '../settingsPanels';

const VisualizerTilt = React.lazy(() => import('./VisualizerTilt'));

// src/components/visualizer/tilt/entry.tsx
// Registers Tilt and its preview tuning panel.
const COLOR_SCHEMES: TiltColorScheme[] = ['default', 'swap', 'accentAll', 'primaryAll'];
const COLOR_SCHEME_LABEL_KEYS: Record<TiltColorScheme, string> = {
    default: 'options.tiltColorSchemeDefault',
    swap: 'options.tiltColorSchemeSwap',
    accentAll: 'options.tiltColorSchemeAccentAll',
    primaryAll: 'options.tiltColorSchemePrimaryAll',
};

export default defineVisualizer({
    mode: 'tilt',
    order: 70,
    labelKey: 'ui.visualizerTilt',
    labelFallback: 'Tilt',
    previewSeed: 'tilt',
    previewStartOffset: 0,
    // 倾诉：主行水平，副行倾斜
    glyph: (
        <>
            <path d="M4 9h16" />
            <path d="M5 16.5l14-3" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Visualizer: Tilt',
        description: 'Switch to tilt visualizer',
        keywords: ['tilt', '倾诉'],
    },
    render: props => <VisualizerTilt {...props} />,
    renderSettingsPanel: props => <TiltSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<TiltTuning>) => {
        const scheme = tuning.colorScheme ?? 'default';
        const schemeLabel = t(COLOR_SCHEME_LABEL_KEYS[scheme]);
        return (
            <QuickControlChip
                label={schemeLabel}
                title={`${t('options.tiltColorScheme')}: ${schemeLabel}`}
                onClick={() => onTuningChange({ colorScheme: cycleValue(COLOR_SCHEMES, scheme) })}
            />
        );
    },
});
