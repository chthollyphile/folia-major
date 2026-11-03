import React from 'react';
import { percent, SliderRow } from '../../panelRows';
import { twoDecimals, type NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandFlutedGlassSettings.tsx
// Renders the Fluted Glass tuning rows.

const NomandFlutedGlassSettings: React.FC<NomandBackgroundEffectPanelProps> = ({
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
                label={t('options.nomandBackgroundFlutedGlassSize')}
                value={tuning.flutedGlassSize}
                min={0.1}
                max={1}
                step={0.05}
                format={twoDecimals}
                onChange={flutedGlassSize => onTuningChange?.({ flutedGlassSize })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundFlutedGlassDistortion')}
                value={tuning.flutedGlassDistortion}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={flutedGlassDistortion => onTuningChange?.({ flutedGlassDistortion })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundFlutedGlassBlur')}
                value={tuning.flutedGlassBlur}
                min={0}
                max={1}
                step={0.01}
                format={percent}
                onChange={flutedGlassBlur => onTuningChange?.({ flutedGlassBlur })}
            />
        </>
    );
};

export default NomandFlutedGlassSettings;
