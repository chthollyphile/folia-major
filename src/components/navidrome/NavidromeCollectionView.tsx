import React from 'react';
import { ChevronLeft, Disc, ListPlus, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    NavidromeCollectionDescriptor,
    NavidromeConfig,
    NavidromePlaylistDialogItem,
    NavidromeSong,
    SubsonicSong,
} from '../../types/navidrome';
import { navidromeApi } from '../../services/navidromeService';
import { Theme } from '../../types';
import { createCoverPlaceholder } from '../../utils/coverPlaceholders';
import PlaylistSelectionDialog from '../shared/PlaylistSelectionDialog';
import TextInputDialog from '../shared/TextInputDialog';

interface NavidromeCollectionViewProps {
    title: string;
    subtitle?: string;
    coverUrl?: string;
    placeholderVariant?: 'artist' | 'playlist';
    songs: SubsonicSong[];
    config: NavidromeConfig;
    onBack: () => void;
    onPlaySong: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onAddAllToQueue?: (songs: NavidromeSong[]) => void;
    onSelectArtist?: (artistId: string) => void;
    onSelectAlbum?: (albumId: string) => void;
    collection: NavidromeCollectionDescriptor;
    availablePlaylists?: NavidromePlaylistDialogItem[];
    onAddToPlaylist?: (playlistId: string | number, songs: NavidromeSong[]) => Promise<void> | void;
    onCreatePlaylist?: (name: string, songs: NavidromeSong[]) => Promise<void> | void;
    onRenamePlaylist?: (playlistId: string, name: string) => Promise<void> | void;
    onDeletePlaylist?: (playlistId: string) => Promise<void> | void;
    onRemoveSongFromPlaylist?: (playlistId: string, songIndex: number) => Promise<void> | void;
    onAddSongToPlaylist?: (playlistId: string | number, song: NavidromeSong) => Promise<void> | void;
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
    onAddAllToQueue,
    onSelectArtist,
    onSelectAlbum,
    collection,
    availablePlaylists = [],
    onAddToPlaylist,
    onCreatePlaylist,
    onRenamePlaylist,
    onDeletePlaylist,
    onRemoveSongFromPlaylist,
    onAddSongToPlaylist,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const glassBg = isDaylight ? 'bg-white/60 backdrop-blur-md border border-white/20 shadow-xl' : 'bg-black/40 backdrop-blur-md border border-white/10';
    const panelBg = isDaylight ? 'bg-white/40 shadow-xl border border-white/20' : 'bg-black/20';
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const fallbackCoverUrl = React.useMemo(() => createCoverPlaceholder(title, placeholderVariant), [placeholderVariant, title]);
    const [isPlaylistPickerOpen, setIsPlaylistPickerOpen] = React.useState(false);
    const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = React.useState(false);
    const [songPlaylistPickerIndex, setSongPlaylistPickerIndex] = React.useState<number | null>(null);
    const [createPlaylistSongIndex, setCreatePlaylistSongIndex] = React.useState<number | null>(null);
    const [editableTitle, setEditableTitle] = React.useState(title);
    const [isEditMode, setIsEditMode] = React.useState(false);
    const [isRenamingPlaylist, setIsRenamingPlaylist] = React.useState(false);
    const [removingSongIndex, setRemovingSongIndex] = React.useState<number | null>(null);

    React.useEffect(() => {
        setEditableTitle(title);
        setIsEditMode(false);
        setSongPlaylistPickerIndex(null);
        setCreatePlaylistSongIndex(null);
    }, [collection, title]);

    const queue = songs.map(song => navidromeApi.toNavidromeSong(config, song));
    const isEditablePlaylist = collection.kind === 'playlist' && collection.editable;
    const canAddCollectionToPlaylist = collection.kind !== 'playlist' && (availablePlaylists.length > 0 || Boolean(onCreatePlaylist));
    const panelButtonClass = 'w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
    const secondaryButtonClass = isDaylight
        ? 'flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-black/5 hover:bg-black/10 border border-black/10 disabled:opacity-60 disabled:cursor-not-allowed'
        : 'flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed';
    const dangerButtonClass = 'flex-1 py-2.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 disabled:opacity-60 disabled:cursor-not-allowed';

    const handleEditToggle = async () => {
        if (!isEditablePlaylist) {
            return;
        }

        if (!isEditMode) {
            setEditableTitle(title);
            setIsEditMode(true);
            return;
        }

        const trimmedTitle = editableTitle.trim();
        if (trimmedTitle && trimmedTitle !== title && onRenamePlaylist) {
            try {
                setIsRenamingPlaylist(true);
                await onRenamePlaylist(collection.playlist.id, trimmedTitle);
            } finally {
                setIsRenamingPlaylist(false);
            }
        }

        setIsEditMode(false);
    };

