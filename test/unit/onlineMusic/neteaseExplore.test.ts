import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/neteaseExplore.test.ts
// The reader of NetEase's explore page: which home blocks become shelves and under which ids,
// what a cursor brings, and what a shelf hands out in one read after another (a refresh is a
// read anew: a shelf's cursor is for its "more" alone). The home page is the one NetEase answered
// a guest with on 2026-10-08, cut down to a few entries a block and the fields read.

const api = vi.hoisted(() => ({
    hasAccountSession: vi.fn(),
    getHomeBlocks: vi.fn(),
    getToplists: vi.fn(),
    getDailyRecommendedSongs: vi.fn(),
    getDailyRecommendedPlaylists: vi.fn(),
    getNewSongs: vi.fn(),
    getNewAlbums: vi.fn(),
    getHotPlaylists: vi.fn(),
    getSimilarSongs: vi.fn(),
    getPlaylistTracks: vi.fn(),
}));
vi.mock('@/services/onlineMusic/netease/netease', async importOriginal => {
    const actual = await importOriginal<typeof import('@/services/onlineMusic/netease/netease')>();
    return { ...actual, neteaseApi: { ...actual.neteaseApi, ...api } };
});
vi.mock('@/utils/lyrics/workerClient', () => ({ parseLyricsAsync: vi.fn() }));
import i18n from '@/i18n/config';
import { createNeteaseExplore } from '@/services/onlineMusic/netease/neteaseExplore';
import { neteaseProvider } from '@/services/onlineMusic/netease/neteaseProvider';
import type { ProviderExploreItem, ProviderExploreSection } from '@/types/onlineMusic';
import type { UnifiedSong } from '@/types';

const image = (path: string) => ({ imageUrl: `http://p3.music.126.net/${path}.jpg` });
const listEntry = (id: string, title: string, path: string, playCount: number) => ({
    uiElement: { mainTitle: { title }, image: image(path) }, resourceType: 'list', resourceId: id, resourceExtInfo: { playCount },
});
const songEntry = (id: number, name: string, artists: Array<[number, string]>, album: [number, string], path: string, duration: number, privilege: { fee: number; st: number; pl: number }) => ({
    uiElement: { mainTitle: { title: name }, image: image(path) },
    resourceType: 'song',
    resourceId: String(id),
    resourceExtInfo: {
        songData: {
            name, id, fee: 8, duration,
            artists: artists.map(([artistId, artistName]) => ({ name: artistName, id: artistId })),
            album: { name: album[1], id: album[0], picUrl: image(path).imageUrl },
        },
        songPrivilege: { id, ...privilege },
    },
});
const albumEntry = (id: string, title: string, path: string, artist: [number, string]) => ({
    uiElement: { mainTitle: { title }, image: image(path) }, resourceType: 'album', resourceId: id, resourceExtInfo: { artists: [{ name: artist[1], id: artist[0] }] },
});
const block = (blockCode: string, title: string, creatives: unknown[][]) => ({
    blockCode, uiElement: { mainTitle: { title: '' }, subTitle: { title } }, creatives: creatives.map(resources => ({ resources })),
});

