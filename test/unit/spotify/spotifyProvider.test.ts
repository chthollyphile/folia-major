import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyProvider.test.ts — the Spotify adapter against rows shaped as Spotify's
// queries gave them on 2026-10-08: what a row becomes, and how lists are paged.

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    querySpotify: (name: string, variables: Record<string, unknown> = {}) => request('query', { name, variables }),
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { omni } from '@/services/onlineMusic/omni';
import { spotifyProvider } from '@/services/onlineMusic/spotify/spotifyProvider';
import { clearSpotifyCatalogCache } from '@/services/onlineMusic/spotify/spotifyCatalog';
import { normalizeSpotifyCollection, normalizeSpotifySong, spotifyPlaylistOf, spotifySongOf } from '@/services/onlineMusic/spotify/spotifyNormalize';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { ProviderExploreItem } from '@/types/onlineMusic';

const id = (letter: string) => letter.repeat(22);
const cover = [{ url: 'https://i.scdn.co/image/small', width: 64 }, { url: 'https://i.scdn.co/image/large', width: 640 }, { url: 'https://i.scdn.co/image/mid', width: 300 }];
const artist = (letter = 'r') => ({ uri: `spotify:artist:${id(letter)}`, profile: { name: `Artist ${letter}` } });
const track = (letter: string, extra: Record<string, unknown> = {}) => ({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name: `Song ${letter}`, artists: { items: [artist()] },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: cover } }, duration: { totalMilliseconds: 201000 }, ...extra,
});
const playlist = (letter: string, extra: Record<string, unknown> = {}) => ({
    __typename: 'Playlist', uri: `spotify:playlist:${id(letter)}`, name: `List ${letter}`, description: 'By <a href="spotify:playlist:x">A &amp; B</a>',
    images: { items: [{ sources: [{ url: 'https://i.scdn.co/image/list', width: null }] }] }, ownerV2: { data: { name: 'Spotify' } }, ...extra,
});
// The query a call sent, by its name.
const sent = (name: string) => request.mock.calls.filter(call => call[0] === 'query' && call[1].name === name).map(call => call[1].variables);
const answerQueries = (answers: Record<string, (variables: any) => unknown>) => request.mockImplementation(async (operation: string, params: any) => {
    if (operation !== 'query' || !answers[params.name]) throw new Error(`unexpected ${operation} ${params?.name}`);
    return answers[params.name](params.variables);
});

beforeEach(() => {
    request.mockReset();
    clearSpotifyCatalogCache();
});

describe('Spotify rows', () => {
    it('gives a song its identity, its largest cover, and links to its artist and album', () => {
        const song = normalizeSpotifySong(track('a'));
        expect(song).toMatchObject({
            id: id('a'), name: 'Song a', durationMs: 201000, sourceRef: { kind: 'online', providerId: 'spotify', mediaId: id('a') },
            artists: [{ id: id('r'), name: 'Artist r', catalogRef: { providerId: 'spotify', kind: 'artist', id: id('r') } }],
            album: { id: id('m'), name: 'Album', coverUrl: 'https://i.scdn.co/image/large', catalogRef: { providerId: 'spotify', kind: 'album', id: id('m') } },
        });
        expect(getPlaybackSongKey(song)).toBe(`online:spotify:${id('a')}`);
        expect(normalizeSpotifySong(song)).toBe(song);
        expect(() => normalizeSpotifySong({})).toThrow('no id');
    });

    it('reads a track the way each query leaves parts of it out', () => {
        // A liked song has its uri beside it; a playlist row names its length differently.
        expect(spotifySongOf({ ...track('a'), uri: undefined }, { uri: `spotify:track:${id('b')}` })?.id).toBe(id('b'));
        expect(spotifySongOf(track('a', { duration: undefined, trackDuration: { totalMilliseconds: 99000 } }))?.durationMs).toBe(99000);
        // An album's track has no album of its own.
        const of = { id: id('m'), name: 'Read from', coverUrl: 'https://i.scdn.co/image/large' };
        expect(spotifySongOf(track('a', { albumOfTrack: undefined }), { album: of })?.album).toBe(of);
        // A podcast episode in a playlist, and a row Spotify could not resolve, are not songs.
        expect(spotifySongOf(track('a', { __typename: 'Episode' }))).toBeNull();
        expect(spotifySongOf({ __typename: 'NotFound' })).toBeNull();
        expect(spotifySongOf(null)).toBeNull();
    });

    it('turns a playlist row into a card: plain description, the owner, and "own" where the account may edit it', () => {
        expect(spotifyPlaylistOf(playlist('p'))).toEqual({
            providerId: 'spotify', id: id('p'), type: 'playlist', name: 'List p', coverUrl: 'https://i.scdn.co/image/list',
            description: 'By A & B', creator: { id: '', nickname: 'Spotify' },
        });
        expect(spotifyPlaylistOf(playlist('p', { currentUserCapabilities: { canEditItems: true }, content: { totalCount: 7 } }))).toMatchObject({ isOwned: true, trackCount: 7 });
        expect(spotifyPlaylistOf({ __typename: 'NotFound' })).toBeNull();
        const album = normalizeSpotifyCollection({ __typename: 'Album', uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: cover }, artists: { items: [artist()] }, date: { isoString: '2020-03-04T00:00:00Z' }, tracks: { totalCount: 12 } }, 'album');
        expect(album).toMatchObject({ type: 'album', trackCount: 12, publishedAt: Date.UTC(2020, 2, 4), artists: [{ id: id('r') }] });
        expect(normalizeSpotifyCollection(album)).toBe(album);
    });
});

