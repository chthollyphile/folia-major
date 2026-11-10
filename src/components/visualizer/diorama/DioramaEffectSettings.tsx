import React from 'react';
import { Row, Toggle } from '../../modal/settings/kit';
import { percent, SliderRow } from '../panelRows';
import { DioramaFoldRow } from './DioramaFoldRow';

// src/components/visualizer/diorama/DioramaEffectSettings.tsx
// Collapsible rows for one independent Diorama follow-sing effect: its switch, and folded under it
// its strength, a slider that marks 弱 / 中 / 强. An effect may carry ONE nested sub-switch (a plain
// toggle, no strength of its own) shown under the strength - used by 灵魂出窍 for the 当前字漂移 child,
// which gates the SAME underlying effect on the word currently being sung, so it belongs under its
// parent rather than as a standalone effect in the list.
const STRENGTH_MARKS = [
    { value: 0.5, labelKey: 'options.dioramaStrengthLow' },
    { value: 1, labelKey: 'options.dioramaStrengthMid' },
    { value: 1.5, labelKey: 'options.dioramaStrengthHigh' },
] as const;

/** A nested sub-switch (toggle only, no strength of its own) shown under a parent effect's strength
 *  - e.g. 灵魂出窍's 当前字漂移, which just gates whether the current glyph joins the effect. */
export interface DioramaSubEffect {
    label: string;
    enabled: boolean;
    onEnabledChange: (next: boolean) => void;
}

interface DioramaEffectSettingsProps {
    label: string;
    enabled: boolean;
    intensity: number;
    onEnabledChange: (next: boolean) => void;
    onIntensityChange: (next: number) => void;
    /** Optional child sub-switch gating the SAME effect (e.g. 灵魂出窍's 当前字漂移). */
    subEffect?: DioramaSubEffect;
    t: (key: string) => string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

export const DioramaEffectSettings: React.FC<DioramaEffectSettingsProps> = ({
    label,
    enabled,
    intensity,
    onEnabledChange,
    onIntensityChange,
    subEffect,
    t,
    onSliderPointerDown,
    onSliderCommit,
}) => (
    <DioramaFoldRow label={label} checked={enabled} onChange={onEnabledChange}>
        <SliderRow
            sub
            disabled={!enabled}
            label={t('options.dioramaEffectStrength')}
            value={intensity}
            min={0.1}
            max={1.5}
            step={0.05}
            format={percent}
            marks={STRENGTH_MARKS.map(mark => ({ value: mark.value, label: t(mark.labelKey) }))}
            onChange={onIntensityChange}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        {subEffect && (
            <Row sub label={subEffect.label}>
                <Toggle checked={subEffect.enabled} onChange={subEffect.onEnabledChange} />
            </Row>
        )}
    </DioramaFoldRow>
);
