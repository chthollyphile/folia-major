import React from 'react';
import { DEFAULT_SONNET_TUNING, type SonnetOuterFrameMode, type SonnetTuning } from '../../../types';
import { Group, Reveal, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, times, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';

// src/components/visualizer/sonnet/SonnetSettingsPanel.tsx
// Keeps Sonnet's tuning controls adjacent to the mode implementation: five groups of the settings kit
// (渲染一组是分辨率 / 抗锯齿，#929).
const QUALITY_GROUP: SettingsGroupDef = { id: 'vis-sonnet-quality', titleKey: 'options.sonnetQualitySection' };
/** 分辨率倍数（乘在上面的纹理分辨率上）与抗锯齿，默认跟随「性能与动效」的全局挡位（#929）。 */
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-sonnet-render', titleKey: 'options.lyricRenderSection' };
const MOTION_GROUP: SettingsGroupDef = { id: 'vis-sonnet-motion', titleKey: 'options.sonnetMotionSection' };
const POST_PROCESS_GROUP: SettingsGroupDef = { id: 'vis-sonnet-post-process', titleKey: 'options.sonnetPostProcessSection' };
const DISPLAY_GROUP: SettingsGroupDef = { id: 'vis-sonnet-display', titleKey: 'options.sonnetDisplaySection' };

type PostProcessKey = Extract<keyof SonnetTuning, 'postProcessGrain' | 'postProcessContrast' | 'postProcessRgbShift' | 'postProcessLensDistortion' | 'postProcessLensDispersion' | 'postProcessHalftone' | 'postProcessVignette'>;

const POST_PROCESS_CONTROLS: Array<{ key: PostProcessKey; labelKey: string; max: number }> = [
    { key: 'postProcessGrain', labelKey: 'options.sonnetPostProcessGrain', max: 1 },
    { key: 'postProcessContrast', labelKey: 'options.sonnetPostProcessContrast', max: 1 },
    { key: 'postProcessRgbShift', labelKey: 'options.sonnetPostProcessRgbShift', max: 1 },
    { key: 'postProcessLensDistortion', labelKey: 'options.sonnetPostProcessLensDistortion', max: 2 },
    { key: 'postProcessLensDispersion', labelKey: 'options.sonnetPostProcessLensDispersion', max: 1 },
    { key: 'postProcessHalftone', labelKey: 'options.sonnetPostProcessHalftone', max: 1 },
    { key: 'postProcessVignette', labelKey: 'options.sonnetPostProcessVignette', max: 2 },
];

const MOTION_CONTROLS: Array<{ key: Extract<keyof SonnetTuning, 'cameraIntensity' | 'typographyMotion' | 'mgDensity'>; labelKey: string }> = [
    { key: 'cameraIntensity', labelKey: 'options.sonnetCameraIntensity' },
    { key: 'typographyMotion', labelKey: 'options.sonnetTypographyMotion' },
    { key: 'mgDensity', labelKey: 'options.sonnetMgDensity' },
];

const VISIBILITY_CONTROLS: Array<{
    key: Extract<keyof SonnetTuning, 'showOnlyText' | 'showGuide' | 'showBackgroundMg' | 'showFixedGeo' | 'showGiantDecorativeText' | 'showBackgroundDecor' | 'enableTransitions'>;
    labelKey: string;
}> = [
    { key: 'showOnlyText', labelKey: 'options.sonnetShowOnlyText' },
    { key: 'showGuide', labelKey: 'options.sonnetShowGuide' },
    { key: 'showBackgroundMg', labelKey: 'options.sonnetShowBackgroundMg' },
    { key: 'showFixedGeo', labelKey: 'options.sonnetShowFixedGeo' },
    { key: 'showGiantDecorativeText', labelKey: 'options.sonnetShowGiantDecorativeText' },
    { key: 'showBackgroundDecor', labelKey: 'options.sonnetShowBackgroundDecor' },
    { key: 'enableTransitions', labelKey: 'options.sonnetEnableTransitions' },
];

const SonnetSettingsPanel: React.FC<VisualizerSettingsPanelProps<SonnetTuning>> = ({
    t,
    tuning: sonnetTuning = DEFAULT_SONNET_TUNING,
    onTuningChange: onSonnetTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            <Group def={QUALITY_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.sonnetTextureResolution')}
                    value={sonnetTuning.textureResolution}
                    min={0.5}
                    max={4}
                    step={0.25}
                    format={times}
                    onChange={textureResolution => onSonnetTuningChange?.({ textureResolution })}
                />
                <Row notice={t('options.sonnetTexturePerformanceWarning')} />
            </Group>

            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={sonnetTuning.render}
                    onChange={patch => onSonnetTuningChange?.({ render: { ...sonnetTuning.render, ...patch } })}
                />
            </Group>

            <Group def={MOTION_GROUP}>
                {MOTION_CONTROLS.map(control => (
                    <SliderRow
                        {...drag}
                        key={control.key}
                        label={t(control.labelKey)}
                        value={sonnetTuning[control.key]}
                        min={0}
                        max={2}
                        step={0.05}
                        format={times}
                        onChange={value => onSonnetTuningChange?.({ [control.key]: value })}
                    />
                ))}
            </Group>

            <Group def={POST_PROCESS_GROUP}>
                <ToggleRow
                    label={t('options.sonnetPostProcessEnabled')}
                    checked={sonnetTuning.postProcessEnabled}
                    onChange={postProcessEnabled => onSonnetTuningChange?.({ postProcessEnabled })}
                />
                <Reveal when={sonnetTuning.postProcessEnabled}>
                    {POST_PROCESS_CONTROLS.map(control => (
                        <SliderRow
                            {...drag}
                            sub
                            key={control.key}
                            label={t(control.labelKey)}
                            value={sonnetTuning[control.key]}
                            min={0}
                            max={control.max}
                            step={0.05}
                            format={times}
                            onChange={value => onSonnetTuningChange?.({ [control.key]: value })}
                        />
                    ))}
                </Reveal>
            </Group>

            <Group def={DISPLAY_GROUP}>
                <Row label={t('options.sonnetOuterFrameMode')}>
                    <Segmented<SonnetOuterFrameMode>
                        value={sonnetTuning.outerFrameMode}
                        options={[
                            { value: 'none', label: t('options.sonnetOuterFrameNone') },
                            { value: 'frame', label: t('options.sonnetOuterFrameFrame') },
                            { value: 'full', label: t('options.sonnetOuterFrameFull') },
                        ]}
                        onChange={outerFrameMode => onSonnetTuningChange?.({ outerFrameMode })}
                    />
                </Row>
                {VISIBILITY_CONTROLS.map(control => (
                    <ToggleRow
                        key={control.key}
                        label={t(control.labelKey)}
                        checked={sonnetTuning[control.key]}
                        onChange={(next) => onSonnetTuningChange?.({ [control.key]: next })}
                    />
                ))}
            </Group>
        </>
    );
};

export default SonnetSettingsPanel;
