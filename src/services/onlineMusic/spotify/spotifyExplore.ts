import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineExploreProvider, ProviderCollection, ProviderExploreItem, ProviderExplorePage, ProviderExploreSection } from '../../../types/onlineMusic';
import { createHandedOut } from '../exploreReads';
import { present, spotifyAlbumOf, spotifyArtistOf, spotifyPlaylistOf } from './spotifyNormalize';
import type { SpotifyAlbum, SpotifyArtistRow, SpotifyPlaylist } from './spotifyNormalize';
import { addSpotifySeeds, noteSpotifyListened, spotifyLikedSeeds, spotifyRadioSongs, spotifySeedOf } from './spotifyRadio';
import type { SpotifySeed } from './spotifyRadio';
import { querySpotify } from './spotifyTransport';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/spotify/spotifyExplore.ts
// The explore page is what Spotify itself picks for the account, in four parts, each asked for
// when the list gets to it (all measured 2026-10-08, a little-used free account):
//  1. Spotify's home page: one request, 6 sections of playlists, albums and artists, 10 entries
//     a section out of 6 to 50. A section's own query gives its first 20 entries whatever offset
//     is asked for (also under the hash the web player uses today), so a section has one further
//     batch here: the ones of those 20 the page did not give.
//  2. The new releases of the artists the account follows (2 albums).
//  3. The page of the lists Spotify makes for the account ("Made For You"): 9 sections, 138
//     playlists, every one marked as made for this account (daily mixes, the weekly discovery
//     list, the songs it plays most, mixes by artist and by mood), none of them on the home page.
//     Its sections are paged for real: entries 51 to 100 of a section of 100 were 50 others.
//  4. Shelves made here, each of the songs Spotify lists as like one song (that song's radio: a
//     playlist of 50 with the song itself first, the same when asked again; three of them held
//     137 different songs). The songs asked with are the ones the listener played in the app
//     (`listened`), then the ones the account liked on Spotify.
// A section of Spotify's has a uri that stays the same from read to read, and two reads a few
// seconds apart gave the same sections and entries in the same order, on the home page and on
// the page of the account's lists alike. What differs from one read of the page to the next is
// part 4: a later read asks with songs the reads before did not ask with.

interface Card { uri?: string; content?: { __typename?: string; data?: (SpotifyPlaylist | SpotifyAlbum | SpotifyArtistRow) & { __typename?: string } } }
interface Section {
    uri?: string;
    data?: { __typename?: string; title?: { transformedLabel?: string } };
    sectionItems?: { totalCount?: number; items?: Card[] };
}
interface HomeAnswer { home?: { sectionContainer?: { sections?: { items?: Section[] } } } }
interface HomeSectionAnswer { homeSections?: { sections?: Section[] } }
interface BrowseAnswer { browse?: { sections?: { items?: Section[] } } }
interface ReleasesAnswer { whatsNewFeedItems?: { items?: Card[] } }

// The account's own listening record; the explore page has that from the app's record of plays.
const LISTENING_RECORD_SECTIONS = new Set(['HomeRecentlyPlayedSectionData', 'HomeShortsSectionData']);
// Spotify's page of the lists it makes for the account; the same uri for every account.
const MADE_FOR_ACCOUNT = 'spotify:page:0JQ5DAt0tbjZptfcdMSKl3';
const RELEASES_ID = 'spotify-new-releases';
const HOME_ROWS = 10;
const HOME_SECTION_ROWS = 20;
// A section of the account's lists hands out this many at a time: most have fewer and are whole.
const MADE_ROWS = 20;
const RELEASE_ROWS = 50;
// A page of shelves made here is this many of them.
const RADIOS_A_PAGE = 3;
// A shelf costs Spotify two requests (which list, and its songs), made when its page is asked
// for. A read of the page makes at most this many shelves.
const MAX_RADIOS = 9;
// A shelf hands out this many songs at a time, and holds whole batches: the explore page shows
// other entries by going through a section batch by batch, and reads the page anew (which is
// when these shelves give way to others) only once no section has a batch left. Batches of the
// sizes here bring a shelf (4 of them) and the longest of Spotify's sections (5) to their ends
// within a refresh of each other.
const RADIO_BATCH = 12;

