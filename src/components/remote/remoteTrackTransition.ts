import type { RemoteTrackTransition } from '../../types/remoteControl';

// src/components/remote/remoteTrackTransition.ts
// 遥控窗口跟随 AutoMix/Crossfade cue 的进度条提示与内容交接。

type RemoteTransitionTiming = {
    transition: RemoteTrackTransition | null;
    isPlaying: boolean;
    nowMs: number;
};

/**
 * 遥控窗口同时最多渲染两张"面"：当前曲目，以及自然播完前预读进来的下一首。
 * 交接期两张面按 opacity 交叉淡入淡出，切歌真正发生时下一首那张的 key 正好
 * 变成当前曲目的 key，React 复用同一节点，所以不会再抖一下。
 */
export type RemoteTrackFaceContent = {
    key: string;
    title: string;
    artist: string;
    coverUrl: string | null;
};

export type RemoteTrackFace = RemoteTrackFaceContent & {
    /** incoming 是交接淡入的那张；current 在无 cue 时仍走手动切歌的方向性短过渡 */
    mode: 'current' | 'incoming';
};

/**
 * 一条 cue 锁定的一组 A→B，连同淡入那张面的完整内容。
 * 队列在混音期间被改（删掉 B、拖进新曲、FM 追曲）时 next 会变成 C，
 * 但音频仍在混 B，所以这里锁下来的内容才是交接期唯一可信的来源。
 */
export type RemoteTrackHandoffPair = {
    startedAtMs: number;
    durationSec: number;
    outgoingKey: string;
    incoming: RemoteTrackFaceContent;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const resolveTransitionClock = (timing: RemoteTransitionTiming): {
    elapsedSec: number;
    durationSec: number;
    timeProgress: number;
} | null => {
    const transition = timing.transition;
    if (
        !timing.isPlaying
        || !transition
        || !Number.isFinite(timing.nowMs)
        || !Number.isFinite(transition.startedAtMs)
        || !Number.isFinite(transition.durationSec)
        || transition.durationSec <= 0
    ) {
        return null;
    }

    const elapsedSec = (timing.nowMs - transition.startedAtMs) / 1000;
    return {
        elapsedSec,
        durationSec: transition.durationSec,
        timeProgress: clamp01(elapsedSec / transition.durationSec),
    };
};

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

/**
 * 交接停下时该停在哪一端。
 * - B 已经成为当前曲目：停在终点。
 * - cue 整段已经走完但快照里还没换歌：settle 是同步清 cue 的，而 trackKey 要等下一次
 *   React 提交才推进，中间那次 500ms 发布会送来「没有 cue 的 A」。这里同样停在终点，
 *   否则已经淡完的 A 会满不透明度闪回一整个发布间隔。
 * - 其余情况（暂停、取消、被打断）才复位到起点，把 A 还回来。
 */
export const resolveStoppedTrackHandoffProgress = (
    pair: RemoteTrackHandoffPair | null,
    currentTrackKey: string,
    nowMs: number,
): number => {
    if (!pair) {
        return 0;
    }
    if (pair.incoming.key === currentTrackKey) {
        return 1;
    }
    return nowMs - pair.startedAtMs >= pair.durationSec * 1000 ? 1 : 0;
};
