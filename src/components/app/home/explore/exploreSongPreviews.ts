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
    const acceptedSelection = song && collection.personalFm?.station ? playback.acceptedFmPlayback?.selection : undefined;
    const sameSelection = !acceptedSelection || Boolean(collection.personalFm && isSamePersonalFmSelection(collection.personalFm, acceptedSelection));
    return collection.songPreview.firstSong === firstSong && collection.songPreview.currentSong === currentSong && sameSelection
        ? collection
        : { ...collection, ...(acceptedSelection ? { personalFm: acceptedSelection } : {}), songPreview: { ...collection.songPreview, firstSong, currentSong } };
};

/** Derives latest daily and accepted current-song previews without changing collection identity or playback actions. */
export const withExploreSongPreviews = (sections: OmniExploreSection[], playback: ExplorePreviewPlayback): OmniExploreSection[] => {
    const nextSections = sections.map(section => {
        const items = section.items.map(item => {
            if (item.kind !== 'collection') return item;
            const collection = collectionWithSongPreview(item.collection, playback);
            if (collection === item.collection) return item;
            return { ...item, collection };
        });
        return items.every((item, index) => item === section.items[index]) ? section : { ...section, items };
    });
    return nextSections.every((section, index) => section === sections[index]) ? sections : nextSections;
};

/** Updates only a held wall's card metadata: loading further sections never holds back its current-song preview. */
export const withExploreTileSongPreviews = (tiles: LatticeTile[], playback: ExplorePreviewPlayback, t: (key: string) => string): LatticeTile[] => {
    const nextTiles = tiles.map(tile => {
        if (tile.kind !== 'collection') return tile;
        const collection = collectionWithSongPreview(tile.collection, playback);
        if (collection === tile.collection) return tile;
        const face = faceOf({ kind: 'collection', collection }, t);
        return { ...tile, collection, title: face.title, artist: face.subtitle, coverUrl: face.coverUrl || face.pictureUrl || undefined };
    });
    return nextTiles.every((tile, index) => tile === tiles[index]) ? tiles : nextTiles;
};
