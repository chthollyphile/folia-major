import i18n from '../../../i18n/config';
import type { OnlineExploreProvider, ProviderCollection, ProviderExploreItem, ProviderExploreSection } from '../../../types/onlineMusic';
import { createHandedOut, cursorWords, stampCursor } from '../exploreReads';
import { normalizeYtmCollection, normalizeYtmSong } from './ytmNormalize';
import { addYtmSeeds, noteYtmListened, ytmListenedSeeds, ytmRadioSongs, ytmSeedOf } from './ytmRadio';
import type { YtmSeed } from './ytmRadio';
import { requestYtm } from './ytmTransport';
import { errorMessage } from '../../../utils/errorText';
import type { YtmWireExploreItem, YtmWireExplorePage, YtmWireSong } from './ytmTransport';

// src/services/onlineMusic/ytm/ytmExplore.ts
// The recommendation page of YouTube Music: the shelves YouTube shows the signed-in account, and
// with them shelves made here, each of the songs YouTube Music lists as like one song. YouTube's
// headings come as it writes them, in the app's language.
// Which pages YouTube's shelves are of is the main process's matter (electron/ytm/webExplore.cjs):
// YouTube Music's own home feed, and after it its explore and charts pages. They come as the
// `explore` operation's answer, a page of shelves with the token of the next; a token may be a
// page's name made up there. A shelf of YouTube's comes whole: it has no further entries of its
// own. What is noted below as measured was measured on the music page of YouTube's TV client,
// which the app read while it had the device sign-in; it was not measured again on these pages.

const toItem = (item: YtmWireExploreItem): ProviderExploreItem => ({
    ...(item.kind === 'song'
        ? { kind: 'song', song: normalizeYtmSong(item.song) }
        : { kind: 'collection', collection: normalizeYtmCollection(item.collection, item.collection.type), ...(item.collection.mix ? { isMix: true } : {}) }),
    ...(item.wideCoverUrl ? { wideCoverUrl: item.wideCoverUrl } : {}),
});

// The shelves of YouTube's own record of the account's listening: what it last played, what it
// plays again, and what it once played and no longer does, on YouTube's own apps. They are left
// out (see OnlineExploreProvider): the explore page has such sections from the app's own record
// alone. Nothing in a shelf says which one it is but its heading: measured 2026-10-07, these
// have the shape of every other shelf, and their page tokens differ from the others' only in
// the shelf's place on the page. So they are known by the headings YouTube gives them in the
// languages the app reads the page in (measured 2026-10-07: zh-CN and en; the page asked for in
// id came in English). A heading YouTube changes leaves its shelf on the page.
const LISTENING_RECORD_HEADINGS = new Set([
    '最近播放的音乐', 'Recently played', 'Diputar baru-baru ini',
    '再听一遍', 'Listen again',
    '老歌重温', 'Forgotten favorites',
]);

// YouTube names no shelf, and the same heading can come twice; a shelf is told apart by when it was read.
let sectionsRead = 0;

// A cursor stands only until the page is next asked for from its start. The shelves made here
// begin anew with that read, and so does the desktop side's note of the shelves it has answered,
// which the page after a token is answered against. (On the TV client's page a token named a
// place, "from place 8", on a page YouTube laid out again for every read from its start, measured
// 2026-10-07; whether a token of the home feed outlasts such a read was not measured.) A cursor
// is handed out with the number of that read, and one of a read before is answered with nothing:
// no further entries, no further shelves.
let pagesRead = 0;
const stamped = (token: string) => stampCursor(pagesRead, token);
/** YouTube's token in a cursor of the page as it was last read; null for a cursor of a read before. */
const tokenOf = (cursor: string): string | null => cursorWords(cursor, pagesRead);
// One read of the page from its start at a time. The cursors that stand are those of the read
// made last, and two such requests under way may be served in either order: the one counted last
// has to be the one served last.
let lastPageRead: Promise<unknown> = Promise.resolve();
const afterTheLast = <T>(read: () => Promise<T>): Promise<T> => {
    const answer = lastPageRead.then(read, read);
    lastPageRead = answer.catch(() => undefined);
    return answer;
};