// The cursors. A uri of Spotify's and a track id have no space in them.
const MADE_PAGE = 'lists made for the account';
const RADIO_PAGE = 'radios after ';
const HOME_SECTION = 'section ';
const MADE_SECTION = 'made ';
const RADIO = 'radio ';

// (The songs asked with, and a song's radio, are the personal FM's too: spotifyRadio.ts.)
type Seed = SpotifySeed;
// What one read of the page from its start holds.
const newRead = () => ({
    /** What each section of the home page showed, by the section's uri. */
    home: new Map<string, Set<string>>(),
    /** The songs a shelf may still be made of, the ones to ask with first at the front. */
    seeds: [] as Seed[],
    /** Every song that was put among them: a song is asked with once in a read. */
    known: new Set<string>(),
    /** Whether the account's liked songs were put among them. */
    hasLiked: false,
    /** How many were asked with. */
    asked: 0,
    /** What each shelf holds, by the shelf's id. */
    songs: new Map<string, ProviderExploreItem[]>(),
    /** The songs on a shelf: a song is on one shelf in a read. */
    onShelf: new Set<string>(),
});
type Read = ReturnType<typeof newRead>;
// The read whose page is on screen. A read from the start takes its place once its first page has arrived.
let page = newRead();
// What the reads before used, in the order it was used (the adapters' shared memory,
// exploreReads.ts), in two scopes: the songs asked with (`SEEDS`), and
// the songs the shelves made here handed out (`SONGS`, one scope for all of them). A later read
// asks with the others first, and a later shelf lists the others first.
const handedOut = createHandedOut();
const SEEDS = 'seeds';
const SONGS = 'songs';
// A shelf made here is another one in every read; it is told apart by when it was made.
let shelvesMade = 0;

export const wordsOf = (error: unknown) => errorMessage(error);
// An entry's second line on this page: what the entry is, then whose. The app's own rule (the
// names, and the kind only where there are none) told nothing apart here: every playlist of the
// home page and of the account's lists is Spotify's own (115 of 115, 2026-10-08), so each card
// read "Spotify". A maker other than Spotify is still named.
// Spotify keeps a release of a song or two as an album of its own kind (`albumType` SINGLE),
// and so an EP and a compilation; a card of the home page and a new release say which.
const RELEASE_LABELS: Record<string, string> = { SINGLE: 'home.exploreSingle', EP: 'home.exploreEp', COMPILATION: 'home.exploreCompilation' };
const OWN_MAKER = 'Spotify';
const lineOf = (kind: string, whose: string | undefined) => [i18n.t(kind), whose].filter(Boolean).join(' · ');
const namesOf = (artists: Array<{ name: string }> | undefined) => (artists ?? []).map(artist => artist.name).filter(Boolean).join(', ');
const songItem = (song: UnifiedSong): ProviderExploreItem => ({ kind: 'song', song, subtitle: lineOf('home.exploreSong', namesOf(song.artists)) });
const itemOf = (card: Card): ProviderExploreItem | null => {
    const data = card.content?.data;
    if (data?.__typename === 'Playlist') {
        const collection = spotifyPlaylistOf(data as SpotifyPlaylist);
        const maker = collection?.creator?.nickname;
        return collection ? { kind: 'collection', collection, subtitle: lineOf('home.explorePlaylist', maker === OWN_MAKER ? '' : maker) } : null;
    }
    if (data?.__typename === 'Album') {
        const collection = spotifyAlbumOf(data as SpotifyAlbum);
        const kind = RELEASE_LABELS[(data as SpotifyAlbum).albumType ?? ''] ?? 'home.exploreAlbum';
        return collection ? { kind: 'collection', collection, subtitle: lineOf(kind, namesOf(collection.artists)) } : null;
    }
    // (An artist's card reads "artist" by the app's own rule.)
    const artist = data?.__typename === 'Artist' ? spotifyArtistOf(data as SpotifyArtistRow) : null;
    return artist ? { kind: 'collection', collection: artist } : null;
};
const keyOf = (item: ProviderExploreItem): string => (item.kind === 'collection' ? `${item.collection.type}:${item.collection.id}` : `song:${item.song.id}`);
const rowsOf = (section: Section | undefined): Card[] => section?.sectionItems?.items ?? [];
const countOf = (sections: ProviderExploreSection[]) => sections.reduce((count, section) => count + section.items.length, 0);
const homeVariables = () => ({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, sp_t: '' });
// The page of the account's lists pages all its sections at once: entries `offset` onwards of each.
const madeVariables = (offset: number, limit: number) => ({
    uri: MADE_FOR_ACCOUNT, pagePagination: { offset: 0, limit: 20 }, sectionPagination: { offset, limit },
    browseEndUserIntegration: 'INTEGRATION_WEB_PLAYER', includeEpisodeContentRatingsV2: true,
});

