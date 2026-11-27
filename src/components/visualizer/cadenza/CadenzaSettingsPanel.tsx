import React from 'react';
import { DEFAULT_CADENZA_TUNING, type CadenzaTuning } from '../../../types';
import { DEFAULT_LYRIC_RENDER_OVERRIDE } from '../../../utils/lyricRenderQuality';
import { Group, Row, Toggle, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';

// src/components/visualizer/cadenza/CadenzaSettingsPanel.tsx
// 心象的设置面板：「渲染」一组（#929），文字画布是 canvas 2D，只给分辨率一行，不给抗锯齿；另有一组放手写笔画开关。
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-cadenza-render', titleKey: 'options.lyricRenderSection' };
const TEXT_GROUP: SettingsGroupDef = { id: 'vis-cadenza', titleKey: 'ui.cadenzeTuning' };

const CadenzaSettingsPanel: React.FC<VisualizerSettingsPanelProps<CadenzaTuning>> = ({
    t,
    tuning = DEFAULT_CADENZA_TUNING,
    onTuningChange,
}) => {
    const render = tuning.render ?? DEFAULT_LYRIC_RENDER_OVERRIDE;
    return (
        <>
            <Group def={TEXT_GROUP}>
                <Row label={t('options.handwriting')} hint={t('options.handwritingHint')}>
                    <Toggle
                        checked={tuning.handwriting === true}
                        onChange={(enabled) => onTuningChange({ handwriting: enabled })}
                    />
                </Row>
            </Group>
            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={render}
                    onChange={(patch) => onTuningChange?.({ render: { ...render, ...patch } })}
                    antialias={false}
                />
            </Group>
        </>
    );
};

export default CadenzaSettingsPanel;
