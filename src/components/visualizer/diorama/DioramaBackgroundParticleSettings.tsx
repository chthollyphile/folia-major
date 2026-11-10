import React from 'react';
import {
    DIORAMA_MOTE_CIRCUMFERENCE_MAX,
    DIORAMA_MOTE_CIRCUMFERENCE_MIN,
    DIORAMA_MOTE_CIRCUMFERENCE_STEP,
    DIORAMA_MOTE_RADIAL_MAX,
    DIORAMA_MOTE_RADIAL_MIN,
    DIORAMA_MOTE_RADIAL_STEP,
} from '../../../types';
import { SliderRow } from '../panelRows';
import { DioramaFoldRow } from './DioramaFoldRow';

// src/components/visualizer/diorama/DioramaBackgroundParticleSettings.tsx
// Collapsible rows for the background dust layer: its switch, and folded under it its density. The dust
// sits in a shell around the flight axis, so its density has two INDEPENDENT axes: 圆周 (motes around each
// ring) and 径向 (layers across the shell's thickness, inner->outer). Motes-per-line = the product.
interface DioramaBackgroundParticleSettingsProps {
    label: string;
    enabled: boolean;
    circumference: number;
    radial: number;
    onEnabledChange: (next: boolean) => void;
    onCircumferenceChange: (next: number) => void;
    onRadialChange: (next: number) => void;
    t: (key: string) => string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const whole = (value: number) => String(Math.round(value));

export const DioramaBackgroundParticleSettings: React.FC<DioramaBackgroundParticleSettingsProps> = ({
    label,
    enabled,
    circumference,
    radial,
    onEnabledChange,
    onCircumferenceChange,
    onRadialChange,
    t,
    onSliderPointerDown,
    onSliderCommit,
}) => (
    <DioramaFoldRow label={label} checked={enabled} onChange={onEnabledChange}>
        <SliderRow
            sub
            disabled={!enabled}
            label={t('options.dioramaMoteCircumference')}
            value={circumference}
            min={DIORAMA_MOTE_CIRCUMFERENCE_MIN}
            max={DIORAMA_MOTE_CIRCUMFERENCE_MAX}
            step={DIORAMA_MOTE_CIRCUMFERENCE_STEP}
            format={whole}
            onChange={onCircumferenceChange}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        <SliderRow
            sub
            disabled={!enabled}
            label={t('options.dioramaMoteRadial')}
            value={radial}
            min={DIORAMA_MOTE_RADIAL_MIN}
            max={DIORAMA_MOTE_RADIAL_MAX}
            step={DIORAMA_MOTE_RADIAL_STEP}
            format={whole}
            onChange={onRadialChange}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
    </DioramaFoldRow>
);
