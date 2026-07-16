import { describe, expect, it, vi } from 'vitest';
import { createLyricsSetter } from '@/components/app/playback/createLyricsSetter';
import type { LyricData, SongResult } from '@/types';
import type { MutableRefObject } from 'react';

// test/unit/lyrics/createLyricsSetter.test.ts

describe('createLyricsSetter', () => {
    it('applies text-based chorus detection if no chorus lines exist', () => {
        const setLyricsStateMock = vi.fn();
        const lyricFilterPattern = '';
        const setter = createLyricsSetter(setLyricsStateMock, lyricFilterPattern);

        const lyrics: LyricData = {
            lines: [
                { fullText: '副歌部分重复了', startTime: 0, endTime: 1000, words: [] },
                { fullText: '普通主歌歌词', startTime: 1000, endTime: 2000, words: [] },
                { fullText: '副歌部分重复了', startTime: 2000, endTime: 3000, words: [] },
            ],
        };

        setter(lyrics);

        expect(setLyricsStateMock).toHaveBeenCalled();
        const result = setLyricsStateMock.mock.calls[0][0] as LyricData;
        expect(result.lines[0].isChorus).toBe(true);
        expect(result.lines[1].isChorus).toBeUndefined();
        expect(result.lines[2].isChorus).toBe(true);
    });

    it('does not overwrite existing chorus lines', () => {
        const setLyricsStateMock = vi.fn();
        const lyricFilterPattern = '';
        const setter = createLyricsSetter(setLyricsStateMock, lyricFilterPattern);

        const lyrics: LyricData = {
            lines: [
                { fullText: '副歌部分重复了', startTime: 0, endTime: 1000, words: [], isChorus: true, chorusEffect: 'beams' },
                { fullText: '普通主歌歌词', startTime: 1000, endTime: 2000, words: [] },
                { fullText: '副歌部分重复了', startTime: 2000, endTime: 3000, words: [] },
            ],
        };

        setter(lyrics);

        expect(setLyricsStateMock).toHaveBeenCalled();
        const result = setLyricsStateMock.mock.calls[0][0] as LyricData;
        expect(result.lines[0].isChorus).toBe(true);
        expect(result.lines[0].chorusEffect).toBe('beams');
        expect(result.lines[2].isChorus).toBeUndefined();
    });

    it('preserves and applies NetEase chorus ranges when switching lyric sources for the same song', () => {
        const setLyricsStateMock = vi.fn();
        const currentSong: SongResult = {
            id: 12345,
            name: 'Test Song',
            artists: [],
            album: { id: 1, name: 'Test Album' },
            duration: 180000,
        };
        const currentSongFullRef: MutableRefObject<SongResult | null> = { current: currentSong };
        const setter = createLyricsSetter(setLyricsStateMock, '', currentSongFullRef);

        // 1. Initial NetEase lyrics set with chorus
        const neteaseLyrics: LyricData = {
            lines: [
                { fullText: '主歌', startTime: 0, endTime: 10000, words: [] },
                { fullText: '副歌部分', startTime: 10000, endTime: 30000, words: [], isChorus: true, chorusEffect: 'bars' },
            ],
        };
        setter(neteaseLyrics);

        // 2. Switch to QQ / Kugou / Local lyrics (no chorus originally)
        const newSourceLyrics: LyricData = {
            lines: [
                { fullText: 'Verse 1', startTime: 0, endTime: 9000, words: [] },
                { fullText: 'Chorus part', startTime: 11000, endTime: 28000, words: [] },
            ],
        };
        setter(newSourceLyrics);

        const result = setLyricsStateMock.mock.calls[1][0] as LyricData;
        // The second line is within [10s, 30s], so it should be marked as chorus based on cached ranges
        expect(result.lines[0].isChorus).toBeUndefined();
        expect(result.lines[1].isChorus).toBe(true);
    });

    it('does not require a full LocalSong carrier for local playback snapshots', () => {
        const setLyricsStateMock = vi.fn();
        const currentSong = {
            id: 999,
            name: 'Local Matched Song',
            artists: [],
            album: { name: 'Album' },
            duration: 120000,
            isLocal: true,
            localRef: { songId: 'local-999' },
        } as any as SongResult;
        
        const currentSongFullRef: MutableRefObject<SongResult | null> = { current: currentSong };
        const setter = createLyricsSetter(setLyricsStateMock, '', currentSongFullRef);

        const localLyrics: LyricData = {
            lines: [
                { fullText: 'Local line 1', startTime: 0, endTime: 8000, words: [] },
                { fullText: 'Local line 2', startTime: 12000, endTime: 25000, words: [] },
            ],
        };
        setter(localLyrics);

        const result = setLyricsStateMock.mock.calls[0][0] as LyricData;
        expect(result.lines[0].isChorus).toBeUndefined();
        expect(result.lines[1].isChorus).toBeUndefined();
    });

    it('resets cached chorus ranges when song changes', () => {
        const setLyricsStateMock = vi.fn();
        const songA = { id: 101, name: 'Song A', artists: [], album: { id: 201, name: 'A' }, duration: 100 } as SongResult;
        const songB = { id: 102, name: 'Song B', artists: [], album: { id: 202, name: 'B' }, duration: 100 } as SongResult;
        const currentSongFullRef: MutableRefObject<SongResult | null> = { current: songA };
        
        const setter = createLyricsSetter(setLyricsStateMock, '', currentSongFullRef);

        // 1. Set Song A with chorus
        setter({
            lines: [
                { fullText: 'Verse A', startTime: 0, endTime: 10000, words: [] },
                { fullText: 'Chorus A', startTime: 10000, endTime: 30000, words: [], isChorus: true },
            ],
        });

        // 2. Change to Song B
        currentSongFullRef.current = songB;

        // 3. Set Song B with no chorus
        setter({
            lines: [
                { fullText: 'Verse B', startTime: 0, endTime: 10000, words: [] },
                { fullText: 'Normal line B', startTime: 12000, endTime: 25000, words: [] },
            ],
        });

        const result = setLyricsStateMock.mock.calls[1][0] as LyricData;
        // Should use text-based detection fallback or nothing, not Song A's cached ranges
        expect(result.lines[1].isChorus).toBeUndefined(); // 'Normal line B' is unique and not repeated, so it shouldn't be chorus
    });
});
