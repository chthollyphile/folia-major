import type { SongResult } from '../../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/services/onlineMusic/resourceKeys.ts

export type SongResourceKind = 'audio' | 'lyric' | 'cover' | 'theme';

export const getSongResourceCacheKey = (kind: SongResourceKind, song: SongResult): string => (
    `${kind}_${getPlaybackSongKey(song)}`
);

export const getLegacySongResourceCacheKeys = (kind: SongResourceKind, song: SongResult): string[] => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online' || sourceRef.providerId !== 'netease') return [];
    return [
        ...(sourceRef.variant === 'cloud' ? [`${kind}_cloud_${sourceRef.mediaId}`] : []),
        `${kind}_${sourceRef.mediaId}`,
    ];
};
