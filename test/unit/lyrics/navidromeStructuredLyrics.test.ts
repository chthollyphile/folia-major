import { describe, expect, it } from 'vitest';
import {
    hasEnhancedNavidromeStructuredLyrics,
    parseNavidromeStructuredLyrics,
    parseNavidromeStructuredLyricsCollection,
    selectPreferredNavidromeStructuredLyric,
} from '@/utils/lyrics/navidromeStructuredLyrics';
import { normalizeEmbeddedLrcText, normalizeEmbeddedStructuredLyrics } from '@/utils/lyrics/embeddedLrcNormalization';
import { parseEnhancedLRC } from '@/utils/lyrics/parserCore';

// Covers OpenSubsonic songLyrics v2 cue timing emitted by Navidrome v0.63+.
describe('parseNavidromeStructuredLyrics', () => {
    it('splits alternating enhanced-LRC lines from getLyrics into main and translation streams', () => {
        const value = [
            '<00:12.313>あ<00:12.673>と<00:13.185>ど<00:13.377>れ<00:13.585>く<00:13.769>ら<00:13.945>い<00:14.321>の<00:14.945>距<00:15.233>離<00:15.290>を<00:15.345>',
            '<00:12.313>还需要向月亮<00:15.360>',
            '<00:15.369>月<00:16.092>へ<00:16.118>歩<00:16.550>い<00:16.750>た<00:17.261>ら<00:17.789>',
            '<00:15.369>走出多远<00:18.280>',
        ].join('\n');
        const normalized = normalizeEmbeddedLrcText(value);
        const parsed = parseEnhancedLRC(normalized.mainText, normalized.translationText, { includeInterludes: false });

        expect(normalized.mainText).toContain('<00:12.313>あ');
        expect(normalized.mainText).toContain('<00:15.369>月');
        expect(normalized.translationText).toContain('<00:12.313>还需要向月亮');
        expect(normalized.translationText).toContain('<00:15.369>走出多远');
        expect(parsed.lines).toMatchObject([
            { fullText: 'あとどれくらいの距離を', translation: '还需要向月亮' },
            { fullText: '月へ歩いたら', translation: '走出多远' },
        ]);
    });

    it('prefers an enhanced-LRC main track over a character-level main track', () => {
        const tracks = [
            {
                kind: 'main',
                synced: true,
                line: [
                    { start: 0, value: '産' },
                    { start: 260, value: '巣' },
                    { start: 530, value: '日' },
                ],
            },
            {
                kind: 'main',
                synced: true,
                line: [{ start: 0, value: '<00:00.000>産<00:00.267>巣<00:00.534>日<00:00.801>' }],
            },
        ];
        const selected = selectPreferredNavidromeStructuredLyric(tracks);

        expect(selected).toBe(tracks[1]);
        expect(hasEnhancedNavidromeStructuredLyrics(tracks[0])).toBe(false);
        expect(hasEnhancedNavidromeStructuredLyrics(tracks[1])).toBe(true);
        expect(parseNavidromeStructuredLyricsCollection(tracks, { includeInterludes: false })).toBeNull();

        const normalized = normalizeEmbeddedStructuredLyrics(selected?.line);
        const parsed = parseEnhancedLRC(normalized.mainText, normalized.translationText, { includeInterludes: false });
        expect(parsed.lines[0]).toMatchObject({ fullText: '産巣日' });
        expect(parsed.lines[0].words).toHaveLength(3);
    });

    it('merges one synchronized translation track and pronunciation track from enhanced lyrics', () => {
        const parsed = parseNavidromeStructuredLyricsCollection([
            {
                kind: 'main',
                offset: 100,
                synced: true,
                line: [
                    { start: 1000, value: 'Main one' },
                    { start: 3000, value: 'Main two' },
                ],
                cueLine: [
                    { index: 0, start: 1000, end: 2000, value: 'Main one', cue: [{ start: 1000, end: 2000, value: 'Main one' }] },
                    { index: 1, start: 3000, end: 4000, value: 'Main two', cue: [{ start: 3000, end: 4000, value: 'Main two' }] },
                ],
            },
            {
                kind: 'translation',
                synced: false,
                line: [
                    { start: 1000, value: 'Ignore this translation' },
                    { start: 3000, value: 'Ignore this translation too' },
                ],
            },
            {
                kind: 'translation',
                offset: 100,
                synced: true,
                line: [
                    { start: 1000, value: 'Keep this translation' },
                    { start: 3000, value: 'Keep this translation too' },
                ],
            },
            {
                kind: 'pronunciation',
                offset: 100,
                synced: true,
                line: [
                    { start: 1000, value: 'main one' },
                    { start: 3000, value: 'main two' },
                ],
            },
        ], { includeInterludes: false });

        expect(parsed?.lines).toMatchObject([
            {
                startTime: 1.1,
                endTime: 2.1,
                translation: 'Keep this translation',
                romanization: 'main one',
            },
            {
                startTime: 3.1,
                endTime: 4.1,
                translation: 'Keep this translation too',
                romanization: 'main two',
            },
        ]);
    });

    it('applies offsets while merging synchronized line-level tracks without cue timing', () => {
        const parsed = parseNavidromeStructuredLyricsCollection([
            {
                kind: 'main',
                offset: -100,
                synced: true,
                line: [{ start: 1000, value: 'Line-level main' }],
            },
            {
                kind: 'translation',
                offset: -100,
                synced: true,
                line: [{ start: 1000, value: '行级译文' }],
            },
        ], { includeInterludes: false });

        expect(parsed?.lines[0]).toMatchObject({
            startTime: 0.9,
            fullText: 'Line-level main',
            translation: '行级译文',
        });
    });

    it('attaches untimed translations interleaved with cue lines', () => {
        const parsed = parseNavidromeStructuredLyrics({
            displayArtist: '[Unknown Artist]',
            displayTitle: 'DEBUG-钢琴NEXT TO YOU',
            kind: 'main',
            lang: 'xxx',
            line: [
                { start: 0, value: 'Reviving each other in this hell' },
                { start: 0, value: '让彼此在这地狱里重获新生' },
                { start: 24438, value: 'Lamenta lamenta lamenta' },
                { start: 24438, value: '哀叹连连' },
            ],
            cueLine: [
                {
                    index: 0,
                    start: 0,
                    end: 3480,
                    value: 'Reviving each other in this hell',
                    cue: [{ start: 0, end: 3480, value: 'Reviving each other in this hell' }],
                },
                {
                    index: 2,
                    start: 24438,
                    end: 24978,
                    value: 'Lamenta lamenta lamenta',
                    cue: [{ start: 24438, end: 24978, value: 'Lamenta lamenta lamenta' }],
                },
            ],
            synced: true,
        }, { includeInterludes: false });

        expect(parsed?.lines).toMatchObject([
            { fullText: 'Reviving each other in this hell', translation: '让彼此在这地狱里重获新生' },
            { fullText: 'Lamenta lamenta lamenta', translation: '哀叹连连' },
        ]);
    });

    it('does not treat an adjacent timed line as a translation', () => {
        const parsed = parseNavidromeStructuredLyrics({
            line: [
                { start: 0, value: 'First line' },
                { start: 0, value: 'Second line' },
            ],
            cueLine: [
                { index: 0, start: 0, end: 500, value: 'First line', cue: [{ start: 0, end: 500, value: 'First line' }] },
                { index: 1, start: 0, end: 500, value: 'Second line', cue: [{ start: 0, end: 500, value: 'Second line' }] },
            ],
        }, { includeInterludes: false });

        expect(parsed?.lines).toMatchObject([
            { fullText: 'First line', translation: undefined },
            { fullText: 'Second line', translation: undefined },
        ]);
    });

    it('preserves word timing instead of extending a line to the next lyric start', () => {
        const parsed = parseNavidromeStructuredLyrics({
            displayArtist: 'Artist',
            displayTitle: 'Track',
            line: [
                { start: 194652, value: 'Reviving each other in this hell' },
                { start: 219090, value: 'Lamenta lamenta lamenta' },
            ],
            synced: true,
            cueLine: [
                {
                    index: 0,
                    start: 194652,
                    end: 198132,
                    value: 'Reviving each other in this hell',
                    cue: [
                        { start: 194652, end: 195523, value: 'Reviving ' },
                        { start: 195523, end: 195909, value: 'each ' },
                        { start: 195909, end: 196587, value: 'other ' },
                        { start: 196587, end: 197078, value: 'in ' },
                        { start: 197078, end: 197540, value: 'this ' },
                        { start: 197540, end: 198132, value: 'hell' },
                    ],
                },
                {
                    index: 1,
                    start: 219090,
                    end: 219630,
                    value: 'Lamenta lamenta lamenta',
                    cue: [
                        { start: 219090, end: 219260, value: 'Lamenta ' },
                        { start: 219260, end: 219451, value: 'lamenta ' },
                        { start: 219451, end: 219630, value: 'lamenta' },
                    ],
                },
            ],
        }, { includeInterludes: false });

        expect(parsed?.title).toBe('Track');
        expect(parsed?.lines[0]).toMatchObject({
            startTime: 194.652,
            endTime: 198.132,
            fullText: 'Reviving each other in this hell',
        });
        expect(parsed?.lines[0].words).toEqual([
            { text: 'Reviving ', startTime: 194.652, endTime: 195.523 },
            { text: 'each ', startTime: 195.523, endTime: 195.909 },
            { text: 'other ', startTime: 195.909, endTime: 196.587 },
            { text: 'in ', startTime: 196.587, endTime: 197.078 },
            { text: 'this ', startTime: 197.078, endTime: 197.54 },
            { text: 'hell', startTime: 197.54, endTime: 198.132 },
        ]);
    });
});