describe('Spotify lists', () => {
    it('puts the liked songs first among the playlists, on the first page only, and leaves folders out', async () => {
        answerQueries({
            libraryV3: () => ({ me: { libraryV3: { totalCount: 3, items: [{ item: { data: playlist('p') } }, { item: { data: { __typename: 'Folder', uri: 'spotify:user:x:folder:y' } } }, { item: { data: playlist('q') } }] } } }),
            fetchLibraryTracks: () => ({ me: { library: { tracks: { totalCount: 23, items: [{ track: { _uri: `spotify:track:${id('a')}`, data: track('a', { uri: undefined }) } }] } } } }),
        });
        const first = await spotifyProvider.library!.getUserPlaylists('me', 50, 0);
        expect(first.items.map(item => item.id)).toEqual(['liked', id('p'), id('q')]);
        expect(first.items[0]).toMatchObject({ isLiked: true, isOwned: true, trackCount: 23, coverUrl: 'https://i.scdn.co/image/large' });
        expect(first).toMatchObject({ nextOffset: 3, hasMore: false });
        request.mockClear();
        const later = await spotifyProvider.library!.getUserPlaylists('me', 50, 50);
        expect(later.items.map(item => item.id)).toEqual([id('p'), id('q')]);
        expect(sent('fetchLibraryTracks')).toEqual([]);
    });

    it('pages a playlist by Spotify\'s own rows, so a row that is not a song does not shift the next page', async () => {
        answerQueries({ fetchPlaylist: () => ({ playlistV2: { __typename: 'Playlist', content: { totalCount: 5, items: [
            { itemV2: { data: track('a') } }, { itemV2: { data: track('e', { __typename: 'Episode' }) } }, { itemV2: { data: track('b') } },
        ] } } }) });
        const page = await spotifyProvider.catalog!.getPlaylistTracks!(id('p'), 3, 0);
        expect(page.items.map(song => song.id)).toEqual([id('a'), id('b')]);
        expect(page).toMatchObject({ total: 5, nextOffset: 3, hasMore: true });
        expect(sent('fetchPlaylist')[0]).toMatchObject({ uri: `spotify:playlist:${id('p')}`, offset: 0, limit: 3 });
    });

    it('reads the liked songs as a playlist of their own, and reports a playlist Spotify does not have', async () => {
        answerQueries({
            fetchLibraryTracks: variables => ({ me: { library: { tracks: { totalCount: 12, items: [{ track: { _uri: `spotify:track:${id('a')}`, data: track('a', { uri: undefined }) } }] } } }, variables }),
            fetchPlaylist: () => ({ playlistV2: { __typename: 'NotFound' } }),
        });
        const page = await spotifyProvider.catalog!.getPlaylistTracks!('liked', 10, 10);
        expect(page).toMatchObject({ total: 12, nextOffset: 11, hasMore: true });
        expect(page.items[0].id).toBe(id('a'));
        expect(sent('fetchLibraryTracks')).toEqual([{ offset: 10, limit: 10 }]);
        await expect(spotifyProvider.catalog!.getPlaylistTracks!(id('z'), 10, 0)).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('names an album\'s songs after the album they were read from, with one request for header and songs', async () => {
        answerQueries({ getAlbum: () => ({ albumUnion: {
            __typename: 'Album', uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: cover }, artists: { items: [artist()] },
            tracksV2: { totalCount: 2, items: [{ track: track('a', { albumOfTrack: undefined }) }, { track: track('b', { albumOfTrack: undefined }) }] },
        } }) });
        expect(await spotifyProvider.catalog!.getAlbumDetail!(id('m'))).toMatchObject({ name: 'Album', trackCount: 2 });
        const page = await spotifyProvider.catalog!.getAlbumTracks!(id('m'), 50, 0);
        expect(page.items.map(song => song.album)).toEqual([expect.objectContaining({ id: id('m'), name: 'Album', coverUrl: 'https://i.scdn.co/image/large' }), expect.objectContaining({ id: id('m') })]);
        expect(page).toMatchObject({ total: 2, hasMore: false });
        expect(sent('getAlbum')).toHaveLength(1);
    });

    it('gives each found song once across the pages of a search, though Spotify\'s pages repeat rows', async () => {
        const rows = (letters: string) => ({ searchV2: { tracksV2: { totalCount: 4, items: [...letters].map(letter => ({ item: { data: track(letter) } })) } } });
        answerQueries({ searchTracks: variables => (variables.offset === 0 ? rows('abc') : variables.offset === 3 ? rows('bcd') : rows('bcd')) });
        const first = await spotifyProvider.search!.searchSongs(' love ', 3, 0);
        expect(first.items.map(song => song.id)).toEqual([id('a'), id('b'), id('c')]);
        expect(first).toMatchObject({ nextOffset: 3, hasMore: true });
        const second = await spotifyProvider.search!.searchSongs('love', 3, first.nextOffset);
        expect(second.items.map(song => song.id)).toEqual([id('d')]);
        expect(second).toMatchObject({ nextOffset: 4, hasMore: true });
        // The next rows are asked for where Spotify's own rows ended, not where the songs given ended.
        const third = await spotifyProvider.search!.searchSongs('love', 3, second.nextOffset);
        expect(third).toMatchObject({ items: [], hasMore: false });
        expect(sent('searchTracks').map(variables => [variables.searchTerm, variables.offset])).toEqual([['love', 0], ['love', 3], ['love', 6]]);
        expect(await spotifyProvider.search!.searchSongs('  ', 3, 0)).toMatchObject({ items: [], hasMore: false });
    });

    it('goes on with a search it left for another one, and walks one it does not hold from its start', async () => {
        const rows = (letters: string) => ({ searchV2: { tracksV2: { items: [...letters].map(letter => ({ item: { data: track(letter) } })) } } });
        answerQueries({ searchTracks: variables => (variables.searchTerm === 'other' ? rows('xyz') : variables.offset === 0 ? rows('abc') : variables.offset === 3 ? rows('bcd') : rows('def')) });
        const search = spotifyProvider.search!.searchSongs;
        const first = await search('rain', 3, 0);
        await search('other', 3, 0);
        // Back at the first search: the next rows are Spotify's rows 3 on, and what they repeat is left out.
        const next = await search('rain', 3, first.nextOffset);
        expect(next.items.map(song => song.id)).toEqual([id('d')]);
        // Two calls for one page at once get the same page, from one request.
        request.mockClear();
        const [one, two] = await Promise.all([search('rain', 3, next.nextOffset), search('rain', 3, next.nextOffset)]);
        expect(one.items.map(song => song.id)).toEqual([id('e'), id('f')]);
        expect(two.items).toEqual(one.items);
        expect(sent('searchTracks').map(variables => variables.offset)).toEqual([6]);
        // A search never begun here, asked from its middle (the list on screen was kept elsewhere).
        request.mockClear();
        const middle = await search('snow', 3, 3);
        expect(middle.items.map(song => song.id)).toEqual([id('d')]);
        expect(sent('searchTracks').map(variables => variables.offset)).toEqual([0, 3]);
    });

    it('holds a search read past its first page while one-page lookups come and go', async () => {
        const rows = (letters: string) => ({ searchV2: { tracksV2: { items: [...letters].map(letter => ({ item: { data: track(letter) } })) } } });
        answerQueries({ searchTracks: variables => (variables.searchTerm !== 'tide' ? rows('xyz') : variables.offset === 0 ? rows('abc') : variables.offset === 3 ? rows('def') : rows('ghi')) });
        const search = spotifyProvider.search!.searchSongs;
        const first = await search('tide', 3, 0);
        const second = await search('tide', 3, first.nextOffset);
        // More one-page lookups (a song's lyrics each) than searches are held.
        for (let lookup = 0; lookup < 9; lookup += 1) await search(`lookup ${lookup}`, 3, 0);
        request.mockClear();
        const third = await search('tide', 3, second.nextOffset);
        expect(third.items.map(song => song.id)).toEqual([id('g'), id('h'), id('i')]);
        // Gone on from where it was, not walked again from its start.
        expect(sent('searchTracks').map(variables => variables.offset)).toEqual([6]);
    });

    // A mod reading through `folium.omni` names its session: its searches neither start the
    // listener's search over nor push it out, however many it makes.
    it('keeps a session\'s searches apart from the host\'s own, under a bound of their own', async () => {
        const rows = (letters: string) => ({ searchV2: { tracksV2: { items: [...letters].map(letter => ({ item: { data: track(letter) } })) } } });
        answerQueries({ searchTracks: variables => (variables.searchTerm !== 'calm' ? rows('xyz') : variables.offset === 0 ? rows('abc') : variables.offset === 3 ? rows('def') : rows('ghi')) });
        const search = spotifyProvider.search!.searchSongs;
        const mod = { session: 'folium:mod-a' };
        const first = await search('calm', 3, 0);
        // The mod reads the same search from its first page, then its second.
        const modFirst = await search('calm', 3, 0, mod);
        expect(modFirst.items.map(song => song.id)).toEqual([id('a'), id('b'), id('c')]);
        request.mockClear();
        const modSecond = await search('calm', 3, modFirst.nextOffset, mod);
        expect(modSecond.items.map(song => song.id)).toEqual([id('d'), id('e'), id('f')]);
        expect(sent('searchTracks').map(variables => variables.offset)).toEqual([3]);
        // The listener's search goes on where it was: not begun anew by the mod's first page.
        request.mockClear();
        const second = await search('calm', 3, first.nextOffset);
        expect(second.items.map(song => song.id)).toEqual([id('d'), id('e'), id('f')]);
        expect(sent('searchTracks').map(variables => variables.offset)).toEqual([3]);
        // Sessions page through many more searches than either side holds; only theirs make room.
        for (let lookup = 0; lookup < 40; lookup += 1) {
            const session = { session: `folium:mod-${lookup % 3}` };
            const page = await search(`mod lookup ${lookup}`, 3, 0, session);
            await search(`mod lookup ${lookup}`, 3, page.nextOffset, session);
        }
        request.mockClear();
        const third = await search('calm', 3, second.nextOffset);
        expect(third.items.map(song => song.id)).toEqual([id('g'), id('h'), id('i')]);
        expect(sent('searchTracks').map(variables => variables.offset)).toEqual([6]);
    });

    it('reads past a page of rows that are no songs, which the app would take for the end of the list', async () => {
        const episodes = [1, 2, 3].map(() => ({ itemV2: { data: track('e', { __typename: 'Episode' }) } }));
        answerQueries({ fetchPlaylist: variables => ({ playlistV2: { __typename: 'Playlist', content: { totalCount: 7,
            items: variables.offset === 0 ? episodes : variables.offset === 3 ? [{ itemV2: { data: track('a') } }, ...episodes.slice(0, 2)] : [{ itemV2: { data: track('b') } }] } } }) });
        const page = await spotifyProvider.catalog!.getPlaylistTracks!(id('p'), 3, 0);
        expect(page.items.map(song => song.id)).toEqual([id('a')]);
        expect(page).toMatchObject({ total: 7, nextOffset: 6, hasMore: true });
        expect(sent('fetchPlaylist').map(variables => variables.offset)).toEqual([0, 3]);
        // A list of nothing but such rows ends, after the pages one call may read.
        answerQueries({ fetchPlaylist: () => ({ playlistV2: { __typename: 'Playlist', content: { totalCount: 1000, items: episodes } } }) });
        request.mockClear();
        expect(await spotifyProvider.catalog!.getPlaylistTracks!(id('q'), 3, 0)).toMatchObject({ items: [], nextOffset: 15 });
        expect(sent('fetchPlaylist')).toHaveLength(5);
    });

    it('takes an id only from a uri of the kind it expects', () => {
        expect(spotifySongOf(track('a', { uri: 'spotify:local:Artist:Album:Title:201' }))).toBeNull();
        expect(spotifySongOf(track('a', { uri: 42 }))).toBeNull();
        expect(spotifyPlaylistOf(playlist('p', { uri: `spotify:user:someone:playlist:${id('p')}` }))?.id).toBe(id('p'));
        expect(spotifyPlaylistOf(playlist('p', { uri: `spotify:album:${id('p')}` }))).toBeNull();
    });
});

describe('Spotify explore page', () => {
    const card = (kind: 'Playlist' | 'Album' | 'Artist', letter: string) => ({ uri: 'x', content: { data:
        kind === 'Playlist' ? playlist(letter) : kind === 'Album' ? { __typename: 'Album', uri: `spotify:album:${id(letter)}`, name: 'Album', coverArt: { sources: cover } }
            : { __typename: 'Artist', ...artist(letter) } } });
    const section = (uri: string, items: unknown[], extra: Record<string, unknown> = {}) => ({
        uri, data: { __typename: 'HomeGenericSectionData', title: { transformedLabel: `Title ${uri}` } }, sectionItems: { totalCount: items.length, items }, ...extra,
    });

    it('makes a section of each of Spotify\'s, without its listening record, its unreadable cards and its empty sections', async () => {
        answerQueries({ home: () => ({ home: { sectionContainer: { sections: { items: [
            section('s:1', [card('Playlist', 'p'), card('Album', 'm'), card('Artist', 'r'), { uri: 'y', content: { data: { __typename: 'NotFound' } } }], { sectionItems: { totalCount: 30, items: [card('Playlist', 'p'), card('Album', 'm'), card('Artist', 'r'), { content: { data: { __typename: 'NotFound' } } }] } }),
            section('s:2', [card('Playlist', 'q')], { data: { __typename: 'HomeRecentlyPlayedSectionData', title: { transformedLabel: 'Recently played' } } }),
            section('s:3', [{ content: { data: { __typename: 'Episode' } } }]),
            section('s:4', [card('Album', 'n')]),
        ] } } } }) });
        const feed = await spotifyProvider.explore!.getFeed();
        expect(feed.sections.map(shelf => [shelf.id, shelf.title, shelf.items.map(item => item.kind === 'collection' && item.collection.type), shelf.moreCursor])).toEqual([
            ['s:1', 'Title s:1', ['playlist', 'album', 'artist'], 'section s:1'],
            ['s:4', 'Title s:4', ['album'], undefined],
        ]);
        expect(await spotifyProvider.explore!.getFeed('anything')).toEqual({ sections: [] });
    });

    it('answers "more" of a section with the entries its own query adds to what the page gave', async () => {
        answerQueries({
            home: () => ({ home: { sectionContainer: { sections: { items: [section('s:1', [card('Playlist', 'p'), card('Playlist', 'q')], { sectionItems: { totalCount: 50, items: [card('Playlist', 'p'), card('Playlist', 'q')] } })] } } } }),
            homeSection: () => ({ homeSections: { sections: [section('s:1', [card('Playlist', 'q'), card('Playlist', 't'), card('Playlist', 'p'), card('Album', 'm')])] } }),
        });
        const feed = await spotifyProvider.explore!.getFeed();
        const more = await spotifyProvider.explore!.getSectionItems!(feed.sections[0].moreCursor!);
        expect(more.items.map(item => item.kind === 'collection' && item.collection.id)).toEqual([id('t'), id('m')]);
        expect(more.moreCursor).toBeUndefined();
        expect(sent('homeSection')[0]).toMatchObject({ uri: 's:1' });
        expect(await spotifyProvider.explore!.getSectionItems!('of another provider')).toEqual({ items: [] });
    });

    const home = (sections: unknown[]) => ({ home: { sectionContainer: { sections: { items: sections } } } });
    const feature = { content: { data: { __typename: 'BrowseClientFeature' } } };

    it('goes on, after the home page, with the new releases and the lists Spotify makes for the account, each section once', async () => {
        const answers = {
            home: () => home([section('s:1', [card('Playlist', 'p')])]),
            browsePage: (): unknown => ({ browse: { sections: { items: [
                // On the home page already; a section with more than it gave; one with nothing the app shows.
                section('s:1', [card('Playlist', 'p')]),
                section('s:5', [card('Playlist', 'q'), feature], { sectionItems: { totalCount: 40, items: [card('Playlist', 'q'), feature] } }),
                section('s:6', [feature]),
            ] } } }),
            queryWhatsNewFeed: (): unknown => ({ whatsNewFeedItems: { items: [card('Album', 'n')] } }),
        };
        answerQueries(answers);
        const first = await spotifyProvider.explore!.getFeed();
        const next = await spotifyProvider.explore!.getFeed(first.nextCursor);
        expect(next.sections.map(shelf => [shelf.id, shelf.items.map(item => item.kind === 'collection' && item.collection.type), shelf.moreCursor])).toEqual([
            ['spotify-new-releases', ['album'], undefined],
            ['s:5', ['playlist'], 'made s:5 2'],
        ]);
        expect(next.nextCursor).toBeDefined();
        expect(sent('browsePage')[0]).toMatchObject({ uri: 'spotify:page:0JQ5DAt0tbjZptfcdMSKl3', sectionPagination: { offset: 0, limit: 20 } });

        // The new releases cannot be read: the page is the account's lists.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        answers.queryWhatsNewFeed = () => { throw new Error('refused'); };
        expect((await spotifyProvider.explore!.getFeed(first.nextCursor)).sections.map(shelf => shelf.id)).toEqual(['s:5']);
        // A query for the lists that Spotify no longer answers does not end the list there; offline, the page fails and can be asked for again.
        answers.browsePage = () => { throw new OnlineProviderError('invalid-response', 'PersistedQueryNotFound', 'spotify'); };
        expect(await spotifyProvider.explore!.getFeed(first.nextCursor)).toMatchObject({ sections: [], nextCursor: next.nextCursor });
        answers.browsePage = () => { throw new OnlineProviderError('network', 'offline', 'spotify'); };
        await expect(spotifyProvider.explore!.getFeed(first.nextCursor)).rejects.toMatchObject({ code: 'network' });
    });

    it('pages a section of the account\'s lists by Spotify\'s own rows, to the section\'s end', async () => {
        const rows = [card('Playlist', 't'), { content: { data: { __typename: 'NotFound' } } }, card('Playlist', 'u')];
        answerQueries({ browsePage: variables => ({ browse: { sections: { items: [
            section('s:9', [card('Playlist', 'a')]),
            section('s:5', rows, { sectionItems: { totalCount: variables.sectionPagination.offset === 2 ? 40 : 8, items: rows } }),
        ] } } }) });
        const more = await spotifyProvider.explore!.getSectionItems!('made s:5 2');
        expect(more.items.map(item => item.kind === 'collection' && item.collection.id)).toEqual([id('t'), id('u')]);
        expect(more.moreCursor).toBe('made s:5 5');
        expect(sent('browsePage')[0]).toMatchObject({ sectionPagination: { offset: 2, limit: 20 } });
        expect((await spotifyProvider.explore!.getSectionItems!(more.moreCursor!)).moreCursor).toBeUndefined();
    });

    // A song of the radios below: its id is a number, so that there are as many as a shelf needs.
    const sid = (n: number) => String(n).padStart(22, '0');
    const numbered = (n: number) => track('a', { uri: `spotify:track:${sid(n)}`, name: `Song ${n}` });
    const songIds = (items: ProviderExploreItem[]) => items.map(item => (item.kind === 'song' ? Number(item.song.id) : NaN));
    const range = (from: number, count: number) => Array.from({ length: count }, (_unused, at) => from + at);
    // Every song's radio is the song itself, then `songs(seed)`.
    const answerRadios = (liked: number[], songs: (seed: number) => number[]) => request.mockImplementation(async (operation: string, params: any) => {
        if (operation === 'radio') return { uri: `spotify:playlist:${sid(Number(params.id))}` };
        const { name, variables } = params;
        if (name === 'home') return home([]);
        if (name === 'browsePage' || name === 'queryWhatsNewFeed') return {};
        if (name === 'fetchLibraryTracks') return { me: { library: { tracks: { totalCount: liked.length, items: liked.map(n => ({ track: { _uri: `spotify:track:${sid(n)}`, data: { ...numbered(n), uri: undefined } } })) } } } };
        const seed = Number(String(variables.uri).split(':')[2]);
        const rows = [seed, ...songs(seed)].map(n => ({ itemV2: { data: numbered(n) } }));
        return { playlistV2: { __typename: 'Playlist', content: { totalCount: rows.length, items: rows } } };
    });
    const radioPage = async (listened: number[] = []) => {
        const first = await spotifyProvider.explore!.getFeed(undefined, listened.map(n => normalizeSpotifySong(numbered(n))));
        const made = await spotifyProvider.explore!.getFeed(first.nextCursor);
        request.mockClear();
        return spotifyProvider.explore!.getFeed(made.nextCursor);
    };
    const askedWith = () => request.mock.calls.filter(call => call[0] === 'radio').map(call => Number(call[1].id));

    it('ends with shelves of the songs like one song: asked with what was played here, then with the liked songs, each song on one shelf', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // Every radio holds 30 songs of its own and one that all of them share; one lists a song of its own twice.
        answerRadios([2, 1, 3], seed => [9999, ...(seed === 2 ? [200] : []), ...range(seed * 100, 30)]);
        const page = await radioPage([1]);
        expect(askedWith()).toEqual([1, 2, 3]);
        expect(page.sections.map(shelf => [shelf.items.length, shelf.changesWithRead, Boolean(shelf.moreCursor)])).toEqual([[12, true, true], [12, true, true], [12, true, true]]);
        expect(new Set(page.sections.map(shelf => shelf.id)).size).toBe(3);
        // The three songs asked with are used up: the list ends here.
        expect(page.nextCursor).toBeUndefined();
        // A shelf holds whole batches (24 of the 30 or 31 songs that are free), without the song it was asked with.
        const held = [];
        for (const shelf of page.sections) {
            const more = await spotifyProvider.explore!.getSectionItems!(shelf.moreCursor!);
            expect(more.moreCursor).toBeUndefined();
            held.push([...songIds(shelf.items), ...songIds(more.items)]);
        }
        expect(held.map(songs => songs.length)).toEqual([24, 24, 24]);
        expect(held.flat().filter(song => song === 9999)).toHaveLength(1);
        expect(new Set(held[1]).size).toBe(24);
        expect(held.flat().some(song => [1, 2, 3].includes(song))).toBe(false);
        // One request for the liked songs and two a shelf; a shelf's further songs ask Spotify nothing.
        expect(request).toHaveBeenCalledTimes(7);
    });

    it('asks, in a later read, with the songs the reads before did not ask with, and lists first the songs no shelf has handed out', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // The radio of song 54 begins with two songs the radio of song 52 handed out in the read before.
        answerRadios([51, 52, 53, 54, 55], seed => (seed === 54 ? [5200, 5201, ...range(5400, 30)] : range(seed * 100, 30)));
        await radioPage();
        expect(askedWith()).toEqual([51, 52, 53]);
        const again = await radioPage();
        // Songs 54 and 55 were not asked with; after them comes the one asked with longest ago.
        expect(askedWith()).toEqual([54, 55, 51]);
        expect(songIds(again.sections[0].items)).toEqual(range(5400, 12));
        expect(again.nextCursor).toBeDefined();
    });
});

