import React from 'react';
import { DEFAULT_PENDOLO_TUNING, type PendoloTuning } from '../../../types';
import { Button, Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import { percent, SliderRow, times, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';
import { PENDOLO_HUB_VIEW_BACK_MAX, PENDOLO_HUB_VIEW_BACK_MIN, PENDOLO_HUB_VIEW_HEIGHT_MAX, PENDOLO_HUB_VIEW_HEIGHT_MIN, PENDOLO_TILT_LIMIT_DEG } from './pendoloDialProjection';

// src/components/visualizer/pendolo/PendoloSettingsPanel.tsx
// Owns Pendolo-specific tuning controls, drawn as groups of the settings kit.
const PENDOLO_GROUP: SettingsGroupDef = { id: 'vis-pendolo', titleKey: 'options.pendoloSettings' };
// 渲染（#929）：齿轮画布的分辨率与抗锯齿（WebGL 的 MSAA），默认跟随全局
const PENDOLO_RENDER_GROUP: SettingsGroupDef = { id: 'vis-pendolo-render', titleKey: 'options.lyricRenderSection' };
// 「时计参数」标题栏的三个预设，和默认放在一起。都在默认值上只改各自那几项，点完总是同一套参数。
// 预设 1：表盘往前倾、分层视差拉满，轮盘放大、往右挪
const PENDOLO_PRESET_TILT_FORWARD: Partial<PendoloTuning> = {
    arcRadius: 0.5,
    wheelCenterX: 0.3,
    tickSnappiness: 1.8,
    tiltDeg: 40,
    tiltAxisDeg: -10,
    parallaxDepth: 2,
};
// 预设 2：表盘往后倾、侧向转开，加分层视差，轮盘放大、往右挪
const PENDOLO_PRESET_TILT: Partial<PendoloTuning> = {
    arcRadius: 0.5,
    wheelCenterX: 0.3,
    tiltDeg: -53,
    tiltAxisDeg: 66,
    parallaxDepth: 1.65,
};
// 预设 3：轮心视角，相机在轮心后上方顺着刻度针看，歌词立起来
const PENDOLO_PRESET_HUB_VIEW: Partial<PendoloTuning> = {
    hubView: true,
    hubViewHeight: 1.4,
    hubViewBack: 1.2,
    parallaxDepth: 1,
};

const PendoloSettingsPanel: React.FC<VisualizerSettingsPanelProps<PendoloTuning>> = ({
    t,
    tuning: pendoloTuning,
    onTuningChange: onPendoloTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const resolvedTuning = pendoloTuning ?? DEFAULT_PENDOLO_TUNING;
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };
    const render = resolvedTuning.render ?? DEFAULT_PENDOLO_TUNING.render;
    const mirrored = resolvedTuning.mirrorLayout === true;
    // 轮心视角代替倾斜：开着时藏起倾斜的两个滑块，换成相机高度
    const hubView = resolvedTuning.hubView === true;
    // 「时计参数」这一组的恢复默认：只还原这一组的项，渲染（分辨率与抗锯齿）那一组不动
    const groupKeys = (Object.keys(DEFAULT_PENDOLO_TUNING) as (keyof PendoloTuning)[])
        .filter(key => key !== 'render');
    const groupDefaults = Object.fromEntries(
        groupKeys.map(key => [key, DEFAULT_PENDOLO_TUNING[key]]),
    ) as Partial<PendoloTuning>;
    // 这一组现在是不是正好等于某一套（默认或预设）：是的话那个按钮变灰。滑块拖出来的小数有浮点误差，数值按容差比
    const matchesGroup = (target: Partial<PendoloTuning>) => groupKeys.every((key) => {
        const value = resolvedTuning[key] ?? DEFAULT_PENDOLO_TUNING[key];
        const expected = target[key];
        return typeof value === 'number' && typeof expected === 'number'
            ? Math.abs(value - expected) < 1e-6
            : value === expected;
    });
    // 预设只换视角和轮盘，左右镜像保持用户现在的选择；默认才连镜像一起还原
    const presetBase = { ...groupDefaults, mirrorLayout: mirrored };
    const presetTiltForward = { ...presetBase, ...PENDOLO_PRESET_TILT_FORWARD };
    const presetTilt = { ...presetBase, ...PENDOLO_PRESET_TILT };
    const presetHubView = { ...presetBase, ...PENDOLO_PRESET_HUB_VIEW };

    return (
        <>
            <Group
                def={PENDOLO_GROUP}
                action={(
                    <span className="flex items-center gap-1.5">
                        <Button variant="quiet" disabled={matchesGroup(groupDefaults)} onClick={() => onPendoloTuningChange(groupDefaults)}>
                            {t('options.pendoloPresetDefault')}
                        </Button>
                        <Button variant="quiet" disabled={matchesGroup(presetTiltForward)} onClick={() => onPendoloTuningChange(presetTiltForward)}>
                            {t('options.pendoloPreset1')}
                        </Button>
                        <Button variant="quiet" disabled={matchesGroup(presetTilt)} onClick={() => onPendoloTuningChange(presetTilt)}>
                            {t('options.pendoloPreset2')}
                        </Button>
                        <Button variant="quiet" disabled={matchesGroup(presetHubView)} onClick={() => onPendoloTuningChange(presetHubView)}>
                            {t('options.pendoloPreset3')}
                        </Button>
                    </span>
                )}
            >
                <ToggleRow
                    label={t('options.pendoloMirrorLayout')}
                    checked={mirrored}
                    onChange={(next) => onPendoloTuningChange({ mirrorLayout: next })}
                />
                <SliderRow
                    {...drag}
                    label={t(mirrored ? 'options.pendoloWheelCenterXMirrored' : 'options.pendoloWheelCenterX')}
                    value={resolvedTuning.wheelCenterX}
                    min={-0.2}
                    max={0.4}
                    step={0.01}
                    format={(value) => `${value > 0 ? '+' : ''}${percent(value)}`}
                    onChange={(value) => onPendoloTuningChange?.({ wheelCenterX: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.pendoloArcRadius')}
                    value={resolvedTuning.arcRadius}
                    min={0.25}
                    max={0.8}
                    step={0.01}
                    format={percent}
                    onChange={(value) => onPendoloTuningChange?.({ arcRadius: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.pendoloArcAngleDeg')}
                    value={resolvedTuning.arcAngleDeg}
                    min={40}
                    max={160}
                    step={5}
                    format={(value) => `${Math.round(value)}°`}
                    onChange={(value) => onPendoloTuningChange?.({ arcAngleDeg: value })}
                />
                <ToggleRow
                    label={t('options.pendoloHubView')}
                    checked={hubView}
                    onChange={(next) => onPendoloTuningChange({ hubView: next })}
                />
                {hubView ? (
                    <>
                        <SliderRow
                            {...drag}
                            label={t('options.pendoloHubViewHeight')}
                            value={resolvedTuning.hubViewHeight ?? 1.4}
                            min={PENDOLO_HUB_VIEW_HEIGHT_MIN}
                            max={PENDOLO_HUB_VIEW_HEIGHT_MAX}
                            step={0.05}
                            format={times}
                            onChange={(value) => onPendoloTuningChange({ hubViewHeight: value })}
                        />
                        <SliderRow
                            {...drag}
                            label={t('options.pendoloHubViewBack')}
                            value={resolvedTuning.hubViewBack ?? 1.2}
                            min={PENDOLO_HUB_VIEW_BACK_MIN}
                            max={PENDOLO_HUB_VIEW_BACK_MAX}
                            step={0.05}
                            format={times}
                            onChange={(value) => onPendoloTuningChange({ hubViewBack: value })}
                        />
                    </>
                ) : (
                    <>
                        <SliderRow
                            {...drag}
                            label={t('options.pendoloTiltDeg')}
                            value={resolvedTuning.tiltDeg ?? 0}
                            min={-PENDOLO_TILT_LIMIT_DEG}
                            max={PENDOLO_TILT_LIMIT_DEG}
                            step={1}
                            format={(value) => `${Math.round(value)}°`}
                            onChange={(value) => onPendoloTuningChange({ tiltDeg: value })}
                        />
                        <SliderRow
                            {...drag}
                            label={t('options.pendoloTiltAxisDeg')}
                            value={resolvedTuning.tiltAxisDeg ?? 0}
                            min={-90}
                            max={90}
                            step={1}
                            format={(value) => `${Math.round(value)}°`}
                            onChange={(value) => onPendoloTuningChange({ tiltAxisDeg: value })}
                        />
                    </>
                )}
                <SliderRow
                    {...drag}
                    label={t('options.pendoloParallaxDepth')}
                    value={resolvedTuning.parallaxDepth ?? 1}
                    min={0}
                    max={2}
                    step={0.05}
                    format={times}
                    onChange={(value) => onPendoloTuningChange({ parallaxDepth: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.pendoloTickSnappiness')}
                    value={resolvedTuning.tickSnappiness}
                    min={0.5}
                    max={2}
                    step={0.1}
                    format={(value) => `${value.toFixed(1)}x`}
                    onChange={(value) => onPendoloTuningChange?.({ tickSnappiness: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.pendoloActiveScale')}
                    value={resolvedTuning.activeScale}
                    min={1}
                    max={1.6}
                    step={0.05}
                    format={times}
                    onChange={(value) => onPendoloTuningChange?.({ activeScale: value })}
                />
                <Row label={t('options.pendoloShowGearDecor')}>
                    <Segmented<PendoloTuning['showGearDecor']>
                        value={resolvedTuning.showGearDecor}
                        options={[
                            { value: 'none', label: t('options.decorNone') },
                            { value: 'subtle', label: t('options.decorSubtle') },
                            { value: 'full', label: t('options.decorFull') },
                        ]}
                        onChange={(next) => onPendoloTuningChange?.({ showGearDecor: next })}
                    />
                </Row>
                <ToggleRow
                    label={t('options.pendoloShowCenterGradient')}
                    checked={resolvedTuning.showCenterGradient ?? true}
                    onChange={(next) => onPendoloTuningChange?.({ showCenterGradient: next })}
                />
                <ToggleRow
                    label={t('options.pendoloShowCoverOnWatchFace')}
                    checked={resolvedTuning.showCoverOnWatchFace ?? false}
                    onChange={(next) => onPendoloTuningChange?.({ showCoverOnWatchFace: next })}
                />
                <ToggleRow
                    label={t('options.pendoloEnableLineGlow')}
                    checked={resolvedTuning.enableLineGlow ?? false}
                    onChange={(next) => onPendoloTuningChange?.({ enableLineGlow: next })}
                />
            </Group>
            <Group def={PENDOLO_RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={render}
                    onChange={(patch) => onPendoloTuningChange?.({ render: { ...render, ...patch } })}
                />
            </Group>
        </>
    );
};

export default PendoloSettingsPanel;
