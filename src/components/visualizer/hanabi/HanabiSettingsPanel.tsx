// Copyright (c) 2026 chthollyphile
import React from 'react';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';
import { DEFAULT_HANABI_TUNING, type HanabiTuning } from './types';

// src/components/visualizer/hanabi/HanabiSettingsPanel.tsx
// 花火的参数面板：烟花、画面、文字、装饰、配色、性能、渲染（分辨率 / 抗锯齿，#929）几组，每组是设置套件的一个 Group；
// 滑块遵循 VisPlayground 的草稿 / 松手提交语义。

type NumberKey = { [K in keyof HanabiTuning]: HanabiTuning[K] extends number ? K : never }[keyof HanabiTuning];
type BooleanKey = { [K in keyof HanabiTuning]: HanabiTuning[K] extends boolean ? K : never }[keyof HanabiTuning];

interface SliderSpec { kind: 'slider'; key: NumberKey; labelKey: string; min: number; max: number; step?: number; noteKey?: string; }
interface ToggleSpec { kind: 'toggle'; key: BooleanKey; labelKey: string; noteKey?: string; }
type ControlSpec = SliderSpec | ToggleSpec;

const slider = (key: NumberKey, labelKey: string, min: number, max: number, extra: Partial<SliderSpec> = {}): SliderSpec => (
    { kind: 'slider', key, labelKey, min, max, ...extra }
);
const toggle = (key: BooleanKey, labelKey: string, noteKey?: string): ToggleSpec => ({ kind: 'toggle', key, labelKey, noteKey });

const FIREWORKS_GROUP: SettingsGroupDef = { id: 'vis-hanabi-fireworks', titleKey: 'options.hanabiFireworksSection' };
const STAGE_GROUP: SettingsGroupDef = { id: 'vis-hanabi-stage', titleKey: 'options.hanabiStageSection' };
const TEXT_GROUP: SettingsGroupDef = { id: 'vis-hanabi-text', titleKey: 'options.hanabiTextSection' };
const DECOR_GROUP: SettingsGroupDef = { id: 'vis-hanabi-decor', titleKey: 'options.hanabiDecorSection' };
const COLOR_GROUP: SettingsGroupDef = { id: 'vis-hanabi-color', titleKey: 'options.hanabiColorSection' };
const PERFORMANCE_GROUP: SettingsGroupDef = { id: 'vis-hanabi-performance', titleKey: 'options.hanabiPerformanceSection' };
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-hanabi-render', titleKey: 'options.lyricRenderSection' };

const FIREWORKS_CONTROLS: ControlSpec[] = [
    slider('sparkAmount', 'options.hanabiSparkAmount', 0, 2),
    slider('glow', 'options.hanabiGlow', 0, 2),
    slider('chorusBloom', 'options.hanabiChorusBloom', 0, 2, { noteKey: 'options.hanabiChorusBloomHint' }),
    slider('bloom', 'options.hanabiBloom', 0, 2, { noteKey: 'options.hanabiBloomHint' }),
    toggle('launches', 'options.hanabiLaunches', 'options.hanabiLaunchesHint'),
];

const STAGE_CONTROLS: ControlSpec[] = [
    slider('sky', 'options.hanabiSky', 0, 1, { step: 0.01, noteKey: 'options.hanabiSkyHint' }),
    slider('riseSpeed', 'options.hanabiRiseSpeed', 0, 2, { noteKey: 'options.hanabiRiseSpeedHint' }),
    slider('spin', 'options.hanabiSpin', 0, 2, { noteKey: 'options.hanabiSpinHint' }),
    slider('ambient', 'options.hanabiAmbient', 0, 2),
    toggle('overlayFrame', 'options.hanabiOverlayFrame'),
];

const TEXT_CONTROLS: ControlSpec[] = [
    toggle('textOnly', 'options.hanabiTextOnly', 'options.hanabiTextOnlyHint'),
    slider('textMotion', 'options.hanabiTextMotion', 0, 2),
    slider('blockOpacity', 'options.hanabiBlockOpacity', 0, 1, { step: 0.01 }),
];

const DECOR_CONTROLS: ControlSpec[] = [
    slider('collage', 'options.hanabiCollage', 0, 2, { noteKey: 'options.hanabiCollageHint' }),
    slider('ornamentAmount', 'options.hanabiOrnamentAmount', 0, 2),
];

const formatPlain = (value: number) => value.toFixed(2);

const HanabiSettingsPanel: React.FC<VisualizerSettingsPanelProps<HanabiTuning>> = ({
    t,
    tuning = DEFAULT_HANABI_TUNING,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const renderControl = (spec: ControlSpec) => (spec.kind === 'slider' ? (
        <SliderRow
            key={spec.key}
            label={t(spec.labelKey)}
            note={spec.noteKey && t(spec.noteKey)}
            value={tuning[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 0.05}
            format={formatPlain}
            onChange={value => onTuningChange?.({ [spec.key]: value })}
            onDragStart={onSliderPointerDown}
            onDragEnd={onSliderCommit}
        />
    ) : (
        <ToggleRow
            key={spec.key}
            label={t(spec.labelKey)}
            note={spec.noteKey && t(spec.noteKey)}
            checked={tuning[spec.key]}
            onChange={value => onTuningChange?.({ [spec.key]: value })}
        />
    ));

    return (
        <>
            <Group def={FIREWORKS_GROUP}>
                {FIREWORKS_CONTROLS.map(renderControl)}
            </Group>

            <Group def={STAGE_GROUP}>
                {STAGE_CONTROLS.map(renderControl)}
            </Group>

            <Group def={TEXT_GROUP}>
                {TEXT_CONTROLS.map(renderControl)}
            </Group>

            <Group def={DECOR_GROUP}>
                {DECOR_CONTROLS.map(renderControl)}
            </Group>

            <Group def={COLOR_GROUP}>
                <Row label={t('options.hanabiColorMode')} note={t('options.hanabiColorModeHint')}>
                    <Segmented<HanabiTuning['colorMode']>
                        value={tuning.colorMode}
                        options={[
                            { value: 'mixed', label: t('options.hanabiColorModeMixed') },
                            { value: 'vivid', label: t('options.hanabiColorModeVivid') },
                            { value: 'theme', label: t('options.hanabiColorModeTheme') },
                        ]}
                        onChange={colorMode => onTuningChange?.({ colorMode })}
                    />
                </Row>
            </Group>

            <Group def={PERFORMANCE_GROUP}>
                <Row label={t('options.hanabiRenderQuality')} note={t('options.hanabiRenderQualityHint')}>
                    <Segmented<HanabiTuning['renderQuality']>
                        value={tuning.renderQuality}
                        options={[
                            { value: 'full', label: t('options.hanabiRenderQualityFull') },
                            { value: 'balanced', label: t('options.hanabiRenderQualityBalanced') },
                            { value: 'low', label: t('options.hanabiRenderQualityLow') },
                        ]}
                        onChange={renderQuality => onTuningChange?.({ renderQuality })}
                    />
                </Row>
            </Group>

            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={tuning.render}
                    onChange={patch => onTuningChange?.({ render: { ...tuning.render, ...patch } })}
                />
            </Group>
        </>
    );
};

export default HanabiSettingsPanel;
