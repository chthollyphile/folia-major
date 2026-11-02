import type { SongResult } from '../../../types';
import type { OmniCollection } from '../../../types/onlineMusic';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { queueIndexOf } from '../../../utils/playbackNeighbors';

// What the wall draws: one tile per entry of its list. The list is the play queue (this file:
// queue order is the only source of truth), or, for a wall opened from the explore tab, the
// entries of the explore page (exploreWall.ts).

export type LatticeSection = 'played' | 'now' | 'upcoming';

/** What an entry of the explore page is. */
export type WallEntryKind = 'album' | 'playlist' | 'mix' | 'artist' | 'song';

type LatticeTileBase = {
    id: string;
    /** Zero-based position in the wall's list. A tile of the play queue shows it on its badge as a 1-based number. */
    queueIndex: number;
    title: string;
    /** The second line: a queue song's artists; an explore entry's second line as the explore page words it. */
    artist: string;
    coverUrl?: string;
    section: LatticeSection;
    /** Explore entries only: what the entry is (song, album, ...), shown where a queue tile shows its number. */
    label?: string;
    /** Explore entries only: the heading of the section the entry stands in. May be empty. */
    heading?: string;
    /** Explore entries only: the id of that section. The wall is laid out by section (exploreLayout.ts), and a heading does not tell two sections apart. */
    sectionKey?: string;
    /** Explore entries only: what the entry is. Orders the tiles of a section, and marks a cover that is not a song's. */
    entryKind?: WallEntryKind;
};

export type LatticeSongTile = LatticeTileBase & {
    kind: 'song';
    song: SongResult;
    /** Explore entries only: the songs played with this one, which are its section's. A queue tile plays within the queue there is. */
    queue?: SongResult[];
};

/** An explore entry that opens a page (album, playlist, artist, mix) instead of playing. */
export type LatticeCollectionTile = LatticeTileBase & {
    kind: 'collection';
    collection: OmniCollection;
};

export type LatticeTile = LatticeSongTile | LatticeCollectionTile;

/** Whether the tile's badge is its number in the queue rather than an explore entry's kind: the one "number only the playing song" (#930) hides. */
export const latticeBadgeIsIndex = (tile: LatticeTile): boolean => tile.label === undefined;

// Marks each entry relative to the playhead; the queue is already de-duplicated by the queue controller.
export const buildLatticeTiles = ({
    queue,
    currentSong,
}: {
    queue: SongResult[];
    currentSong: SongResult | null;
}): LatticeTile[] => {
    const currentIndex = queueIndexOf(queue, currentSong);

    return queue.map((song, index) => {
        let section: LatticeSection = 'upcoming';
        if (index === currentIndex) section = 'now';
        else if (currentIndex >= 0 && index < currentIndex) section = 'played';

        return {
            id: getPlaybackSongKey(song),
            kind: 'song',
            queueIndex: index,
            song,
            title: song.name,
            artist: getSongArtistLabel(song) || song.album?.name || 'Unknown artist',
            coverUrl: getSongCoverUrl(song) || song.album?.coverUrl,
            section,
        };
    });
};
