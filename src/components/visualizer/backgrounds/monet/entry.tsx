import React from 'react';
import { Columns3, Wind } from 'lucide-react';
import { DEFAULT_MONET_BACKGROUND_TUNING, type MonetBackgroundSource, type MonetBackgroundTuning } from '../../../../types';
import { MonetBackgroundSettingsCard } from './MonetBackgroundSettingsCard';
import MonetBackgroundLayer, { resolveMonetSourceUrl } from './MonetBackgroundLayer';
import { defineVisualizerBackground } from '../definition';
import { QuickControlChip, QuickControlToggle } from '../../../shared/QuickControlChip';

// src/components/visualizer/backgrounds/monet/entry.tsx
// Registers the Monet image-treatment shell background.

const SOURCE_LABEL_KEYS: Record<MonetBackgroundSource, string> = {
    'cover-derived': 'options.monetBackgroundSourceCover',
    'uploaded-global': 'options.monetBackgroundSourceUploaded',
};

export default defineVisualizerBackground({
    mode: 'monet',
    order: 20,
    labelKey: 'options.visualizerBackgroundModeMonet',
    labelFallback: 'Monet',
    // 莫奈：整幅画面被一条斜线分成两种处理
    glyph: (
        <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <path d="M20.5 8.5L8 19.5" opacity="0.55" />
        </>
    ),
    // The picture is made from the cover, or from the uploaded image where that comes first. The theme
    // colours change in place, with the picture's own crossfade.
    song: ({ config, coverUrl }) => [
        resolveMonetSourceUrl(coverUrl, config?.customImage, config?.monet?.tuning ?? DEFAULT_MONET_BACKGROUND_TUNING),
    ],
    render: ({ config, coverUrl, theme, isDaylight, staticMode }) => (
        <MonetBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            theme={theme}
            isDaylight={isDaylight}
            tuning={config?.monet?.tuning}
            transparentBackground={config?.transparent}
            staticMode={staticMode}
        />
    ),
    renderSettingsPanel: ({
        config,
        actions,
        t,
        onSliderPointerDown,
        onSliderCommit,
    }) => (
        <MonetBackgroundSettingsCard
            t={t}
            tuning={config?.monet?.tuning ?? DEFAULT_MONET_BACKGROUND_TUNING}
            onTuningChange={actions?.monet?.onTuningChange}
            monetBackgroundImage={config?.customImage}
            onUploadMonetBackgroundImage={actions?.customImage?.onUpload}
            onClearMonetBackgroundImage={actions?.customImage?.onClear}
            isLoadingMonetBackgroundImage={actions?.customImage?.isLoading}
            onSliderPointerDown={onSliderPointerDown}
            onSliderCommit={onSliderCommit}
        />
    ),
    renderQuickControls: ({ config, actions, t }) => {
        const tuning = config?.monet?.tuning ?? DEFAULT_MONET_BACKGROUND_TUNING;
        const isFullOverlay = tuning.backgroundLayout === 'full-overlay';
        const layoutLabel = t(isFullOverlay ? 'options.monetLayoutFullOverlay' : 'options.monetLayoutHalfPane');
        const change = (patch: Partial<MonetBackgroundTuning>) => actions?.monet?.onTuningChange?.(patch);
        const source = tuning.backgroundSource;
        const sourceLabel = t(SOURCE_LABEL_KEYS[source]);
        // The other source is the uploaded picture: without one the chip only says 封面 (the settings window uploads).
        const hasImage = Boolean(config?.customImage);

        return (
            <>
                <QuickControlChip
                    label={layoutLabel}
                    title={`${t('options.monetBackgroundLayout')}: ${layoutLabel}`}
                    onClick={() => change({
                        backgroundLayout: isFullOverlay ? 'half-pane-gradient' : 'full-overlay',
                    })}
                />
                <QuickControlChip
                    label={sourceLabel}
                    title={`${t('options.monetBackgroundSource')}: ${sourceLabel}`}
                    disabled={!hasImage && source === 'cover-derived'}
                    onClick={() => change({ backgroundSource: hasImage && source === 'cover-derived' ? 'uploaded-global' : 'cover-derived' })}
                />
                <QuickControlToggle
                    active={tuning.backgroundStreaksEnabled}
                    label={t('options.monetBackgroundStreaksEnabled')}
                    onToggle={() => change({ backgroundStreaksEnabled: !tuning.backgroundStreaksEnabled })}
                >
                    <Columns3 size={14} />
                </QuickControlToggle>
                <QuickControlToggle
                    active={tuning.backgroundDriftEnabled}
                    label={t('options.monetBackgroundDriftEnabled')}
                    onToggle={() => change({ backgroundDriftEnabled: !tuning.backgroundDriftEnabled })}
                >
                    <Wind size={14} />
                </QuickControlToggle>
            </>
        );
    },
    resetSettings: actions => actions?.monet?.onResetTuning?.(),
});
