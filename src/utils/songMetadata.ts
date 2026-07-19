import type { SongResult } from '../types';
import type { ProviderSongMetadata } from '../types/onlineMusic';

// src/utils/songMetadata.ts

export const getSongAlbumCoverUrl = (song?: Pick<SongResult, 'album'> | null): string | undefined => {
    const coverUrl = song?.album?.coverUrl;
    return typeof coverUrl === 'string' && coverUrl ? coverUrl : undefined;
};

// Builds provider-neutral song metadata after a provider has normalized its response.
export const createProviderSongMetadata = (song: SongResult): ProviderSongMetadata => {
    const coverUrl = getSongAlbumCoverUrl(song);

    return {
        artists: Array.isArray(song.artists) ? song.artists : [],
        album: song.album
            ? {
                id: song.album.id,
                name: song.album.name,
                ...(coverUrl ? { coverUrl } : {}),
                ...(song.album.entityId ? { entityId: song.album.entityId } : {}),
                ...(song.album.catalogRef ? { catalogRef: song.album.catalogRef } : {}),
            }
            : { id: 0, name: '' },
        durationMs: Number.isFinite(song.durationMs) ? song.durationMs : 0,
        coverUrl,
        aliases: Array.isArray(song.aliases) ? song.aliases : [],
        translatedNames: Array.isArray(song.translatedNames) ? song.translatedNames : [],
    };
};
