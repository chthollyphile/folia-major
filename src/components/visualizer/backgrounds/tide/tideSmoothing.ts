// src/components/visualizer/backgrounds/tide/tideSmoothing.ts
// The one filter all of the tide's motion goes through. It is critically damped *second* order on
// purpose: with a first-order lag every throttled DOM sample is a step in the target, and a step
// makes the derived velocity jump - the anchor snaps, the water jerks. That is the twitch that shows
// up at fast sampling rates and whenever the clusters are re-picked. A smooth damp turns the same
// step into a velocity that ramps up and decays, and its own velocity is what the splats are built
// from, so the water can never be pushed harder than the words actually move.

/** 单帧最大位移折算成的最大速度：目标跳变（重新聚类、换行、镜头重算）时也不会把水甩出去。 */
export const TIDE_ANCHOR_MAX_SPEED = 1.1;

export interface TideSmoothState {
    value: number;
    velocity: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 时间常数：smoothing 0 表示直接吸附（返回 0），越大越丝滑。 */
export const tideSmoothTau = (smoothing: number, base: number, span: number): number => {
    const smooth = clamp(Number.isFinite(smoothing) ? smoothing : 0, 0, 0.92);
    return smooth <= 0 ? 0 : base + smooth * span;
};

/**
 * Critically damped spring step (the `SmoothDamp` formulation): no overshoot, and the velocity is
 * continuous, which is the whole point. `tau <= 0` snaps.
 */
export const smoothDamp = (
    state: TideSmoothState,
    target: number,
    step: number,
    tau: number,
    maxSpeed = TIDE_ANCHOR_MAX_SPEED,
): TideSmoothState => {
    if (tau <= 0) {
        return { value: target, velocity: 0 };
    }

    const omega = 2 / tau;
    const x = omega * step;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    // 先把「这一步允许走多远」夹住，越过上限的目标就变成一次匀速追赶，不会一步甩到。
    const maxChange = maxSpeed * tau;
    const change = clamp(state.value - target, -maxChange, maxChange);
    const held = state.value - change;
    const temp = (state.velocity + omega * change) * step;
    const velocity = (state.velocity - omega * temp) * decay;
    const value = held + (change + temp) * decay;

    // 追上（或越过）目标就落地，别留一点永远抹不掉的残速。
    if ((target - state.value > 0) === (value > target)) {
        return { value: target, velocity: 0 };
    }

    return { value, velocity };
};
