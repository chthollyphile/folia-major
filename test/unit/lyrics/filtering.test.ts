import { describe, expect, it } from 'vitest';
import { applyLyricDisplayFilter, buildLyricFilterPreview } from '@/utils/lyrics/filtering';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';

describe('lyric filtering', () => {
    it('keeps lyrics unchanged when the filter is empty', () => {
        const lyrics = parseLyricsByFormat('lrc', '[00:04.00]Hello\n[00:10.00]World');
        const filtered = applyLyricDisplayFilter(lyrics, '');

        expect(filtered?.lines.map(line => line.fullText)).toEqual(['......', 'Hello', 'World']);
    });

    it('removes matching lines and rebuilds a single interlude set', () => {
        const lyrics = parseLyricsByFormat(
            'lrc',
            '[00:04.00]制作人：Foo\n[00:10.00]Hello\n[00:20.00]版权所有 Bar\n[00:24.00]World'
        );

        const filtered = applyLyricDisplayFilter(lyrics, '^(制作人|版权所有).*$');

        expect(filtered?.lines.map(line => line.fullText)).toEqual(['......', 'Hello', '......', 'World']);
        expect(filtered?.lines.filter(line => line.fullText === '......')).toHaveLength(2);
    });

    it('ignores invalid regular expressions instead of breaking lyrics', () => {
        const lyrics = parseLyricsByFormat('lrc', '[00:04.00]Hello');
        const filtered = applyLyricDisplayFilter(lyrics, '[');

        expect(filtered?.lines.map(line => line.fullText)).toEqual(['......', 'Hello']);
    });

    it('supports previewing removed lines without mutating the lyric data', () => {
        const lyrics = parseLyricsByFormat('lrc', '[00:04.00]制作人：Foo\n[00:10.00]Hello');
        const preview = buildLyricFilterPreview(lyrics, '制作人');

        expect(preview.totalCount).toBe(2);
        expect(preview.removedCount).toBe(1);
        expect(preview.lines[0].removed).toBe(true);
        expect(preview.lines[1].removed).toBe(false);
    });

    it('allows raw parsing without interludes before post-filter reconstruction', () => {
        const lyrics = parseLyricsByFormat(
            'vtt',
            'WEBVTT\n\n00:05.000 --> 00:06.000\n版权所有\n\n00:10.000 --> 00:11.000\nHello',
            '',
            { includeInterludes: false }
        );

        expect(lyrics.lines.map(line => line.fullText)).toEqual(['版权所有', 'Hello']);

        const filtered = applyLyricDisplayFilter(lyrics, '^版权所有$');
        expect(filtered?.lines.map(line => line.fullText)).toEqual(['......', 'Hello']);
    });
});
