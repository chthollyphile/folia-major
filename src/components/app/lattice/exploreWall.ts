import type { SongResult } from '../../../types';
import type { OmniExploreItem, OmniExploreSection } from '../../../types/onlineMusic';
import type { ExploreFeed } from '../../../stores/useExploreFeedStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { faceOf } from '../home/explore/exploreFace';
import type { WallSection } from './wallLayout';
import type { LatticeTile, WallEntryKind } from './latticeModel';

// src/components/app/lattice/exploreWall.ts
// The wall's second source. Opened from the explore tab, the wall shows what the explore page
// holds in place of the play queue: the sections of useExploreFeedStore, section after section
// in the page's order, so albums, playlists, artists, mixes and songs. The app's own sections
// (recently played, play again) are not in that store: a wall that shows them is handed them
// (useExploreWall's `ownSections`; Bravais' explore tab does, the grid's wall does not), and they
// stand before the page's.
// The wall is laid out by those sections (exploreLayout.ts): each tile says which section it
// stands in and what it is, and `sectionsOfTiles` hands the sections out.
// Also here: when the wall asks for the page's further sections, and when it is handed them.
// Pure functions only: the connection to the store is useExploreWall.ts. Nothing here knows
// which provider the page is of.

/** Whether the wall would have an entry to show; the home header offers it on the explore tab only then. */
export const hasExploreWallEntries = (feed: { sections: OmniExploreSection[] } | null): boolean => (
    Boolean(feed?.sections.some(section => section.items.length > 0))
);

// What an entry is. For a collection this is the choice `faceOf` makes for a card that has no
// second line of its own; it does not hand the choice out, so it is made again here (a test
// holds the two together).
const kindOf = (item: OmniExploreItem): WallEntryKind => {
    if (item.kind === 'song') return 'song';
    if (item.collection.type === 'artist') return 'artist';
    if (item.collection.type === 'album') return 'album';
    return item.isMix ? 'mix' : 'playlist';
};

const NO_IDS: ReadonlySet<string> = new Set();

/** The word for each kind of entry, as an i18n key: the explore page's words. A song the page never names: the locale file has the word. */
export const KIND_LABEL_KEYS: Record<WallEntryKind, string> = {
    album: 'home.exploreAlbum',
    playlist: 'home.explorePlaylist',
    mix: 'home.exploreMix',
    artist: 'home.exploreArtist',
    song: 'home.exploreSong',
};

/**
 * The page's entries as tiles, none of them marked as playing. Title, second line and cover are
 * the explore page's (`faceOf`). A song's id is its playback key, by which the wall knows the
 * song on the player; a collection's cannot be taken for one. An entry that comes in several
 * sections is kept once, where it first stands.
 * The app's own sections (`ownSectionIds`) are each a list of their own, as on the explore page:
 * a song of one is kept there whatever other section has it, and its id is its playback key
 * under the section's (`<section id>:<playback key>`), which the wall does not take for the song
 * on the player.
 */
export const buildExploreTiles = (
    sections: OmniExploreSection[],
    t: (key: string) => string,
    ownSectionIds: ReadonlySet<string> = NO_IDS,
): LatticeTile[] => {
    const tiles: LatticeTile[] = [];
    const seen = new Set<string>();
    for (const section of sections) {
        // What the page plays with a song of the section (`select` in ExploreSections): the section's songs, in its order.
        const queue = section.items.flatMap(entry => (entry.kind === 'song' ? [entry.song] : []));
        const isOwn = ownSectionIds.has(section.id);
        for (const item of section.items) {
            const entryKey = item.kind === 'song'
                ? getPlaybackSongKey(item.song)
                : `collection:${item.collection.type}:${item.collection.id}`;
            const id = isOwn ? `${section.id}:${entryKey}` : entryKey;
            if (seen.has(id)) continue;
            seen.add(id);
            const face = faceOf(item, t);
            const entryKind = kindOf(item);
            const shared = {
                id,
                queueIndex: tiles.length,
                title: face.title,
                artist: face.subtitle,
                // The entry's own cover: it fills a seat to the edges (an artist's is drawn round on the seat). (A wide picture may be padding outside its middle.)
                coverUrl: face.coverUrl || face.pictureUrl || undefined,
                section: 'upcoming' as const,
                label: t(KIND_LABEL_KEYS[entryKind]),
                heading: section.title,
                sectionKey: section.id,
                entryKind,
            };
            tiles.push(item.kind === 'song'
                ? { ...shared, kind: 'song', song: item.song, queue }
                : { ...shared, kind: 'collection', collection: item.collection });
        }
    }
    return tiles;
};

/**
 * The sections of the page as the wall lays them out, from the tiles `buildExploreTiles` made:
 * each section's tiles follow each other in the list, so a section is a run of tiles of one
 * section id. A section whose entries all stand in earlier sections has no tile, and so is none
 * of these.
 */
