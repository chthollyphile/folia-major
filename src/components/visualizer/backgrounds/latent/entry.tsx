import React from 'react';
import { Layers } from 'lucide-react';
import {
    DEFAULT_LATENT_BACKGROUND_TUNING,
    type LatentBackgroundColorSource,
    type LatentBackgroundDisplayMode,
} from '../../../../types';
import LatentBackground from './LatentBackground';
import LatentBackgroundSettingsCard from './LatentBackgroundSettingsCard';
import { defineVisualizerBackground } from '../definition';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../../shared/QuickControlChip';
import { BEAT_EFFECT_IDS } from '../../../../services/beatFx/beatEffects';

// src/components/visualizer/backgrounds/latent/entry.tsx
// Registers the cover-colored, audio-reactive Latent shell background.

const LATENT_DISPLAY_MODES: LatentBackgroundDisplayMode[] = ['dithering', 'mesh', 'both'];

const LATENT_DISPLAY_LABEL_KEYS: Record<LatentBackgroundDisplayMode, string> = {
    dithering: 'options.latentDisplayDithering',
    mesh: 'options.latentDisplayMesh',
    both: 'options.latentDisplayBoth',
};

const LATENT_COLOR_SOURCES: LatentBackgroundColorSource[] = ['cover-theme', 'cover-only'];

const LATENT_COLOR_SOURCE_LABEL_KEYS: Record<LatentBackgroundColorSource, string> = {
    'cover-theme': 'options.latentColorSourceCoverTheme',
    'cover-only': 'options.latentColorSourceCoverOnly',
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
    // Retired, its code kept: the user set it aside on 2026-10-17.
    beatEffects: [{
        id: BEAT_EFFECT_IDS.latentPulse,
        nameKey: 'options.beatEffect_latentPulse',
        descKey: 'options.beatEffect_latentPulseDesc',
        source: 'beats',
        retired: true,
    }],
    // No `song`: a new song's cover colours blend in place (blendMs).
    render: ({ config, theme, coverUrl, audioPower, audioBands, staticMode, paused, blendMs, blendProgress }) => (
        <LatentBackground
            theme={theme}
            coverUrl={coverUrl}
            audioPower={audioPower}
            audioBands={audioBands}
            staticMode={staticMode}
            paused={paused}
            tuning={config?.latent?.tuning}
            blendMs={blendMs}
            blendProgress={blendProgress}
        />
    ),
    renderSettingsPanel: ({ config, actions, ...props }) => (
        <LatentBackgroundSettingsCard
            {...props}
            tuning={config?.latent?.tuning ?? DEFAULT_LATENT_BACKGROUND_TUNING}
            onTuningChange={actions?.latent?.onTuningChange}
        />
    ),
    renderQuickControls: ({ config, actions, t }) => {
        const tuning = config?.latent?.tuning ?? DEFAULT_LATENT_BACKGROUND_TUNING;
        const displayLabel = t(LATENT_DISPLAY_LABEL_KEYS[tuning.displayMode]);
        const colorLabel = t(LATENT_COLOR_SOURCE_LABEL_KEYS[tuning.colorSource]);

        return (
            <>
                <QuickControlChip
                    label={displayLabel}
                    title={`${t('options.latentDisplayMode')}: ${displayLabel}`}
                    onClick={() => actions?.latent?.onTuningChange?.({ displayMode: cycleValue(LATENT_DISPLAY_MODES, tuning.displayMode) })}
                />
                <QuickControlChip
                    label={colorLabel}
                    title={`${t('options.latentColorSource')}: ${colorLabel}`}
                    onClick={() => actions?.latent?.onTuningChange?.({ colorSource: cycleValue(LATENT_COLOR_SOURCES, tuning.colorSource) })}
                />
                <QuickControlToggle
                    active={tuning.overlayEnabled}
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
