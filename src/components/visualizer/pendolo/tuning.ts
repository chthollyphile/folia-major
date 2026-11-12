import { DEFAULT_PENDOLO_TUNING, type PendoloTuning } from '../../../types';
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { PENDOLO_HUB_VIEW_BACK_MAX, PENDOLO_HUB_VIEW_BACK_MIN, PENDOLO_HUB_VIEW_HEIGHT_MAX, PENDOLO_HUB_VIEW_HEIGHT_MIN, PENDOLO_TILT_LIMIT_DEG } from './pendoloDialProjection';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, numberWithin, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/pendolo/tuning.ts
// Pendolo's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'pendoloTuning', 'handleSetPendoloTuning', 'handleResetPendoloTuning', PendoloTuning> {}
}

/** The tuning `values` ask for, with `base` where they say nothing or something that cannot be: every number inside its range. */
const resolve = (values: Partial<PendoloTuning>, base: PendoloTuning): PendoloTuning => ({
    // 分辨率与抗锯齿（#929）：旧存档没有这一项，就是全跟随全局；不认识的值回到「跟随全局」。
    render: values.render === undefined ? base.render ?? DEFAULT_PENDOLO_TUNING.render : normalizeLyricRenderOverride(values.render),
    arcRadius: numberWithin(values.arcRadius, base.arcRadius, 0.25, 0.80),
    arcAngleDeg: numberWithin(values.arcAngleDeg, base.arcAngleDeg, 40, 160),
    wheelCenterX: numberWithin(values.wheelCenterX, base.wheelCenterX, -0.30, 0.50),
    wheelCenterY: numberWithin(values.wheelCenterY, base.wheelCenterY, 0.20, 0.80),
    tickSnappiness: numberWithin(values.tickSnappiness, base.tickSnappiness, 0.5, 2.0),
    activeScale: numberWithin(values.activeScale, base.activeScale, 1.00, 1.60),
    showGearDecor: values.showGearDecor === 'none' || values.showGearDecor === 'subtle' || values.showGearDecor === 'full'
        ? values.showGearDecor
        : base.showGearDecor,
    showCenterGradient: typeof values.showCenterGradient === 'boolean'
        ? values.showCenterGradient
        : base.showCenterGradient ?? DEFAULT_PENDOLO_TUNING.showCenterGradient,
    showCoverOnWatchFace: typeof values.showCoverOnWatchFace === 'boolean'
        ? values.showCoverOnWatchFace
        : base.showCoverOnWatchFace ?? DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
    enableLineGlow: typeof values.enableLineGlow === 'boolean'
        ? values.enableLineGlow
        : base.enableLineGlow ?? DEFAULT_PENDOLO_TUNING.enableLineGlow,
    mirrorLayout: typeof values.mirrorLayout === 'boolean'
        ? values.mirrorLayout
        : base.mirrorLayout ?? DEFAULT_PENDOLO_TUNING.mirrorLayout,
    tiltDeg: numberWithin(values.tiltDeg, base.tiltDeg ?? 0, -PENDOLO_TILT_LIMIT_DEG, PENDOLO_TILT_LIMIT_DEG),
    tiltAxisDeg: numberWithin(values.tiltAxisDeg, base.tiltAxisDeg ?? 0, -90, 90),
    parallaxDepth: numberWithin(values.parallaxDepth, base.parallaxDepth ?? DEFAULT_PENDOLO_TUNING.parallaxDepth ?? 1, 0, 2),
    hubView: typeof values.hubView === 'boolean'
        ? values.hubView
        : base.hubView ?? DEFAULT_PENDOLO_TUNING.hubView,
    hubViewHeight: numberWithin(
        values.hubViewHeight,
        base.hubViewHeight ?? DEFAULT_PENDOLO_TUNING.hubViewHeight ?? 1.4,
        PENDOLO_HUB_VIEW_HEIGHT_MIN,
        PENDOLO_HUB_VIEW_HEIGHT_MAX,
    ),
    hubViewBack: numberWithin(
        values.hubViewBack,
        base.hubViewBack ?? DEFAULT_PENDOLO_TUNING.hubViewBack ?? 1.2,
        PENDOLO_HUB_VIEW_BACK_MIN,
        PENDOLO_HUB_VIEW_BACK_MAX,
    ),
});

export default defineVisualizerTuning<PendoloTuning>({
    mode: 'pendolo',
    defaults: DEFAULT_PENDOLO_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        wheelCenterX: modNumber(-0.2, 0.4),
        arcRadius: modNumber(0.25, 0.8),
        arcAngleDeg: modNumber(40, 160),
        tickSnappiness: modNumber(0.5, 2),
        activeScale: modNumber(1, 1.6),
        showGearDecor: modChoice(['none', 'subtle', 'full']),
        showCenterGradient: MOD_SWITCH,
        showCoverOnWatchFace: MOD_SWITCH,
        enableLineGlow: MOD_SWITCH,
        mirrorLayout: MOD_SWITCH,
        tiltDeg: modNumber(-PENDOLO_TILT_LIMIT_DEG, PENDOLO_TILT_LIMIT_DEG),
        tiltAxisDeg: modNumber(-90, 90),
        parallaxDepth: modNumber(0, 2),
        hubView: MOD_SWITCH,
        hubViewHeight: modNumber(PENDOLO_HUB_VIEW_HEIGHT_MIN, PENDOLO_HUB_VIEW_HEIGHT_MAX),
        hubViewBack: modNumber(PENDOLO_HUB_VIEW_BACK_MIN, PENDOLO_HUB_VIEW_BACK_MAX),
    },
    settingsKey: 'pendoloTuning',
    settingsSetterKey: 'handleSetPendoloTuning',
    settingsResetterKey: 'handleResetPendoloTuning',
    storage: {
        key: 'pendolo_tuning',
        read: (stored: Partial<PendoloTuning>) => resolve(stored, DEFAULT_PENDOLO_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.pendoloReset',
    },
    apply: (props, tuning) => ({ ...props, pendoloTuning: tuning }),
});
