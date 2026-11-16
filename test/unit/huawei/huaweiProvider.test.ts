import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { huaweiProvider, resetHuaweiRecommendationCache } from '@/services/onlineMusic/huawei/huaweiProvider';
import { normalizeHuaweiCollection, normalizeHuaweiSong } from '@/services/onlineMusic/huawei/huaweiNormalize';

// test/unit/huawei/huaweiProvider.test.ts
// 归一化、搜索分页、播放地址与歌词的逻辑测试：华为接口的答复用替身，不碰真实服务，
// 也不碰账号（播放与逐曲歌词在真实账号里才验证）。

const bridgeRequest = vi.fn();

const SAMPLE_ROW = {
    contentID: '1092974',
    contentName: '晴天',
    artistName: '周杰伦',
    artistID: ['6478'],
    albumID: '101447',
    albumName: '叶惠美',
    duration: null,
    lyricAddress: 'https://lyric.tingmall.com/lyric/01/092/1092974-LRC-LRC.lrc?t=1700102194000',
    picture: {
        bigImgURL: 'https://contentcenter-drcn.dbankcdn.cn/picture.webp',
        middleImgURL: 'https://contentcenter-drcn.dbankcdn.cn/picture-500.webp',
        smallImgURL: 'https://contentcenter-drcn.dbankcdn.cn/picture-300.webp',
    },
    contentExInfo: JSON.stringify({
        albumCode: '101447',
        albumName: '叶惠美',
        artistCodes: ['6478'],
        artistNames: '周杰伦',
        completeFileInfos: {
            1: { duration: '269', quality: '1' },
        },
    }),
};

beforeEach(() => {
    resetHuaweiRecommendationCache();
    bridgeRequest.mockReset().mockResolvedValue({ ok: true, data: null });
    vi.stubGlobal('window', { electron: { huaweiRequest: bridgeRequest } });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('normalizeHuaweiSong', () => {
    it('reads the search row fields, the album and artist refs, and keeps the lyric address', () => {
        const song = normalizeHuaweiSong(SAMPLE_ROW);
        expect(song.id).toBe('1092974');
        expect(song.name).toBe('晴天');
        expect(song.artists).toEqual([
            { id: '6478', name: '周杰伦', catalogRef: { providerId: 'huawei', kind: 'artist', id: '6478' } },
        ]);
        expect(song.album).toEqual({
            id: '101447',
            name: '叶惠美',
            coverUrl: 'https://contentcenter-drcn.dbankcdn.cn/picture.webp',
            catalogRef: { providerId: 'huawei', kind: 'album', id: '101447' },
        });
        expect(song.durationMs).toBe(269000);
        expect(song.sourceRef).toEqual({
            kind: 'online',
            providerId: 'huawei',
            mediaId: '1092974',
            providerData: { lyricUrl: SAMPLE_ROW.lyricAddress },
        });
    });

    it('keeps a multi-artist display name whole when the row has no pairs, and returns an empty cover', () => {
        const song = normalizeHuaweiSong({ contentID: '1', contentName: 'Song', artistName: 'A & B', albumName: 'Album' });
        expect(song.artists).toEqual([{ id: '', name: 'A & B', catalogRef: undefined }]);
        expect(song.album.coverUrl).toBe('');
        expect(song.durationMs).toBe(0);
    });

    it('rejects a row without an id or a name', () => {
        expect(() => normalizeHuaweiSong({ contentName: 'No id' })).toThrow(/no id or name/);
    });
});

describe('normalizeHuaweiCollection', () => {
    it('normalizes an album detail answer from the bridge', () => {
        const collection = normalizeHuaweiCollection({ id: '101447', name: '叶惠美', coverUrl: 'https://cdn/cover.webp' }, 'album');
        expect(collection).toEqual({
            providerId: 'huawei',
            id: '101447',
            type: 'album',
            name: '叶惠美',
            coverUrl: 'https://cdn/cover.webp',
        });
    });

    it('normalizes an artist answer and reads its picture', () => {
        const collection = normalizeHuaweiCollection({
            id: '6478',
            name: '周杰伦',
            picture: { bigImgURL: 'https://cdn/artist.webp' },
        }, 'artist');
        expect(collection.type).toBe('artist');
        expect(collection.coverUrl).toBe('https://cdn/artist.webp');
    });
});

describe('huaweiProvider search and playback', () => {
    it('pages a search and marks each row as a Huawei song', async () => {
        bridgeRequest.mockResolvedValue({
            ok: true,
            data: { items: [SAMPLE_ROW], total: 200, hasMore: true, nextOffset: 1 },
        });
        const page = await huaweiProvider.search!.searchSongs('晴天', 1, 0);
        expect(bridgeRequest).toHaveBeenCalledWith('search', { query: '晴天', limit: 1, offset: 0, kind: 'song' });
        expect(page.total).toBe(200);
        expect(page.hasMore).toBe(true);
        expect(page.nextOffset).toBe(1);
        expect(page.items[0].sourceRef.kind).toBe('online');
        if (page.items[0].sourceRef.kind === 'online') expect(page.items[0].sourceRef.providerId).toBe('huawei');
    });

    it('searches albums and public playlists as collections that their pages open', async () => {
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { items: [
                { contentID: '35239276', contentName: '太阳之子', artistName: '周杰伦', totalCount: '13', picture: { bigImgURL: 'https://cdn/album.webp' } },
            ], total: 1, hasMore: false, nextOffset: 1 },
        });
        const album = await huaweiProvider.search!.searchAlbums!('周杰伦', 1, 0);
        expect(bridgeRequest).toHaveBeenCalledWith('search', { query: '周杰伦', limit: 1, offset: 0, kind: 'album' });
        expect(album.items[0]).toMatchObject({ providerId: 'huawei', type: 'album', id: '35239276', name: '太阳之子', trackCount: 13 });

        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { items: [
                { contentID: '112927', contentName: '周杰伦精选', totalCount: '89', description: '精选' },
            ], total: 1, hasMore: false, nextOffset: 1 },
        });
        const playlist = await huaweiProvider.search!.searchPlaylists!('周杰伦', 1, 0);
        expect(bridgeRequest).toHaveBeenCalledWith('search', { query: '周杰伦', limit: 1, offset: 0, kind: 'playlist' });
        expect(playlist.items[0]).toMatchObject({ type: 'playlist', id: '112927', name: '周杰伦精选' });
        expect(playlist.items[0].providerData).toEqual({ kind: 'collected' });
    });

    it('asks for the platform audio URL and keeps the preview flag', async () => {
        bridgeRequest.mockResolvedValue({
            ok: true,
            data: {
                url: 'https://audio-drcn.dbankcdn.cn/preview/song.mp3',
                quality: 'high',
                preview: true,
                fetchedAt: 1234,
            },
        });
        const song = normalizeHuaweiSong(SAMPLE_ROW);
        const source = await huaweiProvider.playback!.getAudioSource(song, 'lossless');
        expect(bridgeRequest).toHaveBeenCalledWith('audio', { id: '1092974', quality: 'lossless' });
        expect(source).toMatchObject({
            url: 'https://audio-drcn.dbankcdn.cn/preview/song.mp3',
            quality: 'high',
            preview: true,
            fetchedAt: 1234,
        });
    });

    it('parses the line-timed lyric document the bridge fetched', async () => {
        bridgeRequest.mockResolvedValue({
            ok: true,
            data: { lrc: '[ti:晴天]\n[ar:周杰伦]\n[00:00.00]晴天\n[00:02.25]词：周杰伦\n' },
        });
        const result = await huaweiProvider.lyrics!.getLyrics(normalizeHuaweiSong(SAMPLE_ROW));
        expect(bridgeRequest).toHaveBeenCalledWith('lyrics', {
            id: '1092974',
            lyricUrl: SAMPLE_ROW.lyricAddress,
        });
        expect(result.lyrics?.lines.length).toBe(2);
        expect(result.isPureMusic).toBe(false);
    });
});

