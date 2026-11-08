import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmWebExplore.test.ts — the explore page of an account signed in through the web:
// the reader of the web client's pages (electron/ytm/webExplore.cjs), and the explore page paged
// over its answers. The fixtures (ytmWebExploreFixtures.json) are cut from the answers the web
// client gave a guest on 2026-10-08: a few entries a shelf, without menus, play overlays and
// tracking parameters; the home feed's token is made up. A guest is shown no artist's card, no
// mix and no podcast episode's row: those are a guest's card led somewhere else, with made-up ids.

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/ytm/ytmTransport', () => ({
    requestYtm: request, getYtmTransportAvailability: () => ({ configured: true }),
}));
import { ytmExplore } from '@/services/onlineMusic/ytm/ytmExplore';
import { resetYtmRecommendations, ytmRecommendations } from '@/services/onlineMusic/ytm/ytmRecommendations';
import i18n from '@/i18n/config';

const require = createRequire(import.meta.url);
const { createWebExplore, exploreItemFromEntry, readWebShelves } = require('../../../electron/ytm/webExplore.cjs');
const { ytmError } = require('../../../electron/ytm/errors.cjs');
const fixtures = require('./ytmWebExploreFixtures.json');

const shelvesOf = (answer: any) => (
    answer.contents?.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer ?? answer.continuationContents.sectionListContinuation
).contents;
const entry = (answer: unknown, shelf: number, place: number) => shelvesOf(answer)[shelf].musicCarouselShelfRenderer.contents[place];
const pageOf = (browseId: string, pageType: string) => ({ browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } });
// A guest's playlist card, led somewhere else.
const cardTo = (navigationEndpoint: Record<string, unknown>) => {
    const made = structuredClone(entry(fixtures.home, 2, 0));
    made.musicTwoRowItemRenderer.navigationEndpoint = navigationEndpoint;
    return made;
};
// YouTube as the fixtures: a page by its name, a further part of the home feed by its token.
const guestPages = { FEmusic_home: fixtures.home, 'home-part-2': fixtures.homeFurther, FEmusic_explore: fixtures.explore, FEmusic_charts: fixtures.charts };
const youtube = (answers: Record<string, unknown>) => vi.fn(async (body: { browseId?: string; continuation?: string }) => answers[body.browseId ?? body.continuation ?? '']);
const titlesOf = (page: { sections: Array<{ title: string }> }) => page.sections.map(section => section.title);

const art = expect.stringMatching(/^https:\/\/(yt3|lh3)\.googleusercontent\.com\/.+=w544-h544(-p)?-l90-rj$/);
const still = (videoId: string, file: string) => expect.stringMatching(new RegExp(`^https://i\\.ytimg\\.com/vi/${videoId}/${file}\\.jpg\\?sqp=`));

