import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Play, ChevronLeft, Disc, Loader2, Folder, RefreshCw, Trash2, Pencil, Image as ImageIcon, X, Check } from 'lucide-react';
import { LocalSong, SongResult } from '../types';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { formatSongName } from '../utils/songNameFormatter';
import DeleteFolderConfirmModal from './DeleteFolderConfirmModal';
import LyricMatchModal from './LyricMatchModal';

interface LocalPlaylistViewProps {
    title: string;
    coverUrl?: string;
    songs: LocalSong[];
    groupId?: string;
    onBack: () => void;
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    isFolderView?: boolean;
    onResync?: () => void;
    onDelete?: () => void;
    onMatchSong?: (song: LocalSong) => void;
    onRefresh?: () => void;
    theme: any;
    isDaylight: boolean;
    onUpdateCover?: () => void;
}

const LocalPlaylistView: React.FC<LocalPlaylistViewProps> = ({ title, coverUrl, songs, groupId, onBack, onPlaySong, isFolderView = false, onResync, onDelete, onMatchSong, onRefresh, theme, isDaylight, onUpdateCover }) => {
    // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
    const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20';
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';

    const { t } = useTranslation();

    // Scroll Ref
    const containerRef = useRef<HTMLDivElement>(null);

    // State for delete confirmation modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isResyncing, setIsResyncing] = useState(false);
    const [matchingSong, setMatchingSong] = useState<LocalSong | null>(null);
    const [showCoverSelection, setShowCoverSelection] = useState(false);

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

    // Filter songs that actully have a cover
    const songsWithCovers = useMemo(() => {
        return songs.filter(s => s.embeddedCover || s.matchedCoverUrl);
    }, [songs]);

    const handleCoverSelect = (songId: string) => {
        if (!groupId) return;

        // Extract the key part from groupId (e.g. "folder-Check" -> "Check")
        // But getGroupCover uses the raw name/key.
        // Let's decode how we constructed groupId in LocalMusicView.
        // For folders: `folder-${name}`
        // For albums: `album-${key}`

        let storeKey = '';
        if (groupId.startsWith('folder-')) {
            const name = groupId.substring(7);
            storeKey = `local_cover_pref_folder_${name}`;
        } else if (groupId.startsWith('album-')) {
            const key = groupId.substring(6);
            storeKey = `local_cover_pref_album_${key}`;
        } else {
            console.warn('Unknown groupId format', groupId);
            return;
        }

        localStorage.setItem(storeKey, songId);
        onUpdateCover?.();
        setShowCoverSelection(false);
    };

    // Helper to get Blob URL safely for list rendering
    const getSongCover = (song: LocalSong) => {
        if (song.embeddedCover) return URL.createObjectURL(song.embeddedCover);
        return song.matchedCoverUrl;
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-50 flex items-center justify-center ${glassBg} font-sans`}
            style={{ color: 'var(--text-primary)' }}
        >
            {/* Main Container - Scrollable on Mobile, Flex on Desktop */}
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

                {/* Left Panel: Cover & Meta (Static Layout) */}
                <div
                    className="w-full md:w-[400px] p-8 md:p-12 flex flex-col items-center md:items-start relative shrink-0 md:h-full md:overflow-y-auto custom-scrollbar"
                >
                    {/* Album Art */}
                    <div
                        className="group w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800 flex items-center justify-center"
                    >
                        {coverUrl ? (
                            <img src={coverUrl} alt={title} className="w-full h-full object-cover" />
                        ) : (
                            <Folder size={64} className="opacity-20" />
                        )}

                        {/* Edit Cover Button Overlay */}
                        {onUpdateCover && songsWithCovers.length > 0 && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                <button
                                    onClick={() => setShowCoverSelection(true)}
                                    className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white"
                                    title={t('localMusic.changeCover')}
                                >
                                    <ImageIcon size={24} />
                                </button>
                            </div>
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

            {/* Cover Selection Modal */}
            <AnimatePresence>
                {showCoverSelection && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={() => setShowCoverSelection(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className={`w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl ${glassBg} overflow-hidden shadow-2xl`}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between p-4 border-b border-white/10">
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <ImageIcon size={20} />
                                    {t('localMusic.chooseCover')}
                                </h2>
                                <button onClick={() => setShowCoverSelection(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {songsWithCovers.length === 0 ? (
                                    <div className="p-8 text-center opacity-50">
                                        {t('localMusic.noCoversFound')}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {songsWithCovers.map(song => (
                                            <button
                                                key={song.id}
                                                onClick={() => handleCoverSelect(song.id)}
                                                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/10 transition-colors text-left group"
                                            >
                                                <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
                                                    <img src={getSongCover(song)} className="w-full h-full object-cover" loading="lazy" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium truncate text-sm">{song.title || song.fileName}</div>
                                                    <div className="text-xs opacity-50 truncate">{song.artist || 'Unknown Artist'}</div>
                                                </div>
                                                {/* Visual indicator handled by logic, here just hover effect */}
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Check size={16} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete Confirmation Modal */}
            {isFolderView && onDelete && (
                <DeleteFolderConfirmModal
                    isOpen={showDeleteModal}
                    folderName={title}
                    songCount={songs.length}
                    onConfirm={onDelete}
                    onCancel={() => setShowDeleteModal(false)}
                    isDaylight={isDaylight}
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
                    isDaylight={isDaylight}
                />
            )}
        </motion.div>
    );
};

export default LocalPlaylistView;