describe('huaweiProvider recommendations', () => {
    it('returns the personalized row and the editorial row, without the daily list card', async () => {
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: {
                dailyId: 'a001',
                items: [
                    { id: 'MhMA_PqZSAMxkeZUM', name: '粤语对唱', kind: 'collected', trackCount: 28, description: '为你挑选' },
                    { id: 'a001', name: '每日30首', kind: 'collected', daily: true, trackCount: 30 },
                    { id: '15812', name: '通勤隧道', kind: 'collected', trackCount: 40 },
                ],
            },
        });
        const items = await huaweiProvider.recommendations!.getRecommendedCollections!(2);
        expect(bridgeRequest).toHaveBeenCalledWith('recommendations', {});
        expect(items.map(item => item.id)).toEqual(['MhMA_PqZSAMxkeZUM', '15812']);
        expect(items[0]).toMatchObject({
            providerId: 'huawei', type: 'playlist', name: '粤语对唱', trackCount: 28, description: '为你挑选',
        });
        expect(items[0].providerData).toEqual({ kind: 'collected' });
    });

    it('reads the platform daily 30 list as the daily songs, once per day', async () => {
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { dailyId: 'a001', items: [{ id: 'a001', name: '每日30首', kind: 'collected', daily: true }] },
        });
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [SAMPLE_ROW] } });
        const songs = await huaweiProvider.recommendations!.getDailySongs!();
        expect(bridgeRequest).toHaveBeenLastCalledWith('playlist_tracks', {
            id: 'a001', kind: 'collected', limit: 50, offset: 0,
        });
        expect(songs.map(song => song.name)).toEqual(['晴天']);
        // The second read on the same day answers from the kept list.
        await huaweiProvider.recommendations!.getDailySongs!();
        expect(bridgeRequest).toHaveBeenCalledTimes(2);
    });

    it('walks the similar-song radio from the liked playlist and moves the seed to the last track', async () => {
        const nextRow = { ...SAMPLE_ROW, contentID: '1188214', contentName: '一路向北', albumID: '109457', albumName: 'J III MP3 Player' };
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { items: [{ id: 'u.liked', name: '我喜欢的音乐', kind: 'owned', trackCount: 174 }] },
        });
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [SAMPLE_ROW] } });
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [SAMPLE_ROW, nextRow] } });
        const songs = await huaweiProvider.recommendations!.getPersonalFm!();
        expect(bridgeRequest).toHaveBeenNthCalledWith(2, 'playlist_tracks', {
            id: 'u.liked', kind: 'owned', limit: 1, offset: 0,
        });
        expect(bridgeRequest).toHaveBeenCalledWith('similar_songs', { id: '1092974' });
        expect(songs.map(song => song.name)).toEqual(['一路向北']);
        expect(songs[0].sourceRef.kind).toBe('online');
        if (songs[0].sourceRef.kind === 'online') expect(songs[0].sourceRef.providerId).toBe('huawei');
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [nextRow, SAMPLE_ROW] } });
        const next = await huaweiProvider.recommendations!.getPersonalFm!();
        expect(bridgeRequest).toHaveBeenCalledWith('similar_songs', { id: '1188214' });
        expect(next.map(song => song.name)).toEqual(['晴天']);
    });

    it('falls back to the daily list when the account has no readable playlist', async () => {
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [] } });
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { dailyId: 'a001', items: [{ id: 'a001', name: '每日30首', kind: 'collected', daily: true }] },
        });
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [SAMPLE_ROW] } });
        bridgeRequest.mockResolvedValueOnce({ ok: true, data: { items: [SAMPLE_ROW] } });
        const songs = await huaweiProvider.recommendations!.getPersonalFm!();
        expect(bridgeRequest).toHaveBeenCalledWith('similar_songs', { id: '1092974' });
        expect(songs).toEqual([]);
    });
});