// The first page of YouTube's shelves as it was last asked for from its start (the read may be
// under way). The radio tab's playlists are taken from it (`ytmMusicPagePlaylists`), so that the
// page is not asked for twice.
let firstPage: Promise<YtmWireExplorePage> | null = null;
/** Forgets that page: its entries are one account's, named in the language it was read in. */
export const forgetYtmMusicPage = (): void => { firstPage = null; };

// YouTube's page is a fixed pool: read whole it had some 300 entries, and 93% of them again 2.5
// minutes later (measured 2026-10-08). So the page goes on with shelves made here: the songs
// YouTube Music lists as like one song (that song's radio, read as a guest: 50 songs with the
// song itself first, the same when asked again, 7 to 13 of them shared by two songs). The songs
// asked with are, in this order: the ones the listener played in the app (`listened`), the ones
// of YouTube's own record of the account's listening (the shelves left out above), the other
// songs of the page. One such shelf comes before every further page of YouTube's shelves, and
// once those have ended a page is RADIOS_A_PAGE of them.
const RADIOS_A_PAGE = 3;
// A shelf costs YouTube one request, made when its page is asked for. A read of the page makes
// at most this many.
const MAX_RADIOS = 12;
// A shelf hands out this many songs at a time, and is not made of fewer.
const RADIO_BATCH = 12;
// What marks a cursor made here: a token of YouTube's has no space in it. A shelf's names the
// song it was asked with and a place among its songs. The page's names how many songs were
// asked with so far, so that no two of a read are the same: the explore page takes a cursor
// that names itself for the end of the list.
const RADIO = 'radio ';
const RADIO_PAGE = 'radios after ';

// The shelves made here for one read of the page from its start.
const noRadios = () => ({
    /** The songs a shelf may still be made of, the ones to ask with first at the front. */
    seeds: [] as YtmSeed[],
    /** Every song that was put among them: a song is asked with once in a read. */
    known: new Set<string>(),
    /** How many were asked with. */
    asked: 0,
    /** What each shelf holds, by the song it was asked with. */
    songs: new Map<string, ProviderExploreItem[]>(),
    /** The songs on a shelf: a song is on one shelf in a read. */
    shown: new Set<string>(),
    /** A shelf made beside a page of YouTube's that could not be read: it comes with that page when it can. */
    waiting: [] as ProviderExploreSection[],
});
let radios = noRadios();
// The songs asked with in the reads before, in the order they were asked with (the adapters'
// shared memory, exploreReads.ts; `SEEDS` is their scope in it): a later
// read asks with the others first, so that the page read anew goes on with shelves it has not had.
const handedOut = createHandedOut();
const SEEDS = 'seeds';

const addSeeds = (songs: YtmSeed[]): void => addYtmSeeds(radios, songs);
const hasRadiosLeft = () => radios.asked < MAX_RADIOS && radios.seeds.length > 0;
const radioCursor = (id: string, from: number) => stamped(`${RADIO}${id} ${from}`);
const radioPageCursor = () => stamped(`${RADIO_PAGE}${radios.asked}`);

/** A shelf of the songs like `seed`; null where they could not be read, or too few of them are on no other shelf. */
const radioShelf = async (seed: YtmSeed): Promise<ProviderExploreSection | null> => {
    // (An answer that arrives after the page was asked for from its start again is of this read, which the caller drops.)
    const own = radios;
    try {
        const listed = await ytmRadioSongs(seed.id);
        const songs = listed.filter(song => song.id !== seed.id && !own.shown.has(song.id));
        if (songs.length < RADIO_BATCH) {
            console.log(`[Ytm] Explore radio of ${seed.id}: ${songs.length} of ${listed.length} songs on no other shelf, too few for a shelf`);
            return null;
        }
        songs.forEach(song => own.shown.add(song.id));
        own.songs.set(seed.id, songs.map(song => ({ kind: 'song', song: normalizeYtmSong(song) })));
        console.log(`[Ytm] Explore radio of ${seed.id}: a shelf of ${songs.length} songs (${listed.length} read)`);
        return {
            id: `ytm-shelf-${++sectionsRead}`,
            // (The radio names its song as YouTube Music does; a tile of the page carries the video's title.)
            title: i18n.t('home.exploreSimilar', { name: listed.find(song => song.id === seed.id)?.name || seed.name }),
            items: own.songs.get(seed.id)!.slice(0, RADIO_BATCH),
            ...(songs.length > RADIO_BATCH ? { moreCursor: radioCursor(seed.id, RADIO_BATCH) } : {}),
            // Another read asks with other songs: its shelves take the places of these.
            changesWithRead: true,
        };
    } catch (error) {
        console.warn(`[Ytm] Explore radio of ${seed.id} could not be read (${errorMessage(error)}); the page goes on without it`);
        return null;
    }
};

