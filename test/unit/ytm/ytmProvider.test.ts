import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmProvider.test.ts

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/ytm/ytmTransport', () => ({
    requestYtm: request, getYtmTransportAvailability: () => ({ configured: true }),
}));
import { ytmProvider } from '@/services/onlineMusic/ytm/ytmProvider';
import { noteYtmAccount, ytmHasPremium } from '@/services/onlineMusic/ytm/ytmAccount';
import { clearYtmCatalogCache } from '@/services/onlineMusic/ytm/ytmCatalog';
import { clearYtmLibraryCache } from '@/services/onlineMusic/ytm/ytmLibrary';
import { createYtmPager, normalizeYtmCollection, normalizeYtmSong, normalizeYtmUser } from '@/services/onlineMusic/ytm/ytmNormalize';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { OnlineProviderError } from '@/types/onlineMusic';
import i18n from '@/i18n/config';

const wireSong = (id = 'm9SMT5ipbxk', extra: Record<string, unknown> = {}) => ({
    id, name: 'アイドル', artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI' }],
    album: { id: 'MPREb_6h43ySO9duW', name: 'アイドル', coverUrl: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj' },
    durationMs: 214000, ...extra,
});
// A row as the signed-in playlist reader delivers it: names only, a video still for a cover.
const tileSong = (id = 'ZRtdQ81jPUQ') => wireSong(id, {
    artists: [{ id: '', name: 'YOASOBI' }], album: { id: '', name: '', coverUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
});
const ids = (count: number, from = 0) => Array.from({ length: count }, (_, index) => `row-${from + index}`);

beforeEach(() => {
    request.mockReset();
    clearYtmCatalogCache();
    clearYtmLibraryCache();
    noteYtmAccount(null);
});

describe('YouTube Music normalization', () => {
    it('gives a song a stable identity and catalog links only where an id is known', () => {
        const song = normalizeYtmSong(wireSong());
        expect(song).toMatchObject({
            id: 'm9SMT5ipbxk', name: 'アイドル', durationMs: 214000,
            sourceRef: { kind: 'online', providerId: 'ytm', mediaId: 'm9SMT5ipbxk' },
            artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI', catalogRef: { providerId: 'ytm', kind: 'artist', id: 'UCI6B8NkZKqlFWoiC_xE-hzA' } }],
            album: { id: 'MPREb_6h43ySO9duW', catalogRef: { providerId: 'ytm', kind: 'album', id: 'MPREb_6h43ySO9duW' } },
        });
        expect(getPlaybackSongKey(song)).toBe('online:ytm:m9SMT5ipbxk');
        expect(normalizeYtmSong(song)).toBe(song);

        const row = normalizeYtmSong(tileSong());
        expect(row.album).toMatchObject({ id: '', catalogRef: undefined });
        expect(row.artists).toEqual([{ id: '', name: 'YOASOBI', catalogRef: undefined }]);
        expect(() => normalizeYtmSong({})).toThrow('no id');
        expect(() => normalizeYtmSong(null)).toThrow('no id');
    });

    it('marks the liked-music list as the account\'s own and keeps an album\'s playlist id', () => {
        expect(normalizeYtmCollection({ id: 'LM', type: 'playlist', name: 'Liked Music', coverUrl: 'c', trackCount: 4, isLiked: true }))
            .toMatchObject({ providerId: 'ytm', id: 'LM', type: 'playlist', trackCount: 4, isLiked: true, isOwned: true });
        const playlist = normalizeYtmCollection({ id: 'PLfixture', type: 'playlist', name: 'Road', coverUrl: '' });
        expect(playlist).not.toHaveProperty('isLiked');
        expect(playlist).not.toHaveProperty('trackCount');
        const album = normalizeYtmCollection({ id: 'MPREb_x', name: 'Album', coverUrl: '', playlistId: 'OLAK5uy_x', year: 2021, artists: [{ id: '', name: 'Artist' }] }, 'album');
        expect(album).toMatchObject({ type: 'album', publishedAt: Date.UTC(2021, 0, 1), providerData: { playlistId: 'OLAK5uy_x' }, artists: [{ name: 'Artist' }] });
        expect(normalizeYtmCollection(album)).toBe(album);
        expect(() => normalizeYtmCollection({ name: 'x' })).toThrow('no id');
    });

    it('keeps only public account fields', () => {
        expect(normalizeYtmUser({ id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType: 1, email: 'private@example.test' }))
            .toEqual({ id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType: 1 });
    });
});

describe('YouTube Music paging by offset', () => {
    // 15 rows a page: fewer than a call past the first gathers.
    const source = (total: number) => vi.fn(async (continuation?: string) => {
        const start = continuation ? Number(continuation) : 0;
        const end = Math.min(start + 15, total);
        return { items: ids(end - start, start), ...(end < total ? { continuation: String(end) } : {}) };
    });

    it('answers the first page after one request and gathers follow-up pages into larger answers', async () => {
        const fetchPage = source(400);
        const pager = createYtmPager<string>();
        const first = await pager.page('list', 0, 50, fetchPage);
        expect(first).toEqual({ items: ids(15), nextOffset: 15, hasMore: true });
        expect(fetchPage).toHaveBeenCalledTimes(1);

        const second = await pager.page('list', first.nextOffset, 150, fetchPage);
        expect(second.items).toEqual(ids(105, 15));
        expect(second).toMatchObject({ nextOffset: 120, hasMore: true });
        expect(fetchPage).toHaveBeenCalledTimes(8);
    });

    it('reports the total and stops once the list ends', async () => {
        const fetchPage = source(40);
        const pager = createYtmPager<string>();
        await pager.page('list', 0, 50, fetchPage);
        const rest = await pager.page('list', 15, 1000, fetchPage);
        expect(rest).toEqual({ items: ids(25, 15), total: 40, nextOffset: 40, hasMore: false });
        expect(await pager.page('list', 40, 1000, fetchPage)).toEqual({ items: [], total: 40, nextOffset: 40, hasMore: false });
        expect(fetchPage).toHaveBeenCalledTimes(3);
    });

    it('replays the list for an offset it has no cursor for, as after a restart', async () => {
        const fetchPage = source(100);
        const resumed = await createYtmPager<string>().page('list', 30, 20, fetchPage);
        expect(resumed.items).toEqual(ids(20, 30));
        expect(resumed).toMatchObject({ nextOffset: 50, hasMore: true });
    });

    it('starts over when the first page is asked for again, and after the cursor sat idle', async () => {
        let time = 0;
        const fetchPage = source(100);
        const pager = createYtmPager<string>(() => time);
        await pager.page('list', 0, 15, fetchPage);
        await pager.page('list', 0, 15, fetchPage);
        expect(fetchPage.mock.calls.map(([continuation]) => continuation)).toEqual([undefined, undefined]);

        time += 6 * 60 * 1000;
        expect((await pager.page('list', 15, 15, fetchPage)).items).toEqual(ids(15, 15));
        // The stored token was not trusted after the pause: the walk began again from the top.
        expect(fetchPage.mock.calls.map(([continuation]) => continuation)).toEqual([undefined, undefined, undefined, '15']);
    });

    it('lets two readers of one list take turns instead of fetching the same page twice', async () => {
        const fetchPage = source(100);
        const pager = createYtmPager<string>();
        await pager.page('list', 0, 15, fetchPage);
        const [left, right] = await Promise.all([pager.page('list', 15, 15, fetchPage), pager.page('list', 15, 15, fetchPage)]);
        expect(left.items).toEqual(ids(15, 15));
        expect(right.items).toEqual(ids(15, 15));
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('keeps its place when a page fails and continues on the next call', async () => {
        const fetchPage = source(60);
        const pager = createYtmPager<string>();
        await pager.page('list', 0, 15, fetchPage);
        fetchPage.mockRejectedValueOnce(new Error('offline'));
        await expect(pager.page('list', 15, 15, fetchPage)).rejects.toThrow('offline');
        expect((await pager.page('list', 15, 15, fetchPage)).items).toEqual(ids(15, 15));
    });

    it('replays a long list to a deep offset, and fails rather than report a list it could not finish as ended', async () => {
        const fetchPage = source(1500);
        const page = await createYtmPager<string>().page('list', 1200, 50, fetchPage);
        expect(page).toMatchObject({ items: ids(50, 1200), nextOffset: 1250, hasMore: true });

        // A list that keeps answering with a new token and no rows: an empty page would mean "done" to a sync.
        let token = 0;
        const endless = vi.fn(async () => ({ items: [] as string[], continuation: `t${++token}` }));
        await expect(createYtmPager<string>().page('list', 30, 50, endless)).rejects.toMatchObject({ code: 'invalid-response' });
        expect(endless).toHaveBeenCalledTimes(400);
    });

    it('stops on a token that repeats rather than looping', async () => {
        const fetchPage = vi.fn(async () => ({ items: ['a'], continuation: 'same' }));
        const page = await createYtmPager<string>().page('list', 5, 100, fetchPage);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(page).toMatchObject({ items: [], total: 2, hasMore: false });
    });
});

describe('YouTube Music provider', () => {
    it('declares what it does and does not do', () => {
        expect(ytmProvider.capabilities).toMatchObject({
            search: true, playback: true, lyrics: true, auth: true, userLibrary: true, userAlbums: true,
            explore: true, mutations: true, playlistTrackMutations: true, playlistSubscription: true, wordByWordLyrics: false,
            // The radio tab: a personal FM and the music page's playlists (ytmRecommendations.test.ts).
            recommendations: true,
            // The heart, whoever is signed in.
            likes: true,
        });
        // Daily songs have no counterpart here: without the member the card is not offered.
        expect(ytmProvider.recommendations!.getDailySongs).toBeUndefined();
        // The quality option shows the two levels the audio differs at.
        expect(ytmProvider.playback!.audioQualityLevels).toEqual(['standard', 'high']);
        // A song is liked, and the liked songs are read.
        expect(ytmProvider.library!.getLikedSongIds).toBeTypeOf('function');
        expect(ytmProvider.mutations!.likeSong).toBeTypeOf('function');
        // Albums are saved, and playlists that are somebody else's.
        expect(ytmProvider.mutations!.subscribeAlbum).toBeTypeOf('function');
        expect(ytmProvider.mutations!.subscribePlaylist).toBeTypeOf('function');
    });

    it('likes a song by its id and takes the like back, and only a song of its own', async () => {
        request.mockResolvedValue(true);
        await ytmProvider.mutations!.likeSong!(normalizeYtmSong(wireSong()), true);
        expect(request).toHaveBeenLastCalledWith('song_like', { id: 'm9SMT5ipbxk', liked: 'true' });
        await ytmProvider.mutations!.likeSong!('ZRtdQ81jPUQ', false);
        expect(request).toHaveBeenLastCalledWith('song_like', { id: 'ZRtdQ81jPUQ', liked: 'false' });
        request.mockClear();
        const foreign = { ...normalizeYtmSong(wireSong()), sourceRef: { kind: 'online' as const, providerId: 'qq', mediaId: '1' } };
        await expect(ytmProvider.mutations!.likeSong!(foreign, true)).rejects.toMatchObject({ code: 'unsupported' });
        expect(request).not.toHaveBeenCalled();
    });

    it('reads the liked songs to the end of the liked list', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const likedIds = ytmProvider.library!.getLikedSongIds!;
        const pages: Record<string, unknown> = {
            '': { items: [wireSong('liked000001'), wireSong('liked000002')], continuation: 'rows-2' },
            'rows-2': { items: [wireSong('liked000003')], continuation: 'rows-3' },
            'rows-3': { items: [] },
        };
        request.mockImplementation(async (_operation: string, params: { continuation?: string }) => pages[params.continuation ?? '']);
        expect(await likedIds('user')).toEqual({ ids: ['liked000001', 'liked000002', 'liked000003'], whole: true });
        expect(request.mock.calls).toEqual([
            ['playlist', { id: 'LM', continuation: undefined }], ['playlist', { id: 'LM', continuation: 'rows-2' }], ['playlist', { id: 'LM', continuation: 'rows-3' }],
        ]);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Liked songs: 3 read in 3 request(s)');
        // A page that cannot be read fails the read: a list cut short would empty hearts that are full.
        request.mockReset().mockResolvedValueOnce(pages['']).mockRejectedValueOnce(new Error('offline'));
        await expect(likedIds('user')).rejects.toThrow('offline');
        log.mockRestore();
    });

    it('does not take a full page that names no next one for the end of the liked list', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const fullPage = Array.from({ length: 100 }, (_, index) => wireSong(`liked${String(index).padStart(6, '0')}`));
        request.mockResolvedValue({ items: fullPage });
        const read = await ytmProvider.library!.getLikedSongIds!('user');
        expect(read.ids).toHaveLength(100);
        expect(read.whole).toBe(false);
        log.mockRestore();
    });

    it('stops reading the liked songs after fifty requests, and on a token that repeats, and says both times that the list was not read whole', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let page = 0;
        request.mockImplementation(async () => ({ items: [wireSong(`liked${String(++page).padStart(6, '0')}`)], continuation: `rows-${page + 1}` }));
        const cut = await ytmProvider.library!.getLikedSongIds!('user');
        expect(cut.ids).toHaveLength(50);
        expect(cut.whole).toBe(false);
        expect(request).toHaveBeenCalledTimes(50);
        expect(warn).toHaveBeenCalledExactlyOnceWith('[Ytm] The liked list goes on after 50 requests: 50 songs were read, the hearts of the others stay as they were');

        request.mockReset().mockResolvedValue({ items: [wireSong('liked000001')], continuation: 'same' });
        expect(await ytmProvider.library!.getLikedSongIds!('user')).toEqual({ ids: ['liked000001', 'liked000001'], whole: false });
        expect(request).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenLastCalledWith('[Ytm] The liked list gave the same page token twice: 2 songs were read in 2 request(s), the hearts of the others stay as they were');
        log.mockRestore();
        warn.mockRestore();
    });

    it('turns the explore page into sections of songs and cards, each section told apart', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        request.mockResolvedValueOnce({ continuation: 'page-2', sections: [
            { title: 'For you', items: [{ kind: 'song', song: tileSong(), wideCoverUrl: 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/hqdefault.jpg' }] },
            { title: 'For you', items: [
                { kind: 'collection', collection: { id: 'UCartist0001', type: 'artist', name: 'An artist', coverUrl: '' } },
                { kind: 'collection', collection: { id: 'RDEMfixture', type: 'playlist', name: 'A mix', coverUrl: '', mix: true, videoId: 'm9SMT5ipbxk' }, wideCoverUrl: 'https://i.ytimg.com/vi/m9SMT5ipbxk/hqdefault.jpg' },
            ] },
        ] });
        const page = await ytmProvider.explore!.getFeed();
        expect(request).toHaveBeenLastCalledWith('explore', {});
        // (A cursor is YouTube's token with the number of the read it is of.)
        expect(page.nextCursor).toMatch(/^\d+:page-2$/);
        expect(page.sections.map(section => section.title)).toEqual(['For you', 'For you']);
        expect(new Set(page.sections.map(section => section.id)).size).toBe(2);
        expect(page.sections[0]).toMatchObject({ items: [{ kind: 'song', song: { id: 'ZRtdQ81jPUQ', sourceRef: { kind: 'online', providerId: 'ytm', mediaId: 'ZRtdQ81jPUQ' } } }] });
        // A shelf of YouTube's comes whole: it has no further entries to ask for.
        for (const section of page.sections) expect(section).not.toHaveProperty('moreCursor');
        // An entry's wide picture comes through as the page names it.
        expect(page.sections.flatMap(section => section.items).map(item => item.wideCoverUrl))
            .toEqual(['https://i.ytimg.com/vi/ZRtdQ81jPUQ/hqdefault.jpg', undefined, 'https://i.ytimg.com/vi/m9SMT5ipbxk/hqdefault.jpg']);
        expect(page.sections[1].items[0]).not.toHaveProperty('wideCoverUrl');
        expect(page.sections[1].items).toMatchObject([
            { kind: 'collection', collection: { providerId: 'ytm', id: 'UCartist0001', type: 'artist' } },
            { kind: 'collection', isMix: true, collection: { providerId: 'ytm', id: 'RDEMfixture', type: 'playlist', providerData: { mix: true, videoId: 'm9SMT5ipbxk' } } },
        ]);
        // Only a mix is marked as one.
        expect(page.sections.flatMap(section => section.items).filter(item => 'isMix' in item)).toHaveLength(1);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Explore page: 2 shelves, 3 entries; 0 shelves of the account\'s own listening left out');

        // (A further page asks for a song's radio beside it: here one with no songs, which makes no shelf.)
        request.mockResolvedValueOnce({ sections: [] }).mockResolvedValueOnce({ items: [] });
        expect(await ytmProvider.explore!.getFeed(page.nextCursor)).toEqual({ sections: [] });
        expect(request).toHaveBeenCalledWith('explore', { continuation: 'page-2' });
        log.mockRestore();
    });

    // A cursor stands until the page is next asked for from its start (ytmExplore.ts): the page
    // after a token of a read before would be answered against the shelves of the read that stands.
    it('answers a cursor of an earlier read of the explore page with nothing, and does not ask YouTube with it', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const shelf = { title: 'Albums', items: [{ kind: 'song', song: tileSong() }] };
        request.mockResolvedValueOnce({ continuation: 'from-place-4', sections: [shelf] });
        const first = await ytmProvider.explore!.getFeed();

        // The page is read from its start again: the cursor handed before is of a read that is gone.
        request.mockResolvedValueOnce({ continuation: 'from-place-4', sections: [shelf] });
        const second = await ytmProvider.explore!.getFeed();
        request.mockClear();
        expect(await ytmProvider.explore!.getFeed(first.nextCursor)).toEqual({ sections: [] });
        expect(request).not.toHaveBeenCalled();
        // The same token of the read that stands is asked with.
        expect(second.nextCursor).not.toBe(first.nextCursor);
        request.mockResolvedValueOnce({ sections: [], continuation: 'from-place-8' }).mockResolvedValueOnce({ items: [] });
        const further = await ytmProvider.explore!.getFeed(second.nextCursor);
        expect(request).toHaveBeenCalledWith('explore', { continuation: 'from-place-4' });

        // A read that fails counts too: it may have reached YouTube.
        request.mockRejectedValueOnce(new Error('offline'));
        await expect(ytmProvider.explore!.getFeed()).rejects.toThrow('offline');
        request.mockClear();
        expect(await ytmProvider.explore!.getFeed(further.nextCursor)).toEqual({ sections: [] });
        expect(request).not.toHaveBeenCalled();
    });

    it('asks for the explore page from its start one request at a time, and lets only the last one\'s cursor stand', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const shelf = { title: 'Albums', items: [{ kind: 'song', song: tileSong() }] };
        let answerFirst!: (value: unknown) => void;
        request.mockReturnValueOnce(new Promise(resolve => { answerFirst = resolve; })).mockResolvedValueOnce({ continuation: 'from-place-4', sections: [shelf] });
        const first = ytmProvider.explore!.getFeed();
        const second = ytmProvider.explore!.getFeed();
        // The second is not sent while the first is under way: YouTube could serve them in either order.
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        await new Promise(resolve => { setTimeout(resolve, 10); });
        expect(request).toHaveBeenCalledTimes(1);
        answerFirst({ continuation: 'from-place-4', sections: [shelf] });
        // The first is the shelves it says, with no cursor: the page is being asked for again.
        const overtaken = await first;
        expect(overtaken.sections.map(section => section.title)).toEqual(['Albums']);
        expect(overtaken).not.toHaveProperty('nextCursor');
        const page = await second;
        expect(request).toHaveBeenCalledTimes(2);
        expect(page.nextCursor).toMatch(/^\d+:from-place-4$/);
    });

    it('gives nothing for an answer that arrives after the explore page was asked for from its start again', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        request.mockResolvedValueOnce({ continuation: 'from-place-4', sections: [{ title: 'Albums', items: [{ kind: 'song', song: tileSong() }] }] });
        const first = await ytmProvider.explore!.getFeed();
        // Asked while the token stood; answered after the page was asked for from its start again: it may be of either read.
        let answerPage!: (value: unknown) => void;
        request.mockReturnValueOnce(new Promise(resolve => { answerPage = resolve; })).mockResolvedValueOnce({ items: radio(40) });
        const latePage = ytmProvider.explore!.getFeed(first.nextCursor);
        request.mockResolvedValueOnce({ sections: [] });
        await ytmProvider.explore!.getFeed();
        answerPage({ sections: [{ title: 'Songs', items: [{ kind: 'song', song: tileSong() }] }], continuation: 'from-place-8' });
        expect(await latePage).toEqual({ sections: [] });
    });

    it('leaves out the shelves of the account\'s own listening, known by their headings in the app\'s languages', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const shelf = (title: string) => ({ title, items: [{ kind: 'song', song: tileSong() }] });
        request.mockResolvedValueOnce({ sections: ['最近播放的音乐', 'Recently played', 'Diputar baru-baru ini', '再听一遍', 'Listen again', 'For you', '', '老歌重温', 'Forgotten favorites', 'Mixed for you'].map(shelf), continuation: 'next' });
        const page = await ytmProvider.explore!.getFeed();
        // What is left is what YouTube recommends, and the page goes on as it did.
        expect(page.sections.map(section => section.title)).toEqual(['For you', '', 'Mixed for you']);
        expect(page.nextCursor).toMatch(/^\d+:next$/);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Explore page: 3 shelves, 3 entries; 7 shelves of the account\'s own listening left out');
        // A page of such shelves alone is an empty page that still names the next one.
        request.mockResolvedValueOnce({ sections: [shelf('Listen again')], continuation: 'after' }).mockResolvedValueOnce({ items: [] });
        expect(await ytmProvider.explore!.getFeed(page.nextCursor)).toEqual({ sections: [], nextCursor: expect.stringMatching(/^\d+:after$/) });
        log.mockRestore();
    });

    // The shelves made here (ytmExplore.ts): the songs YouTube Music lists as like one song.
    const radio = (count: number, from = 0) => Array.from({ length: count }, (_, index) => wireSong(`radio${String(from + index).padStart(6, '0')}`));
    const songIds = (items: Array<{ kind: string; song?: { id: unknown } }>) => items.map(item => item.song?.id);
    const played = (id: string, name: string) => normalizeYtmSong(wireSong(id, { name }));

    it('goes on, from the second page, with a shelf of the songs like one the listener played', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        request.mockResolvedValueOnce({ continuation: 'page-2', sections: [{ title: 'For you', items: [{ kind: 'song', song: tileSong('pageSongA01') }] }] });
        const first = await ytmProvider.explore!.getFeed(undefined, [played('seedAAAAAAA', 'Played here')]);
        // The first page is YouTube's alone, and one request.
        expect(first.sections.map(section => section.title)).toEqual(['For you']);
        expect(request).toHaveBeenCalledExactlyOnceWith('explore', {});

        // The radio comes with the song itself first, which the shelf leaves out.
        request.mockResolvedValueOnce({ sections: [{ title: 'More', items: [{ kind: 'song', song: tileSong('pageSongA02') }] }] })
            .mockResolvedValueOnce({ items: [wireSong('seedAAAAAAA', { name: 'As the radio names it' }), ...radio(30)] });
        const second = await ytmProvider.explore!.getFeed(first.nextCursor);
        expect(request).toHaveBeenLastCalledWith('mix', { id: 'RDAMVMseedAAAAAAA', videoId: 'seedAAAAAAA' });
        // Its heading names the song as the radio does, in the app's language.
        expect(i18n.t('home.exploreSimilar', { name: 'As the radio names it' })).toContain('As the radio names it');
        expect(second.sections.map(section => section.title)).toEqual([i18n.t('home.exploreSimilar', { name: 'As the radio names it' }), 'More']);
        const [shelf] = second.sections;
        expect(songIds(shelf.items)).toEqual(radio(12).map(song => song.id));
        expect(shelf.items[0]).toMatchObject({ kind: 'song', song: { sourceRef: { kind: 'online', providerId: 'ytm' } } });
        // It is marked as made up anew for every read; YouTube's own shelf is not.
        expect(second.sections.map(section => Boolean(section.changesWithRead))).toEqual([true, false]);

        // Its further songs are handed out of what was read, a batch at a time, without a request.
        request.mockClear();
        const more = await ytmProvider.explore!.getSectionItems!(shelf.moreCursor!);
        expect(songIds(more.items)).toEqual(radio(12, 12).map(song => song.id));
        const last = await ytmProvider.explore!.getSectionItems!(more.moreCursor!);
        expect(songIds(last.items)).toEqual(radio(6, 24).map(song => song.id));
        expect(last).not.toHaveProperty('moreCursor');
        expect(request).not.toHaveBeenCalled();

        // YouTube's shelves have ended: the page goes on with shelves of the songs like the page's own, until those are used up.
        request.mockResolvedValueOnce({ items: radio(20, 100) }).mockResolvedValueOnce({ items: radio(20, 200) });
        const third = await ytmProvider.explore!.getFeed(second.nextCursor);
        expect(request.mock.calls.map(call => call[1].videoId)).toEqual(['pageSongA01', 'pageSongA02']);
        expect(third.sections).toHaveLength(2);
        // (A radio that does not list its song leaves the heading with the name the song came with.)
        expect(third.sections[0].title).toBe(i18n.t('home.exploreSimilar', { name: 'アイドル' }));
        expect(third).not.toHaveProperty('nextCursor');

        // Read from its start again, the page answers the cursors of the shelves it made before with nothing.
        request.mockResolvedValueOnce({ sections: [] });
        await ytmProvider.explore!.getFeed();
        expect(await ytmProvider.explore!.getSectionItems!(shelf.moreCursor!)).toEqual({ items: [] });
        expect(await ytmProvider.explore!.getFeed(second.nextCursor)).toEqual({ sections: [] });
    });

    it('asks first with the songs of YouTube\'s record of the account\'s listening, then with the page\'s others, and with a song of a read before last', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const shelf = (title: string, id: string) => ({ title, items: [{ kind: 'song', song: tileSong(id) }, { kind: 'collection', collection: { id: 'UCartist0001', type: 'artist', name: 'An artist', coverUrl: '' } }] });
        const firstPage = { sections: [shelf('For you', 'pageSong001'), shelf('Listen again', 'heardSong01')] };
        request.mockResolvedValueOnce(firstPage);
        const first = await ytmProvider.explore!.getFeed();
        request.mockResolvedValue({ items: radio(20) });
        await ytmProvider.explore!.getFeed(first.nextCursor);
        expect(request.mock.calls.slice(1).map(call => call[1].videoId)).toEqual(['heardSong01', 'pageSong001']);

        // The page read anew, with a song the listener played since: that one is new, the others were asked with before.
        request.mockReset();
        request.mockResolvedValueOnce({ ...firstPage, sections: [...firstPage.sections, shelf('New', 'pageSong002')] });
        const again = await ytmProvider.explore!.getFeed(undefined, [played('heardSong01', 'Heard'), played('playedSince', 'Since')]);
        request.mockResolvedValue({ items: radio(20) });
        await ytmProvider.explore!.getFeed(again.nextCursor);
        expect(request.mock.calls.slice(1).map(call => call[1].videoId)).toEqual(['playedSince', 'pageSong002', 'heardSong01']);
    });

    it('keeps a song on one shelf, makes no shelf of too few, and goes on without a radio that cannot be read', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        request.mockResolvedValueOnce({ sections: [] });
        const first = await ytmProvider.explore!.getFeed(undefined, ['shelfSeed01', 'shelfSeed02', 'shelfSeed03', 'shelfSeed04'].map(id => played(id, id)));
        // Three at a time: the second shares 10 songs with the first, the third has 11 no shelf shows, the fourth is refused.
        request.mockResolvedValueOnce({ items: radio(20) }).mockResolvedValueOnce({ items: radio(30, 10) }).mockResolvedValueOnce({ items: radio(21, 30) });
        const page = await ytmProvider.explore!.getFeed(first.nextCursor);
        expect(page.sections.map(section => songIds(section.items))).toEqual([radio(12).map(song => song.id), radio(12, 20).map(song => song.id)]);
        request.mockRejectedValueOnce(new Error('offline'));
        expect(await ytmProvider.explore!.getFeed(page.nextCursor)).toEqual({ sections: [] });
        expect(warn).toHaveBeenLastCalledWith('[Ytm] Explore radio of shelfSeed04 could not be read (offline); the page goes on without it');
        warn.mockRestore();
    });

    it('keeps the shelf asked for beside a page of YouTube\'s that could not be read, and hands it over with that page without asking again', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        request.mockResolvedValueOnce({ continuation: 'page-2', sections: [] });
        const first = await ytmProvider.explore!.getFeed(undefined, [played('waitSeed001', 'Waited for'), played('waitSeed002', 'Not asked with yet')]);
        // YouTube's page is refused; the radio asked for beside it arrives.
        request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: radio(20) });
        await expect(ytmProvider.explore!.getFeed(first.nextCursor)).rejects.toThrow('offline');
        // (The failure does not wait for the radio; the page is asked for again once the radio has arrived.)
        await new Promise(resolve => { setTimeout(resolve, 0); });
        request.mockClear();
        request.mockResolvedValueOnce({ sections: [{ title: 'More', items: [{ kind: 'song', song: tileSong('pageSongW01') }] }], continuation: 'page-3' });
        const second = await ytmProvider.explore!.getFeed(first.nextCursor);
        expect(request).toHaveBeenCalledExactlyOnceWith('explore', { continuation: 'page-2' });
        expect(second.sections.map(section => section.title)).toEqual([i18n.t('home.exploreSimilar', { name: 'Waited for' }), 'More']);
        // The page after it asks with the next song.
        request.mockResolvedValueOnce({ sections: [] }).mockResolvedValueOnce({ items: radio(20, 50) });
        await ytmProvider.explore!.getFeed(second.nextCursor);
        expect(request).toHaveBeenLastCalledWith('mix', { id: 'RDAMVMwaitSeed002', videoId: 'waitSeed002' });
    });

    it('makes at most twelve such shelves for one read of the page', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        request.mockResolvedValueOnce({ sections: [] });
        let cursor = (await ytmProvider.explore!.getFeed(undefined, Array.from({ length: 20 }, (_, index) => played(`capSeed${String(index).padStart(4, '0')}`, `Song ${index}`)))).nextCursor;
        request.mockImplementation(async (_operation: string, params: { videoId: string }) => ({ items: radio(12, Number(params.videoId.slice(-4)) * 100) }));
        let shelves = 0;
        while (cursor) {
            const page = await ytmProvider.explore!.getFeed(cursor);
            shelves += page.sections.length;
            // (The explore page takes a cursor that names itself for the end of the list.)
            expect(page.nextCursor).not.toBe(cursor);
            cursor = page.nextCursor;
        }
        expect(shelves).toBe(12);
        expect(request).toHaveBeenCalledTimes(13);
    });

    it('reads a mix card as one queue, kept so that its pages are pages of the same list', async () => {
        const mix = normalizeYtmCollection({ id: 'RDEMfixture', type: 'playlist', name: 'A mix', coverUrl: '', mix: true, videoId: 'm9SMT5ipbxk' });
        request.mockResolvedValue({ items: ids(5).map(id => tileSong(id)) });
        const first = await ytmProvider.catalog!.getPlaylistTracks!('RDEMfixture', 3, 0, mix);
        const second = await ytmProvider.catalog!.getPlaylistTracks!('RDEMfixture', 3, 3, mix);
        expect(first).toMatchObject({ total: 5, hasMore: true, nextOffset: 3 });
        expect([...first.items, ...second.items].map(song => song.id)).toEqual(ids(5));
        expect(request).toHaveBeenCalledExactlyOnceWith('mix', { id: 'RDEMfixture', videoId: 'm9SMT5ipbxk' });
        // A card without a first song asks by the list id alone; a plain playlist is not read as a mix.
        await ytmProvider.catalog!.getPlaylistTracks!('RDAOfixture', 3, 0, normalizeYtmCollection({ id: 'RDAOfixture', type: 'playlist', name: 'Radio', coverUrl: '', mix: true }));
        expect(request).toHaveBeenLastCalledWith('mix', { id: 'RDAOfixture' });
        request.mockResolvedValue({ items: [tileSong()] });
        await ytmProvider.catalog!.getPlaylistTracks!('PLfixture01', 3, 0, normalizeYtmCollection({ id: 'PLfixture01', type: 'playlist', name: 'Road', coverUrl: '' }));
        expect(request).toHaveBeenLastCalledWith('public_playlist', { id: 'PLfixture01', continuation: undefined });
    });

    it('cuts a later page of a mix from the list its first page came from, however long ago that was', async () => {
        const mix = normalizeYtmCollection({ id: 'RDEMfixture', type: 'playlist', name: 'A mix', coverUrl: '', mix: true });
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        request.mockResolvedValueOnce({ items: ids(5).map(id => tileSong(id)) });
        await ytmProvider.catalog!.getPlaylistTracks!('RDEMfixture', 3, 0, mix);
        now.mockReturnValue(1_000_000 + 6 * 60 * 1000);
        const later = await ytmProvider.catalog!.getPlaylistTracks!('RDEMfixture', 3, 3, mix);
        expect(later.items.map(song => song.id)).toEqual(ids(2, 3));
        expect(request).toHaveBeenCalledTimes(1);
        // A read from the top takes a new list once the kept one has aged.
        request.mockResolvedValueOnce({ items: [tileSong()] });
        expect((await ytmProvider.catalog!.getPlaylistTracks!('RDEMfixture', 3, 0, mix)).items).toHaveLength(1);
        expect(request).toHaveBeenCalledTimes(2);
        now.mockRestore();
    });

    it('saves an album known by its list id, and asks whether it is saved, by that id', async () => {
        request.mockResolvedValueOnce({ saved: true }).mockResolvedValueOnce({ saved: false });
        expect(await ytmProvider.catalog!.getSubscriptionStatus!('album', 'OLAK5uy_bare')).toBe(true);
        expect(request).toHaveBeenLastCalledWith('list_saved', { id: 'OLAK5uy_bare' });
        expect(await ytmProvider.catalog!.getSubscriptionStatus!('album', 'OLAK5uy_bare')).toBe(false);
        expect(request).toHaveBeenCalledTimes(2);

        request.mockReset().mockResolvedValue(true);
        await ytmProvider.mutations!.subscribeAlbum!('OLAK5uy_bare', true);
        expect(request).toHaveBeenLastCalledWith('list_save', { id: 'OLAK5uy_bare', saved: 'true' });
        await ytmProvider.mutations!.subscribeAlbum!('OLAK5uy_bare', false);
        expect(request).toHaveBeenLastCalledWith('list_save', { id: 'OLAK5uy_bare', saved: 'false' });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('reads and changes a catalogue album by the list id its page names, also for a card that carries another', async () => {
        const answers: Record<string, unknown> = {
            album: { collection: { id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '', playlistId: 'OLAK5uy_page' }, items: [] },
            list_saved: { saved: true }, list_save: true,
        };
        request.mockImplementation(async (operation: string) => answers[operation]);
        // A library card has a list id of its own, which is not the one its page names.
        const card = normalizeYtmCollection({ id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '', playlistId: 'OLAK5uy_card' });
        expect(await ytmProvider.catalog!.getSubscriptionStatus!('album', 'MPREb_x', card)).toBe(true);
        await ytmProvider.mutations!.subscribeAlbum!('MPREb_x', false);
        // The page is read once; the state is read and the change made with the same id. The id of
        // the album's own page goes along: the desktop side reads the save button off that page.
        expect(request.mock.calls).toEqual([
            ['album', { id: 'MPREb_x' }], ['list_saved', { id: 'OLAK5uy_page', albumId: 'MPREb_x' }], ['list_save', { id: 'OLAK5uy_page', albumId: 'MPREb_x', saved: 'false' }],
        ]);
        // An album known by its list id alone has no page id to send.
        request.mockClear();
        await ytmProvider.catalog!.getSubscriptionStatus!('album', 'OLAK5uy_bare');
        await ytmProvider.mutations!.subscribeAlbum!('OLAK5uy_bare', true);
        expect(request.mock.calls.map(([, params]) => Object.keys(params))).toEqual([['id'], ['id', 'saved']]);
    });

    it('does not save an album whose page names no list', async () => {
        request.mockResolvedValue({ collection: { id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '' }, items: [] });
        await expect(ytmProvider.mutations!.subscribeAlbum!('MPREb_x', true)).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(ytmProvider.catalog!.getSubscriptionStatus!('album', 'MPREb_x')).rejects.toMatchObject({ code: 'invalid-response' });
        expect(request.mock.calls.map(([operation]) => operation)).toEqual(['album']);
    });

    it('saves a playlist that is somebody else\'s by its own id, and offers no save for an own playlist, the liked list or a mix', async () => {
        const list = (id: string, extra: Record<string, unknown> = {}) => normalizeYtmCollection({ id, type: 'playlist', name: id, coverUrl: '', ...extra });
        const theirs = list('PLtheirs');
        // The liked list is told by its id: a card that plays it at once carries no mark.
        const others = [list('PLmine', { isOwned: true }), list('LM'), list('RDEMfixture', { mix: true })];
        const can = ytmProvider.mutations!.canSubscribe!;
        expect(can(theirs)).toBe(true);
        expect(can(normalizeYtmCollection({ id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '' }, 'album'))).toBe(true);
        expect(others.map(can)).toEqual([false, false, false]);

        request.mockResolvedValueOnce({ saved: true });
        expect(await ytmProvider.catalog!.getSubscriptionStatus!('playlist', 'PLtheirs', theirs)).toBe(true);
        expect(request).toHaveBeenLastCalledWith('list_saved', { id: 'PLtheirs' });
        request.mockReset().mockResolvedValue(true);
        await ytmProvider.mutations!.subscribePlaylist!(theirs, true);
        expect(request).toHaveBeenLastCalledWith('list_save', { id: 'PLtheirs', saved: 'true' });
        await ytmProvider.mutations!.subscribePlaylist!('PLtheirs', false);
        expect(request).toHaveBeenLastCalledWith('list_save', { id: 'PLtheirs', saved: 'false' });
        // What cannot be saved is not asked about: its page has no save button, or one that does not mean this.
        request.mockClear();
        for (const other of others) expect(await ytmProvider.catalog!.getSubscriptionStatus!('playlist', other.id, other)).toBe(false);
        expect(await ytmProvider.catalog!.getSubscriptionStatus!('playlist', 'PLfixture01')).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('changes only the account\'s own playlists, a hundred songs a request', async () => {
        const own = normalizeYtmCollection({ id: 'PLmine', type: 'playlist', name: 'Mine', coverUrl: '', isOwned: true });
        const saved = normalizeYtmCollection({ id: 'PLtheirs', type: 'playlist', name: 'Saved', coverUrl: '' });
        const liked = normalizeYtmCollection({ id: 'LM', type: 'playlist', name: 'Liked Music', coverUrl: '', isLiked: true });
        const can = ytmProvider.mutations!.canAddToPlaylist!;
        // The liked-music list is the account's, but YouTube refuses to edit it.
        expect([own, saved, liked].map(can)).toEqual([true, false, false]);
        expect(liked.isOwned).toBe(true);

        request.mockResolvedValue(true);
        await ytmProvider.mutations!.updatePlaylistTracks!('add', own, ids(150).map(id => normalizeYtmSong(tileSong(id))));
        expect(request.mock.calls).toEqual([
            ['playlist_edit', { id: 'PLmine', action: 'add', videoIds: ids(100).join(',') }],
            ['playlist_edit', { id: 'PLmine', action: 'add', videoIds: ids(50, 100).join(',') }],
        ]);
        await ytmProvider.mutations!.updatePlaylistTracks!('del', own, ['m9SMT5ipbxk']);
        expect(request).toHaveBeenLastCalledWith('playlist_edit', { id: 'PLmine', action: 'remove', videoIds: 'm9SMT5ipbxk' });
        // A song read with the id of its row is removed by that row, one read without by its own id; a song is added without one.
        const withRow = normalizeYtmSong({ ...tileSong('m9SMT5ipbxk'), setVideoId: 'ROW1' });
        expect((withRow as { collectionRowId?: string }).collectionRowId).toBe('ROW1');
        await ytmProvider.mutations!.updatePlaylistTracks!('del', own, [withRow, normalizeYtmSong(tileSong('ZRtdQ81jPUQ'))]);
        expect(request).toHaveBeenLastCalledWith('playlist_edit', { id: 'PLmine', action: 'remove', videoIds: 'm9SMT5ipbxk,ZRtdQ81jPUQ', setVideoIds: 'ROW1,' });
        await ytmProvider.mutations!.updatePlaylistTracks!('add', own, [withRow]);
        expect(request).toHaveBeenLastCalledWith('playlist_edit', { id: 'PLmine', action: 'add', videoIds: 'm9SMT5ipbxk' });
        request.mockClear();
        for (const playlist of [saved, liked]) {
            await expect(ytmProvider.mutations!.updatePlaylistTracks!('add', playlist, ['m9SMT5ipbxk'])).rejects.toMatchObject({ code: 'unsupported' });
        }
        expect(request).not.toHaveBeenCalled();
    });

    it('searches by query, then by the page token, without sending an empty query', async () => {
        request.mockResolvedValueOnce({ items: [wireSong('a0000000001')], continuation: 'next-token' })
            .mockResolvedValueOnce({ items: [wireSong('a0000000002')] });
        expect(await ytmProvider.search!.searchSongs('   ', 30, 0)).toEqual({ items: [], total: 0, nextOffset: 0, hasMore: false });
        expect(request).not.toHaveBeenCalled();

        const first = await ytmProvider.search!.searchSongs(' yoasobi ', 30, 0);
        expect(first).toMatchObject({ nextOffset: 1, hasMore: true });
        expect(first.items[0].sourceRef).toEqual({ kind: 'online', providerId: 'ytm', mediaId: 'a0000000001' });
        const second = await ytmProvider.search!.searchSongs('yoasobi', 30, first.nextOffset);
        expect(second).toMatchObject({ items: [{ id: 'a0000000002' }], total: 2, hasMore: false });
        expect(request.mock.calls).toEqual([['search_songs', { query: 'yoasobi' }], ['search_songs', { continuation: 'next-token' }]]);
    });

    // A mod reading through `folium.omni` names its session: its searches neither start the
    // listener's search over nor push it out, however many it makes.
    it('walks a session\'s searches apart from the host\'s own, in a pager of their own', async () => {
        // Each page holds one song and the token of the next page.
        request.mockImplementation(async (operation: string, params: { query?: string; continuation?: string }) => {
            if (operation !== 'search_songs') throw new Error(`unexpected ${operation}`);
            const [text, page] = params.query !== undefined
                ? [params.query, 0]
                : [params.continuation!.split('#')[0], Number(params.continuation!.split('#')[1])];
            return { items: [wireSong(`${text}-${page}`)], continuation: `${text}#${page + 1}` };
        });
        const search = ytmProvider.search!.searchSongs;
        const mod = { session: 'folium:mod-a' };
        const first = await search('tides', 1, 0);
        // The mod reads the same search from its first page, then its second.
        expect((await search('tides', 1, 0, mod)).items.map(song => song.id)).toEqual(['tides-0']);
        expect((await search('tides', 1, 1, mod)).items.map(song => song.id)).toEqual(['tides-1']);
        // The listener's search goes on with its own token: not begun anew by the mod's first page.
        request.mockClear();
        const second = await search('tides', 1, first.nextOffset);
        expect(second.items.map(song => song.id)).toEqual(['tides-1']);
        expect(request.mock.calls).toEqual([['search_songs', { continuation: 'tides#1' }]]);
        // Sessions begin many more searches than the pager holds; only theirs make room.
        for (let lookup = 0; lookup < 30; lookup += 1) await search(`lookup ${lookup}`, 1, 0, { session: `folium:mod-${lookup % 3}` });
        request.mockClear();
        expect((await search('tides', 1, second.nextOffset)).items.map(song => song.id)).toEqual(['tides-2']);
        expect(request.mock.calls).toEqual([['search_songs', { continuation: 'tides#2' }]]);
    });

    it('says in the log whether a track came with lyrics of its own', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        request.mockResolvedValueOnce(null).mockResolvedValueOnce({ mainText: '[00:01.00]line one\n[00:02.00]line two' });
        const song = normalizeYtmSong(wireSong());
        await ytmProvider.lyrics!.getLyrics(song);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Own lyrics for m9SMT5ipbxk: none');
        await ytmProvider.lyrics!.getLyrics(song);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Own lyrics for m9SMT5ipbxk: 2 timed lines');
        log.mockRestore();
    });

    it('asks for a fresh stream URL on every call and only for its own songs', async () => {
        request.mockResolvedValueOnce({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=one', route: 'web' })
            .mockResolvedValueOnce({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=two', route: 'tv' });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const song = normalizeYtmSong(wireSong());
        const first = await ytmProvider.playback!.getAudioSource(song, 'high');
        expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^\[Ytm\] Audio for "アイドル" \(m9SMT5ipbxk\) at high is ready by the web route after \d+ms$/));
        log.mockRestore();
        const second = await ytmProvider.playback!.getAudioSource({ ...song, id: 'display-id' }, 'lossless');
        expect(first).toMatchObject({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=one', quality: 'high' });
        expect(second).toMatchObject({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=two', quality: 'lossless' });
        expect(request).toHaveBeenLastCalledWith('audio', { id: 'm9SMT5ipbxk', quality: 'lossless' });
        const foreign = { ...song, sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '1' } };
        await expect(ytmProvider.playback!.getAudioSource(foreign, 'high')).rejects.toMatchObject({ code: 'unsupported' });
        await expect(ytmProvider.lyrics!.getLyrics(foreign)).rejects.toMatchObject({ code: 'unsupported' });
    });

    it('takes YouTube\'s loudness figure as the track gain: a track louder than its level is turned down, a quieter one not lifted', async () => {
        request.mockResolvedValueOnce({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=one', route: 'web', loudnessDb: 4.5 })
            .mockResolvedValueOnce({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=quiet', route: 'web', loudnessDb: -6 })
            .mockResolvedValueOnce({ url: 'folia-ytm://audio/m9SMT5ipbxk?k=two', route: 'web' });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const song = normalizeYtmSong(wireSong());
        expect(await ytmProvider.playback!.getAudioSource(song, 'high')).toMatchObject({ replayGain: { trackGain: -4.5 } });
        expect(await ytmProvider.playback!.getAudioSource(song, 'high')).toMatchObject({ replayGain: { trackGain: 0 } });
        expect(await ytmProvider.playback!.getAudioSource(song, 'high')).not.toHaveProperty('replayGain');
        vi.mocked(console.log).mockRestore();
    });

    it('reads its line-timed lyrics, and answers "none" when there are none or the request fails', async () => {
        const song = normalizeYtmSong(wireSong());
        const mainText = '[00:00.880]first line\n[00:04.500]second line\n[00:20.000]after a break';
        request.mockResolvedValueOnce({ mainText });
        const result = await ytmProvider.lyrics!.getLyrics(song);
        expect(request).toHaveBeenLastCalledWith('lyrics', { id: 'm9SMT5ipbxk' });
        expect(result).toMatchObject({ mainText, isPureMusic: false });
        expect(result.lyrics!.lines.map(line => [line.startTime, line.fullText])).toEqual([
            // The parser turns a long gap into an interlude line; break markers are left out upstream for that.
            [0.88, 'first line'], [4.5, 'second line'], [12.05, '......'], [20, 'after a break'],
        ]);
        expect(result.lyrics!.isWordByWord).toBe(false);

        request.mockResolvedValueOnce(null);
        expect(await ytmProvider.lyrics!.getLyrics(song)).toEqual({ lyrics: null, isPureMusic: false });
        // The cross-source lookup still has to run when YouTube's own lyrics cannot be reached.
        request.mockRejectedValueOnce(new Error('offline'));
        expect(await ytmProvider.lyrics!.getLyrics(song)).toEqual({ lyrics: null, isPureMusic: false });
    });

    it('gives the artist\'s name from the English page for a name that is not in Latin letters, and from the Chinese page for one that is', async () => {
        const other = (song: unknown) => ytmProvider.lyrics!.getAlternateArtistName!(normalizeYtmSong(song));
        const named = (...names: string[]) => wireSong('rj5wZqReXQE', { artists: names.map(name => ({ id: '', name })) });
        request.mockResolvedValueOnce(named('Oasis', 'Noel Gallagher'));
        expect(await other(named('绿洲合唱团', 'Noel Gallagher'))).toBe('Oasis, Noel Gallagher');
        expect(request).toHaveBeenCalledExactlyOnceWith('song_detail_en', { id: 'rj5wZqReXQE' });

        // The page does not list the track, or cannot be read: there is no other name.
        request.mockResolvedValueOnce(null);
        expect(await other(named('绿洲合唱团'))).toBeNull();
        request.mockRejectedValueOnce(new Error('offline'));
        expect(await other(named('ヨルシカ'))).toBeNull();
        request.mockResolvedValueOnce(named());
        expect(await other(named('아이유'))).toBeNull();
        expect(request).toHaveBeenCalledTimes(4);

        // Latin letters, with accents, digits and signs, may be a romanised name: the Chinese page has the original.
        request.mockReset().mockResolvedValue(named('陈奕迅'));
        for (const name of ['Eason Chan', 'Sigur Rós', 'blink-182', 'Florence + the Machine']) expect(await other(named(name))).toBe('陈奕迅');
        expect(request.mock.calls).toEqual(Array.from({ length: 4 }, () => ['song_detail_zh', { id: 'rj5wZqReXQE' }]));

        // A playlist row names two artists in one string and the song page lists them apart: not another name.
        request.mockResolvedValueOnce(named('YOASOBI', 'Ayase'));
        expect(await other(named('YOASOBI & Ayase'))).toBeNull();
        request.mockResolvedValueOnce(named('绿洲合唱团'));
        expect(await other(named('绿洲合唱团'))).toBeNull();
        await expect(ytmProvider.lyrics!.getAlternateArtistName!({ ...normalizeYtmSong(named('绿洲合唱团')), sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } }))
            .rejects.toMatchObject({ code: 'unsupported' });
    });

    // The desktop side's answer where none of the browsers it opens is installed: its code, its
    // sentence and, as the transport hands it on, its reason.
    const noBrowser = (reason?: string) => new OnlineProviderError('unsupported', 'No browser to sign in with was found', 'ytm', reason);

    it('begins a sign-in in the person\'s browser, which has no QR image, and sends its steps to that sign-in', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const auth = ytmProvider.auth!;
        expect(auth.createQr).toBeUndefined();
        request.mockResolvedValueOnce({});
        const key = await auth.startLogin!();
        expect(request.mock.calls).toEqual([['web_login_start']]);
        // The dialog gives it longer than the desktop side's ten minutes: at the end of those the
        // desktop side reads what the browser left, and the dialog waits for that.
        expect(auth.getLoginTtlMs!()).toBe(12 * 60 * 1000);

        // The desktop side's answers, as the states of the dialog.
        for (const [answer, state] of [
            [{ state: 'waiting' }, { state: 'waiting' }],
            [{ state: 'expired' }, { state: 'expired' }],
            [{ state: 'error', message: 'sign-in-failed' }, { state: 'error', message: 'sign-in-failed' }],
            [{ state: 'confirmed', account: { id: 'abc', nickname: 'Fixture' } }, { state: 'confirmed' }],
        ]) {
            request.mockResolvedValueOnce(answer);
            expect(await auth.checkLogin!(key)).toEqual(state);
            expect(request).toHaveBeenLastCalledWith('web_login_check');
        }
        request.mockResolvedValue({});
        await auth.openLoginPage!(key);
        expect(request).toHaveBeenLastCalledWith('web_login_open');
        await auth.cancelLogin!(key);
        expect(request).toHaveBeenLastCalledWith('web_login_cancel');
        // Given up, it is the sign-in in progress no more: a step of it is answered here, not sent.
        request.mockClear();
        expect(await auth.checkLogin!(key)).toEqual({ state: 'expired' });
        await auth.cancelLogin!(key);
        expect(request).not.toHaveBeenCalled();
    });

    it('fails the sign-in where the desktop side has no browser to open, names the sentence that says so, and sends no other request', async () => {
        const auth = ytmProvider.auth!;
        request.mockRejectedValueOnce(noBrowser('no-browser'));
        const failure = await auth.startLogin!().catch((error: unknown) => error);
        expect(failure).toMatchObject({ code: 'unsupported' });
        expect(request.mock.calls).toEqual([['web_login_start']]);
        // The reason on what the start threw makes it the case "no browser", and for that case the
        // window shows this platform's own sentence under the headline; the three languages have it.
        expect(auth.describeLoginFailure!('start', failure)).toMatchObject({ case: 'no-browser' });
        expect(auth.getLoginTexts!().caseNotes?.['no-browser']).toBe('home.loginNoBrowserYtm');
        for (const language of ['zh-CN', 'en', 'in']) {
            expect(i18n.getFixedT(language)('home.loginNoBrowserYtm')).toMatch(/YouTube Music.+Chrome.+Beta.+Dev.+Canary.+Edge.+Chromium.+Brave.+Helium/);
        }
    });

    it('fails the sign-in when its start fails for any other reason, and does not call it "no browser"', async () => {
        const auth = ytmProvider.auth!;
        for (const code of ['unavailable', 'network', 'invalid-response'] as const) {
            const failure = new OnlineProviderError(code, 'The browser could not be opened', 'ytm');
            request.mockReset().mockRejectedValueOnce(failure);
            await expect(auth.startLogin!()).rejects.toBe(failure);
            expect(request.mock.calls).toEqual([['web_login_start']]);
            expect(auth.describeLoginFailure!('start', failure)?.case).not.toBe('no-browser');
        }
        // A failure that names no reason is not "no browser" either, whatever its code or its words.
        expect(auth.describeLoginFailure!('start', noBrowser())?.case).toBeUndefined();
        expect(auth.describeLoginFailure!('start', new Error('unsupported'))).toBeNull();
    });

    it('begins a second sign-in under a key of its own, and sends no step of the earlier one', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const auth = ytmProvider.auth!;
        request.mockResolvedValue({});
        const earlier = await auth.startLogin!();
        const later = await auth.startLogin!();
        expect(request.mock.calls).toEqual([['web_login_start'], ['web_login_start']]);
        expect(later).not.toBe(earlier);

        // The desktop side has one sign-in and no key for it: a step of the earlier one is not
        // sent to it, where it would be taken for the later one's.
        request.mockClear();
        expect(await auth.checkLogin!(earlier)).toEqual({ state: 'expired' });
        await auth.cancelLogin!(earlier);
        expect(request).not.toHaveBeenCalled();
        await auth.cancelLogin!(later);
        expect(request.mock.calls).toEqual([['web_login_cancel']]);
    });

    // The dialog was closed and opened again while the browser was still starting.
    it('lets only the newer of two sign-ins begun at once stand, so that giving up the older does not cancel the newer one\'s window', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const auth = ytmProvider.auth!;
        let answerOlder!: (value: unknown) => void;
        let answerNewer!: (value: unknown) => void;
        request.mockReturnValueOnce(new Promise(resolve => { answerOlder = resolve; })).mockReturnValueOnce(new Promise(resolve => { answerNewer = resolve; })).mockResolvedValue({});
        const older = auth.startLogin!();
        const newer = auth.startLogin!();
        answerOlder({});
        const olderKey = await older;
        // The older one is not the sign-in in progress, and giving it up says nothing to the desktop side.
        expect(await auth.checkLogin!(olderKey)).toEqual({ state: 'expired' });
        await auth.cancelLogin!(olderKey);
        expect(request.mock.calls).toEqual([['web_login_start'], ['web_login_start']]);
        answerNewer({});
        const newerKey = await newer;
        request.mockResolvedValueOnce({ state: 'waiting' });
        expect(await auth.checkLogin!(newerKey)).toEqual({ state: 'waiting' });
        await auth.cancelLogin!(newerKey);
        expect(request).toHaveBeenLastCalledWith('web_login_cancel');
    });

    // A sign-in can begin while an account is signed in, and that account stays signed in until
    // the sign-in is confirmed: what the radio tab reads in between is still the account before's.
    it('forgets the FM and the music page read since a sign-in began, once the sign-in is confirmed', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const auth = ytmProvider.auth!;
        const recommendations = ytmProvider.recommendations!;
        let login = { state: 'waiting' };
        request.mockImplementation(async (operation: string) => {
            if (operation === 'web_login_start') return {};
            if (operation === 'web_login_check') return login;
            if (operation === 'explore') return { sections: [{ title: 'Mixed for you', items: [{ kind: 'collection', collection: { id: 'PLfixture01', type: 'playlist', name: 'Road', coverUrl: '' } }] }] };
            // (The liked-music list the FM asks with, then the radio of its song.)
            if (operation === 'playlist') return { items: [wireSong('likedSong01')] };
            return { items: radio(6) };
        });
        const asked = (operation: string) => request.mock.calls.filter(([name]) => name === operation).length;
        const readRadioTab = async () => {
            await recommendations.getRecommendedCollections!(10);
            await recommendations.getPersonalFm!();
        };

        const key = await auth.startLogin!();
        await readRadioTab();
        // While the sign-in waits to be confirmed, what was read is kept.
        expect(await auth.checkLogin!(key)).toEqual({ state: 'waiting' });
        await readRadioTab();
        expect([asked('explore'), asked('playlist')]).toEqual([1, 1]);

        login = { state: 'confirmed' };
        expect(await auth.checkLogin!(key)).toEqual({ state: 'confirmed' });
        await readRadioTab();
        expect([asked('explore'), asked('playlist')]).toEqual([2, 2]);
    });

    it('normalizes the signed-in account and forgets cached pages on sign-out', async () => {
        request.mockResolvedValueOnce({ id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType: 0 }).mockResolvedValueOnce(null);
        expect(await ytmProvider.auth!.getLoginStatus()).toEqual({ id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType: 0 });
        expect(await ytmProvider.auth!.getLoginStatus()).toBeNull();

        request.mockReset().mockResolvedValue({ collection: { id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '' }, items: [wireSong()] });
        await ytmProvider.catalog!.getAlbumDetail!('MPREb_x');
        await ytmProvider.auth!.logout();
        expect(request).toHaveBeenLastCalledWith('logout');
        await ytmProvider.catalog!.getAlbumDetail!('MPREb_x');
        expect(request.mock.calls.filter(([operation]) => operation === 'album')).toHaveLength(2);
    });

    // What shows the account asks the adapter again when the account leaves the store (the quality
    // levels it lists, for one): the adapter's note of the account has to be gone by then, so it
    // goes when the adapter is told, and before the first wait of a sign-out.
    it('drops its note of the account when told the sign-in ran out, and at once on sign-out', async () => {
        noteYtmAccount({ id: 'abc', nickname: 'Fixture', vipType: 1 });
        expect(ytmHasPremium()).toBe(true);
        void ytmProvider.auth!.signInRanOut!();
        expect(ytmHasPremium()).toBe(false);

        noteYtmAccount({ id: 'abc', nickname: 'Fixture', vipType: 1 });
        request.mockResolvedValue(null);
        const leaving = ytmProvider.auth!.logout();
        expect(ytmHasPremium()).toBe(false);
        await leaving;
    });

    it('forgets cached pages when the app\'s language changes, since they are named in the previous one', async () => {
        const album = () => request.mock.calls.filter(([operation]) => operation === 'album').length;
        request.mockResolvedValue({ collection: { id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '' }, items: [wireSong()] });
        const before = i18n.language;
        await ytmProvider.catalog!.getAlbumDetail!('MPREb_x');
        await ytmProvider.catalog!.getAlbumDetail!('MPREb_x');
        expect(album()).toBe(1);
        try {
            await i18n.changeLanguage(before === 'en' ? 'zh-CN' : 'en');
            await ytmProvider.catalog!.getAlbumDetail!('MPREb_x');
            expect(album()).toBe(2);
        } finally {
            await i18n.changeLanguage(before);
        }
    });
});

describe('YouTube Music catalog and library', () => {
    it('serves an album\'s detail and tracks from one request', async () => {
        request.mockResolvedValue({ collection: { id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: 'c', trackCount: 2 }, items: [wireSong('a0000000001'), wireSong('a0000000002')] });
        const catalog = ytmProvider.catalog!;
        const [detail, tracks] = await Promise.all([catalog.getAlbumDetail!('MPREb_x'), catalog.getAlbumTracks!('MPREb_x', 1, 1)]);
        expect(detail).toMatchObject({ providerId: 'ytm', id: 'MPREb_x', type: 'album', trackCount: 2 });
        expect(tracks).toMatchObject({ items: [{ id: 'a0000000002' }], total: 2, nextOffset: 2, hasMore: false });
        expect(request).toHaveBeenCalledExactlyOnceWith('album', { id: 'MPREb_x' });
    });

    it('reads a library album that has only a playlist id as that playlist', async () => {
        request.mockResolvedValue({ items: [tileSong()] });
        const card = normalizeYtmCollection({ id: 'OLAK5uy_x', type: 'album', name: 'Album', coverUrl: 'c', playlistId: 'OLAK5uy_x' });
        expect(await ytmProvider.catalog!.getAlbumDetail!('OLAK5uy_x', card)).toBe(card);
        expect((await ytmProvider.catalog!.getAlbumTracks!('OLAK5uy_x', 50, 0)).items).toHaveLength(1);
        expect(request).toHaveBeenCalledExactlyOnceWith('public_playlist', { id: 'OLAK5uy_x', continuation: undefined });
    });

    it('reads a playlist as a guest where that read has it, and as the account where it has not', async () => {
        const catalog = ytmProvider.catalog!;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const answers = (pages: Record<string, unknown>) => request.mockImplementation(async (operation: string, params: { continuation?: string }) => {
            const answer = pages[`${operation} ${params.continuation ?? ''}`.trim()];
            if (answer instanceof Error) throw answer;
            return answer ?? { items: [] };
        });
        const read = async (id: string, card?: Parameters<typeof normalizeYtmCollection>[0]) => {
            request.mockClear();
            const collection = card ? normalizeYtmCollection(card) : undefined;
            const first = await catalog.getPlaylistTracks!(id, 50, 0, collection);
            const second = first.hasMore ? await catalog.getPlaylistTracks!(id, 50, first.nextOffset, collection) : { items: [] };
            return { songs: [...first.items, ...second.items].map(song => song.id), asked: request.mock.calls.map(([operation, params]) => `${operation} ${params.continuation ?? ''}`.trim()) };
        };

        // A public playlist: both pages from the guest read, each token handed back as it came.
        answers({ public_playlist: { items: [wireSong('a0000000001')], continuation: 'rows-2' }, 'public_playlist rows-2': { items: [wireSong('a0000000002')] } });
        expect(await read('PLpublic01')).toEqual({ songs: ['a0000000001', 'a0000000002'], asked: ['public_playlist', 'public_playlist rows-2'] });
        // A playlist the guest read has no rows of: the account's pages, with the account's tokens.
        answers({ playlist: { items: [tileSong('a0000000003')], continuation: 'rows-2' }, 'playlist rows-2': { items: [tileSong('a0000000004')] } });
        expect(await read('PLprivate1')).toEqual({ songs: ['a0000000003', 'a0000000004'], asked: ['public_playlist', 'playlist', 'playlist rows-2'] });
        expect(warn).not.toHaveBeenCalled();
        // The account's own playlist and the liked list are not asked of the guest read at all.
        answers({ playlist: { items: [tileSong('a0000000005')] } });
        expect(await read('PLown00001', { id: 'PLown00001', type: 'playlist', name: 'Mine', coverUrl: '', isOwned: true })).toEqual({ songs: ['a0000000005'], asked: ['playlist'] });
        expect(await read('LM')).toEqual({ songs: ['a0000000005'], asked: ['playlist'] });
        // Somebody else's playlist in the library is.
        expect((await read('PLsaved001', { id: 'PLsaved001', type: 'playlist', name: 'Saved', coverUrl: '' })).asked).toEqual(['public_playlist', 'playlist']);

        // A guest read that fails on its first page gives way to the account's, and says so.
        answers({ public_playlist: new Error('YouTube Music could not be reached'), playlist: { items: [tileSong('a0000000006')] } });
        expect(await read('PLflaky001')).toEqual({ songs: ['a0000000006'], asked: ['public_playlist', 'playlist'] });
        expect(warn).toHaveBeenCalledExactlyOnceWith('[Ytm] Playlist PLflaky001 could not be read as a guest (YouTube Music could not be reached); it is read as the account');
        // One that fails on a further page fails: the account's read has no page for a guest's token.
        answers({ public_playlist: { items: [wireSong('a0000000007')], continuation: 'rows-2' }, 'public_playlist rows-2': new Error('YouTube Music could not be reached') });
        await expect(read('PLbroken01')).rejects.toThrow('could not be reached');
        expect(request.mock.calls.map(([operation]) => operation)).toEqual(['public_playlist', 'public_playlist']);
        warn.mockRestore();
    });

    it('pages a playlist by token and returns the library card as its detail', async () => {
        request.mockResolvedValueOnce({ items: [tileSong('a0000000001')], continuation: 'next' }).mockResolvedValueOnce({ items: [tileSong('a0000000002')] });
        const catalog = ytmProvider.catalog!;
        const first = await catalog.getPlaylistTracks!('LM', 50, 0);
        const second = await catalog.getPlaylistTracks!('LM', 50, first.nextOffset);
        expect([...first.items, ...second.items].map(song => song.id)).toEqual(['a0000000001', 'a0000000002']);
        expect(request.mock.calls).toEqual([['playlist', { id: 'LM', continuation: undefined }], ['playlist', { id: 'LM', continuation: 'next' }]]);
        const card = normalizeYtmCollection({ id: 'LM', type: 'playlist', name: 'Liked Music', coverUrl: 'c' });
        expect(await catalog.getPlaylistDetail!('LM', card)).toBe(card);
        expect(await catalog.getPlaylistDetail!('LM')).toBeNull();
    });

    it('fills in a row\'s artist, album and square cover from the public watch page, once', async () => {
        request.mockResolvedValue(wireSong('ZRtdQ81jPUQ'));
        const catalog = ytmProvider.catalog!;
        const row = normalizeYtmSong(tileSong());
        expect(catalog.canResolveSongCatalogRefs!(row)).toBe(true);
        const resolved = await catalog.resolveSongCatalogRefs!(row);
        expect(resolved).toMatchObject({
            id: 'ZRtdQ81jPUQ', sourceRef: row.sourceRef,
            artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', catalogRef: { kind: 'artist' } }],
            album: { id: 'MPREb_6h43ySO9duW', coverUrl: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj', catalogRef: { kind: 'album' } },
        });
        await catalog.resolveSongCatalogRefs!(row);
        expect(request).toHaveBeenCalledExactlyOnceWith('song_detail', { id: 'ZRtdQ81jPUQ' });
        // A song that already has its ids is returned as it is, with no request.
        expect(await catalog.resolveSongCatalogRefs!(resolved)).toBe(resolved);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('keeps the row as it is when the watch page has nothing or cannot be read', async () => {
        const catalog = ytmProvider.catalog!;
        const video = normalizeYtmSong(tileSong('a0000000003'));
        // A music video: an artist id, no album, a 16:9 still that is better than the row's.
        request.mockResolvedValueOnce({ ...tileSong('a0000000003'), artists: [{ id: 'UCartist', name: 'YOASOBI' }], album: { id: '', name: '', coverUrl: 'https://i.ytimg.com/vi/a0000000003/hq720.jpg' } });
        expect(await catalog.resolveSongCatalogRefs!(video)).toMatchObject({
            artists: [{ id: 'UCartist' }], album: { id: '', coverUrl: 'https://i.ytimg.com/vi/a0000000003/hq720.jpg' },
        });
        const missing = normalizeYtmSong(tileSong('a0000000004'));
        request.mockResolvedValueOnce(null);
        expect(await catalog.resolveSongCatalogRefs!(missing)).toBe(missing);
        const offline = normalizeYtmSong(tileSong('a0000000005'));
        request.mockRejectedValueOnce(new Error('offline'));
        expect(await catalog.resolveSongCatalogRefs!(offline)).toBe(offline);
        expect(catalog.canResolveSongCatalogRefs!({ ...video, sourceRef: { kind: 'online', providerId: 'qq', mediaId: '1' } })).toBe(false);
    });

    it('serves an artist\'s detail, top songs and albums from one request', async () => {
        const albums = ['MPREb_1', 'MPREb_2', 'MPREb_3'].map(id => ({ id, type: 'album', name: id, coverUrl: '' }));
        request.mockResolvedValue({ collection: { id: 'UCartist', type: 'artist', name: 'Artist', coverUrl: 'c', description: 'd' }, songs: [wireSong('a0000000001')], albums });
        const catalog = ytmProvider.catalog!;
        expect(await catalog.getArtistDetail!('UCartist')).toMatchObject({ providerId: 'ytm', type: 'artist', name: 'Artist', albumCount: 3 });
        expect(await catalog.getArtistSongs!('UCartist', 10, 0)).toMatchObject({ items: [{ id: 'a0000000001' }], hasMore: false });
        expect(await catalog.getArtistAlbums!('UCartist', 2, 0)).toMatchObject({ items: [{ id: 'MPREb_1', type: 'album' }, { id: 'MPREb_2' }], total: 3, nextOffset: 2, hasMore: true });
        expect(await catalog.getArtistAlbums!('UCartist', 2, 2)).toMatchObject({ items: [{ id: 'MPREb_3' }], hasMore: false });
        expect(request).toHaveBeenCalledExactlyOnceWith('artist', { id: 'UCartist' });
    });

    it('asks again after a catalog page failed to load', async () => {
        request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ collection: { id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '' }, items: [] });
        await expect(ytmProvider.catalog!.getAlbumDetail!('MPREb_x')).rejects.toThrow('offline');
        expect(await ytmProvider.catalog!.getAlbumDetail!('MPREb_x')).toMatchObject({ name: 'Album' });
    });

    it('pages the account\'s playlists and albums, each list with its own cursor', async () => {
        request.mockImplementation(async (operation: string, params: { continuation?: string }) => {
            if (operation === 'user_playlists') {
                return params.continuation
                    ? { items: [{ id: 'PLtwo', type: 'playlist', name: 'Two', coverUrl: '' }] }
                    : { items: [{ id: 'LM', type: 'playlist', name: 'Liked Music', coverUrl: '', isLiked: true }], continuation: 'lists-2' };
            }
            return { items: [{ id: 'MPREb_x', type: 'album', name: 'Album', coverUrl: '', playlistId: 'OLAK5uy_x' }] };
        });
        const library = ytmProvider.library!;
        const first = await library.getUserPlaylists('user', 50, 0);
        expect(first).toMatchObject({ items: [{ id: 'LM', isLiked: true }], nextOffset: 1, hasMore: true });
        expect(await library.getUserAlbums!('user', 50, 0)).toMatchObject({ items: [{ id: 'MPREb_x', type: 'album' }], total: 1, hasMore: false });
        expect(await library.getUserPlaylists('user', 50, first.nextOffset)).toMatchObject({ items: [{ id: 'PLtwo' }], total: 2, hasMore: false });
        expect(request.mock.calls).toEqual([
            ['user_playlists', { continuation: undefined }], ['user_albums', { continuation: undefined }], ['user_playlists', { continuation: 'lists-2' }],
        ]);
    });
});
