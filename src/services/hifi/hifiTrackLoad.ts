import type { LocalSong } from '../../types';
import type { HifiEngineState, HifiLoadRequest, HifiLoadResult, HifiSourceRequest } from '../../types/hifi';
import type { NavidromeSong } from '../../types/navidrome';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { hifiEngine, isHifiLoadCancelled, useHifiEngineStore } from './hifiEngine';
import { hifiMediaShim } from './hifiMediaShim';
import { applyHifiEngineState } from './hifiTrackDriver';
import { hifiPlaybackClock, isCurrentHifiAttempt, showHifiTrack, useHifiTrackStore, type HifiTrack } from './hifiTrackStore';
import { navidromeSourceSpec, readLocalSourceSpec } from './sourceSpec';

// src/services/hifi/hifiTrackLoad.ts
// 一首 HiFi 曲目怎么交给主进程载入：拼载入请求、从哪里开始（结尾附近从头）、刚离开 Web 引擎时 DEVICE_BUSY 的重试、
// 停着的恢复先不载入（延后到第一次播放），以及被换下的曲目登记的文件什么时候撤。判路由、起播和接管在 hifiPlayback；这里对外的函数和类型经它导出。

export type HifiTrackSource =
    | { kind: 'local'; localSong: LocalSong; file: Blob }
    /** streamUrl 是 getStreamUrl(config, id, 'raw')，带着凭据：只交给主进程，不进日志。 */
    | { kind: 'navidrome'; carrier: NavidromeSong; streamUrl: string };

/** cancelled：载入被 stop 取消，但没有更新的起播顶替它。deferred：曲目摆好了，载入等第一次播放。 */
export type BeginHifiTrackOutcome = 'ready' | 'adopted' | 'deferred' | 'failed' | 'superseded' | 'cancelled';

/** 一次要发给主进程的载入：哪一次起播的、哪一首、源在哪。延后的载入也是存成这个样子。 */
export type HifiLoadJob = { attempt: number; track: HifiTrack; source: HifiTrackSource };

const isLoopOne = () => (
    useAudioSettingsStore.getState().loopMode === 'one' && !usePlaybackStore.getState().isFmMode
);

// 离结尾不到这么多秒的起点从头放：mpv 暂停着载入在结尾、再开播时会停在结尾，既不出声也不报放完。
const START_NEAR_END_SEC = 0.5;

/** 歌曲自己记的时长（秒），没有时为 null。 */
export const songDurationSec = (durationMs: number | null | undefined): number | null => (
    typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : null
);

/**
 * 载入的起点：不是正数时从头；离已知时长的结尾不到 0.5 秒时也从头（放完之后恢复的、交给重建的窗口的那一首，起点就是时长），
 * 和 <audio> 放完之后再按播放一样。
 */
export const hifiLoadStartSec = (startSec: number, durationSec: number | null): number => {
    if (!Number.isFinite(startSec) || startSec <= 0) return 0;
    if (durationSec !== null && Number.isFinite(durationSec) && startSec >= durationSec - START_NEAR_END_SEC) return 0;
    return startSec;
};

// 被换下的曲目登记的文件：等下一次载入落定再撤，主进程换源那一下可能还在读旧的。
const retiredSourceKeys = new Set<string>();

/** 记下被换下的那一首登记的文件，等下一次载入落定（或延后）时再撤。 */
export const retireHifiSourceKey = (sourceKey: string) => {
    retiredSourceKeys.add(sourceKey);
};

const unregisterRetiredSources = () => {
    const keep = useHifiTrackStore.getState().current?.localSourceKey ?? null;
    retiredSourceKeys.forEach((sourceKey) => {
        if (sourceKey !== keep) hifiEngine.responder.unregister(sourceKey);
    });
    retiredSourceKeys.clear();
};

/** 后台读源格式，读完时这一次起播还算数才写进 store。 */
export const loadSourceSpec = (attempt: number, source: HifiTrackSource) => {
    if (source.kind === 'navidrome') {
        useHifiTrackStore.setState({ sourceSpec: navidromeSourceSpec(source.carrier.navidromeData) });
        return;
    }
    void readLocalSourceSpec(source.file, source.localSong.fileName).then((sourceSpec) => {
        if (isCurrentHifiAttempt(attempt)) useHifiTrackStore.setState({ sourceSpec });
    });
};

