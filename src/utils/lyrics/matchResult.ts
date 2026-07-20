import type { AmllDbPlatform, LyricProviderSource, SongResult } from '../../types';
import { getLyricProviderLabel } from './lyricSourceLabels';
import { getProviderSongMetadata } from '../../services/onlineMusic/songMetadata';

// src/utils/lyrics/matchResult.ts
// Normalizes provider-specific song search results for lyric and metadata matching flows.

export type LyricMatchSource = LyricProviderSource;

export const getLyricMatchSourceLabel = (
    source: LyricMatchSource,
    platform?: AmllDbPlatform | null,
): string => getLyricProviderLabel(source, platform);

export const getMatchResultArtists = (result: SongResult | null | undefined): string => {
    return result ? getProviderSongMetadata(result).artists.map(artist => artist.name).filter(Boolean).join(', ') : '';
};

export const getMatchResultArtistEntities = (result: SongResult | null | undefined) => (
    result ? getProviderSongMetadata(result).artists : []
);

export const getMatchResultAlbumName = (result: SongResult | null | undefined): string => (
    result ? getProviderSongMetadata(result).album?.name || '' : ''
);

export const getMatchResultAlbumId = (result: SongResult | null | undefined): number | string | undefined => (
    result ? getProviderSongMetadata(result).album?.id : undefined
);

export const getMatchResultCoverUrl = (
    result: SongResult | null | undefined,
    source: LyricMatchSource,
): string | null => {
    if (!result) return null;
    const coverUrl = getProviderSongMetadata(result, source === 'amll' ? undefined : source).coverUrl;
    return coverUrl ? coverUrl.replace('http:', 'https:') : null;
};

export const sourceSupportsCover = (source: LyricMatchSource, result?: SongResult | null): boolean =>
    Boolean(getMatchResultCoverUrl(result, source));
