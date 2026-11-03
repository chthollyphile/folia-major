import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OmniExploreItem, OmniExploreSection, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/neteaseExploreRefresh.test.ts
// NetEase's explore page behind the explore tab's own store: what ten presses on "refresh" in a
// row show, shelf by shelf, and what a shelf's "more" shows. The NetEase service is faked. Its lists are as long as the ones
// measured (2026-10-09, as a guest), and its home page behaves as the one a guest was answered
// did: one block picked anew under another heading in every answer, the others the same every
// time (here one of thirty entries, which is made up, and one of four).

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
vi.mock('@/services/onlineMusic/netease/netease', () => ({ neteaseApi: api }));
const omni = vi.hoisted(() => ({ getExploreFeed: vi.fn(), getExploreSectionItems: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni }));
import { createNeteaseExplore } from '@/services/onlineMusic/netease/neteaseExplore';
import { resetExploreMemory } from '@/components/app/home/explore/exploreFeedMemory';
import { useExploreFeedStore } from '@/stores/useExploreFeedStore';

const LISTS = 'HOMEPAGE_BLOCK_PLAYLIST_RCMD';
const SONGS = 'HOMEPAGE_BLOCK_STYLE_RCMD';
const FRESH = 'HOMEPAGE_BLOCK_NEW_ALBUM_NEW_SONG';

const row = (id: number) => ({ id, name: `Entry ${id}` });
const rows = (first: number, count: number) => Array.from({ length: Math.max(0, count) }, (_, index) => row(first + index));
const entry = (resourceType: string, id: number, info: Record<string, unknown> = {}) => ({
    resourceType, resourceId: String(id), uiElement: { mainTitle: { title: `Entry ${id}` } }, resourceExtInfo: info,
});
const block = (blockCode: string, title: string, resources: unknown[]) => ({ blockCode, uiElement: { subTitle: { title } }, creatives: [{ resources }] });
// The home page as its `asks`-th answer has it.
const homeOf = (asks: number) => ({
    code: 200,
    data: {
        hasMore: false,
        cursor: null,
        blocks: [
            block(LISTS, '推荐歌单', rows(300, 30).map(list => entry('list', list.id))),
            block(SONGS, `猜你喜欢的「风格 ${asks}」好歌`, rows(50000 + asks * 100, 12).map(track => entry('song', track.id, { songData: track }))),
            block(FRESH, '新歌新碟', rows(700, 4).map(album => entry('album', album.id))),
        ],
    },
});

const song = (raw: any): UnifiedSong => ({ id: raw.id, name: raw.name, artists: [], album: { id: 0, name: '', coverUrl: '' } }) as unknown as UnifiedSong;
const collection = (raw: any, type = 'playlist'): ProviderCollection => ({ providerId: 'netease', type, id: raw.id, name: raw.name }) as unknown as ProviderCollection;

const store = () => useExploreFeedStore.getState();
const feed = () => store().feed!;
const settled = () => vi.waitFor(() => expect(feed().status === 'ready' && !feed().refreshing).toBe(true), { interval: 1 });
const nameOf = (item: OmniExploreItem) => (item.kind === 'song' ? `song:${item.song.id}` : `${item.collection.type}:${item.collection.id}`);
const namesOf = (section: OmniExploreSection) => section.items.map(nameOf);
const linesOf = (prefix: string) => vi.mocked(console.log).mock.calls.map(([line]) => String(line)).filter(line => line.startsWith(prefix));

