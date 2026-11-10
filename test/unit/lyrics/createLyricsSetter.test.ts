import { describe, expect, it, vi } from 'vitest';
import { createLyricsSetter, reworkShownLyrics } from '@/components/app/playback/createLyricsSetter';
import type { LyricData, SongResult } from '@/types';
import type { MutableRefObject } from 'react';
import { lyricsBeforeRules, type LyricLineRule } from '@/utils/lyrics/lyricLineRules';
import { withUntransformedLyrics } from '@/components/app/playback/restore/useElectronWindowPlaybackHandoff';
import type { PlaybackSnapshot } from '@/types/appPlayback';

const written = (text: string): LyricLineRule[] => [{ id: 'legacy', on: true, shape: 'written', text }];

// test/unit/lyrics/createLyricsSetter.test.ts

describe('createLyricsSetter', () => {
    it('runs the user filter first and the staff policy on what survives', () => {
        const setLyricsStateMock = vi.fn();
        const setter = createLyricsSetter(setLyricsStateMock, written('^赞助'), undefined, {
            policy: 'smart',
            minDwellSeconds: 1.5,
        });

        const lyrics: LyricData = {
            lines: [
                { fullText: '赞助商：某某', startTime: 0, endTime: 0.2, words: [] },
                { fullText: '作词 : A', startTime: 0.2, endTime: 0.4, words: [] },
                { fullText: '作曲 : B', startTime: 0.4, endTime: 0.6, words: [] },
                { fullText: '第一句歌词', startTime: 2, endTime: 4, words: [] },
            ],
        };

        setter(lyrics);

        const result = setLyricsStateMock.mock.calls[0][0] as LyricData;
        expect(result.lines.map(line => line.fullText).filter(text => text !== '......')).toEqual(['第一句歌词']);
    });

    it('runs the line rules once when lyrics already shown come back', () => {
        const setLyricsStateMock = vi.fn();
        const setter = createLyricsSetter(setLyricsStateMock, [{ id: 'x', on: true, shape: 'contains', text: 'x', edgesOnly: true }]);
        const lyrics: LyricData = {
            lines: Array.from({ length: 10 }, (_, index) => ({ fullText: `x${index}`, startTime: index, endTime: index + 1, words: [] })),
        };
        const shown = (call: number) => (setLyricsStateMock.mock.calls[call][0] as LyricData).lines.map(line => line.fullText);

        setter(lyrics);
        setter(setLyricsStateMock.mock.calls[0][0] as LyricData);

        // Ten lines: the first three and the last are edges. A second pass would judge the six left
        // by themselves and remove three more.
        expect(shown(0)).toEqual(['x3', 'x4', 'x5', 'x6', 'x7', 'x8']);
        expect(shown(1)).toEqual(shown(0));
    });

    it('lays lyrics that come back out again with the rules in force now', () => {
        const states = vi.fn();
        const lyrics: LyricData = {
            lines: ['作词：A', '作曲：B', '第一句', '第二句'].map((fullText, index) => ({ fullText, startTime: index * 3, endTime: index * 3 + 2, words: [] })),
        };
        const shown = (call: number) => (states.mock.calls[call][0] as LyricData).lines.map(line => line.fullText).filter(text => text !== '......');
        const ruleOn = (text: string, on = true): LyricLineRule => ({ id: text, on, shape: 'starts', text });

        const keepCredits = { policy: 'keep' as const };
        createLyricsSetter(states, [ruleOn('作词')], undefined, keepCredits)(lyrics);
        // 保存 with a new rule, while the preview loader can only hand back what is on screen.
        createLyricsSetter(states, [ruleOn('作词'), ruleOn('作曲')], undefined, keepCredits)(states.mock.calls[0][0]);
        // The first rule switched off: its line comes back.
        createLyricsSetter(states, [ruleOn('作词', false), ruleOn('作曲')], undefined, keepCredits)(states.mock.calls[1][0]);

        expect(shown(0)).toEqual(['作曲：B', '第一句', '第二句']);
        expect(shown(1)).toEqual(['第一句', '第二句']);
        expect(shown(2)).toEqual(['作词：A', '第一句', '第二句']);
        expect(lyricsBeforeRules(states.mock.calls[2][0])).toBe(lyrics);
    });

    it('hands another window the lyrics before the rules, which it lays out once', () => {
        const states = vi.fn();
        const rules: LyricLineRule[] = [{ id: 'x', on: true, shape: 'contains', text: 'x', edgesOnly: true }];
        const lyrics: LyricData = {
            lines: Array.from({ length: 10 }, (_, index) => ({ fullText: `x${index}`, startTime: index, endTime: index + 1, words: [] })),
        };
        createLyricsSetter(states, rules)(lyrics);
        // What crosses IPC is a copy: the window it reaches knows nothing of this one's objects.
        const snapshot = { lyrics: states.mock.calls[0][0] } as PlaybackSnapshot;
        const handedOver = structuredClone(withUntransformedLyrics(snapshot).lyrics);
        createLyricsSetter(states, rules)(handedOver);

        const shown = (call: number) => (states.mock.calls[call][0] as LyricData).lines.map(line => line.fullText);
        expect(shown(1)).toEqual(['x3', 'x4', 'x5', 'x6', 'x7', 'x8']);
    });

    it('lays out once lyrics that a word split reworked on screen', () => {
        const states = vi.fn();
        const rules: LyricLineRule[] = [{ id: 'x', on: true, shape: 'contains', text: 'x', edgesOnly: true }];
        const lyrics: LyricData = {
            lines: Array.from({ length: 10 }, (_, index) => ({ fullText: `x${index}`, startTime: index, endTime: index + 1, words: [] })),
        };
        createLyricsSetter(states, rules)(lyrics);
        createLyricsSetter(states, rules)(reworkShownLyrics(states.mock.calls[0][0], shown => ({ ...shown })));

        const shown = (call: number) => (states.mock.calls[call][0] as LyricData).lines.map(line => line.fullText);
        expect(shown(1)).toEqual(['x3', 'x4', 'x5', 'x6', 'x7', 'x8']);
    });

    it('applies text-based chorus detection if no chorus lines exist', () => {
        const setLyricsStateMock = vi.fn();
        const setter = createLyricsSetter(setLyricsStateMock, []);

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
        const setter = createLyricsSetter(setLyricsStateMock, []);

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
            durationMs: 180000,
        };
        const currentSongFullRef: MutableRefObject<SongResult | null> = { current: currentSong };
        const setter = createLyricsSetter(setLyricsStateMock, [], currentSongFullRef);

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
            durationMs: 120000,
            isLocal: true,
            localRef: { songId: 'local-999' },
        } as any as SongResult;
        
        const currentSongFullRef: MutableRefObject<SongResult | null> = { current: currentSong };
        const setter = createLyricsSetter(setLyricsStateMock, [], currentSongFullRef);

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
        const songA = { id: 101, name: 'Song A', artists: [], album: { id: 201, name: 'A' }, durationMs: 100 } as SongResult;
        const songB = { id: 102, name: 'Song B', artists: [], album: { id: 202, name: 'B' }, durationMs: 100 } as SongResult;
        const currentSongFullRef: MutableRefObject<SongResult | null> = { current: songA };
        
        const setter = createLyricsSetter(setLyricsStateMock, [], currentSongFullRef);

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

    it('treats lyrics that are only the pure music notice as no lyrics', () => {
        const setLyricsStateMock = vi.fn();
        const setter = createLyricsSetter(setLyricsStateMock, []);

        setter({ lines: [{ fullText: '纯音乐 请欣赏', startTime: 0, endTime: 5, words: [] }] });

        expect(setLyricsStateMock).toHaveBeenCalledWith(null);
    });

    it('keeps a normal song whose lines merely mention pure music', () => {
        const setLyricsStateMock = vi.fn();
        const setter = createLyricsSetter(setLyricsStateMock, []);

        setter({
            lines: [
                { fullText: '作词 : A', startTime: 0, endTime: 1, words: [] },
                { fullText: '我只听纯音乐，请欣赏', startTime: 2, endTime: 4, words: [] },
                { fullText: '第二句歌词', startTime: 5, endTime: 8, words: [] },
            ],
        });

        const result = setLyricsStateMock.mock.calls[0][0] as LyricData;
        expect(result.lines.map(line => line.fullText)).toContain('我只听纯音乐，请欣赏');
    });

    it('hands the visualizer an empty line set when the user filter removes every line', () => {
        const setLyricsStateMock = vi.fn();
        const setter = createLyricsSetter(setLyricsStateMock, written('纯音乐'));

        // A notice variant no provider recognised: it was parsed as an ordinary line, and the
        // user filtered it out. What reaches the visualizer is the empty set, not the old text.
        setter({ lines: [{ fullText: '纯音乐，敬请欣赏本曲', startTime: 0, endTime: 5, words: [] }] });

        const result = setLyricsStateMock.mock.calls[0][0] as LyricData;
        expect(result.lines).toEqual([]);
    });
});
