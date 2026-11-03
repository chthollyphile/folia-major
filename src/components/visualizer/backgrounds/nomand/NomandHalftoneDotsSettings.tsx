import React from 'react';
import { percent, SliderRow, ToggleRow } from '../../panelRows';
import { twoDecimals, type NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandHalftoneDotsSettings.tsx
// Renders the Halftone Dots tuning rows.

const NomandHalftoneDotsSettings: React.FC<NomandBackgroundEffectPanelProps> = ({
    t,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundHalftoneDotsSize')}
                value={tuning.halftoneDotsSize}
                min={0.1}
                max={1}
                step={0.05}
                format={twoDecimals}
                onChange={halftoneDotsSize => onTuningChange?.({ halftoneDotsSize })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundHalftoneDotsRadius')}
                value={tuning.halftoneDotsRadius}
                min={0.1}
                max={2}
                step={0.05}
                format={twoDecimals}
                onChange={halftoneDotsRadius => onTuningChange?.({ halftoneDotsRadius })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundHalftoneDotsContrast')}
                value={tuning.halftoneDotsContrast}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={halftoneDotsContrast => onTuningChange?.({ halftoneDotsContrast })}
            />
            <ToggleRow
                label={t('options.nomandBackgroundOriginalColors')}
                checked={tuning.halftoneDotsOriginalColors}
                onChange={halftoneDotsOriginalColors => onTuningChange?.({ halftoneDotsOriginalColors })}
            />
            <ToggleRow
                label={t('options.nomandBackgroundInverted')}
                checked={tuning.halftoneDotsInverted}
                onChange={halftoneDotsInverted => onTuningChange?.({ halftoneDotsInverted })}
            />
        </>
    );
};

export default NomandHalftoneDotsSettings;
