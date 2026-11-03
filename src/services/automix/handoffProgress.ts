// src/services/automix/handoffProgress.ts
// The one curve a song hand-off is drawn on, wherever it is drawn: the remote window's cover and
// title, and the main window's visualizer. Both follow the same cue, so both must cross on the same
// curve - two copies of it drift the moment one is tuned.

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * How far `value` has come from `start` towards 1, 0..1: what follows the hand-off from partway along
 * it (a cover that decodes late, a colour that changes mid-blend) still plays its whole course rather
 * than jumping to where the hand-off is. A start at 1 has nothing left to follow, and is done.
 */
export const progressSince = (value: number, start: number): number => (
    start >= 1 ? 1 : clamp01((value - start) / (1 - start))
);

/** Maps cue time through a peaked-speed curve while keeping 50% on the audio crossover. */
export const mapTrackHandoffProgress = (timeProgress: number, crossover: number): number => {
    const safeProgress = clamp01(timeProgress);
    const safeCrossover = clamp01(crossover);

    // crossover 落在端点时「50% 对齐 crossover」无解：硬套会让第一帧（或最后一帧）
    // 直接跳掉半个不透明度。此时退回线性，曲线两端仍然连续。
    const crossoverAlignedProgress = safeCrossover <= 0 || safeCrossover >= 1
        ? safeProgress
        : safeProgress <= safeCrossover
            ? 0.5 * safeProgress / safeCrossover
            : 0.5 + 0.5 * (safeProgress - safeCrossover) / (1 - safeCrossover);

    // smoothstep 的速度是一座中间高、两端低的抛物线：快速穿过双标题都明显可见的区域。
    return crossoverAlignedProgress * crossoverAlignedProgress * (3 - 2 * crossoverAlignedProgress);
};
