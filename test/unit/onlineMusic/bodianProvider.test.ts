import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/bodianProvider.test.ts

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/bodianTransport', () => ({
    requestBodian: request, getBodianTransportAvailability: () => ({ configured: true }),
}));
import { bodianProvider } from '@/services/onlineMusic/bodianProvider';
import { bodianPage, normalizeBodianCollection, normalizeBodianSong, normalizeBodianUser } from '@/services/onlineMusic/bodianNormalize';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

const track = { id: 228908, songName: '测试歌曲 (Live)', name: '测试歌曲', albumId: 1293, album: '测试专辑',
    albumPic: 'https://img4.kuwo.cn/cover.jpg', artist: '测试歌手', artistId: 336,
    artists: [{ id: 336, name: '测试歌手' }], duration: 269 };

beforeEach(() => request.mockReset());

describe('Bodian provider', () => {
    it.each([
        ['http://img1.kuwo.cn/cover.jpg', 'https://img1.kuwo.cn/cover.jpg'],
        ['http://img4.kuwo.cn/cover.jpg', 'https://img4.kuwo.cn/cover.jpg'],
        ['http://img1.kwcdn.kuwo.cn/cover.jpg', 'http://img1.kwcdn.kuwo.cn/cover.jpg'],
    ])('keeps a usable TLS scheme for covers and avatars: %s', (input, expected) => {
        expect(normalizeBodianSong({ ...track, albumPic: input }).album.coverUrl).toBe(expected);
        expect(normalizeBodianCollection({ id: '1', pic: input }).coverUrl).toBe(expected);
        expect(normalizeBodianUser({ id: '1', avatarUrl: input }).avatarUrl).toBe(expected);
    });

    it('isolates an FM failure from Discover and ordinary recommendations', async () => {
        request.mockImplementation(async (operation: string) => {
            if (operation === 'personal_fm') throw new Error('FM unavailable');
            if (operation === 'home_module') return { songList: [{ id: 0 }] };
            if (operation === 'ai_playlist_detail') return { title: '潮趣日推', musicList: [track] };
            return { lists: [{ playLists: [{ id: 123, name: '普通推荐' }] }] };
        });
        const [fm, collections] = await Promise.all([
            bodianProvider.recommendations!.getPersonalFm!(),
            bodianProvider.recommendations!.getRecommendedCollections!(10),
        ]);
        expect(fm).toEqual([]);
        expect(collections.map(item => item.id)).toEqual(['discover-0', '123']);
    });

    it('uses the source media ID for lyrics even when the display ID differs', async () => {
        request.mockResolvedValue({ mainText: '[00:01.00]歌词', wordByWordText: null });
        await bodianProvider.lyrics!.getLyrics!({ ...normalizeBodianSong(track), id: 'display-id' });
        expect(request).toHaveBeenCalledWith('lyrics', { id: '228908' });
    });
    it('normalizes stable identity, duration and navigable catalog references idempotently', () => {
        const song = normalizeBodianSong(track);
        expect(song).toMatchObject({ id: '228908', durationMs: 269000, name: '测试歌曲 (Live)',
            album: { catalogRef: { providerId: 'bodian', kind: 'album', id: '1293' } } });
        expect(normalizeBodianSong(song)).toEqual(song);
        expect(getPlaybackSongKey(song)).toBe('online:bodian:228908');
        expect(() => normalizeBodianSong({})).toThrow('no id');
    });

    it('preserves private/liked playlist source and counts on cache hydration', () => {
        const collection = normalizeBodianCollection({ id: 123, name: '测试歌单', musicCount: 121, sourceType: 5, isPrivate: 1, isLiked: true });
        expect(collection).toMatchObject({ providerId: 'bodian', trackCount: 121, providerData: { source: 5, isPrivate: 1 } });
        expect(collection.isLiked).toBe(true);
        expect(normalizeBodianCollection(collection)).toEqual(collection);
        expect(normalizeBodianCollection({ id: 123, name: 'Owned', isOwned: true }).providerData?.source).toBe(5);
        expect(normalizeBodianCollection({ id: 123, name: 'Public' }).providerData?.source).toBe(4);
    });

    it('loads complete Discover collections before ordinary recommendations', async () => {
        request.mockImplementation(async (operation: string, params: Record<string, unknown> = {}) => {
            if (operation === 'home_module') return { songList: [{ id: 0, title: '潮趣日推' }, { id: 1, title: '新歌大赏' }] };
            if (operation === 'ai_playlist_detail') return {
                title: Number(params.index) === 0 ? '潮趣日推' : '新歌大赏',
                subTitle: '「为你量身打造的专属歌单」',
                musicList: [track, { ...track, id: Number(params.index) + 1000, songName: 'Discover 歌曲' }],
            };
            if (operation === 'recommendations') return { lists: [{ playLists: [
                { id: 123, name: '普通推荐', musicCount: 8 }, { id: 124, name: '另一推荐', musicCount: 6 },
            ] }] };
            return {};
        });
        const collections = await bodianProvider.recommendations!.getRecommendedCollections!(10);
        expect(collections).toHaveLength(4);
        expect(collections.slice(0, 2)).toMatchObject([
            { id: 'discover-0', name: '潮趣日推', trackCount: 2, providerData: { discoverIndex: 0 } },
            { id: 'discover-1', name: '新歌大赏', trackCount: 2, providerData: { discoverIndex: 1 } },
        ]);
        expect(collections.slice(2)).toMatchObject([
            { id: '123', name: '普通推荐', type: 'playlist' },
            { id: '124', name: '另一推荐', type: 'playlist' },
        ]);
    });

    it('keeps ordinary recommendations when Discover loading fails', async () => {
        request.mockImplementation(async (operation: string) => {
            if (operation === 'home_module') throw new Error('Discover unavailable');
            if (operation === 'recommendations') return { lists: [{ playLists: [{ id: 123, name: '普通推荐' }] }] };
            return {};
        });
        await expect(bodianProvider.recommendations!.getRecommendedCollections!(10)).resolves.toMatchObject([
            { id: '123', name: '普通推荐' },
        ]);
    });

    it('ignores bogus paging flags and terminates empty pages even if total is stale', async () => {
        request.mockResolvedValue({ list: [track], total: 121, hasNextPage: false, nextPage: 0 });
        const page = await bodianProvider.catalog!.getPlaylistTracks!('123', 1, 0, normalizeBodianCollection({ id: 123, name: '喜欢', sourceType: 5 }));
        expect(request).toHaveBeenCalledWith('playlist_tracks', expect.objectContaining({ source: 5 }));
        expect(page).toMatchObject({ hasMore: true, nextOffset: 1 });
        expect(bodianPage([], 121, 50, 50)).toMatchObject({ hasMore: false, nextOffset: 50 });
    });

    it('uses the main-process cursor when unavailable songs were omitted from a server page', async () => {
        request.mockResolvedValueOnce({ list: Array.from({ length: 99 }, () => track), total: 121,
            bodianPagination: { nextOffset: 100, hasMore: true } });
        const page = await bodianProvider.catalog!.getPlaylistTracks!('123', 100, 0);
        expect(page.items).toHaveLength(99);
        expect(page).toMatchObject({ nextOffset: 100, hasMore: true });
    });

    it('loads complete Discover tracks through the dedicated detail operation', async () => {
        request.mockResolvedValue({ musicList: [track, { ...track, id: 229000, songName: '第二首' }] });
        const collection = { providerId: 'bodian' as const, id: 'discover-0', type: 'playlist' as const,
            name: '潮趣日推', trackCount: 2, providerData: { discoverIndex: 0 } };
        const page = await bodianProvider.catalog!.getPlaylistTracks!('discover-0', 50, 0, collection);
        expect(request).toHaveBeenCalledWith('ai_playlist_detail', { index: 0 });
        expect(page.items).toHaveLength(2);
        expect(page.items[0].sourceRef).toMatchObject({ providerId: 'bodian', mediaId: '228908' });
        await expect(bodianProvider.catalog!.getPlaylistDetail!('discover-0', collection)).resolves.toEqual(collection);
    });

    it('preserves search pagination and rejects malformed results', async () => {
        request.mockResolvedValueOnce({ resultList: [track], total: 51 });
        const result = await bodianProvider.search!.searchSongs('测试', 50, 50);
        expect(result).toMatchObject({ nextOffset: 51, hasMore: false });
        request.mockResolvedValueOnce({});
        await expect(bodianProvider.search!.searchSongs('测试', 50, 0)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('never stores a preview as full-track audio or routes another provider through Bodian', async () => {
        request.mockResolvedValue({ url: 'https://audio.example.test/preview.mp3', preview: { startTime: 0, endTime: 29 } });
        await expect(bodianProvider.playback!.getAudioSource(normalizeBodianSong(track), 'high')).rejects.toMatchObject({ code: 'preview-only' });
        await expect(bodianProvider.playback!.getAudioSource({ ...normalizeBodianSong(track), sourceRef: { kind: 'online', providerId: 'qq', mediaId: '228908' } }, 'high'))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['offline', { offline: true }, { state: 'unavailable', reason: 'taken-down' }],
        ['online 0', { online: 0 }, { state: 'unavailable', reason: 'taken-down' }],
        ['offline and cannotOnlinePlay', { offline: true, payInfo: { cannotOnlinePlay: 1 } }, { state: 'unavailable', reason: 'taken-down' }],
        ['cannotOnlinePlay only', { payInfo: { cannotOnlinePlay: 1 } }, { state: 'unknown', reason: 'restricted' }],
        ['membership fields only', { isListenFee: true, feeType: { vip: 1, song: 1 }, payInfo: { cannotOnlinePlay: 0, feeType: { vip: 1 } } }, { state: 'unknown' }],
        ['no availability signal', {}, { state: 'unknown' }],
    ])('derives static availability for %s without reading membership tags', (_label, fields, expected) => {
        const song = normalizeBodianSong({ ...track, ...fields });
        expect(bodianProvider.playback!.getAvailability!(song)).toEqual(expected);
        // 新数据不再写布尔 unavailable；会员与付费标签也不进 providerData。
        const providerData = song.sourceRef?.kind === 'online' ? song.sourceRef.providerData : undefined;
        expect(providerData).not.toHaveProperty('unavailable');
        expect(providerData).not.toHaveProperty('isListenFee');
        expect(providerData).not.toHaveProperty('feeType');
    });

    it('treats a cached legacy boolean unavailable flag as unknown', () => {
        const song = normalizeBodianSong(track);
        const cached = normalizeBodianSong({ ...song, sourceRef: { ...song.sourceRef, providerData: { unavailable: true } } });
        expect(bodianProvider.playback!.getAvailability!(cached)).toEqual({ state: 'unknown' });
    });
});
