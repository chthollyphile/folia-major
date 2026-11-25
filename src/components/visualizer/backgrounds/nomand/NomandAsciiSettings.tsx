import React from 'react';
import { SliderRow, times, ToggleRow } from '../../panelRows';
import type { NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandAsciiSettings.tsx
// Renders the ASCII effect's tuning rows: glyph size, sway, and the colour choice it shares with
// the dithering effect (the picture's own colours, or the theme palette that can be turned over).

const pixels = (value: number) => `${value} px`;

const NomandAsciiSettings: React.FC<NomandBackgroundEffectPanelProps> = ({
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
                label={t('options.nomandBackgroundAsciiScale')}
                value={tuning.asciiScale}
                min={1}
                max={4}
                step={0.5}
                format={pixels}
                onChange={asciiScale => onTuningChange?.({ asciiScale })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundAsciiMotion')}
                value={tuning.asciiMotion}
                min={0}
                max={1.5}
                step={0.05}
                format={times}
                onChange={asciiMotion => onTuningChange?.({ asciiMotion })}
            />
            <ToggleRow
                label={t('options.nomandBackgroundOriginalColors')}
                checked={tuning.asciiOriginalColors}
                onChange={asciiOriginalColors => onTuningChange?.({ asciiOriginalColors })}
            />
            {!tuning.asciiOriginalColors && (
                <ToggleRow
                    label={t('options.nomandBackgroundInverted')}
                    checked={tuning.asciiInverted}
                    onChange={asciiInverted => onTuningChange?.({ asciiInverted })}
                />
            )}
        </>
    );
};

export default NomandAsciiSettings;
