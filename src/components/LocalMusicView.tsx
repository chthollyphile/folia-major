import React, { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FolderOpen, Play, Music, Trash2, Search, Loader2, Disc, Folder, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LocalSong } from '../types';
import { importFiles, importFolder, matchLyrics, deleteLocalSong } from '../services/localMusicService';
import LyricMatchModal from './LyricMatchModal';
import LocalPlaylistView from './LocalPlaylistView';
import Carousel3D from './Carousel3D';

interface LocalMusicViewProps {
    localSongs: LocalSong[];
    onRefresh: () => void;
    onPlaySong: (song: LocalSong) => void;
}

const LocalMusicView: React.FC<LocalMusicViewProps> = ({ localSongs, onRefresh, onPlaySong }) => {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        const singleImports: LocalSong[] = [];

        localSongs.forEach(song => {
            // Folder Grouping
            if (song.folderName) {
                if (!folders[song.folderName]) folders[song.folderName] = [];
                folders[song.folderName].push(song);
            } else {
                singleImports.push(song);
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

        // Sort folders: Single Imports first, then alphabetical
        const folderList = Object.entries(folders).map(([name, songs]) => ({
            id: `folder-${name}`,
            name,
            songs,
            type: 'folder' as const,
            coverUrl: songs.find(s => s.matchedCoverUrl)?.matchedCoverUrl,
            trackCount: songs.length,
            description: 'Folder'
        })).sort((a, b) => a.name.localeCompare(b.name));

        if (singleImports.length > 0) {
            folderList.unshift({
                id: 'folder-single-imports',
                name: 'Single Imports',
                songs: singleImports,
                type: 'folder' as const,
                coverUrl: singleImports.find(s => s.matchedCoverUrl)?.matchedCoverUrl,
                trackCount: singleImports.length,
                description: 'Imported Files'
            });
        }

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

    const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsImporting(true);
        try {
            await importFiles(files);
            onRefresh();
        } catch (error) {
            console.error('Failed to import files:', error);
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

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
    const touchStartY = useRef(0);

    const handleWheel = (e: React.WheelEvent) => {
        if (selectedGroup) return;
        // Only trigger if vertical scroll is significant
        if (Math.abs(e.deltaY) > 50) {
            if (e.deltaY > 0 && activeRow === 0) setActiveRow(1);
            if (e.deltaY < 0 && activeRow === 1) setActiveRow(0);
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (selectedGroup) return;
        const diff = touchStartY.current - e.changedTouches[0].clientY;
        if (Math.abs(diff) > 50) {
            if (diff > 0 && activeRow === 0) setActiveRow(1);
            if (diff < 0 && activeRow === 1) setActiveRow(0);
        }
    };

    if (selectedGroup) {
        return (
            <LocalPlaylistView
                title={selectedGroup.name}
                coverUrl={selectedGroup.coverUrl}
                songs={selectedGroup.songs}
                onBack={() => setSelectedGroup(null)}
                onPlaySong={onPlaySong}
            />
        );
    }

    return (
        <div
            className="w-full h-full flex flex-col p-6 pb-32 overflow-hidden relative"
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-2 z-10">
                {/* <h2 className="text-2xl font-bold opacity-90">Local Music</h2> */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={handleFileImport}
                    className="hidden"
                />
            </div>

            {/* Dashboard Content */}
            <div className="flex-1 relative overflow-hidden">
                {localSongs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full opacity-50">
                        <Music size={64} className="mb-4" />
                        <p className="text-lg">No local music imported yet</p>
                        <div className="flex gap-4 mt-4">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm"
                            >
                                Import Files
                            </button>
                            <button
                                onClick={handleFolderImport}
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm"
                            >
                                Import Folder
                            </button>
                        </div>
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

                                        {/* Import Dropdown Trigger */}
                                        <div className="relative group">
                                            <button
                                                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                                disabled={isImporting}
                                            >
                                                {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                            </button>

                                            {/* Dropdown Menu */}
                                            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-32 bg-[#1e1e1e] border border-white/10 rounded-lg shadow-xl overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 flex flex-col">
                                                <button
                                                    onClick={() => fileInputRef.current?.click()}
                                                    className="px-3 py-2 text-xs text-left hover:bg-white/10 transition-colors flex items-center gap-2"
                                                >
                                                    <Music size={12} /> Single Files
                                                </button>
                                                <button
                                                    onClick={handleFolderImport}
                                                    className="px-3 py-2 text-xs text-left hover:bg-white/10 transition-colors flex items-center gap-2"
                                                >
                                                    <FolderOpen size={12} /> Folder
                                                </button>
                                            </div>
                                        </div>
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
