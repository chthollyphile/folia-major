import type { OmniCollection, OmniExploreItem } from '../../../../types/onlineMusic';
import { getProviderCollectionArtistLabel } from '../../../../library/core/home/homeCards';

// src/components/app/home/explore/exploreFace.ts
// How an entry of the explore tab reads: its title, its second line, its picture and that
// picture's shape. The tab's cards are drawn from it, and so are the wall's explore tiles
// (lattice/exploreWall.ts).

export interface Face {
    /** song, artist, album or playlist. */
    kind: string;
    title: string;
    /** The provider's own wording where it gives one. Else the artists' names; where an entry names none, what it is (artist, album, playlist). */
    subtitle: string;
    /** The picture shown: the entry's wide one where it has one, else its cover. */
    pictureUrl: string;
    /** The entry's own cover, which fills its frame to the edges: the one to blur into a glow. */
    coverUrl: string;
    shape: 'wide' | 'square' | 'round';
    /** A song's length; 0 for a card and for a song of unknown length. */
    durationMs: number;
    coverOverlay?: OmniCollection['coverOverlay'];
}

/** The collection's semantic label; radio and daily recommendations keep their own identity. */
export const exploreCollectionLabelKey = (item: Extract<OmniExploreItem, { kind: 'collection' }>): string => {
    const { collection } = item;
    if (collection.personalFm || collection.type === 'radio') return 'home.radio';
    if (collection.type === 'daily_recommendations') return 'home.dailyRecommendations';
    if (collection.type === 'artist') return 'home.exploreArtist';
    if (collection.type === 'album') return 'home.exploreAlbum';
    return item.isMix ? 'home.exploreMix' : 'home.explorePlaylist';
};

export const faceOf = (item: OmniExploreItem, t: (key: string) => string): Face => {
    if (item.kind === 'song') {
        const coverUrl = item.song.album.coverUrl ?? '';
        return {
            kind: 'song',
            title: item.song.name,
            subtitle: item.subtitle ?? item.song.artists.map(artist => artist.name).filter(Boolean).join(', '),
            pictureUrl: item.wideCoverUrl ?? coverUrl,
            coverUrl,
            shape: item.wideCoverUrl ? 'wide' : 'square',
            durationMs: item.song.durationMs || 0,
        };
    }
    const { collection } = item;
    const isArtist = collection.type === 'artist';
    const kindLabel = t(exploreCollectionLabelKey(item));
    const preview = collection.songPreview?.currentSong ?? collection.songPreview?.firstSong;
    const artists = preview?.artists.map(artist => artist.name).filter(Boolean).join(', ');
    const previewLabel = preview ? [preview.name, artists].filter(Boolean).join(' — ') : '';
    const coverUrl = preview?.album.coverUrl || collection.coverUrl || '';
    // An artist is always its own cover in a circle.
    const wideCoverUrl = isArtist || preview ? undefined : item.wideCoverUrl;
    return {
        kind: collection.type,
        title: collection.name,
        subtitle: previewLabel || (item.subtitle ?? ((isArtist ? '' : getProviderCollectionArtistLabel(collection)) || kindLabel)),
        pictureUrl: wideCoverUrl ?? coverUrl,
        coverUrl,
        shape: isArtist ? 'round' : wideCoverUrl ? 'wide' : 'square',
        durationMs: 0,
        ...(collection.coverOverlay ? { coverOverlay: collection.coverOverlay } : {}),
    };
};
