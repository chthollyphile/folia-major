import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqLists.test.ts
// 当成集合打开的排行榜、电台与音乐云盘。回应形状取自 qq-music-api 3.3.3 的使用文档（「歌单分类、分类歌单与新歌速递」
// 「电台」「音乐云盘」）；数字与名字是虚构示例。

const requestMock = vi.hoisted(() => vi.fn());
const transportState = vi.hoisted(() => ({ hasSession: true }));

vi.mock('../../../sources/qq/core/qqTransport', async importOriginal => ({
    ...await importOriginal<typeof import('../../../sources/qq/core/qqTransport')>(),
    hasQqSession: () => transportState.hasSession,
    hasUsableQqSession: () => transportState.hasSession,
    requestQq: requestMock,
}));

import {
    getQqCloudCollection,
    getQqCloudTracks,
    getQqListTracks,
    qqListKindOf,
    qqRadioCollection,
    qqToplistCollection,
} from '../../../sources/qq/core/qqLists';
import { normalizeQqCollection } from '../../../sources/qq/core/qqNormalize';
import type { FoliumSourceDef } from '@/mods/folium/sources/contract';
import { createQqCore } from '../helpers/qqSource';
import { OnlineProviderError } from '@/types/onlineMusic';

const track = (mid: string, id: number) => ({ mid, id, name: `歌 ${mid}`, singer: [{ mid: 'singer-mid', name: '歌手' }], album: { mid: 'album-mid', name: '专辑' } });
const emptyAnswer = () => new OnlineProviderError('network', 'QQMusicApi request failed: 422', 'qq', { errorKey: 'resource.not-found' }, 422);

// createSource 给 core 装上 env（请求、文字）；打开卡片要的 catalog 从它交回的定义里取。
let def: FoliumSourceDef;
beforeAll(async () => {
    def = (await createQqCore()).def as FoliumSourceDef;
});

describe('QQ charts and radio stations as collections', () => {
    beforeEach(() => {
        requestMock.mockReset();
        transportState.hasSession = true;
    });

    it('makes a chart card that keeps its id and period, under an id no playlist has', () => {
        const chart = qqToplistCollection({ id: 26, title: '示例榜', period: '2026_41', total: 100, cover: 'https://img.example.test/chart.jpg' });

        expect(chart).toMatchObject({
            id: 'toplist-26', name: '示例榜', type: 'playlist', trackCount: 100, coverUrl: 'https://img.example.test/chart.jpg',
            data: { list: 'toplist', listId: 26, period: '2026_41' },
        });
        expect(qqListKindOf(chart!)).toBe('toplist');
        // 缓存回填时照样认得出它是榜。
        expect(qqListKindOf(normalizeQqCollection(chart))).toBe('toplist');
        expect(qqToplistCollection({ id: 0, title: '没有 id' })).toBeNull();
    });

    it('reads a chart a page at a time, for the period the card was made of', async () => {
        const chart = qqToplistCollection({ id: 26, title: '示例榜', period: '2026_41' })!;
        requestMock.mockResolvedValueOnce({ code: 200, songs: [track('mid-a', 1), track('mid-b', 2)], total: 100, more: true });

        const page = await getQqListTracks(chart, 2, 0);

        expect(requestMock).toHaveBeenCalledWith('recommend_toplist', { id: 26, period: '2026_41', offset: 0, limit: 2 });
        expect(page.items.map(song => song.id)).toEqual(['mid-a', 'mid-b']);
        expect(page).toMatchObject({ total: 100, hasMore: true, nextOffset: 2 });
    });

    it('pages a chart by what the backend gave, not by the songs left after dropping ones without a mid', async () => {
        const chart = qqToplistCollection({ id: 26, title: '示例榜' })!;
        requestMock.mockResolvedValueOnce({ code: 200, songs: [track('mid-a', 1), track('', 2), track('mid-c', 3)], total: 100, more: true });

        const page = await getQqListTracks(chart, 3, 0);

        expect(page.items.map(song => song.id)).toEqual(['mid-a', 'mid-c']);
        // 下一页从第 4 条起，不和这一页的第 3 条重叠。
        expect(page).toMatchObject({ hasMore: true, nextOffset: 3 });
    });

    it('takes a chart with no songs for an empty page, not a failure', async () => {
        const chart = qqToplistCollection({ id: 26, title: '示例榜' })!;
        requestMock.mockRejectedValueOnce(emptyAnswer());

        await expect(getQqListTracks(chart, 20, 0)).resolves.toEqual({ items: [], hasMore: false, nextOffset: 0 });
        expect(requestMock).toHaveBeenCalledWith('recommend_toplist', { id: 26, offset: 0, limit: 20 });
    });

    it('opens a radio station as one batch, with nothing after it', async () => {
        const radio = qqRadioCollection({ id: 101, title: '示例电台', picurl: 'https://img.example.test/radio.jpg' })!;
        requestMock.mockResolvedValueOnce({ code: 200, songs: [track('mid-a', 1), track('mid-b', 2), track('mid-c', 3)] });

        await expect(getQqListTracks(radio, 50, 0)).resolves.toMatchObject({ total: 3, hasMore: false, nextOffset: 3 });
        expect(requestMock).toHaveBeenCalledWith('radio_tracks', { id: 101 });
        await expect(getQqListTracks(radio, 50, 3)).resolves.toEqual({ items: [], hasMore: false, nextOffset: 3 });
        expect(requestMock).toHaveBeenCalledTimes(1);
    });

    // 打开卡片走的是 模组已有的 catalog：歌单那一条认出卡片，改走榜的路由；详情照原样交回。
    it('is read through the source\'s playlist tracks and detail', async () => {
        const chart = qqToplistCollection({ id: 26, title: '示例榜' })!;
        requestMock.mockResolvedValueOnce({ code: 200, songs: [track('mid-a', 1)], total: 1, more: false });

        await expect(def.capabilities['catalog@1']!.getPlaylistTracks!(chart.id, 50, 0, chart)).resolves.toMatchObject({ total: 1, hasMore: false });
        expect(requestMock.mock.calls.map(call => call[0])).toEqual(['recommend_toplist']);
        await expect(def.capabilities['catalog@1']!.getPlaylistDetail!(chart.id, chart)).resolves.toBe(chart);
        expect(requestMock).toHaveBeenCalledTimes(1);
    });
});

