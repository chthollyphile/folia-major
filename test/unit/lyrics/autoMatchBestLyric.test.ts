import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { neteaseApi } from '@/services/onlineMusic/netease/netease';
import { processNeteaseLyrics } from '@/utils/lyrics/neteaseProcessing';
import { searchQQLyrics, fetchQQLyrics } from '@/services/onlineMusic/qq/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from '@/services/onlineMusic/kugou/kugouLyricProvider';
import { fetchAmllDbLyrics } from '@/utils/lyrics/providers/amllDbProvider';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';

// test/unit/lyrics/autoMatchBestLyric.test.ts
// Unit tests for the best lyric auto-matcher.

vi.mock('@/services/onlineMusic/netease/netease', () => ({
    neteaseApi: {
        cloudSearch: vi.fn(),
        getLyric: vi.fn(),
        getSongDetail: vi.fn(),
        getChorus: vi.fn(),
    }
}));

vi.mock('@/utils/lyrics/neteaseProcessing', () => ({
    parseNeteaseChorusRanges: vi.fn(() => []),
    processNeteaseLyrics: vi.fn()
}));

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({
    searchQQLyrics: vi.fn(),
    fetchQQLyrics: vi.fn()
}));

vi.mock('@/services/onlineMusic/kugou/kugouLyricProvider', () => ({
    searchKugouLyrics: vi.fn(),
    fetchKugouLyrics: vi.fn()
}));

vi.mock('@/utils/lyrics/providers/amllDbProvider', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/lyrics/providers/amllDbProvider')>(),
    fetchAmllDbLyrics: vi.fn()
}));

const createLyrics = (isWordByWord: boolean) => ({
    lines: [{
        fullText: 'Test lyric',
        startTime: 0,
        endTime: 1,
        words: [],
    }],
    isWordByWord,
});