// Up to `count` such shelves, each asked with the next song: the ones no read before asked with
// first, then the ones asked with longest ago. Fewer where the songs or the read's requests run out.
const radioShelves = async (count: number): Promise<ProviderExploreSection[]> => {
    const seeds = handedOut.inTurn(SEEDS, radios.seeds, seed => seed.id).slice(0, Math.min(count, MAX_RADIOS - radios.asked));
    radios.seeds = radios.seeds.filter(seed => !seeds.includes(seed));
    handedOut.note(SEEDS, seeds.map(seed => seed.id));
    radios.asked += seeds.length;
    return (await Promise.all(seeds.map(radioShelf))).filter((shelf): shelf is ProviderExploreSection => shelf !== null);
};

const songsOf = (sections: YtmWireExplorePage['sections']): YtmSeed[] => sections.flatMap(section => section.items)
    .flatMap(item => (item.kind === 'song' ? [{ id: item.song.id, name: item.song.name }] : []));

// A read of the page from its start, asked with `listened` first. It is counted before the
// answer (a request that fails may have reached YouTube), the shelves made here begin anew with
// it, and its answer is the page at hand.
const askFirstPage = (listened: YtmSeed[]): Promise<YtmWireExplorePage> => {
    pagesRead += 1;
    radios = noRadios();
    addSeeds(listened);
    const asked = afterTheLast(() => requestYtm<YtmWireExplorePage>('explore', {}));
    firstPage = asked;
    // (A read that failed is not kept: the next one asks YouTube again.)
    asked.catch(() => { if (firstPage === asked) firstPage = null; });
    return asked;
};