/** A section of Spotify's as one of the page; null for one that holds nothing the app shows. `moreCursor` is asked where Spotify has more of it than it gave. */
const sectionOf = (row: Section, moreCursor: (given: number) => string): ProviderExploreSection | null => {
    const items = rowsOf(row).map(itemOf).filter(present);
    if (!row.uri || items.length === 0) return null;
    const hasMore = (row.sectionItems?.totalCount ?? 0) > rowsOf(row).length;
    return { id: row.uri, title: row.data?.title?.transformedLabel ?? '', items, ...(hasMore ? { moreCursor: moreCursor(rowsOf(row).length) } : {}) };
};

const hasSeedsLeft = (read: Read) => read.asked < MAX_RADIOS && read.seeds.length > 0;
// Up to `count` songs to ask with: the ones no read before asked with first, then the ones asked
// with longest ago.
const takeSeeds = (read: Read, count: number): Seed[] => {
    const taken = handedOut.inTurn(SEEDS, read.seeds, seed => seed.id).slice(0, Math.min(count, MAX_RADIOS - read.asked));
    read.seeds = read.seeds.filter(seed => !taken.includes(seed));
    handedOut.note(SEEDS, taken.map(seed => seed.id));
    read.asked += taken.length;
    return taken;
};

/** `items` as a shelf made here hands them out: their songs are noted, for the shelves handed out after. */
const noted = (items: ProviderExploreItem[]): ProviderExploreItem[] => {
    handedOut.note(SONGS, items.flatMap(item => (item.kind === 'song' ? [String(item.song.id)] : [])));
    return items;
};

/** A shelf of the songs like `seed`; null where they could not be read, or too few of them are on no other shelf. */
const radioShelf = async (read: Read, seed: Seed): Promise<ProviderExploreSection | null> => {
    try {
        const found = await spotifyRadioSongs(seed.id);
        // (Not the song asked with, not one of another shelf, and each once.)
        const taken = new Set([seed.id]);
        const free = found.filter(song => {
            const id = String(song.id);
            if (taken.has(id) || read.onShelf.has(id)) return false;
            taken.add(id);
            return true;
        });
        if (free.length < RADIO_BATCH) {
            console.log(`[Spotify] Explore radio of ${seed.id}: ${free.length} of ${found.length} songs on no other shelf, too few for a shelf`);
            return null;
        }
        const wasShown = (song: UnifiedSong) => handedOut.has(SONGS, String(song.id));
        // (The songs no shelf has handed out first, then the ones handed out longest ago.)
        const songs = handedOut.inTurn(SONGS, free, song => String(song.id)).slice(0, Math.floor(free.length / RADIO_BATCH) * RADIO_BATCH);
        songs.forEach(song => read.onShelf.add(String(song.id)));
        const id = `spotify-radio-${++shelvesMade}`;
        read.songs.set(id, songs.map(songItem));
        console.log(`[Spotify] Explore radio of ${seed.id}: a shelf of ${songs.length} songs (${found.length} read, ${free.filter(wasShown).length} of them shown by a shelf before)`);
        return {
            id,
            title: i18n.t('home.exploreSimilar', { name: seed.name }),
            items: noted(read.songs.get(id)!.slice(0, RADIO_BATCH)),
            // (The cursor names the shelf: one of a read before finds nothing in this read.)
            ...(songs.length > RADIO_BATCH ? { moreCursor: `${RADIO}${id} ${RADIO_BATCH}` } : {}),
            // Another read asks with other songs: its shelves take the places of these.
            changesWithRead: true,
        };
    } catch (error) {
        console.warn(`[Spotify] Explore radio of ${seed.id} could not be read (${wordsOf(error)}); the page goes on without it`);
        return null;
    }
};

