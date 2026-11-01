import { visualizerHash01, hashVisualizerSeed } from '../../visualizerSeedHash';
import type { MachiTimeOfDay, MachiWeather } from '../types';

// src/components/visualizer/machi/engine/environment.ts
// 时间与天气（纯函数，三个场景共用）：设置 → 环境目标（白天程度、雨 / 雪 / 雾），再按真实时间阻尼地追过去，
// 所以换天气、天黑天亮都是渐变的；地面的湿度和积雪比降水本身慢（雨停了路面过一阵才干，雪积起来要一会儿）。
// 再由环境状态推出灯光、后处理这些标量（日光强度与方向、人造光、bloom、云量、星星、雾气）。

export type MachiWeatherKind = Exclude<MachiWeather, 'auto'>;

/** 白天程度：0 夜，约 0.45 黄昏，1 白天。 */
export const MACHI_DAYLIGHT = { night: 0, dusk: 0.45, day: 1 } as const;

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/**
 * 本地时钟 → 白天程度：05:00–06:30 天亮，06:30–16:30 白天，16:30–17:30 落到黄昏，17:30–18:30 入夜。
 * hour 是带小数的小时（0..24）。
 */
export const resolveMachiDaylightAt = (hour: number) => {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 5 && h < 6.5) return smoothstep(5, 6.5, h);
    if (h >= 6.5 && h < 16.5) return 1;
    if (h >= 16.5 && h < 17.5) return 1 - (1 - MACHI_DAYLIGHT.dusk) * smoothstep(16.5, 17.5, h);
    if (h >= 17.5 && h < 18.5) return MACHI_DAYLIGHT.dusk * (1 - smoothstep(17.5, 18.5, h));
    return 0;
};

export const resolveMachiDaylight = (timeOfDay: MachiTimeOfDay, now: Date) => (
    timeOfDay === 'auto'
        ? resolveMachiDaylightAt(now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600)
        : MACHI_DAYLIGHT[timeOfDay]
);

/** “自动”天气按 seed 加权：雨 35%、晴 30%、雾 20%、雪 15%。 */
const AUTO_WEATHER: [MachiWeatherKind, number][] = [['rain', 0.35], ['clear', 0.3], ['fog', 0.2], ['snow', 0.15]];

export const resolveMachiWeatherKind = (weather: MachiWeather, seed: string | number): MachiWeatherKind => {
    if (weather !== 'auto') return weather;
    let roll = visualizerHash01(hashVisualizerSeed(`machi-weather:${seed}`), 0, 0x3d);
    for (const [kind, weight] of AUTO_WEATHER) {
        if (roll < weight) return kind;
        roll -= weight;
    }
    return 'rain';
};

/** 环境追向的目标。 */
export interface MachiEnvironmentTarget {
    daylight: number;
    rain: number;
    snow: number;
    fog: number;
}

export const resolveMachiEnvironmentTarget = (daylight: number, kind: MachiWeatherKind): MachiEnvironmentTarget => ({
    daylight,
    rain: kind === 'rain' ? 1 : 0,
    snow: kind === 'snow' ? 1 : 0,
    fog: kind === 'fog' ? 1 : 0,
});

/** 环境此刻的状态：目标的几项，再加地面的湿度与积雪（比降水慢）。 */
export interface MachiEnvironmentState extends MachiEnvironmentTarget {
    wetness: number;
    snowCover: number;
}

export const createMachiEnvironmentState = (target: MachiEnvironmentTarget): MachiEnvironmentState => ({
    ...target,
    wetness: target.rain > 0.5 ? 1 : target.fog > 0.5 ? 0.35 : 0,
    snowCover: target.snow > 0.5 ? 1 : 0,
});

/** 各项追目标的时间常数（秒）。 */
const TAU = {
    daylight: 1.6,
    precipitation: 1.4,
    fog: 2.2,
    wetUp: 3,
    wetDown: 20,
    snowUp: 8,
    snowDown: 12,
} as const;

