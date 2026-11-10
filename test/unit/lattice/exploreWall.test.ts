import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '../../../src/types';
import type { OmniExploreItem, OmniExploreSection } from '../../../src/types/onlineMusic';
import {
    buildExploreTiles,
    ENOUGH_ENTRIES,
    furtherReadsAsked,
    furtherReadsOf,
    handedEntriesOf,
    hasExploreWallEntries,
    markPlayingTile,
    MAX_FURTHER_READS,
    pageEntryCountOf,
    sectionsOfTiles,
    summaryOfSection,
    withOneMoreRead,
    type FurtherReadCount,
    type FurtherReads,
    type HandedEntries,
} from '../../../src/components/app/lattice/exploreWall';
import type { LatticeTile } from '../../../src/components/app/lattice/latticeModel';
import { faceOf } from '../../../src/components/app/home/explore/exploreFace';

// test/unit/lattice/exploreWall.test.ts
// The wall opened from the explore tab: which of the page's entries become tiles and in what
// order, what a song tile plays with, which tile is the playing one, and that a tile is called
// what the explore page calls the entry. The sections the wall is laid out by, as the tiles hand
// them out. The app's own sections, each a list of its own before the page's. And its further
// reads of the page: when it asks, how often for one read of the page, and that what they bring
// reaches the wall as one change.

const t = (key: string) => key;

const song = (id: string): UnifiedSong => ({
    id,
    name: `Song ${id}`,
    artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album', coverUrl: `cover-of-${id}` },
    durationMs: 180_000,
    sourceRef: { kind: 'online', providerId: 'ytm', mediaId: id },
});
const songEntry = (id: string): OmniExploreItem => ({ kind: 'song', song: song(id) });
const card = (type: string, id: string, extra: { isMix?: boolean; wideCoverUrl?: string } = {}): OmniExploreItem => ({
    kind: 'collection',
    collection: { providerId: 'ytm', id, name: `${type} ${id}`, type, coverUrl: `cover-of-${id}` },
    ...extra,
});
const section = (id: string, items: OmniExploreItem[], title = `Heading ${id}`): OmniExploreSection => ({ id, title, items });

