import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Play, ChevronLeft, Folder, RefreshCw, Trash2, Plus, Pencil, X } from 'lucide-react';
import { LocalSong } from '../../types';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import DeleteFolderConfirmModal from '../modal/DeleteFolderConfirmModal';
import { removeSongsFromLocalPlaylist } from '../../services/localPlaylistService';

interface LocalPlaylistViewProps {
    title: string;
    coverUrl?: string;
    songs: LocalSong[];
    onBack: () => void;
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddToQueue?: (song: LocalSong) => void;
    onSelectArtist?: (artistName: string) => void;
    onSelectAlbum?: (albumName: string) => void;
    isFolderView?: boolean;
    allSongs?: LocalSong[];
    onResync?: () => void;
    onDelete?: () => void;
    onMatchSong?: (song: LocalSong) => void;
    onRefresh?: () => void;
    playlistId?: string;
    isEditablePlaylist?: boolean;
    onDeletePlaylist?: () => void;
    onRenamePlaylist?: (playlistId: string, name: string) => Promise<void>;
    theme: any;
    isDaylight: boolean;
}

const TRACK_ROW_HEIGHT = 68;
const TRACK_OVERSCAN = 8;

interface LocalPlaylistRowProps {
    song: LocalSong;
    index: number;
    songs: LocalSong[];
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddToQueue?: (song: LocalSong) => void;
    onSelectArtist?: (artistName: string) => void;
    onSelectAlbum?: (albumName: string) => void;
    t: ReturnType<typeof useTranslation>['t'];
    isEditing?: boolean;
    onRemove?: (song: LocalSong) => void;
}

const LocalPlaylistRow = React.memo(({ song, index, songs, onPlaySong, onAddToQueue, onSelectArtist, onSelectAlbum, t, isEditing = false, onRemove }: LocalPlaylistRowProps) => {
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
    };

    return (
        <div
            onClick={() => onPlaySong(song, songs)}
            className="group flex h-[68px] items-center py-3 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
        >
            <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                {index + 1}
            </div>

            <div className="flex-1 min-w-0 pl-3 md:pl-4">
                <div className="text-sm font-medium opacity-90 group-hover:opacity-100" style={{ color: 'var(--text-primary)' }}>
                    {song.title || song.fileName}
                </div>
                <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    <span
                        className={onSelectArtist ? 'cursor-pointer hover:underline hover:opacity-100 transition-opacity' : ''}
                        onClick={(event) => {
                            if (!onSelectArtist) {
                                return;
                            }
                            event.stopPropagation();
                            const artistName = song.matchedArtists || song.artist;
                            if (artistName) {
                                onSelectArtist(artistName);
                            }
                        }}
                    >
                        {song.matchedArtists || song.artist || t('localMusic.unknownArtist')}
                    </span>
                    {(song.matchedAlbumName || song.album) && (
                        <>
                            <span className="mx-1.5">•</span>
                            <span
                                className={onSelectAlbum ? 'cursor-pointer hover:underline hover:opacity-100 transition-opacity' : ''}
                                onClick={(event) => {
                                    if (!onSelectAlbum) {
                                        return;
                                    }
                                    event.stopPropagation();
                                    const albumName = song.matchedAlbumName || song.album;
                                    if (albumName) {
                                        onSelectAlbum(albumName);
                                    }
                                }}
                            >
                                {song.matchedAlbumName || song.album}
                            </span>
                        </>
                    )}
                </div>
            </div>

            <div className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                {formatDuration(song.duration)}
            </div>

            {!isEditing && onAddToQueue && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddToQueue(song);
                    }}
                    className="p-2 ml-2 rounded-full hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="Add to Queue"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    <Plus size={14} />
                </button>
            )}

            {isEditing && (
                <div className="flex items-center gap-1 ml-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemove?.(song);
                        }}
                        className="p-2 rounded-full hover:bg-red-500/10 text-red-400 transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
        </div>
    );
});

LocalPlaylistRow.displayName = 'LocalPlaylistRow';

