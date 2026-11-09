import type { MutableRefObject } from 'react';
import { PlayerState } from '../../types';
import type { SongResult } from '../../types';
import type { PlaybackNavigationOptions } from '../../types/appPlayback';
import { currentTime } from '../../stores/motionSignals';
import { setPlayerState, startLoadingToPlay, usePlaybackStore } from '../../stores/usePlaybackStore';
import { hifiMediaShim } from '../../services/hifi/hifiMediaShim';
import {
    getHifiPosition,
    hifiPlaybackClock,
    hifiTransport,
    isHifiRoute,
    isHifiTrackWaitingForDevice,
    loadDeferredHifiTrack,
    retryBusyHifiTrack,
    useHifiTrackStore,
    type HifiTrack,
} from '../../services/hifi/hifiPlayback';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// src/components/hifi/hifiRouteTransport.ts
// HiFi 路线上给传输控制用的播放和跳转，以及它们和播放桥共用的两份模块级状态：起播时交来的播放意图、队尾停掉 mpv 后等着重放的那一首。
// 这一首挪去 Web 引擎（失败回落、关掉 HiFi）和队尾之后的重放都经 playSong，也在这里。

export type HifiPlaySong = (
    song: SongResult,
    queue?: SongResult[],
    isFmCall?: boolean,
    options?: PlaybackNavigationOptions,
) => Promise<void> | void;

// 队尾停掉 mpv 之后，这一首再按播放要重放（mpv 里已经没有它了）：停的时候记下怎么重放；之后的跳转只改重放的起点。
let queueEndReplay: { trackKey: string; startAtSec: number; replay: (startAtSec: number) => void } | null = null;
// 桥挂载时交来的播放意图（和 Web 引擎的自动播放是同一个 ref），以及已经开播过（或恢复时决定停着）的那一首：
// 模块级的 resumeHifiPlayback / seekHifiRoute 也要用掉或补上这份意图。
const intent: { ref: MutableRefObject<boolean> | null; startedTrackKey: string | null } = { ref: null, startedTrackKey: null };

/** 桥挂载时交来播放意图的 ref；返回的函数在卸载时交还，连同“已经开播过的那一首”一起忘掉。 */
export const bindHifiPlayIntent = (ref: MutableRefObject<boolean>) => {
    intent.ref = ref;
    return () => {
        intent.ref = null;
        intent.startedTrackKey = null;
    };
};

/** 这一首已经开播过，或恢复时已经决定停着：自动播放不再碰它。 */
export const isHifiTrackStarted = (trackKey: string) => intent.startedTrackKey === trackKey;

export const markHifiTrackStarted = (trackKey: string) => {
    intent.startedTrackKey = trackKey;
};

/**
 * 这一首第一次开播了（不管是谁按的）：用掉播放意图，之后歌词载完时的自动播放不会再把听的人按下的暂停顶掉。
 * 已经开播过的那一首再开播不碰意图：那时的意图（如果有）是之后一次播放的，比如正在取地址的在线歌曲。
 */
export const spendHifiPlayIntent = (trackKey: string) => {
    if (intent.startedTrackKey === trackKey) return;
    if (intent.ref) intent.ref.current = false;
    intent.startedTrackKey = trackKey;
};

/**
 * mpv 无缝接上的那一首被 playSong 认领了：那次播放的意图就是让它接着放，这里用掉。和 spendHifiPlayIntent 不同，这一首早已
 * 开播（接上时就记成开播过），意图照样用掉：它是认领它的那次播放刚交来的。
 */
export const spendAdoptedPlayIntent = (trackKey: string) => {
    if (intent.ref) intent.ref.current = false;
    intent.startedTrackKey = trackKey;
};

/** 队尾停掉 mpv 后还等着重放的那一首，是当前曲目时才算。 */
const pendingQueueEndReplay = (trackKey: string | null | undefined) => (
    queueEndReplay && queueEndReplay.trackKey === trackKey ? queueEndReplay : null
);

/** 桥卸载时调用：等着的队尾重放不再算数。 */
export const clearQueueEndReplay = () => {
    queueEndReplay = null;
};

/** 这首歌在当前 store 里的那个对象（同一首歌恢复或补全过信息后是另一个对象），不是当前歌时用起播时的那个。 */
const liveSongOf = (track: HifiTrack): SongResult => {
    const song = usePlaybackStore.getState().currentSong;
    return song && getPlaybackSongKey(song) === track.songKey ? song : track.song;
};

/**
 * 让 playSong 再放这一首，按当前的队列和私人 FM，不跳到播放页。路线由它照常判：失败回落时这首已记成 forcedWeb、关掉 HiFi 时
 * 设置已经不让，都会走 Web 引擎；队尾重放时多半还是 HiFi。
 */
const replayOnPlaySong = (
    playSong: HifiPlaySong,
    track: HifiTrack,
    label: string,
    options: PlaybackNavigationOptions = {},
) => {
    Promise.resolve(playSong(liveSongOf(track), [], usePlaybackStore.getState().isFmMode, { shouldNavigateToPlayer: false, ...options }))
        .catch(error => console.warn(`[HiFi] ${label} failed`, error));
};

