import type { LocalSong, SongResult } from '../types';
import type { NavidromeSong } from '../types/navidrome';

// Runtime guards for the unified playback song model.
export const isNavidromePlaybackSong = (song: SongResult | null | undefined): song is NavidromeSong => {
    return Boolean(song && (song as any).isNavidrome === true);
};

export const resolveNavidromePlaybackCarrier = (
    song: SongResult | NavidromeSong | null | undefined
): NavidromeSong | null => {
    if (!song) {
        return null;
    }

    const candidate = song as NavidromeSong & {
        navidromeData?: NavidromeSong['navidromeData'] | NavidromeSong;
    };

    if (candidate.navidromeData && (candidate.navidromeData as NavidromeSong).isNavidrome === true) {
        return candidate.navidromeData as NavidromeSong;
    }

    if (candidate.isNavidrome === true && candidate.navidromeData) {
        return candidate as NavidromeSong;
    }

    return null;
};

export const isLocalPlaybackSong = (
    song: SongResult | null | undefined
): song is SongResult & { isLocal: true; localData: LocalSong } => {
    return Boolean(
        song &&
        !isNavidromePlaybackSong(song) &&
        (((song as any).isLocal === true) || Boolean((song as any).localData))
    );
};

export const isStagePlaybackSong = (song: SongResult | null | undefined): boolean => {
    return Boolean(song && (song as any).isStage === true);
};
