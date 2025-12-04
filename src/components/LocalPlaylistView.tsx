import React, { useEffect, useState, useRef } from 'react';
import { Play, ChevronLeft, Disc, Loader2, Folder, RefreshCw, Trash2, Pencil } from 'lucide-react';
import { LocalSong, SongResult } from '../types';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { formatSongName } from '../utils/songNameFormatter';
import DeleteFolderConfirmModal from './DeleteFolderConfirmModal';
import LyricMatchModal from './LyricMatchModal';

interface LocalPlaylistViewProps {
    title: string;
    coverUrl?: string;
    songs: LocalSong[];
    onBack: () => void;
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    isFolderView?: boolean;
    onResync?: () => void;
    onDelete?: () => void;
    onMatchSong?: (song: LocalSong) => void;
    onRefresh?: () => void;
}

const LocalPlaylistView: React.FC<LocalPlaylistViewProps> = ({ title, coverUrl, songs, onBack, onPlaySong, isFolderView = false, onResync, onDelete, onMatchSong, onRefresh }) => {
    const { t } = useTranslation();

    // Scroll Ref
    const containerRef = useRef<HTMLDivElement>(null);

    // State for delete confirmation modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isResyncing, setIsResyncing] = useState(false);
    const [matchingSong, setMatchingSong] = useState<LocalSong | null>(null);

    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-3xl font-sans"
            style={{ color: 'var(--text-primary)' }}
        >
            {/* Main Container - Scrollable on Mobile, Flex on Desktop */}
            <div
                ref={containerRef}
                className="w-full h-full md:max-w-6xl md:h-[90vh] md:bg-black/20 md:rounded-3xl overflow-y-auto md:overflow-hidden flex flex-col md:flex-row relative custom-scrollbar"
            >

                {/* Close Button */}
                <button
                    onClick={onBack}
                    className="fixed md:absolute top-6 left-6 z-30 w-10 h-10 rounded-full bg-black/20 hover:bg-white/10 flex items-center justify-center transition-colors backdrop-blur-md"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={20} />
                </button>

                {/* Left Panel: Cover & Meta (Static Layout) */}
                <div
                    className="w-full md:w-[400px] p-8 md:p-12 flex flex-col items-center md:items-start relative shrink-0 md:h-full md:overflow-y-auto custom-scrollbar"
                >
                    {/* Album Art */}
                    <div
                        className="w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800 flex items-center justify-center"
                    >
                        {coverUrl ? (
                            <img src={coverUrl} alt={title} className="w-full h-full object-cover" />
                        ) : (
                            <Folder size={64} className="opacity-20" />
                        )}
                    </div>

                    <div className="text-center md:text-left space-y-2 w-full mb-6">
                        <h1 className="text-2xl md:text-3xl font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>{title}</h1>
                        <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>{songs.length} {t('playlist.tracks')}</div>
                    </div>

                    <div className="w-full space-y-3">
                        <button
                            onClick={() => {
                                if (songs.length > 0) onPlaySong(songs[0], songs);
                            }}
                            className="w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200"
                            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                        >
                            <Play size={18} fill="currentColor" />
                            {t('playlist.playAll')}
                        </button>

                        {/* Folder Management Buttons */}
                        {isFolderView && (
                            <div className="flex gap-2">
                                {/* Sync Button */}
                                {onResync && (
                                    <button
                                        onClick={async () => {
                                            setIsResyncing(true);
                                            try {
                                                await onResync();
                                            } finally {
                                                setIsResyncing(false);
                                            }
                                        }}
                                        disabled={isResyncing}
                                        className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ color: 'var(--text-primary)' }}
                                        title="Re-import folder to refresh"
                                    >
                                        <RefreshCw size={16} className={isResyncing ? 'animate-spin' : ''} />
                                        {t('localMusic.reimport')}
                                    </button>
                                )}

                                {/* Delete Button */}
                                {onDelete && (
                                    <button
                                        onClick={() => setShowDeleteModal(true)}
                                        className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500"
                                        title="Remove folder from library"
                                    >
                                        <Trash2 size={16} />
                                        {t('localMusic.delete')}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Tracks */}
                <div
                    className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar"
                >
                    <div className="p-4 md:p-8 pb-32 md:pb-8">
                        {/* Desktop Sticky Header */}
                        <div className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            <div className="w-10 text-center">#</div>
                            <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                            <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                        </div>

                        {songs.map((song, idx) => (
                            <div
                                key={song.id}
                                onClick={() => onPlaySong(song)}
                                className="group flex items-center py-3 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                            >
                                <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                                    {idx + 1}
                                </div>

                                <div className="flex-1 min-w-0 pl-3 md:pl-4">
                                    <div className="text-sm font-medium opacity-90 group-hover:opacity-100" style={{ color: 'var(--text-primary)' }}>
                                        {song.title || song.fileName}
                                    </div>
                                    <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                        {song.matchedArtists || song.artist || t('localMusic.unknownArtist')}
                                        {song.matchedAlbumName && (
                                            <>
                                                <span className="mx-1.5">•</span>
                                                {song.matchedAlbumName}
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                                    {formatDuration(song.duration)}
                                </div>

                                {onMatchSong && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setMatchingSong(song);
                                        }}
                                        className="p-2 ml-2 rounded-full hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                                        title="Match Metadata"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            {/* Delete Confirmation Modal */}
            {isFolderView && onDelete && (
                <DeleteFolderConfirmModal
                    isOpen={showDeleteModal}
                    folderName={title}
                    songCount={songs.length}
                    onConfirm={onDelete}
                    onCancel={() => setShowDeleteModal(false)}
                />
            )}

            {/* Lyric Match Modal */}
            {matchingSong && onMatchSong && (
                <LyricMatchModal
                    song={matchingSong}
                    onClose={() => setMatchingSong(null)}
                    onMatch={() => {
                        setMatchingSong(null);
                        if (onRefresh) onRefresh(); // Refresh list to show new metadata
                    }}
                />
            )}
        </motion.div>
    );
};

export default LocalPlaylistView;