export const sectionsOfTiles = (tiles: LatticeTile[]): WallSection[] => {
    const sections: WallSection[] = [];
    tiles.forEach((tile, index) => {
        const key = tile.sectionKey ?? '';
        let section = sections[sections.length - 1];
        if (!section || section.key !== key) {
            section = { key, heading: tile.heading ?? '', entries: [] };
            sections.push(section);
        }
        section.entries.push({ index, kind: tile.entryKind ?? 'song' });
    });
    return sections;
};

const KINDS: WallEntryKind[] = ['album', 'playlist', 'mix', 'artist', 'song'];

/**
 * A section in one line: how many entries it has and which kinds are among them, in the order
 * the wall puts the kinds ('12 · Album · Playlist · Song').
 */
export const summaryOfSection = (section: WallSection, t: (key: string) => string): string => [
    String(section.entries.length),
    ...KINDS.filter(kind => section.entries.some(entry => entry.kind === kind)).map(kind => t(KIND_LABEL_KEYS[kind])),
].join(' · ');

/**
 * `tiles` with the tile of the song on the player marked 'now'. When that song is none of them
 * they are handed back as they are: the wall then has no 'now' tile, and does not move when the
 * song changes.
 */
export const markPlayingTile = (tiles: LatticeTile[], currentSong: SongResult | null): LatticeTile[] => {
    const currentKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    if (currentKey === null || !tiles.some(tile => tile.id === currentKey)) return tiles;
    return tiles.map(tile => (tile.id === currentKey ? { ...tile, section: 'now' as const } : tile));
};

// Opened with fewer entries than this, and again after every read, the wall asks for the page's
// further sections ...
export const ENOUGH_ENTRIES = 96;
// ... at most this many times for one read of the page (`read` in the store's feed), however
// often the wall is opened on it.
export const MAX_FURTHER_READS = 4;

/** How many further reads the wall asked for, and of which read of the page. */
export type FurtherReadCount = { read: number; count: number };

/** The count as it stands for `read`: another read of the page starts from none. */
export const furtherReadsAsked = (counted: FurtherReadCount | null, read: number | null): number => (
    counted?.read === read ? counted.count : 0
);

/** The count after one more further read was asked of `read`. */
export const withOneMoreRead = (counted: FurtherReadCount | null, read: number): FurtherReadCount => (
    { read, count: furtherReadsAsked(counted, read) + 1 }
);

/**
 * How many of the tiles are the page's entries, those of the app's own sections left out: what
 * `furtherReadsOf` is handed. What the app keeps itself fills no gap of the page.
 */
export const pageEntryCountOf = (tiles: LatticeTile[], ownSectionIds: ReadonlySet<string>): number => (
    tiles.reduce((count, tile) => count + (ownSectionIds.has(tile.sectionKey ?? '') ? 0 : 1), 0)
);

export type FurtherReads = 'ask' | 'wait' | 'over';

/**
 * Where the wall stands with the page's further sections, `asked` further reads into this read
 * of the page. 'ask': it asks for them now. 'wait': a read that changes the list is on its way
 * (those sections, or the listener's refresh). 'over': nothing is asked for and nothing awaited:
 * there are enough entries, the page has no further page, the limit is reached, or a further
 * page could not be read (the page waits for the listener then).
 */
export const furtherReadsOf = (
    feed: Pick<ExploreFeed, 'nextCursor' | 'status' | 'refreshing' | 'loadingMore' | 'moreFailed'> | null,
    entryCount: number,
    asked: number,
): FurtherReads => {
    if (feed?.status !== 'ready') return 'over';
    if (feed.refreshing || feed.loadingMore) return 'wait';
    return feed.nextCursor && !feed.moreFailed && entryCount < ENOUGH_ENTRIES && asked < MAX_FURTHER_READS ? 'ask' : 'over';
};

/** The entries the wall was handed, and the read of the page they are of. */
export type HandedEntries = { read: number | null; entries: LatticeTile[] };

/**
 * What the wall is handed of the page's entries. The number of lots the sections take sets
 * which lot stands where beside the first column (exploreLayout.ts), and a change of it puts
 * other posters there, so the further sections do not reach a wall read by read: while one is
 * asked for or awaited the wall keeps the entries it has (`before` itself), and it takes the
 * whole list when that is over. Another read of the page (the answer to the listener's refresh)
 * is handed over at once, and so is any list to a wall that has none.
 */
export const handedEntriesOf = (before: HandedEntries, read: number | null, entries: LatticeTile[], further: FurtherReads): HandedEntries => {
    const isKept = further !== 'over' && before.read === read && before.entries.length > 0;
    return isKept || (before.read === read && before.entries === entries) ? before : { read, entries };
};