/** 队尾停掉了 mpv：记下这一首之后按播放时怎么重放。playSong 到重放那一刻才取，用的是桥那时的最新版本。 */
export const armQueueEndReplay = (track: HifiTrack, getPlaySong: () => HifiPlaySong) => {
    queueEndReplay = {
        trackKey: track.trackKey,
        startAtSec: 0,
        replay: startAtSec => replayOnPlaySong(
            getPlaySong(),
            track,
            'replay after the queue end',
            startAtSec > 0 ? { startAtSec } : {},
        ),
    };
};

/**
 * 把这一首挪到 Web 引擎上接着放：从 HiFi 现在的位置开始（队尾停下之后是重放的起点），在放或正要开播就接着放，
 * 停着就停着；不再弹“已载入”，挪走的原因那条提示留着。
 */
export const moveHifiTrackToWeb = (playSong: HifiPlaySong, track: HifiTrack, label: string) => {
    const pending = pendingQueueEndReplay(track.trackKey);
    if (pending) queueEndReplay = null;
    const playing = usePlaybackStore.getState().playerState === PlayerState.PLAYING || !hifiMediaShim.paused;
    replayOnPlaySong(playSong, track, label, {
        startAtSec: pending ? pending.startAtSec : getHifiPosition(),
        autoplay: !pending && (intent.ref?.current === true || playing),
        quietLoadedToast: true,
    });
};

/**
 * 载入一直报 DEVICE_BUSY（别的程序独占着设备）：这一首留在 HiFi 路线上停着，不交给 Web 引擎。Windows、macOS 上 Web 引擎
 * 在同一台设备上也出不了声：实测 Chromium 要么改从系统默认设备出声，要么卡在 0:00，设备放开后也不会自己恢复。
 * 意图用掉，状态写成暂停；之后按播放由 resumeHifiPlayback 再载一次。
 */
export const holdHifiTrackForDevice = (trackKey: string) => {
    spendHifiPlayIntent(trackKey);
    if (!hifiMediaShim.paused) hifiMediaShim.markPaused();
    setPlayerState(PlayerState.PAUSED);
};

/**
 * HiFi 路线上的“播放”。平常是让 mpv 接着放。队尾停掉 mpv 之后再按，交给 playSong 重放这一首：从头，或从停下后跳到的位置
 * （Web 引擎放完再按也是这样）。恢复时还没载入的那一首，这时才载入，载入好由自动播放开播。
 * 返回 true 表示接着放了，调用方照常把状态写成 PLAYING；false 表示状态由别处写（playSong，或载入好之后的自动播放）。
 */
export const resumeHifiPlayback = (): boolean => {
    const { current, loadState } = useHifiTrackStore.getState();
    const pending = pendingQueueEndReplay(current?.trackKey);
    if (pending) {
        queueEndReplay = null;
        pending.replay(pending.startAtSec);
        return false;
    }
    if (current && loadState === 'deferred') {
        if (intent.ref) intent.ref.current = true;
        intent.startedTrackKey = null;
        startLoadingToPlay();
        void loadDeferredHifiTrack();
        return false;
    }
    // 停在“设备被别的程序占着”上：再载一次，载入好由自动播放开播；还忙就又停回来，再提示一次。
    if (current && isHifiTrackWaitingForDevice(current.trackKey)) {
        if (intent.ref) intent.ref.current = true;
        intent.startedTrackKey = null;
        startLoadingToPlay();
        void retryBusyHifiTrack();
        return false;
    }
    if (current) spendHifiPlayIntent(current.trackKey);
    void hifiTransport.resume();
    return true;
};

/**
 * HiFi 路线上的跳转；不在 HiFi 路线上时返回 false，调用方走原来的路。进度条的 motion value 当场设好。
 * resume 为 true 时（进度条、歌词行点按，即 seekMainAudio）停着的歌顺带开始播，和它对 <audio> 的做法一样；方向键和遥控器的跳转不带它。
 * mpv 里没有这一首时（队尾停掉了，或恢复时还没载入）不发给 mpv：时钟停到目标，重放或载入从那里开始；没载入的那一首跳一下就载入。
 */
export const seekHifiRoute = (timeSec: number, { resume = false }: { resume?: boolean } = {}): boolean => {
    if (!isHifiRoute()) return false;
    if (!Number.isFinite(timeSec)) return true;
    const target = Math.max(0, timeSec);
    const { current, loadState } = useHifiTrackStore.getState();
    const pending = pendingQueueEndReplay(current?.trackKey);
    // 等设备的那一首 mpv 里没有：只挪时钟，再按播放时从这里载入。
    const waitingForDevice = isHifiTrackWaitingForDevice(current?.trackKey);
    if (pending || loadState === 'deferred' || waitingForDevice) {
        hifiPlaybackClock.sync({ positionSec: target, paused: true });
        hifiMediaShim.markSeeked();
        if (pending) pending.startAtSec = target;
        else if (!resume && !waitingForDevice) void loadDeferredHifiTrack();
    } else {
        void hifiTransport.seek(target);
    }
    currentTime.set(target);
    if (resume && hifiTransport.isPaused() && resumeHifiPlayback()) setPlayerState(PlayerState.PLAYING);
    return true;
};