describe('Spotify through the facade', () => {
    it('is a provider that needs an account and signs in by a browser page alone', async () => {
        expect(omni.getProviderSummaries().find(provider => provider.providerId === 'spotify')).toMatchObject({ displayName: 'Spotify', requiresAccount: true });
        expect(omni.confirmsLoginInBrowser('spotify')).toBe(true);
        // (YouTube Music is confirmed in the browser too: ytmOmni.test.ts.)
        for (const other of ['netease', 'kugou', 'qq', 'bodian']) expect(omni.confirmsLoginInBrowser(other)).toBe(false);
        request.mockImplementation(async (operation: string) => (operation === 'login_start' ? { key: 'key-1', expiresInMs: 600000 } : true));
        expect(await omni.startLogin('spotify')).toEqual({ key: 'key-1', imageUrl: '' });
        // The attempt, then the desktop side's 60 s of reading the account again and one 30 s read.
        expect(omni.getLoginTtlMs('spotify')).toBe(600000 + 60000 + 30000);
        await omni.openLoginPage('spotify', 'key-1');
        expect(request).toHaveBeenLastCalledWith('login_open', { key: 'key-1' });
    });

    it('turns timed lines into lyrics, and answers "none" for untimed ones so the other sources are asked', async () => {
        const song = normalizeSpotifySong(track('a'));
        // The last line is past the hundredth minute: its stamp has three digits of minutes.
        request.mockResolvedValueOnce({ timed: true, lines: [{ startMs: 500, words: 'First' }, { startMs: 61230, words: 'Second' }, { startMs: 6005000, words: 'Late' }] });
        const timed = await spotifyProvider.lyrics!.getLyrics(song);
        expect(timed.mainText).toBe('[00:00.50]First\n[01:01.23]Second\n[100:05.00]Late');
        // The parser adds lines of its own for the long gaps between them.
        expect(timed.lyrics?.lines.map(line => line.startTime)).toEqual(expect.arrayContaining([0.5, 61.23, 6005]));
        request.mockResolvedValueOnce({ timed: false, lines: [{ startMs: 0, words: 'Untimed' }] });
        expect(await spotifyProvider.lyrics!.getLyrics(song)).toEqual({ lyrics: null, isPureMusic: false });
        request.mockRejectedValueOnce(new Error('offline'));
        expect(await spotifyProvider.lyrics!.getLyrics(song)).toEqual({ lyrics: null, isPureMusic: false });
    });
});

