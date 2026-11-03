import { create } from 'zustand';
import type { SongResult } from '../../types';
import type { HifiErrorCode, HifiSourceSpec } from '../../types/hifi';
import { createHifiClock, type HifiClockSync } from './hifiClock';
import { hifiMediaShim } from './hifiMediaShim';
import type { HifiTrackSource } from './hifiTrackLoad';

// src/services/hifi/hifiTrackStore.ts
// HiFi 路线上的当前曲目：是哪一首、载入到哪一步、源是什么格式，以及按 mpv 推来的位置外推的播放时钟。写它的只有 services/hifi 里的
// 几处：hifiPlayback（起播、接管、认领无缝接上的那首）、hifiTrackLoad（载入结果、延后载入、源格式）、hifiGapless（排着的下一首、
// 接上时换成当前曲目）和 hifiRouteGuard（离开路线时清空），都经下面的 showHifiTrack / clearHifiTrack 或直接 setState。

export type HifiTrack = {
    /** 这一次起播的键（songKey + 随机后缀）；接管窗口重建前的播放时是主进程那份的键。 */
    trackKey: string;
    songKey: string;
    origin: 'local' | 'navidrome';
    song: SongResult;
    /** 本地歌曲登记在 hifiEngine.responder 的键；Navidrome 为 null。 */
    localSourceKey: string | null;
    /**
     * 起播（或恢复）拿到的“还要不要这一首”：之后又有一次播放开始了、还在路上就答否；那次播放没放成、放弃了，就又答是
     * （起播给的是 startPlay() 的 onceShown，见 currentSong.ts）。失败回落、关掉 HiFi 和无缝接上时先问它，答否就不动，
     * 免得把那次更新的播放顶掉。没有时算一直要。
     */
    stillWanted?: () => boolean;
    /**
     * mpv 无缝接上了预载的这一首，播放器那一侧（队列、歌词、封面）还停在上一首：桥让 playSong 换过去，beginHifiTrack 认领它
     * （不重新载入）时清掉。
     */
    promotedByGapless?: boolean;
};

/** 用 loadfile append 交给 mpv 预载、等着无缝接上的下一首，带着它的源（接上时读源格式要用）。 */
export type HifiNextTrack = HifiTrack & { source: HifiTrackSource };

/**
 * deferred：恢复时没有播放意图，先不载入、不开输出设备；曲目照样显示，位置和时长取自恢复的数据。第一次播放、跳转或自动播放时
 * 才真正载入（loadDeferredHifiTrack）。
 */
export type HifiLoadState = 'idle' | 'deferred' | 'loading' | 'ready' | 'failed';

export type HifiTrackStoreState = {
    current: HifiTrack | null;
    loadState: HifiLoadState;
    /** loadState 为 'failed' 时的错误码。 */
    loadError: HifiErrorCode | null;
    /** 后台读出的源格式；还没读完或读不出时为 null。 */
    sourceSpec: HifiSourceSpec | null;
    /** 预载在 mpv 里、排在当前曲目后面的下一首（hifiGapless）；换上任何一首新的当前曲目时清掉。 */
    next: HifiNextTrack | null;
};

const EMPTY_TRACK_STATE: HifiTrackStoreState = { current: null, loadState: 'idle', loadError: null, sourceSpec: null, next: null };

export const useHifiTrackStore = create<HifiTrackStoreState>(() => ({ ...EMPTY_TRACK_STATE }));

/** mpv 位置的外推时钟：可视化、歌词和 shim 的 currentTime 都读它。 */
export const hifiPlaybackClock = createHifiClock();

export const getHifiPosition = () => hifiPlaybackClock.read();

// 每次起播或离开 HiFi 路线都换一个号；await 回来时号已不是自己的，说明被顶替了，什么都不写。
let attemptId = 0;

export const nextHifiAttempt = () => {
    attemptId += 1;
    return attemptId;
};

export const isCurrentHifiAttempt = (id: number) => id === attemptId;

/** 换上一首：时钟、shim 和 store 一起换，观察者不会在新歌上看到上一首残留的播放状态。 */
export const showHifiTrack = (
    track: HifiTrack,
    clock: HifiClockSync,
    patch: Partial<Omit<HifiTrackStoreState, 'current'>> = {},
) => {
    hifiPlaybackClock.sync(clock);
    hifiMediaShim.beginTrack(track.trackKey);
    useHifiTrackStore.setState({ ...EMPTY_TRACK_STATE, loadState: 'loading', ...patch, current: track });
};

/** 没有当前曲目了：时钟归零停住，shim 回到没有源的样子，store 清空。 */
export const clearHifiTrack = (patch: Partial<Omit<HifiTrackStoreState, 'current'>> = {}) => {
    hifiPlaybackClock.sync({ positionSec: 0, paused: true, durationSec: null });
    hifiMediaShim.reset();
    useHifiTrackStore.setState({ ...EMPTY_TRACK_STATE, ...patch });
};

export const isCurrentHifiTrackKey = (trackKey: string | null) => (
    trackKey !== null && trackKey === useHifiTrackStore.getState().current?.trackKey
);
