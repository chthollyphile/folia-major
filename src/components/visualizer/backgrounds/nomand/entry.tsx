import React from 'react';
import { DEFAULT_NOMAND_BACKGROUND_TUNING } from '../../../../types';
import NomandBackgroundLayer from './NomandBackgroundLayer';
import NomandBackgroundSettingsCard from './NomandBackgroundSettingsCard';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/nomand/entry.tsx
// Registers the Paper image-dithering shell background.

export default defineVisualizerBackground({
    mode: 'nomand',
    order: 30,
    labelKey: 'options.visualizerBackgroundModeNomand',
    labelFallback: 'Nomand',
    render: ({ config, coverUrl, theme }) => (
        <NomandBackgroundLayer
            coverUrl={coverUrl}
            monetBackgroundImage={config?.customImage}
            tuning={config?.nomand?.tuning}
            theme={theme}
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
    resetSettings: actions => actions?.nomand?.onResetTuning?.(),
});
