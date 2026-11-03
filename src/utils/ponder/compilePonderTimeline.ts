import {
    PONDER_DEFAULT_DWELL_MS,
    type PonderKeyframe,
    type PonderSceneScript,
    type PonderStep,
    type PonderTimelineEntry,
    type PonderTimelinePlan,
} from '../../types/ponder';

// src/utils/ponder/compilePonderTimeline.ts
// 把场景脚本铺平成一条带绝对时间的时间线。
//
// 这里刻意不认识 animejs：编译是纯算术，放在 node 环境下就能单测（vitest 跑 node，见
// vitest.config.ts:17），而把 plan 翻译成 timeline.add(...) 的那一步留在懒加载 chunk 里。

/** 一步占多长。pause 用 dwellMs，其余用自己的 durationMs。 */
const stepDurationMs = (step: PonderStep): number => (
    step.kind === 'pause' ? (step.dwellMs ?? PONDER_DEFAULT_DWELL_MS) : step.durationMs
);

/**
 * 顺序铺开所有步骤，算出每一步的起始时间、整段总时长和关键帧位置。
 *
 * withPrevious 的语义是「和上一个顺序步同时开始」，所以它不推进游标 —— 字幕配着动作跑、
 * 却不把后面的步骤往后挤，靠的就是这条。但它仍然计入总时长：一段比动作长的字幕不该被截断。
 */
export const compilePonderScene = (scene: PonderSceneScript): PonderTimelinePlan => {
    const entries: PonderTimelineEntry[] = [];
    const keyframes: PonderKeyframe[] = [];

    let cursorMs = 0;
    let previousAtMs = 0;
    let endMs = 0;

    for (const step of scene.steps) {
        const durationMs = stepDurationMs(step);
        const atMs = step.withPrevious ? previousAtMs : cursorMs;

        entries.push({ step, atMs, durationMs });

        if (!step.withPrevious) {
            previousAtMs = atMs;
            cursorMs = atMs + durationMs;
        }
        endMs = Math.max(endMs, atMs + durationMs);

        // pausePoint 必然是关键帧 —— 这两个概念在这套 UX 里本来就是同一个东西。
        if (step.keyframe || step.kind === 'pause') {
            keyframes.push({ stepId: step.id, atMs });
        }
    }

    // 同一时刻可能被多个步骤同时标成关键帧（动作 + 并行字幕），进度条上只该有一根刻度。
    const deduped: PonderKeyframe[] = [];
    for (const keyframe of [...keyframes].sort((a, b) => a.atMs - b.atMs)) {
        if (deduped.length === 0 || deduped[deduped.length - 1].atMs !== keyframe.atMs) {
            deduped.push(keyframe);
        }
    }

    return { totalMs: endMs, entries, keyframes: deduped };
};
