import React from 'react';
import type { NomandBackgroundDitheringType } from '../../../../types';
import { Row, Segmented } from '../../../modal/settings/kit';
import { SliderRow, ToggleRow } from '../../panelRows';
import type { NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandDitheringSettings.tsx
// Renders the legacy Nomand dithering rows.

const DITHERING_TYPES: NomandBackgroundDitheringType[] = ['2x2', '4x4', '8x8'];

const NomandDitheringSettings: React.FC<NomandBackgroundEffectPanelProps> = ({
    t,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            <Row label={t('options.nomandBackgroundDitheringType')}>
                <Segmented
                    value={tuning.ditheringType}
                    options={DITHERING_TYPES.map(type => ({ value: type, label: type }))}
                    onChange={ditheringType => onTuningChange?.({ ditheringType })}
                />
            </Row>
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundSize')}
                value={tuning.size}
                min={0.5}
                max={20}
                step={0.5}
                format={value => value.toFixed(1)}
                onChange={size => onTuningChange?.({ size })}
            />
            <SliderRow
                {...drag}
                label={t('options.nomandBackgroundColorSteps')}
                value={tuning.colorSteps}
                min={1}
                max={7}
                step={1}
                format={value => String(Math.round(value))}
                onChange={colorSteps => onTuningChange?.({ colorSteps })}
            />
            <ToggleRow
                label={t('options.nomandBackgroundOriginalColors')}
                checked={tuning.originalColors}
                onChange={originalColors => onTuningChange?.({ originalColors })}
            />
            <ToggleRow
                label={t('options.nomandBackgroundInverted')}
                checked={tuning.inverted}
                onChange={inverted => onTuningChange?.({ inverted })}
            />
        </>
    );
};

export default NomandDitheringSettings;
