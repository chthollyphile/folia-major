import { describe, expect, it } from 'vitest';
import {
    SONG_NOTE_MAX_TAG_LENGTH,
    SONG_NOTE_MAX_TEXT,
    formatNoteAt,
    isKeepableComment,
    normalizeCommentAt,
    normalizeCommentText,
    normalizeTagName,
    sortComments,
    summarizeComments,
    tagKeyOf,
    timelineMarks,
    type SongNoteComment,
} from '@/components/song-notes/songNotesModel';

// test/unit/song-notes/songNotesModel.test.ts
// 歌曲评论的纯函数：标签和评论怎么规整、摘要怎么算、两种排序、进度条上的刻痕放在哪。

const comment = (id: string, createdAt: number, text: string, at?: number): SongNoteComment => ({
    id, songKey: 'online:netease:1', text, createdAt, ...(at !== undefined ? { at } : {}),
});

describe('tags', () => {
    it('drops leading hashes, folds whitespace and caps the length', () => {
        expect(normalizeTagName('  #夜车 ')).toBe('夜车');
        expect(normalizeTagName('＃＃city   pop')).toBe('city pop');
        expect(normalizeTagName('# \t ')).toBeNull();
        expect(normalizeTagName('x'.repeat(100))).toHaveLength(SONG_NOTE_MAX_TAG_LENGTH);
        // Counted in characters, not UTF-16 units: an emoji is not cut in half.
        expect(Array.from(normalizeTagName('🎸'.repeat(80))!)).toHaveLength(SONG_NOTE_MAX_TAG_LENGTH);
    });

    it('treats different cases as one tag', () => {
        expect(tagKeyOf('City Pop')).toBe(tagKeyOf('city pop'));
    });
});

describe('comments', () => {
    it('trims the text but keeps line breaks inside it', () => {
        expect(normalizeCommentText('  第一行\n第二行  ')).toBe('第一行\n第二行');
        expect(Array.from(normalizeCommentText('字'.repeat(SONG_NOTE_MAX_TEXT + 5)))).toHaveLength(SONG_NOTE_MAX_TEXT);
    });

    it('keeps a time only when it is a real, non-negative position', () => {
        expect(normalizeCommentAt(43.26)).toBe(43.3);
        expect(normalizeCommentAt(0)).toBe(0);
        expect(normalizeCommentAt(-1)).toBeUndefined();
        expect(normalizeCommentAt(Number.NaN)).toBeUndefined();
        expect(normalizeCommentAt(Number.POSITIVE_INFINITY)).toBeUndefined();
        expect(normalizeCommentAt(null)).toBeUndefined();
    });

    it('keeps an empty comment only when it marks a moment', () => {
        expect(isKeepableComment('', 12)).toBe(true);
        expect(isKeepableComment('', 0)).toBe(true);
        expect(isKeepableComment('', undefined)).toBe(false);
        expect(isKeepableComment('好听', undefined)).toBe(true);
    });

    it('summarizes counts and prefers the latest comment with words', () => {
        const summary = summarizeComments([
            comment('a', 1, '前奏', 3),
            comment('b', 2, '副歌'),
            comment('c', 3, '', 40),
        ]);
        expect(summary.commentCount).toBe(3);
        expect(summary.timedCount).toBe(2);
        expect(summary.latestComment).toEqual({ id: 'b', text: '副歌', createdAt: 2 });
        // Only bare marks: the latest mark stands in.
        expect(summarizeComments([comment('x', 5, '', 7), comment('y', 9, '', 2)]).latestComment).toEqual({ id: 'y', text: '', at: 2, createdAt: 9 });
        expect(summarizeComments([])).toEqual({ commentCount: 0, timedCount: 0, latestComment: undefined });
    });
});

describe('sorting', () => {
    const list = [comment('late', 30, '没挂时刻'), comment('b', 20, '副歌', 60), comment('a', 10, '前奏', 5), comment('early', 5, '最早写的')];

    it('by time written puts the oldest first', () => {
        expect(sortComments(list, 'written').map(entry => entry.id)).toEqual(['early', 'a', 'b', 'late']);
    });

    it('by timeline puts timed comments first in song order, the rest after by time written', () => {
        expect(sortComments(list, 'timeline').map(entry => entry.id)).toEqual(['a', 'b', 'early', 'late']);
    });

    it('does not reorder the list it was given', () => {
        sortComments(list, 'timeline');
        expect(list.map(entry => entry.id)).toEqual(['late', 'b', 'a', 'early']);
    });
});

describe('timeline', () => {
    it('writes positions like the progress bar does', () => {
        expect(formatNoteAt(0)).toBe('00:00');
        expect(formatNoteAt(43.9)).toBe('00:43');
        expect(formatNoteAt(605)).toBe('10:05');
        expect(formatNoteAt(3725)).toBe('1:02:05');
        expect(formatNoteAt(-3)).toBe('00:00');
    });

    it('places marks by ratio and skips the ones past the end or without a time', () => {
        const marks = timelineMarks([comment('b', 2, '尾奏', 150), comment('a', 1, '', 50), comment('c', 3, '无时刻'), comment('d', 4, '超出', 250)], 200);
        expect(marks).toEqual([
            { id: 'a', at: 50, ratio: 0.25, text: '' },
            { id: 'b', at: 150, ratio: 0.75, text: '尾奏' },
        ]);
    });

    it('draws nothing while the length is unknown', () => {
        const timed = [comment('a', 1, '', 10)];
        expect(timelineMarks(timed, 0)).toEqual([]);
        expect(timelineMarks(timed, Number.NaN)).toEqual([]);
    });
});
