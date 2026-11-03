import React from 'react';
import { percent, SliderRow } from '../../panelRows';
import type { NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandPaperTextureSettings.tsx
// Renders the Paper Texture tuning rows.

const NomandPaperTextureSettings: React.FC<NomandBackgroundEffectPanelProps> = ({
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
                label={t('options.nomandBackgroundPaperTextureContrast')}
                value={tuning.paperTextureContrast}
                min={0}
                max={1}
                step={0.01}
                format={percent}
                onChange={paperTextureContrast => onTuningChange?.({ paperTextureContrast })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundPaperTextureRoughness')}
                value={tuning.paperTextureRoughness}
                min={0}
                max={1}
                step={0.01}
                format={percent}
                onChange={paperTextureRoughness => onTuningChange?.({ paperTextureRoughness })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundPaperTextureFiber')}
                value={tuning.paperTextureFiber}
                min={0}
                max={1}
                step={0.05}
                format={percent}
                onChange={paperTextureFiber => onTuningChange?.({ paperTextureFiber })}
            />
        </>
    );
};

export default NomandPaperTextureSettings;
