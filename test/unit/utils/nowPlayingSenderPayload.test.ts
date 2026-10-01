import { describe, expect, it } from 'vitest';
import { buildNowPlayingSenderLyric, buildNowPlayingSenderTrack } from '../../../src/utils/nowPlayingSenderPayload';
import type { LyricData } from '../../../src/types';

// test/unit/utils/nowPlayingSenderPayload.test.ts
// Pins the outbound now-playing payload mapping: line-level lrc always, word-level
// karaokeLyric only for genuinely word-by-word lyrics.

const lineLyrics: LyricData = {
    isWordByWord: false,
    lines: [
        {
            fullText: 'Hello',
            startTime: 1,
            endTime: 2,
            translation: '你好',
            words: [{ text: 'Hello', startTime: 1, endTime: 2 }],
        },
    ],
};

const wordLyrics: LyricData = {
    isWordByWord: true,
    title: 'Song',
    artist: 'Artist',
    lines: [
        {
            fullText: 'Hello world',
            startTime: 1,
            endTime: 3,
            words: [
                { text: 'Hello ', startTime: 1, endTime: 2 },
                { text: 'world', startTime: 2, endTime: 3 },
            ],
        },
    ],
};

describe('buildNowPlayingSenderTrack', () => {
    it('falls back to lyric metadata when there is no song object', () => {
        const built = buildNowPlayingSenderTrack({
            song: null,
            lyrics: wordLyrics,
            coverUrl: null,
            durationMs: 0,
        });
        expect(built?.snapshot).toMatchObject({ title: 'Song', artist: 'Artist', durationMs: null });
    });

    it('returns null for an empty playback surface', () => {
        expect(buildNowPlayingSenderTrack({ song: null, lyrics: null, coverUrl: null, durationMs: 0 })).toBeNull();
    });

    it('keeps a stable key across identical inputs', () => {
        const input = { song: null, lyrics: wordLyrics, coverUrl: 'http://cover', durationMs: 3000 };
        expect(buildNowPlayingSenderTrack(input)?.key).toBe(buildNowPlayingSenderTrack(input)?.key);
    });
});

describe('buildNowPlayingSenderLyric', () => {
    it('emits only the line timeline for line-by-line lyrics', () => {
        const payload = buildNowPlayingSenderLyric(lineLyrics);
        expect(payload?.lrc).toContain('Hello');
        expect(payload?.karaokeLyric).toBeNull();
        expect(payload?.hasKaraokeLyric).toBe(false);
        // Clients parse `translatedLyric` as LRC, so it has to keep the line timestamp.
        expect(payload?.translatedLyric).toBe('[00:01.00]你好\n');
    });

    // now-playing clients read `karaokeLyric` with `parseLys`, which only understands
    // `[0]word(startMs,durationMs)` — anything else parses to zero lines and shows blank.
    it('emits a LYS word timeline when the lyric is genuinely word-by-word', () => {
        const payload = buildNowPlayingSenderLyric(wordLyrics);
        expect(payload?.hasKaraokeLyric).toBe(true);
        expect(payload?.karaokeLyric).toBe('[0]Hello (1000,1000)world(2000,1000)\n');
        // The line-level lrc must stay line-timed even for word lyrics.
        expect(payload?.lrc).not.toContain('<00:01.000>');
    });

    it('skips interlude lines in the word timeline', () => {
        const payload = buildNowPlayingSenderLyric({
            ...wordLyrics,
            lines: [
                ...wordLyrics.lines,
                { fullText: '......', startTime: 4, endTime: 5, words: [{ text: '..', startTime: 4, endTime: 5 }] },
            ],
        });
        expect(payload?.karaokeLyric).toBe('[0]Hello (1000,1000)world(2000,1000)\n');
    });

    it('returns null without lyrics', () => {
        expect(buildNowPlayingSenderLyric(null)).toBeNull();
        expect(buildNowPlayingSenderLyric({ lines: [] })).toBeNull();
    });
});
