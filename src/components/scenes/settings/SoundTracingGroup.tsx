import React from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Reveal, Row, Segmented, Toggle, option, type SettingsGroupDef } from '../../modal/settings/kit';
import { useChosenScene } from '../registry';
import { useSoundTracingStore, type SoundTracingOutput } from './useSoundTracingStore';

// src/components/scenes/settings/SoundTracingGroup.tsx
// 设置「场景」页的「声线追踪」一组：总开关，开着时下面是耳机/音箱。所有场景共用；
// 没选场景或选的场景不放音乐（清单 sound.music 不是 'speakers'）时开关不能点。

const OUTPUTS: readonly SoundTracingOutput[] = ['headphones', 'speakers'];

const SOUND: SettingsGroupDef = { id: 'soundTracing', titleKey: 'ui.soundTracing' };

const O = {
    enabled: option(SOUND, 'soundTracingEnabled', 'ui.soundTracing'),
    output: option(SOUND, 'soundTracingOutput', 'ui.soundTracingOutput'),
};

export const SOUND_TRACING_OPTIONS = Object.values(O);

const SoundTracingGroup: React.FC = () => {
    const { t } = useTranslation();
    const supported = useChosenScene()?.manifest.sound?.music === 'speakers';
    const enabled = useSoundTracingStore(state => state.enabled);
    const output = useSoundTracingStore(state => state.output);
    const setEnabled = useSoundTracingStore(state => state.setEnabled);
    const setOutput = useSoundTracingStore(state => state.setOutput);
    const on = supported && enabled;

    return (
        <Group def={SOUND}>
            <Row option={O.enabled} hint={supported ? undefined : t('ui.soundTracingUnsupported')} disabled={!supported}>
                <Toggle checked={on} onChange={setEnabled} disabled={!supported} />
            </Row>
            <Reveal when={on}>
                <Row sub option={O.output}>
                    <Segmented value={output} options={OUTPUTS.map(value => ({ value, label: t(`ui.soundTracingOutput_${value}`) }))} onChange={setOutput} />
                </Row>
            </Reveal>
        </Group>
    );
};

export default SoundTracingGroup;