describe('huaweiProvider library', () => {
    it('lists the account favorite albums as collections', async () => {
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { items: [
                { id: '101447', name: '叶惠美', coverUrl: 'https://cdn/album.webp', trackCount: 11, artistName: '周杰伦' },
            ], hasMore: false, nextOffset: 1 },
        });
        const page = await huaweiProvider.library!.getUserAlbums!('sns-user-1', 1, 0);
        expect(bridgeRequest).toHaveBeenCalledWith('library_albums', { limit: 1, offset: 0 });
        expect(page.items[0]).toMatchObject({
            providerId: 'huawei', type: 'album', id: '101447', name: '叶惠美', trackCount: 11,
            artists: [{ id: '', name: '周杰伦' }],
        });
    });

    it('lists the account playlists and opens a playlist through the kind kept on the collection', async () => {
        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { items: [
                { id: 'u.liked', name: '我喜欢的音乐', kind: 'owned', trackCount: 174 },
                { id: 'LV.collected', name: '古风', kind: 'collected', trackCount: 20 },
            ] },
        });
        const page = await huaweiProvider.library!.getUserPlaylists('sns-user-1', 2, 0);
        expect(page.items.map(item => item.name)).toEqual(['我喜欢的音乐', '古风']);
        expect(page.items[0]).toMatchObject({ providerId: 'huawei', type: 'playlist', trackCount: 174, isOwned: true });
        expect(page.items[0].providerData).toEqual({ kind: 'owned' });
        expect(page.hasMore).toBe(false);

        bridgeRequest.mockResolvedValueOnce({
            ok: true,
            data: { items: [SAMPLE_ROW], total: 174, hasMore: true, nextOffset: 1 },
        });
        const tracks = await huaweiProvider.catalog!.getPlaylistTracks!(page.items[0].id, 1, 0, page.items[0]);
        expect(bridgeRequest).toHaveBeenCalledWith('playlist_tracks', {
            id: 'u.liked', kind: 'owned', limit: 1, offset: 0,
        });
        expect(tracks.items[0].name).toBe('晴天');
        expect(tracks.hasMore).toBe(true);
    });
});

describe('huaweiProvider account and availability', () => {
    it('reads the signed-in Huawei account from the bridge', async () => {
        bridgeRequest.mockResolvedValue({ ok: true, data: { id: 'sns-user-1', nickname: '华为音乐账号' } });
        await expect(huaweiProvider.auth!.getLoginStatus!()).resolves.toEqual({
            id: 'sns-user-1',
            nickname: '华为音乐账号',
        });
    });

    it('is configured on desktop when the main-process bridge exists', () => {
        expect(huaweiProvider.getAvailability!()).toEqual({ configured: true });
    });

    it('is unavailable on web without the Electron bridge', () => {
        vi.stubGlobal('window', {});
        expect(huaweiProvider.getAvailability!()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });
});
