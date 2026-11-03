import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, type StoredTuningFields } from '../tuningDefinition';
import { normalizeMachiTuning } from './machiTuning';
import { DEFAULT_MACHI_TUNING, MACHI_CAMERA_MODES, MACHI_DOF_LIMITS, MACHI_FOCUS_MODES, MACHI_MOTION_SPEED_LIMITS, MACHI_SCENE_IDS, MACHI_TIMES_OF_DAY, MACHI_WEATHERS, type MachiTuning } from './types';

// src/components/visualizer/machi/tuning.ts
// 町景的 tuning：默认值、在设置 store 里的字段、存在哪。渲染器经 read() 从 tuning 包里取（entry.tsx），没有具名 prop。

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'machiTuning', 'handleSetMachiTuning', 'handleResetMachiTuning', MachiTuning> {}
}

export default defineVisualizerTuning<MachiTuning>({
    mode: 'machi',
    defaults: DEFAULT_MACHI_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        scene: modChoice(['auto', ...MACHI_SCENE_IDS]),
        timeOfDay: modChoice(MACHI_TIMES_OF_DAY),
        weather: modChoice(MACHI_WEATHERS),
        camera: modChoice(MACHI_CAMERA_MODES),
        motion: MOD_SWITCH,
        motionSpeed: modNumber(MACHI_MOTION_SPEED_LIMITS.min, MACHI_MOTION_SPEED_LIMITS.max),
        aperture: modNumber(MACHI_DOF_LIMITS.aperture.min, MACHI_DOF_LIMITS.aperture.max),
        dof: modNumber(MACHI_DOF_LIMITS.dof.min, MACHI_DOF_LIMITS.dof.max),
        dofRange: modNumber(MACHI_DOF_LIMITS.dofRange.min, MACHI_DOF_LIMITS.dofRange.max),
        tiltShift: modNumber(MACHI_DOF_LIMITS.tiltShift.min, MACHI_DOF_LIMITS.tiltShift.max),
        focus: modChoice(MACHI_FOCUS_MODES),
        focusOffset: modNumber(MACHI_DOF_LIMITS.focusOffset.min, MACHI_DOF_LIMITS.focusOffset.max),
    },
    settingsKey: 'machiTuning',
    settingsSetterKey: 'handleSetMachiTuning',
    settingsResetterKey: 'handleResetMachiTuning',
    storage: {
        key: 'machi_tuning',
        read: normalizeMachiTuning,
        // 先合并再归一化：设置面板、导入、同步、Folium 走同一套校验。
        merge: (held, patch) => normalizeMachiTuning({ ...held, ...patch }),
        resetNotice: 'notifications.machiReset',
    },
});