const approach = (value: number, target: number, tau: number, delta: number) => {
    const next = value + (target - value) * (1 - Math.exp(-delta / tau));
    return Math.abs(next - target) < 1e-3 ? target : next;
};

/** 推进 delta 秒：降水、雾、白天程度阻尼地追目标；下雨时路面变湿，停了慢慢干；下雪时慢慢积、停了慢慢化。 */
export const stepMachiEnvironment = (state: MachiEnvironmentState, target: MachiEnvironmentTarget, delta: number): MachiEnvironmentState => {
    if (delta <= 0) return state;
    const rain = approach(state.rain, target.rain, TAU.precipitation, delta);
    const snow = approach(state.snow, target.snow, TAU.precipitation, delta);
    const fog = approach(state.fog, target.fog, TAU.fog, delta);
    // 雨把路面打湿；雾天只是潮；雪天、晴天路面慢慢干。
    const wetTarget = Math.max(rain, fog * 0.35);
    const wetness = approach(state.wetness, wetTarget, wetTarget > state.wetness ? TAU.wetUp : TAU.wetDown, delta);
    const snowCover = approach(state.snowCover, snow, snow > state.snowCover ? TAU.snowUp : TAU.snowDown, delta);
    return {
        daylight: approach(state.daylight, target.daylight, TAU.daylight, delta),
        rain,
        snow,
        fog,
        wetness,
        snowCover,
    };
};

export const sameMachiEnvironment = (a: MachiEnvironmentState, b: MachiEnvironmentState) => (
    a.daylight === b.daylight && a.rain === b.rain && a.snow === b.snow && a.fog === b.fog && a.wetness === b.wetness && a.snowCover === b.snowCover
);

/** 由环境状态推出的灯光与后处理标量。 */
export interface MachiEnvironmentLook {
    /** 白天的暖：黄昏最暖。 */
    warmth: number;
    /** 阴天程度：雨、雾、雪把天压灰。 */
    overcast: number;
    /** 人造光（店内灯、招牌、路灯）的亮度倍数：白天弱。 */
    artificial: number;
    /** 路灯：黄昏才点亮，白天关。 */
    streetLamps: number;
    /** 平行光（夜里月光、白天太阳）与半球光的强度。 */
    sunIntensity: number;
    hemiIntensity: number;
    bloom: number;
    streaks: number;
    /** 天空里的云量、星星、贴地雾的浓度、整体雾气。 */
    clouds: number;
    stars: number;
    mist: number;
    haze: number;
}

export const resolveMachiEnvironmentLook = (state: MachiEnvironmentState): MachiEnvironmentLook => {
    const { daylight } = state;
    const warmth = Math.max(0, 1 - Math.abs(daylight - MACHI_DAYLIGHT.dusk) / 0.38);
    const overcast = Math.min(1, Math.max(state.rain, state.fog, state.snow * 0.8));
    const night = 1 - daylight;
    return {
        warmth,
        overcast,
        artificial: 0.55 + 0.45 * smoothstep(0.85, 0.2, daylight),
        streetLamps: smoothstep(0.62, 0.3, daylight),
        sunIntensity: (1.35 + (3.0 - 1.35) * daylight) * (1 - 0.55 * overcast * daylight) * (1 - 0.25 * state.fog),
        hemiIntensity: 2.1 + 0.35 * daylight + 0.25 * overcast * daylight,
        bloom: 0.12 + 0.38 * night,
        streaks: 0.55 * night * night,
        clouds: 0.18 + 0.82 * overcast,
        stars: night * (1 - overcast) * smoothstep(0.35, 0.05, daylight),
        mist: 0.16 * (1 - 0.4 * daylight) + 0.1 * state.rain + 0.45 * state.fog + 0.06 * state.snow,
        haze: 0.42 * state.fog + 0.08 * state.snow,
    };
};
