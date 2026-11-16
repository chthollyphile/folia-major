import React from 'react';
import { Group, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, times, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';
import { METAPHOR_LIMITS, type MetaphorBooleanKey, type MetaphorNumberKey, type MetaphorTuning } from './types';

// src/components/visualizer/metaphor/MetaphorSettingsPanel.tsx
// 隐喻的参数面板：镜头（切换快慢、运镜、反相镜头、转场）、墨（画面反相、关键字着色、流体、融球、网点、颗粒）、渲染（分辨率）三组，
// 每组是设置套件的一个 Group；滑块遵循歌词样式窗口的草稿 / 松手提交语义。

const CAMERA_GROUP: SettingsGroupDef = { id: 'vis-metaphor-camera', titleKey: 'options.metaphorCameraSection' };
const INK_GROUP: SettingsGroupDef = { id: 'vis-metaphor-ink', titleKey: 'options.metaphorInkSection' };
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-metaphor-render', titleKey: 'options.lyricRenderSection' };

type SliderSpec = [key: MetaphorNumberKey, labelKey: string, noteKey?: string];
type ToggleSpec = [key: MetaphorBooleanKey, labelKey: string, noteKey?: string];

const CAMERA_SLIDERS: SliderSpec[] = [
    ['cutPace', 'options.metaphorCutPace', 'options.metaphorCutPaceHint'],
    ['cameraMotion', 'options.metaphorCameraMotion'],
];
const CAMERA_TOGGLES: ToggleSpec[] = [
    ['negative', 'options.metaphorNegative', 'options.metaphorNegativeHint'],
    ['transitions', 'options.metaphorTransitions', 'options.metaphorTransitionsHint'],
];
const INK_TOGGLES: ToggleSpec[] = [
    ['flip', 'options.metaphorFlip', 'options.metaphorFlipHint'],
    ['keywordColors', 'options.metaphorKeywordColors', 'options.metaphorKeywordColorsHint'],
];
const INK_SLIDERS: SliderSpec[] = [
    ['flow', 'options.metaphorFlow'],
    ['blobs', 'options.metaphorBlobs'],
    ['halftone', 'options.metaphorHalftone'],
    ['grain', 'options.metaphorGrain'],
];

const MetaphorSettingsPanel: React.FC<VisualizerSettingsPanelProps<MetaphorTuning>> = ({
    t,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const renderSlider = ([key, labelKey, noteKey]: SliderSpec) => (
        <SliderRow
            key={key}
            label={t(labelKey)}
            note={noteKey && t(noteKey)}
            value={tuning[key]}
            min={METAPHOR_LIMITS[key].min}
            max={METAPHOR_LIMITS[key].max}
            step={0.05}
            format={times}
            onChange={value => onTuningChange({ [key]: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
    );
    const renderToggle = ([key, labelKey, noteKey]: ToggleSpec) => (
        <ToggleRow
            key={key}
            label={t(labelKey)}
            note={noteKey && t(noteKey)}
            checked={tuning[key]}
            onChange={value => onTuningChange({ [key]: value })}
        />
    );

    return (
        <>
            <Group def={CAMERA_GROUP}>
                {CAMERA_SLIDERS.map(renderSlider)}
                {CAMERA_TOGGLES.map(renderToggle)}
            </Group>

            <Group def={INK_GROUP}>
                {INK_TOGGLES.map(renderToggle)}
                {INK_SLIDERS.map(renderSlider)}
            </Group>

            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={tuning.render}
                    onChange={patch => onTuningChange({ render: { ...tuning.render, ...patch } })}
                    antialias={false}
                />
            </Group>
        </>
    );
};

export default MetaphorSettingsPanel;
