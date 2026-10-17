import React from 'react';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useSmartBeatAvailability } from '../../hooks/useSmartBeatAvailability';
import { Group, Row, type SettingsGroupDef } from '../modal/settings/kit';
import { SliderRow, ToggleRow, times } from './panelRows';

// src/components/visualizer/SmartBeatSettingsCard.tsx
// 智能动感模式's one switch and two strengths, at the top of the lyric style tab: it is a setting of
// the whole picture, driving every mode and background that draws beat FX, so it sits with no one
// mode's panel. Reads and writes the settings store itself; nothing about it is a per-mode draft.

const SMART_BEAT_GROUP: SettingsGroupDef = { id: 'vis-smart-beat', titleKey: 'options.smartBeat' };

type SmartBeatSettingsCardProps = {
    t: (key: string) => string;
    /** Mark slider drag start so onChange only updates draft. */
    onSliderPointerDown?: () => void;
    /** Commit draft values to persistent store on slider release. */
    onSliderCommit?: () => void;
};

const SmartBeatSettingsCard: React.FC<SmartBeatSettingsCardProps> = ({ t, onSliderPointerDown, onSliderCommit }) => {
    const smartBeat = useVisualizerSettingsStore(state => state.smartBeat);
    const setSmartBeat = useVisualizerSettingsStore(state => state.handleSetSmartBeat);
    const availability = useSmartBeatAvailability(smartBeat.enabled);
    const unavailableReason = availability === 'ready' ? null : t(`options.beatFxUnavailable_${availability}`);
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <Group def={SMART_BEAT_GROUP}>
            <ToggleRow
                label={t('options.smartBeatEnabled')}
                note={t('options.smartBeatDesc')}
                checked={smartBeat.enabled}
                onChange={enabled => setSmartBeat({ enabled })}
            />
            {unavailableReason && <Row notice={unavailableReason} />}
            {smartBeat.enabled && (
                <>
                    <SliderRow
                        label={t('options.smartBeatBeatIntensity')}
                        value={smartBeat.beatIntensity}
                        min={0}
                        max={2}
                        step={0.05}
                        format={times}
                        onChange={beatIntensity => setSmartBeat({ beatIntensity })}
                        sub
                        {...drag}
                    />
                    <SliderRow
                        label={t('options.smartBeatDownbeatIntensity')}
                        value={smartBeat.downbeatIntensity}
                        min={0}
                        max={2}
                        step={0.05}
                        format={times}
                        onChange={downbeatIntensity => setSmartBeat({ downbeatIntensity })}
                        sub
                        {...drag}
                    />
                </>
            )}
        </Group>
    );
};

export default SmartBeatSettingsCard;
