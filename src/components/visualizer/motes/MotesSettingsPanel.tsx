import React from 'react';
import { Group, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { percent, SliderRow, times } from '../panelRows';
import { DEFAULT_MOTES_TUNING, MOTES_TUNING_LIMITS, type MotesTuning } from './types';

// Motes' controls use the shared settings form and its slider draft/commit lifecycle.
const PARTICLES_GROUP: SettingsGroupDef = { id: 'vis-motes-particles', titleKey: 'options.motesSettings' };
const seconds = (value: number) => `${value.toFixed(2)}s`;

const MotesSettingsPanel: React.FC<VisualizerSettingsPanelProps<MotesTuning>> = ({
    t,
    tuning = DEFAULT_MOTES_TUNING,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => (
    <Group def={PARTICLES_GROUP}>
        <SliderRow
            label={t('options.motesDensity')}
            value={tuning.density}
            {...MOTES_TUNING_LIMITS.density}
            format={times}
            onChange={value => onTuningChange({ density: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        <SliderRow
            label={t('options.motesScatter')}
            value={tuning.scatter}
            {...MOTES_TUNING_LIMITS.scatter}
            format={times}
            onChange={value => onTuningChange({ scatter: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        <SliderRow
            label={t('options.motesTransition')}
            value={tuning.transition}
            {...MOTES_TUNING_LIMITS.transition}
            format={seconds}
            onChange={value => onTuningChange({ transition: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        <SliderRow
            label={t('options.motesDepth')}
            value={tuning.depth}
            {...MOTES_TUNING_LIMITS.depth}
            format={percent}
            onChange={value => onTuningChange({ depth: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        <SliderRow
            label={t('options.motesDrift')}
            value={tuning.drift}
            {...MOTES_TUNING_LIMITS.drift}
            format={percent}
            onChange={value => onTuningChange({ drift: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
        <SliderRow
            label={t('options.motesAudioResponse')}
            value={tuning.audioResponse}
            {...MOTES_TUNING_LIMITS.audioResponse}
            format={percent}
            onChange={value => onTuningChange({ audioResponse: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
    </Group>
);

export default MotesSettingsPanel;
