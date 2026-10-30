import React from 'react';
import { Button, Group, PictureGrid, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import { percent, SliderRow, times, ToggleRow } from '../panelRows';
import {
    apertureReadout,
    MACHI_APERTURE_TRACK_MAX,
    MACHI_CAMERA_LABEL_KEYS,
    MACHI_FOCUS_LABEL_KEYS,
    MACHI_VIEW_SLIDERS,
    machiApertureFromTrack,
    machiApertureToTrack,
    signedReadout,
} from './cameraControls';
import { resolveMachiQualityPreset } from './machiTuning';
import { getMachiShownScene, subscribeMachiShownScene } from './shownScene';
import {
    DEFAULT_MACHI_TUNING,
    DEFAULT_MACHI_VIEW,
    MACHI_ANTIALIAS_MODES,
    MACHI_CAMERA_MODES,
    MACHI_DETAIL_LEVELS,
    MACHI_DOF_LIMITS,
    MACHI_FOCUS_MODES,
    MACHI_MOTION_SPEED_LIMITS,
    MACHI_QUALITY_PRESET_IDS,
    MACHI_QUALITY_PRESETS,
    MACHI_RENDER_SCALES,
    MACHI_SCENE_IDS,
    MACHI_TIMES_OF_DAY,
    MACHI_VIEW_LIMITS,
    MACHI_WEATHERS,
    type MachiAntialias,
    type MachiCameraMode,
    type MachiCameraView,
    type MachiDetailLevel,
    type MachiFocusMode,
    type MachiQuality,
    type MachiQualityPresetId,
    type MachiSceneId,
    type MachiTimeOfDay,
    type MachiTuning,
    type MachiWeather,
} from './types';

// src/components/visualizer/machi/MachiSettingsPanel.tsx
// 町景的设置面板：场景（线稿小图，不放实时预览）、时间、天气三项，每项都有“自动”；镜头（默认视角，或自定义视角
// 与它的五个滑块，每个场景各一份：场景“自动”时多一排选调哪个场景的，默认是正在画的那个；运镜开关与快慢）；景深（光圈、强度、清晰范围、移轴、对焦在哪）；画质（高 / 平衡 / 低三套预设和各个细项，细项和哪套都对不上
// 就多出一个选中的“自定义”，预设不单独存）。快捷控件里的胶囊和播放页的取景控制条用同一套文案（cameraControls.ts）。

const SCENE_GROUP: SettingsGroupDef = { id: 'vis-machi-scene', titleKey: 'options.machiSceneSection' };
const SKY_GROUP: SettingsGroupDef = { id: 'vis-machi-sky', titleKey: 'options.machiSkySection' };
const CAMERA_GROUP: SettingsGroupDef = { id: 'vis-machi-camera', titleKey: 'options.machiCameraSection' };
const DOF_GROUP: SettingsGroupDef = { id: 'vis-machi-dof', titleKey: 'options.machiDofSection' };
const QUALITY_GROUP: SettingsGroupDef = { id: 'vis-machi-quality', titleKey: 'options.machiQualitySection' };

const QUALITY_PRESET_LABEL_KEYS: Record<MachiQualityPresetId, string> = {
    high: 'options.machiQualityHigh',
    balanced: 'options.machiQualityBalanced',
    low: 'options.machiQualityLow',
};

const ANTIALIAS_LABEL_KEYS: Record<MachiAntialias, string> = {
    off: 'options.machiAntialiasOff',
    fxaa: 'options.machiAntialiasFxaa',
    smaa: 'options.machiAntialiasSmaa',
    ssaa: 'options.machiAntialiasSsaa',
};

const LEVEL_LABEL_KEYS: Record<MachiDetailLevel, string> = {
    off: 'options.machiLevelOff',
    low: 'options.machiLevelLow',
    high: 'options.machiLevelHigh',
};

export const MACHI_SCENE_CHOICES: MachiTuning['scene'][] = ['auto', ...MACHI_SCENE_IDS];

export const MACHI_SCENE_LABEL_KEYS: Record<MachiTuning['scene'], string> = {
    auto: 'options.machiSceneAuto',
    konbini: 'options.machiSceneKonbini',
    station: 'options.machiSceneStation',
    kowloon: 'options.machiSceneKowloon',
};

export const MACHI_TIME_LABEL_KEYS: Record<MachiTimeOfDay, string> = {
    auto: 'options.machiTimeAuto',
    day: 'options.machiTimeDay',
    dusk: 'options.machiTimeDusk',
    night: 'options.machiTimeNight',
};

export const MACHI_WEATHER_LABEL_KEYS: Record<MachiWeather, string> = {
    auto: 'options.machiWeatherAuto',
    clear: 'options.machiWeatherClear',
    rain: 'options.machiWeatherRain',
    snow: 'options.machiWeatherSnow',
    fog: 'options.machiWeatherFog',
};

/** 场景的线稿小图（24×24 的路径，跟着面板文字色）。 */
const SCENE_GLYPHS: Record<MachiTuning['scene'], React.ReactNode> = {
    // 自动：两道交错的箭头（随机）
    auto: (
        <>
            <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
            <path d="m18 2 4 4-4 4" />
            <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" opacity="0.6" />
            <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" opacity="0.6" />
            <path d="m18 14 4 4-4 4" />
        </>
    ),
    // 便利店：一间小店，屋顶一块牌子
    konbini: (
        <>
            <path d="M4 20V11h13v9" />
            <path d="M7 11V7.5h7V11" opacity="0.6" />
            <path d="M9.5 20v-4.5h3V20" opacity="0.6" />
            <path d="M3 20h18" />
        </>
    ),
    // 加油站：罩棚、一台加油机，旁边停着一辆车
    station: (
        <>
            <path d="M3 8h13" />
            <path d="M5 8v12M14 8v12" opacity="0.6" />
            <path d="M8 20v-6h3v6" />
            <path d="M15 20v-3.5l1.5-2h4.5v5.5" opacity="0.7" />
            <path d="M3 20h19" />
        </>
    ),
    // 城寨酒吧：高低错落的楼、楼顶一根天线，楼面伸出一块竖招牌
    kowloon: (
        <>
            <path d="M3 20V9h5v11M8 20V5h6v15M14 20v-8h6v8" />
            <path d="M11 5V2.5M9.5 3.5h3" opacity="0.6" />
            <path d="M14 7h1M15 6h2.5v4.5H15z" opacity="0.7" />
            <path d="M3 20h18" />
        </>
    ),
};

const scenePicture = (scene: MachiTuning['scene']) => (
    <span className="absolute inset-0 flex items-center justify-center text-[color:var(--st-t2)]">
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {SCENE_GLYPHS[scene]}
        </svg>
    </span>
);

const MachiSettingsPanel: React.FC<VisualizerSettingsPanelProps<MachiTuning>> = ({
    t,
    tuning = DEFAULT_MACHI_TUNING,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const custom = tuning.camera === 'custom';
    // 滑块调哪个场景的视角：选定了场景就是它；“自动”时默认是正在画的那个，也可以自己挑。
    const shownScene = React.useSyncExternalStore(subscribeMachiShownScene, getMachiShownScene, getMachiShownScene);
    const [pickedScene, setPickedScene] = React.useState<MachiSceneId | null>(null);
    const viewScene = tuning.scene !== 'auto' ? tuning.scene : pickedScene ?? shownScene ?? MACHI_SCENE_IDS[0];
    const view = tuning.views[viewScene];
    const setView = (next: MachiCameraView) => onTuningChange?.({ views: { ...tuning.views, [viewScene]: next } });
    const quality = tuning.quality;
    const preset = resolveMachiQualityPreset(quality);
    const setQuality = (patch: Partial<MachiQuality>) => onTuningChange?.({ quality: { ...quality, ...patch } });
    const levels = MACHI_DETAIL_LEVELS.map(level => ({ value: level, label: t(LEVEL_LABEL_KEYS[level]) }));
    return (
        <>
            <Group def={SCENE_GROUP}>
                <Row
                    note={t('options.machiSceneHint')}
                    below={(
                        <PictureGrid<MachiTuning['scene']>
                            className="-mx-4"
                            columns={3}
                            label={t('options.machiScene')}
                            value={tuning.scene}
                            options={MACHI_SCENE_CHOICES.map(scene => ({ value: scene, label: t(MACHI_SCENE_LABEL_KEYS[scene]) }))}
                            picture={scenePicture}
                            onChange={scene => onTuningChange?.({ scene })}
                        />
                    )}
                />
            </Group>

            <Group def={SKY_GROUP}>
                <Row label={t('options.machiTimeOfDay')} note={t('options.machiTimeOfDayHint')}>
                    <Segmented<MachiTimeOfDay>
                        value={tuning.timeOfDay}
                        options={MACHI_TIMES_OF_DAY.map(time => ({ value: time, label: t(MACHI_TIME_LABEL_KEYS[time]) }))}
                        onChange={timeOfDay => onTuningChange?.({ timeOfDay })}
                    />
                </Row>
                <Row label={t('options.machiWeather')} note={t('options.machiWeatherHint')}>
                    <Segmented<MachiWeather>
                        value={tuning.weather}
                        options={MACHI_WEATHERS.map(weather => ({ value: weather, label: t(MACHI_WEATHER_LABEL_KEYS[weather]) }))}
                        onChange={weather => onTuningChange?.({ weather })}
                    />
                </Row>
            </Group>

            <Group
                def={CAMERA_GROUP}
                action={custom ? (
                    <Button variant="quiet" onClick={() => setView(DEFAULT_MACHI_VIEW)}>
                        {t('options.machiViewReset')}
                    </Button>
                ) : undefined}
            >
                <Row label={t('options.machiCameraMode')} note={t('options.machiCameraModeHint')}>
                    <Segmented<MachiCameraMode>
                        value={tuning.camera}
                        options={MACHI_CAMERA_MODES.map(mode => ({ value: mode, label: t(MACHI_CAMERA_LABEL_KEYS[mode]) }))}
                        onChange={camera => onTuningChange?.({ camera })}
                    />
                </Row>
                {custom && tuning.scene === 'auto' && (
                    <Row label={t('options.machiViewScene')} note={t('options.machiViewSceneHint')}>
                        <Segmented<MachiSceneId>
                            value={viewScene}
                            options={MACHI_SCENE_IDS.map(scene => ({ value: scene, label: t(MACHI_SCENE_LABEL_KEYS[scene]) }))}
                            onChange={setPickedScene}
                        />
                    </Row>
                )}
                {custom && MACHI_VIEW_SLIDERS.map(slider => (
                    <SliderRow
                        key={slider.key}
                        label={t(slider.labelKey)}
                        value={view[slider.key]}
                        min={MACHI_VIEW_LIMITS[slider.key].min}
                        max={MACHI_VIEW_LIMITS[slider.key].max}
                        step={slider.step}
                        format={slider.format}
                        onChange={value => setView({ ...view, [slider.key]: value })}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                ))}
                <ToggleRow
                    label={t('options.machiCameraMotion')}
                    note={t('options.machiCameraMotionHint')}
                    checked={tuning.motion}
                    onChange={motion => onTuningChange?.({ motion })}
                />
                <SliderRow
                    label={t('options.machiCameraMotionSpeed')}
                    value={tuning.motionSpeed}
                    min={MACHI_MOTION_SPEED_LIMITS.min}
                    max={MACHI_MOTION_SPEED_LIMITS.max}
                    step={0.05}
                    format={times}
                    disabled={!tuning.motion}
                    onChange={motionSpeed => onTuningChange?.({ motionSpeed })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
            </Group>

            <Group def={DOF_GROUP}>
                {/* 光圈按档走（往右光圈越大），存的是 f 值。 */}
                <SliderRow
                    label={t('options.machiAperture')}
                    note={t('options.machiApertureHint')}
                    value={machiApertureToTrack(tuning.aperture)}
                    min={0}
                    max={MACHI_APERTURE_TRACK_MAX}
                    step={1}
                    format={index => apertureReadout(machiApertureFromTrack(index))}
                    disabled={tuning.dof === 0}
                    onChange={index => onTuningChange?.({ aperture: machiApertureFromTrack(index) })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <SliderRow
                    label={t('options.machiDof')}
                    note={t('options.machiDofHint')}
                    value={tuning.dof}
                    min={MACHI_DOF_LIMITS.dof.min}
                    max={MACHI_DOF_LIMITS.dof.max}
                    step={0.05}
                    format={percent}
                    onChange={dof => onTuningChange?.({ dof })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <SliderRow
                    label={t('options.machiDofRange')}
                    value={tuning.dofRange}
                    min={MACHI_DOF_LIMITS.dofRange.min}
                    max={MACHI_DOF_LIMITS.dofRange.max}
                    step={0.05}
                    format={times}
                    disabled={tuning.dof === 0}
                    onChange={dofRange => onTuningChange?.({ dofRange })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <SliderRow
                    label={t('options.machiTiltShift')}
                    note={t('options.machiTiltShiftHint')}
                    value={tuning.tiltShift}
                    min={MACHI_DOF_LIMITS.tiltShift.min}
                    max={MACHI_DOF_LIMITS.tiltShift.max}
                    step={0.05}
                    format={percent}
                    onChange={tiltShift => onTuningChange?.({ tiltShift })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <Row label={t('options.machiFocus')} note={t('options.machiFocusHint')}>
                    <Segmented<MachiFocusMode>
                        value={tuning.focus}
                        options={MACHI_FOCUS_MODES.map(focus => ({ value: focus, label: t(MACHI_FOCUS_LABEL_KEYS[focus]) }))}
                        onChange={focus => onTuningChange?.({ focus })}
                    />
                </Row>
                {tuning.focus === 'manual' && (
                    <SliderRow
                        label={t('options.machiFocusOffset')}
                        value={tuning.focusOffset}
                        min={MACHI_DOF_LIMITS.focusOffset.min}
                        max={MACHI_DOF_LIMITS.focusOffset.max}
                        step={0.1}
                        format={signedReadout(' m', 1)}
                        onChange={focusOffset => onTuningChange?.({ focusOffset })}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                )}
            </Group>

            <Group def={QUALITY_GROUP}>
                <Row label={t('options.machiQuality')} note={t('options.machiQualityHint')}>
                    {/* “自定义”只在细项和哪档都对不上时出现（选中的那一项，点它没有动作）。 */}
                    <Segmented<MachiQualityPresetId | 'custom'>
                        value={preset}
                        options={[
                            ...MACHI_QUALITY_PRESET_IDS.map(id => ({ value: id, label: t(QUALITY_PRESET_LABEL_KEYS[id]) })),
                            ...(preset === 'custom' ? [{ value: 'custom' as const, label: t('options.machiQualityCustom') }] : []),
                        ]}
                        onChange={id => { if (id !== 'custom') setQuality(MACHI_QUALITY_PRESETS[id]); }}
                    />
                </Row>
                <Row label={t('options.machiRenderScale')} note={t('options.machiRenderScaleHint')}>
                    <Segmented<string>
                        value={String(quality.renderScale)}
                        options={MACHI_RENDER_SCALES.map(scale => ({ value: String(scale), label: `${Math.round(scale * 100)}%` }))}
                        onChange={value => setQuality({ renderScale: MACHI_RENDER_SCALES.find(scale => String(scale) === value) ?? quality.renderScale })}
                    />
                </Row>
                <Row label={t('options.machiAntialias')} note={t('options.machiAntialiasHint')}>
                    <Segmented<MachiAntialias>
                        value={quality.antialias}
                        options={MACHI_ANTIALIAS_MODES.map(mode => ({ value: mode, label: t(ANTIALIAS_LABEL_KEYS[mode]) }))}
                        onChange={antialias => setQuality({ antialias })}
                    />
                </Row>
                <Row label={t('options.machiShadows')} note={t('options.machiShadowsHint')}>
                    <Segmented<MachiDetailLevel> value={quality.shadows} options={levels} onChange={shadows => setQuality({ shadows })} />
                </Row>
                <Row label={t('options.machiReflections')} note={t('options.machiReflectionsHint')}>
                    <Segmented<MachiDetailLevel> value={quality.reflections} options={levels} onChange={reflections => setQuality({ reflections })} />
                </Row>
                <ToggleRow
                    label={t('options.machiGlow')}
                    note={t('options.machiGlowHint')}
                    checked={quality.glow}
                    onChange={glow => setQuality({ glow })}
                />
                <ToggleRow
                    label={t('options.machiAdaptive')}
                    note={t('options.machiAdaptiveHint')}
                    checked={quality.adaptive}
                    onChange={adaptive => setQuality({ adaptive })}
                />
            </Group>
        </>
    );
};

export default MachiSettingsPanel;
