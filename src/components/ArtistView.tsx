import React, { useEffect, useState, useRef } from 'react';
import { Play, ChevronLeft, Disc, Loader2, User } from 'lucide-react';
import { SongResult } from '../types';
import { neteaseApi } from '../services/netease';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { formatSongName } from '../utils/songNameFormatter';

interface ArtistViewProps {
    artistId: number;
    onBack: () => void;
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[]) => void;
    onSelectAlbum: (id: number) => void;
}

const ArtistView: React.FC<ArtistViewProps> = ({ artistId, onBack, onPlaySong, onSelectAlbum }) => {
    const { t } = useTranslation();
    const [topSongs, setTopSongs] = useState<SongResult[]>([]);
    const [albums, setAlbums] = useState<any[]>([]);
    const [artistInfo, setArtistInfo] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Scroll Ref for top songs list
    const topSongsRef = useRef<HTMLDivElement>(null);

    const loadArtistData = async () => {
        setLoading(true);
        try {
            // Parallel fetch for better performance
            const [detailRes, topSongsRes, albumsRes] = await Promise.all([
                neteaseApi.getArtistDetail(artistId),
                neteaseApi.getArtistTopSongs(artistId),
                neteaseApi.getArtistAlbums(artistId, 50, 0)
            ]);

            if (detailRes && detailRes.data && detailRes.data.artist) {
                setArtistInfo(detailRes.data.artist);
            }

            if (topSongsRes && topSongsRes.songs) {
                // Take top 10
                setTopSongs(topSongsRes.songs.slice(0, 10));
            }

            if (albumsRes && albumsRes.hotAlbums) {
                setAlbums(albumsRes.hotAlbums);
            }

        } catch (error) {
            console.error("Failed to load artist data", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadArtistData();
    }, [artistId]);

    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
    };

    const formatDate = (timestamp: number) => {
        if (!timestamp) return '';
        return new Date(timestamp).toLocaleDateString();
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-3xl font-sans"
            style={{ color: 'var(--text-primary)' }}
        >
            {/* Main Container */}
            <div className="w-full h-full md:max-w-6xl md:h-[90vh] md:bg-black/20 md:rounded-3xl overflow-hidden flex flex-col relative">

                {/* Header (Back Button) */}
                <div className="absolute top-0 left-0 p-6 z-30">
                    <button
                        onClick={onBack}
                        className="w-10 h-10 rounded-full bg-black/20 hover:bg-white/10 flex items-center justify-center transition-colors backdrop-blur-md"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <ChevronLeft size={20} />
                    </button>
                </div>

                {loading && !artistInfo ? (
                    <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="animate-spin" size={40} />
                    </div>
                ) : (
                    <div className="w-full h-full flex flex-col overflow-y-auto custom-scrollbar">

                        {/* Top Section: Info & Popular Songs */}
                        <div className="flex flex-col md:flex-row w-full md:min-h-[70vh] flex-shrink-0 p-6 md:p-8 pb-0 gap-8 relative">
                            {/* Left: Artist Info */}
                            <div className="w-full md:w-1/3 flex flex-col items-start pt-12 md:pt-0">
                                <div className="w-48 h-48 md:w-64 md:h-64 rounded-full shadow-2xl overflow-hidden mb-6 relative bg-zinc-800 shrink-0 border-4 border-white/5">
                                    {artistInfo?.cover ? (
                                        <img src={artistInfo.cover} alt={artistInfo.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-white/5">
                                            <User size={40} className="opacity-20" />
                                        </div>
                                    )}
                                </div>

                                <h1 className="text-3xl font-bold mb-2 text-left">{artistInfo?.name}</h1>

                                <div className="text-sm opacity-50 mb-4 text-left">
                                    {artistInfo?.transNames?.[0] && <div className="font-medium mb-1">{artistInfo.transNames[0]}</div>}
                                    <div>{artistInfo?.musicSize} songs • {artistInfo?.albumSize} albums</div>
                                </div>

                                {artistInfo?.briefDesc && (
                                    <div className="text-xs opacity-60 leading-relaxed max-h-80 overflow-y-auto custom-scrollbar w-full text-left">
                                        {artistInfo.briefDesc}
                                    </div>
                                )}
                            </div>

                            {/* Right: Top 10 Songs (Expanded) */}
                            <div className="w-full md:w-2/3 flex flex-col">
                                <h2 className="text-xl font-bold mb-4 opacity-90">{t('home.popular')}</h2>
                                <div
                                    className="w-full"
                                    ref={topSongsRef}
                                >
                                    {topSongs.map((track, idx) => (
                                        <div
                                            key={track.id}
                                            onClick={() => onPlaySong(track, topSongs)}
                                            className="group flex items-center py-3 px-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                                        >
                                            <div className="w-8 text-center text-sm font-medium opacity-40 group-hover:opacity-100 shrink-0">
                                                {idx + 1}
                                            </div>

                                            <div className="w-10 h-10 rounded-md overflow-hidden mr-4 bg-white/5 shrink-0 ml-2">
                                                {track.al?.picUrl && <img src={track.al.picUrl} alt="" className="w-full h-full object-cover" />}
                                            </div>

                                            <div className="flex-1 min-w-0 mr-4">
                                                <div className="text-sm font-medium opacity-90 group-hover:opacity-100 truncate">
                                                    {formatSongName(track)}
                                                </div>
                                                <div className="text-xs opacity-40 truncate">
                                                    {track.al?.name}
                                                </div>
                                            </div>

                                            <div className="text-xs font-medium opacity-40 group-hover:opacity-80">
                                                {formatDuration(track.dt || track.duration)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Bottom Section: Albums Grid */}
                        <div className="w-full p-6 md:p-8 mt-4">
                            <h2 className="text-xl font-bold mb-6 opacity-90">{t('home.albums')}</h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                                {albums.map((album) => (
                                    <div
                                        key={album.id}
                                        onClick={() => onSelectAlbum(album.id)}
                                        className="group cursor-pointer flex flex-col"
                                    >
                                        <div className="w-full aspect-square rounded-xl overflow-hidden bg-white/5 shadow-lg relative mb-3">
                                            {album.picUrl ? (
                                                <img
                                                    src={album.picUrl}
                                                    alt={album.name}
                                                    className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:brightness-110"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Disc className="opacity-20" size={32} />
                                                </div>
                                            )}


                                        </div>

                                        <div className="text-sm font-bold truncate opacity-90 group-hover:opacity-100">
                                            {album.name}
                                        </div>
                                        <div className="text-xs opacity-50 truncate mt-1">
                                            {formatDate(album.publishTime)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Pagination / Load More could go here if implemented in future */}
                        <div className="h-20"></div> {/* Spacer */}
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default ArtistView;
