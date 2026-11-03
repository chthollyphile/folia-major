import { describe, expect, it } from 'vitest';
import {
    buildDuplicateOccurrences,
    entryKeyAt,
    findEntryIndex,
    formatEntryKey,
    resolveRowAfterRemoval,
} from '@/library/core/collection/collectionEntries';
import { createLazyGridItems } from '@/library/suites/grid/collection/lazyGridItems';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import type { SongResult } from '@/types';

// test/unit/library/core/collectionEntries.test.ts
// 条目键必须与网格卡片 id 完全一致：焦点、恢复记录和删除动画都按这个键对上号，
// 换一个 renderer 也要能认出同一个条目。

const online = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
} as SongResult);

const TRACKS = [online('a'), online('b'), online('a'), online('c'), online('a')];

describe('collection entries', () => {
    const { occurrences } = buildDuplicateOccurrences(TRACKS, null);

    it('numbers repeated songs by occurrence', () => {
        expect(TRACKS.map((_, index) => entryKeyAt(TRACKS, occurrences, index))).toEqual([
            formatEntryKey(getPlaybackSongKey(TRACKS[0]), 0),
            formatEntryKey(getPlaybackSongKey(TRACKS[1]), 0),
            formatEntryKey(getPlaybackSongKey(TRACKS[0]), 1),
            formatEntryKey(getPlaybackSongKey(TRACKS[3]), 0),
            formatEntryKey(getPlaybackSongKey(TRACKS[0]), 2),
        ]);
        expect(entryKeyAt(TRACKS, occurrences, 99)).toBeNull();
    });

    it('produces exactly the grid card ids', () => {
        const items = createLazyGridItems(TRACKS, occurrences);
        TRACKS.forEach((_, index) => {
            expect(entryKeyAt(TRACKS, occurrences, index)).toBe(items[index].id);
        });
    });

    it('finds an entry by key, including a later duplicate, and misses cleanly', () => {
        expect(findEntryIndex(TRACKS, occurrences, formatEntryKey(getPlaybackSongKey(TRACKS[0]), 2))).toBe(4);
        expect(findEntryIndex(TRACKS, occurrences, 'online:netease:zzz-0')).toBe(-1);
    });
});

describe('focus after removing the focused entry', () => {
    it('lands on the next row, or on the new last row when the last one went', () => {
        const before = ['a-0', 'b-0', 'c-0', 'd-0'];
        expect(resolveRowAfterRemoval(before, 1, ['a-0', 'c-0', 'd-0'])).toBe(1);
        expect(resolveRowAfterRemoval(before, 0, ['b-0', 'c-0', 'd-0'])).toBe(0);
        expect(resolveRowAfterRemoval(before, 3, ['a-0', 'b-0', 'c-0'])).toBe(2);
        expect(resolveRowAfterRemoval(['a-0'], 0, [])).toBe(-1);
    });

    it('counts the rows before it that survived, so removing every copy of a song still lands on the next row', () => {
        // 在线 / 本地歌单按歌删：焦点在 a 的第二个条目上，a 的两个条目都没了。
        const before = ['a-0', 'b-0', 'a-1', 'c-0', 'd-0'];
        expect(resolveRowAfterRemoval(before, 2, ['b-0', 'c-0', 'd-0'])).toBe(1);
        // 删的是最后一个同歌条目，后面没有了：落到上一行。
        expect(resolveRowAfterRemoval(['b-0', 'a-0', 'c-0', 'a-1'], 3, ['b-0', 'c-0'])).toBe(1);
    });

    it('is not fooled by later duplicates whose occurrence shifts down', () => {
        // Navidrome 只删一个下标：a 的第二个条目（a-1）没了，原来的 a-2 变成 a-1，正是下一行。
        const before = ['a-0', 'b-0', 'a-1', 'a-2'];
        const after = ['a-0', 'b-0', 'a-1'];
        expect(after[resolveRowAfterRemoval(before, 2, after)]).toBe('a-1');
        expect(resolveRowAfterRemoval(before, 2, after)).toBe(2);
    });

    it('keeps the position when the entry was replaced in place', () => {
        // 每日推荐的「不喜欢」：原位换上新歌。
        expect(resolveRowAfterRemoval(['a-0', 'b-0', 'c-0'], 1, ['a-0', 'x-0', 'c-0'])).toBe(1);
    });
});
