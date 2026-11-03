// Copyright (c) 2026 chthollyphile
// src/components/visualizer/hanabi/timeline.ts
// 一个场景单元的时间安排（纯数据）：每个镜头的文字入场 / 退场、升空尾迹、世界上升 rise(t)、世界旋转 spin(t) 与镜头内运镜。
// 全部只由 t 决定（docs/HANABI.md「上升」）。

export interface TimelineShot {
    startTime: number;
    endTime: number;
    /** 第一个字被唱到 / 最后一个字唱完的时刻；间奏为 null。 */
    firstSung: number | null;
    lastSungEnd: number | null;
    isBridge: boolean;
    camera: { rise: number; push: number; roll: number; punch: number };
}

export interface ShotTiming {
    start: number;
    end: number;
    /** 镜头容器在世界里的高度偏移（像素，向上为负）。 */
    worldY: number;
    /** 升空尾迹出发、文字入场（= 尾迹到达、主烟花开花）、文字退场。 */
    launchAt: number;
    enterAt: number;
    exitAt: number;
    exitDuration: number;
    /** 入场震动的时刻。 */
    punchAt: number;
    /** 进入这个镜头的上升窗口（第一个镜头为 null）。 */
    riseIn: { from: number; to: number } | null;
    /** 镜头内匀速上漂的速度（像素 / 秒）。 */
    drift: number;
    /** 镜头中点时世界转过的角度（弧度，累积）；镜头自己反向转回这个角度，所以镜头中点时字是正的。 */
    spin: number;
    /** 镜头内世界一直慢慢转的角速度（弧度 / 秒，带方向）。 */
    spinDrift: number;
}

export interface CameraOffset {
    scale: number;
    rotation: number;
    dx: number;
    dy: number;
}

export interface Timeline {
    shots: ShotTiming[];
    /** 世界容器的 y（像素）：镜头 i 定格时约等于 -worldY_i，镜头内缓慢变大（摄影机上漂）。 */
    rise: (time: number) => number;
    /**
     * 世界绕画面中心转过的角度（弧度），贯穿整个单元一直在转：镜头内按 spinDrift 匀速慢转，镜头边界的上升窗口里
     * 角速度沿一个圆顶的鼓包加速再减速，跟着上升甩过一个大角度；位置、角速度、角加速度处处连续。
     * 同一方向时角速度处处不为 0；换向时慢转的方向在窗口里平滑换过去，只在一瞬间过零，没有停住的阶段。
     */
    spin: (time: number) => number;
    /** time 时刻所在的镜头（最后一个已经开始的；开始之前为 0）。 */
    shotAt: (time: number) => number;
    /** 镜头内的推近、摆动与入场震动（绕画面中心）。 */
    camera: (time: number) => CameraOffset;
}

/** 边界前后上升的时长上限（秒）。 */
export const RISE_BEFORE = 0.6;
export const RISE_AFTER = 0.6;
/** 升空尾迹飞行时长。 */
export const LAUNCH_DURATION = 0.45;
/** 文字入场比第一个字被唱到提前多少秒。 */
export const ENTER_LEAD = 0.4;
/** 镜头内上漂：每秒约 3% 画面高度，整个镜头最多 15%。 */
const DRIFT_PER_SECOND = 0.03;
const DRIFT_MAX = 0.15;
/** 镜头之间的快转、上升的缓急：速度曲线是 (1 − u²)^n 的圆顶鼓包，n 越大两头越缓、中间甩得越快。 */
const SWING_SHARPNESS = 4;
/** 入场震动起势的时长（秒）：几帧之内震起来，不在一帧里跳。 */
const PUNCH_ATTACK = 0.05;

