import { describe, expect, it } from 'vitest';
import {
    createLazyGridItems,
    shapeGridItem,
} from '@/library/suites/grid/collection/lazyGridItems';
import { buildDuplicateOccurrences, type DuplicateOccurrenceCache } from '@/library/core/collection/collectionEntries';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { formatSongName } from '@/utils/songNameFormatter';
import { getSongCoverUrl } from '@/services/onlineMusic/songMetadata';
import type { GridItem } from '@/library/suites/grid/shared/polaroidCardParts';
import type { SongResult } from '@/types';

// test/unit/folia-grid/lazyGridItems.test.ts
// 惰性塑形必须与原来的 eager map **逐字段一致**：观感不能因为性能优化变一点点，id 里的
// 重复序号尤其不能错（它同时是 React key 与移除歌曲时的匹配键）。

const track = (id: number | string, name?: string): SongResult => ({
    id,
    name: name ?? `Track ${id}`,
    artists: [{ id: 1, name: 'Artist One' }, { id: 2, name: 'Artist Two' }],
    album: { id: 9, name: 'Album' },
    aliases: ['alias'],
    translatedNames: ['译名'],
    providerId: 'netease',
    source: 'netease',
} as unknown as SongResult);

/** 原来的实现，逐字抄一遍做对照。 */
const eagerShape = (tracks: SongResult[]): GridItem[] => {
    const trackIdOccurrences = new Map<string, number>();
    return tracks.map((item, idx) => {
        const trackKey = getPlaybackSongKey(item);
        const occurrence = trackIdOccurrences.get(trackKey) ?? 0;
        trackIdOccurrences.set(trackKey, occurrence + 1);
        return {
            id: `${trackKey}-${occurrence}`,
            name: formatSongName(item),
            searchText: [item.name, item.aliases?.join(' '), item.translatedNames?.join(' ')]
                .filter(Boolean).join(' '),
            coverUrl: getSongCoverUrl(item),
            subtitle: String(idx + 1).padStart(2, '0'),
            description: item.artists?.map(artist => artist.name).join(', '),
            rawTrack: item,
            rawTrackIndex: idx,
        } as GridItem;
    });
};

const lazyItems = (tracks: SongResult[]): GridItem[] => {
    const { occurrences } = buildDuplicateOccurrences(tracks, null);
    return createLazyGridItems(tracks, occurrences);
};

describe('lazyGridItems', () => {
    it('produces exactly what the eager map produced, field by field', () => {
        const tracks = [track(1), track(2), track(3), track('four')];
        const eager = eagerShape(tracks);
        const lazy = lazyItems(tracks);

        expect(lazy.length).toBe(eager.length);
        expect(Array.isArray(lazy)).toBe(true);
        for (let index = 0; index < eager.length; index += 1) {
            expect(lazy[index]).toEqual(eager[index]);
            // 同一个下标读两次要给同一个对象（渲染与搜索会重复读）。
            expect(lazy[index]).toBe(lazy[index]);
        }
    });

    // 同一首歌在歌单里出现多次：第二个、第三个的 id 要带 -1 / -2，否则 React key 会撞。
    it('numbers repeated songs in order, exactly like the eager version', () => {
        const tracks = [track(7), track(8), track(7), track(7)];
        const eager = eagerShape(tracks);
        const lazy = lazyItems(tracks);

        expect(lazy.map(item => item.id)).toEqual(eager.map(item => item.id));
        expect(lazy.map(item => item.rawTrackIndex)).toEqual([0, 1, 2, 3]);
        expect(String(lazy[2].id).endsWith('-1')).toBe(true);
        expect(String(lazy[3].id).endsWith('-2')).toBe(true);
    });

    it('keeps reading the same values for a huge list without shaping it up front', () => {
        const tracks = Array.from({ length: 5000 }, (_, index) => track(index));
        const lazy = lazyItems(tracks);
        // 只读几个下标：如果实现退化成整表塑形，这条用例在时间上会明显变慢，但断言不依赖计时。
        expect(lazy.length).toBe(5000);
        expect(lazy[4999].rawTrackIndex).toBe(4999);
        expect(lazy[4999].subtitle).toBe('5000');
    });

    it('returns undefined past the end, like a sparse array', () => {
        const lazy = lazyItems([track(1)]);
        expect(lazy[1]).toBeUndefined();
        expect(lazy[-1]).toBeUndefined();
    });
});

describe('buildDuplicateOccurrences', () => {
    it('reuses the previous scan when the new list is a strictly longer prefix match', () => {
        const first = [track(1), track(2)];
        const firstScan = buildDuplicateOccurrences(first, null);
        const extendedScan = buildDuplicateOccurrences([...first, track(3)], {
            source: first,
            ...firstScan,
        } as DuplicateOccurrenceCache);

        // 复用同一个 Map：分页追加时不必重扫前缀。
        expect(extendedScan.seen).toBe(firstScan.seen);
        expect(extendedScan.occurrences).toBe(firstScan.occurrences);
        expect(extendedScan.seen.get(getPlaybackSongKey(first[0]))).toBe(1);
    });

    it('rebuilds when the list is not a prefix match (a song was removed or reordered)', () => {
        const first = [track(1), track(2), track(3)];
        const firstScan = buildDuplicateOccurrences(first, null);
        const replaced = [track(1), track(3)];
        const rebuilt = buildDuplicateOccurrences(replaced, {
            source: first,
            ...firstScan,
        } as DuplicateOccurrenceCache);

        expect(rebuilt.seen).not.toBe(firstScan.seen);
        expect(rebuilt.seen.get(getPlaybackSongKey(replaced[1]))).toBe(1);
    });
});

describe('shapeGridItem', () => {
    it('builds the subtitle from the index and the id from the occurrence', () => {
        const item = shapeGridItem(track(5), 41, 2);
        expect(item.subtitle).toBe('42');
        expect(item.id).toBe(`${getPlaybackSongKey(track(5))}-2`);
        // name 是 ReactNode（formatSongName 可能返回组合片段），所以按值比较而不是同一性。
        expect(item.name).toEqual(formatSongName(track(5)));
        expect(item.coverUrl).toBe(getSongCoverUrl(track(5)));
        expect(item.description).toBe('Artist One, Artist Two');
        expect(item.searchText).toContain('alias');
        expect(item.searchText).toContain('译名');
    });
});
