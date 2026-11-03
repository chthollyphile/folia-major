import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import type {
    OnlineExploreProvider,
    ProviderCollection,
    ProviderExploreItem,
    ProviderExploreItemsPage,
    ProviderExplorePage,
    ProviderExploreSection,
} from '../../../types/onlineMusic';
import { neteaseApi } from './netease';
import { createHandedOut, cursorWords, stampCursor } from '../exploreReads';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/netease/neteaseExplore.ts
// The explore page of NetEase Cloud Music, in three parts, each asked for when the list gets to
// it. (What a guest is answered was measured 2026-10-08, one request an endpoint, and 2026-10-09,
// the same request twice or more. What an account is answered was not seen: its shapes are the
// ones the API package documents.)
//  1. The first page. NetEase's own home page as its mobile client reads it: blocks under
//     NetEase's headings, of playlists, songs and albums (a guest got 3: 12 playlists, 12 songs
//     NetEase guesses the listener likes, 6 new songs with 5 new albums). Signed in, the
//     account's daily songs stand before them and its daily playlists after them; a guest is
//     answered those too (3 songs, 6 playlists, the same for everyone), so they are asked for
//     with an account only. Last, NetEase's charts (63).
//  2. The further blocks of the home page, while NetEase names any (a guest's page had none).
//  3. Shelves made here, a page of them at a time: the songs NetEase lists as like one song (5 a
//     song, whatever number is asked for), the new songs (100) and new albums (500), the songs
//     of the four official charts, the playlists most played (683). The songs asked with are the
//     ones the listener played in the app (`listened`), then the account's daily songs, then the
//     songs of the home page.
// "Refresh", by the explore page's own rule, reads the page anew only once no shelf has further
// entries behind a cursor of its own (useExploreFeedStore), and here only a read anew changes
// every shelf. Measured as a guest: the home page asked six times in 12 seconds had, in one
// block, 12 other songs under another heading in every answer (a heading is exchanged with a read
// anew alone); in another the same 12 playlists in answers 1 to 3 and 12 others in 4 to 6; in the
// third the same entries throughout. No difference was seen between its `refresh` as true and as
// false. A song's similar songs are the same five whatever `offset` is asked with, so a shelf of
// them changes by being made of another song, which a read anew does.
// So this page says that a refresh reads it anew (`refreshReadsAnew`, on its first page): every
// refresh is a read anew, and a shelf hands out one batch in a read. (Until 2026-10-09 a refresh
// went through the shelves' cursors, four batches a read, and the shelves only a read anew
// changes stayed the same in three refreshes out of four.)
// Of all NetEase has under a heading, the shelf hands out what it has not handed out yet first,
// then what it handed out longest ago (`handOut`); a list read a batch at a time goes on where
// the read before stopped; the shelves of similar songs are asked with other songs. (What was
// handed out and asked with is kept by the adapters' shared memory, exploreReads.ts.) A shelf
// NetEase has no more than a batch for stays as it is for as long as NetEase answers the same.
// Every read after a shelf's first logs how many of its entries the read before did not have.
// A shelf's cursor is for its "more" alone (`getSectionItems`), which shows more of the shelf and
// exchanges nothing. A shelf whose list goes on beyond the batch shown has one. A list read whole
// and a home block go on with the next batch of the same list, in `handOut`'s order, until all of
// it is shown; a list read a batch at a time reads the batch after the last one shown, to the
// list's end. What "more" showed counts as handed out in this read: the next read begins with
// what was not shown. A shelf of similar songs, and one of no more than a batch, has no cursor.

interface HomeResource {
    resourceType?: string;
    resourceId?: string | number | null;
    uiElement?: { mainTitle?: { title?: string }; image?: { imageUrl?: string } };
    resourceExtInfo?: {
        songData?: Record<string, unknown>;
        song?: Record<string, unknown>;
        songPrivilege?: unknown;
        artists?: Array<{ id?: number; name?: string }>;
        playCount?: number;
    } | null;
}
interface HomeBlock {
    blockCode?: string;
    uiElement?: { mainTitle?: { title?: string }; subTitle?: { title?: string } };
    creatives?: Array<{ resources?: HomeResource[] | null }> | null;
}

/** The adapter's own normalizers, handed in by neteaseProvider.ts (which imports this file). */
export interface NeteaseExploreNormalizers {
    song(raw: unknown): UnifiedSong;
    collection(raw: unknown, type?: string): ProviderCollection;
}

