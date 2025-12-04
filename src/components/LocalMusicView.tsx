import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Music, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LocalSong } from '../types';
import { importFolder, matchLyrics, deleteLocalSong } from '../services/localMusicService';
import LyricMatchModal from './LyricMatchModal';
import LocalPlaylistView from './LocalPlaylistView';
import Carousel3D from './Carousel3D';

interface LocalMusicViewProps {
    localSongs: LocalSong[];
    onRefresh: () => void;
    onPlaySong: (song: LocalSong) => void;
    onPlaylistVisibilityChange?: (isOpen: boolean) => void;
}

const LocalMusicView: React.FC<LocalMusicViewProps> = ({ localSongs, onRefresh, onPlaySong, onPlaylistVisibilityChange }) => {
    const { t } = useTranslation();

    const [isImporting, setIsImporting] = useState(false);
    const [matchingLyricsFor, setMatchingLyricsFor] = useState<string | null>(null);
    const [showMatchModal, setShowMatchModal] = useState(false);
    const [selectedSong, setSelectedSong] = useState<LocalSong | null>(null);

    // Navigation State
    const [activeRow, setActiveRow] = useState<0 | 1>(0); // 0: Folders, 1: Albums
    const [selectedGroup, setSelectedGroup] = useState<{ type: 'folder' | 'album', name: string, songs: LocalSong[], coverUrl?: string; } | null>(null);

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
            let albumKey = 'Unknown Album';
            let albumName = 'Unknown Album';
            let coverUrl = undefined;
            let albumId: number | undefined = undefined;

            if (song.matchedSongId && song.matchedAlbumId) {
                // If matched, use the album name from metadata (which might be updated by match)
                albumName = song.matchedAlbumName || song.album || 'Unknown Album';
                // Use ID as key to distinguish different albums with same name
                albumKey = `id-${song.matchedAlbumId}`;
                albumId = song.matchedAlbumId;
                coverUrl = song.matchedCoverUrl;
            } else if (song.album) {
                albumName = song.album;
                albumKey = `name-${song.album}`;
            }

            if (albumKey !== 'Unknown Album') {
                if (!albums[albumKey]) albums[albumKey] = [];
                albums[albumKey].push(song);
            }
        });

        // Sort folders alphabetically
        const folderList = Object.entries(folders).map(([name, songs]) => ({
            id: `folder-${name}`,
            name,
            songs,
            type: 'folder' as const,
            coverUrl: songs.find(s => s.matchedCoverUrl)?.matchedCoverUrl,
            trackCount: songs.length,
            description: 'Folder'
        })).sort((a, b) => a.name.localeCompare(b.name));

        // Sort albums
        const albumList = Object.entries(albums).map(([key, songs]) => {
            // Try to find a song with matched info to get the best metadata
            const representative = songs.find(s => s.matchedAlbumId) || songs[0];
            const name = representative.matchedAlbumName || representative.album || 'Unknown Album';

            return {
                id: `album-${key}`,
                name,
                songs,
                type: 'album' as const,
                coverUrl: songs.find(s => s.matchedCoverUrl)?.matchedCoverUrl,
                trackCount: songs.length,
                description: songs[0]?.artist || 'Unknown Artist',
                albumId: representative.matchedAlbumId
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        return { folders: folderList, albums: albumList };
    }, [localSongs]);

    const handleFolderImport = async () => {
        setIsImporting(true);
        try {
            await importFolder();
            onRefresh();
        } catch (error) {
            console.error('Failed to import folder:', error);
            alert('Folder import not supported in this browser or cancelled');
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
                onBack={() => {
                    setSelectedGroup(null);
                    onPlaylistVisibilityChange?.(false);
                }}
                onPlaySong={onPlaySong}
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
                        <p className="text-lg">No local music imported yet</p>
                        <button
                            onClick={handleFolderImport}
                            disabled={isImporting}
                            className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm mt-4 flex items-center gap-2"
                        >
                            {isImporting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Importing...
                                </>
                            ) : (
                                <>
                                    <FolderOpen size={16} />
                                    Import Folder
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
                                    initial={{ opacity: 0, y: -50 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -50 }}
                                    transition={{ duration: 0.3 }}
                                    className="w-full h-full flex flex-col justify-center"
                                >
                                    <div className="flex items-center justify-center gap-3 mb-4">
                                        <div className="opacity-60 text-sm font-medium uppercase tracking-widest">
                                            Folders & Playlists
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
                                    </div>
                                    <div className="h-[400px]">
                                        <Carousel3D
                                            items={groups.folders}
                                            onSelect={(item) => setSelectedGroup(item)}
                                            emptyMessage="No folders found"
                                            textBottomClass="-bottom-1"
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="albums"
                                    initial={{ opacity: 0, y: 50 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 50 }}
                                    transition={{ duration: 0.3 }}
                                    className="w-full h-full flex flex-col justify-center"
                                >
                                    <div className="text-center mb-4 opacity-60 text-sm font-medium uppercase tracking-widest">
                                        Albums
                                    </div>
                                    <div className="h-[400px]">
                                        <Carousel3D
                                            items={groups.albums}
                                            onSelect={(item) => setSelectedGroup(item)}
                                            emptyMessage="No albums found"
                                            textBottomClass="-bottom-1"
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* Navigation Arrow - Left Side */}
            {localSongs.length > 0 && (
                <div className="absolute right-8 top-1/2 -translate-y-1/2 z-20">
                    <button
                        onClick={() => setActiveRow(prev => prev === 0 ? 1 : 0)}
                        className="p-3 opacity-50 hover:opacity-100 transition-opacity"
                        title={activeRow === 0 ? "Switch to Albums" : "Switch to Folders"}
                    >
                        {activeRow === 0 ? <ChevronDown size={32} /> : <ChevronUp size={32} />}
                    </button>
                </div>
            )}

            {/* Manual Lyric Match Modal */}
            {showMatchModal && selectedSong && (
                <LyricMatchModal
                    song={selectedSong}
                    onClose={() => {
                        setShowMatchModal(false);
                        setSelectedSong(null);
                    }}
                    onMatch={handleManualLyricMatch}
                />
            )}
        </div>
    );
};

export default LocalMusicView;
