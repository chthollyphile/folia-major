import React from 'react';
import { DEFAULT_MONET_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import VisualizerMonet from './VisualizerMonet';
import { MonetSettingsPanel } from './MonetSettingsPanel';

// src/components/visualizer/monet/entry.tsx
// Registers the Monet poster visualizer and its mode-owned settings panel.
export default defineVisualizer({
    mode: 'monet',
    order: 45,
    labelKey: 'ui.visualizerMonet',
    labelFallback: 'Monet',
    previewSeed: 'monet',
    previewStartOffset: 0,
    tuningKind: 'monet',
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
    resetSettings: ({ resetMonetTuning }) => {
        resetMonetTuning?.();
    },
});
