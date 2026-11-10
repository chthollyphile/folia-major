import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqSearch.test.ts

const requestMock = vi.hoisted(() => vi.fn());
const searchQQSongsMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('@/services/onlineMusic/qq/qqTransport', () => ({
    hasQqSession: () => transportState.hasSession,
    hasUsableQqSession: () => transportState.hasSession,
    requestQq: requestMock,
}));

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({
    searchQQSongs: searchQQSongsMock,
}));

import { resetQqSearchFallbackMemory, searchQqCollections, searchQqSongs } from '@/services/onlineMusic/qq/qqSearch';
import { OnlineProviderError } from '@/types/onlineMusic';

// 后端 `/search` 原样交出的精简版搜索条目（字段按 qq-music-api 3.3.1 文档，标识符取公开曲目）。
const LITE_ITEM = {
    id: 5105918,
    mid: '003rJSwm3TechU',
    title: '海阔天空',
    interval: 326,
    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: 'Beyond' }],
    album: { id: 8112, mid: '0016l2F430zMux', name: '乐与怒' },
    file: { media_mid: '003rJSwm3TechU' },
};

// 匿名路径经歌词模块转换后的形状：只剩数字 id 与 songmid。
const ANONYMOUS_RESULT = {
    id: 5105918,
    name: '海阔天空',
    artists: [{ id: 4558, name: 'Beyond' }],
    album: { id: 8112, name: '乐与怒' },
    durationMs: 326_000,
    qqMid: '003rJSwm3TechU',
};

const rejected = () => new OnlineProviderError(
    'network',
    'QQMusicApi search failed: HTTP 502 (search.rejected upstream 2001: Upstream request failed)',
    'qq',
    { code: 502, errorKey: 'search.rejected', upstreamCode: 2001 },
    502,
);

