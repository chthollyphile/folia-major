// Copyright (c) 2026 chthollyphile
import React from 'react';
import { DEFAULT_LUMIERE_TUNING, type LumiereRenderQuality, type LumiereTuning } from '../../../types';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';

// src/components/visualizer/lumiere/LumiereSettingsPanel.tsx
// 绘光的参数面板：光、氛围、文字、主题、性能、渲染（分辨率 / 抗锯齿，#929）几组，每组是设置套件的一个 Group；
// 滑块遵循 VisPlayground 的草稿 / 松手提交语义。性能组的画质档只降图形组，渲染组的分辨率倍数乘在整张画布上，两者相乘。

type NumberKey = { [K in keyof LumiereTuning]: LumiereTuning[K] extends number ? K : never }[keyof LumiereTuning];
type BooleanKey = { [K in keyof LumiereTuning]: LumiereTuning[K] extends boolean ? K : never }[keyof LumiereTuning];

interface SliderSpec { kind: 'slider'; key: NumberKey; labelKey: string; min: number; max: number; step?: number; integer?: boolean; noteKey?: string; }
interface ToggleSpec { kind: 'toggle'; key: BooleanKey; labelKey: string; noteKey?: string; }
type ControlSpec = SliderSpec | ToggleSpec;

const slider = (key: NumberKey, labelKey: string, min: number, max: number, extra: Partial<SliderSpec> = {}): SliderSpec => (
    { kind: 'slider', key, labelKey, min, max, ...extra }
);
const toggle = (key: BooleanKey, labelKey: string, noteKey?: string): ToggleSpec => ({ kind: 'toggle', key, labelKey, noteKey });

const LIGHT_GROUP: SettingsGroupDef = { id: 'vis-lumiere-light', titleKey: 'options.lumiereLightSection' };
const ATMOSPHERE_GROUP: SettingsGroupDef = { id: 'vis-lumiere-atmosphere', titleKey: 'options.lumiereAtmosphereSection' };
const TEXT_GROUP: SettingsGroupDef = { id: 'vis-lumiere-text', titleKey: 'options.lumiereTextSection' };
const THEME_GROUP: SettingsGroupDef = { id: 'vis-lumiere-theme', titleKey: 'options.lumiereThemeSection' };
const PERFORMANCE_GROUP: SettingsGroupDef = { id: 'vis-lumiere-performance', titleKey: 'options.lumierePerformanceSection' };
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-lumiere-render', titleKey: 'options.lyricRenderSection' };

const LIGHT_CONTROLS: ControlSpec[] = [
    slider('lightIntensity', 'options.lumiereLightIntensity', 0.3, 2),
    slider('audioResponse', 'options.lumiereAudioResponse', 0, 2, { noteKey: 'options.lumiereAudioResponseHint' }),
    slider('bloom', 'options.lumiereBloom', 0, 2),
    slider('textBloom', 'options.lumiereTextBloom', 0, 2),
];

const ATMOSPHERE_CONTROLS: ControlSpec[] = [
    slider('darkField', 'options.lumiereDarkField', 0, 1, { step: 0.01, noteKey: 'options.lumiereDarkFieldHint' }),
    slider('fogDensity', 'options.lumiereFogDensity', 0, 2),
    slider('fogOctaves', 'options.lumiereFogOctaves', 2, 6, { step: 1, integer: true }),
    slider('moteAmount', 'options.lumiereMoteAmount', 0, 2),
    toggle('frontBokeh', 'options.lumiereFrontBokeh'),
    toggle('lineArt', 'options.lumiereLineArt'),
    toggle('overlayFrame', 'options.lumiereOverlayFrame'),
];

// 邻行是二选一的分段控件，夹在未唱字透明度与崩解强度之间，所以文字组拆成前后两段。
const TEXT_CONTROLS_LEAD: ControlSpec[] = [
    toggle('textOnly', 'options.lumiereTextOnly', 'options.lumiereTextOnlyHint'),
    slider('unlitOpacity', 'options.lumiereUnlitOpacity', 0.05, 0.6, { step: 0.01 }),
];

