// Copyright (c) 2026 chthollyphile
import { findHanabiParagraphIndexAtTime, type HanabiProgram } from './hanabiProgram';
import { HANABI_TRANSITIONS, resolveHanabiEnterDuration, type HanabiTransitionFrame } from './hanabiTransitions';

// src/components/visualizer/hanabi/hanabiSceneFrames.ts
// 某一时刻哪些段落场景在画、各自套什么帧（透明度 / 缩放 / 模糊 / 纵向位移）。纯函数，只由 program 与时间决定。
// 段落首尾相接，所以任何时刻只有「当前段落」一个场景，外加边界之后的进入窗口里正在退出的上一段（同绘光）：
//   - 出场窗口（transitionOut.startTime..边界）：当前段套 resolveFrame('exit')；
//   - 进入窗口（边界之后 resolveHanabiEnterDuration 秒）：新段套 resolveFrame('enter')，同时与出场接着往下走的
//     上一段交叉渐变，边界两侧的画面是连续的，没有硬切，旧画面也不在边界上一下停住。

export interface HanabiLayerFrame extends HanabiTransitionFrame {
    /** 段落序号。 */
    index: number;
}

export interface HanabiSceneFrames {
    /** 当前段落（场景缓存以它为中心）。 */
    activeIndex: number;
    /** 从下往上画的层；通常一个，进入窗口里两个（上一段在下）。 */
    layers: HanabiLayerFrame[];
}

const IDLE: HanabiTransitionFrame = { alpha: 1, scale: 1, blur: 0, y: 0, rotation: 0 };

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/** beyondBoundary：边界之后还在淡出的旧段落，出场进度接着走过 1（上升转场的旧画面接着滑走，不在边界上停住）。 */
const exitFrameOf = (program: HanabiProgram, index: number, time: number, beyondBoundary = false): HanabiTransitionFrame => {
    const out = program.paragraphs[index]?.transitionOut;
    if (!out || time < out.startTime) return IDLE;
    const progress = (time - out.startTime) / Math.max(out.endTime - out.startTime, 1e-3);
    return HANABI_TRANSITIONS[out.kind].resolveFrame('exit', beyondBoundary ? progress : Math.min(progress, 1));
};

/** transitionsEnabled 为 false（静态模式）时段落之间硬切。没有段落时 layers 为空。 */
export const resolveHanabiSceneFrames = (
    program: HanabiProgram,
    time: number,
    transitionsEnabled: boolean,
): HanabiSceneFrames => {
    if (program.paragraphs.length === 0) return { activeIndex: -1, layers: [] };
    const activeIndex = findHanabiParagraphIndexAtTime(program, time);
    if (!transitionsEnabled) return { activeIndex, layers: [{ index: activeIndex, ...IDLE }] };
    const paragraph = program.paragraphs[activeIndex]!;
    const current = exitFrameOf(program, activeIndex, time);
    const layers: HanabiLayerFrame[] = [];

    const previousOut = activeIndex > 0 ? program.paragraphs[activeIndex - 1]!.transitionOut : null;
    if (previousOut) {
        const enterDuration = resolveHanabiEnterDuration(previousOut.kind, previousOut.startTime, previousOut.endTime);
        const progress = (time - paragraph.startTime) / enterDuration;
        if (progress >= 0 && progress < 1) {
            const enter = HANABI_TRANSITIONS[previousOut.kind].resolveFrame('enter', progress);
            const weight = smooth(progress);
            // 上一段的出场接着走（上升按边界上的速度继续滑走、转走），随进入进度淡掉。
            const leaving = exitFrameOf(program, activeIndex - 1, time, true);
            if (leaving.alpha * (1 - weight) > 0.002) {
                layers.push({ index: activeIndex - 1, ...leaving, alpha: leaving.alpha * (1 - weight) });
            }
            layers.push({
                index: activeIndex,
                alpha: Math.min(enter.alpha, weight) * current.alpha,
                scale: enter.scale * current.scale,
                blur: Math.max(enter.blur, current.blur),
                y: enter.y + current.y,
                rotation: enter.rotation + current.rotation,
            });
            return { activeIndex, layers };
        }
    }
    layers.push({ index: activeIndex, ...current });
    return { activeIndex, layers };
};
