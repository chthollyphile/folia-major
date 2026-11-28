import { lyricCurrentTime } from '../../stores/motionSignals';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { nextQueueIndex, queueIndexOf, queueLoopMode } from '../../utils/playbackNeighbors';
import { getPrefetchedData, subscribePrefetchedLyrics } from '../prefetchService';
import { isModelChar } from './fontStrokesRaster';

// src/services/fontStrokes/fontStrokesDemand.ts
// 预备服务要算哪些字、按什么顺序：播放状态（当前歌的歌词、播放位置所在的句、播放队列、预取到的后两首歌词）→ 三组有序的字。
//   near       当前歌从播放位置起往后 NEAR_LINES 句（马上要画，onScreen 紧迫度）
//   rest       当前歌其余的句（先往后、再回到开头）
//   background 下一首、下下首
// 纯函数部分（buildFontStrokesDemand、lineIndexAt）可单测；createPlaybackDemandSource 把它接到真实的 store 和预取上。

/** 马上要画的句数（视觉上同屏的句数）。 */
export const NEAR_LINES = 4;
/** 往后看几首歌。 */
export const LOOKAHEAD_SONGS = 2;
/** 播放位置换句的检查间隔（毫秒）；平时只是一次比较。 */
const POLL_MS = 500;

export interface FontStrokesDemand { near: string[]; rest: string[]; background: string[] }

export const EMPTY_DEMAND: FontStrokesDemand = { near: [], rest: [], background: [] };

/** 二分：t 时刻所在的句（最后一句 startTime ≤ t 的），t 早于第一句时 0，没有歌词 -1。 */
export const lineIndexAt = (starts: readonly number[], t: number): number => {
    if (!starts.length) return -1;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
};

/** 一组句里按顺序出现的、交给模型的不重复字，排除 seen 里已有的（并把新字记进去）。 */
const collect = (lines: readonly string[], seen: Set<string>): string[] => {
    const out: string[] = [];
    for (const line of lines) {
        for (const ch of line) {
            if (seen.has(ch) || !isModelChar(ch)) continue;
            seen.add(ch);
            out.push(ch);
        }
    }
    return out;
};

/** 当前歌的各句文本、播放位置所在的句、后面几首歌的各句文本 → 三组有序的字（组间不重复）。 */
export const buildFontStrokesDemand = (lines: readonly string[], anchor: number, nextSongs: readonly (readonly string[])[], nearLines = NEAR_LINES): FontStrokesDemand => {
    const seen = new Set<string>();
    const from = Math.max(0, anchor);
    const near = collect(lines.slice(from, from + nearLines), seen);
    const rest = collect([...lines.slice(from + nearLines), ...lines.slice(0, from)], seen);
    const background = collect(nextSongs.flatMap(song => song), seen);
    return { near, rest, background };
};

/** 每份歌词的句首时间表只算一次（轮询每 500 ms 看一次位置）。 */
const startTimes = new WeakMap<object, number[]>();
const startsOf = (lyrics: { lines: { startTime: number }[] } | null): number[] => {
    if (!lyrics) return [];
    let starts = startTimes.get(lyrics);
    if (!starts) { starts = lyrics.lines.map(l => l.startTime); startTimes.set(lyrics, starts); }
    return starts;
};

/** 接上真实播放状态的需求来源：read() 现算一份；subscribe(cb) 在歌、歌词、队列、播放所在的句变了时回调（定时器只在有订阅时跑）。 */
export const createPlaybackDemandSource = () => {
    const read = (): FontStrokesDemand => {
        const { currentSong, lyrics, playQueue, isFmMode } = usePlaybackStore.getState();
        const lines = lyrics?.lines ?? [];
        const anchor = lineIndexAt(startsOf(lyrics), lyricCurrentTime.get());
        const loop = queueLoopMode(useAudioSettingsStore.getState().loopMode, isFmMode);
        const nextSongs: string[][] = [];
        let index = queueIndexOf(playQueue, currentSong);
        for (let i = 0; i < LOOKAHEAD_SONGS; i += 1) {
            index = nextQueueIndex(playQueue.length, index, loop);
            // 绕回当前歌（单曲 / 队列只有一首）或没有下一首就不用再往后看
            if (index < 0 || playQueue[index] === currentSong) break;
            const prefetched = getPrefetchedData(playQueue[index]);
            if (prefetched?.lyrics) nextSongs.push(prefetched.lyrics.lines.map(l => l.fullText));
        }
        return buildFontStrokesDemand(lines.map(l => l.fullText), anchor, nextSongs);
    };

    const subscribe = (onChange: () => void): (() => void) => {
        let anchor = -2;
        const poll = () => {
            const { lyrics } = usePlaybackStore.getState();
            const next = lineIndexAt(startsOf(lyrics), lyricCurrentTime.get());
            if (next === anchor) return;
            anchor = next;
            onChange();
        };
        const unsubPlayback = usePlaybackStore.subscribe((state, previous) => {
            if (state.currentSong !== previous.currentSong || state.lyrics !== previous.lyrics || state.playQueue !== previous.playQueue) onChange();
        });
        const unsubLoop = useAudioSettingsStore.subscribe((state, previous) => { if (state.loopMode !== previous.loopMode) onChange(); });
        const unsubPrefetch = subscribePrefetchedLyrics(onChange);
        const timer = setInterval(poll, POLL_MS);
        poll();
        return () => { clearInterval(timer); unsubPlayback(); unsubLoop(); unsubPrefetch(); };
    };

    return { read, subscribe };
};