describe('searchQqSongs', () => {
    beforeEach(() => {
        requestMock.mockReset();
        searchQQSongsMock.mockReset();
        transportState.hasSession = true;
        // 回退过匿名的关键词记在模块里；不清的话前一条用例的回退会把后一条的后续页送去匿名。
        resetQqSearchFallbackMemory();
    });

    it('searches through the backend with the session and keeps the catalog mids', async () => {
        requestMock.mockResolvedValue({ code: 200, type: 'song', page: 2, limit: 20, total: 36, more: true, items: [LITE_ITEM] });

        const page = await searchQqSongs('  海阔天空  ', 30, 20);

        // 搜索页一页要 30 条，后端最多给 20：页长压到 20，offset 20 就是第 2 页。
        expect(requestMock).toHaveBeenCalledWith('search', { keyword: '海阔天空', type: 'song', page: 2, limit: 20 });
        expect(searchQQSongsMock).not.toHaveBeenCalled();
        expect(page).toMatchObject({ total: 36, hasMore: true, nextOffset: 40 });
        expect(page.items[0]).toMatchObject({
            name: '海阔天空',
            durationMs: 326_000,
            sourceRef: { providerId: 'qq', mediaId: '003rJSwm3TechU' },
            album: { catalogRef: expect.anything() },
        });
    });

    it('trusts the backend `more` flag instead of guessing from the page length', async () => {
        requestMock.mockResolvedValue({ code: 200, more: false, items: Array.from({ length: 20 }, () => LITE_ITEM) });

        await expect(searchQqSongs('海阔天空', 20, 0)).resolves.toMatchObject({ hasMore: false, nextOffset: 20 });
    });

    it('retries anonymously when the session returns an empty first page', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        requestMock.mockResolvedValue({ code: 200, more: false, items: [] });
        searchQQSongsMock.mockResolvedValue([ANONYMOUS_RESULT]);

        const page = await searchQqSongs('海阔天空', 20, 0);

        expect(searchQQSongsMock).toHaveBeenCalledWith('海阔天空', 1, 20);
        expect(page.items[0]?.sourceRef).toMatchObject({ providerId: 'qq', mediaId: '003rJSwm3TechU' });
    });

    it('keeps an empty first page when the backend still reports more', async () => {
        requestMock.mockResolvedValue({ code: 200, more: true, items: [] });

        const page = await searchQqSongs('海阔天空', 20, 0);

        expect(searchQQSongsMock).not.toHaveBeenCalled();
        expect(page).toMatchObject({ items: [], hasMore: true });
    });

    it('does not retry anonymously on later pages', async () => {
        requestMock.mockResolvedValue({ code: 200, more: false, items: [] });

        const page = await searchQqSongs('未回退', 20, 20);

        expect(searchQQSongsMock).not.toHaveBeenCalled();
        expect(page.items).toEqual([]);
    });

    it('uses the anonymous search on later pages after a first-page fallback', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        requestMock.mockResolvedValue({ code: 200, more: false, items: [] });
        searchQQSongsMock.mockResolvedValue([ANONYMOUS_RESULT]);

        await searchQqSongs('翻页回退', 20, 0);
        expect(searchQQSongsMock).toHaveBeenCalledWith('翻页回退', 1, 20);

        requestMock.mockClear();
        searchQQSongsMock.mockClear();
        const page = await searchQqSongs('翻页回退', 20, 20);

        expect(requestMock).not.toHaveBeenCalled();
        expect(searchQQSongsMock).toHaveBeenCalledWith('翻页回退', 2, 20);
        expect(page.items).toHaveLength(1);
    });

    it('returns to the session search when a marked keyword works again', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        requestMock.mockResolvedValue({ code: 200, more: false, items: [] });
        searchQQSongsMock.mockResolvedValue([ANONYMOUS_RESULT]);

        await searchQqSongs('恢复会话', 20, 0);

        requestMock.mockReset();
        searchQQSongsMock.mockReset();
        requestMock.mockResolvedValue({ code: 200, more: true, items: [LITE_ITEM] });
        await expect(searchQqSongs('恢复会话', 20, 0)).resolves.toMatchObject({ items: [expect.anything()] });

        requestMock.mockClear();
        await searchQqSongs('恢复会话', 20, 20);

        expect(requestMock).toHaveBeenCalledWith('search', { keyword: '恢复会话', type: 'song', page: 2, limit: 20 });
        expect(searchQQSongsMock).not.toHaveBeenCalled();
    });

    it('forgets the marked keywords when the runtime memory is reset', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        requestMock.mockResolvedValue({ code: 200, more: false, items: [] });
        searchQQSongsMock.mockResolvedValue([ANONYMOUS_RESULT]);
        await searchQqSongs('重置记录', 20, 0);

        resetQqSearchFallbackMemory();
        requestMock.mockClear();
        searchQQSongsMock.mockClear();
        await searchQqSongs('重置记录', 20, 20);

        expect(requestMock).toHaveBeenCalledWith('search', { keyword: '重置记录', type: 'song', page: 2, limit: 20 });
        expect(searchQQSongsMock).not.toHaveBeenCalled();
    });

    it('keeps the empty session page when the anonymous fallback fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        requestMock.mockResolvedValue({ code: 200, more: false, total: 0, items: [] });
        searchQQSongsMock.mockRejectedValue(new Error('QQ Music API error: code 2001'));

        const page = await searchQqSongs('匿名失败', 20, 0);

        expect(page).toMatchObject({ items: [], hasMore: false, total: 0 });
        expect(warn).toHaveBeenCalledWith(
            '[QQProvider] anonymous search fallback failed, keeping the empty session page',
            expect.any(Error),
        );
    });

    it('surfaces an upstream refusal instead of reporting no results', async () => {
        requestMock.mockRejectedValue(rejected());

        await expect(searchQqSongs('搁浅', 20, 0)).rejects.toMatchObject({ code: 'network', httpStatus: 502 });
        // 带会话都被拒时，匿名只会更容易被拒，不再白打一次。
        expect(searchQQSongsMock).not.toHaveBeenCalled();
    });

    it.each([
        ['an old backend without the route', new OnlineProviderError('unsupported', 'QQMusicApi has no search route', 'qq', undefined, 404)],
        ['a session the backend no longer accepts', new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', undefined, 401)],
        ['a backend that is not running', new OnlineProviderError('unavailable', 'Embedded QQMusicApi is not running', 'qq')],
    ])('falls back to the anonymous search on %s', async (_label, error) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        requestMock.mockRejectedValue(error);
        searchQQSongsMock.mockResolvedValue([ANONYMOUS_RESULT]);

        const page = await searchQqSongs('海阔天空', 20, 0);

        expect(searchQQSongsMock).toHaveBeenCalledWith('海阔天空', 1, 20);
        expect(page.items[0]?.sourceRef).toMatchObject({ providerId: 'qq', mediaId: '003rJSwm3TechU' });
    });

    it('searches anonymously without a session and reports a refusal as an error', async () => {
        transportState.hasSession = false;
        searchQQSongsMock.mockRejectedValue(new Error('QQ Music API error: code 2001'));

        const error = await searchQqSongs('搁浅', 30, 0).catch(caught => caught);

        expect(requestMock).not.toHaveBeenCalled();
        expect(searchQQSongsMock).toHaveBeenCalledWith('搁浅', 1, 20);
        expect(error).toBeInstanceOf(OnlineProviderError);
        // QQ's code stays on the cause, with the error the anonymous search threw.
        expect(error).toMatchObject({
            code: 'network',
            providerId: 'qq',
            cause: { upstreamCode: 2001, error: expect.any(Error) },
        });
    });

    it('skips the request for a blank keyword and caps the keyword at 60 characters', async () => {
        await expect(searchQqSongs('   ', 20, 0)).resolves.toEqual({ items: [], hasMore: false, nextOffset: 0 });
        expect(requestMock).not.toHaveBeenCalled();

        requestMock.mockResolvedValue({ code: 200, more: false, items: [] });
        searchQQSongsMock.mockResolvedValue([]);
        await searchQqSongs('长'.repeat(80), 20, 0);
        expect(requestMock).toHaveBeenCalledWith('search', expect.objectContaining({ keyword: '长'.repeat(60) }));
    });
});

