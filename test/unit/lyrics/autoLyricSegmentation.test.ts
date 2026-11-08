import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line, LyricData, SongResult } from '@/types';
import { pickAutoSegmentationLines, type AutoLyricSegmentationState } from '@/utils/lyrics/autoLyricSegmentation';

// test/unit/lyrics/autoLyricSegmentation.test.ts
// 自动 AI 分词 (issue #960): which songs an automatic run picks up, and that the save it ends in
// never lands on a song other than the one it was made for.

const saved = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@/services/lyricSegmentation', () => ({
    saveSongSegmentation: vi.fn(async (...args: unknown[]) => { saved.calls.push(args); }),
    deleteSongSegmentation: vi.fn(async () => undefined),
}));
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: vi.fn() }));

const { createLyricSegmentationActions } = await import('@/components/app/playback/createLyricSegmentationActions');
const { useLyricSegmentationStore } = await import('@/stores/useLyricSegmentationStore');

const line = (fullText: string, startTime = 0): Line => ({ fullText, startTime, endTime: startTime + 1, words: [] } as unknown as Line);
const lyrics = (...texts: string[]): LyricData => ({ lines: texts.map((text, index) => line(text, index)) });

const base: AutoLyricSegmentationState = {
    enabled: true,
    usesWords: true,
    songKey: 'local:a',
    recordSongKey: 'local:a',
    hasRecord: false,
    isLyricsLoading: false,
    lyrics: lyrics('君の名前を呼んだ', '', '夜明けまで歌おう', 'oh yeah'),
    alreadyAttempted: false,
};

describe('pickAutoSegmentationLines', () => {
    it('picks the non-empty lines of a Japanese song with no saved split', () => {
        expect(pickAutoSegmentationLines(base)?.map(entry => entry.fullText)).toEqual(['君の名前を呼んだ', '夜明けまで歌おう', 'oh yeah']);
    });

    it.each<[string, Partial<AutoLyricSegmentationState>]>([
        ['the setting is off', { enabled: false }],
        ['the mode does not draw words', { usesWords: false }],
        ['the saved-record load has not finished for this song', { recordSongKey: 'local:previous' }],
        ['a split is already saved', { hasRecord: true }],
        ['the lyrics are still loading', { isLyricsLoading: true }],
        ['there are no lyrics', { lyrics: null }],
        ['the song was already tried', { alreadyAttempted: true }],
        ['no line has Chinese or Japanese', { lyrics: lyrics('hello world', 'again') }],
        ['only the credits are Chinese', { lyrics: lyrics('作词 : Taylor Swift', '作曲 : Max Martin', 'We are never', 'ever getting back together') }],
        ['a single quoted line is Japanese', { lyrics: lyrics('one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ありがとう', 'さよなら') }],
    ])('skips when %s', (_label, patch) => {
        expect(pickAutoSegmentationLines({ ...base, ...patch })).toBeNull();
    });
});

describe('lyric segmentation save', () => {
    const song = (id: string) => ({ id, name: id, sourceRef: { kind: 'local', mediaId: id } } as unknown as SongResult);

    beforeEach(() => {
        saved.calls = [];
        useLyricSegmentationStore.getState().clear();
    });

    it('drops an automatic save made for a song that is no longer playing', async () => {
        const setLyrics = vi.fn();
        const actions = createLyricSegmentationActions({
            getCurrentSong: () => song('b'),
            loadCurrentSongLyricPreview: async () => null,
            setLyrics,
        });

        await actions.save({ '0|君': ['君'] }, 'ai', { songKey: 'local:not-playing', auto: true });

        expect(saved.calls).toHaveLength(0);
        expect(setLyrics).not.toHaveBeenCalled();
        expect(useLyricSegmentationStore.getState().record).toBeNull();
    });

    it('keeps a save on disk but off the screen when the song changes during the write', async () => {
        let current = song('a');
        const setLyrics = vi.fn();
        const actions = createLyricSegmentationActions({
            getCurrentSong: () => current,
            loadCurrentSongLyricPreview: async () => null,
            setLyrics,
        });
        const { saveSongSegmentation } = await import('@/services/lyricSegmentation');
        vi.mocked(saveSongSegmentation).mockImplementationOnce(async (...args: unknown[]) => {
            saved.calls.push(args);
            current = song('b');
        });

        await actions.save({ '0|君': ['君'] }, 'ai');

        expect(saved.calls).toHaveLength(1);
        expect(setLyrics).not.toHaveBeenCalled();
        expect(useLyricSegmentationStore.getState().record).toBeNull();
    });

    it('does not re-lay the next song when the preview resolves after a skip', async () => {
        let current = song('a');
        const setLyrics = vi.fn();
        const actions = createLyricSegmentationActions({
            getCurrentSong: () => current,
            loadCurrentSongLyricPreview: async () => {
                current = song('b');
                return { lines: [] };
            },
            setLyrics,
        });

        await actions.save({ '0|君': ['君'] }, 'ai');

        expect(saved.calls).toHaveLength(1);
        expect(setLyrics).not.toHaveBeenCalled();
    });

    it('applies a save to the song that is still playing', async () => {
        const setLyrics = vi.fn();
        const playing = song('a');
        const actions = createLyricSegmentationActions({
            getCurrentSong: () => playing,
            loadCurrentSongLyricPreview: async () => null,
            setLyrics,
        });
        const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');

        await actions.save({ '0|君': ['君'] }, 'ai', { songKey: getPlaybackSongKey(playing), auto: true });

        expect(saved.calls).toHaveLength(1);
        expect(setLyrics).toHaveBeenCalledTimes(1);
        expect(useLyricSegmentationStore.getState().record?.source).toBe('ai');
    });
});
