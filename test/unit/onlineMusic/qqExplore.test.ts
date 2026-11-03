import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqExplore.test.ts
// QQ 音乐的探索页：第一页与后面几部分各有哪些栏、栏的 id、游标、换一批（整页重读）时各栏怎么轮换。
// 回应形状取自 qq-music-api 3.3.3 的使用文档（「刷歌模式」「相似歌曲和包含这首歌的歌单」「歌单分类、分类歌单与新歌速递」
// 「电台」）；数字与名字是虚构示例。

const requestMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('@/services/onlineMusic/qq/qqTransport', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/qq/qqTransport')>(),
    hasQqSession: () => transportState.hasSession,
    hasUsableQqSession: () => transportState.hasSession,
    requestQq: requestMock,
}));

import i18n from '@/i18n/config';
import { createQqExplore } from '@/services/onlineMusic/qq/qqExplore';
import { normalizeQqSong } from '@/services/onlineMusic/qq/qqNormalize';
import { OnlineProviderError, type ProviderExploreSection } from '@/types/onlineMusic';

const track = (mid: string, id: number) => ({ mid, id, name: `歌 ${mid}`, singer: [{ mid: 'singer-mid', name: '歌手' }], album: { mid: 'album-mid', name: '专辑' } });
const tracks = (prefix: string, from: number, count: number) => Array.from({ length: count }, (_, index) => track(`${prefix}-${from + index}`, from + index));
const emptyAnswer = () => new OnlineProviderError('network', 'QQMusicApi request failed: 422', 'qq', { errorKey: 'resource.not-found' }, 422);

const CATEGORIES = [1, 2, 3, 4, 5].map(id => ({ id: 100 + id, name: `分类 ${id}` }));
const RADIO_GROUPS = [
    { id: 48, title: '热门', radios: [{ id: 99, title: '猜你喜欢' }, { id: 101, title: '示例电台 A' }] },
    { id: 44, title: '最近', radios: [{ id: 102, title: '听过的电台' }] },
    { id: 50, title: '心情', radios: [{ id: 103, title: '示例电台 B' }] },
    { id: 51, title: '场景', radios: [{ id: 104, title: '示例电台 C' }] },
    { id: 52, title: '空的组', radios: [] },
];

// 一个照文档回答的假后端；`overrides` 换掉其中几条路由的回答。
const answerAs = (overrides: Record<string, (params: any) => unknown> = {}) => {
    requestMock.mockImplementation(async (operation: string, params: any = {}) => {
        if (overrides[operation]) return overrides[operation](params);
        switch (operation) {
            case 'recommend_radar': return { code: 200, page: params.page, songs: tracks(`radar${params.page}`, params.page * 100, 10), more: params.page < 3 };
            case 'user_daily_songs': return { code: 200, songs: tracks('daily', 500, 5) };
            case 'song_similar': return { code: 200, songs: tracks(`like${params.id}`, params.id * 1000, 6) };
            case 'recommend_new_songs': return { code: 200, area: 5, songs: tracks('new', 2000, 30), areas: [] };
            case 'recommend_new_albums': return {
                code: 200, area: 1,
                albums: Array.from({ length: params.limit }, (_, index) => ({ mid: `album-${params.offset + index}`, name: `专辑 ${params.offset + index}`, singers: [{ mid: 's', name: '歌手' }] })),
                areas: [], total: 30, more: params.offset + params.limit < 30,
            };
            case 'recommend_toplists': return { code: 200, groups: [{ id: 1, name: '巅峰榜', toplists: [{ id: 4, title: '飙升榜', period: '2026-10-17' }, { id: 26, title: '热歌榜', period: '2026_41' }] }] };
            case 'recommend_toplist': return { code: 200, toplist: { id: params.id }, songs: tracks(`chart${params.id}`, 3000 + params.offset, params.limit), total: 100, more: true };
            case 'recommend_categories': return { code: 200, groups: [{ id: 1, name: '热门', categories: CATEGORIES }, { id: 2, name: '语种', categories: [{ id: 900, name: '别组的分类' }] }] };
            case 'recommend_category_playlists': return {
                code: 200,
                playlists: Array.from({ length: params.limit }, (_, index) => ({ tid: params.id * 100 + index, title: `歌单 ${params.id}-${index}`, picurl: 'https://img.example.test/p.jpg' })),
                total: 100, more: true,
            };
            case 'radio_list': return { code: 200, groups: RADIO_GROUPS };
            default: throw new Error(`unexpected ${operation}`);
        }
    });
};