const homePage = async (listened: UnifiedSong[]): Promise<ProviderExplorePage> => {
    const answer = await querySpotify<HomeAnswer>('home', { ...homeVariables(), facet: '', sectionItemsLimit: HOME_ROWS });
    const rows = answer.home?.sectionContainer?.sections?.items ?? [];
    const sections = rows.filter(row => !LISTENING_RECORD_SECTIONS.has(row.data?.__typename ?? ''))
        .map(row => sectionOf(row, () => `${HOME_SECTION}${row.uri}`)).filter(present);
    const read = newRead();
    sections.forEach(section => read.home.set(section.id, new Set(section.items.map(keyOf))));
    const played = listened.map(spotifySeedOf);
    noteSpotifyListened(played);
    addSpotifySeeds(read, played);
    page = read;
    console.log(`[Spotify] Explore page: ${sections.length} sections of ${rows.length}, ${countOf(sections)} entries`);
    return { sections, nextCursor: MADE_PAGE };
};

// The new releases come first: there are few of them, and they are the latest thing on the page.
// They are left out when they cannot be read. So are the account's lists when Spotify refuses
// the query (it replaces its queries without notice): the list must go on to the shelves made
// here. Offline or busy, the page fails instead, and is asked for again.
const madePage = async (): Promise<ProviderExplorePage> => {
    const read = page;
    const [made, releases] = await Promise.all([
        querySpotify<BrowseAnswer>('browsePage', madeVariables(0, MADE_ROWS)).catch(error => {
            if (error instanceof OnlineProviderError && error.code === 'network') throw error;
            console.warn(`[Spotify] Explore page: the lists made for the account could not be read (${wordsOf(error)}); the page goes on without them`);
            return null;
        }),
        querySpotify<ReleasesAnswer>('queryWhatsNewFeed', { offset: 0, limit: RELEASE_ROWS, onlyUnPlayedItems: false, includedContentTypes: ['ALBUM'] }).catch(error => {
            console.warn(`[Spotify] Explore page: the new releases could not be read (${wordsOf(error)}); the page goes on without them`);
            return null;
        }),
    ]);
    const albums = (releases?.whatsNewFeedItems?.items ?? []).map(itemOf).filter(present);
    const rows = made?.browse?.sections?.items ?? [];
    // (A section the home page has too stands there already: the page holds one of an id.)
    const lists = rows.filter(row => !read.home.has(row.uri ?? '')).map(row => sectionOf(row, given => `${MADE_SECTION}${row.uri} ${given}`)).filter(present);
    const sections = [...(albums.length > 0 ? [{ id: RELEASES_ID, title: i18n.t('home.spotifyNewReleases'), items: albums }] : []), ...lists];
    console.log(`[Spotify] Explore page (made for the account): ${lists.length} sections of ${rows.length}, ${countOf(lists)} entries; ${albums.length} new releases`);
    return { sections, nextCursor: `${RADIO_PAGE}0` };
};

/**
 * The playlists Spotify makes for the account, each once, in the order its page lists them (the
 * first MADE_ROWS of each section): what the radio tab's daily songs and playlists are taken from
 * (spotifyRecommendations.ts).
 */
