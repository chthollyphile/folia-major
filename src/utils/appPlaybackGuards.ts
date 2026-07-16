import type { SongResult } from '../types';
import type { LocalSongReference } from '../types/localLibrary';
import type { NavidromeSong } from '../types/navidrome';

// Runtime guards for the unified playback song model.
export type PlaybackSongSource = 'netease' | 'local' | 'navidrome' | 'stage';

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
): song is SongResult & { isLocal: true; localRef: LocalSongReference } => {
    return Boolean(
        song &&
        !isNavidromePlaybackSong(song) &&
        (((song as any).isLocal === true) || Boolean((song as any).localRef?.songId))
    );
};

export const isStagePlaybackSong = (song: SongResult | null | undefined): boolean => {
    return Boolean(song && (song as any).isStage === true);
};

export const getPlaybackSongSource = (song: SongResult): PlaybackSongSource => {
    if (isStagePlaybackSong(song)) return 'stage';
    if (isLocalPlaybackSong(song)) return 'local';
    if (isNavidromePlaybackSong(song)) return 'navidrome';
    return 'netease';
};

// Builds a collision-safe identity for queue operations across all playback sources.
export const getPlaybackSongKey = (song: SongResult): string => {
    if (isLocalPlaybackSong(song)) {
        return `local:${song.localRef.songId}`;
    }
    if (isNavidromePlaybackSong(song)) {
        const carrier = resolveNavidromePlaybackCarrier(song);
        return `navidrome:${carrier?.navidromeData.id || String(song.id)}`;
    }
    const source = getPlaybackSongSource(song);
    return `${source}:${String(song.id)}`;
};

export const isSamePlaybackSong = (
    first: SongResult | null | undefined,
    second: SongResult | null | undefined,
): boolean => Boolean(first && second && getPlaybackSongKey(first) === getPlaybackSongKey(second));

export const replacePlaybackSongInQueue = (
    queue: SongResult[],
    replacement: SongResult,
): SongResult[] => {
    const replacementKey = getPlaybackSongKey(replacement);
    let replaced = false;
    const nextQueue = queue.map(song => {
        if (getPlaybackSongKey(song) !== replacementKey) return song;
        replaced = true;
        return replacement;
    });
    return replaced ? nextQueue : [replacement, ...nextQueue];
};

export const hasMixedPlaybackSources = (queue: SongResult[]): boolean => (
    new Set(queue.map(getPlaybackSongSource)).size > 1
);
