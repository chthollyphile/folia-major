import React, { useEffect, useState, useRef } from 'react';
import { Play, ChevronLeft, Disc, Loader2 } from 'lucide-react';
import { SongResult } from '../types';
import { neteaseApi } from '../services/netease';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { formatSongName } from '../utils/songNameFormatter';

interface AlbumViewProps {
    albumId: number;
    onBack: () => void;
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[]) => void;
    onPlayAll: (songs: SongResult[]) => void;
    onSelectArtist: (artistId: number) => void;
    theme: any;
}

const AlbumView: React.FC<AlbumViewProps> = ({ albumId, onBack, onPlaySong, onPlayAll, onSelectArtist, theme }) => {
    const isDaylight = theme?.name === 'Daylight Default';
    const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20'; // Desktop panel
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const placeholderBg = isDaylight ? 'bg-stone-200' : 'bg-zinc-800';
    const itemHoverBg = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5';

    const { t } = useTranslation();
    const [tracks, setTracks] = useState<SongResult[]>([]);
    const [albumInfo, setAlbumInfo] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Scroll Ref
    const containerRef = useRef<HTMLDivElement>(null);

    const loadAlbum = async () => {
        setLoading(true);
        try {
            const res = await neteaseApi.getAlbum(albumId);
            if (res.code === 200) {
                // Enrich songs with album cover URL if missing
                const enrichedSongs = res.songs.map((song: SongResult) => ({
                    ...song,
                    al: {
                        id: res.album.id,
                        name: res.album.name,
                        picUrl: song.al?.picUrl || res.album.picUrl
                    },
                    album: {
                        id: res.album.id,
                        name: res.album.name,
                        picUrl: song.album?.picUrl || res.album.picUrl
                    }
                }));
                setTracks(enrichedSongs);
                setAlbumInfo(res.album);
            }
        } catch (error) {
            console.error("Failed to load album", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAlbum();
    }, [albumId]);

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
            className={`fixed inset-0 z-50 flex items-center justify-center ${glassBg} font-sans`}
            style={{ color: 'var(--text-primary)' }}
        >
            {/* Main Container */}
            <div
                ref={containerRef}
                className={`w-full h-full md:max-w-6xl md:h-[90vh] ${panelBg} md:rounded-3xl overflow-y-auto md:overflow-hidden flex flex-col md:flex-row relative custom-scrollbar`}
            >

                {/* Close Button */}
                <button
                    onClick={onBack}
                    className={`fixed md:absolute top-6 left-6 z-30 w-10 h-10 rounded-full ${closeBtnBg} flex items-center justify-center transition-colors backdrop-blur-md`}
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={20} />
                </button>

                {loading && !albumInfo ? (
                    <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="animate-spin" size={40} />
                    </div>
                ) : (
                    <>
                        {/* Left Panel: Cover & Meta */}
                        <div
                            className="w-full md:w-[400px] p-8 md:p-12 flex flex-col items-center md:items-start relative shrink-0 md:h-full md:overflow-hidden"
                        >
                            {/* Album Art */}
                            <div
                                className={`w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 ${placeholderBg} shrink-0`}
                            >
                                {albumInfo?.picUrl ? (
                                    <img src={albumInfo.picUrl.replace('http:', 'https:')} alt={albumInfo.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-white/5">
                                        <Disc size={40} className="opacity-20" />
                                    </div>
                                )}
                            </div>

                            {/* Scrollable Text Content */}
                            <div className="w-full md:flex-1 md:overflow-y-auto custom-scrollbar md:min-h-0 md:pr-2">
                                <div className="text-center md:text-left space-y-2 w-full mb-6">
                                    <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{albumInfo?.name}</h1>
                                    <div className="flex flex-col md:items-start items-center gap-1 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {albumInfo?.alias?.[0] && (
                                            <div className="text-sm font-medium opacity-80">{albumInfo.alias[0]}</div>
                                        )}
                                        <div className="font-medium text-base">
                                            {albumInfo?.artist && (
                                                <span
                                                    className="cursor-pointer hover:underline"
                                                    onClick={() => onSelectArtist(albumInfo.artist.id)}
                                                >
                                                    {albumInfo.artist.name}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs">{formatDate(albumInfo?.publishTime)} • {albumInfo?.company}</div>
                                    </div>

                                    {albumInfo?.description && (
                                        <div className="mt-4 w-full max-h-40 overflow-y-auto custom-scrollbar text-xs opacity-60 leading-relaxed pr-2" style={{ color: 'var(--text-secondary)' }}>
                                            {albumInfo.description}
                                        </div>
                                    )}
                                </div>

                                <div className="w-full pb-2">
                                    <button
                                        onClick={() => onPlayAll(tracks)}
                                        className="w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200"
                                        style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                                    >
                                        <Play size={18} fill="currentColor" />
                                        {t('playlist.playAll')}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Right Panel: Tracks */}
                        <div className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar">
                            <div className="p-4 md:p-8 pb-32 md:pb-8">
                                {/* Desktop Sticky Header */}
                                <div className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30" style={{ color: 'var(--text-secondary)' }}>
                                    <div className="w-10 text-center">#</div>
                                    <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                                    <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                                </div>

                                {tracks.map((track, idx) => (
                                    <div
                                        key={track.id}
                                        onClick={() => onPlaySong(track, tracks)}
                                        className={`group flex items-center py-3 px-2 rounded-xl ${itemHoverBg} cursor-pointer transition-colors`}
                                    >
                                        <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                                            {idx + 1}
                                        </div>

                                        <div className="flex-1 min-w-0 pl-3 md:pl-4">
                                            <div className="text-sm font-medium opacity-90 group-hover:opacity-100" style={{ color: 'var(--text-primary)' }}>
                                                {formatSongName(track)}
                                            </div>
                                            <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                                {track.ar?.map((a, i) => (
                                                    <React.Fragment key={a.id}>
                                                        {i > 0 && ", "}
                                                        <span
                                                            className="cursor-pointer hover:underline hover:opacity-100 transition-opacity"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onSelectArtist(a.id);
                                                            }}
                                                        >
                                                            {a.name}
                                                        </span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                                            {formatDuration(track.dt || track.duration)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}

            </div>
        </motion.div>
    );
};

export default AlbumView;
