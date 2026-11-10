import React from 'react';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useSmartBeatAvailability } from '../../hooks/useSmartBeatAvailability';
import { Group, Row, Segmented, type SettingsGroupDef } from '../modal/settings/kit';
import type { SmartBeatMode } from '../../types';

// src/components/visualizer/SmartBeatSettingsCard.tsx
// 智能动感模式's one setting, alone on the lyric style window's 全局 tab: it is a setting of the whole picture,
// over every mode's beat effects, so it sits with no one mode's panel. Each effect's own switch and
// strength sit in the mode's settings on the 歌词动画 tab (BeatEffectsGroup.tsx), with what its model needs.
// Reads and writes the settings store itself; nothing about it is a per-mode draft.
// Three ways (SmartBeatMode): 关闭 / 只用已分析 / 开启, in that order - how much each does - and the
// note below says what the chosen one does, so "half on" never has to be guessed at.

const SMART_BEAT_GROUP: SettingsGroupDef = { id: 'vis-smart-beat', titleKey: 'options.smartBeat' };

type SmartBeatSettingsCardProps = {
    t: (key: string) => string;
};

const SmartBeatSettingsCard: React.FC<SmartBeatSettingsCardProps> = ({ t }) => {
    const smartBeat = useVisualizerSettingsStore(state => state.smartBeat);
    const setSmartBeat = useVisualizerSettingsStore(state => state.handleSetSmartBeat);
    const availability = useSmartBeatAvailability(smartBeat.mode);
    const unavailableReason = availability === 'ready' ? null : t(`options.beatFxUnavailable_${availability}`);

    return (
        <Group def={SMART_BEAT_GROUP}>
            <Row label={t('options.smartBeatMode')} note={t(`options.smartBeatDesc_${smartBeat.mode}`)}>
                <Segmented<SmartBeatMode>
                    value={smartBeat.mode}
                    options={[
                        { value: 'off', label: t('options.smartBeatOff') },
                        { value: 'cached', label: t('options.smartBeatCached') },
                        { value: 'on', label: t('options.smartBeatOn') },
                    ]}
                    onChange={mode => setSmartBeat({ mode })}
                />
            </Row>
            {unavailableReason && <Row notice={unavailableReason} />}
        </Group>
    );
};

export default SmartBeatSettingsCard;
