import React from 'react';
import { DEFAULT_LATENT_BACKGROUND_TUNING } from '../../../../types';
import LatentBackground from './LatentBackground';
import LatentBackgroundSettingsCard from './LatentBackgroundSettingsCard';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/latent/entry.tsx
// Registers the cover-colored, audio-reactive Latent shell background.

export default defineVisualizerBackground({
    mode: 'latent',
    order: 35,
    labelKey: 'options.visualizerBackgroundModeLatent',
    labelFallback: 'Latent',
    render: ({ config, theme, coverUrl, audioPower, audioBands, staticMode, paused }) => (
        <LatentBackground
            theme={theme}
            coverUrl={coverUrl}
            audioPower={audioPower}
            audioBands={audioBands}
            staticMode={staticMode}
            paused={paused}
            tuning={config?.latent?.tuning}
        />
    ),
    renderSettingsPanel: ({ config, actions, ...props }) => (
        <LatentBackgroundSettingsCard
            {...props}
            tuning={config?.latent?.tuning ?? DEFAULT_LATENT_BACKGROUND_TUNING}
            onTuningChange={actions?.latent?.onTuningChange}
        />
    ),
    resetSettings: actions => actions?.latent?.onResetTuning?.(),
});
