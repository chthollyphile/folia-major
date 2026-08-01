import type { SonnetParagraph, SonnetShot, SonnetShotKind, SonnetTransitionKind } from './types';

// src/components/visualizer/sonnet/sonnetMotion.ts
// Pure absolute-time motion evaluation keeps direct seeks identical to continuous playback.
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const cubicCoordinate = (point1: number, point2: number, time: number) => {
    const inverse = 1 - time;
    return 3 * inverse * inverse * time * point1
        + 3 * inverse * time * time * point2
        + time * time * time;
};

// Resolves CSS-style cubic-bezier timing by solving the x curve before sampling y.
export const resolveCubicBezier = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    value: number,
) => {
    const target = clamp01(value);
    if (target === 0 || target === 1) return target;
    let low = 0;
    let high = 1;
    let parameter = target;
    for (let iteration = 0; iteration < 12; iteration += 1) {
        const x = cubicCoordinate(x1, x2, parameter);
        if (x < target) low = parameter;
        else high = parameter;
        parameter = (low + high) / 2;
    }
    return cubicCoordinate(y1, y2, parameter);
};

export const easeSonnetInOut = (value: number) => resolveCubicBezier(0.65, 0, 0.35, 1, value);
export const easeSonnetEnter = (value: number) => resolveCubicBezier(0.22, 1, 0.36, 1, value);

// 高张力 PV 风格缓动
export const easeSonnetExpoOut = (value: number) => (
    value === 1 ? 1 : 1 - Math.pow(2, -10 * value)
);
export const easeSonnetElasticOut = (value: number) => {
    const p = 0.3;
    return Math.pow(2, -10 * value) * Math.sin((value - p / 4) * (2 * Math.PI) / p) + 1;
};

export const resolveShotProgress = (shot: SonnetShot, time: number) => (
    clamp01((time - shot.startTime) / Math.max(shot.endTime - shot.startTime, 0.001))
);

export const resolveSegmentProgress = (startTime: number, endTime: number, time: number) => (
    // 使用更高张力的 ExpoOut 产生“打击感”的单字入场
    easeSonnetExpoOut(clamp01((time - startTime) / Math.max(endTime - startTime, 0.08)))
);

export interface SonnetShotMotionFrame {
    x: number;
    y: number;
    scale: number;
    rotation: number;
}

export interface SonnetFocusTimeRange {
    startTime: number;
    endTime: number;
}

// Produces stable normalized focus weights, including silent gaps and the tail after the final glyph.
export const resolveSonnetFocusWeights = (
    ranges: SonnetFocusTimeRange[],
    time: number,
    sigma = 0.35,
) => {
    if (ranges.length === 0) return [];
    const safeSigma = Math.max(0.001, sigma);
    const logWeights = ranges.map(range => {
        const startTime = Math.min(range.startTime, range.endTime);
        const endTime = Math.max(range.startTime, range.endTime);
        const distance = time < startTime
            ? startTime - time
            : time > endTime
                ? time - endTime
                : 0;
        return -(distance * distance) / (2 * safeSigma * safeSigma);
    });
    const maxLogWeight = Math.max(...logWeights);
    const weights = logWeights.map(weight => Math.exp(weight - maxLogWeight));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    return weights.map(weight => weight / totalWeight);
};

export const resolveShotPathProgress = (kind: SonnetShotKind, progress: number) => {
    const linear = clamp01(progress);
    if (kind === 'tracking-ribbon' || kind === 'fragment-collage' || kind === 'quiet-tableau') {
        return easeSonnetInOut(linear);
    }
    if (linear < 0.2) return easeSonnetExpoOut(linear / 0.2) * 0.3;
    if (linear < 0.72) return 0.3;
    return 0.3 + easeSonnetInOut((linear - 0.72) / 0.28) * 0.7;
};

