// src/components/visualizer/machi/types.ts
// 町景的 tuning：哪个场景、什么时间、什么天气（三项都可以是“自动”：场景和天气按歌的 seed 选，时间跟本地时钟走），
// 镜头（默认构图，或固定在自己调的视角上，每个场景各存一份；可以开着缓慢的运镜，快慢可调）与景深（光圈、强弱、清晰范围、移轴、对焦在哪），以及画质（分辨率、抗锯齿、阴影、
// 倒影、辉光、自动降级；面板上的高 / 平衡 / 低只是几套细项，不单独存）。

/** 场景：便利店街角、加油站停车场、城寨酒吧。 */
export const MACHI_SCENE_IDS = ['konbini', 'station', 'kowloon'] as const;
export type MachiSceneId = typeof MACHI_SCENE_IDS[number];

export const MACHI_TIMES_OF_DAY = ['auto', 'day', 'dusk', 'night'] as const;
export type MachiTimeOfDay = typeof MACHI_TIMES_OF_DAY[number];

export const MACHI_WEATHERS = ['auto', 'clear', 'rain', 'snow', 'fog'] as const;
export type MachiWeather = typeof MACHI_WEATHERS[number];

/** 镜头：默认构图（拖动后过一会儿自己回正），或固定在自定义视角上（拖动后就停在那里并记住，每个场景各一份）。 */
export const MACHI_CAMERA_MODES = ['default', 'custom'] as const;
export type MachiCameraMode = typeof MACHI_CAMERA_MODES[number];

/** 对焦在哪：画面中心（镜头绕着转的那一点）、场景里的歌词屏、手动（画面中心往前往后挪）。 */
export const MACHI_FOCUS_MODES = ['center', 'lyrics', 'manual'] as const;
export type MachiFocusMode = typeof MACHI_FOCUS_MODES[number];

/**
 * 自定义视角，相对场景的默认构图：水平转角与俯仰（度）、远近（默认缩放的倍数）、沿地面平移（米：左右、前后，
 * 按默认朝向）。每个场景各存一份。
 */
export interface MachiCameraView {
    azimuth: number;
    elevation: number;
    zoom: number;
    panX: number;
    panZ: number;
}

/** 自定义视角各项的范围（设置面板的滑块与归一化共用）。 */
export const MACHI_VIEW_LIMITS = {
    azimuth: { min: -75, max: 75 },
    elevation: { min: -12, max: 40 },
    zoom: { min: 0.5, max: 2.8 },
    panX: { min: -5, max: 5 },
    panZ: { min: -5, max: 5 },
} as const satisfies Record<keyof MachiCameraView, { min: number; max: number }>;

/**
 * 景深各项的范围：光圈（f 值：越小光圈越大，清晰的那一层越薄、焦外越虚，灯光虚成圆形光斑；f/8 是原来的微缩感）、
 * 强度（0 关，1 是默认，到 2 更虚）、清晰范围的倍数、移轴、手动对焦的前后（米）。
 */
export const MACHI_DOF_LIMITS = {
    aperture: { min: 1.4, max: 16 },
    dof: { min: 0, max: 2 },
    dofRange: { min: 0.3, max: 3 },
    tiltShift: { min: 0, max: 1 },
    focusOffset: { min: -10, max: 10 },
} as const;

/** 光圈的几档（f 值，相邻两档进光量差一倍）：滑块按档走，存的是 f 值。 */
export const MACHI_APERTURE_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16] as const;

/** 运镜速度的范围（倍数，1 是原来的快慢）。 */
export const MACHI_MOTION_SPEED_LIMITS = { min: 0.25, max: 3 } as const;

/** 渲染分辨率：屏幕像素的几成（高 DPI 屏上最多按 2 倍 CSS 像素算）。 */
export const MACHI_RENDER_SCALES = [1, 0.75, 0.5] as const;
export type MachiRenderScale = typeof MACHI_RENDER_SCALES[number];

/** 抗锯齿：关、FXAA（最省）、SMAA（几何边缘 MSAA，墨线与雨丝后期 SMAA）、超采样（按 2 倍分辨率画再缩回来）。 */
export const MACHI_ANTIALIAS_MODES = ['off', 'fxaa', 'smaa', 'ssaa'] as const;
export type MachiAntialias = typeof MACHI_ANTIALIAS_MODES[number];

/** 阴影、倒影的档：关、低、高。 */
export const MACHI_DETAIL_LEVELS = ['off', 'low', 'high'] as const;
export type MachiDetailLevel = typeof MACHI_DETAIL_LEVELS[number];

export interface MachiQuality {
    renderScale: MachiRenderScale;
    antialias: MachiAntialias;
    /** 月光 / 太阳的阴影图：关、1024、2048。 */
    shadows: MachiDetailLevel;
    /** 湿路面的倒影贴图：关、0.3、0.5 倍分辨率。 */
    reflections: MachiDetailLevel;
    /** bloom 与横向镜头光条。 */
    glow: boolean;
    /** 帧时长期偏高时在这套设置之下逐步降低（不会高过这套设置）。 */
    adaptive: boolean;
}

export const MACHI_QUALITY_PRESET_IDS = ['high', 'balanced', 'low'] as const;
export type MachiQualityPresetId = typeof MACHI_QUALITY_PRESET_IDS[number];

/** 面板上的三档：每档是一套细项（自动降级不归预设管）。 */
export const MACHI_QUALITY_PRESETS: Record<MachiQualityPresetId, Omit<MachiQuality, 'adaptive'>> = {
    high: { renderScale: 1, antialias: 'smaa', shadows: 'high', reflections: 'high', glow: true },
    balanced: { renderScale: 1, antialias: 'fxaa', shadows: 'low', reflections: 'low', glow: true },
    low: { renderScale: 0.75, antialias: 'off', shadows: 'off', reflections: 'off', glow: false },
};

export const DEFAULT_MACHI_QUALITY: MachiQuality = { ...MACHI_QUALITY_PRESETS.high, adaptive: true };

export interface MachiTuning {
    scene: 'auto' | MachiSceneId;
    timeOfDay: MachiTimeOfDay;
    weather: MachiWeather;
    camera: MachiCameraMode;
    /** 各场景的自定义视角。 */
    views: Record<MachiSceneId, MachiCameraView>;
    /** 运镜：镜头在静止位置附近缓慢地转、推拉、平移（随歌曲暂停）。 */
    motion: boolean;
    /** 运镜的快慢（倍数）。 */
    motionSpeed: number;
    /** 光圈（f 值）。 */
    aperture: number;
    dof: number;
    dofRange: number;
    tiltShift: number;
    focus: MachiFocusMode;
    focusOffset: number;
    quality: MachiQuality;
}

export const DEFAULT_MACHI_VIEW: MachiCameraView = { azimuth: 0, elevation: 0, zoom: 1, panX: 0, panZ: 0 };

export const DEFAULT_MACHI_VIEWS: Record<MachiSceneId, MachiCameraView> = {
    konbini: DEFAULT_MACHI_VIEW,
    station: DEFAULT_MACHI_VIEW,
    kowloon: DEFAULT_MACHI_VIEW,
};

export const DEFAULT_MACHI_TUNING: MachiTuning = {
    scene: 'auto',
    timeOfDay: 'auto',
    weather: 'auto',
    camera: 'default',
    views: DEFAULT_MACHI_VIEWS,
    motion: false,
    motionSpeed: 1,
    aperture: 8,
    dof: 1,
    dofRange: 1,
    tiltShift: 0.3,
    focus: 'center',
    focusOffset: 0,
    quality: DEFAULT_MACHI_QUALITY,
};