const LISTS = 'HOMEPAGE_BLOCK_PLAYLIST_RCMD';
const SONGS = 'HOMEPAGE_BLOCK_STYLE_RCMD';
const FRESH = 'HOMEPAGE_BLOCK_NEW_ALBUM_NEW_SONG';
const guestBlocks = () => [
    block(LISTS, '推荐歌单', [
        [listEntry('17744833377', '2026火遍全网的歌曲精选', 'JAB2gsFX1HseaCtkr0b29w==/109951173982524203', 27004044)],
        [listEntry('12250090837', '那些被单曲循环无数次的歌', '4jJ2kqkpAN28IKXXd0nB3A==/109951173780998880', 17926344)],
        [listEntry('14417464479', '是R&B！适合洗澡做作业加班享受~', 'KLdch9hwdKXpl6EqcK_V9Q==/109951172145958150', 4200737)],
    ]),
    block(SONGS, '猜你喜欢的「欧美」好歌', [
        [
            songEntry(3392959216, 'Sea Mistt Beat', [[58581295, 'Jasr'], [98925269, 'Master666']], [381344362, 'Sea Mistt Beat'], 'BBxSItG872dzWsaFVnU2vw==/109951173350553742', 90000, { fee: 8, st: 0, pl: 320000 }),
            songEntry(19827042, 'Call You Tonight', [[84061, 'Whitney Houston']], [1830939, 'I Look To You'], '0rCqvshmixfyHpQYxd1LsQ==/109951165987301859', 250066, { fee: 0, st: -100, pl: 0 }),
        ],
        [
            songEntry(17282443, "Creepin' up on You", [[31190, 'Darren Hayes']], [1593265, 'Spin'], 'lgZ76KEeIy6jBNU4dmdDig==/109951169041866092', 293133, { fee: 0, st: -100, pl: 0 }),
            songEntry(27158959, 'Come Back To Me', [[18122, '宇多田ヒカル']], [2589208, 'Promo Only: Mainstream Radio, March 2009'], 'gZdwUZdIF_jF_DHQ1HjVXQ==/2135251581170994', 238004, { fee: 0, st: -100, pl: 0 }),
        ],
    ]),
    block(FRESH, '新歌新碟', [
        [
            songEntry(3440552022, 'Bad Girl', [[1047015, '张艺兴']], [400300392, 'Bad Girl'], '5maGWOdf2tW5gqjZV5n96Q==/109951173991864159', 188117, { fee: 0, st: -100, pl: 0 }),
            songEntry(3437948530, '成功它会奖励一直在前进的人', [[12371082, '辉子']], [399077882, '雾中人'], 'nho_PDbrPwgy7FPS6WVT9g==/109951173959999614', 176470, { fee: 8, st: 0, pl: 320000 }),
        ],
        [
            // A link to NetEase's shop, in the row of new albums.
            { uiElement: { mainTitle: { title: '数字专辑' }, image: image('K7G6aTPZtp6dJ0aAeISX1g==/109951174017472748') }, resourceType: 'digitalEntrance', resourceId: null, resourceExtInfo: null },
            albumEntry('397805510', '吴琳珂', 'nmaLZTVSB92Ggqhl9zhB6g==/109951173919639815', [29051651, '吴琳珂Moske']),
            albumEntry('397921409', 'シュガーソルト', 'Xoottp-wiKvkj2YJTItNxg==/109951173923793014', [15199, 'オーイシマサヨシ']),
        ],
        [{ uiElement: { mainTitle: { title: '끝내주는 인생' }, image: image('K7G6aTPZtp6dJ0aAeISX1g==/109951174017472748') }, resourceType: 'digitalAlbum', resourceId: '397818634', resourceExtInfo: {} }],
    ]),
];
// Blocks a guest's page did not have. Their codes and shapes are not NetEase's answers: they are
// here for the rules that leave a block out.
const otherBlocks = () => [
    block('HOMEPAGE_BLOCK_TOPLIST', '排行榜', [[songEntry(1, 'Charted', [[2, 'Someone']], [3, 'An album'], 'chart', 1000, { fee: 0, st: 0, pl: 320000 })]]),
    block('HOMEPAGE_BLOCK_RECENT_PLAY', '最近播放', [[listEntry('77', 'Played lately', 'recent', 1)]]),
    block('HOMEPAGE_VOICELIST_RCMD', '热门播客', [[{ uiElement: { mainTitle: { title: 'A podcast' }, image: image('voice') }, resourceType: 'voicelist', resourceId: '88', resourceExtInfo: {} }]]),
];
const homeOf = (blocks: unknown[], more: { cursor?: string; hasMore?: boolean } = {}) => ({ code: 200, data: { cursor: more.cursor ?? null, hasMore: more.hasMore ?? false, blocks } });
const chartsOf = (count: number) => ({
    code: 200,
    list: Array.from({ length: count }, (_, index) => ({
        id: 1000 + index, name: `榜 ${index}`, coverImgUrl: 'https://p3.music.126.net/chart.jpg', updateFrequency: '每天更新', creator: null, ...(index < 2 ? { ToplistType: 'S' } : {}),
    })),
});
// A song as the older endpoints give it (`/top/song`, `/simi/song`).
const oldSong = (id: number, name = `Song ${id}`) => ({ id, name, artists: [{ id: 5, name: 'Singer' }], album: { id: 6, name: 'Album', picUrl: 'http://p3.music.126.net/old.jpg' }, duration: 200000 });
// The answers of `/album/new` for a list of `total` albums.
const albumsOf = (total: number) => async (limit: number, offset: number) => ({
    code: 200, total, albums: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({ id: 9000 + offset + index, name: `Album ${offset + index}`, picUrl: 'https://p3.music.126.net/a.jpg', artists: [{ id: 5, name: 'Singer' }] })),
});
const idsFrom = (first: number, count: number) => Array.from({ length: count }, (_, index) => first + index);
const refreshLines = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line)).filter(line => line.startsWith('[Netease] Explore refresh: '));

const idsOf = (sections: ProviderExploreSection[]) => sections.map(section => section.id);
const entryIds = (items: ProviderExploreItem[]) => items.map(item => (item.kind === 'song' ? item.song.id : item.collection.id));
const newExplore = () => createNeteaseExplore({ song: neteaseProvider.normalizeSong, collection: neteaseProvider.normalizeCollection! });

beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset());
    api.hasAccountSession.mockReturnValue(false);
    api.getHomeBlocks.mockImplementation(async () => homeOf(guestBlocks()));
    api.getToplists.mockResolvedValue(chartsOf(5));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('NetEase explore page', () => {
    it("gives a guest NetEase's blocks under its headings and the charts, and asks for nothing of an account", async () => {
        api.getHomeBlocks.mockResolvedValue(homeOf([...guestBlocks(), ...otherBlocks()]));
        const page = await newExplore().getFeed();

        // (The block of charts, the record of the account's listening and the podcasts are left out.)
        expect(idsOf(page.sections)).toEqual([`netease-block-${LISTS}`, `netease-block-${SONGS}`, `netease-block-${FRESH}`, 'netease-charts']);
        expect(page.sections.slice(0, 3).map(section => section.title)).toEqual(['推荐歌单', '猜你喜欢的「欧美」好歌', '新歌新碟']);
        expect(api.getDailyRecommendedSongs).not.toHaveBeenCalled();
        expect(api.getDailyRecommendedPlaylists).not.toHaveBeenCalled();
        expect(page.nextCursor).toBeTruthy();

        const [lists, songs, fresh, charts] = page.sections;
        expect(lists.items[0]).toMatchObject({ kind: 'collection', collection: { providerId: 'netease', type: 'playlist', id: 17744833377, name: '2026火遍全网的歌曲精选', playCount: 27004044 } });
        expect(songs.items).toHaveLength(4);
        expect(songs.items[0]).toMatchObject({
            kind: 'song',
            song: {
                id: 3392959216, name: 'Sea Mistt Beat', durationMs: 90000, privilege: { st: 0, pl: 320000 },
                artists: [{ name: 'Jasr' }, { name: 'Master666' }],
                album: { id: 381344362, coverUrl: 'https://p3.music.126.net/BBxSItG872dzWsaFVnU2vw==/109951173350553742.jpg' },
                sourceRef: { kind: 'online', providerId: 'netease', mediaId: '3392959216' },
            },
        });
        // Two new songs, then two new albums: the link to the shop and the album on sale are no entries.
        expect(entryIds(fresh.items)).toEqual([3440552022, 3437948530, 397805510, 397921409]);
        expect(fresh.items[2]).toMatchObject({ kind: 'collection', collection: { type: 'album', name: '吴琳珂', artists: [{ name: '吴琳珂Moske' }] } });
        expect(charts.items).toHaveLength(5);
        expect(charts.items[0]).toMatchObject({ kind: 'collection', collection: { type: 'playlist', id: 1000 }, subtitle: '每天更新' });
    });

    it("puts an account's daily songs first and its daily playlists after the blocks, and leaves out the one NetEase does not give", async () => {
        api.hasAccountSession.mockReturnValue(true);
        api.getDailyRecommendedSongs.mockResolvedValue({ code: 200, songs: [{ id: 21, name: 'Daily', ar: [{ id: 5, name: 'Singer' }], al: { id: 6, name: 'Album', picUrl: 'https://p3.music.126.net/d.jpg' }, dt: 1000 }] });
        // (`type` is a number in this list.)
        api.getDailyRecommendedPlaylists.mockResolvedValue({ code: 200, recommend: [{ id: 31, type: 1, name: 'For the account', picUrl: 'https://p3.music.126.net/l.jpg', playcount: 9, trackCount: 3, creator: { userId: 7, nickname: 'Maker' } }] });
        const page = await newExplore().getFeed();
        expect(idsOf(page.sections)).toEqual(['netease-daily-songs', `netease-block-${LISTS}`, `netease-block-${SONGS}`, `netease-block-${FRESH}`, 'netease-daily-playlists', 'netease-charts']);
        expect(page.sections[4].items[0]).toMatchObject({ kind: 'collection', collection: { type: 'playlist', id: 31, playCount: 9, creator: { nickname: 'Maker' } } });

        // A session NetEase no longer takes: an answer with a code and no list.
        api.getDailyRecommendedSongs.mockResolvedValue({ code: 301, songs: [] });
        api.getDailyRecommendedPlaylists.mockResolvedValue({ code: 301 });
        expect(idsOf((await newExplore().getFeed()).sections)).toEqual([`netease-block-${LISTS}`, `netease-block-${SONGS}`, `netease-block-${FRESH}`, 'netease-charts']);
    });

    it('still gives the page when the home blocks cannot be read, and fails when nothing can', async () => {
        api.getHomeBlocks.mockRejectedValue(new TypeError('Failed to fetch'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(idsOf((await newExplore().getFeed()).sections)).toEqual(['netease-charts']);
        api.getToplists.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(newExplore().getFeed()).rejects.toThrow('Failed to fetch');
    });

    // (Until 2026-10-09 a home shelf had a cursor that asked the home page again and took what
    // stood under the shelf's heading and was not handed out. Measured that day: NetEase answers
    // one block under another heading every time and another with the same entries, so those
    // cursors brought nothing, and the lists' cursors kept the page from being read anew. This
    // test was of that cursor; it is now of what the read anew gives the shelf.)
    it('says that a refresh reads the page anew, gives a shelf of no more than a batch no cursor, and gives a home shelf what NetEase has under its block in the read anew, whatever its heading', async () => {
        const explore = newExplore();
        const first = await explore.getFeed();
        expect(first.refreshReadsAnew).toBe(true);
        expect(first.sections.filter(section => section.moreCursor !== undefined)).toEqual([]);

        // NetEase's next pick: one playlist it gave before and one it did not; the songs under another heading.
        const [, second] = guestBlocks()[0].creatives;
        api.getHomeBlocks.mockImplementation(async () => homeOf([
            block(LISTS, '推荐歌单', [second.resources, [listEntry('999', 'Another list', 'another', 5)]]),
            block(SONGS, '猜你喜欢的「华语」好歌', [[songEntry(41, 'Another song', [[5, 'Singer']], [6, 'Album'], 'song', 1000, { fee: 0, st: 0, pl: 320000 })]]),
        ]));
        const log = vi.mocked(console.log);
        log.mockClear();
        const [lists, songs] = (await explore.getFeed()).sections;
        // The same shelves; the playlist not handed out before comes first.
        expect([lists.id, songs.id]).toEqual([`netease-block-${LISTS}`, `netease-block-${SONGS}`]);
        expect(entryIds(lists.items)).toEqual([999, 12250090837]);
        expect(songs.title).toBe('猜你喜欢的「华语」好歌');
        expect(entryIds(songs.items)).toEqual([41]);
        // One line a shelf: how many of its entries the read before did not have. (The five charts are the same five.)
        const lines = log.mock.calls.map(([line]) => String(line)).filter(line => line.startsWith('[Netease] Explore refresh: '));
        expect(lines).toEqual(expect.arrayContaining([
            `[Netease] Explore refresh: netease-block-${LISTS} 1/2`,
            `[Netease] Explore refresh: netease-block-${SONGS} 1/1`,
            '[Netease] Explore refresh: netease-charts 0/5',
        ]));
        expect(lines).toHaveLength(3);
    });

    it('answers a cursor of a read before with nothing, and asks NetEase nothing for it', async () => {
        api.getToplists.mockResolvedValue(chartsOf(30));
        api.getSimilarSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewAlbums.mockImplementation(albumsOf(500));
        const explore = newExplore();
        const before = await explore.getFeed();
        const albumsBefore = (await explore.getFeed(before.nextCursor)).sections[0];
        expect(albumsBefore.id).toBe('netease-new-albums');
        await explore.getFeed();
        const asked = () => [api.getHomeBlocks, api.getToplists, api.getNewAlbums].map(mock => mock.mock.calls.length);
        const requests = asked();
        expect(await explore.getFeed(before.nextCursor)).toEqual({ sections: [] });
        // A shelf's cursor: of a list the read before held, and of a list read a batch at a time.
        expect(await explore.getSectionItems!(before.sections.find(section => section.id === 'netease-charts')!.moreCursor!)).toEqual({ items: [] });
        expect(await explore.getSectionItems!(albumsBefore.moreCursor!)).toEqual({ items: [] });
        expect(asked()).toEqual(requests);
    });

    // (Until 2026-10-09 a refresh took the batches after a list's first through the shelf's
    // cursor, at most four a read. Now a read hands out one batch, and the next read the one
    // after it; the cursor is there, for the shelf's "more".)
    it('hands a list read whole out a batch a read: ten reads in a row never repeat an entry of the read before, and the first entries come again after the last', async () => {
        // (As many as an account's daily songs are.)
        api.getToplists.mockResolvedValue(chartsOf(30));
        const explore = newExplore();
        const batches: Array<Array<string | number>> = [];
        for (let read = 0; read < 10; read += 1) {
            const charts = (await explore.getFeed()).sections.find(section => section.id === 'netease-charts')!;
            expect(charts.moreCursor).toBeTruthy();
            batches.push(entryIds(charts.items));
        }
        const from = (start: number, count: number) => Array.from({ length: count }, (_, index) => 1000 + start + index);
        expect(batches[0]).toEqual(from(0, 12));
        expect(batches[1]).toEqual(from(12, 12));
        // The six left, and with them the six handed out longest ago.
        expect(batches[2]).toEqual([...from(24, 6), ...from(0, 6)]);
        expect(batches[3]).toEqual(from(6, 12));
        batches.slice(1).forEach((batch, index) => {
            expect(batch).toHaveLength(12);
            expect(batch.filter(id => batches[index].includes(id))).toEqual([]);
        });
        expect(api.getToplists).toHaveBeenCalledTimes(10);
    });

    it('hands a list of no more than a batch out as it is in every read; once it holds thirteen, the entries not handed out yet come first, and in the read after that the one entry that batch left, with eleven of that batch after it', async () => {
        api.getToplists.mockResolvedValueOnce(chartsOf(5)).mockResolvedValueOnce(chartsOf(5)).mockResolvedValue(chartsOf(13));
        const explore = newExplore();
        const chartsIn = async () => entryIds((await explore.getFeed()).sections.find(section => section.id === 'netease-charts')!.items);
        expect(await chartsIn()).toEqual([1000, 1001, 1002, 1003, 1004]);
        expect(await chartsIn()).toEqual([1000, 1001, 1002, 1003, 1004]);
        // NetEase has thirteen now: the eight not handed out yet, then four of the five.
        expect(await chartsIn()).toEqual([1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1000, 1001, 1002, 1003]);
        // The one that batch left, then that batch in the order it was handed out: another batch than the one before.
        expect(await chartsIn()).toEqual([1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1000, 1001, 1002]);
    });

    it('shows more of a list read whole with "more": a batch a press, no entry twice, to the end of the list; the read after begins with what was not shown', async () => {
        api.getToplists.mockResolvedValue(chartsOf(30));
        const explore = newExplore();
        const chartsIn = async () => (await explore.getFeed()).sections.find(section => section.id === 'netease-charts')!;
        const first = await chartsIn();
        expect(entryIds(first.items)).toEqual(idsFrom(1000, 12));
        const log = vi.mocked(console.log);
        log.mockClear();
        const more = await explore.getSectionItems!(first.moreCursor!);
        expect(entryIds(more.items)).toEqual(idsFrom(1012, 12));
        expect(more.moreCursor).toBeTruthy();
        // (One line, of ids and counts. The read holds the list: NetEase is not asked.)
        expect(log.mock.calls.map(([line]) => String(line))).toEqual(['[Netease] Explore shelf netease-charts: 12 further entries from place 12, 6 after them']);
        expect(api.getToplists).toHaveBeenCalledTimes(1);

        // The read after: the six that were not shown, then the six shown longest ago. Six of the twelve are new to the listener.
        const second = await chartsIn();
        expect(entryIds(second.items)).toEqual([...idsFrom(1024, 6), ...idsFrom(1000, 6)]);
        expect(refreshLines()).toContain('[Netease] Explore refresh: netease-charts 6/12');
        // Its "more" goes through the rest of the list in that order, and ends with it.
        const rest = await explore.getSectionItems!(second.moreCursor!);
        expect(entryIds(rest.items)).toEqual(idsFrom(1006, 12));
        const last = await explore.getSectionItems!(rest.moreCursor!);
        expect(entryIds(last.items)).toEqual(idsFrom(1018, 6));
        expect(last.moreCursor).toBeUndefined();
        // All of it was shown in that read: the next begins with what that read showed first.
        expect(entryIds((await chartsIn()).items)).toEqual([...idsFrom(1024, 6), ...idsFrom(1000, 6)]);
    });

    it('forgets what the shelves handed out when a read is for an account and the one before was for a guest', async () => {
        api.getToplists.mockResolvedValue(chartsOf(30));
        const explore = newExplore();
        const chartsIn = async () => entryIds((await explore.getFeed()).sections.find(section => section.id === 'netease-charts')!.items);
        expect(await chartsIn()).toEqual(idsFrom(1000, 12));
        expect(await chartsIn()).toEqual(idsFrom(1012, 12));
        expect(refreshLines().length).toBeGreaterThan(0);
        // Signed in since: the list starts over, and no line counts the account's shelves against the guest's.
        api.hasAccountSession.mockReturnValue(true);
        vi.mocked(console.log).mockClear();
        expect(await chartsIn()).toEqual(idsFrom(1000, 12));
        expect(refreshLines()).toEqual([]);
        // The same account in the read after: on from there.
        expect(await chartsIn()).toEqual(idsFrom(1012, 12));
    });

    it("keeps a part of a guest's read that arrives after an account's read has begun out of what the account's shelves remember", async () => {
        api.getSimilarSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewAlbums.mockImplementation(albumsOf(50));
        const explore = newExplore();
        const guest = await explore.getFeed();
        // The guest's new albums are still on their way when the listener signs in.
        let arrive = () => {};
        api.getNewAlbums.mockImplementationOnce((limit: number, offset: number) => new Promise(resolve => { arrive = () => resolve(albumsOf(50)(limit, offset)); }));
        const late = explore.getFeed(guest.nextCursor);
        await vi.waitFor(() => expect(api.getNewAlbums).toHaveBeenCalledTimes(1));
        api.hasAccountSession.mockReturnValue(true);
        const account = await explore.getFeed();
        arrive();
        expect((await late).sections).toEqual([]);
        vi.mocked(console.log).mockClear();
        // The account's first read of the list begins at its start and is counted against nothing.
        const albums = (await explore.getFeed(account.nextCursor)).sections[0];
        expect(entryIds(albums.items)).toEqual(idsFrom(9000, 12));
        expect(refreshLines()).toEqual([]);
    });

    it('does not keep a home shelf on its first batch when NetEase answers the same and the block holds more', async () => {
        // (Made up: a guest's blocks held no more than a batch. The same thirty playlists in every answer.)
        const thirty = Array.from({ length: 30 }, (_, index) => listEntry(String(300 + index), `List ${index}`, 'list', 1));
        api.getHomeBlocks.mockImplementation(async () => homeOf([block(LISTS, '推荐歌单', [thirty.slice(0, 15), thirty.slice(15)]), guestBlocks()[2]]));
        const explore = newExplore();
        const batches: Array<Array<string | number>> = [];
        const fresh: Array<Array<string | number>> = [];
        for (let read = 0; read < 10; read += 1) {
            const [lists, newest] = (await explore.getFeed()).sections;
            batches.push(entryIds(lists.items));
            fresh.push(entryIds(newest.items));
        }
        expect(batches[0]).toEqual(Array.from({ length: 12 }, (_, index) => 300 + index));
        expect(batches[1]).toEqual(Array.from({ length: 12 }, (_, index) => 312 + index));
        batches.slice(1).forEach((batch, index) => {
            expect(batch).toHaveLength(12);
            expect(batch.filter(id => batches[index].includes(id))).toEqual([]);
        });
        // Every playlist was handed out before the first came again.
        expect(new Set(batches.slice(0, 3).flat()).size).toBe(30);
        // The block of four entries is the same four every time.
        fresh.forEach(batch => expect(batch).toEqual([3440552022, 3437948530, 397805510, 397921409]));
    });

    it("goes on, after NetEase's page, with shelves made here: songs like the ones played, each song on one shelf, then the paged lists", async () => {
        // (As NetEase does: five songs, the same whatever offset is asked for. Two songs share one of theirs.)
        api.getSimilarSongs.mockImplementation(async (id: number) => ({ code: 200, songs: [oldSong(7), ...[1, 2, 3, 4].map(place => oldSong(id * 10 + place))] }));
        api.getNewSongs.mockResolvedValue({ code: 200, songs: Array.from({ length: 30 }, (_, index) => oldSong(500 + index)) });
        // (`type` is the kind of release in this list.)
        api.getNewAlbums.mockImplementation(async (limit: number, offset: number) => ({
            code: 200, total: 500, albums: Array.from({ length: limit }, (_, index) => ({ id: 9000 + offset + index, name: `Album ${offset + index}`, type: '专辑', size: 10, picUrl: 'https://p3.music.126.net/a.jpg', artists: [{ id: 5, name: 'Singer' }] })),
        }));
        const played = { id: 11, name: 'Played here', sourceRef: { kind: 'online', providerId: 'netease', mediaId: '11' } } as UnifiedSong;
        const uploaded = { id: 12, name: 'Uploaded', sourceRef: { kind: 'online', providerId: 'netease', mediaId: '12', variant: 'cloud' } } as UnifiedSong;
        const explore = newExplore();
        const first = await explore.getFeed(undefined, [played, uploaded]);

        const similar = await explore.getFeed(first.nextCursor);
        // Asked with the song played, then with the songs of the home page; not with the uploaded one.
        expect(api.getSimilarSongs.mock.calls.map(([id]) => id)).toEqual([11, 3392959216, 19827042]);
        expect(similar.sections).toHaveLength(3);
        expect(similar.sections[0]).toMatchObject({ title: i18n.t('home.exploreSimilar', { name: 'Played here' }), changesWithRead: true });
        expect(entryIds(similar.sections[0].items)).toEqual([7, 111, 112, 113, 114]);
        expect(entryIds(similar.sections[1].items)).not.toContain(7);
        expect(new Set(idsOf(similar.sections)).size).toBe(3);
        // (NetEase has the same five for a song whatever offset is asked with: a shelf has no cursor, and the song is asked with once.)
        expect(similar.sections.filter(section => section.moreCursor !== undefined)).toEqual([]);
        expect(api.getSimilarSongs).toHaveBeenCalledTimes(3);

        const lists = await explore.getFeed(similar.nextCursor);
        expect(idsOf(lists.sections)).toEqual(['netease-new-songs', 'netease-new-albums']);
        expect(lists.sections[0].items).toHaveLength(12);
        expect(lists.sections[1].items[0]).toMatchObject({ kind: 'collection', collection: { type: 'album', id: 9000 } });
        // (Both lists go on beyond the batch shown: each shelf has a cursor, for its "more".)
        expect(lists.sections.map(section => Boolean(section.moreCursor))).toEqual([true, true]);
        expect(lists.nextCursor).toBeTruthy();

        // (Until 2026-10-09 a refresh took the next batch of albums through the shelf's cursor. Now the next read has it.)
        // The read anew: other songs are asked with, and the lists go on where they stopped.
        const again = await explore.getFeed(undefined, [played, uploaded]);
        const similarAgain = await explore.getFeed(again.nextCursor);
        expect(api.getSimilarSongs.mock.calls.slice(3).map(([id]) => id)).toEqual([17282443, 27158959, 3440552022]);
        expect(similarAgain.sections).toHaveLength(3);
        expect(idsOf(similarAgain.sections).filter(id => idsOf(similar.sections).includes(id))).toEqual([]);
        const listsAgain = await explore.getFeed(similarAgain.nextCursor);
        expect(entryIds(listsAgain.sections[0].items)).toEqual(Array.from({ length: 12 }, (_, index) => 512 + index));
        expect(api.getNewAlbums).toHaveBeenLastCalledWith(12, 12);
        expect(entryIds(listsAgain.sections[1].items)[0]).toBe(9012);
    });

    it('goes through a list read a batch at a time from one read to the next, and starts it over after its last batch', async () => {
        api.getSimilarSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewSongs.mockResolvedValue({ code: 200, songs: [] });
        // (Thirty albums in all.)
        api.getNewAlbums.mockImplementation(async (limit: number, offset: number) => ({
            code: 200, total: 30, albums: Array.from({ length: Math.max(0, Math.min(limit, 30 - offset)) }, (_, index) => ({ id: 9000 + offset + index, name: `Album ${offset + index}`, picUrl: 'https://p3.music.126.net/a.jpg', artists: [{ id: 5, name: 'Singer' }] })),
        }));
        const explore = newExplore();
        const batches: Array<Array<string | number>> = [];
        const cursors: boolean[] = [];
        for (let read = 0; read < 10; read += 1) {
            const albums = (await explore.getFeed((await explore.getFeed()).nextCursor)).sections[0];
            expect(albums).toMatchObject({ id: 'netease-new-albums' });
            cursors.push(Boolean(albums.moreCursor));
            batches.push(entryIds(albums.items));
        }
        expect(batches.slice(0, 4).map(batch => [batch[0], batch.length])).toEqual([[9000, 12], [9012, 12], [9024, 6], [9000, 12]]);
        // (A cursor, for "more", where the list goes on after the batch: not after its last.)
        expect(cursors.slice(0, 4)).toEqual([true, true, false, true]);
        batches.slice(1).forEach((batch, index) => expect(batch.filter(id => batches[index].includes(id))).toEqual([]));
        // One request a read.
        expect(api.getNewAlbums).toHaveBeenCalledTimes(10);
    });

    it('shows more of a list read a batch at a time with "more": the batch after the last one shown, to the end of the list; the read after goes on after what was shown', async () => {
        api.getSimilarSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewSongs.mockResolvedValue({ code: 200, songs: [] });
        // (Fifty albums in all.)
        api.getNewAlbums.mockImplementation(albumsOf(50));
        const explore = newExplore();
        const albumsIn = async () => (await explore.getFeed((await explore.getFeed()).nextCursor)).sections[0];
        const first = await albumsIn();
        expect(entryIds(first.items)).toEqual(idsFrom(9000, 12));
        const log = vi.mocked(console.log);
        log.mockClear();
        const more = await explore.getSectionItems!(first.moreCursor!);
        expect(api.getNewAlbums).toHaveBeenLastCalledWith(12, 12);
        expect(entryIds(more.items)).toEqual(idsFrom(9012, 12));
        expect(log.mock.calls.map(([line]) => String(line))).toEqual(['[Netease] Explore shelf netease-new-albums: 12 further entries from place 12']);

        // The read after goes on after what "more" showed; all twelve are new to the listener.
        const second = await albumsIn();
        expect(api.getNewAlbums).toHaveBeenLastCalledWith(12, 24);
        expect(entryIds(second.items)).toEqual(idsFrom(9024, 12));
        expect(refreshLines()).toContain('[Netease] Explore refresh: netease-new-albums 12/12');
        // "More" to the end of the list: the cursor ends with it.
        const third = await explore.getSectionItems!(second.moreCursor!);
        expect(entryIds(third.items)).toEqual(idsFrom(9036, 12));
        log.mockClear();
        const last = await explore.getSectionItems!(third.moreCursor!);
        expect(entryIds(last.items)).toEqual([9048, 9049]);
        expect(last.moreCursor).toBeUndefined();
        expect(log.mock.calls.map(([line]) => String(line))).toEqual(['[Netease] Explore shelf netease-new-albums: 2 further entries from place 48, the last of the list']);
        // The list was shown to its end: the next read starts it over.
        expect(entryIds((await albumsIn()).items)).toEqual(idsFrom(9000, 12));
    });

    it("follows NetEase's token to the further home blocks, keeps one shelf of a block, and ends with the charts' songs and the playlists", async () => {
        // (A guest's page named no further blocks: the token and the block after it are made up.)
        api.getHomeBlocks.mockImplementation(async (cursor?: string) => (cursor
            ? homeOf([guestBlocks()[0], block('HOMEPAGE_BLOCK_MGC_PLAYLIST', '雷达歌单', [[listEntry('555', 'Radar', 'radar', 3)]])])
            : homeOf(guestBlocks(), { cursor: '{"offset":3}', hasMore: true })));
        api.getSimilarSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewSongs.mockResolvedValue({ code: 200, songs: [] });
        api.getNewAlbums.mockResolvedValue({ code: 200, total: 0, albums: [] });
        api.getPlaylistTracks.mockImplementation(async (id: number, limit: number, offset: number) => ({
            code: 200, songs: Array.from({ length: limit }, (_, index) => oldSong(id * 1000 + offset + index)),
        }));
        api.getHotPlaylists.mockResolvedValue({ code: 200, more: false, total: 1, playlists: [{ id: 71, name: 'Hot', coverImgUrl: 'https://p3.music.126.net/h.jpg', playCount: 4, creator: { userId: 7, nickname: 'Maker' } }] });
        const explore = newExplore();
        const first = await explore.getFeed();

        const further = await explore.getFeed(first.nextCursor);
        expect(api.getHomeBlocks).toHaveBeenLastCalledWith('{"offset":3}');
        // The block that stands already is not a second shelf; a shelf of one entry has no cursor.
        expect(idsOf(further.sections)).toEqual(['netease-block-HOMEPAGE_BLOCK_MGC_PLAYLIST']);
        expect(further.sections[0].moreCursor).toBeUndefined();

        // No song like the ones asked with, no new song or album: the list goes on to the charts NetEase marks as its own.
        const charts = await explore.getFeed(further.nextCursor);
        expect(idsOf(charts.sections)).toEqual(['netease-chart-1000', 'netease-chart-1001']);
        expect(charts.sections[0].title).toBe('榜 0');
        expect(entryIds(charts.sections[0].items)[0]).toBe(1000000);
        // (The chart has songs after these twelve: a cursor, for "more".)
        expect(charts.sections[0].moreCursor).toBeTruthy();

        const playlists = await explore.getFeed(charts.nextCursor);
        expect(idsOf(playlists.sections)).toEqual(['netease-hot-playlists']);
        expect(playlists.sections[0].moreCursor).toBeUndefined();
        expect(playlists.nextCursor).toBeUndefined();

        // (Until 2026-10-09 a refresh took a chart's next songs through its shelf's cursor. Now the next read has them.)
        const again = await explore.getFeed();
        const chartsAgain = await explore.getFeed((await explore.getFeed(again.nextCursor)).nextCursor);
        expect(entryIds(chartsAgain.sections[0].items)[0]).toBe(1000012);
        expect(api.getPlaylistTracks).toHaveBeenCalledWith(1000, 12, 12);
    });

    it('passes over further home pages that have nothing to show, within the one read', async () => {
        // (Made up: three pages in a row repeat a block that stands already, the fourth brings a new one.)
        const repeated = (next: string) => homeOf([guestBlocks()[0]], { cursor: next, hasMore: true });
        const pages: Record<string, unknown> = {
            a: repeated('b'), b: repeated('c'), c: repeated('d'),
            d: homeOf([block('HOMEPAGE_BLOCK_MGC_PLAYLIST', '雷达歌单', [[listEntry('555', 'Radar', 'radar', 3)]])]),
        };
        api.getHomeBlocks.mockImplementation(async (cursor?: string) => (cursor ? pages[cursor] : homeOf(guestBlocks(), { cursor: 'a', hasMore: true })));
        const explore = newExplore();
        const first = await explore.getFeed();

        const further = await explore.getFeed(first.nextCursor);
        expect(idsOf(further.sections)).toEqual(['netease-block-HOMEPAGE_BLOCK_MGC_PLAYLIST']);
        expect(api.getHomeBlocks).toHaveBeenCalledTimes(5);
        expect(further.nextCursor).toBeTruthy();
    });
});
