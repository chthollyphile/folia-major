import type { AmllDbPlatform, LyricProviderSource, SongResult } from '../../types';
import { getLyricProviderLabel } from './lyricSourceLabels';

// src/utils/lyrics/matchResult.ts
// Normalizes provider-specific song search results for lyric and metadata matching flows.

export type LyricMatchSource = LyricProviderSource;

export const getLyricMatchSourceLabel = (
    source: LyricMatchSource,
    platform?: AmllDbPlatform | null,
): string => getLyricProviderLabel(source, platform);

export const getMatchResultArtists = (result: SongResult | null | undefined): string => {
    if (!result) return '';
    const neteaseArtists = result.ar?.map(artist => artist.name).filter(Boolean).join(', ');
    const unifiedArtists = result.artists?.map(artist => artist.name).filter(Boolean).join(', ');
    return neteaseArtists || unifiedArtists || '';
};

export const getMatchResultArtistEntities = (result: SongResult | null | undefined) => (
    result?.ar || result?.artists || []
);

export const getMatchResultAlbumName = (result: SongResult | null | undefined): string => (
    result?.al?.name || result?.album?.name || ''
);

export const getMatchResultAlbumId = (result: SongResult | null | undefined): number | string | undefined => (
    result?.al?.id ?? result?.album?.id
);

export const getMatchResultCoverUrl = (
    result: SongResult | null | undefined,
    source: LyricMatchSource,
): string | null => {
    if (!result || source === 'kugou') return null;
    const coverUrl = result.al?.picUrl || result.album?.picUrl;
    return coverUrl ? coverUrl.replace('http:', 'https:') : null;
};

export const sourceSupportsCover = (source: LyricMatchSource, result?: SongResult | null): boolean =>
    Boolean(getMatchResultCoverUrl(result, source));