describe('buildExploreTiles', () => {
    it('lays the entries out section after section, in the order the page has them', () => {
        const tiles = buildExploreTiles([
            section('a', [card('album', '1'), songEntry('s1')]),
            section('b', [card('artist', '2'), card('playlist', '3')]),
        ], t);

        expect(tiles.map(tile => tile.id)).toEqual([
            'collection:album:1',
            'online:ytm:s1',
            'collection:artist:2',
            'collection:playlist:3',
        ]);
        expect(tiles.map(tile => tile.queueIndex)).toEqual([0, 1, 2, 3]);
        expect(tiles.map(tile => tile.heading)).toEqual(['Heading a', 'Heading a', 'Heading b', 'Heading b']);
    });

    it('keeps an entry that comes twice once, at its first place', () => {
        const tiles = buildExploreTiles([
            section('a', [card('album', '1'), songEntry('s1')]),
            section('b', [songEntry('s1'), card('album', '1'), card('playlist', '1'), songEntry('s2')]),
        ], t);

        // (A playlist and an album of one id are two entries.)
        expect(tiles.map(tile => tile.id)).toEqual([
            'collection:album:1',
            'online:ytm:s1',
            'collection:playlist:1',
            'online:ytm:s2',
        ]);
        expect(tiles.map(tile => tile.heading)).toEqual(['Heading a', 'Heading a', 'Heading b', 'Heading b']);
        expect(tiles.map(tile => tile.queueIndex)).toEqual([0, 1, 2, 3]);
    });

    it('plays a song with the songs of its section, in the section order', () => {
        const tiles = buildExploreTiles([
            section('a', [songEntry('s1'), card('album', '1'), songEntry('s2')]),
            section('b', [songEntry('s3'), songEntry('s1')]),
        ], t);
        const queueOf = (id: string) => {
            const tile = tiles.find(candidate => candidate.id === id);
            return tile?.kind === 'song' ? tile.queue?.map(entry => entry.id) : undefined;
        };

        expect(queueOf('online:ytm:s1')).toEqual(['s1', 's2']);
        expect(queueOf('online:ytm:s2')).toEqual(['s1', 's2']);
        // The section's songs as the page has them, the one shown higher up among them.
        expect(queueOf('online:ytm:s3')).toEqual(['s3', 's1']);
    });

    it('calls an entry what the explore page calls it', () => {
        const entries = [card('artist', '1'), card('album', '2'), card('playlist', '3'), card('playlist', '4', { isMix: true })];
        const tiles = buildExploreTiles([section('a', [...entries, songEntry('s1')])], t);

        // A card without a second line of its own carries on the page the word for what it is.
        entries.forEach((entry, index) => {
            const face = faceOf(entry, t);
            expect(tiles[index].label).toBe(face.subtitle);
            expect(tiles[index]).toMatchObject({ kind: 'collection', title: face.title, artist: face.subtitle, coverUrl: face.coverUrl });
        });
        expect(tiles.map(tile => tile.label)).toEqual([
            'home.exploreArtist', 'home.exploreAlbum', 'home.explorePlaylist', 'home.exploreMix', 'home.exploreSong',
        ]);
        expect(tiles[4]).toMatchObject({ kind: 'song', title: 'Song s1', artist: 'Artist', coverUrl: 'cover-of-s1' });
        // What the entry is, by which the wall orders a section's tiles and marks a cover.
        expect(tiles.map(tile => tile.entryKind)).toEqual(['artist', 'album', 'playlist', 'mix', 'song']);
    });

    it('says of each tile which section it stands in, by the section id', () => {
        const tiles = buildExploreTiles([
            section('a', [card('album', '1'), songEntry('s1')], 'Same heading'),
            section('b', [songEntry('s1'), songEntry('s2')], 'Same heading'),
        ], t);

        expect(tiles.map(tile => tile.sectionKey)).toEqual(['a', 'a', 'b']);
    });

    it('fills a seat with the entry own cover, not with its wide picture', () => {
        const [tile] = buildExploreTiles([section('a', [card('playlist', '1', { wideCoverUrl: 'wide-of-1' })])], t);

        expect(tile.coverUrl).toBe('cover-of-1');
    });

    it('keeps a song of the app\'s own sections in each of them, and in the page\'s sections too', () => {
        const own = new Set(['recent', 'again']);
        const tiles = buildExploreTiles([
            section('recent', [songEntry('s1'), songEntry('s2')]),
            section('again', [songEntry('s2'), songEntry('s3')]),
            section('a', [songEntry('s1'), card('album', '1'), songEntry('s4')]),
            section('b', [songEntry('s4')]),
        ], t, own);
        const queueOf = (id: string) => {
            const tile = tiles.find(candidate => candidate.id === id);
            return tile?.kind === 'song' ? tile.queue?.map(entry => entry.id) : undefined;
        };

        // Each own section a list of its own, as on the explore page; among the page's sections an entry stands once still.
        expect(tiles.map(tile => tile.id)).toEqual([
            'recent:online:ytm:s1',
            'recent:online:ytm:s2',
            'again:online:ytm:s2',
            'again:online:ytm:s3',
            'online:ytm:s1',
            'collection:album:1',
            'online:ytm:s4',
        ]);
        expect(tiles.map(tile => tile.queueIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(sectionsOfTiles(tiles).map(entry => entry.key)).toEqual(['recent', 'again', 'a']);
        // A song plays with the songs of the section it stands in.
        expect(queueOf('again:online:ytm:s2')).toEqual(['s2', 's3']);
        expect(queueOf('online:ytm:s1')).toEqual(['s1', 's4']);
        // Only the page's tile of a song is taken for the song on the player.
        expect(markPlayingTile(tiles, song('s1')).filter(tile => tile.section === 'now').map(tile => tile.id)).toEqual(['online:ytm:s1']);
        expect(markPlayingTile(tiles, song('s2'))).toBe(tiles);
        // What the wall counts for its further reads: the page's entries alone.
        expect(pageEntryCountOf(tiles, own)).toBe(3);
        expect(pageEntryCountOf(tilesOf(12), own)).toBe(12);
    });

    it('has no tile for a page without entries', () => {
        expect(buildExploreTiles([], t)).toEqual([]);
        expect(buildExploreTiles([section('a', [])], t)).toEqual([]);
        expect(hasExploreWallEntries(null)).toBe(false);
        expect(hasExploreWallEntries({ sections: [section('a', [])] })).toBe(false);
        expect(hasExploreWallEntries({ sections: [section('a', []), section('b', [card('album', '1')])] })).toBe(true);
    });
});

describe('sectionsOfTiles', () => {
    it('hands out the sections in the page order, each with its entries by place and kind', () => {
        const tiles = buildExploreTiles([
            section('a', [card('album', '1'), songEntry('s1'), card('playlist', '2', { isMix: true })]),
            section('b', [card('artist', '3'), card('playlist', '4')], ''),
        ], t);

        expect(sectionsOfTiles(tiles)).toEqual([
            { key: 'a', heading: 'Heading a', entries: [{ index: 0, kind: 'album' }, { index: 1, kind: 'song' }, { index: 2, kind: 'mix' }] },
            { key: 'b', heading: '', entries: [{ index: 3, kind: 'artist' }, { index: 4, kind: 'playlist' }] },
        ]);
    });

    it('has no section for one whose entries all stand in earlier sections, or that has none', () => {
        const tiles = buildExploreTiles([
            section('a', [card('album', '1'), songEntry('s1')]),
            section('twice', [songEntry('s1'), card('album', '1')]),
            section('none', []),
            section('b', [songEntry('s1'), songEntry('s2')]),
        ], t);

        // The entry that is in two sections stands in the first.
        expect(sectionsOfTiles(tiles).map(entry => [entry.key, entry.entries.map(item => item.index)])).toEqual([['a', [0, 1]], ['b', [2]]]);
        expect(sectionsOfTiles([])).toEqual([]);
    });

    it('is the same whichever tile is the playing one', () => {
        const tiles = buildExploreTiles([section('a', [card('album', '1'), songEntry('s1')]), section('b', [songEntry('s2')])], t);

        expect(sectionsOfTiles(markPlayingTile(tiles, song('s2')))).toEqual(sectionsOfTiles(tiles));
    });

    it('sums a section up in the words of the kinds it holds, in the order the wall puts them', () => {
        const tiles = buildExploreTiles([
            section('a', [songEntry('s1'), card('artist', '1'), card('playlist', '2'), card('album', '3'), songEntry('s2')]),
            section('b', [songEntry('s3')]),
        ], t);
        const [first, second] = sectionsOfTiles(tiles);

        expect(summaryOfSection(first, t)).toBe('5 · home.exploreAlbum · home.explorePlaylist · home.exploreArtist · home.exploreSong');
        expect(summaryOfSection(second, t)).toBe('1 · home.exploreSong');
    });
});

describe('markPlayingTile', () => {
    const tiles = buildExploreTiles([section('a', [card('album', '1'), songEntry('s1'), songEntry('s2')])], t);

    it('marks the tile of the song on the player', () => {
        const marked = markPlayingTile(tiles, song('s2'));

        expect(marked.map(tile => tile.section)).toEqual(['upcoming', 'upcoming', 'now']);
        // The others are the tiles they were: a song change renders one poster, not the wall.
        expect(marked[0]).toBe(tiles[0]);
        expect(marked[1]).toBe(tiles[1]);
    });

    it('marks none when the song on the player is not on the wall', () => {
        expect(markPlayingTile(tiles, song('elsewhere'))).toBe(tiles);
        expect(markPlayingTile(tiles, null)).toBe(tiles);
        // A collection of the playing song's id is not that song.
        expect(markPlayingTile(tiles, song('1')).some(tile => tile.section === 'now')).toBe(false);
    });
});

type Page = NonNullable<Parameters<typeof furtherReadsOf>[0]>;
// A page that is read, with a further page to ask for.
const page = (extra: Partial<Page> = {}): Page => ({
    status: 'ready', refreshing: false, loadingMore: false, moreFailed: false, nextCursor: 'next', ...extra,
});
const SHORT = ENOUGH_ENTRIES - 1;
const tilesOf = (count: number) => buildExploreTiles([section('a', Array.from({ length: count }, (_, index) => songEntry(`s${index}`)))], t);

describe('furtherReadsOf', () => {
    it('asks for the further sections of a page that is short of entries', () => {
        expect(furtherReadsOf(page(), SHORT, 0)).toBe('ask');
        expect(furtherReadsOf(page(), 0, MAX_FURTHER_READS - 1)).toBe('ask');
    });

    it('waits for a read that changes the list', () => {
        expect(furtherReadsOf(page({ loadingMore: true }), SHORT, 1)).toBe('wait');
        // The listener's refresh: no further page is asked for under it.
        expect(furtherReadsOf(page({ refreshing: true }), SHORT, 0)).toBe('wait');
    });

    it('is over with enough entries, no further page, the limit reached or a page that could not be read', () => {
        expect(furtherReadsOf(page(), ENOUGH_ENTRIES, 0)).toBe('over');
        expect(furtherReadsOf(page({ nextCursor: undefined }), SHORT, 0)).toBe('over');
        expect(furtherReadsOf(page(), SHORT, MAX_FURTHER_READS)).toBe('over');
        expect(furtherReadsOf(page({ moreFailed: true }), SHORT, 1)).toBe('over');
    });

    it('asks nothing while there is no page that is read', () => {
        expect(furtherReadsOf(null, 0, 0)).toBe('over');
        expect(furtherReadsOf(page({ status: 'loading' }), 0, 0)).toBe('over');
        expect(furtherReadsOf(page({ status: 'error' }), 0, 0)).toBe('over');
    });
});

describe('furtherReadsAsked', () => {
    it('counts for a read of the page, not for an opening of the wall', () => {
        // The record the hook keeps outside the wall: it stands while the wall is taken down and mounted anew.
        let counted: FurtherReadCount | null = null;
        expect(furtherReadsAsked(counted, 7)).toBe(0);

        // A wall asks twice and is taken down for a collection's page; the one Back mounts goes on from that count.
        counted = withOneMoreRead(withOneMoreRead(counted, 7), 7);
        expect(counted).toEqual({ read: 7, count: 2 });
        expect(furtherReadsOf(page(), SHORT, furtherReadsAsked(counted, 7))).toBe('ask');
        counted = withOneMoreRead(withOneMoreRead(counted, 7), 7);
        expect(furtherReadsOf(page(), SHORT, furtherReadsAsked(counted, 7))).toBe('over');

        // Another read of the page (a refresh) is asked from none again.
        expect(furtherReadsAsked(counted, 8)).toBe(0);
        expect(furtherReadsOf(page(), SHORT, furtherReadsAsked(counted, 8))).toBe('ask');
        expect(withOneMoreRead(counted, 8)).toEqual({ read: 8, count: 1 });
        expect(furtherReadsAsked(counted, null)).toBe(0);
    });
});

describe('handedEntriesOf', () => {
    it('hands the further sections over as one change, when the last of them is read', () => {
        const [first, second, whole] = [tilesOf(48), tilesOf(72), tilesOf(ENOUGH_ENTRIES)];
        const opened: HandedEntries = { read: 1, entries: first };
        // In turn: the wall asks, waits, has an answer and asks again, waits, and has enough.
        const steps: Array<[LatticeTile[], FurtherReads]> = [[first, 'ask'], [first, 'wait'], [second, 'ask'], [second, 'wait'], [whole, 'over']];
        const handed: HandedEntries[] = [];
        for (const [entries, further] of steps) handed.push(handedEntriesOf(handed[handed.length - 1] ?? opened, 1, entries, further));

        expect(handed.map(step => step.entries.length)).toEqual([48, 48, 48, 48, ENOUGH_ENTRIES]);
        // Held, it is the very list it had: the wall has nothing to render for.
        expect(handed[3]).toBe(opened);
        expect(handed[4].entries).toBe(whole);
    });

    it('does not hold back the answer to a refresh', () => {
        const held: HandedEntries = { read: 1, entries: tilesOf(48) };
        const others = tilesOf(40);

        // While the refresh is read the wall keeps what it has, with the entries held back still held back ...
        expect(handedEntriesOf(held, 1, tilesOf(72), 'wait')).toBe(held);
        // ... and its answer is another read of the page: handed over, though the wall asks that page for more.
        const answered = handedEntriesOf(held, 2, others, 'ask');
        expect(answered).toEqual({ read: 2, entries: others });
        // What it asks for then is held back in its turn.
        expect(handedEntriesOf(answered, 2, tilesOf(64), 'wait')).toBe(answered);
    });

    it('hands any list to a wall that has none', () => {
        const first = tilesOf(12);

        // The page arrives under a wall that was up while it was read.
        expect(handedEntriesOf({ read: 3, entries: [] }, 3, first, 'ask')).toEqual({ read: 3, entries: first });
        expect(handedEntriesOf({ read: null, entries: [] }, 3, first, 'wait')).toEqual({ read: 3, entries: first });
    });

    it('hands back what it handed while nothing changes, and no entries once the page is gone', () => {
        const handed: HandedEntries = { read: 1, entries: tilesOf(ENOUGH_ENTRIES) };

        expect(handedEntriesOf(handed, 1, handed.entries, 'over')).toBe(handed);
        expect(handedEntriesOf(handed, null, [], 'over')).toEqual({ read: null, entries: [] });
    });
});
