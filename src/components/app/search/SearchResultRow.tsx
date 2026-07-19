import React from 'react';
import { Disc, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import { formatSongName } from '../../../utils/songNameFormatter';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { getSongUnavailableTagText, isSongMarkedUnavailable } from '../../../services/netease';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';

// src/components/app/search/SearchResultRow.tsx

type SearchResultRowProps = {
    track: UnifiedSong;
    style: React.CSSProperties;
    isDaylight: boolean;
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
    style,
    isDaylight,
    onPlayTrack,
    onAddTrackToQueue,
    onOpenArtist,
    onOpenAlbum,
}) => {
    const { t } = useTranslation();
    const isUnavailable = isSongMarkedUnavailable(track);
    const coverUrl = getSizedCoverUrl(track.al?.picUrl || track.album?.picUrl, 120);
    const artists = track.ar?.length ? track.ar : track.artists;
    const album = track.al || track.album;
    const canOpenAlbum = Boolean(album?.name && (
        track.isLocal ? album.entityId
            : track.isNavidrome ? track.navidromeData?.albumId
                : canResolveSongCatalogRef(track, 'album', album)
    ));

    return (
        <div style={style} className="px-2 py-1.5">
            <div
                className={`group flex h-full items-center gap-3 rounded-2xl border px-3 transition-colors ${
                    isDaylight
                        ? 'border-black/[0.05] bg-black/[0.035] hover:bg-black/[0.07]'
                        : 'border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08]'
                } ${isUnavailable ? 'opacity-55' : ''}`}
            >
                <button
                    type="button"
                    disabled={isUnavailable}
                    onClick={() => onPlayTrack(track)}
                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-500/15 disabled:cursor-not-allowed"
                    aria-label={t('search.playTrack')}
                >
                    {coverUrl ? (
                        <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center opacity-30">
                            <Disc size={22} />
                        </span>
                    )}
                    {!isUnavailable && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
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
                            className="truncate text-left text-sm font-semibold disabled:cursor-not-allowed"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {formatSongName(track)}
                        </button>
                        {isUnavailable && (
                            <span className="shrink-0 rounded-full border border-current/10 px-2 py-0.5 text-[10px] opacity-60">
                                {getSongUnavailableTagText(track, t('status.songUnavailableTag'))}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span className="min-w-0 truncate">
                            {artists.map((artist, index) => {
                                const canOpenArtist = Boolean(
                                    track.isLocal ? artist.entityId
                                        : track.isNavidrome ? track.navidromeData?.artistId
                                            : canResolveSongCatalogRef(track, 'artist', artist)
                                );
                                return (
                                    <React.Fragment key={`${artist.entityId || artist.id}-${index}`}>
                                        {index > 0 && ', '}
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
                                <span className="shrink-0 opacity-40">•</span>
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

                <span className="hidden shrink-0 font-mono text-xs opacity-35 sm:block">
                    {formatDuration(track.dt || track.duration)}
                </span>
                {!isUnavailable && (
                    <button
                        type="button"
                        onClick={() => onAddTrackToQueue(track)}
                        className="shrink-0 rounded-full p-2 opacity-60 transition-all hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
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