/** 镜头内一直在转的角速度上限（弧度 / 秒，约 11°/秒）与一个镜头里慢转最多转过的角度（约 49°）。 */
const SPIN_CRUISE = 0.2;
const SPIN_CRUISE_TOTAL = 0.85;
/** 边界快转在慢转之外再转过的角度：0.6–1.4 弧度（约 34°–80°）。 */
const SPIN_SWING_MIN = 0.6;
const SPIN_SWING_RANGE = 0.8;
/** 每个边界换向的概率。反着转时每个边界一半概率转回来，单元最后一个镜头一定转回起转的方向。 */
const SPIN_FLIP = 0.2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};
/**
 * 七次 smootherstep：两端速度、加速度、加加速度都为 0，速度曲线是一个圆顶的鼓包（140·t³(1 − t)³），中间没有折点。
 * 拿它在两段运动之间过渡，接缝处位置、速度、加速度都连续；easeInOutCubic 与三次贝塞尔缓动都做不到这一点
 * （前者中点处加速度从 +12 跳到 −12，后者两端加速度不为 0）。
 */
export const easeSeptic = (value: number) => {
    const t = clamp(value, 0, 1);
    return t ** 4 * (35 + t * (-84 + t * (70 - 20 * t)));
};
/** easeSeptic 从 0 积到 t（t ∈ [0, 1]），积到 1 是 1/2。 */
const easeSepticIntegral = (t: number) => t ** 5 * (7 + t * (-14 + t * (10 - 2.5 * t)));

const binomial = (n: number, k: number) => {
    let result = 1;
    for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
    return result;
};
/** (1 − u²)^n 的原函数：Σ C(n, k)(−1)^k u^(2k+1) / (2k + 1)。 */
const SWING_TERMS = Array.from({ length: SWING_SHARPNESS + 1 }, (_, k) => (binomial(SWING_SHARPNESS, k) * (-1) ** k) / (2 * k + 1));
const swingPrimitive = (u: number) => {
    const u2 = u * u;
    let power = u;
    let sum = 0;
    for (const term of SWING_TERMS) {
        sum += term * power;
        power *= u2;
    }
    return sum;
};
const SWING_HALF = swingPrimitive(1);
/**
 * 镜头之间的过渡缓动：速度是 (1 − u²)^SWING_SHARPNESS 的圆顶鼓包——起步与落定又缓又稳（两端速度、加速度都为 0），
 * 中间一下甩过去，像 MG 里拉满影响度的缓入缓出，但接缝处不会顿一下。
 */
export const easeSwing = (value: number) => 0.5 + swingPrimitive(2 * clamp(value, 0, 1) - 1) / (2 * SWING_HALF);

/**
 * 一个单元的世界旋转安排：每个镜头中点时转到的角度（第一个为 0）与镜头内慢转的角速度，都乘 amount（tuning.spin）。
 * 镜头内一直按 SPIN_CRUISE 慢转（镜头越长越慢，一个镜头最多转 SPIN_CRUISE_TOTAL）；相邻两个中点之间的角度差
 * = 两边各半个镜头的慢转 + 边界快转再甩过去的 SPIN_SWING。从 direction 起转，偶尔换向，单元结束前一定转回来，
 * 所以段落之间接上的总是同一个方向。
 */
export const planSpin = (durations: readonly number[], options: { amount: number; direction: number; random: () => number }) => {
    const angles: number[] = [];
    const drift: number[] = [];
    let direction = options.direction;
    durations.forEach((duration, index) => {
        if (index > 0) {
            const last = index === durations.length - 1;
            const roll = options.random();
            const reversed = direction !== options.direction;
            if (reversed ? last || roll < 0.5 : !last && roll < SPIN_FLIP) direction = -direction;
        }
        const cruise = direction * options.amount * Math.min(SPIN_CRUISE, SPIN_CRUISE_TOTAL / Math.max(duration, 0.5));
        drift.push(cruise);
        if (index === 0) {
            angles.push(0);
            return;
        }
        const swing = direction * options.amount * (SPIN_SWING_MIN + SPIN_SWING_RANGE * options.random());
        angles.push(angles[index - 1]! + (drift[index - 1]! * durations[index - 1]! + cruise * duration) / 2 + swing);
    });
    return { angles, drift };
};

