// src/services/hifi/hifiClock.ts
// mpv 的位置只按约 4 Hz 推过来；这里记下最近一次的基准，逐帧按 performance.now() 外推，和 Stage 的外推时钟同一做法。

/**
 * 距上一次同步最多外推这么久（秒），约 4 个 250 ms 的 tick。mpv 在缓冲时主进程会报暂停，但那一下到之前、或者推送
 * 整个停了的时候，位置停在这里等下一次同步，而不是一路往前跑、等同步到了再往回跳：歌词和进度条不会跑到没放出来的地方，
 * 播放统计也不会多记没放的秒数。
 */
export const MAX_EXTRAPOLATION_SEC = 1;

/**
 * 播放中的 tick 比画面已经走到的位置早，且差不超过这么多（秒）时，当成推送晚到：画面停在原处等 mpv 追上，不往回跳。
 * 主进程忙、渲染进程在给 mpv 读文件时，一条 tick 能晚到几百毫秒；歌词把这种小幅倒退当成拖动，会重新定位而抽动一下。
 * 真正的往回跳（拖动、单曲循环、换歌）走 seek / load，不经过这里。
 */
export const MAX_HELD_LAG_SEC = MAX_EXTRAPOLATION_SEC;

export type HifiClockState = {
    baseSec: number;
    /** 基准对应的 performance.now()；暂停时为 null。 */
    startedAtMs: number | null;
    paused: boolean;
    /** 未知时为 null，外推就不按时长封顶（仍受 MAX_EXTRAPOLATION_SEC 限制）。 */
    durationSec: number | null;
    /** 推送晚到时画面已经走到的位置：外推追上之前读数停在这里。没有时为 null。 */
    floorSec: number | null;
};

export type HifiClockSync = {
    positionSec: number;
    paused: boolean;
    /** 省略时沿用上一次的时长，null 表示时长未知。 */
    durationSec?: number | null;
    nowMs?: number;
    /** 播放中的例行 tick：比当前读数稍早时不往回拉（见 MAX_HELD_LAG_SEC）。 */
    holdBackward?: boolean;
};

export type HifiClock = {
    sync: (update: HifiClockSync) => void;
    read: (nowMs?: number) => number;
    /** 只换时长：基准、起算时刻和停住的位置都不动。 */
    setDuration: (durationSec: number | null) => void;
    state: () => HifiClockState;
};

const normalizeDuration = (durationSec: number | null): number | null => (
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null
);

const clampToDuration = (timeSec: number, durationSec: number | null) => {
    const nonNegative = Math.max(timeSec, 0);
    return durationSec === null ? nonNegative : Math.min(nonNegative, durationSec);
};

export const createHifiClock = (): HifiClock => {
    let clock: HifiClockState = { baseSec: 0, startedAtMs: null, paused: true, durationSec: null, floorSec: null };

    const extrapolate = (nowMs: number) => {
        if (clock.startedAtMs === null) return clock.baseSec;
        const elapsedSec = Math.min(Math.max(0, (nowMs - clock.startedAtMs) / 1000), MAX_EXTRAPOLATION_SEC);
        return clock.baseSec + elapsedSec;
    };

    const read = (nowMs = performance.now()) => {
        const timeSec = extrapolate(nowMs);
        return clampToDuration(clock.floorSec === null ? timeSec : Math.max(timeSec, clock.floorSec), clock.durationSec);
    };

    const sync = ({ positionSec, paused, durationSec, nowMs = performance.now(), holdBackward = false }: HifiClockSync) => {
        const nextDuration = durationSec === undefined ? clock.durationSec : normalizeDuration(durationSec);
        const safePosition = Number.isFinite(positionSec) ? positionSec : 0;
        const baseSec = clampToDuration(safePosition, nextDuration);
        let floorSec: number | null = null;
        if (holdBackward && !paused && !clock.paused) {
            const shownSec = read(nowMs);
            const lagSec = shownSec - baseSec;
            if (lagSec > 0 && lagSec <= MAX_HELD_LAG_SEC) floorSec = shownSec;
        }
        clock = {
            baseSec,
            startedAtMs: paused ? null : nowMs,
            paused,
            durationSec: nextDuration,
            floorSec,
        };
    };

    const setDuration = (durationSec: number | null) => {
        clock = { ...clock, durationSec: normalizeDuration(durationSec) };
    };

    return { sync, read, setDuration, state: () => ({ ...clock }) };
};
