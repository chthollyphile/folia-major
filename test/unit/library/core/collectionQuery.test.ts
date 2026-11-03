import { describe, expect, it } from 'vitest';
import { getTrackSearchText, matchTrackIndexes } from '@/library/core/collection/collectionQuery';
import { shapeGridItem } from '@/library/suites/grid/collection/lazyGridItems';
import type { SongResult } from '@/types';

// test/unit/library/core/collectionQuery.test.ts
// 集合筛选必须与 GridView 原先对网格项做的匹配逐字等价：同一个 query 在网格和别的 renderer
// 里命中的必须是同一批歌，否则「播放筛选结果」在两边会放出不同的队列。

const song = (overrides: Partial<SongResult> & { id: string }): SongResult => ({
    name: `Song ${overrides.id}`,
    artists: [{ id: 1, name: 'Main Artist' }],
    album: { id: 9, name: 'Common Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: overrides.id },
    ...overrides,
} as SongResult);

const TRACKS: SongResult[] = [
    song({ id: 'plain', name: 'Morning Light' }),
    song({ id: 'alias', name: 'Night Drive', aliases: ['Kite Runner', 'Second Alias'] }),
    song({ id: 'translated', name: '夜曲', translatedNames: ['Nocturne'] }),
    song({ id: 'both', name: 'Rain', aliases: ['Storm'], translatedNames: ['雨'] }),
    song({ id: 'multi', name: 'Duet', artists: [{ id: 1, name: 'Main Artist' }, { id: 2, name: 'Guest Singer' }] }),
    song({ id: 'no-artists', name: 'Lonely', artists: undefined as unknown as SongResult['artists'] }),
    song({ id: 'empty-artists', name: 'Empty', artists: [] }),
    song({ id: 'no-album', name: 'Single', album: undefined as unknown as SongResult['album'] }),
    song({ id: 'empty-album', name: 'Untitled', album: { id: 0, name: '' } }),
    song({ id: 'case', name: 'MiXeD CaSe', album: { id: 3, name: 'UPPER ALBUM' } }),
    song({ id: 'cjk', name: '春日影', artists: [{ id: 5, name: '高松燈' }], album: { id: 6, name: '迷跡波' } }),
];

/** 旧实现，逐字抄自 GridView 的 gridItems 过滤。 */
const legacyMatches = (tracks: SongResult[], rawQuery: string): number[] => {
    const query = rawQuery.trim().toLowerCase();
    return tracks.flatMap((track, index) => {
        const item = shapeGridItem(track, index, 0);
        const searchableText = [
            item.searchText,
            typeof item.name === 'string' ? item.name : undefined,
            item.description,
            track?.album?.name,
            track?.artists?.map((artist) => artist.name).join(' '),
        ]
            .filter((value) => value !== undefined && value !== null)
            .join(' ')
            .toLowerCase();
        return searchableText.includes(query) ? [index] : [];
    });
};

const QUERIES = [
    'morning', 'MORNING', '  light ', 'kite', 'second alias', 'nocturne', '夜', 'storm', '雨',
    'guest', 'main artist, guest', 'artist guest', 'common album', 'upper', 'mixed case',
    '高松', '迷跡', '春日影 高松', 'song', 'lonely', 'single', 'untitled', 'zzz', 'light main',
];

describe('collection query', () => {
    it.each(QUERIES)('matches exactly what the grid used to match for %j', (query) => {
        expect(matchTrackIndexes(TRACKS, query)).toEqual(legacyMatches(TRACKS, query));
    });

    it('returns null for an empty query so "no filter" differs from "no result"', () => {
        expect(matchTrackIndexes(TRACKS, '')).toBeNull();
        expect(matchTrackIndexes(TRACKS, '   ')).toBeNull();
        expect(matchTrackIndexes(TRACKS, 'zzz')).toEqual([]);
    });

    it('never matches on the rendered title node, only on plain fields', () => {
        // formatSongName 返回 ReactNode，旧实现里那一项恒为 undefined。
        expect(getTrackSearchText(TRACKS[1])).toBe('night drive kite runner second alias main artist common album main artist');
    });
});