describe("NetEase explore page behind the explore tab's store", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        store().clear();
        resetExploreMemory();
        let homeAsks = 0;
        api.hasAccountSession.mockReturnValue(true);
        api.getHomeBlocks.mockImplementation(async () => homeOf(++homeAsks));
        api.getDailyRecommendedSongs.mockImplementation(async () => ({ code: 200, songs: rows(100, 30) }));
        api.getDailyRecommendedPlaylists.mockImplementation(async () => ({ code: 200, recommend: rows(200, 8) }));
        api.getToplists.mockImplementation(async () => ({ code: 200, list: rows(1000, 63).map((chart, index) => ({ ...chart, ...(index < 4 ? { ToplistType: 'S' } : {}) })) }));
        api.getSimilarSongs.mockImplementation(async (id: number) => ({ code: 200, songs: rows(id * 10 + 1, 5) }));
        api.getNewSongs.mockImplementation(async () => ({ code: 200, songs: rows(20000, 100) }));
        api.getNewAlbums.mockImplementation(async (limit: number, offset: number) => ({ code: 200, total: 500, albums: rows(30000 + offset, Math.min(limit, 500 - offset)) }));
        api.getHotPlaylists.mockImplementation(async (limit: number, offset: number) => ({ code: 200, total: 683, more: offset + limit < 683, playlists: rows(40000 + offset, Math.min(limit, 683 - offset)) }));
        api.getPlaylistTracks.mockImplementation(async (id: number, limit: number, offset: number) => ({ code: 200, songs: rows(id * 1000 + offset, Math.min(limit, 100 - offset)) }));
        const explore = createNeteaseExplore({ song, collection });
        omni.getExploreFeed.mockImplementation((cursor?: string, listened?: UnifiedSong[]) => explore.getFeed(cursor, listened));
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => (await explore.getSectionItems?.(cursor)) ?? { items: [] });
    });

    it('shows other entries in every shelf NetEase has more for on each of ten refreshes in a row, and leaves a shelf of one batch as it is', async () => {
        store().show('netease:me:zh-CN');
        await settled();
        // The list read to its end, as a listener who scrolled down has it.
        for (let pages = 0; feed().nextCursor && pages < 10; pages += 1) await store().loadMore();
        expect(feed().nextCursor).toBeUndefined();
        const ids = feed().sections.map(section => section.id);
        // The first page's six, nine shelves of similar songs, the new songs and albums, the four charts' songs, the playlists.
        expect(ids).toHaveLength(22);
        expect(ids.filter(id => id.startsWith('netease-similar-'))).toHaveLength(9);
        const same = new Set([`netease-block-${FRESH}`, 'netease-daily-playlists']);
        // The shelves whose list goes on beyond the batch shown have a cursor, for "more". (A chart's
        // hundred songs, twelve a read: the ninth read has the last four, and nothing after them.)
        const longer = new Set(['netease-daily-songs', `netease-block-${LISTS}`, 'netease-charts', 'netease-new-songs', 'netease-new-albums', 'netease-hot-playlists']);
        const hasMore = (id: string, press: number) => longer.has(id) || (id.startsWith('netease-chart-') && press !== 8);
        expect(feed().sections.filter(section => section.moreCursor !== undefined).map(section => section.id)).toEqual(ids.filter(id => hasMore(id, 0)));
        const dailySongs = () => namesOf(feed().sections.find(section => section.id === 'netease-daily-songs')!);
        const daily = [dailySongs()];

        for (let press = 1; press <= 10; press += 1) {
            const before = feed().sections;
            vi.mocked(console.log).mockClear();
            store().refresh();
            await settled();
            const now = feed().sections;
            // No shelf leaves the page or moves; the page was read anew, and the same shelves have a cursor.
            expect(now.map(section => section.id)).toEqual(ids);
            expect(now.filter(section => section.moreCursor !== undefined).map(section => section.id), `refresh ${press}`).toEqual(ids.filter(id => hasMore(id, press)));
            now.forEach((section, at) => {
                const shared = namesOf(section).filter(name => namesOf(before[at]).includes(name));
                if (same.has(section.id)) expect(namesOf(section), `${section.id}, refresh ${press}`).toEqual(namesOf(before[at]));
                else {
                    expect(shared, `${section.id}, refresh ${press}`).toEqual([]);
                    expect(section.items.length, `${section.id}, refresh ${press}`).toBeGreaterThan(0);
                }
            });
            // The block NetEase picks anew, and the shelves of similar songs, stand under other headings.
            const retitled = now.filter((section, at) => section.title !== before[at].title).map(section => section.id);
            expect(retitled).toEqual(ids.filter(id => id === `netease-block-${SONGS}` || id.startsWith('netease-similar-')));
            // What the store and the adapter log of it: twenty shelves with other entries, and a line a shelf.
            expect(linesOf('[Explore] Refresh ')).toEqual([expect.stringMatching(/^\[Explore\] Refresh \d+: 22 sections, 20 with other entries$/)]);
            const lines = linesOf('[Netease] Explore refresh: ');
            expect(lines).toHaveLength(22);
            expect(lines).toEqual(expect.arrayContaining([
                '[Netease] Explore refresh: netease-daily-songs 12/12',
                `[Netease] Explore refresh: netease-block-${LISTS} 12/12`,
                `[Netease] Explore refresh: netease-block-${SONGS} 12/12`,
                `[Netease] Explore refresh: netease-block-${FRESH} 0/4`,
                '[Netease] Explore refresh: netease-daily-playlists 0/8',
                '[Netease] Explore refresh: netease-charts 12/12',
                '[Netease] Explore refresh: netease-new-songs 12/12',
                '[Netease] Explore refresh: netease-hot-playlists 12/12',
            ]));
            expect(lines.filter(line => /netease-similar-\d+ 5\/5$/.test(line))).toHaveLength(9);
            daily.push(dailySongs());
        }
        // No refresh went through a shelf's cursor.
        expect(omni.getExploreSectionItems).not.toHaveBeenCalled();
        // The thirty daily songs, twelve at a time: all of them were shown before any came again.
        expect(daily.every(batch => batch.length === 12)).toBe(true);
        expect(new Set(daily.slice(0, 3).flat()).size).toBe(30);
    });

    it('shows more of a shelf with "more" and exchanges nothing for it; the refresh after shows a batch again, beginning with what "more" did not show', async () => {
        store().show('netease:me:zh-CN');
        await settled();
        const DAILY = 'netease-daily-songs';
        const PICKED = `netease-block-${LISTS}`;
        const shelf = (id: string) => feed().sections.find(section => section.id === id)!;
        const songs = (first: number, count: number) => rows(first, count).map(track => `song:${track.id}`);
        const lists = (first: number, count: number) => rows(first, count).map(list => `playlist:${list.id}`);
        const others = () => feed().sections.filter(section => section.id !== DAILY && section.id !== PICKED);
        const before = others();
        expect(namesOf(shelf(DAILY))).toEqual(songs(100, 12));

        // A press on each: the next batch of the same list joins the ones shown.
        vi.mocked(console.log).mockClear();
        await store().loadMoreOf(DAILY);
        await store().loadMoreOf(PICKED);
        expect(namesOf(shelf(DAILY))).toEqual(songs(100, 24));
        expect(namesOf(shelf(PICKED))).toEqual(lists(300, 24));
        expect(linesOf('[Netease] Explore shelf ')).toEqual([
            `[Netease] Explore shelf ${DAILY}: 12 further entries from place 12, 6 after them`,
            `[Netease] Explore shelf ${PICKED}: 12 further entries from place 12, 6 after them`,
        ]);
        // Once more on the songs: all thirty are shown, and the shelf has no more to offer.
        await store().loadMoreOf(DAILY);
        expect(namesOf(shelf(DAILY))).toEqual(songs(100, 30));
        expect(shelf(DAILY).moreCursor).toBeUndefined();
        expect(shelf(PICKED).moreCursor).toBeTruthy();
        // No other shelf changed, and NetEase's page was not asked for.
        expect(others()).toEqual(before);
        expect(api.getHomeBlocks).toHaveBeenCalledTimes(1);

        vi.mocked(console.log).mockClear();
        store().refresh();
        await settled();
        expect(api.getHomeBlocks).toHaveBeenCalledTimes(2);
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(3);
        // The playlists: the six "more" did not show, then the six shown longest ago. The songs were all shown: from the first again.
        expect(namesOf(shelf(PICKED))).toEqual([...lists(324, 6), ...lists(300, 6)]);
        expect(namesOf(shelf(DAILY))).toEqual(songs(100, 12));
        expect(shelf(DAILY).moreCursor).toBeTruthy();
        // (The lines count against all the read before showed, "more" included.)
        expect(linesOf('[Netease] Explore refresh: ')).toEqual(expect.arrayContaining([
            `[Netease] Explore refresh: ${PICKED} 6/12`,
            `[Netease] Explore refresh: ${DAILY} 0/12`,
        ]));
    });
});
