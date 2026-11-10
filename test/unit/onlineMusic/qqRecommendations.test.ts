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

    describe('personal FM', () => {
        // 批内去重；跨批的重复由续歌的地方按队列去掉（utils/fmQueue），这里不记跨批的状态。
        // 每批都要第 1 页：分不清这批是续歌还是首页电台卡的封面，不在这里记页码去推进。
        it('hands out a batch without repeats inside it, and keeps no memory across batches', async () => {
            requestMock
                .mockResolvedValueOnce({ code: 200, station: 'personal-fm', page: 1, songs: [song('a', 1), song('b', 2), song('a', 1)], more: true, nextPage: 2 })
                .mockResolvedValueOnce({ code: 200, station: 'personal-fm', page: 1, songs: [song('b', 2), song('c', 3)], more: true, nextPage: 2 });

            const first = await qqRecommendations.getPersonalFm!();
            const second = await qqRecommendations.getPersonalFm!();

            expect(first.map(item => item.qqMid)).toEqual(['a', 'b']);
            expect(second.map(item => item.qqMid)).toEqual(['b', 'c']);
            expect(requestMock.mock.calls).toEqual([
                ['user_personal_fm', { page: 1 }],
                ['user_personal_fm', { page: 1 }],
            ]);
        });

        it('asks nothing without a session', async () => {
            transportState.hasSession = false;
            await expect(qqRecommendations.getPersonalFm!()).resolves.toEqual([]);
            expect(requestMock).not.toHaveBeenCalled();
        });

        it('treats 422 (an empty batch) as no songs without asking again', async () => {
            requestMock.mockRejectedValueOnce(emptyAnswer());
            await expect(qqRecommendations.getPersonalFm!()).resolves.toEqual([]);
            expect(requestMock).toHaveBeenCalledTimes(1);
        });

        // 3.3.6 之前的后端没有私人 FM 路由（404）：照旧读猜你喜欢，FM 不因换了后端就断。
        it('falls back to guess-you-like on a backend without the personal FM route', async () => {
            requestMock
                .mockRejectedValueOnce(missingRoute())
                .mockResolvedValueOnce({ code: 200, songs: [song('d', 4)] });

            const songs = await qqRecommendations.getPersonalFm!();

            expect(songs.map(item => item.qqMid)).toEqual(['d']);
            expect(requestMock.mock.calls).toEqual([['user_personal_fm', { page: 1 }], ['user_guess_you_like']]);
        });

        // 与波点的 FM 一样：上游拒绝（22006）只是这次没有歌，不让首页电台整块失败。
        it('turns a failed batch into no songs', async () => {
            requestMock.mockRejectedValueOnce(upstreamFailure());
            await expect(qqRecommendations.getPersonalFm!()).resolves.toEqual([]);
            expect(console.warn).toHaveBeenCalledWith('[QQProvider] personal-fm:failed', expect.objectContaining({ name: 'OnlineProviderError' }));
        });
    });

    describe('daily songs history', () => {
        // 日期照后端给的顺序，可能不连续；不在这里按日历补日子。
        it('reads the dates the backend lists, in its order', async () => {
            requestMock.mockResolvedValueOnce({ code: 200, dates: ['2026-11-01', '2026-10-27', 20261020, ''] });

            await expect(qqRecommendations.getHistoryDates!()).resolves.toEqual(['2026-11-01', '2026-10-27']);
            expect(requestMock).toHaveBeenCalledWith('user_daily_history_dates');
        });

        it('reads the songs of a date, given as text or as an entry', async () => {
            requestMock
                .mockResolvedValueOnce({ code: 200, date: '2026-10-27', songs: [song('h-a', 201), song('h-b', 202)] })
                .mockResolvedValueOnce({ code: 200, date: '2026-11-01', songs: [song('h-c', 203)] });

            const byText = await qqRecommendations.getHistorySongs!('2026-10-27');
            const byEntry = await qqRecommendations.getHistorySongs!({ id: '2026-11-01', label: '2026-11-01' });

            expect(byText.map(item => [item.qqMid, item.id])).toEqual([['h-a', 201], ['h-b', 202]]);
            expect(byEntry.map(item => item.qqMid)).toEqual(['h-c']);
            expect(requestMock.mock.calls).toEqual([
                ['user_daily_history', { date: '2026-10-27' }],
                ['user_daily_history', { date: '2026-11-01' }],
            ]);
        });

        it('asks nothing without a session', async () => {
            transportState.hasSession = false;
            await expect(qqRecommendations.getHistoryDates!()).resolves.toEqual([]);
            await expect(qqRecommendations.getHistorySongs!('2026-10-27')).resolves.toEqual([]);
            expect(requestMock).not.toHaveBeenCalled();
        });

        // 422 是没有日期或这天没有歌；旧后端没有这两条路由回 404。都当空，不算失败。
        it('treats 422 and a backend without the routes as nothing to show', async () => {
            requestMock
                .mockRejectedValueOnce(emptyAnswer())
                .mockRejectedValueOnce(missingRoute())
                .mockRejectedValueOnce(emptyAnswer())
                .mockRejectedValueOnce(missingRoute());
            await expect(qqRecommendations.getHistoryDates!()).resolves.toEqual([]);
            await expect(qqRecommendations.getHistoryDates!()).resolves.toEqual([]);
            await expect(qqRecommendations.getHistorySongs!('2026-10-27')).resolves.toEqual([]);
            await expect(qqRecommendations.getHistorySongs!('2026-10-27')).resolves.toEqual([]);
        });

        it('surfaces a real failure', async () => {
            requestMock.mockRejectedValueOnce(upstreamFailure()).mockRejectedValueOnce(upstreamFailure());
            await expect(qqRecommendations.getHistoryDates!()).rejects.toMatchObject({ httpStatus: 502 });
            await expect(qqRecommendations.getHistorySongs!('2026-10-27')).rejects.toMatchObject({ httpStatus: 502 });
        });
    });

    // 手机上私人 FM、猜你喜欢、其他电台与每日 30 首的「不喜欢」都是把这首歌拉进黑名单，不带电台或歌单的上下文。
    describe('dislike a song', () => {
        const confirmed = { code: 200, accepted: true, verified: true, verification: 'confirmed', writeAttempted: true, coverage: 'first-page', complete: false, results: [] };

        it('puts the song on the blacklist once and hands back no replacement', async () => {
            vi.spyOn(console, 'info').mockImplementation(() => { });
            requestMock.mockResolvedValue(confirmed);

            await expect(qqRecommendations.dislikeSong!(101)).resolves.toEqual({ removed: true });
            await expect(qqRecommendations.dislikeSong!('102')).resolves.toEqual({ removed: true });
            expect(requestMock.mock.calls).toEqual([
                ['user_blacklist_add', {}, { songs: ['101'] }],
                ['user_blacklist_add', {}, { songs: ['102'] }],
            ]);
        });

        // 后端只认数字 songid；没有数字 id 的条目送去也只会被拒，干脆不送。
        it('sends nothing for a song without a numeric id', async () => {
            await expect(qqRecommendations.dislikeSong!('0039MnYb0qxYhV')).rejects.toMatchObject({ code: 'invalid-response' });
            expect(requestMock).not.toHaveBeenCalled();
        });

        // 上游收下了、只是首屏没读到：算成功（报失败只会让人再写一次），也不再送一次。
        it('counts an accepted write the first page did not show as done, without resending', async () => {
            vi.spyOn(console, 'info').mockImplementation(() => { });
            requestMock.mockResolvedValueOnce({ ...confirmed, verified: false, verification: 'unconfirmed' });
            await expect(qqRecommendations.dislikeSong!(101)).resolves.toEqual({ removed: true });
            expect(requestMock).toHaveBeenCalledTimes(1);
            expect(console.info).toHaveBeenCalledWith('[QQProvider] dislike:accepted', { verified: false });
        });

        // 写入收下了、核对的那一读失败（非 2xx 的错误体里带 writeAttempted 与 accepted）：同样算成功。
        it('counts an accepted write whose read-back failed as done', async () => {
            requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq', {
                writeAttempted: true, accepted: true, verified: false, verification: 'unconfirmed', retryable: false,
            }, 502));
            await expect(qqRecommendations.dislikeSong!(101)).resolves.toEqual({ removed: true });
            expect(requestMock).toHaveBeenCalledTimes(1);
        });

        // 上游没有收下（回包里既没核对也没收下，或写了但没被接受）：报失败，不再送一次。
        it('fails without resending when the write was not accepted', async () => {
            requestMock.mockResolvedValueOnce({ code: 200, verified: false });
            await expect(qqRecommendations.dislikeSong!(101)).rejects.toMatchObject({ code: 'invalid-response' });
            requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq', {
                writeAttempted: true, accepted: false, verified: false,
            }, 502));
            await expect(qqRecommendations.dislikeSong!(102)).rejects.toMatchObject({ httpStatus: 502 });
            expect(requestMock).toHaveBeenCalledTimes(2);
            expect(console.warn).toHaveBeenCalledWith('[QQProvider] dislike:failed', expect.objectContaining({ name: 'OnlineProviderError' }));
        });

        it('passes a backend failure on without resending', async () => {
            requestMock.mockRejectedValueOnce(upstreamFailure());
            await expect(qqRecommendations.dislikeSong!(101)).rejects.toMatchObject({ httpStatus: 502 });
            expect(requestMock).toHaveBeenCalledTimes(1);
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
            expect(requestMock.mock.calls.filter(call => call[0] === 'recommend_playlists').map(call => call[1])).toEqual([{ limit: 60 }, { limit: 1 }]);
        });

        // 首页三块推荐一起取：推荐歌单失败不该把 FM 与日推一起拖下去。
        it('degrades to no playlists when the request fails', async () => {
            const failures = [upstreamFailure(), emptyAnswer()];
            requestMock.mockImplementation(async (operation: string) => {
                if (operation === 'recommend_playlists') throw failures.shift();
                return { code: 200, primaryModes: [], scenes: [] };
            });
            // Only the station card of Guess You Like is left, which comes from elsewhere.
            const playlistsOf = (collections: { personalFm?: unknown }[]) => collections.filter(collection => !collection.personalFm);
            expect(playlistsOf(await qqRecommendations.getRecommendedCollections!(10))).toEqual([]);
            expect(playlistsOf(await qqRecommendations.getRecommendedCollections!(10))).toEqual([]);
            expect(console.warn).toHaveBeenCalledTimes(1);
        });
    });
});