const LocalPlaylistView: React.FC<LocalPlaylistViewProps> = ({ title, coverUrl, songs, onBack, onPlaySong, onAddToQueue, onSelectArtist, onSelectAlbum, isFolderView = false, allSongs, onResync, onDelete, onMatchSong, onRefresh, playlistId, isEditablePlaylist = false, onDeletePlaylist, onRenamePlaylist, theme, isDaylight }) => {
    // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
    const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20';
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';

    const { t } = useTranslation();

    const containerRef = useRef<HTMLDivElement>(null);
    const trackListRef = useRef<HTMLDivElement>(null);

    // State for delete confirmation modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isResyncing, setIsResyncing] = useState(false);
    const [listHeight, setListHeight] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);
    const [editableSongs, setEditableSongs] = useState<LocalSong[]>(songs);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editableTitle, setEditableTitle] = useState(title);
    const [isRenamingPlaylist, setIsRenamingPlaylist] = useState(false);

    useEffect(() => {
        setEditableSongs(songs);
    }, [songs]);

    useEffect(() => {
        setIsEditMode(false);
        setEditableTitle(title);
    }, [playlistId, title]);

    // Calculate total songs to delete (including nested folders)
    const songsToDeleteCount = useMemo(() => {
        if (!isFolderView || !allSongs) return songs.length;
        
        return allSongs.filter(song => 
            song.folderName === title || (song.folderName && song.folderName.startsWith(`${title}/`))
        ).length;
    }, [allSongs, title, isFolderView, songs.length]);

    useEffect(() => {
        const node = trackListRef.current;
        if (!node) return;

        const updateListHeight = () => {
            setListHeight(node.clientHeight);
        };

        updateListHeight();

        const resizeObserver = new ResizeObserver(updateListHeight);
        resizeObserver.observe(node);

        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        const node = trackListRef.current;
        if (!node) return;

        node.scrollTop = 0;
        setScrollTop(0);
    }, [title, songs]);

    const displayedSongs = isEditablePlaylist ? editableSongs : songs;
    const totalHeight = displayedSongs.length * TRACK_ROW_HEIGHT;
    const visibleRange = useMemo(() => {
        if (displayedSongs.length === 0) {
            return { startIndex: 0, endIndex: -1 };
        }

        const viewportHeight = listHeight || 600;
        const startIndex = Math.max(0, Math.floor(scrollTop / TRACK_ROW_HEIGHT) - TRACK_OVERSCAN);
        const endIndex = Math.min(
            displayedSongs.length - 1,
            Math.ceil((scrollTop + viewportHeight) / TRACK_ROW_HEIGHT) + TRACK_OVERSCAN
        );

        return { startIndex, endIndex };
    }, [displayedSongs.length, listHeight, scrollTop]);

    const visibleSongs = useMemo(() => {
        if (visibleRange.endIndex < visibleRange.startIndex) {
            return [];
        }

        return displayedSongs.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
    }, [displayedSongs, visibleRange.endIndex, visibleRange.startIndex]);

    const handleRemoveSong = async (songId: string) => {
        if (!playlistId) {
            return;
        }

        await removeSongsFromLocalPlaylist(playlistId, [songId]);
        const nextSongs = editableSongs.filter(song => song.id !== songId);
        setEditableSongs(nextSongs);
        onRefresh?.();
    };

    const handleEditToggle = async () => {
        if (!isEditMode) {
            setEditableTitle(title);
            setIsEditMode(true);
            return;
        }

        if (playlistId && onRenamePlaylist) {
            const trimmedTitle = editableTitle.trim();
            if (trimmedTitle && trimmedTitle !== title) {
                try {
                    setIsRenamingPlaylist(true);
                    await onRenamePlaylist(playlistId, trimmedTitle);
                    onRefresh?.();
                } finally {
                    setIsRenamingPlaylist(false);
                }
            }
        }

        setIsEditMode(false);
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
                    <div className="w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800 flex items-center justify-center">
                        {coverUrl ? (
                            <img src={coverUrl} alt={title} className="w-full h-full object-cover" />
                        ) : (
                            <Folder size={64} className="opacity-20" />
                        )}
                    </div>

                    <div className="text-center md:text-left space-y-2 w-full mb-6">
                        {isEditablePlaylist && isEditMode ? (
                            <input
                                type="text"
                                value={editableTitle}
                                onChange={(event) => setEditableTitle(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        void handleEditToggle();
                                    }
                                }}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-2xl font-bold outline-none transition-colors focus:border-sky-400 md:text-3xl"
                                style={{ color: 'var(--text-primary)' }}
                                autoFocus
                            />
                        ) : (
                            <h1 className="text-2xl md:text-3xl font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>{title}</h1>
                        )}
                        <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>{displayedSongs.length} {t('playlist.tracks')}</div>
                    </div>

                    <div className="w-full space-y-3">
                        <button
                            onClick={() => {
                                if (displayedSongs.length > 0) onPlaySong(displayedSongs[0], displayedSongs);
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

                        {isEditablePlaylist && (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        void handleEditToggle();
                                    }}
                                    disabled={isRenamingPlaylist}
                                    className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <Pencil size={16} />
                                    {isEditMode ? (t('localMusic.finishEditing') || '完成编辑') : (t('localMusic.editPlaylist') || '编辑歌单')}
                                </button>

                                {onDeletePlaylist && (
                                    <button
                                        onClick={onDeletePlaylist}
                                        className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500"
                                    >
                                        <Trash2 size={16} />
                                        {t('localMusic.deletePlaylist') || '删除歌单'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Tracks */}
                <div
                    className="flex-1 md:h-full min-h-0 flex flex-col"
                >
                    <div className="p-4 md:p-8 pb-4 md:pb-8 flex-1 min-h-0 flex flex-col">
                        {/* Desktop Sticky Header */}
                        <div className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30" style={{ color: 'var(--text-secondary)' }}>
                            <div className="w-10 text-center">#</div>
                            <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                            <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                        </div>

                        <div
                            ref={trackListRef}
                            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-28 md:pb-0"
                            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                        >
                            <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
                                {visibleSongs.map((song, offset) => {
                                    const actualIndex = visibleRange.startIndex + offset;
                                    return (
                                        <div
                                            key={song.id}
                                            style={{
                                                position: 'absolute',
                                                top: actualIndex * TRACK_ROW_HEIGHT,
                                                left: 0,
                                                right: 0
                                            }}
                                        >
                                            <LocalPlaylistRow
                                                song={song}
                                                index={actualIndex}
                                                songs={displayedSongs}
                                                onPlaySong={onPlaySong}
                                                onAddToQueue={onAddToQueue}
                                                onSelectArtist={onSelectArtist}
                                                onSelectAlbum={onSelectAlbum}
                                                t={t}
                                                isEditing={isEditMode}
                                                onRemove={() => handleRemoveSong(song.id)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
            {/* Delete Confirmation Modal */}
            {isFolderView && onDelete && (
                <DeleteFolderConfirmModal
                    isOpen={showDeleteModal}
                    folderName={title}
                    songCount={songsToDeleteCount}
                    onConfirm={onDelete}
                    onCancel={() => setShowDeleteModal(false)}
                    isDaylight={isDaylight}
                />
            )}
        </motion.div>
    );
};

export default LocalPlaylistView;