export const buildTimeline = (shots: readonly TimelineShot[], options: {
    unitStart: number;
    unitEnd: number;
    height: number;
    /** tuning.riseSpeed。 */
    riseSpeed: number;
    /** 震动 / 摆动幅度倍率（主题的动画强度）。 */
    motion: number;
    /** 段落出场转场开始的时刻（最后一个镜头的字在这之后退场）；没有转场时字留到单元结束。 */
    exitStart?: number | null;
    /** 各镜头中点时世界转过的角度（弧度，累积，第一个为 0）；不给不转。 */
    spinAngles?: readonly number[];
    /** 各镜头内慢转的角速度（弧度 / 秒，带方向）；不给为 0。 */
    spinDrift?: readonly number[];
}): Timeline => {
    const { height, riseSpeed, motion } = options;
    const count = shots.length;
    const durationOf = (index: number) => Math.max(shots[index]!.endTime - shots[index]!.startTime, 0.05);
    // 边界 i（镜头 i-1 → i）的上升窗口：前后各不超过 0.6 秒，也不吃掉两边镜头太多。
    const before = shots.map((_, index) => (index === 0 ? 0 : Math.min(RISE_BEFORE, 0.45 * durationOf(index - 1))));
    const after = shots.map((_, index) => (index === 0 ? 0 : Math.min(RISE_AFTER, 0.35 * durationOf(index))));

    const timings: ShotTiming[] = [];
    let worldY = 0;
    shots.forEach((shot, index) => {
        if (index > 0) worldY -= clamp(shot.camera.rise, 0, 1.2) * riseSpeed * height;
        const boundary = shot.startTime;
        const sung = shot.firstSung ?? boundary;
        let enterAt = shot.isBridge ? boundary : Math.min(boundary, sung) - ENTER_LEAD;
        if (index > 0) enterAt = Math.max(enterAt, boundary - before[index]!, timings[index - 1]!.enterAt + 0.1);
        const duration = durationOf(index);
        timings.push({
            start: shot.startTime,
            end: shot.endTime,
            worldY,
            launchAt: enterAt - LAUNCH_DURATION,
            enterAt,
            exitAt: 0,
            exitDuration: 0,
            punchAt: enterAt + 0.08,
            riseIn: index === 0 ? null : { from: boundary - before[index]!, to: boundary + after[index]! },
            drift: riseSpeed * height * Math.min(DRIFT_PER_SECOND, DRIFT_MAX / duration),
            spin: options.spinAngles?.[index] ?? 0,
            spinDrift: options.spinDrift?.[index] ?? 0,
        });
    });

    // 退场：在下一个边界的上升里（最后一个唱完之后、边界前 0.15 秒之前开始），最后一个镜头在单元末尾。
    timings.forEach((timing, index) => {
        const shot = shots[index]!;
        const sungEnd = shot.lastSungEnd ?? timing.end;
        let exitAt: number;
        let exitDuration: number;
        if (index < count - 1) {
            const boundary = timing.end;
            exitAt = clamp(sungEnd, boundary - before[index + 1]!, boundary - 0.15);
            exitDuration = clamp(boundary + after[index + 1]! - exitAt, 0.35, 0.9);
        } else if (options.exitStart != null) {
            exitAt = Math.min(Math.max(sungEnd, options.exitStart), options.unitEnd - 0.2);
            exitDuration = clamp(options.unitEnd - exitAt, 0.25, 0.7);
        } else {
            // 没有出场转场（全曲最后一段、段内接别的包的镜头、缩略图）：字留到单元结束，交给内核或片尾卡收。
            exitAt = options.unitEnd;
            exitDuration = 0.5;
        }
        timing.exitAt = Math.max(exitAt, timing.enterAt + 0.3);
        timing.exitDuration = exitDuration;
    });

    const shotAt = (time: number) => {
        let found = 0;
        for (let index = 0; index < count; index += 1) if (timings[index]!.start <= time) found = index;
        return found;
    };

    /**
     * 按镜头取值：上升窗口里用 easeSwing 在两个镜头之间过渡，其余时间取所在镜头的值。
     * 两边的值在窗口里都按各自的规律接着走（不在边界处钳住），接缝两端的速度、加速度就都是镜头里的。
     */
    const blended = (time: number, value: (index: number, time: number) => number) => {
        for (let index = 1; index < count; index += 1) {
            const window = timings[index]!.riseIn!;
            if (time >= window.from && time <= window.to) {
                const k = easeSwing((time - window.from) / Math.max(window.to - window.from, 1e-3));
                return value(index - 1, time) + (value(index, time) - value(index - 1, time)) * k;
            }
        }
        return value(shotAt(time), time);
    };

    const target = (index: number, time: number) => {
        const timing = timings[index]!;
        return -timing.worldY + timing.drift * (time - (timing.start + timing.end) / 2);
    };

    const rise = (time: number) => (count === 0 ? 0 : blended(time, target));

    // 旋转按角速度来设计：镜头内按 spinDrift 匀速慢转；每个边界的上升窗口里，慢转的角速度用 easeSeptic 换成下一个镜头的，
    // 同时跟上升一起按 easeSwing 把这一步剩下的角度甩过去（世界边升边转）。两条曲线两端速度、加速度都是 0，
    // 所以慢转与快转之间没有「一脚油门、一脚刹车」；甩的角度按两个镜头中点的角度解出来，镜头中点时正好转到它自己的角度。
    const mids = timings.map(timing => (timing.start + timing.end) / 2);
    const spinSteps = timings.map((timing, index) => {
        if (index === 0) return null;
        const previous = timings[index - 1]!;
        const window = timing.riseIn!;
        const ramp = Math.max(window.to - window.from, 1e-3);
        const from = mids[index - 1]!;
        /** 慢转部分从上一个镜头中点积到 time。 */
        const drift = (time: number) => {
            const x = (time - window.from) / ramp;
            const switched = x <= 0 ? 0 : x >= 1 ? ramp / 2 + (time - window.to) : ramp * easeSepticIntegral(x);
            return previous.spinDrift * (time - from) + (timing.spinDrift - previous.spinDrift) * switched;
        };
        const swing = timing.spin - previous.spin - drift(mids[index]!);
        return (time: number) => previous.spin + drift(time) + swing * easeSwing((time - window.from) / ramp);
    });
    const spin = (time: number) => {
        if (count === 0) return 0;
        if (time <= mids[0]!) return timings[0]!.spin + timings[0]!.spinDrift * (time - mids[0]!);
        for (let index = 1; index < count; index += 1) {
            if (time < mids[index]!) return spinSteps[index]!(time);
        }
        const last = timings[count - 1]!;
        return last.spin + last.spinDrift * (time - mids[count - 1]!);
    };

    const pushOf = (index: number, time: number) => {
        const timing = timings[index]!;
        return 1 + shots[index]!.camera.push * smooth((time - timing.start) / Math.max(timing.end - timing.start, 0.05));
    };
    const rollOf = (index: number, time: number) => {
        const timing = timings[index]!;
        return shots[index]!.camera.roll * motion * Math.sin((time - timing.start) * 0.9 + index * 1.3);
    };

    const camera = (time: number): CameraOffset => {
        if (count === 0) return { scale: 1, rotation: 0, dx: 0, dy: 0 };
        let scale = blended(time, pushOf);
        const rotation = blended(time, rollOf);
        let dx = 0;
        let dy = 0;
        for (let index = 0; index < count; index += 1) {
            const age = time - timings[index]!.punchAt;
            const punch = shots[index]!.camera.punch;
            if (age < 0 || age > 0.9 || punch <= 0 || shots[index]!.isBridge) continue;
            const amp = punch * motion * Math.exp(-age / 0.16) * smooth(age / PUNCH_ATTACK);
            dx += amp * 0.012 * height * Math.sin(age * 70 + index);
            dy += amp * 0.016 * height * Math.cos(age * 55 + index * 2);
            scale *= 1 + amp * 0.03;
        }
        return { scale, rotation, dx, dy };
    };

    return { shots: timings, rise, spin, shotAt, camera };
};