// 条目字段取自 2026-10-31 后端 `/search` type album / playlist 不带会话的实测回答（裁剪过）。
describe('searchQqCollections', () => {
    beforeEach(() => {
        requestMock.mockReset();
    });

    it('searches albums through the backend and keys them by album mid', async () => {
        requestMock.mockResolvedValue({
            code: 200, type: 'album', page: 1, limit: 20, total: 495, more: true,
            items: [{
                albummid: '0041WVfh2vtlJE', id: 87495226, name: '太阳之子', singer: '周杰伦', singer_id: '',
                song_num: 0, publish_date: '2026-03-25',
                pic: 'http://y.gtimg.cn/music/photo_new/T002R180x180M0000041WVfh2vtlJE_1.jpg',
            }],
        });

        const page = await searchQqCollections('album', ' 周杰伦 ', 30, 0);

        expect(requestMock).toHaveBeenCalledWith('search', { keyword: '周杰伦', type: 'album', page: 1, limit: 20 });
        expect(page).toMatchObject({ total: 495, hasMore: true, nextOffset: 20 });
        expect(page.items[0]).toMatchObject({
            providerId: 'qq', id: '0041WVfh2vtlJE', type: 'album', name: '太阳之子',
            artists: [{ name: '周杰伦' }], publishedAt: Date.parse('2026-03-25'),
        });
        // 上游的 song_num 一律是 0，不当成曲目数。
        expect(page.items[0].trackCount).toBeUndefined();
    });

    it('searches playlists by dissid and leaves the numeric item type out', async () => {
        requestMock.mockResolvedValue({
            code: 200, type: 'playlist', page: 2, limit: 20, total: 299, more: false,
            items: [{
                dissid: '7039749142', dissname: '百听不厌的周杰伦', type: 0, songnum: 99, listennum: 417084720,
                nickname: '今晚月色很美', uin: '2904004371', description: '99首  今晚月色很美  4.2亿次播放  ',
                logo: 'http://qpic.y.qq.com/music_cover/abc/300?n=1',
            }],
        });

        const page = await searchQqCollections('playlist', '周杰伦', 20, 20);

        expect(requestMock).toHaveBeenCalledWith('search', { keyword: '周杰伦', type: 'playlist', page: 2, limit: 20 });
        expect(page).toMatchObject({ total: 299, hasMore: false, nextOffset: 40 });
        expect(page.items[0]).toMatchObject({
            providerId: 'qq', id: '7039749142', type: 'playlist', name: '百听不厌的周杰伦',
            trackCount: 99, playCount: 417084720, creator: { nickname: '今晚月色很美' },
        });
        expect(page.items[0].description).toBeUndefined();
    });

    it('fails on an answer without items instead of showing no results', async () => {
        requestMock.mockResolvedValue({ code: 200 });
        await expect(searchQqCollections('album', '周杰伦', 20, 0)).rejects.toMatchObject({ code: 'invalid-response' });
    });
});