const listened = [normalizeQqSong(track('heard-a', 11)), normalizeQqSong(track('heard-b', 12))];
const ids = (sections: ProviderExploreSection[]) => sections.map(section => section.id);
const titles = (sections: ProviderExploreSection[]) => sections.map(section => section.title);
const operations = () => requestMock.mock.calls.map(call => call[0]);

// 把整页读完：第一页，再按游标读到没有下一部分。
const readWhole = async (explore: ReturnType<typeof createQqExplore>, heard = listened) => {
    const first = await explore.getFeed(undefined, heard);
    const sections = [...first.sections];
    let cursor = first.nextCursor;
    while (cursor) {
        const part = await explore.getFeed(cursor);
        sections.push(...part.sections);
        cursor = part.nextCursor;
    }
    return { first, sections };
};

describe('QQ explore page', () => {
    beforeEach(() => {
        requestMock.mockReset();
        transportState.hasSession = true;
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('reads the song radar and songs like the ones listened to first, and says a refresh reads it anew', async () => {
        answerAs();
        const explore = createQqExplore();

        const first = await explore.getFeed(undefined, listened);

        expect(first.refreshReadsAnew).toBe(true);
        expect(first.nextCursor).toBeTruthy();
        expect(first.sections[0]).toMatchObject({ id: 'qq-radar', title: i18n.t('home.qqRadar') });
        expect(first.sections[0].items).toHaveLength(10);
        // 听过的两首各做一栏，不够三首再用每日 30 首补一首。
        expect(titles(first.sections.slice(1))).toEqual([
            i18n.t('home.exploreSimilar', { name: '歌 heard-a' }),
            i18n.t('home.exploreSimilar', { name: '歌 heard-b' }),
            i18n.t('home.exploreSimilar', { name: '歌 daily-500' }),
        ]);
        expect(first.sections.slice(1).every(section => section.changesWithRead)).toBe(true);
        expect(requestMock).toHaveBeenCalledWith('song_similar', { id: 11 });
    });

    it('lays the page out in the order of the client\'s pages, leaving out the account\'s own listening and the personal FM', async () => {
        answerAs();
        const { sections } = await readWhole(createQqExplore());

        expect(ids(sections).slice(0, 4)).toEqual(['qq-radar', 'qq-similar-1', 'qq-similar-2', 'qq-similar-3']);
        expect(ids(sections).slice(4, 8)).toEqual(['qq-new-songs', 'qq-new-albums', 'qq-charts', 'qq-chart-26']);
        expect(titles(sections).slice(4, 8)).toEqual([i18n.t('home.qqNewSongs'), i18n.t('home.qqNewAlbums'), i18n.t('home.qqCharts'), '热歌榜']);
        // 热门那一组的分类，一次三个。
        expect(titles(sections).slice(8, 11)).toEqual(['分类 1', '分类 2', '分类 3']);
        // 电台：「最近」与空组不出，「猜你喜欢」（电台 99）不放，一次两组。
        const radio = sections.slice(11);
        expect(titles(radio)).toEqual(['热门', '心情']);
        expect(radio[0].items.map(item => item.kind === 'collection' && item.collection.name)).toEqual(['示例电台 A']);
        expect(radio[0].items.every(item => item.kind === 'collection' && item.isMix)).toBe(true);
        expect(sections).toHaveLength(13);
    });

    it('makes chart cards that open the chart, and hands out one batch of a long list with a "more"', async () => {
        answerAs();
        const { sections } = await readWhole(createQqExplore());
        const charts = sections.find(section => section.id === 'qq-charts')!;
        const newSongs = sections.find(section => section.id === 'qq-new-songs')!;

        expect(charts.items.map(item => item.kind === 'collection' && item.collection.providerData)).toEqual([
            { list: 'toplist', listId: 4, period: '2026-10-17' },
            { list: 'toplist', listId: 26, period: '2026_41' },
        ]);
        expect(newSongs.items).toHaveLength(12);
        const more = await createQqExplore().getSectionItems!(newSongs.moreCursor!);
        // 别的读取的游标答空。
        expect(more.items).toEqual([]);
    });

    it('goes on with a shelf\'s "more" and answers a cursor of a read before with nothing', async () => {
        answerAs();
        const explore = createQqExplore();
        const { first, sections } = await readWhole(explore);
        const newSongs = sections.find(section => section.id === 'qq-new-songs')!;
        const radar = first.sections[0];

        const moreSongs = await explore.getSectionItems!(newSongs.moreCursor!);
        expect(moreSongs.items).toHaveLength(12);
        expect(moreSongs.items.map(item => item.kind === 'song' && item.song.qqMid)).not.toContain(
            newSongs.items[0].kind === 'song' && newSongs.items[0].song.qqMid,
        );
        const moreRadar = await explore.getSectionItems!(radar.moreCursor!);
        expect(moreRadar.items.map(item => item.kind === 'song' && item.song.qqMid)[0]).toBe('radar2-200');

        await explore.getFeed(undefined, listened);
        requestMock.mockClear();
        await expect(explore.getSectionItems!(newSongs.moreCursor!)).resolves.toEqual({ items: [] });
        await expect(explore.getFeed(first.nextCursor)).resolves.toEqual({ sections: [] });
        expect(requestMock).not.toHaveBeenCalled();
    });

    // 换一批是整页重读：刷歌模式接着下一页，问别的歌，轮到别的分类与电台组，长列表先给没交过的。
    it('changes what it can with every read anew', async () => {
        answerAs();
        const explore = createQqExplore();
        const one = (await readWhole(explore, [])).sections;
        const two = (await readWhole(explore, [])).sections;

        const radarMids = (sections: ProviderExploreSection[]) => sections[0].items.map(item => item.kind === 'song' && item.song.qqMid);
        expect(radarMids(one)[0]).toBe('radar1-100');
        expect(radarMids(two)[0]).toBe('radar2-200');
        expect(titles(one).filter(title => title.startsWith('分类'))).toEqual(['分类 1', '分类 2', '分类 3']);
        expect(titles(two).filter(title => title.startsWith('分类'))).toEqual(['分类 4', '分类 5', '分类 1']);
        expect(titles(two).filter(title => ['热门', '心情', '场景'].includes(title))).toEqual(['场景', '热门']);
        const songsOf = (sections: ProviderExploreSection[]) => sections.find(section => section.id === 'qq-new-songs')!.items
            .map(item => item.kind === 'song' && item.song.qqMid);
        expect(songsOf(two).filter(mid => songsOf(one).includes(mid))).toEqual([]);
        // 每次重读，相似歌曲、分类、电台的栏都是新的栏。
        expect(ids(two).filter(id => ids(one).includes(id))).toEqual(['qq-radar', 'qq-new-songs', 'qq-new-albums', 'qq-charts', 'qq-chart-26']);
    });

    it('gives a guest the public shelves only', async () => {
        transportState.hasSession = false;
        answerAs();
        const { sections } = await readWhole(createQqExplore());

        expect(ids(sections).filter(id => id.startsWith('qq-similar') || id.startsWith('qq-radio'))).toEqual([]);
        expect(operations()).not.toContain('song_similar');
        expect(operations()).not.toContain('user_daily_songs');
        expect(operations()).not.toContain('radio_list');
        expect(ids(sections)[0]).toBe('qq-radar');
    });

    it('goes on without a shelf that could not be read, and leaves out one with no data', async () => {
        answerAs({
            recommend_new_songs: () => { throw new OnlineProviderError('network', 'QQMusicApi request failed: 502', 'qq', { errorKey: 'upstream.unknown' }, 502); },
            recommend_toplists: () => { throw emptyAnswer(); },
            song_similar: params => ({ code: 200, songs: params.id === 11 ? tracks('few', 1, 2) : tracks(`like${params.id}`, params.id * 1000, 6) }),
        });
        const { sections } = await readWhole(createQqExplore());

        expect(ids(sections)).not.toContain('qq-new-songs');
        expect(ids(sections)).toContain('qq-new-albums');
        expect(ids(sections)).not.toContain('qq-charts');
        // 太少首的那一栏不出。
        expect(titles(sections)).not.toContain(i18n.t('home.exploreSimilar', { name: '歌 heard-a' }));
    });

    it('fails only where nothing of the first page and the parts after it could be read', async () => {
        transportState.hasSession = false;
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi request failed: 503', 'qq', undefined, 503));

        await expect(createQqExplore().getFeed()).rejects.toMatchObject({ httpStatus: 503 });
    });
});
