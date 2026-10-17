import React from 'react';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useSmartBeatAvailability } from '../../hooks/useSmartBeatAvailability';
import { Group, Row, type SettingsGroupDef } from '../modal/settings/kit';
import { ToggleRow } from './panelRows';

// src/components/visualizer/SmartBeatSettingsCard.tsx
// 智能动感模式's one switch, at the top of the lyric style tab: it is a setting of the whole picture,
// over every mode's beat effects, so it sits with no one mode's panel. Each effect's own switch and
// strength sit in the mode's settings below it (BeatEffectsGroup.tsx), with what its model needs.
// Reads and writes the settings store itself; nothing about it is a per-mode draft.

const SMART_BEAT_GROUP: SettingsGroupDef = { id: 'vis-smart-beat', titleKey: 'options.smartBeat' };

type SmartBeatSettingsCardProps = {
    t: (key: string) => string;
};

const SmartBeatSettingsCard: React.FC<SmartBeatSettingsCardProps> = ({ t }) => {
    const smartBeat = useVisualizerSettingsStore(state => state.smartBeat);
    const setSmartBeat = useVisualizerSettingsStore(state => state.handleSetSmartBeat);
    const availability = useSmartBeatAvailability(smartBeat.enabled);
    const unavailableReason = availability === 'ready' ? null : t(`options.beatFxUnavailable_${availability}`);

    return (
        <Group def={SMART_BEAT_GROUP}>
            <ToggleRow
                label={t('options.smartBeatEnabled')}
                note={t('options.smartBeatDesc')}
                checked={smartBeat.enabled}
                onChange={enabled => setSmartBeat({ enabled })}
            />
            {unavailableReason && <Row notice={unavailableReason} />}
        </Group>
    );
};

export default SmartBeatSettingsCard;
