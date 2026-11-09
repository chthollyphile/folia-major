import type { HifiEngineState } from '../../types/hifi';
import { setPlaybackRoute, usePlaybackStore } from '../../stores/usePlaybackStore';
import { hifiEngine, useHifiEngineStore } from './hifiEngine';
import { clearHifiTrack, isCurrentHifiTrackKey, nextHifiAttempt, useHifiTrackStore } from './hifiTrackStore';

// src/services/hifi/hifiRouteGuard.ts
// 离开 HiFi 路线的唯一出口：Web 引擎接手（audioSrc 有值）、Stage 接管、或别处把路线改回 web 时，当场停掉 mpv、放开独占的设备。
// 也管上一个窗口留下、这个窗口没接管的那一首：这个窗口用上 Web 引擎或恢复没接管它时，一样停掉。

export const isHifiRoute = () => usePlaybackStore.getState().playbackRoute === 'hifi';

// beginHifiTrack 自己写 audioSrc / playbackRoute 的那几下，以及 leaveHifiRoute 自己切路线的那一下，守卫不管。
let ownWriteDepth = 0;

export const withoutRouteGuard = (write: () => void) => {
    ownWriteDepth += 1;
    try {
        write();
    } finally {
        ownWriteDepth -= 1;
    }
};

/** 作废进行中的起播，清掉当前曲目、shim 和登记的文件，停掉 mpv。 */
const releaseHifi = (reason: string) => {
    nextHifiAttempt();
    const trackKey = useHifiTrackStore.getState().current?.trackKey ?? null;
    clearHifiTrack();
    hifiEngine.responder.clear();
    void hifiEngine.stop();
    console.info('[HiFi] left the HiFi route', { reason, trackKey });
};

/**
 * 离开 HiFi 路线，给那些停播却不设 Web 源的路径用（如切换资料库平台）。不在 HiFi 路线上、也没有当前曲目时什么都不做。
 * 先停 mpv、清曲目、重置 shim，再把路线切回 web，全在这一次调用里同步发出：对路线变化同步做出反应的订阅者看到的 mpv 已经停了。
 */
export const leaveHifiRoute = (reason = 'explicit') => {
    if (!isHifiRoute() && !useHifiTrackStore.getState().current) return false;
    releaseHifi(reason);
    withoutRouteGuard(() => setPlaybackRoute('web'));
    return true;
};

// 这个窗口装上时主进程里已经在放（或停在结尾）、这个窗口还没接管的那一首：窗口重建或渲染进程重载前留下的。
// 恢复接管了它、或主进程换了别的曲目，就不再算。
let unclaimedTrackKey: string | null = null;

/**
 * 停掉上一个窗口留下、这个窗口没接管的那一首（见 unclaimedTrackKey）。这个窗口自己已经有 HiFi 曲目（接管了它，或新的载入
 * 正要顶替它），或主进程已经不放它了，就只是忘掉它。恢复落空（没找到、失败、被顶替）和这个窗口用上 Web 引擎时调用。
 */
export const releaseUnclaimedHifiTrack = (reason: string) => {
    const trackKey = unclaimedTrackKey;
    if (trackKey === null) return false;
    unclaimedTrackKey = null;
    if (useHifiTrackStore.getState().current) return false;
    if (useHifiEngineStore.getState().engine?.trackKey !== trackKey) return false;
    void hifiEngine.stop();
    console.info('[HiFi] stopped the track an earlier window left playing', { reason, trackKey });
    return true;
};

/** installHifiPlayback 拿到的第一份快照：主进程有曲目、这个窗口不是它的主人，就记下；这个窗口已经在用 Web 引擎了就当场停掉。 */
export const noteUnclaimedHifiTrack = (snapshot: HifiEngineState | null) => {
    if (!snapshot?.processRunning || snapshot.trackKey === null || isCurrentHifiTrackKey(snapshot.trackKey)) return;
    unclaimedTrackKey = snapshot.trackKey;
    const playback = usePlaybackStore.getState();
    if (playback.playbackRoute === 'web' && playback.audioSrc !== null) releaseUnclaimedHifiTrack('web source');
};

/** 主进程推来的状态：曲目换了（被接管后换歌、被停掉），留下的那一首就不再算。 */
export const forgetUnclaimedUnless = (trackKey: string | null) => {
    if (unclaimedTrackKey !== null && trackKey !== unclaimedTrackKey) unclaimedTrackKey = null;
};

/** 恢复接管了这一首。 */
export const claimHifiTrack = (trackKey: string) => {
    if (unclaimedTrackKey === trackKey) unclaimedTrackKey = null;
};

/**
 * zustand 的订阅在 setState 里同步执行，早于 React 渲染、也早于 <audio> 换源：Web 引擎接手的那一下 mpv 已经停了，
 * 独占的设备先放开。返回退订函数。
 */
export const installHifiRouteGuard = () => usePlaybackStore.subscribe((state, previous) => {
    if (ownWriteDepth > 0) return;
    if (state.playbackRoute === 'hifi') {
        if (state.audioSrc !== null) leaveHifiRoute('web source');
        else if (state.activePlaybackContext === 'stage') leaveHifiRoute('stage');
        return;
    }
    // 别处直接把路线改回了 web：曲目、shim 和 mpv 跟着收拾。
    if (previous.playbackRoute === 'hifi') releaseHifi('route set to web');
    // 一直在 Web 路线上的窗口换上了 Web 源：上一个窗口留下的那一首不会再有人接管。
    else if (state.audioSrc !== null && state.audioSrc !== previous.audioSrc) releaseUnclaimedHifiTrack('web source');
});
