import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAmllDbLyrics, searchAmllDbSongs } from '@/utils/lyrics/providers/amllDbProvider';
import { fetchLyricsForMatchSource, searchAmllDbLyricCandidates } from '@/utils/lyrics/lyricMatchSources';
import type { AmllApiSongItem } from '@/utils/lyrics/providers/amllApi';
import { neteaseApi } from '@/services/onlineMusic/netease/netease';
import { searchQQLyrics } from '@/services/onlineMusic/qq/qqLyricProvider';

// test/unit/lyrics/lyricMatchSources.test.ts
// Covers source-specific lyric matching orchestration.

vi.mock('@/services/onlineMusic/netease/netease', () => ({
    neteaseApi: {
        cloudSearch: vi.fn(),
        getLyric: vi.fn(),
        getChorus: vi.fn(),
    }
}));

vi.mock('@/utils/lyrics/neteaseProcessing', () => ({
    parseNeteaseChorusRanges: vi.fn(() => []),
    processNeteaseLyrics: vi.fn(),
}));

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({
    searchQQLyrics: vi.fn(),
    fetchQQLyrics: vi.fn(),
}));

vi.mock('@/services/onlineMusic/kugou/kugouLyricProvider', () => ({
    searchKugouLyrics: vi.fn(),
    fetchKugouLyrics: vi.fn(),
}));

vi.mock('@/utils/lyrics/providers/amllDbProvider', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/lyrics/providers/amllDbProvider')>(),
    fetchAmllDbLyrics: vi.fn(),
    searchAmllDbSongs: vi.fn(),
}));

vi.mock('@/utils/lyrics/chorusEffects', () => ({
    applyChorusRangesByTime: vi.fn((lyrics) => lyrics),
}));

const createWordByWordLyrics = () => ({
    lines: [{
        fullText: 'Test lyric',
        startTime: 0,
        endTime: 1,
        words: [],
    }],
    isWordByWord: true as const,
});

const songItem = (overrides: Partial<AmllApiSongItem> = {}): AmllApiSongItem => ({
    id: 1,
    filename: '1-1-a.ttml',
    createdAt: 1,
    musicNames: ['Song Title'],
    artistNames: ['Artist Name'],
    albumNames: ['Album'],
    ncmMusicIds: [],
    qqMusicIds: [],
    appleMusicIds: [],
    spotifyIds: [],
    isrcs: [],
    authorIds: [],
    authorUsernames: [],
    ...overrides,
});

const target = { title: 'Song Title', artist: 'Artist Name, Guest', durationMs: 200000 };

describe('lyricMatchSources', () => {
    const searchAmllDbSongsMock = vi.mocked(searchAmllDbSongs);
    const fetchAmllDbLyricsMock = vi.mocked(fetchAmllDbLyrics);

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('searchAmllDbLyricCandidates', () => {
        it('searches the official API with musicName and first artist, without probing lyrics', async () => {
            searchAmllDbSongsMock.mockResolvedValue([
                songItem({ id: 3, musicNames: ['Other Song'], artistNames: ['Someone'], ncmMusicIds: ['300'] }),
                songItem({ id: 2, createdAt: 2, ncmMusicIds: ['101'] }),
                songItem({ id: 1, createdAt: 1, ncmMusicIds: ['101'] }),
                songItem({ id: 4, qqMusicIds: ['000zi9gH0OEMMu'] }),
                songItem({ id: 5, spotifyIds: ['only-spotify'] }),
            ]);

            const results = await searchAmllDbLyricCandidates('Song Title - Artist Name, Guest - Album', target);

            expect(searchAmllDbSongsMock).toHaveBeenCalledTimes(1);
            expect(searchAmllDbSongsMock).toHaveBeenCalledWith({ musicName: 'Song Title', artistName: 'Artist Name' }, 50);
            expect(fetchAmllDbLyricsMock).not.toHaveBeenCalled();
            expect(results.map(result => [result.amllDbPlatform, result.id])).toEqual([
                ['ncm', 101],
                ['qq', '000zi9gH0OEMMu'],
                ['ncm', 300],
            ]);
        });

        it('retries with the title alone when title + artist finds nothing', async () => {
            searchAmllDbSongsMock
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([songItem({ ncmMusicIds: ['101'] })]);

            const results = await searchAmllDbLyricCandidates('Song Title - Artist Name', target);

            expect(searchAmllDbSongsMock.mock.calls.map(([params]) => params)).toEqual([
                { musicName: 'Song Title', artistName: 'Artist Name' },
                { musicName: 'Song Title' },
            ]);
            expect(results.map(result => result.id)).toEqual([101]);
        });

        it('searches free-form manual input as a title first, then as a keyword query', async () => {
            searchAmllDbSongsMock.mockResolvedValue([]);

            await expect(searchAmllDbLyricCandidates('  some lyric line  ', target)).resolves.toEqual([]);
            expect(searchAmllDbSongsMock.mock.calls.map(([params]) => params)).toEqual([
                { musicName: 'some lyric line' },
                { q: 'some lyric line' },
            ]);
        });

        it('stops without the title-only retry when the request fails', async () => {
            searchAmllDbSongsMock.mockResolvedValue(null);

            await expect(searchAmllDbLyricCandidates('Song Title - Artist Name', target)).resolves.toEqual([]);
            expect(searchAmllDbSongsMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('fetchLyricsForMatchSource (amll)', () => {
        it('tries the QQ mid before the numeric id', async () => {
            fetchAmllDbLyricsMock.mockResolvedValue(createWordByWordLyrics());

            const result = await fetchLyricsForMatchSource('amll', {
                id: 105094238,
                qqMid: '000zi9gH0OEMMu',
                name: 'Song Title',
                artists: [],
                album: { id: 0, name: '' },
                durationMs: 0,
                amllDbPlatform: 'qq',
            });

            expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('qq', ['000zi9gH0OEMMu', '105094238']);
            expect(result).toMatchObject({ matchedLyricsProviderPlatform: 'qq', isPureMusic: false });
        });
    });
});
