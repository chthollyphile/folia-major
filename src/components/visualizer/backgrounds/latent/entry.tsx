import React from 'react';
import { Layers } from 'lucide-react';
import { DEFAULT_LATENT_BACKGROUND_TUNING, type LatentBackgroundDisplayMode } from '../../../../types';
import LatentBackground from './LatentBackground';
import LatentBackgroundSettingsCard from './LatentBackgroundSettingsCard';
import { defineVisualizerBackground } from '../definition';
import { QuickControlChip, QuickControlToggle } from '../../../shared/QuickControlChip';

// src/components/visualizer/backgrounds/latent/entry.tsx
// Registers the cover-colored, audio-reactive Latent shell background.

const LATENT_DISPLAY_MODES: LatentBackgroundDisplayMode[] = ['dithering', 'mesh', 'both'];

const LATENT_DISPLAY_LABEL_KEYS: Record<LatentBackgroundDisplayMode, string> = {
    dithering: 'options.latentDisplayDithering',
    mesh: 'options.latentDisplayMesh',
    both: 'options.latentDisplayBoth',
};

export default defineVisualizerBackground({
    mode: 'latent',
    order: 35,
    labelKey: 'options.visualizerBackgroundModeLatent',
    labelFallback: 'Latent',
    // 智能动感模式: the beats replace the band onset in the speed pulse (LatentBackground.tsx).
    drawsBeatFx: true,
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
    renderQuickControls: ({ config, actions, t, isDaylight, theme }) => {
        const tuning = config?.latent?.tuning ?? DEFAULT_LATENT_BACKGROUND_TUNING;
        const displayLabel = t(LATENT_DISPLAY_LABEL_KEYS[tuning.displayMode]);
        const cycleDisplayMode = () => {
            const currentIndex = LATENT_DISPLAY_MODES.indexOf(tuning.displayMode);
            actions?.latent?.onTuningChange?.({
                displayMode: LATENT_DISPLAY_MODES[(currentIndex + 1) % LATENT_DISPLAY_MODES.length],
            });
        };

        return (
            <>
                <QuickControlChip
                    isDaylight={isDaylight}
                    label={displayLabel}
                    title={`${t('options.latentDisplayMode')}: ${displayLabel}`}
                    onClick={cycleDisplayMode}
                />
                <QuickControlToggle
                    active={tuning.overlayEnabled}
                    theme={theme}
                    label={t('options.nomandBackgroundOverlay')}
                    onToggle={() => actions?.latent?.onTuningChange?.({ overlayEnabled: !tuning.overlayEnabled })}
                >
                    <Layers size={14} />
                </QuickControlToggle>
            </>
        );
    },
    resetSettings: actions => actions?.latent?.onResetTuning?.(),
});
