// src/components/remote/remoteTrackTransition.ts
// 遥控窗口收尾阶段的两段时间逻辑：进度条发光提示，以及切歌前的内容交接。

/** 进度条开始发光的剩余秒数 */
export const OUTRO_GLOW_SECONDS = 30;
/** 自然播完前多少秒开始把封面/文字/背景色交接给下一首 */
export const TRACK_HANDOFF_SECONDS = 10;

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

/**
 * 最后 10 秒：0 → 1 的交接进度，1 表示画面已经完全是下一首。
 * 暂停时回到 0，看到的仍然是当前这首。
 */
export const resolveTrackHandoffProgress = (
    timing: RemoteTrackTiming & { isPlaying: boolean },
): number => {
    if (!timing.isPlaying || !isInsideOutroWindow(timing, TRACK_HANDOFF_SECONDS)) {
        return 0;
    }

    const elapsedInWindow = TRACK_HANDOFF_SECONDS - timing.remainingSeconds;
    return Math.max(0, Math.min(1, elapsedInWindow / TRACK_HANDOFF_SECONDS));
};
