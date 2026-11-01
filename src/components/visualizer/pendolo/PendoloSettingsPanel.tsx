import React from 'react';
import { DEFAULT_PENDOLO_TUNING, type PendoloTuning } from '../../../types';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import { percent, SliderRow, times, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';

// src/components/visualizer/pendolo/PendoloSettingsPanel.tsx
// Owns Pendolo-specific tuning controls, drawn as groups of the settings kit.
const PENDOLO_GROUP: SettingsGroupDef = { id: 'vis-pendolo', titleKey: 'options.pendoloSettings' };
// 渲染（#929）：齿轮画布的分辨率与抗锯齿（WebGL 的 MSAA），默认跟随全局
const PENDOLO_RENDER_GROUP: SettingsGroupDef = { id: 'vis-pendolo-render', titleKey: 'options.lyricRenderSection' };

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

    return (
        <>
            <Group def={PENDOLO_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.pendoloWheelCenterX')}
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