// A shelf hands out this many entries at a time, at most: one batch with a read of the page, and
// one with each "more" (see the file comment).
const BATCH = 12;
// A page of shelves made of similar songs is this many of them. A shelf costs NetEase one request,
// made when its page is asked for; a read of the page makes at most MAX_SIMILAR.
const SIMILAR_A_PAGE = 3;
const MAX_SIMILAR = 9;
// A shelf of similar songs is not made of fewer songs that are on no other shelf.
const SIMILAR_MIN = 4;
// The charts whose songs make a shelf each: the ones NetEase marks as its official four.
const SONG_CHARTS = 4;
// NetEase's home page is followed this many pages far.
const MAX_HOME_PAGES = 6;

// The cursors, each after the number of the read it is of: of the page's further parts, and of a
// shelf's further entries (the place its "more" goes on from, then the shelf's id or the list).
const HOME_PAGE = 'home ';
const PART = 'part ';
const HELD = 'held ';
const PAGED = 'paged ';

const DAILY_SONGS_ID = 'netease-daily-songs';
const DAILY_PLAYLISTS_ID = 'netease-daily-playlists';
const CHARTS_ID = 'netease-charts';
const NEW_SONGS_ID = 'netease-new-songs';
// The lists read a batch at a time; a chart's songs are `CHART` and the chart's id.
const NEW_ALBUMS = 'new-albums';
const HOT_PLAYLISTS = 'hot-playlists';
const CHART = 'chart-';

// The home page's block of charts is left out: the page has the charts from NetEase's list of
// them (all of them as cards, and the songs of the official four).
const CHART_BLOCK = 'HOMEPAGE_BLOCK_TOPLIST';
// NetEase's own record of the account's listening is left out too (see OnlineExploreProvider):
// the explore page has such sections from the app's own record alone. A guest's home page has no
// such block and an account's was not seen, so these are told by the words NetEase's block codes
// and headings would use for them. One it names otherwise stays on the page until it is added
// here: every read logs the codes it met.
const isListeningRecord = (code: string, title: string) => /RECENT|HISTORY/.test(code) || title.startsWith('最近');

interface Seed { id: string; name: string }
// The scope the songs asked with are noted under in `handedOut`; a shelf's entries are noted under the shelf's id.
const SEEDS = 'seeds';
// What the reads before handed out, kept by shelf and list alone: a read orders its shelves by it.
const newMemory = () => ({
    /** Where each list read a batch at a time was left, by the list: the next read goes on from there. */
    reached: new Map<string, number>(),
    /**
     * What the reads before used, in the order it was used:
     * the entries a shelf handed out (with the read's batch or through its "more"), by the
     * shelf's id, and the songs asked with (`SEEDS`). A later read hands out, and asks with,
     * the others first.
     */
    handedOut: createHandedOut(),
    /**
     * What a shelf's entries are counted against for the line a refresh logs: the entries of the
     * read before (`earlier`), by the name the shelf is counted under.
     */
    handedLast: new Map<string, { read: number; keys: Set<string>; earlier?: Set<string> }>(),
});
// What one read of the page from its start holds.
const newRead = (number: number, memory: ReturnType<typeof newMemory>) => ({
    number,
    /** The memory this read orders its shelves by and writes what it hands out to (see `hadAccount`). */
    memory,
    /** The shelves of the home page that stand: their ids, and each block's code with its heading. */
    blockIds: new Set<string>(),
    blocks: new Set<string>(),
    /** NetEase's token for the blocks after the ones read, and how many further pages of them were read. */
    homeCursor: undefined as string | undefined,
    homePages: 0,
    /** NetEase's charts, asked for once in a read. */
    charts: undefined as Promise<any[]> | undefined,
    /** Each list read whole and each home block, by its shelf's id, in the order this read hands it out in: the shelf's batch, then what its "more" goes on with. */
    held: new Map<string, ProviderExploreItem[]>(),
    /** The songs a shelf may still be made of, the ones to ask with first at the front. */
    seeds: [] as Seed[],
    /** Every song that was put among them: a song is asked with once in a read. */
    known: new Set<string>(),
    /** How many were asked with. */
    asked: 0,
    /** The songs on a shelf of similar songs: a song is on one of them in a read. */
    onShelf: new Set<string>(),
});
type Read = ReturnType<typeof newRead>;

