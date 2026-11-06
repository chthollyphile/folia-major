import type { SongResult } from '../../../../types';
import type { DailySongPreview, OmniExploreSection, ProviderCollection } from '../../../../types/onlineMusic';
import type { AcceptedFmPlayback } from '../../../../stores/usePlaybackStore';
import type { LibraryCollectionIdentity } from '../../../../library/core/collection/collection.contract';
import { collectionKey } from '../../../../library/core/collection/collectionIdentity';
import { isSamePersonalFmSelection } from '../../../../services/onlineMusic/fmModes';
import { getOnlineProviderIdForSong, getPlaybackSongKey, isSamePlaybackSong, normalizePlaybackSongSource } from '../../../../utils/appPlaybackGuards';
import type { LatticeTile } from '../../lattice/latticeModel';
import { faceOf } from './exploreFace';

// Explore recommendation cards follow a song only while their own stream or collection owns playback.

export interface ExplorePreviewPlayback {
    song: SongResult | null;
    queue: SongResult[];
    acceptedFmPlayback: AcceptedFmPlayback | null;
    /** The collection still owning the queue, checked against the displayed song as well as its entries. */
    playingFrom: LibraryCollectionIdentity | null;
    /** Latest successful default daily read, already scoped to the active provider/account by Omni. */
    dailySongs?: DailySongPreview | null;
}

const ownsDisplayedSong = (collection: ProviderCollection, playback: ExplorePreviewPlayback): boolean => {
    const { song, queue, acceptedFmPlayback, playingFrom } = playback;
    if (!song || getOnlineProviderIdForSong(song) !== collection.providerId) return false;
    if (collection.personalFm) {
        return acceptedFmPlayback?.providerId === collection.providerId
            && acceptedFmPlayback.songKeys.has(getPlaybackSongKey(song))
            && (collection.personalFm.station
                ? acceptedFmPlayback.selection.station === collection.personalFm.station
                : !acceptedFmPlayback.selection.station && isSamePersonalFmSelection(collection.personalFm, acceptedFmPlayback.selection))
            && queue.some(entry => isSamePlaybackSong(entry, song));
    }
    return collection.type === 'daily_recommendations'
        && collectionKey(playingFrom) === collectionKey({ ...collection, source: 'online' });
};

const collectionWithSongPreview = (collection: ProviderCollection, playback: ExplorePreviewPlayback): ProviderCollection => {
    if (!collection.songPreview) return collection;
    const dailySongs = collection.type === 'daily_recommendations' && collection.songPreview.dailySongs === true
        && playback.dailySongs?.providerId === collection.providerId ? playback.dailySongs : null;
    const firstSong = dailySongs ? dailySongs.firstSong : collection.songPreview.firstSong;
    const song = ownsDisplayedSong(collection, playback) ? playback.song : null;
    const currentSong = song ? normalizePlaybackSongSource(song) : undefined;
    const followsStation = Boolean(song && collection.personalFm?.station);
    const sameSelection = !followsStation || isSamePersonalFmSelection(collection.personalFm!, playback.acceptedFmPlayback!.selection);
    return collection.songPreview.firstSong === firstSong && collection.songPreview.currentSong === currentSong && sameSelection
        ? collection
        : { ...collection, ...(song && collection.personalFm?.station ? { personalFm: playback.acceptedFmPlayback!.selection } : {}), songPreview: { ...collection.songPreview, firstSong, currentSong } };
};

/** Derives latest daily and accepted current-song previews without changing collection identity or playback actions. */
export const withExploreSongPreviews = (sections: OmniExploreSection[], playback: ExplorePreviewPlayback): OmniExploreSection[] => {
    let changed = false;
    const nextSections = sections.map(section => {
        let sectionChanged = false;
        const items = section.items.map(item => {
            if (item.kind !== 'collection') return item;
            const collection = collectionWithSongPreview(item.collection, playback);
            if (collection === item.collection) return item;
            sectionChanged = true;
            return { ...item, collection };
        });
        if (!sectionChanged) return section;
        changed = true;
        return { ...section, items };
    });
    return changed ? nextSections : sections;
};

/** Updates only a held wall's card metadata: loading further sections never holds back its current-song preview. */
export const withExploreTileSongPreviews = (tiles: LatticeTile[], playback: ExplorePreviewPlayback, t: (key: string) => string): LatticeTile[] => {
    let changed = false;
    const nextTiles = tiles.map(tile => {
        if (tile.kind !== 'collection') return tile;
        const collection = collectionWithSongPreview(tile.collection, playback);
        if (collection === tile.collection) return tile;
        const face = faceOf({ kind: 'collection', collection }, t);
        changed = true;
        return { ...tile, collection, title: face.title, artist: face.subtitle, coverUrl: face.coverUrl || face.pictureUrl || undefined };
    });
    return changed ? nextTiles : tiles;
};
