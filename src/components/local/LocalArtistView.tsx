import React from 'react';
import { ChevronLeft, Play, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { LocalSong } from '../../types';

/**
 * @deprecated Legacy local artist list view. It will be removed with the legacy home;
 * new local artist detail work belongs in the GridView flow.
 */
interface LocalArtistViewProps {
    artistName: string;
    songs: LocalSong[];
    coverUrl?: string;
    onBack: () => void;
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddToQueue?: (song: LocalSong) => void;
    onSelectAlbum?: (albumName: string) => void;
    theme: unknown;
    isDaylight: boolean;
}

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

const LocalArtistView: React.FC<LocalArtistViewProps> = ({
    artistName,
    songs,
    coverUrl,
    onBack,
    onPlaySong,
    onAddToQueue,
    onSelectAlbum,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20';
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const itemHoverBg = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5';

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
                    <div className="w-48 h-48 md:w-64 md:h-64 rounded-full shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800 flex items-center justify-center">
                        {coverUrl ? (
                            <img src={coverUrl} alt={artistName} className="w-full h-full object-cover" />
                        ) : (
                            <User size={72} className="opacity-20" />
                        )}
                    </div>

                    <div className="text-center md:text-left space-y-2 w-full mb-6">
                        <h1 className="text-2xl md:text-3xl font-bold line-clamp-2">{artistName}</h1>
                        <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            {songs.length} {t('playlist.tracks')}
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            if (songs.length > 0) {
                                onPlaySong(songs[0], songs);
                            }
                        }}
                        className="w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200"
                        style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                    >
                        <Play size={18} fill="currentColor" />
                        {t('playlist.playAll')}
                    </button>
                </div>

                <div className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar">
                    <div className="p-4 md:p-8 pb-32 md:pb-8">
                        <div className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30">
                            <div className="w-10 text-center">#</div>
                            <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                            <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                        </div>

                        {songs.map((song, index) => (
                            <div
                                key={song.id}
                                onClick={() => onPlaySong(song, songs)}
                                className={`group flex items-center py-3 px-2 rounded-xl ${itemHoverBg} cursor-pointer transition-colors`}
                            >
                                <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100">
                                    {index + 1}
                                </div>
                                <div className="flex-1 min-w-0 pl-3 md:pl-4">
                                    <div className="text-sm font-medium opacity-90 group-hover:opacity-100">
                                        {song.title || song.fileName}
                                    </div>
                                    <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                        <span
                                            className={onSelectAlbum ? 'cursor-pointer hover:underline hover:opacity-100 transition-opacity' : ''}
                                            onClick={(event) => {
                                                if (!onSelectAlbum) {
                                                    return;
                                                }
                                                event.stopPropagation();
                                                const albumName = song.onlineMetadata?.album?.name || song.importedMetadata.albumName;
                                                if (albumName) {
                                                    onSelectAlbum(albumName);
                                                }
                                            }}
                                        >
                                            {song.onlineMetadata?.album?.name || song.importedMetadata.albumName || t('localMusic.unknownAlbum')}
                                        </span>
                                    </div>
                                </div>
                                <div className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                                    {formatDuration(song.duration)}
                                </div>
                                {onAddToQueue && (
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onAddToQueue(song);
                                        }}
                                        className="ml-2 px-2 py-1 text-xs rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10"
                                    >
                                        +
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default LocalArtistView;
