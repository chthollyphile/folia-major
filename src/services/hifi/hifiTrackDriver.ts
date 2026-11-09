import type { HifiClockUpdate, HifiEngineState } from '../../types/hifi';
import { MAX_EXTRAPOLATION_SEC } from './hifiClock';
import { hifiMediaShim } from './hifiMediaShim';
import { hifiPlaybackClock, isCurrentHifiTrackKey } from './hifiTrackStore';

// src/services/hifi/hifiTrackDriver.ts
// 主进程推来的引擎状态和时钟 → 播放时钟和 shim。只认当前曲目的推送，别的 trackKey（被顶替的、预载的）一律不理。

const isValidDuration = (durationSec: number | null): durationSec is number => (
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
);

/** 只换时钟的时长：基准位置和起算时刻原样保留，外推的上限也就不会被一次状态推送续上。 */
const syncClockDuration = (durationSec: number) => {
    if (hifiPlaybackClock.state().durationSec === durationSec) return;
    hifiPlaybackClock.setDuration(durationSec);
};

/**
 * 推送从主进程读到位置到这里处理掉过了多久（毫秒）。两边用同一个墙钟；主进程忙或渲染进程卡一下，这段能有几百毫秒，
 * 播放中按它把位置补到现在，不补就等于把画面往回拉这么多。负数（时钟被调过）当 0，太大的不补满，跟外推同一个上限。
 */
const clockUpdateAgeSec = (update: HifiClockUpdate, nowWallMs: number) => {
    if (typeof update.sampledAtMs !== 'number' || !Number.isFinite(update.sampledAtMs)) return 0;
    return Math.min(Math.max(0, (nowWallMs - update.sampledAtMs) / 1000), MAX_EXTRAPOLATION_SEC);
};

/**
 * 当前曲目的引擎状态 → 时长、shim 的播放 / 暂停 / 结束。只在状态翻转时派发，传输控制乐观改过的不会再派发一遍。
 * 播放 / 暂停看状态不看时钟：时钟的 paused 还包括缓冲和跳转中，<audio> 那时的 paused 并不变。
 */
export const applyHifiEngineState = (state: HifiEngineState) => {
    if (!isCurrentHifiTrackKey(state.trackKey)) return;
    if (isValidDuration(state.durationSec)) {
        syncClockDuration(state.durationSec);
        hifiMediaShim.setDuration(state.durationSec);
    }
    if (state.status === 'ended') {
        if (hifiMediaShim.ended) return;
        const endSec = isValidDuration(state.durationSec) ? state.durationSec : hifiPlaybackClock.read();
        hifiPlaybackClock.sync({ positionSec: endSec, paused: true });
        hifiMediaShim.markEnded();
        return;
    }
    if (state.status === 'playing') {
        if (hifiMediaShim.paused) hifiMediaShim.markPlaying();
        return;
    }
    if (state.paused && !hifiMediaShim.paused) hifiMediaShim.markPaused();
};

/** 当前曲目的时钟推送 → 外推时钟（补上推送路上耽搁的时间，晚到的 tick 不往回拉）；跳转（含单曲循环绕回开头）补一次 seeked。 */
export const applyHifiClock = (update: HifiClockUpdate, nowWallMs = Date.now()) => {
    if (!isCurrentHifiTrackKey(update.trackKey)) return;
    const ageSec = update.paused ? 0 : clockUpdateAgeSec(update, nowWallMs);
    hifiPlaybackClock.sync({
        positionSec: update.positionSec + ageSec,
        paused: update.paused,
        // 只有例行 tick 不许往回拉：跳转、暂停、恢复、载入报的位置就是要显示的位置。
        holdBackward: update.reason === 'tick',
    });
    if (update.reason === 'seek') hifiMediaShim.markSeeked();
};