/** 交给主进程的源：本地文件只交 sourceKey 和文件信息（字节由主进程向渲染端拉），Navidrome 交带凭据的地址。 */
export const toSourceRequest = (source: HifiTrackSource, localSourceKey: string | null): HifiSourceRequest => {
    if (source.kind === 'local') {
        return {
            kind: 'local',
            sourceKey: localSourceKey ?? '',
            size: source.file.size,
            mimeType: source.file.type || source.localSong.mimeType || '',
            fileName: source.localSong.fileName,
        };
    }
    const { id, suffix } = source.carrier.navidromeData;
    return { kind: 'navidrome', url: source.streamUrl, fileName: suffix ? `${id}.${suffix}` : id };
};

// 延后着的那一次载入（见 BeginHifiTrackOptions.deferLoad）；新的起播或真正载入时清掉。
let deferredJob: HifiLoadJob | null = null;

/** 新的起播开始了：之前延后着的那次载入作废。 */
export const dropDeferredHifiLoad = () => {
    deferredJob = null;
};

// 刚从 Web 引擎换过来的那几秒，输出设备可能还没被放开（AudioContext 挂起后，系统要过一会儿才关掉那条输出流）：
// 这段时间里载入报 DEVICE_BUSY 是暂时的，隔一会儿再试几次，再算失败。
const WEB_HANDOVER_WINDOW_MS = 6000;
const BUSY_RETRY_COUNT = 3;
const BUSY_RETRY_DELAY_MS = 1500;
// 上一次从有 Web 源的 Web 路线换到 HiFi 的时刻。
let webEngineLeftAt = Number.NEGATIVE_INFINITY;

/** 起播从一条有 Web 源的 Web 路线换过来：从这一刻起算 DEVICE_BUSY 的重试窗口。 */
export const noteWebEngineLeft = () => {
    webEngineLeftAt = Date.now();
};

const isDeviceBusy = (result: HifiLoadResult) => !result.ok && result.errorCode === 'DEVICE_BUSY';

const waitMs = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

/**
 * 把一次载入发给主进程，一律暂停着载入；刚离开 Web 引擎时的 DEVICE_BUSY 隔 1.5 秒再试，最多三次。结果按这次起播还算不算数
 * 写进 store：被顶替的什么都不写。
 */
export const runHifiLoad = async (job: HifiLoadJob, startSec: number): Promise<BeginHifiTrackOutcome> => {
    const { attempt, track, source } = job;
    const request = (): HifiLoadRequest => ({
        trackKey: track.trackKey,
        songKey: track.songKey,
        source: toSourceRequest(source, track.localSourceKey),
        startSec,
        paused: true,
        loopFile: isLoopOne(),
    });
    let result = await hifiEngine.load(request());
    let retriesLeft = Date.now() - webEngineLeftAt <= WEB_HANDOVER_WINDOW_MS ? BUSY_RETRY_COUNT : 0;
    while (retriesLeft > 0 && isDeviceBusy(result) && isCurrentHifiAttempt(attempt)) {
        retriesLeft -= 1;
        await waitMs(BUSY_RETRY_DELAY_MS);
        if (!isCurrentHifiAttempt(attempt)) break;
        console.info('[HiFi] output device still busy right after the Web engine, loading again', {
            trackKey: track.trackKey,
            retry: BUSY_RETRY_COUNT - retriesLeft,
        });
        result = await hifiEngine.load(request());
    }
    if (!isCurrentHifiAttempt(attempt)) return 'superseded';
    unregisterRetiredSources();
    if (result.ok) {
        useHifiTrackStore.setState({ loadState: 'ready', loadError: null });
        // 载入结果里的状态和已推来的 seq 相同时不会再通知订阅者：这里补一次。
        const engine = useHifiEngineStore.getState().engine;
        if (engine) applyHifiEngineState(engine);
        return 'ready';
    }
    if (isHifiLoadCancelled(result)) {
        useHifiTrackStore.setState({ loadState: 'idle' });
        return 'cancelled';
    }
    // 设备忙到最后：记下这次载入，设备放开后按播放可以原样再载一次（retryBusyHifiTrack）。
    busyJob = isDeviceBusy(result) ? job : null;
    useHifiTrackStore.setState({ loadState: 'failed', loadError: result.errorCode });
    return 'failed';
};

