import React from 'react';
import { Layers } from 'lucide-react';
import { DEFAULT_NOMAND_BACKGROUND_TUNING, type NomandBackgroundSource, type NomandBackgroundTuning } from '../../../../types';
import NomandBackgroundLayer, { resolveNomandSourceUrl } from './NomandBackgroundLayer';
import NomandBackgroundSettingsCard from './NomandBackgroundSettingsCard';
import { EFFECT_LABEL_KEYS, EFFECTS } from './NomandBackgroundEffectSettings';
import { defineVisualizerBackground } from '../definition';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../../shared/QuickControlChip';

// src/components/visualizer/backgrounds/nomand/entry.tsx
// Registers the Paper image-effect shell background.

const SOURCE_LABEL_KEYS: Record<NomandBackgroundSource, string> = {
    'cover-derived': 'options.monetBackgroundSourceCover',
    'uploaded-global': 'options.monetBackgroundSourceUploaded',
};

export default defineVisualizerBackground({
    mode: 'nomand',
    order: 30,
    labelKey: 'options.visualizerBackgroundModeNomand',
    labelFallback: 'Nomand',
    // 漫游：像素块
    glyph: (
        <>
            <rect x="4" y="4" width="6.5" height="6.5" rx="0.8" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="0.8" opacity="0.45" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="0.8" opacity="0.45" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="0.8" />
        </>
    ),
    command: {
        title: 'Background: Nomand',
        description: 'Switch background to theme-colored image dithering',
        keywords: ['nomand', 'dithering', 'dither', 'shader background', '漫游', '像素画', '像素画背景', '抖动背景', '网点背景', '主题色背景'],
    },
    // The shader draws one image and cannot blend to another, so a new song's image comes as a new copy;
    // the copy on screen was already rebuilt for every new image (its elements are keyed by it).
    song: ({ config, coverUrl }) => [
        resolveNomandSourceUrl(coverUrl, config?.customImage, { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...config?.nomand?.tuning }) ?? null,
    ],
    render: ({ config, coverUrl, theme, isDaylight }) => (
        <NomandBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            tuning={config?.nomand?.tuning}
            theme={theme}
            isDaylight={isDaylight}
        />
    ),
    renderSettingsPanel: ({ config, actions, ...props }) => (
        <NomandBackgroundSettingsCard
            {...props}
            tuning={config?.nomand?.tuning ?? DEFAULT_NOMAND_BACKGROUND_TUNING}
            onTuningChange={actions?.nomand?.onTuningChange}
            monetBackgroundImage={config?.customImage}
            onUploadMonetBackgroundImage={actions?.customImage?.onUpload}
            onClearMonetBackgroundImage={actions?.customImage?.onClear}
            isLoadingMonetBackgroundImage={actions?.customImage?.isLoading}
        />
    ),
    renderQuickControls: ({ config, actions, t }) => {
        const tuning = config?.nomand?.tuning ?? DEFAULT_NOMAND_BACKGROUND_TUNING;
        const change = (patch: Partial<NomandBackgroundTuning>) => actions?.nomand?.onTuningChange?.(patch);
        const source = tuning.imageSource;
        const sourceLabel = t(SOURCE_LABEL_KEYS[source]);
        // The other source is the uploaded picture (the one 莫奈 uses too): without one the chip only says 封面.
        const hasImage = Boolean(config?.customImage);
        const effectLabel = t(EFFECT_LABEL_KEYS[tuning.effect]);

        return (
            <>
                <QuickControlChip
                    label={sourceLabel}
                    title={`${t('options.nomandBackgroundSource')}: ${sourceLabel}`}
                    disabled={!hasImage && source === 'cover-derived'}
                    onClick={() => change({ imageSource: hasImage && source === 'cover-derived' ? 'uploaded-global' : 'cover-derived' })}
                />
                <QuickControlChip
                    label={effectLabel}
                    title={`${t('options.nomandBackgroundEffect')}: ${effectLabel}`}
                    onClick={() => change({ effect: cycleValue(EFFECTS, tuning.effect) })}
                />
                <QuickControlToggle
                    active={tuning.overlayEnabled}
                    label={t('options.nomandBackgroundOverlay')}
                    onToggle={() => change({ overlayEnabled: !tuning.overlayEnabled })}
                >
                    <Layers size={14} />
                </QuickControlToggle>
            </>
        );
    },
    resetSettings: actions => actions?.nomand?.onResetTuning?.(),
});
