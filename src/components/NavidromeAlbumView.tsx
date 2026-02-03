import React, { useEffect, useState, useRef } from 'react';
import { Play, ChevronLeft, Disc, Loader2, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { SubsonicAlbum, SubsonicSong, NavidromeSong, NavidromeConfig } from '../types/navidrome';
import { navidromeApi } from '../services/navidromeService';
import { Theme } from '../types';

interface NavidromeAlbumViewProps {
    album: SubsonicAlbum;
    config: NavidromeConfig;
    onBack: () => void;
    onPlaySong: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onMatchSong?: (song: NavidromeSong) => void;
    theme: Theme;
    isDaylight: boolean;
}

const NavidromeAlbumView: React.FC<NavidromeAlbumViewProps> = ({
    album,
    config,
    onBack,
    onPlaySong,
    onMatchSong,
    theme,
    isDaylight
}) => {
    const { t } = useTranslation();

    // State
    const [songs, setSongs] = useState<SubsonicSong[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);

    // Styles based on theme
    const glassBg = isDaylight
        ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl'
        : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight
        ? 'bg-white/40 shadow-xl border border-white/20'
        : 'bg-black/20';
    const closeBtnBg = isDaylight
        ? 'bg-black/5 hover:bg-black/10 text-black/60'
        : 'bg-black/20 hover:bg-white/10 text-white/60';

    // Fetch album details with songs
    useEffect(() => {
        const fetchAlbumDetails = async () => {
            setIsLoading(true);
            try {
                const albumDetails = await navidromeApi.getAlbum(config, album.id);
                if (albumDetails?.song) {
                    setSongs(albumDetails.song);
                }
            } catch (error) {
                console.error('[NavidromeAlbumView] Failed to fetch album:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAlbumDetails();
    }, [album.id, config]);

    // Format duration (seconds -> mm:ss)
    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    };

    // Get cover art URL
    const coverUrl = album.coverArt
        ? navidromeApi.getCoverArtUrl(config, album.coverArt, 600)
        : undefined;

    // Convert songs to NavidromeSong format for playback
    const convertToNavidromeSongs = (): NavidromeSong[] => {
        return songs.map(song => navidromeApi.toNavidromeSong(config, song, album));
    };

    // Handle play all
    const handlePlayAll = () => {
        const queue = convertToNavidromeSongs();
        if (queue.length > 0) {
            onPlaySong(queue[0], queue);
        }
    };

    // Handle single song play
    const handlePlaySong = (song: SubsonicSong) => {
        const navidromeSong = navidromeApi.toNavidromeSong(config, song, album);
        const queue = convertToNavidromeSongs();
        onPlaySong(navidromeSong, queue);
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

                {/* Left Panel: Cover & Meta */}
                <div className="w-full md:w-[400px] p-8 md:p-12 flex flex-col items-center md:items-start relative shrink-0 md:h-full md:overflow-y-auto custom-scrollbar">
                    {/* Album Art */}
                    <div className="w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800 flex items-center justify-center">
                        {coverUrl ? (
                            <img src={coverUrl} alt={album.name} className="w-full h-full object-cover" />
                        ) : (
                            <Disc size={64} className="opacity-20" />
                        )}
                    </div>

                    <div className="text-center md:text-left space-y-2 w-full mb-6">
                        <h1 className="text-2xl md:text-3xl font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                            {album.name}
                        </h1>
                        <div className="text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {album.artist}
                        </div>
                        <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            {album.songCount} {t('playlist.tracks')}
                            {album.year && ` • ${album.year}`}
                        </div>
                    </div>

                    <div className="w-full space-y-3">
                        <button
                            onClick={handlePlayAll}
                            disabled={isLoading || songs.length === 0}
                            className="w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                        >
                            {isLoading ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <Play size={18} fill="currentColor" />
                            )}
                            {t('playlist.playAll')}
                        </button>
                    </div>
                </div>

                {/* Right Panel: Tracks */}
                <div className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar">
                    <div className="p-4 md:p-8 pb-32 md:pb-8">
                        {/* Desktop Sticky Header */}
                        <div
                            className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            <div className="w-10 text-center">#</div>
                            <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                            <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                        </div>

                        {isLoading ? (
                            <div className="flex items-center justify-center py-12 opacity-50">
                                <Loader2 className="animate-spin" size={24} />
                                <span className="ml-2">{t('playlist.loading')}</span>
                            </div>
                        ) : songs.length === 0 ? (
                            <div className="text-center py-12 opacity-50">
                                {t('navidrome.noSongsFound') || 'No songs found'}
                            </div>
                        ) : (
                            songs.map((song, idx) => (
                                <div
                                    key={song.id}
                                    onClick={() => handlePlaySong(song)}
                                    className="group flex items-center py-3 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                                >
                                    <div
                                        className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {song.track || idx + 1}
                                    </div>

                                    <div className="flex-1 min-w-0 pl-3 md:pl-4">
                                        <div
                                            className="text-sm font-medium opacity-90 group-hover:opacity-100"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {song.title}
                                        </div>
                                        <div
                                            className="text-xs truncate opacity-40 group-hover:opacity-60"
                                            style={{ color: 'var(--text-secondary)' }}
                                        >
                                            {song.artist}
                                        </div>
                                    </div>

                                    <div
                                        className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {formatDuration(song.duration)}
                                    </div>

                                    {onMatchSong && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const navidromeSong = navidromeApi.toNavidromeSong(config, song, album);
                                                onMatchSong(navidromeSong);
                                            }}
                                            className="p-2 ml-2 rounded-full hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                                            title={t('localMusic.matchLyrics')}
                                            style={{ color: 'var(--text-secondary)' }}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default NavidromeAlbumView;
