import type { RemoteTrackTransition } from '../../types/remoteControl';

// src/components/remote/remoteTrackTransition.ts
// 遥控窗口的两段时间逻辑：曲尾提示，以及跟随 AutoMix cue 的内容交接。

/** 进度条开始发光的剩余秒数 */
export const OUTRO_GLOW_SECONDS = 30;

type RemoteTrackTiming = {
    hasTrack: boolean;
    /** 曲目总时长，秒；未知时传 0 */
    duration: number;
    /** 剩余秒数，未知时传 Infinity */
    remainingSeconds: number;
};

/**
 * 短曲目会整首都处在收尾窗口里，提示就失去意义，所以要求时长至少是窗口的两倍。
 */
const isInsideOutroWindow = (
    { hasTrack, duration, remainingSeconds }: RemoteTrackTiming,
    windowSeconds: number,
): boolean => (
    hasTrack
    && duration > windowSeconds * 2
    && remainingSeconds > 0
    && remainingSeconds <= windowSeconds
);

/** 最后 30 秒：进度条发光 */
export const isOutroGlowVisible = (timing: RemoteTrackTiming): boolean => (
    isInsideOutroWindow(timing, OUTRO_GLOW_SECONDS)
);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * 把时间进度映射成视觉交接进度，并让 50% 视觉主导权对齐音频 cue 的 crossover。
 * Remote 每 500ms 收一次快照；连续帧交给 Framer Motion 插值，不写入 React 高频 state。
 */
export const resolveTrackHandoffProgress = (
    timing: {
        transition: RemoteTrackTransition | null;
        isPlaying: boolean;
        nowMs: number;
    },
): number => {
    const transition = timing.transition;
    if (
        !timing.isPlaying
        || !transition
        || !Number.isFinite(transition.startedAtMs)
        || !Number.isFinite(transition.durationSec)
        || transition.durationSec <= 0
    ) {
        return 0;
    }

    const elapsedSec = (timing.nowMs - transition.startedAtMs) / 1000;
    const timeProgress = clamp01(elapsedSec / transition.durationSec);
    const crossover = clamp01(transition.crossover);

    if (timeProgress <= 0) return 0;
    if (timeProgress >= 1) return 1;

    if (timeProgress <= crossover) {
        return crossover > 0 ? 0.5 * timeProgress / crossover : 0.5;
    }

    return crossover < 1
        ? 0.5 + 0.5 * (timeProgress - crossover) / (1 - crossover)
        : 1;
};
