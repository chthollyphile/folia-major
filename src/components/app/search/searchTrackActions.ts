import type { LocalSong, UnifiedSong } from '../../../types';
import type { NavidromeSong } from '../../../types/navidrome';
import { isSongMarkedUnavailable } from '../../../services/netease';
import { resolveNavidromePlaybackCarrier } from '../../../utils/appPlaybackGuards';

// src/components/app/search/searchTrackActions.ts

type SearchTrackSourceDeps = {
    localSongs: LocalSong[];
    onLocal: (song: LocalSong) => void;
    onNavidrome: (song: NavidromeSong) => void;
    onOnline: (song: UnifiedSong) => void;
};

// Routes a search-result action to the matching playback source without leaking source checks into the UI.
export const dispatchSearchTrackAction = (
    track: UnifiedSong,
    deps: SearchTrackSourceDeps,
): boolean => {
    if (isSongMarkedUnavailable(track)) {
        return false;
    }

    const localSongId = track.localRef?.songId;
    const localSong = localSongId
        ? deps.localSongs.find(song => song.id === localSongId)
        : undefined;
    if (track.isLocal && localSong) {
        deps.onLocal(localSong);
        return true;
    }

    if (track.isNavidrome) {
        const navidromeSong = resolveNavidromePlaybackCarrier(track);
        if (navidromeSong) {
            deps.onNavidrome(navidromeSong);
            return true;
        }
        return false;
    }

    deps.onOnline(track);
    return true;
};
