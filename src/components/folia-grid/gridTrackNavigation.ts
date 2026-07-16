import type { SongResult, UnifiedSong } from '../../types';
import { resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';

// Resolves clickable collection identities without confusing display-only metadata IDs with source IDs.

type GridTrackArtist = {
    id?: number | string;
    entityId?: string;
};

type GridTrackNavigationSong = SongResult & Pick<UnifiedSong, 'isNavidrome' | 'navidromeData'>;

export const resolveGridTrackArtistTargetId = (
    track: GridTrackNavigationSong | undefined,
    artist: GridTrackArtist,
): number | string | undefined => {
    if (track?.isNavidrome) {
        return resolveNavidromePlaybackCarrier(track)?.navidromeData.artistId;
    }

    return artist.entityId || artist.id;
};

export const resolveGridTrackAlbumTargetId = (
    track: GridTrackNavigationSong | undefined,
): number | string | undefined => {
    if (track?.isNavidrome) {
        return resolveNavidromePlaybackCarrier(track)?.navidromeData.albumId;
    }

    return track?.al?.entityId
        || track?.album?.entityId
        || track?.al?.id
        || track?.album?.id;
};