// 最后一次载入报 DEVICE_BUSY 的那一首：别的程序独占着设备，等它放开再载入。
let busyJob: HifiLoadJob | null = null;

/** 当前曲目是不是停在“设备被别的程序占着”上，等按播放再载入。换了歌、重新起播过就不算。 */
export const isHifiTrackWaitingForDevice = (trackKey: string | null | undefined): boolean => {
    const { current, loadState, loadError } = useHifiTrackStore.getState();
    return Boolean(busyJob && trackKey && current?.trackKey === trackKey && busyJob.track.trackKey === trackKey
        && loadState === 'failed' && loadError === 'DEVICE_BUSY' && isCurrentHifiAttempt(busyJob.attempt));
};

/**
 * 设备放开后再载一次停在 DEVICE_BUSY 上的当前曲目：从时钟现在的位置（失败时的位置，或之后跳到的位置）暂停着载入，
 * 开不开播归桥的自动播放。当前曲目没在等设备时什么都不做，返回 null。
 */
export const retryBusyHifiTrack = async (): Promise<BeginHifiTrackOutcome | null> => {
    const job = busyJob;
    if (!job || !isHifiTrackWaitingForDevice(job.track.trackKey)) return null;
    busyJob = null;
    useHifiTrackStore.setState({ loadState: 'loading', loadError: null });
    const startSec = hifiLoadStartSec(hifiPlaybackClock.read(), hifiPlaybackClock.state().durationSec);
    console.info('[HiFi] loading again after the output device was busy', { trackKey: job.track.trackKey, startSec });
    return runHifiLoad(job, startSec);
};

/**
 * 摆好一首延后载入的曲目：时钟停在恢复的位置，时长先取歌曲自己的，store 标成 'deferred'。主进程里还占着设备的别的曲目
 * （上一个窗口留下、没接管成的，或停在结尾的）一并停掉：这首停着的恢复不该让设备继续被占着。
 */
export const deferHifiLoad = (job: HifiLoadJob, startSec: number, held: HifiEngineState | null) => {
    const durationSec = songDurationSec(job.track.song.durationMs);
    showHifiTrack(job.track, { positionSec: startSec, paused: true, durationSec }, { loadState: 'deferred' });
    if (durationSec !== null) hifiMediaShim.setDuration(durationSec);
    loadSourceSpec(job.attempt, job.source);
    unregisterRetiredSources();
    deferredJob = job;
    // 'starting'、'loading' 也算：被这次恢复顶替的上一次载入还在主进程里跑，落定了一样会占着设备。
    if (held && held.status !== 'idle' && held.status !== 'stopped') void hifiEngine.stop();
    console.info('[HiFi] restored paused, loading on the first play', { trackKey: job.track.trackKey, startSec });
};

/**
 * 发出延后着的那次载入：从时钟现在的位置（恢复的位置，或之后跳到的位置）暂停着载入；开不开播归桥的自动播放。
 * 当前曲目不是延后着的（已经在载入、换了歌、离开了路线）时什么都不做，返回 null。
 */
export const loadDeferredHifiTrack = async (): Promise<BeginHifiTrackOutcome | null> => {
    const job = deferredJob;
    const { current, loadState } = useHifiTrackStore.getState();
    if (!job || loadState !== 'deferred' || current?.trackKey !== job.track.trackKey || !isCurrentHifiAttempt(job.attempt)) return null;
    deferredJob = null;
    useHifiTrackStore.setState({ loadState: 'loading' });
    // 跳到结尾附近再按播放，也从头载入（见 hifiLoadStartSec）。
    const startSec = hifiLoadStartSec(hifiPlaybackClock.read(), hifiPlaybackClock.state().durationSec);
    console.info('[HiFi] loading the restored track', { trackKey: job.track.trackKey, startSec });
    return runHifiLoad(job, startSec);
};