// Gives every shot a deliberate, seek-safe camera path instead of relying on audio jitter.
export const resolveShotMotionFrame = (
    kind: SonnetShotKind,
    progress: number,
): SonnetShotMotionFrame => {
    const linear = clamp01(progress);
    const eased = resolveShotPathProgress(kind, linear);
    const frames: Record<SonnetShotKind, SonnetShotMotionFrame> = {
        'editorial-column': {
            x: -0.055 + eased * 0.095,
            y: 0.025 - eased * 0.04,
            scale: 0.98 + eased * 0.07,
            rotation: -0.006 + eased * 0.01,
        },
        'type-impact': {
            x: -0.035 + eased * 0.07,
            y: 0.018 - eased * 0.028,
            scale: 1 + (1 - easeSonnetExpoOut(Math.min(linear / 0.18, 1))) * 0.22 + eased * 0.08,
            rotation: -0.01 + eased * 0.016,
        },
        'fragment-collage': {
            x: -0.045 + eased * 0.085,
            y: 0.028 - Math.sin(eased * Math.PI) * 0.055,
            scale: 0.97 + eased * 0.09,
            rotation: -0.014 + eased * 0.028,
        },
        'tracking-ribbon': {
            x: -0.16 + eased * 0.28,
            y: 0.05 - eased * 0.085,
            scale: 0.98 + eased * 0.07,
            rotation: 0.008 - eased * 0.014,
        },
        'mask-reveal': {
            x: 0.035 - eased * 0.065,
            y: 0.1 - eased * 0.135,
            scale: 0.96 + eased * 0.12,
            rotation: -0.006 + eased * 0.009,
        },
        'quiet-tableau': {
            x: -0.022 + eased * 0.04,
            y: 0.014 - eased * 0.025,
            scale: 1 + eased * 0.028,
            rotation: -0.002 + eased * 0.003,
        },
    };
    return frames[kind];
};

// 纯时间轴伪随机震颤
export const resolveTimelineShake = (time: number, intensity: number) => {
    if (intensity <= 0) return { x: 0, y: 0, rotation: 0 };
    // 高频噪点
    const shakeX = Math.sin(time * 123.456) * Math.cos(time * 789.123);
    const shakeY = Math.cos(time * 345.678) * Math.sin(time * 901.234);
    const shakeRot = Math.sin(time * 567.890);
    return {
        x: shakeX * 0.02 * intensity,
        y: shakeY * 0.02 * intensity,
        rotation: shakeRot * 0.005 * intensity,
    };
};

export interface SonnetTransitionFrame {
    progress: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    alpha: number;
    shakeIntensity: number;
}

export const resolveTransitionFrame = (
    paragraph: SonnetParagraph,
    time: number,
): SonnetTransitionFrame => {
    const transition = paragraph.transitionOut;
    if (!transition || time < transition.startTime) {
        return { progress: 0, x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, shakeIntensity: 0 };
    }
    const progress = easeSonnetInOut(clamp01(
        (time - transition.startTime) / Math.max(transition.endTime - transition.startTime, 0.001),
    ));
    const shakeIntensity = 0; // Removed extreme shaking per user request

    const frames: Record<SonnetTransitionKind, Omit<SonnetTransitionFrame, 'progress' | 'shakeIntensity'>> = {
        'whip-pan': { x: -0.15 * progress, y: 0.02 * progress, scale: 1.01, rotation: -0.005 * progress, alpha: 1 - progress },
        'match-cut': { x: 0, y: 0, scale: 1 + progress * 0.1, rotation: 0, alpha: 1 - progress },
        'strip-slice': { x: 0.05 * progress, y: -0.02 * progress, scale: 1, rotation: 0.01 * progress, alpha: 1 - progress },
        'flash-frame': { x: 0, y: 0, scale: 1.02, rotation: 0, alpha: 1 - progress },
        'aperture-wipe': { x: 0, y: 0, scale: Math.max(0.8, 1 - progress * 0.2), rotation: progress * 0.02, alpha: 1 - progress },
    };
    return { progress, shakeIntensity, ...frames[transition.kind] };
};
