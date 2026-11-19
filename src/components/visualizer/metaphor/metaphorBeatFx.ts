import { resolveBeatFxAccentGain, type BeatFxEvent } from '../../../services/beatFx/clock';
import {
    METAPHOR_COLLISION_APPROACH,
    METAPHOR_COLLISION_LIFE,
    METAPHOR_SHAPE_RING,
    putMetaphorShape,
    type MetaphorCollision,
} from './metaphorShapes';

// src/components/visualizer/metaphor/metaphorBeatFx.ts
// 智能动感模式的「湮灭对撞」：对撞跟着节拍表走。
// - 对撞的时刻挪到拍上：附近有小节第一拍就挪到那一拍，没有就挪到最近的一拍，都够不着的不动。两颗墨球是提前出发的
//   （METAPHOR_COLLISION_APPROACH），所以是正好在拍上撞，不是听到拍才动。
// - 平常的每一拍，离它最近的那个对撞点放出一圈小的冲击环；拍越重环越大，没有节奏的小节不放。
// 都是纯函数：只看节拍表和播放时间，拖进度、暂停、导出都对。节拍表没装好、效果关着时调用方不走这里，画面和原来逐像素一样。

/** 离小节第一拍多近才挪过去（秒）。 */
const SNAP_DOWNBEAT = 0.9;
/** 离普通的一拍多近才挪过去（秒）。 */
const SNAP_BEAT = 0.3;
/** 两次对撞挪完以后至少隔这么久，不然后一次不挪。 */
const SNAP_APART = 0.4;
/** 一圈拍上的小环活多久。整体要慢：比一拍长得多，画面上同时有三四圈。 */
const RING_LIFE = 2.2;
/** 强度拉满时最多按几倍算。 */
const STRENGTH_MAX = 2;

/** 第一个时刻不早于 time 的拍在第几个。 */
const firstAtOrAfter = (events: readonly BeatFxEvent[], time: number): number => {
    let low = 0;
    let high = events.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (events[mid].t < time) low = mid + 1;
        else high = mid;
    }
    return low;
};

/** time 附近 reach 秒以内最近的一拍（只要 downbeat 时只看小节第一拍），没有就是 null。没有节奏的小节里的拍不算。 */
const nearestBeat = (events: readonly BeatFxEvent[], time: number, reach: number, downbeat: boolean): number | null => {
    let best: number | null = null;
    for (let index = firstAtOrAfter(events, time - reach); index < events.length && events[index].t <= time + reach; index += 1) {
        const event = events[index];
        if (event.rhythmic === false || (downbeat && event.kind !== 'downbeat')) continue;
        if (best === null || Math.abs(event.t - time) < Math.abs(best - time)) best = event.t;
    }
    return best;
};

/**
 * 把一个 cue 的对撞挪到拍上，返回新的一组（挪不动的原样）。earliest 是最早能撞的时刻（cue 开始的时刻：不挪到上一句里去）。
 * 时间都是歌里的秒：循环的 cue（时间会折回去）不要调这个。
 */
export const snapMetaphorCollisions = (
    collisions: readonly MetaphorCollision[], events: readonly BeatFxEvent[], earliest = Number.NEGATIVE_INFINITY,
): MetaphorCollision[] => {
    if (events.length === 0) return [...collisions];
    const taken: number[] = [];
    return collisions.map((hit) => {
        const free = (time: number | null): time is number => time !== null && time >= earliest && taken.every(other => Math.abs(other - time) >= SNAP_APART);
        const bar = nearestBeat(events, hit.time, SNAP_DOWNBEAT, true);
        const beat = nearestBeat(events, hit.time, SNAP_BEAT, false);
        const time = free(bar) ? bar : free(beat) ? beat : hit.time;
        taken.push(time);
        return time === hit.time ? hit : { ...hit, time };
    });
};

/**
 * 接着 offset 把拍上的小环在 time 这一刻的样子写进实例数据，返回写到第几个。
 * time 是歌里的秒；shift 是 cue 里的时间减去歌里的秒（循环的 cue 不是 0）；strength 是这个效果的强度（0..2，1 是调好的样子）。
 */
export const writeMetaphorBeatRings = (
    collisions: readonly MetaphorCollision[], events: readonly BeatFxEvent[], time: number, shift: number,
    strength: number, trackScale: number, out: Float32Array, offset: number,
): number => {
    let count = offset;
    if (collisions.length === 0 || strength <= 0) return count;
    const scale = Math.min(STRENGTH_MAX, strength);
    for (let index = firstAtOrAfter(events, time - RING_LIFE); index < events.length && events[index].t <= time; index += 1) {
        const event = events[index];
        const gain = resolveBeatFxAccentGain(event, trackScale);
        if (gain <= 0) continue;
        // 这一拍归哪个对撞点：墨球正飞过去的，或者刚撞完碎片还没散的，挑时刻最近的
        const at = event.t + shift;
        let site: MetaphorCollision | null = null;
        for (const hit of collisions) {
            const since = at - hit.time;
            if (since < -METAPHOR_COLLISION_APPROACH || since >= METAPHOR_COLLISION_LIFE) continue;
            if (!site || Math.abs(since) < Math.abs(at - site.time)) site = hit;
        }
        // 正好是撞上的那一拍：那一下自己有一圈大的
        if (!site || Math.abs(at - site.time) < 0.05) continue;
        const age = time - event.t;
        const fade = 1 - age / RING_LIFE;
        const reach = (event.kind === 'downbeat' ? 1.5 : 1) * (0.5 + 0.9 * gain) * scale;
        const radius = site.unit * (0.16 + reach * (1 - Math.exp(-age * 1.1)));
        // 刚放出来的一小会儿是墨线，之后只剩越来越淡的网点
        count = putMetaphorShape(out, count, METAPHOR_SHAPE_RING, site.x, site.y, radius, radius, 0, age < 0.25 ? 1 : 0, fade, 0);
    }
    return count;
};