    return (
        <>
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
                                <h1 className="text-2xl md:text-3xl font-bold line-clamp-2">{title}</h1>
                            )}
                            {subtitle && (
                                <div className="text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {subtitle}
                                </div>
                            )}
                            <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>
                                {songs.length} {t('playlist.tracks')}
                            </div>
                        </div>

                        <div className="w-full space-y-3">
                            <button
                                onClick={() => {
                                    if (queue.length > 0) {
                                        onPlaySong(queue[0], queue);
                                    }
                                }}
                                disabled={queue.length === 0}
                                className={panelButtonClass}
                                style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                            >
                                <Play size={18} fill="currentColor" />
                                {t('playlist.playAll')}
                            </button>

                            <button
                                onClick={() => {
                                    if (queue.length > 0) {
                                        onAddAllToQueue?.(queue);
                                    }
                                }}
                                disabled={queue.length === 0}
                                className={panelButtonClass}
                                style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                            >
                                <ListPlus size={18} />
                                {t('navidrome.addToQueue') || '加入播放队列'}
                            </button>

                            {canAddCollectionToPlaylist && (
                                <button
                                    onClick={() => setIsPlaylistPickerOpen(true)}
                                    disabled={queue.length === 0 || (!availablePlaylists.length && !onCreatePlaylist)}
                                    className={panelButtonClass}
                                    style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                                >
                                    <Plus size={18} />
                                    {t('localMusic.addToPlaylist') || '添加到歌单'}
                                </button>
                            )}

                            {isEditablePlaylist && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            void handleEditToggle();
                                        }}
                                        disabled={isRenamingPlaylist}
                                        className={secondaryButtonClass}
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {isRenamingPlaylist ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                                        {isEditMode
                                            ? (t('localMusic.finishEditing') || '完成编辑')
                                            : (t('localMusic.editPlaylist') || '编辑歌单')}
                                    </button>
                                    {onDeletePlaylist && (
                                        <button
                                            onClick={() => onDeletePlaylist(collection.playlist.id)}
                                            className={dangerButtonClass}
                                        >
                                            <Trash2 size={16} />
                                            {t('localMusic.deletePlaylist') || '删除歌单'}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
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

                                    {(isEditablePlaylist || onAddSongToPlaylist) && (
                                        <div className="ml-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                            {onAddSongToPlaylist && !isEditablePlaylist && (
                                                <button
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setSongPlaylistPickerIndex(idx);
                                                    }}
                                                    className="rounded-full p-2 hover:bg-white/10"
                                                    title={t('localMusic.addToPlaylist') || '添加到歌单'}
                                                    style={{ color: 'var(--text-secondary)' }}
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            )}

                                            {isEditablePlaylist && onRemoveSongFromPlaylist && (
                                                <button
                                                    onClick={async (event) => {
                                                        event.stopPropagation();
                                                        try {
                                                            setRemovingSongIndex(idx);
                                                            await onRemoveSongFromPlaylist(collection.playlist.id, idx);
                                                        } finally {
                                                            setRemovingSongIndex(null);
                                                        }
                                                    }}
                                                    disabled={removingSongIndex === idx}
                                                    className="rounded-full p-2 hover:bg-red-500/10 disabled:opacity-60"
                                                    title={t('localMusic.delete') || '删除'}
                                                    style={{ color: 'var(--text-secondary)' }}
                                                >
                                                    {removingSongIndex === idx ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </motion.div>

            <PlaylistSelectionDialog
                isOpen={isPlaylistPickerOpen}
                onClose={() => setIsPlaylistPickerOpen(false)}
                isDaylight={isDaylight}
                title={t('localMusic.addToPlaylist') || '添加到歌单'}
                description={t('home.playlists') || 'Playlists'}
                playlists={availablePlaylists}
                onSelect={async (playlistId) => {
                    await onAddToPlaylist?.(playlistId, queue);
                }}
                onCreate={onCreatePlaylist ? () => {
                    setIsPlaylistPickerOpen(false);
                    setIsCreatePlaylistOpen(true);
                } : undefined}
                createLabel={t('navidrome.createPlaylist') || '新建歌单'}
            />

            <PlaylistSelectionDialog
                isOpen={songPlaylistPickerIndex !== null}
                onClose={() => setSongPlaylistPickerIndex(null)}
                isDaylight={isDaylight}
                title={t('localMusic.addToPlaylist') || '添加到歌单'}
                description={songs[songPlaylistPickerIndex ?? -1]?.title || title}
                playlists={availablePlaylists}
                onSelect={async (playlistId) => {
                    const targetSong = songPlaylistPickerIndex !== null ? queue[songPlaylistPickerIndex] : null;
                    if (!targetSong) {
                        return;
                    }
                    await onAddSongToPlaylist?.(playlistId, targetSong);
                }}
                onCreate={onCreatePlaylist && songPlaylistPickerIndex !== null ? () => {
                    setCreatePlaylistSongIndex(songPlaylistPickerIndex);
                    setIsCreatePlaylistOpen(true);
                    setSongPlaylistPickerIndex(null);
                } : undefined}
                createLabel={t('navidrome.createPlaylist') || '新建歌单'}
            />

            <TextInputDialog
                isOpen={isCreatePlaylistOpen}
                onClose={() => setIsCreatePlaylistOpen(false)}
                isDaylight={isDaylight}
                title={t('navidrome.createPlaylist') || '新建歌单'}
                description={t('localMusic.enterPlaylistName') || '输入歌单名称'}
                placeholder={t('localMusic.enterPlaylistName') || '输入歌单名称'}
                confirmLabel={t('options.save') || '保存'}
                onConfirm={async (name) => {
                    if (createPlaylistSongIndex !== null) {
                        const targetSong = queue[createPlaylistSongIndex];
                        if (targetSong) {
                            await onCreatePlaylist?.(name, [targetSong]);
                        }
                        setCreatePlaylistSongIndex(null);
                        return;
                    }

                    await onCreatePlaylist?.(name, queue);
                }}
            />
        </>
    );
};

export default NavidromeCollectionView;
