import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqRecommendations.test.ts
// 推荐路由的响应形状取自 qq-music-api 3.3.0 的使用文档（docs/README.md「猜你喜欢、电台与推荐歌单」）；数字与名字是虚构示例。

const requestMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('@/services/onlineMusic/qq/qqTransport', () => ({
    hasQqSession: () => transportState.hasSession,
    hasUsableQqSession: () => transportState.hasSession,
    requestQq: requestMock,
}));

import { qqRecommendations } from '@/services/onlineMusic/qq/qqRecommendations';
import { OnlineProviderError } from '@/types/onlineMusic';

const song = (mid: string, id: number) => ({
    mid,
    id,
    name: `歌 ${mid}`,
    singer: [{ mid: 'singer-mid', name: '歌手' }],
    album: { mid: 'album-mid', name: '专辑' },
    file: { media_mid: `${mid}-media` },
    interval: 200,
});

const emptyAnswer = () => new OnlineProviderError('network', 'QQMusicApi user_daily_songs failed: HTTP 422', 'qq', { errorKey: 'resource.not-found' }, 422);
const missingRoute = () => new OnlineProviderError('unsupported', 'QQMusicApi has no user_daily_songs route', 'qq', undefined, 404);
const upstreamFailure = () => new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', { errorKey: 'recommendation.rejected' }, 502);

describe('QQ recommendations', () => {
    beforeEach(() => {
        requestMock.mockReset();
        transportState.hasSession = true;
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('daily songs', () => {
        it('reads today\'s songs onto songmid identity', async () => {
            requestMock.mockResolvedValueOnce({ code: 200, songs: [song('mid-a', 101), song('mid-b', 102)] });

            const songs = await qqRecommendations.getDailySongs!();

            expect(requestMock).toHaveBeenCalledWith('user_daily_songs');
            expect(songs.map(item => [item.qqMid, item.id])).toEqual([['mid-a', 101], ['mid-b', 102]]);
        });

        // 这几条都要登录：没有会话就不发请求，一个 401 只会把空会话再清一遍。
        it('asks nothing without a session', async () => {
            transportState.hasSession = false;
            await expect(qqRecommendations.getDailySongs!()).resolves.toEqual([]);
            expect(requestMock).not.toHaveBeenCalled();
        });

        it('treats 422 (no data) and a backend without the route as an empty day', async () => {
            requestMock.mockRejectedValueOnce(emptyAnswer()).mockRejectedValueOnce(missingRoute());
            await expect(qqRecommendations.getDailySongs!()).resolves.toEqual([]);
            await expect(qqRecommendations.getDailySongs!()).resolves.toEqual([]);
        });

        it('surfaces a real failure so the daily view can say so', async () => {
            requestMock.mockRejectedValueOnce(upstreamFailure());
            await expect(qqRecommendations.getDailySongs!()).rejects.toMatchObject({ httpStatus: 502 });
        });
    });

    describe('personal FM (guess you like)', () => {
        // 批内去重；跨批的重复由续歌的地方按队列去掉（utils/fmQueue），这里不记跨批的状态。
        it('hands out a batch without repeats inside it, and keeps no memory across batches', async () => {
            requestMock
                .mockResolvedValueOnce({ code: 200, songs: [song('a', 1), song('b', 2), song('a', 1)] })
                .mockResolvedValueOnce({ code: 200, songs: [song('b', 2), song('c', 3)] });

            const first = await qqRecommendations.getPersonalFm!();
            const second = await qqRecommendations.getPersonalFm!();

            expect(first.map(item => item.qqMid)).toEqual(['a', 'b']);
            expect(second.map(item => item.qqMid)).toEqual(['b', 'c']);
            expect(requestMock).toHaveBeenCalledWith('user_guess_you_like');
        });

        // 与波点的 FM 一样：上游拒绝（22006）只是这次没有歌，不让首页电台整块失败。
        it('turns a failed batch into no songs', async () => {
            requestMock.mockRejectedValueOnce(upstreamFailure());
            await expect(qqRecommendations.getPersonalFm!()).resolves.toEqual([]);
            expect(console.warn).toHaveBeenCalledWith('[QQProvider] personal-fm:failed', expect.objectContaining({ name: 'OnlineProviderError' }));
        });
    });

    describe('recommended playlists', () => {
        const PLAYLIST = {
            tid: 90001,
            title: '示例歌单',
            desc: '示例简介',
            picurl: 'https://img.example.test/cover.jpg',
            songnum: 30,
            play_cnt: 4321,
            creator: { uin: 'demo-creator', encrypt_uin: 'demo-encrypted-id', nick: '示例创建者' },
        };

        it('reads the playlists with their description, play count and creator, anonymously when signed out', async () => {
            transportState.hasSession = false;
            requestMock.mockResolvedValueOnce({ code: 200, playlists: [PLAYLIST, { tid: 0, title: '' }], more: true });

            const collections = await qqRecommendations.getRecommendedCollections!(35);

            expect(requestMock).toHaveBeenCalledWith('recommend_playlists', { limit: 35 });
            expect(collections).toEqual([{
                providerId: 'qq',
                id: 90001,
                name: '示例歌单',
                type: 'playlist',
                coverUrl: 'https://img.example.test/cover.jpg',
                description: '示例简介',
                trackCount: 30,
                playCount: 4321,
                creator: { id: 'demo-encrypted-id', nickname: '示例创建者' },
                providerData: { tid: 90001 },
            }]);
        });

        it('clamps the page size to what the backend accepts', async () => {
            requestMock.mockResolvedValue({ code: 200, playlists: [] });
            await qqRecommendations.getRecommendedCollections!(500);
            await qqRecommendations.getRecommendedCollections!(0);
            expect(requestMock.mock.calls.map(call => call[1])).toEqual([{ limit: 60 }, { limit: 1 }]);
        });

        // 首页三块推荐一起取：推荐歌单失败不该把 FM 与日推一起拖下去。
        it('degrades to no playlists when the request fails', async () => {
            requestMock.mockRejectedValueOnce(upstreamFailure()).mockRejectedValueOnce(emptyAnswer());
            await expect(qqRecommendations.getRecommendedCollections!(10)).resolves.toEqual([]);
            await expect(qqRecommendations.getRecommendedCollections!(10)).resolves.toEqual([]);
            expect(console.warn).toHaveBeenCalledTimes(1);
        });
    });
});
