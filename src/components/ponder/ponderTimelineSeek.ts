import type { Timeline } from 'animejs';

// src/components/ponder/ponderTimelineSeek.ts
// 把课程时间线拨到某个时间。只引 animejs 的类型，库本身仍然只由 usePonderTimeline 带进来。

/**
 * 把时间线拨到 atMs，不触发回调；拨完的画面和从头播到 atMs 一样。
 *
 * 往回拨要先回到开头再拨过去。anime.js 往回走时跳过已经播完的那几段，而同一个属性上排在
 * 后面、自己带着起始值的那一段，在它开始之前也不写值 —— 这个属性就没人写，留着拨之前的样子
 * （聚焦框还停在后一个目标上或者不见了、名字标签没有、光标在后一步的落点）。
 * 回到开头时每个属性的第一段会写下起始值，再往后拨就是按顺序各写一遍。
 */
export const seekPonderTimeline = (timeline: Timeline, atMs: number): void => {
    if (atMs < timeline.iterationCurrentTime) {
        timeline.seek(0, true);
    }
    timeline.seek(atMs, true);
};
