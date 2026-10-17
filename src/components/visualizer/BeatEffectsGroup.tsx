import React from 'react';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { modelsPresent, subscribeModelAvailability } from '../../services/analysis/modelAvailability';
import { BEAT_EFFECT_STRENGTH_MAX, offeredBeatEffects, resolveBeatEffectSetting, type BeatEffectDef } from '../../services/beatFx/beatEffects';
import { Group, Row, type SettingsGroupDef } from '../modal/settings/kit';
import { SliderRow, ToggleRow, times } from './panelRows';

// src/components/visualizer/BeatEffectsGroup.tsx
// A mode's 智能动感模式 effects, in its own settings above its style options: one row per effect the
// registry entry offers (`beatEffects`, retired ones left out), its four-character name and what it
// does, its own switch, and its strength - 0..2x, 1x the look it was tuned to, in the middle of the
// slider. The one 智能动感模式 switch is above, in SmartBeatSettingsCard.tsx; while it is off this
// says so, and the effects keep their settings for when it is on. An effect reading drum hits says
// when its model (htdemucs_gpu) is not installed. Nothing for a mode with no effects.

const BEAT_EFFECTS_GROUP: SettingsGroupDef = { id: 'vis-beat-effects', titleKey: 'options.beatEffects' };
const STRENGTH_MARKS = [{ value: 1 }];

type BeatEffectsGroupProps = {
    t: (key: string) => string;
    effects: readonly BeatEffectDef[] | undefined;
    /** Mark slider drag start so onChange only updates draft. */
    onSliderPointerDown?: () => void;
    /** Commit draft values to persistent store on slider release. */
    onSliderCommit?: () => void;
};

const BeatEffectsGroup: React.FC<BeatEffectsGroupProps> = ({ t, effects, onSliderPointerDown, onSliderCommit }) => {
    const smartBeat = useVisualizerSettingsStore(state => state.smartBeat);
    const setSmartBeat = useVisualizerSettingsStore(state => state.handleSetSmartBeat);
    const drumsPresent = React.useSyncExternalStore(subscribeModelAvailability, modelsPresent, modelsPresent).htdemucs_gpu;
    const offered = offeredBeatEffects(effects);
    if (!offered.length) return null;
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <Group def={BEAT_EFFECTS_GROUP}>
            {!smartBeat.enabled && <Row notice={t('options.beatEffectsNeedSmartBeat')} />}
            {offered.map((effect) => {
                const setting = resolveBeatEffectSetting(smartBeat, effect.id);
                const missingModel = effect.source === 'drums' && !drumsPresent;
                return (
                    <React.Fragment key={effect.id}>
                        <ToggleRow
                            label={t(effect.nameKey)}
                            note={t(effect.descKey)}
                            checked={setting.on}
                            onChange={on => setSmartBeat({ effects: { [effect.id]: { on } } })}
                        />
                        {smartBeat.enabled && setting.on && missingModel && <Row notice={t('options.beatEffectNeedsDrums')} />}
                        {smartBeat.enabled && setting.on && (
                            <SliderRow
                                label={t('options.beatEffectStrength')}
                                value={setting.strength}
                                min={0}
                                max={BEAT_EFFECT_STRENGTH_MAX}
                                step={0.05}
                                format={times}
                                marks={STRENGTH_MARKS}
                                onChange={strength => setSmartBeat({ effects: { [effect.id]: { strength } } })}
                                sub
                                {...drag}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </Group>
    );
};

export default BeatEffectsGroup;
