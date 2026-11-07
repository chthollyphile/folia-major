// src/utils/mediaKeyPressGate.ts
// 一次物理按键可能落到两条路径上：主进程在 globalShortcut 上占住的那三个键
// （useMediaKeyTakeoverBridge），和应用自己的媒体会话 navigator.mediaSession（useMediaSessionBridge）。
// 两条路径共用这一份记录，同一个动作在 SAME_PRESS_MS 内只执行一次。

/** 一次按键在 Folia 这边的名字：任务栏按钮、全局快捷键和媒体会话说的都是这三个。 */
export type MediaKeyPressAction = 'previous' | 'play-pause' | 'next';

/**
 * 比任何一次重复按键都短：这是同一次按键的两次到达，不是两次按键。全局快捷键先把键从系统那里拿走，
 * 正常情况下只有一条路径收到它；这里是两条都收到时的兜底。
 */
export const SAME_PRESS_MS = 120;

/** 上一次执行的按键与这一次是同一个动作、且隔得够近：这是同一次按键的第二次到达。 */
export const isRepeatedMediaKeyPress = (
    previous: { action: MediaKeyPressAction; atMs: number } | null,
    action: MediaKeyPressAction,
    nowMs: number,
): boolean => previous !== null && previous.action === action && nowMs - previous.atMs < SAME_PRESS_MS;

export type MediaKeyPressGate = {
    /** 这次按下可以执行时返回 true 并记下它；同动作在 SAME_PRESS_MS 内的再次到达返回 false。 */
    claim: (action: MediaKeyPressAction) => boolean;
};

export const createMediaKeyPressGate = (now: () => number = () => performance.now()): MediaKeyPressGate => {
    let last: { action: MediaKeyPressAction; atMs: number } | null = null;
    return {
        claim(action) {
            const atMs = now();
            if (isRepeatedMediaKeyPress(last, action, atMs)) return false;
            last = { action, atMs };
            return true;
        },
    };
};

/** 两条路径共用的那一份（见文件头）：一次按键只会从其中一条被执行。 */
export const mediaKeyPressGate = createMediaKeyPressGate();
