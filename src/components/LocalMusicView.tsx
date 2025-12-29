import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Music, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LocalSong } from '../types';
import { importFolder, matchLyrics, deleteLocalSong, resyncFolder, deleteFolderSongs } from '../services/localMusicService';
import LyricMatchModal from './LyricMatchModal';
import LocalPlaylistView from './LocalPlaylistView';
import Carousel3D from './Carousel3D';

interface LocalMusicViewProps {
    localSongs: LocalSong[];
    onRefresh: () => void;
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    onPlaylistVisibilityChange?: (isOpen: boolean) => void;
    activeRow: 0 | 1;
    setActiveRow: (row: 0 | 1) => void;
    selectedGroup: { type: 'folder' | 'album', name: string, songs: LocalSong[], coverUrl?: string; id?: string; } | null;
    setSelectedGroup: (group: { type: 'folder' | 'album', name: string, songs: LocalSong[], coverUrl?: string; id?: string; } | null) => void;
    onMatchSong?: (song: LocalSong) => void;
    focusedFolderIndex?: number;
    setFocusedFolderIndex?: (index: number) => void;
    focusedAlbumIndex?: number;
    setFocusedAlbumIndex?: (index: number) => void;
    theme: any;
    isDaylight: boolean;
}

const LocalMusicView: React.FC<LocalMusicViewProps> = ({
    localSongs,
    onRefresh,
    onPlaySong,
    onPlaylistVisibilityChange,
    activeRow,
    setActiveRow,
    selectedGroup,
    setSelectedGroup,
    onMatchSong,
    focusedFolderIndex = 0,
    setFocusedFolderIndex,
    focusedAlbumIndex = 0,
    setFocusedAlbumIndex,
    theme,
    isDaylight
}) => {
    const { t } = useTranslation();

    const [isImporting, setIsImporting] = useState(false);
    const [matchingLyricsFor, setMatchingLyricsFor] = useState<string | null>(null);
    const [showMatchModal, setShowMatchModal] = useState(false);
    const [selectedSong, setSelectedSong] = useState<LocalSong | null>(null);

    // Navigation State (Lifted to Parent)
    // const [activeRow, setActiveRow] = useState<0 | 1>(0); 
    // const [selectedGroup, setSelectedGroup] = useState<{ type: 'folder' | 'album', name: string, songs: LocalSong[], coverUrl?: string; } | null>(null);

    const [coverVersion, setCoverVersion] = useState(0);

    // Grouping Logic
    const groups = useMemo(() => {
        const folders: Record<string, LocalSong[]> = {};
        const albums: Record<string, LocalSong[]> = {};

        localSongs.forEach(song => {
            // Folder Grouping - all songs should have folderName from folder import
            if (song.folderName) {
                if (!folders[song.folderName]) folders[song.folderName] = [];
                folders[song.folderName].push(song);
            }

            // Album Grouping
            // Use matched album info if available, otherwise fallback to metadata
            let albumKey = t('localMusic.unknownAlbum');
            let albumName = t('localMusic.unknownAlbum');

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            let coverUrl = undefined;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            let albumId: number | undefined = undefined;

            if (song.matchedSongId && song.matchedAlbumId) {
                // If matched, use the album name from metadata (which might be updated by match)
                albumName = song.matchedAlbumName || song.album || t('localMusic.unknownAlbum');
                // Use ID as key to distinguish different albums with same name
                albumKey = `id-${song.matchedAlbumId}`;
                albumId = song.matchedAlbumId;
                coverUrl = song.matchedCoverUrl;
            } else if (song.album) {
                albumName = song.album;
                albumKey = `name-${song.album}`;
            }

            if (albumKey !== t('localMusic.unknownAlbum')) {
                if (!albums[albumKey]) albums[albumKey] = [];
                albums[albumKey].push(song);
            }
        });

        // Helper to determine best cover for a group
        const getGroupCover = (groupType: 'folder' | 'album', groupName: string, songs: LocalSong[]) => {
            const prefKey = `local_cover_pref_${groupType}_${groupName}`;
            const prefId = localStorage.getItem(prefKey);

            // 1. User Preference
            if (prefId) {
                const prefSong = songs.find(s => s.id === prefId);
                if (prefSong) {
                    if (prefSong.embeddedCover) return URL.createObjectURL(prefSong.embeddedCover);
                    if (prefSong.matchedCoverUrl) return prefSong.matchedCoverUrl;
                }
            }

            // 2. Embedded Cover (First found)
            const embedded = songs.find(s => s.embeddedCover);
            if (embedded?.embeddedCover) {
                return URL.createObjectURL(embedded.embeddedCover);
            }

            // 3. Matched Cover (First found)
            const matched = songs.find(s => s.matchedCoverUrl);
            return matched?.matchedCoverUrl;
        };

        // Sort folders alphabetically
        const folderList = Object.entries(folders).map(([name, songs]) => ({
            id: `folder-${name}`,
            name,
            songs,
            type: 'folder' as const,
            coverUrl: getGroupCover('folder', name, songs),
            trackCount: songs.length,
            description: t('localMusic.folder')
        })).sort((a, b) => a.name.localeCompare(b.name));

        // Sort albums
        const albumList = Object.entries(albums).map(([key, songs]) => {
            // Try to find a song with matched info to get the best metadata
            const representative = songs.find(s => s.matchedAlbumId) || songs[0];
            const name = representative.matchedAlbumName || representative.album || t('localMusic.unknownAlbum');

            return {
                id: `album-${key}`,
                name,
                songs,
                type: 'album' as const,
                coverUrl: getGroupCover('album', key, songs),
                trackCount: songs.length,
                description: songs[0]?.artist || t('localMusic.unknownArtist'),
                albumId: representative.matchedAlbumId
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        return { folders: folderList, albums: albumList };
    }, [localSongs, coverVersion, t]);

    const handleFolderImport = async () => {
        setIsImporting(true);
        try {
            await importFolder();
            onRefresh();
        } catch (error) {
            console.error('Failed to import folder:', error);
            alert(t('localMusic.importNotSupported'));
        } finally {
            setIsImporting(false);
        }
    };

    const handleMatchLyrics = async (song: LocalSong) => {
        setMatchingLyricsFor(song.id);
        try {
            const lyrics = await matchLyrics(song);
            if (lyrics) {
                onRefresh();
            } else {
                setSelectedSong(song);
                setShowMatchModal(true);
            }
        } catch (error) {
            console.error('Failed to match lyrics:', error);
        } finally {
            setMatchingLyricsFor(null);
        }
    };

    const handleManualLyricMatch = () => {
        onRefresh();
        setShowMatchModal(false);
        setSelectedSong(null);
    };

    // Folder management handlers
    const handleResyncFolder = async () => {
        if (!selectedGroup || selectedGroup.type !== 'folder') return;

        try {
            // Collect IDs of old songs BEFORE any operations
            const oldSongIds = selectedGroup.songs.map(song => song.id);

            // Import fresh songs from the folder
            // Pass old song IDs so they can be deleted AFTER import
            const importedSongs = await resyncFolder(oldSongIds);

            // If user cancelled, do nothing and keep existing folder intact
            if (importedSongs === null) {
                return;
            }

            // Log result
            if (importedSongs.length === 0) {
                console.warn('[LocalMusic] No songs imported during resync');
            } else {
                console.log(`[LocalMusic] Successfully re-imported ${importedSongs.length} songs`);
            }

            onRefresh(); // Refresh the UI to show updated songs
            setSelectedGroup(null); // Close the playlist view
        } catch (error) {
            console.error('Failed to resync folder:', error);
            alert(t('localMusic.resyncFailed'));
        }
    };


    const handleDeleteFolder = async () => {
        if (!selectedGroup || selectedGroup.type !== 'folder') return;

        try {
            await deleteFolderSongs(selectedGroup.name);
            onRefresh(); // Refresh the UI
            setSelectedGroup(null); // Close the playlist view
        } catch (error) {
            console.error('Failed to delete folder:', error);
            alert(t('localMusic.deleteFailed'));
        }
    };

    // Scroll / Swipe Handling
    let touchStartY = 0;

    // const handleWheel = (e: React.WheelEvent) => {
    //     if (selectedGroup) return;
    //     // Only trigger if vertical scroll is significant
    //     if (Math.abs(e.deltaY) > 50) {
    //         if (e.deltaY > 0 && activeRow === 0) setActiveRow(1);
    //         if (e.deltaY < 0 && activeRow === 1) setActiveRow(0);
    //     }
    // };

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (selectedGroup) return;
        const diff = touchStartY - e.changedTouches[0].clientY;
        if (Math.abs(diff) > 50) {
            if (diff > 0 && activeRow === 0) setActiveRow(1);
            if (diff < 0 && activeRow === 1) setActiveRow(0);
        }
    };

    // Notify parent when playlist view opens/closes
    React.useEffect(() => {
        onPlaylistVisibilityChange?.(selectedGroup !== null);
    }, [selectedGroup, onPlaylistVisibilityChange]);

    if (selectedGroup) {
        return (
            <LocalPlaylistView
                title={selectedGroup.name}
                coverUrl={selectedGroup.coverUrl}
                songs={selectedGroup.songs}
                groupId={selectedGroup.id}
                onBack={() => {
                    setSelectedGroup(null);
                    onPlaylistVisibilityChange?.(false);
                }}
                onPlaySong={onPlaySong}
                isFolderView={selectedGroup.type === 'folder'}
                onResync={selectedGroup.type === 'folder' ? handleResyncFolder : undefined}
                onDelete={selectedGroup.type === 'folder' ? handleDeleteFolder : undefined}
                onMatchSong={onMatchSong}
                onRefresh={onRefresh}
                theme={theme}
                isDaylight={isDaylight}
                onUpdateCover={() => {
                    setCoverVersion(v => v + 1);
                    // Also update the selectedGroup's coverUrl immediately
                    // so the LocalPlaylistView displays the new cover without a page refresh
                    if (selectedGroup) {
                        const groupType = selectedGroup.type;
                        const groupName = selectedGroup.type === 'folder'
                            ? selectedGroup.name
                            : selectedGroup.id?.substring(6) || selectedGroup.name; // album-{key} -> key
                        const prefKey = `local_cover_pref_${groupType}_${groupName}`;
                        const prefId = localStorage.getItem(prefKey);

                        if (prefId) {
                            const prefSong = selectedGroup.songs.find(s => s.id === prefId);
                            if (prefSong) {
                                let newCoverUrl: string | undefined;
                                if (prefSong.embeddedCover) {
                                    newCoverUrl = URL.createObjectURL(prefSong.embeddedCover);
                                } else if (prefSong.matchedCoverUrl) {
                                    newCoverUrl = prefSong.matchedCoverUrl;
                                }
                                if (newCoverUrl) {
                                    setSelectedGroup({ ...selectedGroup, coverUrl: newCoverUrl });
                                }
                            }
                        }
                    }
                }}
            />
        );
    }

    return (
        <div
            className="w-full h-full flex flex-col p-6 pb-32 overflow-hidden relative"
            // onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-2 z-10">
                {/* Placeholder for future header content */}
            </div>

            {/* Dashboard Content */}
            <div className="flex-1 relative overflow-hidden">
                {localSongs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full opacity-50">
                        <Music size={64} className="mb-4" />
                        <p className="text-lg">{t('localMusic.noLocalMusic')}</p>
                        <button
                            onClick={handleFolderImport}
                            disabled={isImporting}
                            className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm mt-4 flex items-center gap-2"
                        >
                            {isImporting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {t('localMusic.importing')}
                                </>
                            ) : (
                                <>
                                    <FolderOpen size={16} />
                                    {t('localMusic.importFolder')}
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="w-full h-full relative">
                        <AnimatePresence mode="wait">
                            {activeRow === 0 ? (
                                <motion.div
                                    key="folders"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="w-full h-full flex flex-col justify-center"
                                >
                                    <div className="flex items-center justify-center gap-3 mb-4">
                                        <div className="text-sm font-medium uppercase tracking-widest">
                                            {t('localMusic.foldersAndPlaylists')}
                                        </div>

                                        {/* Import Button */}
                                        <button
                                            onClick={handleFolderImport}
                                            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                            disabled={isImporting}
                                            title="Import Folder"
                                        >
                                            {isImporting ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                                        </button>

                                        <span className="opacity-30">/</span>

                                        {/* Switch to Albums */}
                                        <button
                                            onClick={() => setActiveRow(1)}
                                            className="opacity-40 hover:opacity-80 text-sm font-medium uppercase tracking-widest transition-opacity"
                                        >
                                            {t('localMusic.albums')}
                                        </button>
                                    </div>
                                    <div className="h-[400px]">
                                        <Carousel3D
                                            items={groups.folders}
                                            onSelect={(item) => setSelectedGroup(item)}
                                            emptyMessage={t('localMusic.noFoldersFound')}
                                            textBottomClass="-bottom-1"
                                            initialFocusedIndex={focusedFolderIndex}
                                            onFocusedIndexChange={setFocusedFolderIndex}
                                            isDaylight={isDaylight}
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="albums"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="w-full h-full flex flex-col justify-center"
                                >
                                    <div className="flex items-center justify-center gap-3 mb-4">
                                        {/* Switch to Folders */}
                                        <button
                                            onClick={() => setActiveRow(0)}
                                            className="opacity-40 hover:opacity-80 text-sm font-medium uppercase tracking-widest transition-opacity"
                                        >
                                            {t('localMusic.foldersAndPlaylists')}
                                        </button>

                                        <span className="opacity-30">|</span>

                                        <div className="text-sm font-medium uppercase tracking-widest">
                                            {t('localMusic.albums')}
                                        </div>
                                    </div>
                                    <div className="h-[400px]">
                                        <Carousel3D
                                            items={groups.albums}
                                            onSelect={(item) => setSelectedGroup(item)}
                                            emptyMessage={t('localMusic.noAlbumsFound')}
                                            textBottomClass="-bottom-1"
                                            initialFocusedIndex={focusedAlbumIndex}
                                            onFocusedIndexChange={setFocusedAlbumIndex}
                                            isDaylight={isDaylight}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>


            {/* Manual Lyric Match Modal */}
            {showMatchModal && selectedSong && (
                <LyricMatchModal
                    song={selectedSong}
                    onClose={() => {
                        setShowMatchModal(false);
                        setSelectedSong(null);
                    }}
                    onMatch={handleManualLyricMatch}
                    isDaylight={isDaylight}
                />
            )}
        </div>
    );
};

export default LocalMusicView;