describe('QQ cloud drive', () => {
    beforeEach(() => {
        requestMock.mockReset();
        transportState.hasSession = true;
    });

    it('shows the cloud among the playlists under the app\'s own name, and not at all when it is empty', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 200, data: [{ song: track('mid-a', 1), fileName: 'a.flac', addTime: 1, playable: true }], count: 12, hasMore: true })
            .mockResolvedValueOnce({ code: 200, data: [], count: 0, hasMore: false });

        const cloud = await getQqCloudCollection({ id: '10001', nickname: '示例用户' });
        expect(requestMock).toHaveBeenCalledWith('user_cloud', { offset: 0, limit: 1 });
        expect(cloud).toMatchObject({ type: 'cloud', name: 'cloud.name', trackCount: 12, isOwned: true });
        expect(cloud?.coverUrl).toBeTruthy();
        // 描述写的是这个平台自己的网盘（模组自己的那一句），不借别家云盘的。测试的 env 里文字就是键名。
        expect(cloud?.description).toBe('cloud.description');

        await expect(getQqCloudCollection()).resolves.toBeNull();
    });

    // 自己上传、没对上曲库的文件放不了，不列出来；它们照样占云盘里的位置，下一页从后端的位置接着读。
    it('lists the songs that play and pages by the place in the cloud', async () => {
        requestMock.mockResolvedValueOnce({
            code: 200,
            data: [
                { song: track('mid-a', 1), fileName: 'a.flac', addTime: 1, playable: true },
                { song: null, fileName: '自己录的.m4a', addTime: 2, playable: false },
                { song: track('mid-c', 3), fileName: 'c.mp3', addTime: 3, playable: false },
                { song: track('mid-d', 4), fileName: 'd.mp3', addTime: null, playable: true },
            ],
            count: 9,
            hasMore: true,
        });

        const page = await getQqCloudTracks(4, 0);

        expect(requestMock).toHaveBeenCalledWith('user_cloud', { offset: 0, limit: 4 });
        expect(page.items.map(song => song.id)).toEqual(['mid-a', 'mid-d']);
        expect(page).toMatchObject({ total: 9, hasMore: true, nextOffset: 4 });
    });

    it('stops at an empty page even where the backend says there is more', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, data: [], count: 9, hasMore: true });

        await expect(getQqCloudTracks(50, 8)).resolves.toMatchObject({ items: [], hasMore: false, nextOffset: 8 });
    });
});