describe('YouTube Music web pages', () => {
    it('reads the row of a song with its artists and album by the ids of their pages, and its square art at full size', () => {
        expect(exploreItemFromEntry(entry(fixtures.home, 0, 0))).toEqual({ kind: 'song', song: {
            id: 'hlmE_MrxmE4', name: '要去什麼地方', artists: [{ id: 'UCGkj4uoWx_1BA2tF9Q-9Y6w', name: '田馥甄 Hebe Tien' }],
            album: { id: 'MPREb_u7qEnkYzhPn', name: '要去什麼地方', coverUrl: art }, durationMs: 0,
        } });
        // The words between two artists are no artist.
        expect(exploreItemFromEntry(entry(fixtures.explore, 3, 0)).song.artists).toEqual([
            { id: 'UCDpqylW4FIjfrqepHH6fVcw', name: '李佳薇' }, { id: 'UCkeXcJ0uEgItA6SMfreEubA', name: '张新成' },
        ]);
    });

    it('reads a video as a song with its still for a wide picture, in a row and on a card', () => {
        // A row: no album, and the views after the artist are no artist. Both are official music
        // videos, which the bridge shows as their songs where it can (asShown).
        expect(exploreItemFromEntry(entry(fixtures.explore, 3, 1))).toEqual({
            kind: 'song',
            song: { id: '1yBjFEpG3xQ', name: '要去什麼地方', artists: [{ id: 'UCGkj4uoWx_1BA2tF9Q-9Y6w', name: 'Hebe 田馥甄' }], album: { id: '', name: '', coverUrl: still('1yBjFEpG3xQ', 'hqdefault') }, durationMs: 0, video: true, officialVideo: true },
            wideCoverUrl: still('1yBjFEpG3xQ', 'hqdefault'),
        });
        // A card: the larger of its two stills. Its uploader's channel is no artist's page: a name alone.
        expect(exploreItemFromEntry(entry(fixtures.explore, 4, 0))).toEqual({
            kind: 'song',
            song: { id: '0lXbg9H42jc', name: 'No Era Para Mí | FireVolk', artists: [{ id: '', name: 'FireVolk' }], album: { id: '', name: '', coverUrl: still('0lXbg9H42jc', 'hq720') }, durationMs: 0, video: true, officialVideo: true },
            wideCoverUrl: still('0lXbg9H42jc', 'hq720'),
        });
        // Of two artists the line names, the one without a link is not read.
        expect(exploreItemFromEntry(entry(fixtures.explore, 4, 3)).song.artists).toEqual([{ id: 'UCJKREB2c3dO8dgdo8FtdO_A', name: 'Grupo Firme' }]);
    });

    it('reads what opens a page: an album with its artists, a playlist by its list\'s id, an artist from a card or a row', () => {
        expect(exploreItemFromEntry(entry(fixtures.homeFurther, 0, 0))).toEqual({ kind: 'collection', collection: {
            id: 'MPREb_YEPqr4JxylO', type: 'album', name: '我是真的爱上你', coverUrl: art, artists: [{ id: 'UCaISzPHm7uP3J69mt9_pFjA', name: '大头针R&B' }],
        } });
        // A playlist with a page is no mix, whatever its id begins with.
        expect(exploreItemFromEntry(entry(fixtures.home, 2, 0))).toEqual({ kind: 'collection', collection: {
            id: 'RDCLAK5uy_mjAJiE8flpX8OlujSbgylHKFYt-4smINE', type: 'playlist', name: '华语金曲重温', coverUrl: art,
        } });
        expect(exploreItemFromEntry(entry(fixtures.charts, 1, 0)).collection).toMatchObject({ id: 'PL4fGSI1pDJn6MIkp4QMHxyQjHqf_jAwJ0', type: 'playlist', coverUrl: expect.stringMatching(/=s576$/) });
        expect(exploreItemFromEntry(entry(fixtures.charts, 2, 0))).toEqual({ kind: 'collection', collection: { id: 'UCL2MDNdwEtV6aYUgNjFQGZA', type: 'artist', name: '周杰倫', coverUrl: art } });
        expect(exploreItemFromEntry(cardTo(pageOf('UCartist0000000001', 'MUSIC_PAGE_TYPE_ARTIST'))).collection).toMatchObject({ id: 'UCartist0000000001', type: 'artist', name: '华语金曲重温' });
        // The liked-music list is marked as it.
        expect(exploreItemFromEntry(cardTo(pageOf('VLLM', 'MUSIC_PAGE_TYPE_PLAYLIST'))).collection).toMatchObject({ id: 'LM', type: 'playlist', isLiked: true });
    });

    it('reads a list that plays instead of opening as a mix where its id begins with RD, else as a playlist', () => {
        expect(exploreItemFromEntry(cardTo({ watchPlaylistEndpoint: { playlistId: 'RDTMAK5uy_fixture' } }))).toEqual({ kind: 'collection', collection: {
            id: 'RDTMAK5uy_fixture', type: 'playlist', name: '华语金曲重温', coverUrl: art, mix: true,
        } });
        expect(exploreItemFromEntry(cardTo({ watchPlaylistEndpoint: { playlistId: 'PLfixture01' } })).collection).not.toHaveProperty('mix');
        // A card that plays one video is that song.
        expect(exploreItemFromEntry(cardTo({ watchEndpoint: { videoId: 'm9SMT5ipbxk' } }))).toMatchObject({ kind: 'song', song: { id: 'm9SMT5ipbxk', artists: [] } });
    });

    it.each([
        ['a link to a mood', shelvesOf(fixtures.explore)[2].musicCarouselShelfRenderer.contents[0]],
        ['a podcast episode\'s row', { musicMultiRowListItemRenderer: { title: { runs: [{ text: 'An episode' }] } } }],
        ['a card of a podcast episode\'s page', entry(fixtures.explore, 4, 2)],
        ['a channel that is no artist\'s', cardTo(pageOf('UCCTAmJyy3lwopWTqkZGNXXw', 'MUSIC_PAGE_TYPE_USER_CHANNEL'))],
        ['a malformed video id', cardTo({ watchEndpoint: { videoId: '../../etc' } })],
        ['an album\'s page under another kind of id', cardTo(pageOf('VLPLfixture01', 'MUSIC_PAGE_TYPE_ALBUM'))],
        ['a card that leads nowhere', cardTo({})],
        ['nothing', null],
    ])('leaves out %s', (_label, left) => {
        expect(exploreItemFromEntry(left)).toBeNull();
    });

    it('reads the shelves of a first answer and of a further part, without what is no shelf and a shelf left with no entry', () => {
        const home = readWebShelves(fixtures.home);
        // (Between the two: the invitation to pick artists.)
        expect(titlesOf(home)).toEqual(['猜你喜欢', 'Your fav decades, on repeat!']);
        expect(home.sections.map((section: any) => section.items.map((item: any) => item.kind))).toEqual([['song', 'song'], ['collection', 'collection']]);
        expect(home.continuation).toBe('home-part-2');
        const further = readWebShelves(fixtures.homeFurther);
        expect(titlesOf(further)).toEqual(['新曲上线', '为你推荐的精选播放列表']);
        expect(further).not.toHaveProperty('continuation');
        // The grid of links is no shelf; the shelf of moods has no entry left; one of the four videos is a podcast episode.
        const explore = readWebShelves(fixtures.explore);
        expect(explore.sections.map((section: any) => [section.title, section.items.length])).toEqual([['新专辑与单曲', 1], ['时下流行', 3], ['新音乐视频', 3]]);
        expect(titlesOf(readWebShelves(fixtures.charts))).toEqual(['视频排行榜', '最爱的音乐人']);
        // No shelf of these pages has further entries of its own.
        expect([home, further, explore].flatMap(page => page.sections).filter((section: any) => 'continuation' in section)).toEqual([]);
        // An answer in a shape not known here is no shelves.
        expect([readWebShelves({}), readWebShelves(null)]).toEqual([{ sections: [] }, { sections: [] }]);
    });

    it('goes from the home feed, part by part, to the explore page and the charts page, and ends there', async () => {
        const browse = youtube(guestPages);
        const web = createWebExplore({ browse, log: () => {} });
        const pages = [await web.page()];
        while (pages.at(-1).continuation) pages.push(await web.page(pages.at(-1).continuation));
        expect(browse.mock.calls.map(([body]) => body)).toEqual([{ browseId: 'FEmusic_home' }, { continuation: 'home-part-2' }, { browseId: 'FEmusic_explore' }, { browseId: 'FEmusic_charts' }]);
        // The feed names its own further part; the pages after it are named by the reader.
        expect(pages.map(page => page.continuation)).toEqual(['home-part-2', 'FEmusic_explore', 'FEmusic_charts', undefined]);
        expect(pages.map(titlesOf)).toEqual([
            ['猜你喜欢', 'Your fav decades, on repeat!'], ['新曲上线', '为你推荐的精选播放列表'], ['新专辑与单曲', '时下流行', '新音乐视频'], ['视频排行榜', '最爱的音乐人'],
        ]);
        // An album of the feed under another heading on the explore page is that page's shelf.
        expect(pages[2].sections[0].items[0].collection.id).toBe(pages[1].sections[0].items[0].collection.id);
    });

    it('passes over a page after the feed that YouTube refuses, and fails on a refused feed, a sign-in no longer taken and a network that fails', async () => {
        const refusing = (failure: unknown, refused: string) => vi.fn(async (body: { browseId?: string; continuation?: string }) => {
            const asked = body.browseId ?? body.continuation ?? '';
            if (asked === refused) throw failure;
            return (guestPages as Record<string, unknown>)[asked];
        });
        const warn = vi.fn();
        const web = createWebExplore({ browse: refusing(new Error('Request to https://music.youtube.com/x failed with status code 400'), 'FEmusic_explore'), log: () => {}, warn });
        // The page after it is still reached.
        expect(await web.page('FEmusic_explore')).toEqual({ sections: [], continuation: 'FEmusic_charts' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).not.toContain('music.youtube.com');

        for (const [failure, refused] of [
            [new Error('status code 400'), 'FEmusic_home'],
            [ytmError('auth-required', 'YouTube Music sign-in is no longer valid'), 'FEmusic_explore'],
            [new Error('fetch failed'), 'FEmusic_charts'],
        ] as const) {
            const read = createWebExplore({ browse: refusing(failure, refused), log: () => {}, warn }).page(refused === 'FEmusic_home' ? undefined : refused);
            await expect(read).rejects.toBe(failure);
        }
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('answers a shelf once in a read: not a later page\'s with the same heading and the same entries', async () => {
        // A further part with the first part's shelves again: one with its entries the other way round, one with an entry fewer.
        const [songs, , lists] = structuredClone(shelvesOf(fixtures.home));
        songs.musicCarouselShelfRenderer.contents.reverse();
        lists.musicCarouselShelfRenderer.contents.pop();
        const log = vi.fn();
        const web = createWebExplore({ browse: youtube({ ...guestPages, 'home-part-2': { continuationContents: { sectionListContinuation: { contents: [songs, lists] } } } }), log });
        const first = await web.page();
        const second = await web.page(first.continuation);
        expect(second.sections.map((section: any) => [section.title, section.items.length])).toEqual([['Your fav decades, on repeat!', 1]]);
        expect(second.continuation).toBe('FEmusic_explore');
        expect(log).toHaveBeenLastCalledWith('[Ytm] Explore page as the web client (FEmusic_home, a further part): 1 shelves, 1 entries; 1 shelves met before left out; a page follows');
        // The page asked for from its start is a read of its own.
        expect(titlesOf(await web.page())).toEqual(titlesOf(first));
        expect(log).toHaveBeenLastCalledWith('[Ytm] Explore page as the web client (FEmusic_home): 2 shelves, 4 entries; 0 shelves met before left out; a page follows');
    });

    it('keeps the shelves of an answer that arrives after the page was asked for from its start again out of the new read', async () => {
        let answerLate!: (value: unknown) => void;
        const browse = youtube(guestPages);
        const web = createWebExplore({ browse, log: () => {} });
        const first = await web.page();
        browse.mockReturnValueOnce(new Promise(resolve => { answerLate = resolve; }));
        const late = web.page(first.continuation);
        const again = await web.page();
        answerLate(fixtures.homeFurther);
        expect(titlesOf(await late)).toEqual(['新曲上线', '为你推荐的精选播放列表']);
        // The new read's own further part is not taken for met before.
        expect(titlesOf(await web.page(again.continuation))).toEqual(['新曲上线', '为你推荐的精选播放列表']);
    });
});

// The desktop side as it is to be wired: the `explore` operation hands its token to the web
// reader. A song's radio is the song and twelve more, the same twelve for every song.
const signedInThroughTheWeb = () => {
    const web = createWebExplore({ browse: youtube(guestPages), log: () => {} });
    const radioSong = (id: string) => ({ id, name: `song ${id}`, artists: [], album: { id: '', name: '', coverUrl: '' }, durationMs: 1000 });
    request.mockImplementation(async (operation: string, params: { continuation?: string; videoId?: string } = {}) => {
        if (operation === 'explore') return web.page(params.continuation);
        if (operation === 'mix') return { items: [params.videoId!, ...Array.from({ length: 12 }, (_, index) => `radio${String(index).padStart(6, '0')}`)].map(radioSong) };
        throw new Error(`unexpected ${operation}`);
    });
};
const asked = (operation: string) => request.mock.calls.filter(([name]) => name === operation);

describe('YouTube Music explore page over the web client\'s answers', () => {
    beforeEach(() => {
        request.mockReset();
        resetYtmRecommendations();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('asks for each further page with the cursor of the page before it, to the last, and goes on with the shelves made here', async () => {
        signedInThroughTheWeb();
        const first = await ytmExplore.getFeed();
        expect(titlesOf(first)).toEqual(['猜你喜欢', 'Your fav decades, on repeat!']);
        // (A cursor is the token as it came, with the number of the read it is of.)
        expect(first.nextCursor).toMatch(/^\d+:home-part-2$/);
        expect(first.sections[0].items[0]).toMatchObject({ kind: 'song', song: {
            id: 'hlmE_MrxmE4', sourceRef: { kind: 'online', providerId: 'ytm', mediaId: 'hlmE_MrxmE4' },
            artists: [{ id: 'UCGkj4uoWx_1BA2tF9Q-9Y6w', catalogRef: { providerId: 'ytm', kind: 'artist', id: 'UCGkj4uoWx_1BA2tF9Q-9Y6w' } }],
            album: { id: 'MPREb_u7qEnkYzhPn', catalogRef: { providerId: 'ytm', kind: 'album', id: 'MPREb_u7qEnkYzhPn' } },
        } });
        expect(first.sections[1].items[0]).toMatchObject({ kind: 'collection', collection: { providerId: 'ytm', id: 'RDCLAK5uy_mjAJiE8flpX8OlujSbgylHKFYt-4smINE', type: 'playlist' } });
        expect(first.sections[1].items[0]).not.toHaveProperty('isMix');

        // A further page comes with a shelf made here: the songs like a song of the page before.
        const second = await ytmExplore.getFeed(first.nextCursor);
        const [, seed] = asked('mix')[0] as [string, { id: string; videoId: string }];
        expect(['hlmE_MrxmE4', '35xRyC7JwqA']).toContain(seed.videoId);
        expect(seed.id).toBe(`RDAMVM${seed.videoId}`);
        expect(titlesOf(second)).toEqual([i18n.t('home.exploreSimilar', { name: `song ${seed.videoId}` }), '新曲上线', '为你推荐的精选播放列表']);
        expect(second.sections[0].items).toHaveLength(12);
        expect(second.nextCursor).toMatch(/^\d+:FEmusic_explore$/);

        const third = await ytmExplore.getFeed(second.nextCursor);
        expect(titlesOf(third)).toEqual(['新专辑与单曲', '时下流行', '新音乐视频']);
        // A video's wide picture comes through.
        expect(third.sections[2].items.map(item => item.wideCoverUrl)).toEqual([still('0lXbg9H42jc', 'hq720'), still('wjWud5YXNT4', 'hq720'), still('_Jad5guA7jQ', 'hq720')]);
        expect(third.nextCursor).toMatch(/^\d+:FEmusic_charts$/);

        const last = await ytmExplore.getFeed(third.nextCursor);
        expect(titlesOf(last)).toEqual(['视频排行榜', '最爱的音乐人']);
        expect(last.sections[1].items[0]).toMatchObject({ kind: 'collection', collection: { providerId: 'ytm', id: 'UCL2MDNdwEtV6aYUgNjFQGZA', type: 'artist' } });
        expect(asked('explore')).toEqual([['explore', {}], ['explore', { continuation: 'home-part-2' }], ['explore', { continuation: 'FEmusic_explore' }], ['explore', { continuation: 'FEmusic_charts' }]]);
        // YouTube's pages have ended: what follows is the shelves made here.
        expect(last.nextCursor).toMatch(/^\d+:radios after 3$/);
        // No shelf of YouTube's has further entries of its own (nor has the one made here, of twelve songs).
        expect([first, second, third, last].flatMap(page => page.sections).filter(section => section.moreCursor)).toEqual([]);

        // A cursor of a read before is answered with nothing, and YouTube is not asked with it.
        await ytmExplore.getFeed();
        request.mockClear();
        expect(await ytmExplore.getFeed(second.nextCursor)).toEqual({ sections: [] });
        expect(request).not.toHaveBeenCalled();
    });

    it('asks with another song in each read from the start: of the songs at hand, the one asked with longest ago', async () => {
        signedInThroughTheWeb();
        // The shelf beside the second page, in four reads in a row. The songs to ask with are the first page's two.
        const seeds: string[] = [];
        for (let read = 0; read < 4; read += 1) {
            const first = await ytmExplore.getFeed();
            request.mockClear();
            await ytmExplore.getFeed(first.nextCursor);
            seeds.push((asked('mix')[0][1] as { videoId: string }).videoId);
        }
        expect(seeds).toEqual(['hlmE_MrxmE4', '35xRyC7JwqA', 'hlmE_MrxmE4', '35xRyC7JwqA']);
    });

    it('gives the radio tab the playlists of the web answer\'s first page', async () => {
        signedInThroughTheWeb();
        const lists = await ytmRecommendations.getRecommendedCollections!(35);
        expect(lists.map(found => found.id)).toEqual(['RDCLAK5uy_mjAJiE8flpX8OlujSbgylHKFYt-4smINE', 'RDCLAK5uy_lMzHW51iFg1Kx0d_2EHpzbOgCrwtu8cgI']);
        expect(lists[0]).toMatchObject({ providerId: 'ytm', type: 'playlist', name: '华语金曲重温' });
        expect(request.mock.calls).toEqual([['explore', {}]]);
    });
});
