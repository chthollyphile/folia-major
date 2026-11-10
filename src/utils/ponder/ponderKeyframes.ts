import type { PonderTimelinePlan } from '../../types/ponder';

// src/utils/ponder/ponderKeyframes.ts
// 关键帧刻度的位置换算，以及 ←/→ 跳转要落到哪一帧。

/**
 * 死区。没有它，刚跳到某个关键帧后再按一次 ←，会因为「当前时间就等于该帧」而原地不动，
 * 连按两次只前进一帧。
 */
const SEEK_TOLERANCE_MS = 250;

/** 每根刻度在进度条上的比例位置，0..1。 */
export const keyframeTicks = (plan: PonderTimelinePlan): number[] => {
    if (plan.totalMs <= 0) {
        return [];
    }
    return plan.keyframes.map(keyframe => keyframe.atMs / plan.totalMs);
};

/** 当前时间落在第几个关键帧区间内；一个都没过则为 -1。 */
export const keyframeIndexAt = (plan: PonderTimelinePlan, nowMs: number): number => {
    let index = -1;
    plan.keyframes.forEach((keyframe, i) => {
        if (keyframe.atMs <= nowMs + 1) {
            index = i;
        }
    });
    return index;
};

/** 下一个关键帧的时间；已经在最后一个之后则绕回开头。 */
export const nextKeyframeAt = (plan: PonderTimelinePlan, nowMs: number): number => {
    const next = plan.keyframes.find(keyframe => keyframe.atMs > nowMs + SEEK_TOLERANCE_MS);
    return next ? next.atMs : 0;
};

/** 上一个关键帧的时间；已经在第一个之前则回到开头。 */
export const prevKeyframeAt = (plan: PonderTimelinePlan, nowMs: number): number => {
    const earlier = plan.keyframes.filter(keyframe => keyframe.atMs < nowMs - SEEK_TOLERANCE_MS);
    return earlier.length > 0 ? earlier[earlier.length - 1].atMs : 0;
};

/**
 * 跳到 atMs 之后，时间线该在哪里停住。
 *
 * 动作类关键帧落在动作开头：直接停在那里，画面是动作之前的样子，上一段字幕已收、
 * 这一段还没出来，等于停在一帧空白上。所以先把这一拍播完 —— 动作和结果层做完、
 * 字幕淡入 —— 再停。上限是下一个动作的开头，不会越过去替用户多看一拍。
 * pause 类关键帧通常就是「这一拍已经讲完」的位置，原地停；但并行的结果层可以比它前面
 * 那个顺序步长（一段 520ms 的淡入挂在更短的高亮上），落点时还在半途，所以早先开始、
 * 此刻仍在进行的也要等完。
 *
 * captionSettleMs 是一段字幕从开口到「到位」要多久：它淡入、它的聚焦框走到。时长是画的人
 * 定的（usePonderTimeline），所以由它交进来；停得比这早，就是一帧没字、或者框还在半路的画面。
 */
export const keyframeSettleAt = (plan: PonderTimelinePlan, atMs: number, captionSettleMs: number): number => {
    const startsAction = (keyframeAtMs: number) => plan.entries.some(
        entry => entry.atMs === keyframeAtMs && entry.step.kind !== 'pause',
    );
    const limitMs = plan.keyframes.find(keyframe => keyframe.atMs > atMs && startsAction(keyframe.atMs))?.atMs
        ?? plan.totalMs;

    let settleMs = atMs;
    for (const { step, atMs: startMs, durationMs } of plan.entries) {
        if (startMs >= limitMs || step.kind === 'pause') continue;
        // 字幕只等它淡入，不等它读完：读字幕正是停下来的目的。
        const endMs = startMs + (step.kind === 'caption' ? captionSettleMs : durationMs);
        // 落点之前就已做完的不用等；落点之后开始的、以及此刻还在进行的都要等。
        if (endMs > atMs) settleMs = Math.max(settleMs, endMs);
    }
    return Math.min(settleMs, limitMs);
};
