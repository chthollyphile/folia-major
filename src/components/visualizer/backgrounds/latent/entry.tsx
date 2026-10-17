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
    // 隐现：上层像素点阵，下层流体
    glyph: (
        <>
            <path d="M4.5 7.5h.01M9 7.5h.01M13.5 7.5h.01M18 7.5h.01" strokeWidth="2.2" opacity="0.55" />
            <path d="M3 15c3-3.5 6-3.5 9 0s6 3.5 9 0" />
        </>
    ),
    command: {
        title: 'Background: Latent',
        description: 'Switch background to cover-colored audio-reactive shaders',
        keywords: ['latent', 'latent background', 'shader background', '隐现', '隐现背景', '音频响应背景'],
    },
    // 智能动感模式: the beats replace the band onset in the speed pulse (LatentBackground.tsx).
    drawsBeatFx: true,
    // No `song`: a new song's cover colours blend in place (blendMs).
    render: ({ config, theme, coverUrl, audioPower, audioBands, staticMode, paused, blendMs }) => (
        <LatentBackground
            theme={theme}
            coverUrl={coverUrl}
            audioPower={audioPower}
            audioBands={audioBands}
            staticMode={staticMode}
            paused={paused}
            tuning={config?.latent?.tuning}
            blendMs={blendMs}
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
