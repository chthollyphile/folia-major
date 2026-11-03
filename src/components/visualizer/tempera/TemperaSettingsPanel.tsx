import React, { useCallback } from 'react';
import { DEFAULT_TEMPERA_TUNING, type TemperaColorMode, type TemperaTuning } from '../../../types';
import { Group, PictureGrid, Reveal, Row, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, times, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';
import TemperaImageLayerControls from './TemperaImageLayerControls';
import { resolveTemperaPalette } from './temperaPalette';

// src/components/visualizer/tempera/TemperaSettingsPanel.tsx
// Keeps Tempera's tuning controls adjacent to the mode implementation: seven groups of the settings kit
// (渲染一组是分辨率 / 抗锯齿，#929).
const IMAGE_GROUP: SettingsGroupDef = { id: 'vis-tempera-image', titleKey: 'options.temperaImageSection' };
const QUALITY_GROUP: SettingsGroupDef = { id: 'vis-tempera-quality', titleKey: 'options.temperaQualitySection' };
/** 分辨率倍数（乘在上面的纹理分辨率上）与抗锯齿，默认跟随「性能与动效」的全局挡位（#929）。 */
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-tempera-render', titleKey: 'options.lyricRenderSection' };
const MOTION_GROUP: SettingsGroupDef = { id: 'vis-tempera-motion', titleKey: 'options.temperaMotionSection' };
const POST_PROCESS_GROUP: SettingsGroupDef = { id: 'vis-tempera-post-process', titleKey: 'options.temperaPostProcessSection' };
const LYRIC_GROUP: SettingsGroupDef = { id: 'vis-tempera-lyric', titleKey: 'options.temperaLyricSection' };
const DISPLAY_GROUP: SettingsGroupDef = { id: 'vis-tempera-display', titleKey: 'options.temperaDisplaySection' };

const COLOR_MODES: Array<{ value: TemperaColorMode; labelKey: string }> = [
    { value: 'duo', labelKey: 'options.temperaColorModeDuo' },
    { value: 'mono', labelKey: 'options.temperaColorModeMono' },
    { value: 'gradient', labelKey: 'options.temperaColorModeGradient' },
];

const MOTION_CONTROLS: Array<{ key: Extract<keyof TemperaTuning, 'cameraIntensity' | 'glyphMotion'>; labelKey: string }> = [
    { key: 'cameraIntensity', labelKey: 'options.temperaCameraIntensity' },
    { key: 'glyphMotion', labelKey: 'options.temperaGlyphMotion' },
];

/** 墨染奥行's three strengths; its ink takes the beat effect's own strength in 智能动感. */
const DEPTH_CONTROLS: Array<{ key: Extract<keyof TemperaTuning, 'depthOfField' | 'depthPan' | 'glyphDepth'>; labelKey: string }> = [
    { key: 'depthOfField', labelKey: 'options.temperaDepthOfField' },
    { key: 'depthPan', labelKey: 'options.temperaDepthPan' },
    { key: 'glyphDepth', labelKey: 'options.temperaGlyphDepth' },
];

const POST_PROCESS_CONTROLS: Array<{
    key: Extract<keyof TemperaTuning, 'postProcessGrain' | 'postProcessContrast' | 'postProcessRgbShift' | 'postProcessVignette' | 'postProcessLensDistortion'>;
    labelKey: string;
    max: number;
}> = [
    { key: 'postProcessGrain', labelKey: 'options.temperaPostProcessGrain', max: 1 },
    { key: 'postProcessContrast', labelKey: 'options.temperaPostProcessContrast', max: 1 },
    { key: 'postProcessRgbShift', labelKey: 'options.temperaPostProcessRgbShift', max: 1 },
    { key: 'postProcessVignette', labelKey: 'options.temperaPostProcessVignette', max: 2 },
    { key: 'postProcessLensDistortion', labelKey: 'options.temperaPostProcessLensDistortion', max: 2 },
];

const VISIBILITY_CONTROLS: Array<{
    key: Extract<keyof TemperaTuning, 'showBlocks' | 'showDecor' | 'showCornerMarks' | 'textInversion' | 'enableTransitions'>;
    labelKey: string;
}> = [
    { key: 'showBlocks', labelKey: 'options.temperaShowBlocks' },
    { key: 'showDecor', labelKey: 'options.temperaShowDecor' },
    { key: 'showCornerMarks', labelKey: 'options.temperaShowCornerMarks' },
    { key: 'textInversion', labelKey: 'options.temperaTextInversion' },
    { key: 'enableTransitions', labelKey: 'options.temperaEnableTransitions' },
];

const TemperaSettingsPanel: React.FC<VisualizerSettingsPanelProps<TemperaTuning>> = ({
    t,
    isDaylight,
    theme,
    rangeInputClass,
    tuning: temperaTuning = DEFAULT_TEMPERA_TUNING,
    onTuningChange: onTemperaTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    // A colour mode as the renderer resolves it for this theme (no cover at hand): the paper, the
    // three block colours as bands, and the ink as a line of text.
    const colorModePicture = useCallback((colorMode: TemperaColorMode) => {
        const palette = resolveTemperaPalette(theme, { colorMode });
        return (
            <span className="absolute inset-0 flex items-end" style={{ backgroundColor: palette.paper }}>
                <span className="absolute left-[14%] top-[22%] h-1.5 w-[44%] rounded-sm" style={{ backgroundColor: palette.ink }} />
                <span className="h-[42%] flex-1" style={{ backgroundColor: palette.blockA }} />
                <span className="h-[56%] flex-1" style={{ backgroundColor: palette.blockB }} />
                <span className="h-[70%] flex-1" style={{ backgroundColor: palette.blockC }} />
            </span>
        );
    }, [theme]);

    return (
        <>
            <Group def={IMAGE_GROUP}>
                <TemperaImageLayerControls
                    images={temperaTuning.layerImages}
                    depth={temperaTuning.layerImageDepth}
                    frequency={temperaTuning.layerImageFrequency}
                    rangeInputClass={rangeInputClass}
                    isDaylight={isDaylight}
                    onCommit={patch => onTemperaTuningChange?.(patch)}
                />
            </Group>

            <Group def={QUALITY_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.temperaTextureResolution')}
                    value={temperaTuning.textureResolution}
                    min={0.5}
                    max={4}
                    step={0.25}
                    format={times}
                    onChange={textureResolution => onTemperaTuningChange?.({ textureResolution })}
                />
                <Row notice={t('options.temperaTexturePerformanceWarning')} />
            </Group>

            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={temperaTuning.render}
                    onChange={patch => onTemperaTuningChange?.({ render: { ...temperaTuning.render, ...patch } })}
                />
            </Group>

            <Group def={MOTION_GROUP}>
                {MOTION_CONTROLS.map(control => (
                    <SliderRow
                        {...drag}
                        key={control.key}
                        label={t(control.labelKey)}
                        value={temperaTuning[control.key]}
                        min={0}
                        max={2}
                        step={0.05}
                        format={times}
                        onChange={value => onTemperaTuningChange?.({ [control.key]: value })}
                    />
                ))}
                <SliderRow
                    {...drag}
                    label={t('options.temperaGlyphSettleStretch')}
                    note={t('options.temperaGlyphSettleStretchHint')}
                    value={temperaTuning.glyphSettleStretch}
                    min={0}
                    max={1}
                    step={0.05}
                    format={times}
                    onChange={glyphSettleStretch => onTemperaTuningChange?.({ glyphSettleStretch })}
                />
                <Row label={t('options.temperaDepthStrength')} hint={t('options.temperaDepthStrengthHint')} />
                {DEPTH_CONTROLS.map(control => (
                    <SliderRow
                        {...drag}
                        sub
                        key={control.key}
                        label={t(control.labelKey)}
                        value={temperaTuning[control.key]}
                        min={0}
                        max={2}
                        step={0.05}
                        format={times}
                        onChange={value => onTemperaTuningChange?.({ [control.key]: value })}
                    />
                ))}
                <Row
                    label={t('options.temperaColorMode')}
                    below={(
                        <PictureGrid
                            className="-mx-4"
                            columns={3}
                            label={t('options.temperaColorMode')}
                            value={temperaTuning.colorMode}
                            options={COLOR_MODES.map(mode => ({ value: mode.value, label: t(mode.labelKey) }))}
                            picture={colorModePicture}
                            onChange={colorMode => onTemperaTuningChange?.({ colorMode })}
                        />
                    )}
                />
            </Group>

            <Group def={POST_PROCESS_GROUP}>
                <ToggleRow
                    label={t('options.temperaPostProcessEnabled')}
                    checked={temperaTuning.postProcessEnabled}
                    onChange={postProcessEnabled => onTemperaTuningChange?.({ postProcessEnabled })}
                />
                <Reveal when={temperaTuning.postProcessEnabled}>
                    <ToggleRow
                        sub
                        label={t('options.temperaPostProcessTextureCompression')}
                        note={t('options.temperaPostProcessTextureCompressionHint')}
                        checked={temperaTuning.postProcessTextureCompression}
                        onChange={postProcessTextureCompression => onTemperaTuningChange?.({ postProcessTextureCompression })}
                    />
                    {POST_PROCESS_CONTROLS.map(control => (
                        <SliderRow
                            {...drag}
                            sub
                            key={control.key}
                            label={t(control.labelKey)}
                            value={temperaTuning[control.key]}
                            min={0}
                            max={control.max}
                            step={0.05}
                            format={times}
                            onChange={value => onTemperaTuningChange?.({ [control.key]: value })}
                        />
                    ))}
                </Reveal>
            </Group>

            <Group def={LYRIC_GROUP}>
                <ToggleRow
                    label={t('options.temperaWholeLineLyrics')}
                    note={t('options.temperaWholeLineLyricsHint')}
                    checked={temperaTuning.wholeLineLyrics}
                    onChange={wholeLineLyrics => onTemperaTuningChange?.({ wholeLineLyrics })}
                />
            </Group>

            <Group def={DISPLAY_GROUP}>
                {VISIBILITY_CONTROLS.map(control => (
                    <ToggleRow
                        key={control.key}
                        label={t(control.labelKey)}
                        checked={temperaTuning[control.key]}
                        onChange={(next) => onTemperaTuningChange?.({ [control.key]: next })}
                    />
                ))}
            </Group>
        </>
    );
};

export default TemperaSettingsPanel;
