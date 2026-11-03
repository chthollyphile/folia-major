import { useEffect, useMemo, useRef } from 'react';
import { PlayerState } from '../../types';
import type { SongResult, StageLoopMode } from '../../types';
import type { NextTrackOptions } from '../../types/appPlayback';
import type { HifiPlaybackStatus, PlaybackRoute } from '../../types/hifi';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { setPlayerState, usePlaybackStore } from '../../stores/usePlaybackStore';
import { hifiEngine, useHifiEngineStore } from '../../services/hifi/hifiEngine';
import { hifiMediaShim } from '../../services/hifi/hifiMediaShim';
import { playbackKindOfSong } from '../../services/hifi/hifiEligibility';
import {
    clearNextHifiTrack,
    hifiRouteFor,
    hifiTransport,
    isHifiRoute,
    preloadNextHifiTrack,
    useHifiTrackStore,
    type HifiLoadState,
    type HifiTrack,
} from '../../services/hifi/hifiPlayback';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { nextQueueIndex, queueIndexOf, queueLoopMode } from '../../utils/playbackNeighbors';
import { loadQueuedSongHifiSource } from '../app/playback/source/songAudioSource';
import { armQueueEndReplay, spendAdoptedPlayIntent, type HifiPlaySong } from './hifiRouteTransport';

// src/components/hifi/useHifiGaplessPreload.ts
// 无缝接播在 React 这一侧：按队列、循环和私人 FM 算出下一首（和 handleNextTrack 同一套下标规则），当前这首在 HiFi 上载入好、
// 放着或停着满 2 秒，下一首也走 HiFi，就读它的源交给 hifiGapless 预载；下一首变了（改队列、打乱、换循环、进出私人 FM、换歌、
// 离开 HiFi）就撤掉。mpv 接上它时让 handleNextTrack 照常换到它，playSong 认领之后把播放器摆回在放。

/** 当前这首满足条件多久之后才预载下一首：刚换歌、刚改队列时不急着读文件。 */
export const GAPLESS_PRELOAD_DELAY_MS = 2000;

type RouteFor = (kind: 'local' | 'navidrome', songKey: string) => PlaybackRoute;

export type HifiGaplessInput = {
    playbackRoute: PlaybackRoute;
    current: Pick<HifiTrack, 'trackKey' | 'songKey' | 'promotedByGapless'> | null;
    loadState: HifiLoadState;
    /** 主进程最新状态里的当前曲目和状态。 */
    engineTrackKey: string | null;
    engineStatus: HifiPlaybackStatus | null;
    playQueue: SongResult[];
    currentSong: SongResult | null;
    loopMode: StageLoopMode;
    isFmMode: boolean;
};

/**
 * 现在该排在 mpv 里的下一首，不该排时为 null：HiFi 路线上的当前这首已经载入好、mpv 正放着或停着它、不是刚接上还没被认领的那首，
 * 播放器那一侧也已经是这首歌；单曲循环（私人 FM 里不算，和 loop-file 同一条规则）时 mpv 自己循环，不排。下一首按 handleNextTrack
 * 的下标规则取，要走 HiFi，且不是同一首歌（只有一首的列表循环是重播，不是接播）。
 */
export const hifiGaplessNextSong = (
    { playbackRoute, current, loadState, engineTrackKey, engineStatus, playQueue, currentSong, loopMode, isFmMode }: HifiGaplessInput,
    routeFor: RouteFor = hifiRouteFor,
): SongResult | null => {
    if (playbackRoute !== 'hifi' || !current || current.promotedByGapless || loadState !== 'ready') return null;
    if (engineTrackKey !== current.trackKey || (engineStatus !== 'playing' && engineStatus !== 'paused')) return null;
    if (loopMode === 'one' && !isFmMode) return null;
    if (!currentSong || getPlaybackSongKey(currentSong) !== current.songKey) return null;
    const nextIndex = nextQueueIndex(playQueue.length, queueIndexOf(playQueue, currentSong), queueLoopMode(loopMode, isFmMode));
    const next = nextIndex >= 0 ? playQueue[nextIndex] : null;
    if (!next) return null;
    const songKey = getPlaybackSongKey(next);
    if (songKey === current.songKey) return null;
    const kind = playbackKindOfSong(next);
    if (kind !== 'local' && kind !== 'navidrome') return null;
    return routeFor(kind, songKey) === 'hifi' ? next : null;
};

type GaplessFollowParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    playSong: HifiPlaySong;
};

/**
 * mpv 无缝接上了预载的那一首：让 handleNextTrack 照常换到下一首（队列、歌词、封面、上报都走 playSong 那条路），playSong 落到
 * 这首歌时 beginHifiTrack 认领它。接上之前已经又开始了一次播放（按了下一首、点了别的歌）就不换：那次播放落地时，是这首歌就认领，
 * 不是就照常载入顶掉它。队列在这一下改过、上一首后面没有歌了：停掉 mpv 放开设备，再按播放从头重放上一首。
 */
const followGaplessSwitch = async (track: HifiTrack, previous: HifiTrack | null, latest: () => GaplessFollowParams) => {
    if (useHifiTrackStore.getState().current !== track) return;
    // 接上的这一首一开头就出错了：桥的回落让它在 Web 引擎上重放（也经 playSong），这里不再换下一首。
    const engine = useHifiEngineStore.getState().engine;
    if (engine?.trackKey === track.trackKey && engine.status === 'error') return;
    if (track.stillWanted?.() === false) {
        console.info('[HiFi] mpv switched gaplessly while a newer play was on its way, leaving the song to it', { trackKey: track.trackKey });
        return;
    }
    await latest().handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
    const now = useHifiTrackStore.getState().current;
    if (!isHifiRoute() || now?.trackKey !== track.trackKey || !now.promotedByGapless) return;
    if (usePlaybackStore.getState().playerState !== PlayerState.IDLE) return;
    if (previous) armQueueEndReplay({ ...previous, trackKey: track.trackKey }, () => latest().playSong);
    console.info('[HiFi] the queue ended at the gapless switch, mpv stopped to release the output device', { trackKey: track.trackKey });
    void hifiEngine.stop();
};

/**
 * playSong 认领了无缝接上的那一首：onPlay* 刚把播放器写成“载入中”，按 mpv 实际的样子摆回在放（或停着），用掉这次播放的意图。
 * 在放时 shim 再报一次开播：mpv 接上时的那次 play / playing 派发在播放器换歌之前，换歌时才开始的上报会话没听到。
 */
const settleAdoptedTrack = (trackKey: string) => {
    if (!isHifiRoute() || useHifiTrackStore.getState().current?.trackKey !== trackKey) return;
    // 认领之前它已经放完或出错了：那归桥的放完和回落。
    const engine = useHifiEngineStore.getState().engine;
    if (engine?.trackKey === trackKey && engine.status !== 'playing' && engine.status !== 'paused') return;
    spendAdoptedPlayIntent(trackKey);
    const paused = hifiTransport.isPaused();
    setPlayerState(paused ? PlayerState.PAUSED : PlayerState.PLAYING);
    if (!paused) hifiMediaShim.announceStart();
};

type UseHifiGaplessPreloadParams = GaplessFollowParams & {
    loopMode: StageLoopMode;
    isFmMode: boolean;
};

