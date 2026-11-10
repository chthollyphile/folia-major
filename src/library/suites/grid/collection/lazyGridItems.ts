import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { getSongCoverUrl } from '../../../../services/onlineMusic/songMetadata';
import { formatSongName } from '../../../../utils/songNameFormatter';
import type { GridItem } from '../shared/polaroidCardParts';
import type { SongResult } from '../../../../types';
import { formatEntryKey } from '../../../core/collection/collectionEntries';

// src/library/suites/grid/collection/lazyGridItems.ts
// 网格项的**惰性**塑形。抽出来是为了两件事：这一段的正确性很细（id 里的重复序号、增量缓存），
// 而它又必须与原来的 eager 版本产出**逐字段相同**的对象 —— 所以要有单测钉住，不能靠读代码相信。
//
// 为什么需要它：原来 `displayTracks.map(...)` 会把整张歌单都塑形一遍。5000 首实测 120ms，
// 而网格一次只渲染视口附近的几十张卡；分页每来一页还会整表重算一次（累计 O(N²/Batch)），
// 正好落在用户刚点开、转场还在飞的窗口里。

// 重复序号的扫描与条目键属于集合本身而不是网格，搬到了 library/core/collection/collectionEntries；
// 调用方直接引用 core 的规则，这里只接收扫描结果并按需塑形网格项。

/** 一首曲目 → 一个网格项。与 GridView 早先的 eager 版本逐字段一致。 */
export const shapeGridItem = (
    track: SongResult,
    index: number,
    occurrence: number,
): GridItem => ({
    id: formatEntryKey(getPlaybackSongKey(track), occurrence),
    name: formatSongName(track),
    searchText: [
        track.name,
        track.aliases?.join(' '),
        track.translatedNames?.join(' '),
    ].filter(Boolean).join(' '),
    coverUrl: getSongCoverUrl(track),
    subtitle: String(index + 1).padStart(2, '0'),
    description: track.artists?.map(artist => artist.name).join(', '),
    rawTrack: track,
    rawTrackIndex: index,
});

/**
 * 惰性数组：`length` 立刻可用（视口计算只要它），真对象在被按下标读到时才塑形并缓存。
 *
 * `has` 陷阱是**必须**的：底层数组是稀疏的（只设了 length），而 `map`/`filter`/`findIndex`
 * 会先用 `HasProperty` 跳过「空洞」—— 少了这个陷阱，搜索过滤会静默返回空数组、封面预加载
 * 会静默拿到 undefined。加上之后这些方法照常工作（它们本来就要读全部下标）。
 */
export const createLazyGridItems = (
    tracks: SongResult[],
    occurrences: ReadonlyMap<number, number>,
): GridItem[] => {
    const target: GridItem[] = new Array(tracks.length);
    const shaped = new Map<number, GridItem>();
    const shapeAt = (index: number): GridItem => {
        const cached = shaped.get(index);
        if (cached) {
            return cached;
        }
        const built = shapeGridItem(tracks[index], index, occurrences.get(index) ?? 0);
        shaped.set(index, built);
        return built;
    };
    const isIndex = (property: string | symbol): number | null => {
        if (typeof property !== 'string') return null;
        const index = Number(property);
        return Number.isInteger(index) && index >= 0 && index < tracks.length ? index : null;
    };
    return new Proxy(target, {
        get(array, property, receiver) {
            const index = isIndex(property);
            return index === null ? Reflect.get(array, property, receiver) : shapeAt(index);
        },
        has(array, property) {
            const index = isIndex(property);
            return index === null ? Reflect.has(array, property) : true;
        },
        getOwnPropertyDescriptor(array, property) {
            const index = isIndex(property);
            if (index === null) {
                return Reflect.getOwnPropertyDescriptor(array, property);
            }
            return { configurable: true, enumerable: true, writable: false, value: shapeAt(index) };
        },
    });
};
