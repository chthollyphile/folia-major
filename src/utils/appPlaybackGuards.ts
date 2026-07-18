import type { SongResult } from '../types';
import type { LocalSongReference } from '../types/localLibrary';
import type { NavidromeSong } from '../types/navidrome';
import type { OnlineProviderId, PlaybackSourceRef } from '../types/onlineMusic';

// Runtime guards for the unified playback song model.
export type PlaybackSongSource = OnlineProviderId | 'local' | 'navidrome' | 'stage';

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
    return Boolean(song && (song.sourceRef?.kind === 'stage' || (song as any).isStage === true));
};

export const getPlaybackSourceRef = (song: SongResult): PlaybackSourceRef => {
    if (song.sourceRef) return song.sourceRef;
    if (isStagePlaybackSong(song)) return { kind: 'stage', mediaId: String(song.id) };
    if (isLocalPlaybackSong(song)) return { kind: 'local', mediaId: song.localRef.songId };
    if (isNavidromePlaybackSong(song)) {
        const carrier = resolveNavidromePlaybackCarrier(song);
        return { kind: 'navidrome', mediaId: String(carrier?.navidromeData.id || song.id) };
    }
    return {
        kind: 'online',
        providerId: song.sourceType === 'cloud' ? 'netease' : 'netease',
        mediaId: String(song.id),
        ...(song.sourceType === 'cloud' || song.t === 1 || song.t === 2 ? { variant: 'cloud' } : {}),
    };
};

// Upgrades legacy persisted songs before they enter source-aware playback paths.
export const normalizePlaybackSongSource = <T extends SongResult>(song: T): T & { sourceRef: PlaybackSourceRef } => (
    song.sourceRef ? song as T & { sourceRef: PlaybackSourceRef } : { ...song, sourceRef: getPlaybackSourceRef(song) }
);

export const getOnlineProviderIdForSong = (
    song: SongResult | null | undefined,
): OnlineProviderId | null => {
    if (!song) return null;
    const sourceRef = getPlaybackSourceRef(song);
    return sourceRef.kind === 'online' ? sourceRef.providerId : null;
};

export const isOnlinePlaybackSong = (song: SongResult | null | undefined): boolean => (
    Boolean(song && getPlaybackSourceRef(song).kind === 'online')
);

export const getPlaybackSongSource = (song: SongResult): PlaybackSongSource => {
    const sourceRef = getPlaybackSourceRef(song);
    return sourceRef.kind === 'online' ? sourceRef.providerId : sourceRef.kind;
};

// Builds a collision-safe identity for queue operations across all playback sources.
export const getPlaybackSongKey = (song: SongResult): string => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind === 'online') {
        return `online:${sourceRef.providerId}:${sourceRef.mediaId}`;
    }
    return `${sourceRef.kind}:${sourceRef.mediaId}`;
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
