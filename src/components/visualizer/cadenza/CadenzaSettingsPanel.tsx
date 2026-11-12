import React from 'react';
import { DEFAULT_CADENZA_TUNING, type CadenzaTuning } from '../../../types';
import { DEFAULT_LYRIC_RENDER_OVERRIDE } from '../../../utils/lyricRenderQuality';
import { Group, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';

// src/components/visualizer/cadenza/CadenzaSettingsPanel.tsx
// 心象的设置面板：只有「渲染」一组（#929），文字画布是 canvas 2D，只给分辨率一行，不给抗锯齿。
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-cadenza-render', titleKey: 'options.lyricRenderSection' };

const CadenzaSettingsPanel: React.FC<VisualizerSettingsPanelProps<CadenzaTuning>> = ({
    tuning = DEFAULT_CADENZA_TUNING,
    onTuningChange,
}) => {
    const render = tuning.render ?? DEFAULT_LYRIC_RENDER_OVERRIDE;
    return (
        <Group def={RENDER_GROUP}>
            <LyricRenderQualityRows
                value={render}
                onChange={(patch) => onTuningChange?.({ render: { ...render, ...patch } })}
                antialias={false}
            />
        </Group>
    );
};

export default CadenzaSettingsPanel;
