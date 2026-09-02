import React from 'react';
import { DEFAULT_MONET_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
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
