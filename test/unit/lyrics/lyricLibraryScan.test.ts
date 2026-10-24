import { describe, expect, it } from 'vitest';
import { LIBRARY_ROWS, scanLibrarySong, startLibraryScan } from '@/components/modal/lyric-filter/lyricLibraryScan';
import { compileLyricLineRules } from '@/utils/lyrics/lyricLineRules';

describe('the heard songs the 听过的歌 tab shows', () => {
    it('keeps only the lines it draws, songs with a line removed mid-song first, and counts them all', () => {
        const rules = compileLyricLineRules([{ id: 'x', on: true, shape: 'contains', text: 'x' }]);
        // The first `hits` lines match: A and C only near their start, B all through.
        const song = (key: string, total: number, hits: number) => ({
            key,
            title: key,
            lines: Array.from({ length: total }, (_, index) => (index < hits ? `x${index}` : `-${index}`)),
        });
        const scan = startLibraryScan(['x'], 3);
        for (const heard of [song('A', 600, 150), song('B', 100, 100), song('C', 40, 10)]) {
            scanLibrarySong(scan, heard, rules, rules);
        }

        expect(scan.songs.map(shown => [shown.key, shown.lines.length])).toEqual([['B', 100], ['A', LIBRARY_ROWS - 100]]);
        expect(scan.removedLines).toBe(260);
        expect(scan.removedSongs).toBe(3);
    });
});
