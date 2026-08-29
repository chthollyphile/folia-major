import type { RemoteTrackTransition } from '../../types/remoteControl';

// src/components/remote/remoteTrackTransition.ts
// 遥控窗口跟随 AutoMix/Crossfade cue 的进度条提示与内容交接。

type RemoteTransitionTiming = {
    transition: RemoteTrackTransition | null;
    isPlaying: boolean;
    nowMs: number;
};

export type RemoteTrackHandoffPair = {
    startedAtMs: number;
    outgoingKey: string;
    incomingKey: string;
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

    if (safeProgress <= 0) return 0;
    if (safeProgress >= 1) return 1;

    const crossoverAlignedProgress = safeProgress <= safeCrossover
        ? safeCrossover > 0 ? 0.5 * safeProgress / safeCrossover : 0.5
        : safeCrossover < 1
            ? 0.5 + 0.5 * (safeProgress - safeCrossover) / (1 - safeCrossover)
            : 1;

    // smoothstep 的速度是一座中间高、两端低的抛物线：快速穿过双标题都明显可见的区域。
    return crossoverAlignedProgress * crossoverAlignedProgress * (3 - 2 * crossoverAlignedProgress);
};

/** Keeps a completed handoff at B, but restores A when the same handoff is cancelled. */
export const resolveStoppedTrackHandoffProgress = (
    pair: RemoteTrackHandoffPair | null,
    currentTrackKey: string,
): number => pair?.incomingKey === currentTrackKey ? 1 : 0;

/** 只在实际音频过渡的 cue 时间窗内点亮进度条。 */
export const isTrackTransitionGlowVisible = (timing: RemoteTransitionTiming): boolean => {
    const clock = resolveTransitionClock(timing);
    return Boolean(clock && clock.elapsedSec >= 0 && clock.elapsedSec < clock.durationSec);
};

/**
 * 把时间进度映射成视觉交接进度，并让 50% 视觉主导权对齐音频 cue 的 crossover。
 * Remote 每 500ms 收一次快照；连续帧交给 Framer Motion 插值，不写入 React 高频 state。
 */
export const resolveTrackHandoffProgress = (
    timing: RemoteTransitionTiming,
): number => {
    const clock = resolveTransitionClock(timing);
    const transition = timing.transition;
    if (!clock || !transition) return 0;

    return mapTrackHandoffProgress(clock.timeProgress, transition.crossover);
};