describe('autoMatchBestLyric', () => {
    const cloudSearchMock = vi.mocked(neteaseApi.cloudSearch);
    const getLyricMock = vi.mocked(neteaseApi.getLyric);
    const processNeteaseLyricsMock = vi.mocked(processNeteaseLyrics);
    const searchQQLyricsMock = vi.mocked(searchQQLyrics);
    const fetchQQLyricsMock = vi.mocked(fetchQQLyrics);
    const searchKugouLyricsMock = vi.mocked(searchKugouLyrics);
    const fetchKugouLyricsMock = vi.mocked(fetchKugouLyrics);
    const fetchAmllDbLyricsMock = vi.mocked(fetchAmllDbLyrics);

    beforeEach(() => {
        vi.resetAllMocks();
        fetchAmllDbLyricsMock.mockResolvedValue(null);
    });

    it('tries the default QQ preference before a prefetched NetEase word-by-word candidate', async () => {
        const neteaseSong = {
            id: 101,
            name: 'Song Title',
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 2, name: 'Album' },
            durationMs: 200000,
            sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '101' },
        };
        searchQQLyricsMock.mockResolvedValue([{
            id: 201,
            name: 'Song Title',
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 2, name: 'Album' },
            durationMs: 200000,
            qqMid: 'qq-mid',
        }]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            providerCandidate: {
                providerId: 'netease',
                song: neteaseSong,
                lyricsResult: { lyrics: createLyrics(true), isPureMusic: false },
            },
        });

        expect(result && 'lyrics' in result ? result.source : null).toBe('qq');
        expect(searchQQLyricsMock).toHaveBeenCalledTimes(1);
        expect(cloudSearchMock).not.toHaveBeenCalled();
    });

    it('reuses the active QQ provider candidate without searching or fetching QQ again', async () => {
        const qqSong = {
            id: 201,
            qqMid: 'qq-mid',
            name: 'Song Title',
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 2, name: 'Album' },
            durationMs: 200000,
            sourceRef: { kind: 'online' as const, providerId: 'qq', mediaId: 'qq-mid' },
        };
        const lyrics = createLyrics(true);

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'qq',
            providerCandidate: {
                providerId: 'qq',
                song: qqSong,
                lyricsResult: { lyrics, isPureMusic: false },
            },
        });

        expect(result).toMatchObject({ source: 'qq', id: 201, qqMid: 'qq-mid', lyrics });
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
        expect(fetchQQLyricsMock).not.toHaveBeenCalled();
    });

    it('bridges a KuGou baseline through a scored NetEase id before probing AMLLDB', async () => {
        searchQQLyricsMock.mockResolvedValue([]);
        cloudSearchMock.mockResolvedValue({ result: { songs: [{
            id: 101,
            name: 'Song Title',
            dt: 200000,
            ar: [{ id: 1, name: 'Artist Name' }],
            al: { id: 2, name: 'Album' },
        }] } });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: '[00:00.00]line',
            yrcLrc: null,
            transLrc: null,
            isPureMusic: false,
            chorusRanges: [],
        });
        fetchAmllDbLyricsMock.mockResolvedValue(createLyrics(true));
        const kugouSong = {
            id: 'KUGOU-HASH',
            kgHash: 'KUGOU-HASH',
            name: 'Song Title',
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 2, name: 'Album' },
            durationMs: 200000,
            sourceRef: { kind: 'online' as const, providerId: 'kugou', mediaId: 'KUGOU-HASH' },
        };

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            album: 'Album',
            providerCandidate: {
                providerId: 'kugou',
                song: kugouSong,
                lyricsResult: { lyrics: createLyrics(false), isPureMusic: false },
            },
        });

        expect(result && 'lyrics' in result ? result.source : null).toBe('amll');
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('ncm', ['101']);
        expect(fetchAmllDbLyricsMock).not.toHaveBeenCalledWith('ncm', ['KUGOU-HASH']);
    });

    it('prioritizes NetEase when perfect word-by-word match exists', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]test' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(true),
            mainLrc: 'test',
            yrcLrc: 'test',
            transLrc: '',
            isPureMusic: false
        });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { preferredSource: 'netease' }) as any;
        expect(result).not.toBeNull();
        expect(result.source).toBe('netease');
        expect(result.id).toBe(101);
        expect(cloudSearchMock).toHaveBeenCalled();
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
    });

    it('accepts the selected NetEase lyric directly when best-lyric selection is disabled', async () => {
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]selected' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: 'selected',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false,
            chorusRanges: [],
        });

        const result = await autoMatchBestLyric('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            metadataCandidate: { source: 'netease', songId: 987 },
            exactMatchOnly: true,
        }) as any;

        expect(result).toMatchObject({ source: 'netease', id: 987 });
        expect(getLyricMock).toHaveBeenCalledTimes(1);
        expect(getLyricMock).toHaveBeenCalledWith(987);
        expect(cloudSearchMock).not.toHaveBeenCalled();
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
    });

    it('accepts the selected QQ lyric directly when best-lyric selection is disabled', async () => {
        searchQQLyricsMock.mockResolvedValue([
            { id: 201, name: 'Correct title', durationMs: 200000, artists: [{ id: 1, name: 'Wrong artist' }], album: { id: 2, name: 'Wrong album' }, qqMid: 'distractor-mid' },
            { id: 202, name: 'Correct title', durationMs: 200000, artists: [{ id: 3, name: 'Correct artist' }], album: { id: 4, name: 'Correct album' }, qqMid: 'selected-mid' },
        ]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(false));

        const result = await autoMatchBestLyric('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            metadataCandidate: { source: 'qq', songId: 'selected-mid' },
            exactMatchOnly: true,
        }) as any;

        expect(searchQQLyricsMock).toHaveBeenCalledWith('Correct title - Correct artist - Correct album', 1, 10);
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 202, qqMid: 'selected-mid' }),
            { chorusRanges: [] },
        );
        expect(result).toMatchObject({ source: 'qq', id: 202, qqMid: 'selected-mid' });
        expect(cloudSearchMock).not.toHaveBeenCalled();
    });

    it('uses a selected NetEase id to probe preferred AMLLDB before fetching NetEase lyrics', async () => {
        fetchAmllDbLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            preferredSource: 'amll',
            metadataCandidate: { source: 'netease', songId: 987 },
        }) as any;

        expect(result).toMatchObject({ source: 'amll', id: 987, matchedLyricsProviderPlatform: 'ncm' });
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('ncm', ['987']);
        expect(getLyricMock).not.toHaveBeenCalled();
        expect(cloudSearchMock).not.toHaveBeenCalled();
    });

    it('keeps the preferred lyric source ahead of the metadata source', async () => {
        searchQQLyricsMock.mockResolvedValue([
            { id: 202, name: 'Correct title', durationMs: 200000, artists: [{ id: 3, name: 'Correct artist' }], album: { id: 4, name: 'Correct album' }, qqMid: 'preferred-mid' },
        ]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            preferredSource: 'qq',
            metadataCandidate: { source: 'netease', songId: 987 },
        }) as any;

        expect(result).toMatchObject({ source: 'qq', id: 202, qqMid: 'preferred-mid' });
        expect(getLyricMock).not.toHaveBeenCalled();
        expect(cloudSearchMock).not.toHaveBeenCalled();
    });

    it('continues to other providers when an exact NetEase result is not word-by-word', async () => {
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]line lyric' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: 'line lyric',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false,
            chorusRanges: [],
        });
        searchQQLyricsMock.mockResolvedValue([
            { id: 202, name: 'Correct title', durationMs: 200000, artists: [{ id: 3, name: 'Correct artist' }], album: { id: 4, name: 'Correct album' }, qqMid: 'word-mid' },
        ]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            preferredSource: 'netease',
            metadataCandidate: { source: 'netease', songId: 987 },
        }) as any;

        expect(getLyricMock).toHaveBeenCalledWith(987);
        expect(searchQQLyricsMock).toHaveBeenCalledWith('Correct title - Correct artist - Correct album', 1, 10);
        expect(result).toMatchObject({ source: 'qq', id: 202, qqMid: 'word-mid' });
        expect(cloudSearchMock).not.toHaveBeenCalled();
    });

    it('uses a selected QQ mid to probe preferred QQ AMLLDB lyrics', async () => {
        searchQQLyricsMock.mockResolvedValue([
            { id: 202, name: 'Correct title', durationMs: 200000, artists: [{ id: 3, name: 'Correct artist' }], album: { id: 4, name: 'Correct album' }, qqMid: 'selected-mid' },
        ]);
        fetchAmllDbLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            preferredSource: 'amll',
            metadataCandidate: { source: 'qq', songId: 'selected-mid' },
        }) as any;

        expect(searchQQLyricsMock).toHaveBeenCalledWith('Correct title - Correct artist - Correct album', 1, 10);
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('qq', ['selected-mid', '202']);
        expect(result).toMatchObject({ source: 'amll', id: 202, matchedLyricsProviderPlatform: 'qq' });
        expect(fetchQQLyricsMock).not.toHaveBeenCalled();
        expect(cloudSearchMock).not.toHaveBeenCalled();
    });

    it('falls back to QQ Music if NetEase match does not have word-by-word lyrics', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]test' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: 'test',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false
        });

        searchQQLyricsMock.mockResolvedValue([
            { id: 201, name: 'Song Title', durationMs: 201000, artists: [{ id: 1, name: 'Artist Name' }], album: { id: 0, name: '' }, qqMid: 'mid123' }
        ]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000) as any;
        expect(result).not.toBeNull();
        expect(result.source).toBe('qq');
        expect(result.id).toBe(201);
        expect(result.qqMid).toBe('mid123');
        expect(searchKugouLyricsMock).not.toHaveBeenCalled();
    });

    it('returns a high-confidence line-by-line fallback when no source has word-by-word lyrics', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]line lyric' });
        const lineByLineLyrics = createLyrics(false);
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: lineByLineLyrics,
            mainLrc: 'line lyric',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false,
            chorusRanges: [],
        });
        searchQQLyricsMock.mockResolvedValue([]);
        const kugouProvider = getOnlineMusicProvider('kugou')!;
        const kugouSearchSpy = vi.spyOn(kugouProvider.search!, 'searchSongs').mockResolvedValue({
            items: [],
            hasMore: false,
            nextOffset: 0,
        });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'netease',
        }) as any;

        expect(result).toMatchObject({
            source: 'netease',
            id: 101,
            lyrics: lineByLineLyrics,
        });
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('ncm', ['101']);
        expect(searchQQLyricsMock).toHaveBeenCalled();
        expect(kugouSearchSpy).toHaveBeenCalled();
        kugouSearchSpy.mockRestore();
    });

    it('stops matching when the NetEase candidate is pure music', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lrc: { lyric: '[00:00.00]纯音乐，请欣赏' } });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: null,
            mainLrc: '[00:00.00]纯音乐，请欣赏',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: true,
            chorusRanges: []
        });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { preferredSource: 'netease' });

        expect(result).toEqual({ isPureMusic: true, source: 'netease', id: 101 });
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
        expect(searchKugouLyricsMock).not.toHaveBeenCalled();
    });

    it('stops matching when the preprocessed NetEase candidate is pure music', async () => {
        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'netease',
            neteaseCandidate: {
                id: 101,
                lyrics: null,
                isPureMusic: true,
                chorusRanges: []
            }
        });

        expect(result).toEqual({ isPureMusic: true, source: 'netease', id: 101 });
        expect(cloudSearchMock).not.toHaveBeenCalled();
        expect(getLyricMock).not.toHaveBeenCalled();
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
        expect(searchKugouLyricsMock).not.toHaveBeenCalled();
    });

    it('normalizes accidental ms * 1000 durations before filtering candidates', async () => {
        cloudSearchMock.mockResolvedValue({ result: { songs: [] } });
        searchQQLyricsMock.mockResolvedValue([
            {
                id: 201,
                name: 'Night of Bloom',
                durationMs: 286000,
                artists: [{ id: 1, name: 'Kirara Magic' }, { id: 2, name: 'Xomu' }, { id: 3, name: 'nayuta' }],
                album: { id: 0, name: '' },
                qqMid: 'mid-night'
            }
        ]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric(
            'Night of Bloom (feat. nayuta)',
            'Kirara Magic/Xomu/nayuta',
            286000000
        ) as any;

        expect(result.source).toBe('qq');
        expect(result.qqMid).toBe('mid-night');
    });

    it('scores the top 10 QQ results and fetches only the highest scoring candidate', async () => {
        cloudSearchMock.mockResolvedValue({ result: { songs: [] } });
        const distractors = [
            { id: 200, name: 'Night Of Bloom (Starling Remix)', durationMs: 286000, artists: [{ id: 1, name: 'Xomu' }, { id: 2, name: 'StarlingEDM' }, { id: 3, name: 'nayuta' }], album: { id: 0, name: '' }, qqMid: 'remix' },
            { id: 201, name: 'Night of Bloom', durationMs: 286000, artists: [{ id: 1, name: 'Ayrex' }], album: { id: 0, name: '' }, qqMid: 'wrong-artist-1' },
            { id: 202, name: 'Night of Bloom', durationMs: 286000, artists: [{ id: 1, name: 'Nightcore Vibe' }], album: { id: 0, name: '' }, qqMid: 'wrong-artist-2' },
            { id: 203, name: 'Night of Bloom (K歌版)', durationMs: 286000, artists: [{ id: 1, name: '東京都立中央精神病院院長' }], album: { id: 0, name: '' }, qqMid: 'karaoke' },
            { id: 204, name: 'Night of Bloom remix', durationMs: 286000, artists: [{ id: 1, name: 'Gphuuuuuc' }], album: { id: 0, name: '' }, qqMid: 'remix-2' }
        ];
        const correct = {
            id: 205,
            name: 'Night of Bloom',
            durationMs: 286000,
            artists: [{ id: 1, name: 'Kirara Magic' }, { id: 2, name: 'Xomu' }, { id: 3, name: 'nayuta' }],
            album: { id: 1, name: 'Night of Bloom' },
            qqMid: 'correct-mid'
        };
        searchQQLyricsMock.mockResolvedValue([...distractors, correct]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric(
            'Night of Bloom (feat. nayuta)',
            'Kirara Magic/Xomu/nayuta',
            286000,
            { album: 'Night of Bloom' }
        ) as any;

        expect(searchQQLyricsMock).toHaveBeenCalledWith(
            'Night of Bloom (feat. nayuta) - Kirara Magic/Xomu/nayuta - Night of Bloom',
            1,
            10
        );
        expect(fetchQQLyricsMock).toHaveBeenCalledTimes(1);
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 205, qqMid: 'correct-mid' }),
            { chorusRanges: [] }
        );
        expect(result.source).toBe('qq');
        expect(result.qqMid).toBe('correct-mid');
    });

    it('applies KuGou active-provider chorus ranges to a QQ best lyric match', async () => {
        const kugouSong = {
            id: 'KUGOU-HASH',
            kgHash: 'KUGOU-HASH',
            name: 'Song Title',
            durationMs: 200000,
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 0, name: '' },
            sourceRef: { kind: 'online' as const, providerId: 'kugou', mediaId: 'KUGOU-HASH' },
        };

        searchQQLyricsMock.mockResolvedValue([
            { id: 201, name: 'Song Title', durationMs: 201000, artists: [{ id: 1, name: 'Artist Name' }], album: { id: 0, name: '' }, qqMid: 'mid123' }
        ]);
        fetchQQLyricsMock.mockResolvedValue({
            lines: [
                { fullText: 'Verse', startTime: 10, endTime: 20, words: [] },
                { fullText: 'API Chorus', startTime: 40, endTime: 45, words: [], isChorus: true, chorusEffect: 'bars' }
            ],
            isWordByWord: true
        });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'qq',
            providerCandidate: {
                providerId: 'kugou',
                song: kugouSong,
                lyricsResult: {
                    lyrics: createLyrics(false),
                    mainText: 'test',
                    isPureMusic: false,
                    chorusRanges: [{ startTime: 34, endTime: 89 }],
                },
            },
        }) as any;

        expect(result.source).toBe('qq');
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 201 }),
            { chorusRanges: [{ startTime: 34, endTime: 89 }] }
        );
        expect(result.lyrics.lines[0].isChorus).toBeUndefined();
        expect(result.lyrics.lines[0].chorusEffect).toBeUndefined();
        expect(result.lyrics.lines[1].isChorus).toBe(true);
        expect(result.lyrics.lines[1].chorusEffect).toBe('bars');
    });

    it('reuses a preprocessed NetEase candidate for the same song id', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        searchQQLyricsMock.mockResolvedValue([
            { id: 201, name: 'Song Title', durationMs: 201000, artists: [{ id: 1, name: 'Artist Name' }], album: { id: 0, name: '' }, qqMid: 'mid123' }
        ]);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'netease',
            neteaseCandidate: {
                id: 101,
                lyrics: createLyrics(false),
                chorusRanges: [{ startTime: 71.288, endTime: 100.79 }]
            }
        }) as any;

        expect(result.source).toBe('qq');
        expect(cloudSearchMock).not.toHaveBeenCalled();
        expect(getLyricMock).not.toHaveBeenCalled();
        expect(processNeteaseLyricsMock).not.toHaveBeenCalled();
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 201 }),
            { chorusRanges: [{ startTime: 71.288, endTime: 100.79 }] }
        );
    });

    it('returns the preprocessed NetEase candidate directly when it is word-by-word', async () => {
        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'netease',
            neteaseCandidate: {
                id: 101,
                lyrics: createLyrics(true),
                chorusRanges: [{ startTime: 10, endTime: 30 }]
            }
        }) as any;

        expect(result.source).toBe('netease');
        expect(result.id).toBe(101);
        expect(cloudSearchMock).not.toHaveBeenCalled();
        expect(getLyricMock).not.toHaveBeenCalled();
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
        expect(searchKugouLyricsMock).not.toHaveBeenCalled();
    });

    it('prioritizes AMLLDB when preferred and a NetEase candidate id has TTML', async () => {
        fetchAmllDbLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'amll',
            neteaseCandidate: {
                id: 101,
                lyrics: createLyrics(false),
                chorusRanges: []
            }
        }) as any;

        expect(result.source).toBe('amll');
        expect(result.id).toBe(101);
        expect(result.matchedLyricsProviderPlatform).toBe('ncm');
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('ncm', ['101']);
        expect(cloudSearchMock).not.toHaveBeenCalled();
        expect(fetchQQLyricsMock).not.toHaveBeenCalled();
    });

    it('tries AMLLDB for the NetEase id before falling back to QQ or Kugou', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]test' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: 'test',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false
        });
        fetchAmllDbLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { preferredSource: 'netease' }) as any;

        expect(result.source).toBe('amll');
        expect(result.matchedLyricsProviderPlatform).toBe('ncm');
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('ncm', ['101']);
        expect(searchQQLyricsMock).not.toHaveBeenCalled();
        expect(searchKugouLyricsMock).not.toHaveBeenCalled();
    });

    it('does not probe QQ AMLLDB after the automatic NCM AMLLDB probe misses', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]test' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: 'test',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false
        });
        searchQQLyricsMock.mockResolvedValue([
            { id: 201, name: 'Song Title', durationMs: 201000, artists: [{ id: 1, name: 'Artist Name' }], album: { id: 0, name: '' }, qqMid: 'mid123' }
        ]);
        fetchAmllDbLyricsMock.mockResolvedValue(null);
        fetchQQLyricsMock.mockResolvedValue(createLyrics(true));

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            preferredSource: 'amll'
        }) as any;

        expect(result.source).toBe('qq');
        expect(result.id).toBe(201);
        expect(result.qqMid).toBe('mid123');
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledTimes(1);
        expect(fetchAmllDbLyricsMock).toHaveBeenCalledWith('ncm', ['101']);
        expect(fetchAmllDbLyricsMock).not.toHaveBeenCalledWith('qq', expect.arrayContaining(['201']));
        expect(fetchQQLyricsMock).toHaveBeenCalledWith(expect.objectContaining({ id: 201 }), { chorusRanges: [] });
    });

    it('preserves AMLLDB TTML chorus markers instead of fetching NetEase chorus ranges', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        getLyricMock.mockResolvedValue({ lyric: '[00:00.00]test' });
        processNeteaseLyricsMock.mockResolvedValue({
            lyrics: createLyrics(false),
            mainLrc: 'test',
            yrcLrc: null,
            transLrc: '',
            isPureMusic: false
        });
        fetchAmllDbLyricsMock.mockResolvedValue({
            lines: [
                { fullText: 'Chorus', startTime: 10, endTime: 20, words: [], isChorus: true, chorusEffect: 'bars' }
            ],
            isWordByWord: true
        });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000) as any;

        expect(result.source).toBe('amll');
        expect(result.lyrics.lines[0].isChorus).toBe(true);
    });

    it('falls back to Kugou when QQ returns an empty word-by-word lyric object', async () => {
        cloudSearchMock.mockResolvedValue({ result: { songs: [] } });
        searchQQLyricsMock.mockResolvedValue([{
            id: 201,
            name: 'Song Title',
            durationMs: 200000,
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 0, name: '' },
            qqMid: 'empty-mid',
        }]);
        fetchQQLyricsMock.mockResolvedValue({ lines: [], isWordByWord: true });
        const kugouProvider = getOnlineMusicProvider('kugou')!;
        vi.spyOn(kugouProvider.search!, 'searchSongs').mockResolvedValue({
            items: [{
                id: 301,
                name: 'Song Title',
                durationMs: 199000,
                artists: [{ id: 1, name: 'Artist Name' }],
                album: { id: 0, name: '' },
                kgHash: 'hash123',
                sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'hash123' },
            }],
            hasMore: false,
            nextOffset: 1,
        });
        vi.spyOn(kugouProvider.lyrics!, 'getLyrics').mockResolvedValue({
            lyrics: createLyrics(true),
            isPureMusic: false,
        });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000) as any;
        expect(result).not.toBeNull();
        expect(result.source).toBe('kugou');
        expect(result.id).toBe(301);
        expect(result.kgHash).toBe('hash123');
        expect(fetchAmllDbLyricsMock).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['301']));
    });

    it('returns null if no sources match the duration filter', async () => {
        cloudSearchMock.mockResolvedValue({
            result: {
                songs: [
                    { id: 101, name: 'Song Title', dt: 205000, ar: [{ name: 'Artist Name' }] }
                ]
            }
        });
        searchQQLyricsMock.mockResolvedValue([]);
        searchKugouLyricsMock.mockResolvedValue([]);

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000);
        expect(result).toBeNull();
    });

    describe('with Spotify as a source', () => {
        const spotifySong = {
            id: 'track1', name: 'Song Title', durationMs: 200000,
            artists: [{ id: 'artist1', name: 'Artist Name' }], album: { id: 'album1', name: '' },
            sourceRef: { kind: 'online' as const, providerId: 'spotify', mediaId: 'track1' },
        };
        const qqSong = { id: 201, name: 'Song Title', durationMs: 200000, artists: [{ id: 1, name: 'Artist Name' }], album: { id: 0, name: '' }, qqMid: 'mid123' };
        const spotify = () => getOnlineMusicProvider('spotify')!;
        const spySpotify = () => ({
            search: vi.spyOn(spotify().search!, 'searchSongs').mockResolvedValue({ items: [spotifySong], hasMore: false, nextOffset: 1 }),
            lyrics: vi.spyOn(spotify().lyrics!, 'getLyrics').mockResolvedValue({ lyrics: createLyrics(false), isPureMusic: false }),
        });
        const signIn = () => useOnlineProviderAccountStore.getState().updateAccount('spotify', { user: { id: 'me', nickname: 'me' } });

        beforeEach(() => {
            useOnlineProviderAccountStore.setState({ accounts: {} });
            cloudSearchMock.mockResolvedValue({ result: { songs: [] } });
            searchQQLyricsMock.mockResolvedValue([]);
            searchKugouLyricsMock.mockResolvedValue([]);
        });

        it('is not asked while no Spotify account is signed in', async () => {
            const spies = spySpotify();

            expect(await autoMatchBestLyric('Song Title', 'Artist Name', 200000)).toBeNull();
            expect(spies.search).not.toHaveBeenCalled();
        });

        it('gives its lines when no other source has any', async () => {
            const spies = spySpotify();
            signIn();

            const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000);

            expect(result).toMatchObject({ source: 'spotify', id: 'track1' });
            expect(spies.search).toHaveBeenCalledTimes(1);
            expect(spies.lyrics).toHaveBeenCalledTimes(1);
        });

        it('is not asked once another source has given lines', async () => {
            const spies = spySpotify();
            signIn();
            searchQQLyricsMock.mockResolvedValue([qqSong]);
            fetchQQLyricsMock.mockResolvedValue(createLyrics(false));

            expect(await autoMatchBestLyric('Song Title', 'Artist Name', 200000)).toMatchObject({ source: 'qq' });
            expect(spies.search).not.toHaveBeenCalled();
        });

        it('counts as no preference while no Spotify account is signed in', async () => {
            cloudSearchMock.mockResolvedValue({ result: { songs: [{ id: 101, name: 'Song Title', dt: 200000, ar: [{ name: 'Artist Name' }] }] } });
            getLyricMock.mockResolvedValue({ lyric: '[00:00.00]line lyric' });
            processNeteaseLyricsMock.mockResolvedValue({ lyrics: createLyrics(false), mainLrc: 'line lyric', yrcLrc: null, transLrc: '', isPureMusic: false, chorusRanges: [] });
            searchQQLyricsMock.mockResolvedValue([qqSong]);
            fetchQQLyricsMock.mockResolvedValue(createLyrics(false));

            // The default first choice is QQ; with Spotify merely skipped NetEase would come first.
            expect(await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { preferredSource: 'spotify' })).toMatchObject({ source: 'qq' });
        });

        // The lyrics of a Spotify song are in hand already: no request.
        it('keeps a Spotify song\'s own lines over another source\'s lines when Spotify is preferred', async () => {
            const spies = spySpotify();
            signIn();
            const own = createLyrics(false);
            searchQQLyricsMock.mockResolvedValue([qqSong]);
            fetchQQLyricsMock.mockResolvedValue(createLyrics(false));
            const options = {
                preferredSource: 'spotify' as const,
                providerCandidate: { providerId: 'spotify' as const, song: spotifySong, lyricsResult: { lyrics: own, isPureMusic: false } },
            };

            const kept = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, options);
            fetchQQLyricsMock.mockResolvedValue(createLyrics(true));
            const upgraded = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, options);

            expect(kept).toMatchObject({ source: 'spotify', id: 'track1' });
            expect(upgraded).toMatchObject({ source: 'qq' });
            expect(spies.search).not.toHaveBeenCalled();
            expect(spies.lyrics).not.toHaveBeenCalled();
        });
    });

    describe('with another name for the artist', () => {
        const qqSong = (name: string, artist: string, durationMs: number) => (
            { id: 201, name, durationMs, artists: [{ id: 1, name: artist }], album: { id: 0, name: '' }, qqMid: 'mid123' }
        );
        beforeEach(() => {
            cloudSearchMock.mockResolvedValue({ result: { songs: [] } });
            searchQQLyricsMock.mockResolvedValue([]);
            searchKugouLyricsMock.mockResolvedValue([]);
        });

        it('searches once more under the other name when the given one finds nothing', async () => {
            // The source lists the act under its own name, not the one the song came with.
            searchQQLyricsMock.mockResolvedValue([qqSong('Wonderwall', 'Oasis', 259000)]);
            fetchQQLyricsMock.mockResolvedValue(createLyrics(true));
            const alternateArtist = vi.fn(async () => 'Oasis');

            const result = await autoMatchBestLyric('Wonderwall', '绿洲合唱团', 259000, { alternateArtist });
            expect(result).toMatchObject({ source: 'qq', id: 201 });
            expect(alternateArtist).toHaveBeenCalledTimes(1);
            expect(searchQQLyricsMock.mock.calls.map(call => call[0])).toEqual(['Wonderwall - 绿洲合唱团', 'Wonderwall - Oasis']);
        });

        it('does not ask for the other name when the given one finds the lyrics', async () => {
            searchQQLyricsMock.mockResolvedValue([qqSong('Song Title', 'Artist Name', 200000)]);
            fetchQQLyricsMock.mockResolvedValue(createLyrics(true));
            const alternateArtist = vi.fn(async () => 'Other Name');

            expect(await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { alternateArtist })).toMatchObject({ source: 'qq' });
            expect(alternateArtist).not.toHaveBeenCalled();
            expect(searchQQLyricsMock).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['there is none', async () => null],
            ['it is the same name', async () => 'Artist Name'],
            ['it cannot be read', async () => { throw new Error('offline'); }],
        ])('searches only once when %s', async (_case, alternateArtist) => {
            expect(await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { alternateArtist })).toBeNull();
            expect(searchQQLyricsMock).toHaveBeenCalledTimes(1);
        });
    });
});
