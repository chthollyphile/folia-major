import React from 'react';
import { percent, SliderRow } from '../../panelRows';
import { twoDecimals, type NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandLensDistortionSettings.tsx
// Renders the Lens Distortion tuning rows.

const NomandLensDistortionSettings: React.FC<NomandBackgroundEffectPanelProps> = ({
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
                label={t('options.nomandBackgroundLensDistortionSpread')}
                value={tuning.lensDistortionSpread}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={lensDistortionSpread => onTuningChange?.({ lensDistortionSpread })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundLensDistortionBulge')}
                value={tuning.lensDistortionBulge}
                min={-1}
                max={1}
                step={0.05}
                format={twoDecimals}
                onChange={lensDistortionBulge => onTuningChange?.({ lensDistortionBulge })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundLensDistortionDispersion')}
                value={tuning.lensDistortionDispersion}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={lensDistortionDispersion => onTuningChange?.({ lensDistortionDispersion })}
            />
        </>
    );
};

export default NomandLensDistortionSettings;
