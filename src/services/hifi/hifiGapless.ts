import type { SongResult } from '../../types';
import type { HifiEngineState } from '../../types/hifi';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { hifiEngine } from './hifiEngine';
import { isHifiRoute } from './hifiRouteGuard';
import { createSourceKey } from './hifiSourceResponder';
import { loadSourceSpec, retireHifiSourceKey, toSourceRequest, type HifiTrackSource } from './hifiTrackLoad';
import { nextHifiAttempt, showHifiTrack, useHifiTrackStore, type HifiNextTrack } from './hifiTrackStore';

// src/services/hifi/hifiGapless.ts
// 无缝接播：队列里的下一首也走 HiFi 时，用 loadfile append 交给 mpv 预载，下一首变了就撤掉；mpv 接上它时把它换成当前曲目
// （promote），播放器那一侧随后由桥经 playSong 换过去，beginHifiTrack 认领它，不重新载入。何时预载、预载哪一首由
// components/hifi/useHifiGaplessPreload 决定。预载和撤掉按发出的顺序一个接一个交给主进程：前一个还在路上就发下一个，
// 主进程排着的那一首会和这里记的对不上。

let operations: Promise<unknown> = Promise.resolve();

const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = operations.then(operation);
    operations = run.catch(() => undefined);
    return run;
};

// 正在撤的那一首：撤的请求还在路上时 mpv 可能已经接上了它，那就照样换过去（见 promoteHifiNextIfStarted）。
let clearing: HifiNextTrack | null = null;
// 主进程不肯排的那一对（当前曲目 > 下一首）：同一对不再问，这一首放完时照常载入下一首。
let refusedPair: string | null = null;

const pairOf = (afterTrackKey: string, songKey: string) => `${afterTrackKey}>${songKey}`;

/** 这一首后面还能不能排：还在 HiFi 路线上、仍是同一首、已经载入好、不是刚接上还没被 playSong 认领的那首。 */
const canQueueAfter = (afterTrackKey: string) => {
    const { current, loadState } = useHifiTrackStore.getState();
    return isHifiRoute() && current?.trackKey === afterTrackKey && loadState === 'ready' && !current.promotedByGapless;
};

/** 用不上了的预载项登记的文件：mpv 没接上它（它不是当前曲目）才撤。 */
const forgetSourceOf = (slot: HifiNextTrack) => {
    if (!slot.localSourceKey || useHifiTrackStore.getState().current?.localSourceKey === slot.localSourceKey) return;
    hifiEngine.responder.unregister(slot.localSourceKey);
};

const runClear = async () => {
    const slot = useHifiTrackStore.getState().next;
    if (!slot) return;
    useHifiTrackStore.setState({ next: null });
    clearing = slot;
    try {
        await hifiEngine.clearNext();
    } finally {
        clearing = null;
    }
    // 撤的请求到主进程之前 mpv 已经接上了它：它成了当前曲目，文件留着。
    if (useHifiTrackStore.getState().current?.trackKey === slot.trackKey) return;
    forgetSourceOf(slot);
    console.info('[HiFi] dropped the queued next song', { trackKey: slot.trackKey });
};

