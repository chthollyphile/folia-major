import { hifiEngine } from './hifiEngine';
import { hifiMediaShim } from './hifiMediaShim';
import { isHifiRoute } from './hifiRouteGuard';
import { hifiPlaybackClock, useHifiTrackStore } from './hifiTrackStore';

// src/services/hifi/hifiTransport.ts
// HiFi 路线的播放、暂停、跳转：发 IPC，同时先把 shim 和时钟改成预期的样子，主进程的推送随后校正。不在 HiFi 路线上时什么都不做。

const hasHifiTrack = () => isHifiRoute() && useHifiTrackStore.getState().current !== null;

export const hifiTransport = {
    resume: () => {
        if (!hasHifiTrack()) return Promise.resolve();
        // 时钟不先走：等主进程的 resume 推送带着真实位置再走，歌词不会抢在声音前面。
        if (hifiMediaShim.paused) hifiMediaShim.markPlaying();
        return hifiEngine.play();
    },
    pause: () => {
        if (!hasHifiTrack()) return Promise.resolve();
        hifiPlaybackClock.sync({ positionSec: hifiPlaybackClock.read(), paused: true });
        hifiMediaShim.markPaused();
        return hifiEngine.pause();
    },
    /** 时钟先停在目标位置，等主进程跳完推 resume 再走；进度条的 motion value 由调用方自己设。 */
    seek: (positionSec: number) => {
        if (!hasHifiTrack() || !Number.isFinite(positionSec)) return Promise.resolve();
        const target = Math.max(0, positionSec);
        hifiPlaybackClock.sync({ positionSec: target, paused: true });
        return hifiEngine.seek(target);
    },
    /** 没有当前曲目、暂停着或已放完时为 true。 */
    isPaused: () => !useHifiTrackStore.getState().current || hifiMediaShim.paused,
};