const present = <T>(value: T | null | undefined): value is T => value != null;
const wordsOf = (error: unknown) => errorMessage(error);
const keyOf = (item: ProviderExploreItem): string => (item.kind === 'collection' ? `${item.collection.type}:${item.collection.id}` : `song:${item.song.id}`);
const countOf = (sections: ProviderExploreSection[]) => sections.reduce((count, section) => count + section.items.length, 0);
/** The rows of a list in an answer that name something: an id and a name. */
const rowsOf = (list: unknown): any[] => (Array.isArray(list) ? list.filter(row => row && row.id && row.name) : []);
const blocksIn = (answer: any): HomeBlock[] => (Array.isArray(answer?.data?.blocks) ? answer.data.blocks : []);
/** NetEase's token for the blocks after an answer's own; none where it says the page ends there. */
const cursorIn = (answer: any): string | undefined => {
    const cursor = answer?.data?.cursor;
    if (!answer?.data?.hasMore || !cursor) return undefined;
    return typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
};
const songsOf = (items: ProviderExploreItem[]): Seed[] => items.flatMap(item => (item.kind === 'song' ? [{ id: String(item.song.id), name: item.song.name }] : []));

/** What arrived of the requests `asked`, each in its place, null for one that failed. Fails when none of them arrived. */
const arrivedOf = async <T>(what: string, asked: Array<Promise<T>>): Promise<Array<T | null>> => {
    const answers = await Promise.allSettled(asked);
    const failed = answers.filter((answer): answer is PromiseRejectedResult => answer.status === 'rejected');
    if (failed.length > 0 && failed.length === answers.length) throw failed[0].reason;
    failed.forEach(answer => console.warn(`[Netease] Explore page: part of ${what} could not be read (${wordsOf(answer.reason)}); the page goes on without it`));
    return answers.map(answer => (answer.status === 'fulfilled' ? answer.value : null));
};