const runPreload = async (song: SongResult, source: HifiTrackSource, afterTrackKey: string | null): Promise<boolean> => {
    if (afterTrackKey === null || !canQueueAfter(afterTrackKey)) return false;
    const songKey = getPlaybackSongKey(song);
    const { current, next } = useHifiTrackStore.getState();
    if (!current || songKey === current.songKey) return false;
    if (next?.songKey === songKey) return true;
    if (refusedPair === pairOf(afterTrackKey, songKey)) return false;
    if (next) await runClear();
    if (!canQueueAfter(afterTrackKey)) return false;

    const trackKey = `${songKey}#${createSourceKey().slice(0, 12)}`;
    const localSourceKey = source.kind === 'local' ? createSourceKey() : null;
    if (source.kind === 'local' && localSourceKey) hifiEngine.responder.register(localSourceKey, source.file);
    // 被认领之前它算当前这一首的那次播放：“还要不要”问的是同一个。
    const slot: HifiNextTrack = { trackKey, songKey, origin: source.kind, song, localSourceKey, stillWanted: current.stillWanted, source };
    // 先记下再问主进程：回话到之前 mpv 就可能已经接上了它。
    useHifiTrackStore.setState({ next: slot });
    const accepted = await hifiEngine.preloadNext({
        trackKey,
        songKey,
        source: toSourceRequest(source, localSourceKey),
        startSec: 0,
        paused: false,
        loopFile: false,
    });
    const after = useHifiTrackStore.getState();
    if (after.current?.trackKey === trackKey) return true;
    if (accepted && after.next?.trackKey === trackKey) {
        console.info('[HiFi] queued the next song for a gapless switch', { trackKey, after: afterTrackKey });
        return true;
    }
    // 回话路上被拿掉了（新的载入、离开了路线）：主进程那边随之丢了它，文件由拿掉它的那一方撤。
    if (after.next?.trackKey !== trackKey) return false;
    useHifiTrackStore.setState({ next: null });
    refusedPair = pairOf(afterTrackKey, songKey);
    forgetSourceOf(slot);
    console.info('[HiFi] mpv did not queue the next song, it loads when this one ends', { trackKey, after: afterTrackKey });
    return false;
};

/**
 * 把下一首交给 mpv 排在当前这首后面（loadfile append），true 表示排上了（或 mpv 已经接上了它）。只排在调用这一刻的当前曲目后面：
 * 轮到它时当前曲目换了、没载入好、离开了 HiFi 路线，或下一首就是这一首，都不排。排着另一首时先撤掉那一首。
 */
export const preloadNextHifiTrack = ({ song, source }: { song: SongResult; source: HifiTrackSource }): Promise<boolean> => {
    const afterTrackKey = useHifiTrackStore.getState().current?.trackKey ?? null;
    return enqueue(() => runPreload(song, source, afterTrackKey));
};

/** 撤掉排着的下一首（主进程 playlist-remove 并撤销令牌）；没有就什么都不做。 */
export const clearNextHifiTrack = (): Promise<void> => enqueue(runClear);

/**
 * 新的载入（loadfile replace）会清掉 mpv 的整个播放列表，排着的下一首跟着没了，主进程那边也一并忘掉它：这里只把它从 store
 * 拿掉，登记的文件等这次载入落定再撤（mpv 换源那一下可能还在预读它）。beginHifiTrack 开头调用。
 */
export const dropHifiNext = () => {
    const slot = useHifiTrackStore.getState().next;
    if (!slot) return;
    useHifiTrackStore.setState({ next: null });
    if (slot.localSourceKey) retireHifiSourceKey(slot.localSourceKey);
};

/**
 * 主进程推来的状态里当前曲目换成了预载的那一首（mpv 无缝接上了它）：把它换成当前曲目，标上 promotedByGapless，时钟和 shim
 * 按这份状态摆好，读它的源格式，上一首登记的文件撤掉（mpv 已经放完它了）。这次换曲不算放完：上一首不报 ended，这里也不派发。
 * 要在把这份状态交给驱动（applyHifiEngineState）之前调用。返回 true 表示换了。
 */
export const promoteHifiNextIfStarted = (state: HifiEngineState): boolean => {
    if (state.trackKey === null || !isHifiRoute()) return false;
    const { current, next } = useHifiTrackStore.getState();
    const slot = next?.trackKey === state.trackKey ? next : clearing?.trackKey === state.trackKey ? clearing : null;
    if (!slot || !current || current.trackKey === slot.trackKey) return false;
    const attempt = nextHifiAttempt();
    const { source, ...track } = slot;
    showHifiTrack(
        { ...track, promotedByGapless: true },
        { positionSec: state.positionSec, paused: state.paused, durationSec: state.durationSec },
        { loadState: 'ready' },
    );
    loadSourceSpec(attempt, source);
    if (current.localSourceKey && current.localSourceKey !== slot.localSourceKey) hifiEngine.responder.unregister(current.localSourceKey);
    console.info('[HiFi] mpv switched to the queued song gaplessly', { from: current.trackKey, to: slot.trackKey });
    return true;
};