export const spotifyMadeForAccount = async (): Promise<ProviderCollection[]> => {
    const answer = await querySpotify<BrowseAnswer>('browsePage', madeVariables(0, MADE_ROWS));
    const lists = new Map<string, ProviderCollection>();
    for (const item of (answer.browse?.sections?.items ?? []).flatMap(rowsOf).map(itemOf).filter(present)) {
        if (item.kind === 'collection' && item.collection.type === 'playlist' && !lists.has(String(item.collection.id))) {
            lists.set(String(item.collection.id), item.collection);
        }
    }
    return [...lists.values()];
};

const radioPage = async (): Promise<ProviderExplorePage> => {
    const read = page;
    if (!read.hasLiked) {
        try {
            addSpotifySeeds(read, await spotifyLikedSeeds());
            read.hasLiked = true;
        } catch (error) {
            // Without them there are the songs played here, where there are any; the next page asks for them again.
            if (read.seeds.length === 0) throw error;
            console.warn(`[Spotify] Explore page: the liked songs could not be read (${wordsOf(error)}); the shelves are of the songs played here`);
        }
    }
    const shelves = (await Promise.all(takeSeeds(read, RADIOS_A_PAGE).map(seed => radioShelf(read, seed)))).filter(present);
    console.log(`[Spotify] Explore page (shelves made here): ${shelves.length} shelves; ${read.asked} of ${MAX_RADIOS} songs asked with, ${read.seeds.length} more to ask with`);
    return { sections: shelves, ...(hasSeedsLeft(read) || (!read.hasLiked && read.asked < MAX_RADIOS) ? { nextCursor: `${RADIO_PAGE}${read.asked}` } : {}) };
};

export const spotifyExplore: OnlineExploreProvider = {
    async getFeed(cursor, listened = []) {
        if (!cursor) return homePage(listened);
        if (cursor === MADE_PAGE) return madePage();
        if (cursor.startsWith(RADIO_PAGE)) return radioPage();
        return { sections: [] };
    },
    async getSectionItems(cursor) {
        if (cursor.startsWith(HOME_SECTION)) {
            const uri = cursor.slice(HOME_SECTION.length);
            const answer = await querySpotify<HomeSectionAnswer>('homeSection', { ...homeVariables(), uri, sectionItemsOffset: 0, sectionItemsLimit: HOME_SECTION_ROWS });
            const had = page.home.get(uri) ?? new Set<string>();
            const items = rowsOf(answer.homeSections?.sections?.[0]).map(itemOf).filter(present).filter(item => !had.has(keyOf(item)));
            console.log(`[Spotify] Explore section: ${items.length} further entries`);
            return { items };
        }
        if (cursor.startsWith(MADE_SECTION)) {
            const [uri, from] = cursor.slice(MADE_SECTION.length).split(' ');
            const offset = Number(from) || 0;
            const answer = await querySpotify<BrowseAnswer>('browsePage', madeVariables(offset, MADE_ROWS));
            const section = (answer.browse?.sections?.items ?? []).find(row => row.uri === uri);
            const next = offset + rowsOf(section).length;
            const hasMore = rowsOf(section).length > 0 && next < (section?.sectionItems?.totalCount ?? 0);
            console.log(`[Spotify] Explore section (made for the account): ${rowsOf(section).length} further entries from place ${offset}${hasMore ? '' : ', the last ones'}`);
            return { items: rowsOf(section).map(itemOf).filter(present), ...(hasMore ? { moreCursor: `${MADE_SECTION}${uri} ${next}` } : {}) };
        }
        // A shelf made here hands out what it holds: Spotify is not asked.
        if (cursor.startsWith(RADIO)) {
            const [id, from] = cursor.slice(RADIO.length).split(' ');
            const songs = page.songs.get(id) ?? [];
            const end = Number(from) + RADIO_BATCH;
            console.log(`[Spotify] Explore shelf ${id}: ${songs.slice(Number(from), end).length} further songs from place ${from}, ${Math.max(0, songs.length - end)} after them`);
            return { items: noted(songs.slice(Number(from), end)), ...(end < songs.length ? { moreCursor: `${RADIO}${id} ${end}` } : {}) };
        }
        return { items: [] };
    },
};