export const createNeteaseExplore = (normalize: NeteaseExploreNormalizers): OnlineExploreProvider => {
    let reads = 0;
    let memory = newMemory();
    // The read whose page is on screen. A read from the start takes its place once its first page has arrived.
    let page = newRead(0, memory);
    // One read from the start at a time: the cursors that stand are those of the read that
    // arrived last, which has to be the one asked for last.
    let lastRead: Promise<unknown> = Promise.resolve();
    // A shelf of similar songs is another one in every read; it is told apart by when it was made.
    let shelvesMade = 0;
    // Whether the read before was an account's. The memory (`newMemory`) is kept by shelf and
    // list alone, and all this file can tell of the account is whether there is one
    // (`hasAccountSession`): a read that finds that changed starts a memory of its own, so a
    // guest's reads do not order an account's shelves or count in its refresh lines, nor the
    // other way round. A read carries the memory it began with: a part of a guest's read that
    // arrives after the account's read has begun writes to the guest's memory, which nothing
    // reads any more. One account in the place of another with no read as a guest between them
    // is not told apart: its first read is ordered by the other's reads, and logs refresh lines
    // against them.
    let hadAccount: boolean | undefined;

    const stamp = (read: Read, words: string) => stampCursor(read.number, words);
    /** What a cursor says, where it is of the read on screen; null for one of a read before. */
    const wordsIn = (cursor: string): string | null => cursorWords(cursor, page.number);

    const songItem = (raw: unknown): ProviderExploreItem => ({ kind: 'song', song: normalize.song(raw) });
    // (Only the fields named: a row's own `type` is a number in one list and the release kind in another.)
    const playlistItem = (raw: any): ProviderExploreItem => ({
        kind: 'collection',
        collection: normalize.collection({
            id: raw.id, name: raw.name, coverImgUrl: raw.coverImgUrl ?? raw.picUrl, description: raw.description ?? raw.copywriter,
            trackCount: raw.trackCount, playCount: raw.playCount ?? raw.playcount, creator: raw.creator,
        }),
    });
    const albumItem = (raw: any): ProviderExploreItem => ({
        kind: 'collection',
        collection: normalize.collection({ id: raw.id, name: raw.name, picUrl: raw.picUrl, artists: raw.artists, size: raw.size, publishTime: raw.publishTime }, 'album'),
    });
    // A chart's second line is how often NetEase says it changes ("每天更新"); a chart has no maker to name.
    const chartItem = (raw: any): ProviderExploreItem => ({
        ...playlistItem(raw),
        ...(typeof raw.updateFrequency === 'string' && raw.updateFrequency ? { subtitle: raw.updateFrequency } : {}),
    });

    /** One entry of a home block: a song, a playlist or an album. Null for anything else NetEase puts there (a podcast, a video, a digital album on sale, a link). */
    const itemOf = (resource: HomeResource): ProviderExploreItem | null => {
        const cover = resource.uiElement?.image?.imageUrl || undefined;
        const info: NonNullable<HomeResource['resourceExtInfo']> = resource.resourceExtInfo ?? {};
        if (resource.resourceType === 'song') {
            const raw = info.songData ?? info.song;
            if (!raw) return null;
            const song = normalize.song({ ...raw, privilege: info.songPrivilege ?? raw.privilege });
            if (!song.id) return null;
            return { kind: 'song', song: song.album.coverUrl || !cover ? song : { ...song, album: { ...song.album, coverUrl: cover } } };
        }
        const id = Number(resource.resourceId);
        const name = resource.uiElement?.mainTitle?.title;
        if (!Number.isFinite(id) || id <= 0 || !name) return null;
        if (resource.resourceType === 'list') return { kind: 'collection', collection: normalize.collection({ id, name, coverImgUrl: cover, playCount: info.playCount }) };
        if (resource.resourceType === 'album') return { kind: 'collection', collection: normalize.collection({ id, name, picUrl: cover, artists: info.artists }, 'album') };
        return null;
    };

    /**
     * The blocks of NetEase's home page as shelves, in NetEase's order and under its headings.
     * Left out: the block of charts, NetEase's record of the account's listening, a block with
     * nothing the app shows, and one that stands already (`taken`: the same code under the same
     * heading). A shelf's id is its block's code, so the same block is the same shelf in every read.
     */
    const shelvesOf = (blocks: HomeBlock[], taken: Pick<Read, 'blockIds' | 'blocks'>): { shelves: ProviderExploreSection[]; leftOut: string[] } => {
        const shelves: ProviderExploreSection[] = [];
        const leftOut: string[] = [];
        for (const block of blocks) {
            const code = block.blockCode ?? '';
            const title = block.uiElement?.subTitle?.title || block.uiElement?.mainTitle?.title || '';
            if (code === CHART_BLOCK) { leftOut.push(`${code} (the charts are read from NetEase's list of them)`); continue; }
            if (isListeningRecord(code, title)) { leftOut.push(`${code} (the account's own listening)`); continue; }
            if (taken.blocks.has(`${code} ${title}`)) { leftOut.push(`${code} (stands already)`); continue; }
            // (Each entry once.)
            const met = new Set<string>();
            const items = (block.creatives ?? []).flatMap(creative => creative.resources ?? []).map(itemOf).filter(present).filter(item => {
                if (met.has(keyOf(item))) return false;
                met.add(keyOf(item));
                return true;
            });
            if (items.length === 0) { leftOut.push(`${code} (nothing the app shows)`); continue; }
            let id = `netease-block-${code}`;
            for (let count = 2; taken.blockIds.has(id); count += 1) id = `netease-block-${code}-${count}`;
            taken.blockIds.add(id);
            taken.blocks.add(`${code} ${title}`);
            shelves.push({ id, title, items });
        }
        return { shelves, leftOut };
    };

    /**
     * Logs, for the shelf `id`, how many of the entries it hands out in this read it did not hand
     * out in the read before: `[Netease] Explore refresh: <shelf id> <new>/<handed>`. Nothing in a
     * shelf's first read. The shelves of similar songs are other shelves in every read, so they
     * are counted under one name (`countedAs`), against all of them in the read before.
     */
    const noteHandedOut = (read: Read, id: string, items: ProviderExploreItem[], countedAs = id): void => {
        const keys = items.map(keyOf);
        const last = read.memory.handedLast.get(countedAs);
        const now = last?.read === read.number ? last : { read: read.number, keys: new Set<string>(), earlier: last?.keys };
        keys.forEach(key => now.keys.add(key));
        read.memory.handedLast.set(countedAs, now);
        const { earlier } = now;
        if (earlier) console.log(`[Netease] Explore refresh: ${id} ${keys.filter(key => !earlier.has(key)).length}/${keys.length}`);
    };
    /** What the "more" of the shelf `id` showed is among what it handed out in this read: the line the next read logs counts against it too. */
    const noteShownFurther = (read: Read, id: string, items: ProviderExploreItem[]): void => {
        const noted = read.memory.handedLast.get(id);
        if (noted?.read === read.number) items.forEach(item => noted.keys.add(keyOf(item)));
    };

    /**
     * One batch of the shelf `id` out of all NetEase has under it now (`all`): the entries the
     * shelf has not handed out yet first, then the ones it handed out longest ago. So a list that
     * stays the same is gone through to its end before its first entries come again, and hands
     * out the same batch twice in a row only where it is no longer than one or its "more" showed
     * all of it; of what NetEase picks anew, the entries the shelf has not had come first.
     * Where the list is longer than the batch, the rest stays with the read in that order behind
     * the shelf's cursor: its "more" goes on with it (`getSectionItems`).
     */
    const handOut = (read: Read, id: string, listed: ProviderExploreItem[]): Pick<ProviderExploreSection, 'items' | 'moreCursor'> => {
        // (An entry NetEase lists twice is handed out once.)
        const all = [...new Map(listed.map(item => [keyOf(item), item] as const)).values()];
        // (NetEase's order stays among the entries never handed out.)
        const inTurn = read.memory.handedOut.inTurn(id, all, keyOf);
        const items = inTurn.slice(0, BATCH);
        read.memory.handedOut.note(id, items.map(keyOf));
        read.held.set(id, inTurn);
        noteHandedOut(read, id, items);
        return { items, ...(inTurn.length > BATCH ? { moreCursor: stamp(read, `${HELD}${BATCH} ${id}`) } : {}) };
    };

    /** A shelf of a list that was read whole: one batch of it, and a cursor where it holds more (see `handOut`). */
    const listShelf = (read: Read, id: string, title: string, all: ProviderExploreItem[]): ProviderExploreSection | null => (
        all.length > 0 ? { id, title, ...handOut(read, id, all) } : null
    );

    /** A batch of the list `key` from `offset`, and whether NetEase has more of it after them. */
    const readPaged = async (key: string, offset: number): Promise<{ items: ProviderExploreItem[]; hasMore: boolean }> => {
        if (key === NEW_ALBUMS) {
            const answer = await neteaseApi.getNewAlbums(BATCH, offset);
            const items = rowsOf(answer?.albums).map(albumItem);
            return { items, hasMore: offset + items.length < Number(answer?.total ?? 0) };
        }
        if (key === HOT_PLAYLISTS) {
            const answer = await neteaseApi.getHotPlaylists(BATCH, offset);
            return { items: rowsOf(answer?.playlists).map(playlistItem), hasMore: Boolean(answer?.more) };
        }
        const answer = await neteaseApi.getPlaylistTracks(Number(key.slice(CHART.length)), BATCH, offset);
        const items = rowsOf(answer?.songs).map(songItem);
        return { items, hasMore: items.length === BATCH };
    };
    /**
     * A shelf of the list `key`: the batch after the last one the read before handed out (itself,
     * or through the shelf's "more"), and the list's first batch again once its last was handed
     * out. With a cursor for the batch after it, where the list goes on.
     */
    const pagedShelf = async (read: Read, key: string, title: string): Promise<ProviderExploreSection | null> => {
        let from = read.memory.reached.get(key) ?? 0;
        let batch = await readPaged(key, from);
        // (The list has got shorter than where the read before stopped: from its start.)
        if (batch.items.length === 0 && from > 0) {
            from = 0;
            batch = await readPaged(key, 0);
        }
        const next = from + batch.items.length;
        const goesOn = batch.hasMore && batch.items.length > 0;
        // (At its end the list starts over in the next read.)
        read.memory.reached.set(key, goesOn ? next : 0);
        if (batch.items.length === 0) return null;
        noteHandedOut(read, `netease-${key}`, batch.items);
        return { id: `netease-${key}`, title, items: batch.items, ...(goesOn ? { moreCursor: stamp(read, `${PAGED}${next} ${key}`) } : {}) };
    };

    const chartsOf = (read: Read): Promise<any[]> => {
        if (!read.charts) {
            read.charts = neteaseApi.getToplists().then((answer: any) => rowsOf(answer?.list));
            // (One that failed is asked for again.)
            read.charts.catch(() => { read.charts = undefined; });
        }
        return read.charts;
    };

    const addSeeds = (read: Read, songs: Seed[]): void => {
        for (const song of songs) {
            if (!song.name || !Number.isFinite(Number(song.id)) || read.known.has(song.id)) continue;
            read.known.add(song.id);
            read.seeds.push(song);
        }
    };
    // Up to `count` songs to ask with: the ones no read before asked with first, then the ones
    // asked with longest ago.
    const takeSeeds = (read: Read, count: number): Seed[] => {
        const taken = read.memory.handedOut.inTurn(SEEDS, read.seeds, seed => seed.id).slice(0, Math.min(count, MAX_SIMILAR - read.asked));
        read.seeds = read.seeds.filter(seed => !taken.includes(seed));
        read.memory.handedOut.note(SEEDS, taken.map(seed => seed.id));
        read.asked += taken.length;
        return taken;
    };

    // The songs NetEase lists as like the song `seedId` that are on no shelf of this read, each
    // once. They are on a shelf from then on, unless they are too few for one. (Marked here, in one
    // go with the choice: the shelves of a page are read side by side, and a song two of them were
    // given would be chosen by both.)
    const similarSongs = async (read: Read, seedId: string): Promise<UnifiedSong[]> => {
        const answer = await neteaseApi.getSimilarSongs(Number(seedId));
        const found: UnifiedSong[] = rowsOf(answer?.songs).map(normalize.song);
        const met = new Set([seedId]);
        const songs = found.filter(song => {
            const id = String(song.id);
            if (met.has(id) || read.onShelf.has(id)) return false;
            met.add(id);
            return true;
        });
        if (songs.length >= SIMILAR_MIN) songs.forEach(song => read.onShelf.add(String(song.id)));
        return songs;
    };
    /** A shelf of the songs like `seed`; null where they could not be read, or too few of them are on no other shelf. */
    const similarShelf = async (read: Read, seed: Seed): Promise<ProviderExploreSection | null> => {
        try {
            const songs = await similarSongs(read, seed.id);
            if (songs.length < SIMILAR_MIN) {
                console.log(`[Netease] Explore songs like ${seed.id}: ${songs.length} on no other shelf, too few for a shelf`);
                return null;
            }
            console.log(`[Netease] Explore songs like ${seed.id}: a shelf of ${songs.length} songs`);
            // (NetEase gives 5 songs an answer and has no others for the song: see `getSimilarSongs`.)
            const shelf: ProviderExploreSection = {
                id: `netease-similar-${++shelvesMade}`,
                title: i18n.t('home.exploreSimilar', { name: seed.name }),
                items: songs.map(song => ({ kind: 'song', song })),
                // Another read asks with other songs: its shelves take the places of these.
                changesWithRead: true,
            };
            noteHandedOut(read, shelf.id, shelf.items, 'netease-similar');
            return shelf;
        } catch (error) {
            console.warn(`[Netease] Explore songs like ${seed.id} could not be read (${wordsOf(error)}); the page goes on without them`);
            return null;
        }
    };

    // The pages of shelves made here, in the order the list comes to them. One fails when nothing of it could be read.
    const similarPart = async (read: Read): Promise<ProviderExploreSection[]> => (
        (await Promise.all(takeSeeds(read, SIMILAR_A_PAGE).map(seed => similarShelf(read, seed)))).filter(present)
    );
    const newPart = async (read: Read): Promise<ProviderExploreSection[]> => (await arrivedOf('the new songs and albums', [
        neteaseApi.getNewSongs().then((answer: any) => listShelf(read, NEW_SONGS_ID, i18n.t('home.neteaseNewSongs'), rowsOf(answer?.songs).map(songItem))),
        pagedShelf(read, NEW_ALBUMS, i18n.t('home.neteaseNewAlbums')),
    ])).filter(present);
    const chartsPart = async (read: Read): Promise<ProviderExploreSection[]> => {
        const charts = await chartsOf(read);
        const official = charts.filter(chart => chart.ToplistType);
        const shelves = (official.length > 0 ? official : charts).slice(0, SONG_CHARTS).map(chart => pagedShelf(read, `${CHART}${chart.id}`, String(chart.name)));
        return (await arrivedOf('the songs of the charts', shelves)).filter(present);
    };
    const playlistsPart = async (read: Read): Promise<ProviderExploreSection[]> => [await pagedShelf(read, HOT_PLAYLISTS, i18n.t('home.neteaseHotPlaylists'))].filter(present);
    const PARTS = [similarPart, newPart, similarPart, chartsPart, similarPart, playlistsPart];

    // The pages made here from the one at `from`: the first that has a shelf (one of similar songs
    // has none once the songs to ask with, or the read's requests, have run out).
    const madeHere = async (read: Read, from: number): Promise<ProviderExplorePage> => {
        for (let index = from; index < PARTS.length; index += 1) {
            const sections = await PARTS[index](read);
            if (read !== page) return { sections: [] };
            if (sections.length === 0) continue;
            console.log(`[Netease] Explore page (shelves made here, part ${index + 1} of ${PARTS.length}): ${sections.length} shelves, ${countOf(sections)} entries; ${read.asked} of ${MAX_SIMILAR} songs asked with, ${read.seeds.length} more to ask with`);
            return { sections, ...(index + 1 < PARTS.length ? { nextCursor: stamp(read, `${PART}${index + 1}`) } : {}) };
        }
        return { sections: [] };
    };

    const firstPage = async (listened: UnifiedSong[]): Promise<ProviderExplorePage> => {
        const signedIn = neteaseApi.hasAccountSession();
        if (hadAccount !== undefined && hadAccount !== signedIn) {
            memory = newMemory();
            console.log(`[Netease] Explore page: read ${signedIn ? 'for an account after a guest' : 'for a guest after an account'}; what the shelves handed out before is forgotten`);
        }
        hadAccount = signedIn;
        const read = newRead(++reads, memory);
        const [home, charts, daily, lists] = await arrivedOf<any>('the first page', [
            neteaseApi.getHomeBlocks(),
            chartsOf(read),
            ...(signedIn ? [neteaseApi.getDailyRecommendedSongs(), neteaseApi.getDailyRecommendedPlaylists()] : []),
        ]);
        const { shelves, leftOut } = shelvesOf(blocksIn(home), read);
        // A shelf of this page hands out one batch of its block, as a list read whole does.
        const blocks = shelves.map(shelf => ({ ...shelf, ...handOut(read, shelf.id, shelf.items) }));
        read.homeCursor = cursorIn(home);
        const dailySongs = rowsOf(daily?.songs).map(songItem);
        const sections = [
            listShelf(read, DAILY_SONGS_ID, i18n.t('home.dailyRecommendations'), dailySongs),
            ...blocks,
            listShelf(read, DAILY_PLAYLISTS_ID, i18n.t('home.neteaseDailyPlaylists'), rowsOf(lists?.recommend).map(playlistItem)),
            listShelf(read, CHARTS_ID, i18n.t('home.neteaseCharts'), (charts ?? []).map(chartItem)),
        ].filter(present);
        // (A song of the account's cloud drive is none NetEase lists songs like.)
        const played = listened.filter(song => !(song.sourceRef?.kind === 'online' && song.sourceRef.variant === 'cloud'));
        addSeeds(read, [...played.map(song => ({ id: String(song.id), name: song.name })), ...songsOf(dailySongs), ...songsOf(shelves.flatMap(shelf => shelf.items))]);
        page = read;
        const account = signedIn
            ? `signed in: ${dailySongs.length} daily songs (code ${daily?.code ?? 'none'}), ${rowsOf(lists?.recommend).length} daily playlists (code ${lists?.code ?? 'none'})`
            : 'a guest: the daily songs and playlists are not asked for';
        console.log(`[Netease] Explore page: ${sections.length} shelves, ${countOf(sections)} entries; ${account}; ${blocks.length} of ${blocksIn(home).length} home blocks (code ${home?.code ?? 'none'})${leftOut.length > 0 ? `, left out: ${leftOut.join(', ')}` : ''}; ${(charts ?? []).length} charts; further home blocks: ${read.homeCursor ? 'yes' : 'no'}`);
        // (`refreshReadsAnew`: see the file comment.)
        return { sections, nextCursor: stamp(read, read.homeCursor ? `${HOME_PAGE}1` : `${PART}0`), refreshReadsAnew: true };
    };

    // The blocks of the home page after the ones read: the next of its pages that has a shelf to
    // show. A page with none (blocks that are left out, or the ones already standing) is passed
    // over here, as `madeHere` passes over its own: the list's reader takes a few pages in a row
    // with nothing on them for the list's end. Where a page cannot be read, or NetEase's pages
    // are through, the list goes on to the shelves made here.
    const furtherHome = async (read: Read): Promise<ProviderExplorePage> => {
        while (read.homeCursor) {
            const asked = read.homeCursor;
            try {
                const answer = await neteaseApi.getHomeBlocks(asked);
                if (read !== page) return { sections: [] };
                const { shelves, leftOut } = shelvesOf(blocksIn(answer), read);
                const next = cursorIn(answer);
                read.homePages += 1;
                // (A token that names itself, or a page past the last one followed, ends NetEase's page.)
                read.homeCursor = next !== asked && read.homePages < MAX_HOME_PAGES ? next : undefined;
                addSeeds(read, songsOf(shelves.flatMap(shelf => shelf.items)));
                const sections = shelves.map(shelf => ({ ...shelf, ...handOut(read, shelf.id, shelf.items) }));
                console.log(`[Netease] Explore page (further home blocks, page ${read.homePages}): ${sections.length} of ${blocksIn(answer).length} blocks (code ${answer?.code ?? 'none'}), ${countOf(sections)} entries${leftOut.length > 0 ? `, left out: ${leftOut.join(', ')}` : ''}`);
                if (sections.length > 0) return { sections, nextCursor: stamp(read, read.homeCursor ? `${HOME_PAGE}${read.homePages + 1}` : `${PART}0`) };
            } catch (error) {
                console.warn(`[Netease] Explore page: the further home blocks could not be read (${wordsOf(error)}); the page goes on without them`);
                read.homeCursor = undefined;
            }
        }
        return madeHere(read, 0);
    };

    return {
        async getFeed(cursor, listened = []) {
            if (!cursor) {
                const answer = lastRead.then(() => firstPage(listened), () => firstPage(listened));
                lastRead = answer.catch(() => undefined);
                return answer;
            }
            const read = page;
            const words = wordsIn(cursor);
            if (words === null) {
                console.log('[Netease] Explore page: further shelves asked for with a cursor of a read before; none given');
                return { sections: [] };
            }
            if (words.startsWith(HOME_PAGE)) return read.homeCursor ? furtherHome(read) : madeHere(read, 0);
            if (words.startsWith(PART)) return madeHere(read, Number(words.slice(PART.length)) || 0);
            return { sections: [] };
        },
        // A shelf's "more": the batch after the ones it shows. (A refresh does not come here: the
        // page says that a refresh reads it anew.)
        async getSectionItems(cursor): Promise<ProviderExploreItemsPage> {
            const read = page;
            const words = wordsIn(cursor);
            if (words === null) {
                console.log('[Netease] Explore shelf: further entries asked for with a cursor of a read before; none given');
                return { items: [] };
            }
            // (The place first: it is a number, whatever the id after it holds.)
            const placed = (rest: string): [number, string] => {
                const at = rest.indexOf(' ');
                return [Number(rest.slice(0, at)) || 0, rest.slice(at + 1)];
            };
            // A shelf of a list read whole, or of a home block, hands out what the read holds of it: NetEase is not asked.
            if (words.startsWith(HELD)) {
                const [place, id] = placed(words.slice(HELD.length));
                const held = read.held.get(id) ?? [];
                const end = place + BATCH;
                const items = held.slice(place, end);
                // (Handed out in this read: the next read begins with what was not.)
                read.memory.handedOut.note(id, items.map(keyOf));
                noteShownFurther(read, id, items);
                console.log(`[Netease] Explore shelf ${id}: ${items.length} further entries from place ${place}, ${Math.max(0, held.length - end)} after them`);
                return { items, ...(end < held.length ? { moreCursor: stamp(read, `${HELD}${end} ${id}`) } : {}) };
            }
            if (words.startsWith(PAGED)) {
                const [offset, key] = placed(words.slice(PAGED.length));
                const batch = await readPaged(key, offset);
                if (read !== page) return { items: [] };
                const next = offset + batch.items.length;
                const goesOn = batch.hasMore && batch.items.length > 0;
                // (The next read goes on after what "more" showed; at its end the list starts over.)
                read.memory.reached.set(key, goesOn ? next : 0);
                noteShownFurther(read, `netease-${key}`, batch.items);
                console.log(`[Netease] Explore shelf netease-${key}: ${batch.items.length} further entries from place ${offset}${goesOn ? '' : ', the last of the list'}`);
                return { items: batch.items, ...(goesOn ? { moreCursor: stamp(read, `${PAGED}${next} ${key}`) } : {}) };
            }
            return { items: [] };
        },
    };
};
