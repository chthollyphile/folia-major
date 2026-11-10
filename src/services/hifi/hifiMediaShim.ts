import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { MEDIA_SHIM_TIMEUPDATE_INTERVAL_MS, MediaShim, type ObservedMedia } from '../mediaShim';

// src/services/hifi/hifiMediaShim.ts
// mpv 发声时给只读的观察者（Media Session、遥控器、听歌上报、Navidrome scrobble……）一个长得像 <audio> 的对象：
// 属性只读，事件按 HTML 媒体元素的顺序和节奏派发，状态由 HiFi 播放桥驱动。
// 另一个引擎在自己的播放器里发声时（`externalPlayback`），它同样有一份 shim，由那条路线注册进来。

export type { ObservedMedia } from '../mediaShim';

/** 和原生元素一样约 4 Hz；两次之间的媒体时间差必须远小于听歌统计判定 seek 的 2 秒。 */
export const HIFI_TIMEUPDATE_INTERVAL_MS = MEDIA_SHIM_TIMEUPDATE_INTERVAL_MS;

export class HifiMediaShim extends MediaShim {
    constructor(readClock?: () => number) {
        super('hifi:', readClock);
    }
}

/** 全局只有一个 shim，观察者拿到的对象身份不随换歌变化。 */
export const hifiMediaShim = new HifiMediaShim();

// 别的引擎路线上的 shim，由那条路线自己注册：读数时它一定已经装好。
let otherRouteMedia: (() => ObservedMedia | null) | null = null;

/** 注册 `external` 路线发声时观察者该看的那份 shim。 */
export const setExternalRouteMedia = (reader: (() => ObservedMedia | null) | null) => {
    otherRouteMedia = reader;
};

/** 观察者该看的媒体：走 HiFi 或外部播放器时是它自己的 shim，否则是传入的 <audio>。 */
export const getObservedMedia = (fallback: HTMLAudioElement | null): ObservedMedia | null => {
    switch (usePlaybackStore.getState().playbackRoute) {
        case 'hifi': return hifiMediaShim;
        case 'external': return otherRouteMedia?.() ?? null;
        default: return fallback;
    }
};