const TEXT_CONTROLS_TAIL: ControlSpec[] = [
    slider('decay', 'options.lumiereDecay', 0, 2),
    slider('echo', 'options.lumiereEcho', 0, 2, { noteKey: 'options.lumiereEchoHint' }),
    toggle('trails', 'options.lumiereTrails'),
    toggle('hideTrails', 'options.lumiereHideTrails', 'options.lumiereHideTrailsHint'),
    toggle('seamlessTransitions', 'options.lumiereSeamlessTransitions', 'options.lumiereSeamlessTransitionsHint'),
];

const THEME_CONTROLS: ControlSpec[] = [
    slider('themeColorMix', 'options.lumiereThemeColorMix', 0, 1, { step: 0.01, noteKey: 'options.lumiereThemeColorMixHint' }),
    toggle('keywordColors', 'options.lumiereKeywordColors'),
    toggle('themeIcons', 'options.lumiereThemeIcons'),
];

const formatPlain = (value: number) => value.toFixed(2);
const formatInteger = (value: number) => String(Math.round(value));

const LumiereSettingsPanel: React.FC<VisualizerSettingsPanelProps<LumiereTuning>> = ({
    t,
    tuning: lumiereTuning = DEFAULT_LUMIERE_TUNING,
    onTuningChange: onLumiereTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const renderControl = (spec: ControlSpec) => (spec.kind === 'slider' ? (
        <SliderRow
            key={spec.key}
            label={t(spec.labelKey)}
            note={spec.noteKey && t(spec.noteKey)}
            value={lumiereTuning[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 0.05}
            format={spec.integer ? formatInteger : formatPlain}
            onChange={value => onLumiereTuningChange?.({ [spec.key]: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
    ) : (
        <ToggleRow
            key={spec.key}
            label={t(spec.labelKey)}
            note={spec.noteKey && t(spec.noteKey)}
            checked={lumiereTuning[spec.key]}
            onChange={value => onLumiereTuningChange?.({ [spec.key]: value })}
        />
    ));

    return (
        <>
            <Group def={LIGHT_GROUP}>
                {LIGHT_CONTROLS.map(renderControl)}
            </Group>

            <Group def={ATMOSPHERE_GROUP}>
                {ATMOSPHERE_CONTROLS.map(renderControl)}
            </Group>

            <Group def={TEXT_GROUP}>
                {TEXT_CONTROLS_LEAD.map(renderControl)}
                <Row label={t('options.lumiereWindowNeighbors')}>
                    <Segmented
                        value={String(lumiereTuning.windowNeighbors) as '1' | '2'}
                        options={[
                            { value: '1', label: t('options.lumiereWindowNeighborsPrev') },
                            { value: '2', label: t('options.lumiereWindowNeighborsBoth') },
                        ]}
                        onChange={next => onLumiereTuningChange?.({ windowNeighbors: next === '1' ? 1 : 2 })}
                    />
                </Row>
                {TEXT_CONTROLS_TAIL.map(renderControl)}
            </Group>

            <Group def={THEME_GROUP}>
                {THEME_CONTROLS.map(renderControl)}
            </Group>

            <Group def={PERFORMANCE_GROUP}>
                <Row label={t('options.lumiereRenderQuality')} note={t('options.lumiereRenderQualityHint')}>
                    <Segmented<LumiereRenderQuality>
                        value={lumiereTuning.renderQuality}
                        options={[
                            { value: 'full', label: t('options.lumiereRenderQualityFull') },
                            { value: 'balanced', label: t('options.lumiereRenderQualityBalanced') },
                            { value: 'low', label: t('options.lumiereRenderQualityLow') },
                        ]}
                        onChange={renderQuality => onLumiereTuningChange?.({ renderQuality })}
                    />
                </Row>
            </Group>

            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={lumiereTuning.render}
                    onChange={patch => onLumiereTuningChange?.({ render: { ...lumiereTuning.render, ...patch } })}
                />
            </Group>
        </>
    );
};

export default LumiereSettingsPanel;
