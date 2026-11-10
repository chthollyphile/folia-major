import { omni } from '../services/onlineMusic/omni';
import type { SongResult } from '../types';
import { isLocalPlaybackSong, isNavidromePlaybackSong, resolveNavidromePlaybackCarrier } from './appPlaybackGuards';

// src/utils/resolveSongLiked.ts
//
// One boolean over three unrelated backends. Local files answer from disk, Navidrome from its own
// starred set keyed by the carrier's id, and everything else from its provider's account (omni).
//
// Written down once because the player panel and the Electron remote bridge both need it and had
// grown identical copies inline - which is how the two surfaces would eventually disagree.

type SongLikedSources = {
    isLocalSongLiked: (song: SongResult) => boolean;
    starredNavidromeSongIds: Set<string>;
};

export const resolveSongLiked = (
    song: SongResult | null,
    { isLocalSongLiked, starredNavidromeSongIds }: SongLikedSources,
): boolean => {
    if (!song) {
        return false;
    }
    if (isLocalPlaybackSong(song)) {
        return isLocalSongLiked(song);
    }
    if (isNavidromePlaybackSong(song)) {
        const navidromeSong = resolveNavidromePlaybackCarrier(song);
        return navidromeSong ? starredNavidromeSongIds.has(navidromeSong.navidromeData.id) : false;
    }
    return omni.isSongLiked(song);
};
