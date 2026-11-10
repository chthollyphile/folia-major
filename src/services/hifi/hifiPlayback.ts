import type { SongResult } from '../../types';
import type { HifiEngineState, PlaybackRoute } from '../../types/hifi';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { setAudioSrc, setPlaybackRoute, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { resolvePlaybackRoute } from './hifiEligibility';
import { hifiEngine, useHifiEngineStore } from './hifiEngine';
import { hifiMediaShim } from './hifiMediaShim';
import { dropHifiNext, promoteHifiNextIfStarted } from './hifiGapless';
import {
    claimHifiTrack,
    forgetUnclaimedUnless,
    installHifiRouteGuard,
    isHifiRoute,
    noteUnclaimedHifiTrack,
    withoutRouteGuard,
} from './hifiRouteGuard';
import { createSourceKey } from './hifiSourceResponder';
import { applyHifiClock, applyHifiEngineState } from './hifiTrackDriver';
import {
    deferHifiLoad,
    dropDeferredHifiLoad,
    hifiLoadStartSec,
    loadSourceSpec,
    noteWebEngineLeft,
    retireHifiSourceKey,
    runHifiLoad,
    songDurationSec,
    type BeginHifiTrackOutcome,
    type HifiLoadJob,
    type HifiTrackSource,
} from './hifiTrackLoad';
import {
    clearHifiTrack,
    hifiPlaybackClock,
    isCurrentHifiAttempt,
    nextHifiAttempt,
    showHifiTrack,
    useHifiTrackStore,
    type HifiTrack,
} from './hifiTrackStore';
import { navidromeSourceSpec } from './sourceSpec';

// src/services/hifi/hifiPlayback.ts
// HiFi 路线的数据流入口：判定一首歌走不走 mpv、起播（或接管窗口重建前还在放的那首，或停着的恢复先不载入）、装上推送驱动和路由守卫。
// 曲目 store、载入（含延后载入和 DEVICE_BUSY 重试）、无缝接播（hifiGapless）、驱动、守卫和传输控制在相邻文件里，经这里导出；React 那一侧（自动播放、结束换歌、失败回落）在 useHifiPlaybackBridge。

export { getHifiPosition, hifiPlaybackClock, useHifiTrackStore } from './hifiTrackStore';
export type { HifiLoadState, HifiNextTrack, HifiTrack, HifiTrackStoreState } from './hifiTrackStore';
export { isHifiRoute, leaveHifiRoute, releaseUnclaimedHifiTrack } from './hifiRouteGuard';
export { clearNextHifiTrack, preloadNextHifiTrack } from './hifiGapless';
export { hifiTransport } from './hifiTransport';
export { isHifiTrackWaitingForDevice, loadDeferredHifiTrack, retryBusyHifiTrack } from './hifiTrackLoad';
export type { BeginHifiTrackOutcome, HifiTrackSource } from './hifiTrackLoad';

export type BeginHifiTrackOptions = {
    song: SongResult;
    source: HifiTrackSource;
    startSec: number;
    /** 只给恢复路径用：主进程里还在放同一首时接管它，不重新载入。 */
    adoptRunning?: boolean;
    /**
     * 只给恢复路径用：没能接管时先不载入（loadState 'deferred'），停着的恢复不去占输出设备；第一次播放、跳转或自动播放时
     * 由 loadDeferredHifiTrack 从那时的位置载入。
     */
    deferLoad?: boolean;
    /** 起播时 startPlay() 的 onceShown（恢复时 startRestore()）给的答案，记在曲目上，见 HifiTrack.stillWanted。不给时一直答是。 */
    stillWanted?: () => boolean;
};

/** 一首本地或 Navidrome 歌曲该走哪套引擎，按设置、运行时、熔断和本次会话的回落记录判定。 */
export const hifiRouteFor = (kind: 'local' | 'navidrome', songKey: string): PlaybackRoute => {
    const settings = useHifiSettingsStore.getState();
    const engine = useHifiEngineStore.getState();
    return resolvePlaybackRoute(kind, {
        supported: engine.supported,
        enabled: settings.enabled,
        navidromeEnabled: settings.navidrome,
        runtimeAvailable: engine.runtime?.available === true,
        circuitOpen: engine.circuitOpen,
        forcedWeb: hifiEngine.isSongForcedWeb(songKey),
    });
};

let installed = false;
let runtimeKnown: Promise<void> = Promise.resolve();

/**
 * 桥挂载时调用，重复调用无副作用：订阅主进程推送、接上时钟和 shim、装上路由守卫、取一次运行时状态，再取一份引擎快照，
 * 记下上一个窗口留下的那一首（没人接管就由路由守卫停掉）。
 */
export const installHifiPlayback = () => {
    if (installed) return;
    installed = true;
    hifiMediaShim.setClockReader(() => hifiPlaybackClock.read());
    hifiEngine.attach();
    hifiEngine.onState((state) => {
        forgetUnclaimedUnless(state.trackKey);
        // mpv 无缝接上了预载的那一首：先把它换成当前曲目，驱动再按这份状态给它派发播放。
        promoteHifiNextIfStarted(state);
        applyHifiEngineState(state);
    });
    hifiEngine.onClock(applyHifiClock);
    installHifiRouteGuard();
    runtimeKnown = hifiEngine.refreshRuntime().then(() => undefined);
    void hifiEngine.getSnapshot().then(noteUnclaimedHifiTrack);
};

/** 第一次运行时状态问到之后 resolve；恢复路径先等它再判路由，免得启动时 runtime 还是 null 就判成 web。 */
export const whenHifiRuntimeKnown = () => {
    installHifiPlayback();
    return runtimeKnown;
};

type AdoptableState = HifiEngineState & { trackKey: string };

const canAdopt = (snapshot: HifiEngineState | null, songKey: string, source: HifiTrackSource): snapshot is AdoptableState => (
    snapshot !== null
    && snapshot.processRunning
    && snapshot.trackKey !== null
    && snapshot.songKey === songKey
    && (snapshot.status === 'playing' || snapshot.status === 'paused')
    && snapshot.sourceKind === source.kind
    && (source.kind !== 'local' || snapshot.localSourceKey !== null)
);

/** 接管主进程里还在放的同一首：把文件登记回原来的 sourceKey，时钟和 shim 照快照摆好，不重新载入。 */
const adoptRunningTrack = (
    attempt: number,
    snapshot: AdoptableState,
    { song, source, stillWanted }: { song: SongResult; source: HifiTrackSource; stillWanted: () => boolean },
    songKey: string,
) => {
    const localSourceKey = source.kind === 'local' ? snapshot.localSourceKey : null;
    if (source.kind === 'local' && localSourceKey) hifiEngine.responder.register(localSourceKey, source.file);
    claimHifiTrack(snapshot.trackKey);
    showHifiTrack(
        { trackKey: snapshot.trackKey, songKey, origin: source.kind, song, localSourceKey, stillWanted },
        { positionSec: snapshot.positionSec, paused: snapshot.paused, durationSec: snapshot.durationSec },
        { loadState: 'ready' },
    );
    applyHifiEngineState(snapshot);
    loadSourceSpec(attempt, source);
    // 上一个窗口排在它后面的下一首：那个文件登记在上一个窗口里，这个窗口读不到它。撤掉，这个窗口自己再排。
    if (snapshot.next) void hifiEngine.clearNext();
    console.info('[HiFi] adopted the track mpv is still playing', { trackKey: snapshot.trackKey, status: snapshot.status });
};

type GaplessAdoption = { song: SongResult; source: HifiTrackSource; stillWanted: () => boolean };

/** 无缝接上的那一首（promotedByGapless）就是这次要放的歌：认领它，不重新载入。歌换成这次播放给的对象，曲目记下这次播放的 stillWanted。 */
const adoptGaplessTrack = (track: HifiTrack, { song, source, stillWanted }: GaplessAdoption): BeginHifiTrackOutcome => {
    dropDeferredHifiLoad();
    useHifiTrackStore.setState({ current: { ...track, song, stillWanted, promotedByGapless: false } });
    // Navidrome：这次播放刚把服务器记的原文件格式写到歌上。本地文件的格式在接上时就开始读了。
    if (source.kind === 'navidrome') useHifiTrackStore.setState({ sourceSpec: navidromeSourceSpec(source.carrier.navidromeData) });
    console.info('[HiFi] took over the song mpv switched to gaplessly', { trackKey: track.trackKey });
    return 'adopted';
};

/**
 * 在 HiFi 路线上起播一首：Web 源清空、路线切到 hifi、登记本地文件、后台读源格式，然后一律暂停着载入——开始播放归桥的
 * 自动播放。被更新的起播或离开路线顶替时，await 回来什么都不写。
 * mpv 无缝接上的那一首（还等着认领）正是这首歌时直接认领它（'adopted'），不载入；排着的下一首随新的载入一起丢掉。
 */
export const beginHifiTrack = async ({
    song,
    source,
    startSec,
    adoptRunning = false,
    deferLoad = false,
    stillWanted = () => true,
}: BeginHifiTrackOptions): Promise<BeginHifiTrackOutcome> => {
    const songKey = getPlaybackSongKey(song);
    // 认领在第一个 await 之前同步落定：onPlay* 紧接着写播放器状态，桥据此把它摆回“在放”。
    const promoted = useHifiTrackStore.getState().current;
    if (promoted?.promotedByGapless && promoted.songKey === songKey && promoted.origin === source.kind && isHifiRoute()) {
        return adoptGaplessTrack(promoted, { song, source, stillWanted });
    }
    const attempt = nextHifiAttempt();
    dropDeferredHifiLoad();
    dropHifiNext();
    const previousSourceKey = useHifiTrackStore.getState().current?.localSourceKey;
    if (previousSourceKey) retireHifiSourceKey(previousSourceKey);
    const before = usePlaybackStore.getState();
    if (before.playbackRoute === 'web' && before.audioSrc !== null) noteWebEngineLeft();
    withoutRouteGuard(() => {
        setAudioSrc(null);
        setPlaybackRoute('hifi');
    });

    let snapshot: HifiEngineState | null = null;
    if (adoptRunning) {
        clearHifiTrack({ loadState: 'loading' });
        snapshot = await hifiEngine.getSnapshot();
        if (!isCurrentHifiAttempt(attempt)) return 'superseded';
        if (canAdopt(snapshot, songKey, source)) {
            adoptRunningTrack(attempt, snapshot, { song, source, stillWanted }, songKey);
            return 'adopted';
        }
    }

    const trackKey = `${songKey}#${createSourceKey().slice(0, 12)}`;
    const localSourceKey = source.kind === 'local' ? createSourceKey() : null;
    if (source.kind === 'local' && localSourceKey) hifiEngine.responder.register(localSourceKey, source.file);
    // 停在结尾的那一首（放完之后恢复）从头载入，见 hifiLoadStartSec。
    const safeStartSec = hifiLoadStartSec(startSec, songDurationSec(song.durationMs));
    const job: HifiLoadJob = { attempt, track: { trackKey, songKey, origin: source.kind, song, localSourceKey, stillWanted }, source };
    if (deferLoad) {
        deferHifiLoad(job, safeStartSec, snapshot ?? useHifiEngineStore.getState().engine);
        return 'deferred';
    }
    showHifiTrack(job.track, { positionSec: safeStartSec, paused: true, durationSec: null });
    loadSourceSpec(attempt, source);
    return runHifiLoad(job, safeStartSec);
};
