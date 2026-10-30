import { numberWithin } from '../tuningDefinition';
import { hashVisualizerSeed } from '../visualizerSeedHash';
import {
    DEFAULT_MACHI_QUALITY,
    DEFAULT_MACHI_TUNING,
    DEFAULT_MACHI_VIEW,
    DEFAULT_MACHI_VIEWS,
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
    type MachiCameraView,
    type MachiQuality,
    type MachiQualityPresetId,
    type MachiSceneId,
    type MachiTuning,
} from './types';

// src/components/visualizer/machi/machiTuning.ts
// 町景 tuning 的归一化：存档、导入、同步、设置面板都经 normalizeMachiTuning 补齐字段、认不得的值回默认
// （以后删掉的场景也回“自动”），数值夹进各自的范围。“自动”场景按 seed 选也在这里（纯函数，运行时与单测共用）。

const SCENE_CHOICES: MachiTuning['scene'][] = ['auto', ...MACHI_SCENE_IDS];

/** 自定义视角：每项夹进范围，缺的、坏的回默认。 */
export const normalizeMachiView = (raw: unknown): MachiCameraView => {
    const input = raw && typeof raw === 'object' ? raw as Partial<Record<keyof MachiCameraView, unknown>> : {};
    const field = (key: keyof MachiCameraView) => numberWithin(input[key], DEFAULT_MACHI_VIEW[key], MACHI_VIEW_LIMITS[key].min, MACHI_VIEW_LIMITS[key].max);
    return { azimuth: field('azimuth'), elevation: field('elevation'), zoom: field('zoom'), panX: field('panX'), panZ: field('panZ') };
};

/**
 * 各场景的自定义视角：每个场景按 normalizeMachiView 补齐。以前三个场景共用一份 view：没有 views 时拿它给每个场景。
 */
export const normalizeMachiViews = (raw: unknown, legacy?: unknown): Record<MachiSceneId, MachiCameraView> => {
    const input = raw && typeof raw === 'object' ? raw as Partial<Record<MachiSceneId, unknown>> : null;
    if (!input && legacy === undefined) return DEFAULT_MACHI_VIEWS;
    return Object.fromEntries(MACHI_SCENE_IDS.map(id => [id, normalizeMachiView(input ? input[id] : legacy)])) as Record<MachiSceneId, MachiCameraView>;
};

/** 画质：每项认得的值留下，缺的、坏的回默认。 */
export const normalizeMachiQuality = (raw: unknown): MachiQuality => {
    const input = raw && typeof raw === 'object' ? raw as Partial<Record<keyof MachiQuality, unknown>> : {};
    const d = DEFAULT_MACHI_QUALITY;
    const pick = <T>(choices: readonly T[], value: unknown, fallback: T): T => (choices.includes(value as T) ? value as T : fallback);
    return {
        renderScale: pick(MACHI_RENDER_SCALES, input.renderScale, d.renderScale),
        antialias: pick(MACHI_ANTIALIAS_MODES, input.antialias, d.antialias),
        shadows: pick(MACHI_DETAIL_LEVELS, input.shadows, d.shadows),
        reflections: pick(MACHI_DETAIL_LEVELS, input.reflections, d.reflections),
        glow: typeof input.glow === 'boolean' ? input.glow : d.glow,
        adaptive: typeof input.adaptive === 'boolean' ? input.adaptive : d.adaptive,
    };
};

/** 这套画质是哪一档预设（细项和某一档完全一样才算），不是就是自定义。 */
export const resolveMachiQualityPreset = (quality: MachiQuality): MachiQualityPresetId | 'custom' => (
    MACHI_QUALITY_PRESET_IDS.find(id => {
        const preset = MACHI_QUALITY_PRESETS[id];
        return (Object.keys(preset) as (keyof typeof preset)[]).every(key => preset[key] === quality[key]);
    }) ?? 'custom'
);

/** 任何存下来的值 → 完整、合法的 tuning。 */
export const normalizeMachiTuning = (raw: unknown): MachiTuning => {
    const stored = raw && typeof raw === 'object' ? raw as Partial<MachiTuning> & { view?: unknown } : {};
    const input = { ...DEFAULT_MACHI_TUNING, ...stored };
    const d = DEFAULT_MACHI_TUNING;
    const within = (key: keyof typeof MACHI_DOF_LIMITS) => numberWithin(input[key], d[key], MACHI_DOF_LIMITS[key].min, MACHI_DOF_LIMITS[key].max);
    return {
        scene: SCENE_CHOICES.includes(input.scene) ? input.scene : d.scene,
        timeOfDay: MACHI_TIMES_OF_DAY.includes(input.timeOfDay) ? input.timeOfDay : d.timeOfDay,
        weather: MACHI_WEATHERS.includes(input.weather) ? input.weather : d.weather,
        camera: MACHI_CAMERA_MODES.includes(input.camera) ? input.camera : d.camera,
        views: normalizeMachiViews(stored.views, stored.view),
        motion: typeof input.motion === 'boolean' ? input.motion : d.motion,
        motionSpeed: numberWithin(input.motionSpeed, d.motionSpeed, MACHI_MOTION_SPEED_LIMITS.min, MACHI_MOTION_SPEED_LIMITS.max),
        aperture: within('aperture'),
        dof: within('dof'),
        dofRange: within('dofRange'),
        tiltShift: within('tiltShift'),
        focus: MACHI_FOCUS_MODES.includes(input.focus) ? input.focus : d.focus,
        focusOffset: within('focusOffset'),
        quality: normalizeMachiQuality(input.quality),
    };
};

/** 这首歌画哪个场景：选了就用选的，“自动”按 seed 在所有场景里挑一个（同一首歌总是同一个）。 */
export const resolveMachiSceneId = (tuning: Pick<MachiTuning, 'scene'>, seed: string | number): MachiSceneId => {
    if (tuning.scene !== 'auto') return tuning.scene;
    return MACHI_SCENE_IDS[hashVisualizerSeed(`machi-scene:${seed}`) % MACHI_SCENE_IDS.length]!;
};