// 由 useHifiPlaybackBridge 挂一次。
export function useHifiGaplessPreload({ handleNextTrack, playSong, loopMode, isFmMode }: UseHifiGaplessPreloadParams) {
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const current = useHifiTrackStore(state => state.current);
    const loadState = useHifiTrackStore(state => state.loadState);
    const nextSongKey = useHifiTrackStore(state => state.next?.songKey ?? null);
    const engineTrackKey = useHifiEngineStore(state => state.engine?.trackKey ?? null);
    const engineStatus = useHifiEngineStore(state => state.engine?.status ?? null);
    // hifiRouteFor 自己读这些 store；订阅它们只是为了在设置、运行时或熔断变了时重新判一次。
    const enabled = useHifiSettingsStore(state => state.enabled);
    const navidrome = useHifiSettingsStore(state => state.navidrome);
    const runtimeAvailable = useHifiEngineStore(state => state.runtime?.available === true);
    const circuitOpen = useHifiEngineStore(state => state.circuitOpen);

    const latestRef = useRef<GaplessFollowParams>({ handleNextTrack, playSong });
    useEffect(() => {
        latestRef.current = { handleNextTrack, playSong };
    });

    const desired = useMemo(() => hifiGaplessNextSong({
        playbackRoute, current, loadState, engineTrackKey, engineStatus, playQueue, currentSong, loopMode, isFmMode,
    }),
    // enabled、navidrome、runtimeAvailable、circuitOpen 不在函数体里，是 hifiRouteFor 读的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [circuitOpen, current, currentSong, enabled, engineStatus, engineTrackKey, isFmMode, loadState, loopMode, navidrome, playQueue, playbackRoute, runtimeAvailable]);
    const desiredKey = desired ? getPlaybackSongKey(desired) : null;
    const desiredRef = useRef<SongResult | null>(desired);
    useEffect(() => {
        desiredRef.current = desired;
    });
    const trackKey = current?.trackKey ?? null;

    // 排着的不是现在该排的那首（或者现在什么都不该排）：撤掉。
    useEffect(() => {
        if (nextSongKey !== null && nextSongKey !== desiredKey) void clearNextHifiTrack();
    }, [desiredKey, nextSongKey]);

    // 该排的那首还没排上：条件持续满 GAPLESS_PRELOAD_DELAY_MS 再读它的源、交给 mpv。中途任何一项变了就重新计时。
    useEffect(() => {
        if (desiredKey === null || trackKey === null || nextSongKey === desiredKey) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            const song = desiredRef.current;
            if (!song || getPlaybackSongKey(song) !== desiredKey) return;
            loadQueuedSongHifiSource(song)
                .then((source) => {
                    if (cancelled) return undefined;
                    if (!source) {
                        console.info('[HiFi] the next song cannot be read ahead, it loads when this one ends', { songKey: desiredKey });
                        return undefined;
                    }
                    return preloadNextHifiTrack({ song, source });
                })
                .catch(error => console.warn('[HiFi] preloading the next song failed', error));
        }, GAPLESS_PRELOAD_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [desiredKey, nextSongKey, trackKey]);

    // mpv 接上了预载的那一首（hifiGapless 把它换成了当前曲目），以及 playSong 认领了它。
    useEffect(() => useHifiTrackStore.subscribe((state, previous) => {
        const track = state.current;
        const before = previous.current;
        if (!track || track === before) return;
        if (track.promotedByGapless && track.trackKey !== before?.trackKey) {
            // 等这次推送的同步反应（桥把引擎状态写回播放 store、驱动派发 shim 事件）都做完再换歌：handleNextTrack 在队尾时同步写
            // IDLE，写在它们中间会被桥的“在放”盖掉。
            queueMicrotask(() => {
                followGaplessSwitch(track, before, () => latestRef.current)
                    .catch(error => console.warn('[HiFi] moving on after the gapless switch failed', error));
            });
        } else if (before?.promotedByGapless && !track.promotedByGapless && track.trackKey === before.trackKey) {
            // 认领在 beginHifiTrack 里同步落定，onPlay* 紧接着才写播放器状态（startLoadingToPlay）：等它写完再摆。
            const adopted = track.trackKey;
            queueMicrotask(() => settleAdoptedTrack(adopted));
        }
    }), []);
}
