import type { AmllDbPlatform, LyricProviderSource, SongResult } from '../../types';
import { getLyricProviderLabel } from './lyricSourceLabels';
import { getPlatformLyricSource } from './lyricSources';
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
    // A platform source's result is read as that platform's song; any other carries its own platform.
    const coverUrl = getProviderSongMetadata(result, getPlatformLyricSource(source)?.id).coverUrl;
    return coverUrl ? coverUrl.replace('http:', 'https:') : null;
};

export const sourceSupportsCover = (source: LyricMatchSource, result?: SongResult | null): boolean =>
    Boolean(getMatchResultCoverUrl(result, source));

// AMLL 搜索结果是歌词库条目：artists 是同一歌手的多语言别名而不是合作歌手，也没有封面和真实专辑 ID，
// 只能用来写歌词，不能当作歌曲元数据写进本地库
export const sourceProvidesSongMetadata = (source: LyricMatchSource): boolean => source !== 'amll';