describe('Spotify likes and saves', () => {
    it('reads the liked songs by the rows Spotify gives, to the end of the list', async () => {
        const liked = (letters: string) => [...letters].map(letter => ({ track: { _uri: `spotify:track:${id(letter)}`, data: track(letter) } }));
        // A row that is no song (a file of the owner's own computer) counts as a row read.
        answerQueries({ fetchLibraryTracks: ({ offset }) => ({ me: { library: { tracks: {
            totalCount: 5, items: offset === 0 ? [...liked('abc'), { track: { _uri: 'spotify:local:file' } }] : liked('d'),
        } } } }) });
        expect(await spotifyProvider.library!.getLikedSongIds!('me')).toEqual({ ids: [id('a'), id('b'), id('c'), id('d')], whole: true });
        expect(sent('fetchLibraryTracks').map(variables => variables.offset)).toEqual([0, 4]);

        // Without Spotify's count the reading goes on until a request brings nothing.
        request.mockReset();
        answerQueries({ fetchLibraryTracks: ({ offset }) => ({ me: { library: { tracks: { items: offset === 0 ? liked('ab') : offset === 2 ? liked('c') : [] } } } }) });
        expect(await spotifyProvider.library!.getLikedSongIds!('me')).toEqual({ ids: [id('a'), id('b'), id('c')], whole: true });
    });

    it('says the liked songs were not read whole when Spotify counts more than it gives, and fails on an answer without the list', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const row = { track: { _uri: `spotify:track:${id('a')}`, data: track('a') } };
        answerQueries({ fetchLibraryTracks: ({ offset }) => ({ me: { library: { tracks: { totalCount: 3, items: offset === 0 ? [row] : [] } } } }) });
        expect(await spotifyProvider.library!.getLikedSongIds!('me')).toEqual({ ids: [id('a')], whole: false });
        expect(warn).toHaveBeenLastCalledWith('[Spotify] The liked songs were not read to the end: 1 rows read of 3 (a request brought no rows), the hearts of the others stay as they were');
        warn.mockRestore();

        // An answer without the list is not an account that likes nothing.
        request.mockReset();
        answerQueries({ fetchLibraryTracks: () => ({ me: {} }) });
        await expect(spotifyProvider.library!.getLikedSongIds!('me')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    // The read is bounded by the rows read, not by the requests: Spotify may give fewer rows than asked for.
    it('reads the liked songs to 20000 rows however many Spotify gives a request, and asks for no more than that in all', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rows = (offset: number, count: number) => Array.from({ length: count }, (_, at) => ({ track: { _uri: `spotify:track:${String(offset + at).padStart(22, '0')}` } }));
        const reads = (given: (offset: number, limit: number) => number, totalCount?: number) => {
            request.mockReset();
            answerQueries({ fetchLibraryTracks: ({ offset, limit }) => ({ me: { library: { tracks: { totalCount, items: rows(offset, given(offset, limit)) } } } }) });
            return spotifyProvider.library!.getLikedSongIds!('me');
        };

        // 500 rows a request: 40 requests, and a list longer than that is not whole.
        const long = await reads(() => 500, 23456);
        expect(long.ids).toHaveLength(20000);
        expect(long.whole).toBe(false);
        expect(sent('fetchLibraryTracks')).toHaveLength(40);
        expect(sent('fetchLibraryTracks').every(variables => variables.limit === 500)).toBe(true);
        expect(warn).toHaveBeenLastCalledWith('[Spotify] The liked songs were not read to the end: 20000 rows read of 23456 (the read stops at 20000 rows), the hearts of the others stay as they were');

        // A list of exactly that many is read whole.
        expect(await reads(() => 500, 20000)).toMatchObject({ whole: true });

        // 120 rows a request: the reading goes on by the rows given, past 40 requests, to the end of the list.
        const fewer = await reads(offset => Math.min(120, 6000 - offset), 6000);
        expect(fewer).toMatchObject({ whole: true });
        expect(fewer.ids).toHaveLength(6000);
        expect(sent('fetchLibraryTracks')).toHaveLength(50);
        expect(sent('fetchLibraryTracks')[1]).toEqual({ offset: 120, limit: 500 });

        // 480 rows a request: the last request asks only for the rows left to 20000.
        const uneven = await reads((_offset, limit) => Math.min(480, limit), 23456);
        expect(uneven.ids).toHaveLength(20000);
        expect(sent('fetchLibraryTracks')).toHaveLength(42);
        expect(sent('fetchLibraryTracks').at(-1)).toEqual({ offset: 19680, limit: 320 });
        expect(warn).toHaveBeenLastCalledWith('[Spotify] The liked songs were not read to the end: 20000 rows read of 23456 (the read stops at 20000 rows), the hearts of the others stay as they were');

        // A list that never ends, without Spotify's count of it, stops at the same row.
        const endless = await reads(() => 500);
        expect(endless).toMatchObject({ whole: false });
        expect(endless.ids).toHaveLength(20000);

        // A request that brings no rows before the count is reached ends the read, not whole.
        const empty = await reads(offset => (offset < 1000 ? 500 : 0), 3000);
        expect(empty).toMatchObject({ whole: false });
        expect(empty.ids).toHaveLength(1000);
        expect(sent('fetchLibraryTracks')).toHaveLength(3);
        warn.mockRestore();
    });

    it('asks whether songs are liked in one request for all of them, by the answer row of each', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        answerQueries({ areEntitiesInLibrary: () => ({ lookup: [{ data: { saved: true } }, { data: { saved: false } }, {}] }) });
        expect(await spotifyProvider.library!.areSongsLiked!([id('a'), id('b'), id('c')])).toEqual({ [id('a')]: true, [id('b')]: false });
        expect(sent('areEntitiesInLibrary')).toEqual([{ uris: [`spotify:track:${id('a')}`, `spotify:track:${id('b')}`, `spotify:track:${id('c')}`] }]);
        expect(log).toHaveBeenLastCalledWith('[Spotify] areEntitiesInLibrary for 3 tracks: 1 liked, 1 not, 1 without an answer');

        // Fewer rows than uris: which row is which song is not known, so none is taken.
        answerQueries({ areEntitiesInLibrary: () => ({ lookup: [{ data: { saved: true } }] }) });
        expect(await spotifyProvider.library!.areSongsLiked!([id('a'), id('b')])).toEqual({});
        log.mockRestore();
    });

    it('counts the liked songs with one request for one row, and gives no count where Spotify names none', async () => {
        answerQueries({ fetchLibraryTracks: () => ({ me: { library: { tracks: { totalCount: 312, items: [] } } } }) });
        expect(await spotifyProvider.library!.getLikedSongCount!('me')).toBe(312);
        expect(sent('fetchLibraryTracks')).toEqual([{ offset: 0, limit: 1 }]);

        request.mockReset();
        answerQueries({ fetchLibraryTracks: () => ({ me: {} }) });
        expect(await spotifyProvider.library!.getLikedSongCount!('me')).toBeNull();
    });

    // At the home screen the playlists (with the liked card) and the count are asked for together.
    it('asks for the first liked row once when the liked card and the count are wanted at the same moment, and again the next time', async () => {
        answerQueries({
            libraryV3: () => ({ me: { libraryV3: { totalCount: 0, items: [] } } }),
            fetchLibraryTracks: () => ({ me: { library: { tracks: { totalCount: 7, items: [] } } } }),
        });
        const [playlists, count] = await Promise.all([
            spotifyProvider.library!.getUserPlaylists('me', 50, 0),
            spotifyProvider.library!.getLikedSongCount!('me'),
        ]);
        expect(playlists.items[0]).toMatchObject({ isLiked: true, trackCount: 7 });
        expect(count).toBe(7);
        expect(sent('fetchLibraryTracks')).toEqual([{ offset: 0, limit: 1 }]);

        expect(await spotifyProvider.library!.getLikedSongCount!('me')).toBe(7);
        expect(sent('fetchLibraryTracks')).toHaveLength(2);
    });

    it('likes a song, keeps an album and follows a playlist by their uris, and not a playlist of the account\'s own', async () => {
        request.mockResolvedValue(true);
        const song = normalizeSpotifySong(track('a'));
        const other = spotifyPlaylistOf(playlist('p'))!;
        await spotifyProvider.mutations!.likeSong!(song, true);
        await spotifyProvider.mutations!.likeSong!(id('b'), false);
        await spotifyProvider.mutations!.subscribeAlbum!(id('m'), true);
        await spotifyProvider.mutations!.subscribePlaylist!(other, false);
        expect(request.mock.calls).toEqual([
            ['library', { uri: `spotify:track:${id('a')}`, saved: true }],
            ['library', { uri: `spotify:track:${id('b')}`, saved: false }],
            ['library', { uri: `spotify:album:${id('m')}`, saved: true }],
            ['library', { uri: `spotify:playlist:${id('p')}`, saved: false }],
        ]);
        expect(omni.canLikeSong(song)).toBe(true);
        expect(omni.canSubscribeCollection(other)).toBe(true);
        expect(omni.canSubscribeCollection({ ...other, isOwned: true })).toBe(false);
        expect(omni.canSubscribeCollection({ ...other, id: 'liked' })).toBe(false);
    });

    it('changes the songs of the account\'s own playlists only, and makes a playlist of its own', async () => {
        request.mockResolvedValue(true);
        const song = normalizeSpotifySong(track('a'));
        const own = { ...spotifyPlaylistOf(playlist('p'))!, isOwned: true };
        const { canAddToPlaylist, updatePlaylistTracks, createPlaylist } = spotifyProvider.mutations!;
        await updatePlaylistTracks!('add', own, [song, id('b')]);
        await updatePlaylistTracks!('del', own, [song]);
        expect(request.mock.calls).toEqual([
            ['playlist_edit', { id: id('p'), action: 'add', tracks: [id('a'), id('b')] }],
            ['playlist_edit', { id: id('p'), action: 'remove', tracks: [id('a')] }],
        ]);
        await expect(updatePlaylistTracks!('add', { ...own, isOwned: false }, [song])).rejects.toMatchObject({ code: 'unsupported' });
        expect(request).toHaveBeenCalledTimes(2);
        // The picker offers the account's own playlists, not its liked songs or one it follows.
        expect([own, { ...own, id: 'liked' }, { ...own, isOwned: false }].map(list => canAddToPlaylist!(list))).toEqual([true, false, false]);
        expect(omni.canAddSongToPlaylist(song)).toBe(true);
        expect(omni.canCreatePlaylistForSong(song)).toBe(true);

        request.mockResolvedValueOnce({ uri: `spotify:playlist:${id('n')}` });
        expect(await createPlaylist!(' Road ')).toMatchObject({ providerId: 'spotify', id: id('n'), type: 'playlist', name: 'Road', isOwned: true, trackCount: 0 });
        expect(request).toHaveBeenLastCalledWith('playlist_create', { name: ' Road ' });
        request.mockResolvedValueOnce({});
        await expect(createPlaylist!('Road')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('reads whether an album is kept and a playlist followed, and does not ask about the account\'s own lists', async () => {
        answerQueries({
            areEntitiesInLibrary: ({ uris }) => ({ lookup: [{ data: { saved: uris[0] === `spotify:album:${id('m')}` } }] }),
            fetchPlaylist: ({ uri }) => ({ playlistV2: { ...playlist('p'), following: uri === `spotify:playlist:${id('p')}`, content: { totalCount: 0, items: [] } } }),
        });
        const status = spotifyProvider.catalog!.getSubscriptionStatus!;
        expect(await status('album', id('m'))).toBe(true);
        expect(await status('album', id('n'))).toBe(false);
        expect(await status('playlist', id('p'))).toBe(true);
        expect(await status('playlist', id('q'))).toBe(false);
        expect(await status('playlist', id('p'), { ...spotifyPlaylistOf(playlist('p'))!, isOwned: true })).toBe(false);
        expect(await status('playlist', 'liked')).toBe(false);
        expect(sent('fetchPlaylist')).toHaveLength(2);
    });
});