export const ytmExplore: OnlineExploreProvider = {
    async getFeed(cursor, listened = []) {
        // The songs played here are noted for the personal FM too, which is not handed them.
        if (!cursor) noteYtmListened(listened.map(ytmSeedOf));
        // (Counted before the answer: a request that fails may have reached YouTube.)
        const start = cursor ? null : askFirstPage(ytmListenedSeeds());
        const read = pagesRead;
        const token = cursor ? tokenOf(cursor) : undefined;
        if (token === null) {
            console.log('[Ytm] Explore page: further shelves asked for with a token of a read before; none given');
            return { sections: [] };
        }
        if (token?.startsWith(RADIO_PAGE)) {
            const shelves = await radioShelves(RADIOS_A_PAGE);
            if (read !== pagesRead) return { sections: [] };
            console.log(`[Ytm] Explore page (shelves made here): ${shelves.length} shelves; ${radios.asked} of ${MAX_RADIOS} songs asked with, ${radios.seeds.length} more to ask with`);
            return { sections: shelves, ...(hasRadiosLeft() ? { nextCursor: radioPageCursor() } : {}) };
        }
        // (The first page is YouTube's shelves alone, and comes no later than it did.)
        const own = radios;
        const asked = start ?? requestYtm<YtmWireExplorePage>('explore', { continuation: token });
        // A shelf is asked for beside the page; one that waits from a read of this page that failed is not asked for again.
        const beside = token && own.waiting.length === 0 ? radioShelves(1) : Promise.resolve<ProviderExploreSection[]>([]);
        const page = await asked.catch(error => {
            // (The failure is reported at once; the shelf waits from when it arrives.)
            void beside.then(made => own.waiting.push(...made));
            throw error;
        });
        const shelves = [...own.waiting.splice(0), ...await beside];
        // The page was asked for from its start meanwhile. What a token brought may be of either
        // read; a first page is the shelves it says, with a token that no longer stands.
        const stands = read === pagesRead;
        if (!stands && cursor) return { sections: [] };
        const isOwnListening = (section: { title: string }) => LISTENING_RECORD_HEADINGS.has(section.title);
        const sections = page.sections.filter(section => !isOwnListening(section)).map(section => ({
            id: `ytm-shelf-${++sectionsRead}`,
            title: section.title,
            items: section.items.map(toItem),
        }));
        if (stands) addSeeds([...songsOf(page.sections.filter(isOwnListening)), ...songsOf(page.sections.filter(section => !isOwnListening(section)))]);
        console.log(`[Ytm] Explore page${cursor ? ' (further shelves)' : ''}: ${sections.length} shelves, ${sections.reduce((sum, section) => sum + section.items.length, 0)} entries; ${page.sections.length - sections.length} shelves of the account's own listening left out`);
        const nextCursor = !stands ? undefined : page.continuation ? stamped(page.continuation) : hasRadiosLeft() ? radioPageCursor() : undefined;
        return { sections: [...shelves, ...sections], ...(nextCursor ? { nextCursor } : {}) };
    },
    // Only a shelf made here has further entries, and it hands out what it holds: YouTube is not asked.
    async getSectionItems(cursor) {
        const token = tokenOf(cursor);
        if (token === null || !token.startsWith(RADIO)) {
            console.log('[Ytm] Explore shelf: further entries asked for with a token of a read before, or of no shelf made here; none given');
            return { items: [] };
        }
        const [, id, place] = token.split(' ');
        const songs = radios.songs.get(id) ?? [];
        const end = Number(place) + RADIO_BATCH;
        console.log(`[Ytm] Explore radio of ${id}: ${songs.slice(Number(place), end).length} further songs from place ${place}, ${Math.max(0, songs.length - end)} after them`);
        return { items: songs.slice(Number(place), end), ...(end < songs.length ? { moreCursor: radioCursor(id, end) } : {}) };
    },
    // A music video recorded as played is set right to its song (the main process's asShown): one
    // played before videos in lists were shown as their songs, or one an album page lists with
    // the album track's length and the album's picture. Its looks do not tell it, so every track
    // is asked about, once (the record keeps which were).
    async songsShownAs(songs) {
        const ids = [...new Set(songs.flatMap(song => (
            song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'ytm' ? [String(song.sourceRef.mediaId)] : []
        )))];
        if (ids.length === 0) return new Map();
        const { songs: found } = await requestYtm<{ songs: Record<string, YtmWireSong | null> }>('song_versions', { ids: ids.join(',') });
        return new Map(Object.entries(found).map(([id, song]) => [id, song && normalizeYtmSong(song)]));
    },
};

/**
 * The playlists and mixes on the account's music page, in the page's order, each once; the shelves
 * of the account's own listening are left out, as on the explore page. They are taken from the
 * page as it was last read for the explore page, whatever its age: a read from the start made
 * here would end the tokens the explore page holds. Only where no read is at hand is the page
 * read here, counted as a read from the start like any other.
 */
export const ytmMusicPagePlaylists = async (): Promise<ProviderCollection[]> => {
    const atHand = firstPage !== null;
    const page = await (firstPage ?? askFirstPage(ytmListenedSeeds()));
    const lists = new Map<string, ProviderCollection>();
    for (const section of page.sections) {
        if (LISTENING_RECORD_HEADINGS.has(section.title)) continue;
        for (const item of section.items) {
            if (item.kind !== 'collection' || item.collection.type !== 'playlist' || lists.has(item.collection.id)) continue;
            lists.set(item.collection.id, normalizeYtmCollection(item.collection, 'playlist'));
        }
    }
    console.log(`[Ytm] Music page playlists: ${lists.size} playlists and mixes on ${page.sections.length} shelves (${atHand ? 'the page as it was last read for the explore page' : 'the page read here'})`);
    return [...lists.values()];
};
