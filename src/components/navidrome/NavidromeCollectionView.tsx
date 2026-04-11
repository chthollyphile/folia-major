import React from 'react';
import { ChevronLeft, Disc, Play } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { NavidromeConfig, NavidromeSong, SubsonicSong } from '../../types/navidrome';
import { navidromeApi } from '../../services/navidromeService';
import { Theme } from '../../types';
import { createCoverPlaceholder } from '../../utils/coverPlaceholders';

interface NavidromeCollectionViewProps {
    title: string;
    subtitle?: string;
    coverUrl?: string;
    placeholderVariant?: 'artist' | 'playlist';
    songs: SubsonicSong[];
    config: NavidromeConfig;
    onBack: () => void;
    onPlaySong: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onSelectArtist?: (artistId: string) => void;
    onSelectAlbum?: (albumId: string) => void;
    theme: Theme;
    isDaylight: boolean;
}

const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
};

const NavidromeCollectionView: React.FC<NavidromeCollectionViewProps> = ({
    title,
    subtitle,
    coverUrl,
    placeholderVariant = 'playlist',
    songs,
    config,
    onBack,
    onPlaySong,
    onSelectArtist,
    onSelectAlbum,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20';
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const fallbackCoverUrl = React.useMemo(() => createCoverPlaceholder(title, placeholderVariant), [placeholderVariant, title]);

    const queue = songs.map(song => navidromeApi.toNavidromeSong(config, song));

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-50 flex items-center justify-center ${glassBg} font-sans`}
            style={{ color: 'var(--text-primary)' }}
        >
            <div className={`w-full h-full md:max-w-6xl md:h-[90vh] ${panelBg} md:rounded-3xl overflow-y-auto md:overflow-hidden flex flex-col md:flex-row relative custom-scrollbar`}>
                <button
                    onClick={onBack}
                    className={`fixed md:absolute top-6 left-6 z-30 w-10 h-10 rounded-full ${closeBtnBg} flex items-center justify-center transition-colors backdrop-blur-md`}
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={20} />
                </button>

                <div className="w-full md:w-[400px] p-8 md:p-12 flex flex-col items-center md:items-start relative shrink-0 md:h-full md:overflow-y-auto custom-scrollbar">
                    <div className="w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800 flex items-center justify-center">
                        <img src={coverUrl || fallbackCoverUrl} alt={title} className="w-full h-full object-cover" />
                        {!coverUrl && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Disc size={64} className="opacity-10 text-white" />
                            </div>
                        )}
                    </div>

                    <div className="text-center md:text-left space-y-2 w-full mb-6">
                        <h1 className="text-2xl md:text-3xl font-bold line-clamp-2">{title}</h1>
                        {subtitle && (
                            <div className="text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {subtitle}
                            </div>
                        )}
                        <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            {songs.length} {t('playlist.tracks')}
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            if (queue.length > 0) {
                                onPlaySong(queue[0], queue);
                            }
                        }}
                        disabled={queue.length === 0}
                        className="w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                    >
                        <Play size={18} fill="currentColor" />
                        {t('playlist.playAll')}
                    </button>
                </div>

                <div className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar">
                    <div className="p-4 md:p-8 pb-32 md:pb-8">
                        <div className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            <div className="w-10 text-center">#</div>
                            <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                            <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                        </div>

                        {songs.map((song, idx) => (
                            <div
                                key={song.id}
                                onClick={() => onPlaySong(queue[idx], queue)}
                                className="group flex items-center py-3 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                            >
                                <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                                    {song.track || idx + 1}
                                </div>
                                <div className="flex-1 min-w-0 pl-3 md:pl-4">
                                    <div className="text-sm font-medium opacity-90 group-hover:opacity-100">
                                        {song.title}
                                    </div>
                                    <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                        <span
                                            className={onSelectArtist ? 'cursor-pointer hover:underline hover:opacity-100 transition-opacity' : ''}
                                            onClick={(event) => {
                                                if (!onSelectArtist) {
                                                    return;
                                                }
                                                event.stopPropagation();
                                                onSelectArtist(song.artistId);
                                            }}
                                        >
                                            {song.artist}
                                        </span>
                                        {song.album && (
                                            <>
                                                <span className="mx-1.5">•</span>
                                                <span
                                                    className={onSelectAlbum ? 'cursor-pointer hover:underline hover:opacity-100 transition-opacity' : ''}
                                                    onClick={(event) => {
                                                        if (!onSelectAlbum) {
                                                            return;
                                                        }
                                                        event.stopPropagation();
                                                        onSelectAlbum(song.albumId);
                                                    }}
                                                >
                                                    {song.album}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                                    {formatDuration(song.duration)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default NavidromeCollectionView;
