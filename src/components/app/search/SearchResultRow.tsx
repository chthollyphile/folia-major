import React from 'react';
import { Disc, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import { formatSongName } from '../../../utils/songNameFormatter';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { getSongTag, isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';

// src/components/app/search/SearchResultRow.tsx

type SearchResultRowProps = {
    track: UnifiedSong;
    index: number;
    style: React.CSSProperties;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
};

const formatDuration = (duration: number) => {
    const totalSeconds = Math.max(0, Math.round(duration / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const SearchResultRow: React.FC<SearchResultRowProps> = ({
    track,
    index,
    style,
    onPlayTrack,
    onAddTrackToQueue,
    onOpenArtist,
    onOpenAlbum,
}) => {
    const { t } = useTranslation();
    const isUnavailable = isSongUnavailable(track);
    const tag = getSongTag(track, { unavailable: t('status.songUnavailableTag'), video: t('status.songVideoTag') });
    const metadata = getProviderSongMetadata(track);
    const coverUrl = getSizedCoverUrl(metadata.coverUrl, 120);
    const artists = metadata.artists;
    const album = metadata.album;
    const canOpenAlbum = Boolean(album?.name && (
        track.isLocal ? album.entityId
            : track.isNavidrome ? track.navidromeData?.albumId
                : canResolveSongCatalogRef(track, 'album', album)
    ));

    return (
        <div style={style}>
            <div
                className={`search-row ${isUnavailable ? 'is-unavailable' : ''}`}
                style={{ '--search-row-order': index } as React.CSSProperties}
            >
                <span className="search-row-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <button
                    type="button"
                    disabled={isUnavailable}
                    onClick={() => onPlayTrack(track)}
                    className="search-row-cover disabled:cursor-not-allowed"
                    aria-label={t('search.playTrack')}
                >
                    {coverUrl ? (
                        <img src={coverUrl} alt="" loading="lazy" />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center opacity-30">
                            <Disc size={22} />
                        </span>
                    )}
                    {!isUnavailable && (
                        <span className="search-row-play">
                            <Play size={18} fill="currentColor" />
                        </span>
                    )}
                </button>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={isUnavailable}
                            onClick={() => onPlayTrack(track)}
                            className="truncate text-left text-[15px] font-bold disabled:cursor-not-allowed"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {formatSongName(track)}
                        </button>
                        {tag && (
                            <span className="shrink-0 border border-current/20 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider opacity-60">
                                {tag}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span className="min-w-0 truncate">
                            {artists.map((artist, artistIndex) => {
                                const canOpenArtist = Boolean(
                                    track.isLocal ? artist.entityId
                                        : track.isNavidrome ? track.navidromeData?.artistId
                                            : canResolveSongCatalogRef(track, 'artist', artist)
                                );
                                return (
                                    <React.Fragment key={`${artist.entityId || artist.id}-${artistIndex}`}>
                                        {artistIndex > 0 && ', '}
                                        <button
                                            type="button"
                                            disabled={!canOpenArtist}
                                            onClick={() => onOpenArtist(track, artist.name, artist.id, artist.entityId)}
                                            className="enabled:hover:underline disabled:cursor-default"
                                        >
                                            {artist.name}
                                        </button>
                                    </React.Fragment>
                                );
                            })}
                        </span>
                        {album?.name && (
                            <>
                                <span className="shrink-0 opacity-40" aria-hidden="true">/</span>
                                <button
                                    type="button"
                                    disabled={!canOpenAlbum}
                                    onClick={() => onOpenAlbum(track, album.name, album.id, album.entityId)}
                                    className="max-w-[45%] truncate text-left enabled:hover:underline disabled:cursor-default"
                                >
                                    {album.name}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <span className="hidden shrink-0 font-mono text-xs opacity-40 sm:block">
                    {formatDuration(metadata.durationMs)}
                </span>
                {!isUnavailable && (
                    <button
                        type="button"
                        onClick={() => onAddTrackToQueue(track)}
                        className="search-row-action"
                        title={t('navidrome.addToQueue')}
                    >
                        <Plus size={16} />
                    </button>
                )}
            </div>
        </div>
    );
};

export default React.memo(SearchResultRow);
