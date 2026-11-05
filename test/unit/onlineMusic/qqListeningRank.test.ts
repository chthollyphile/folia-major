import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqListeningRank.test.ts
// QQ 的听歌排行：回包形状取自 qq-music-api 3.3.6 的 /user/listening-rank（{ items:[{ track, listenCount }] }）；
// 数字与名字是虚构示例。

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/qq/qqTransport', () => ({ requestQq: requestMock }));

import { getQqListeningRankCollections, getQqListeningRankTracks } from '@/services/onlineMusic/qq/qqListeningRank';
import { OnlineProviderError } from '@/types/onlineMusic';
import i18n from '@/i18n/config';

const track = (mid: string, id: number) => ({
    mid,
    id,
    name: `歌 ${mid}`,
    singer: [{ mid: 'singer-mid', name: '歌手' }],
    album: { mid: 'album-mid', name: '专辑' },
    file: { media_mid: `${mid}-media` },
    interval: 200,
});
const user = { id: 9001, nickname: '听者' };
const answers = (week: unknown[], year: unknown[]) => requestMock.mockImplementation(async (_operation: string, params: { range: string }) => ({
    code: 200,
    range: params.range,
    items: params.range === 'week' ? week : year,
}));

describe('QQ listening rank', () => {
    beforeEach(() => {
        requestMock.mockReset();
        vi.spyOn(console, 'info').mockImplementation(() => { });
    });

    it('reads the week as week and stands the year in for all time', async () => {
        answers([{ track: track('w1', 1), listenCount: 12 }], [{ track: track('y1', 2), listenCount: 80 }]);
        const collections = await getQqListeningRankCollections(user);
        expect(requestMock.mock.calls.map(([operation, params]) => [operation, params])).toEqual([
            ['user_listening_rank', { range: 'week' }],
            ['user_listening_rank', { range: 'year' }],
        ]);
        expect(collections.map(collection => [collection.listeningRank, collection.type, collection.trackCount])).toEqual([
            ['week', 'listening_rank', 1],
            ['all', 'listening_rank', 1],
        ]);
        // Named with QQ's own entries; the shared "last week / all time" stay for the other platforms.
        expect(collections.map(collection => collection.name)).toEqual([i18n.t('listeningRank.qqWeek'), i18n.t('listeningRank.qqYear')]);
        expect(collections[1].name).not.toBe(i18n.t('listeningRank.all'));
        expect(collections[0].id).toBe('listening-rank-week-9001');
    });

    it('leaves out a span with no plays', async () => {
        answers([], [{ track: track('y1', 2), listenCount: 3 }]);
        expect((await getQqListeningRankCollections(user)).map(collection => collection.listeningRank)).toEqual(['all']);
    });

    it('has no entries on a backend without the route, and throws on other failures', async () => {
        requestMock.mockRejectedValue(new OnlineProviderError('unsupported', 'QQMusicApi has no user_listening_rank route', 'qq', undefined, 404));
        await expect(getQqListeningRankCollections(user)).resolves.toEqual([]);
        requestMock.mockRejectedValue(new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502));
        await expect(getQqListeningRankCollections(user)).rejects.toThrow('502');
    });

    it('pages the songs in QQ order with their play counts', async () => {
        answers([
            { track: track('w1', 1), listenCount: 12 },
            { track: track('w2', 2), listenCount: 3 },
            { listenCount: 1 },
        ], []);
        const page = await getQqListeningRankTracks('week', 1, 1);
        expect(page.items.map(song => [song.name, song.listenCount])).toEqual([['歌 w2', 3]]);
        expect(page).toMatchObject({ total: 2, hasMore: false, nextOffset: 2 });
        answers([], []);
        requestMock.mockResolvedValueOnce({ code: 200 });
        await expect(getQqListeningRankTracks('all', 10, 0)).rejects.toThrow('without items');
    });
});
