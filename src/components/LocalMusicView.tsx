import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Music, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LocalSong, LocalLibraryGroup, LocalPlaylist } from '../types';
import { importFolder, matchLyrics, resyncFolder, deleteFolderSongs, LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../services/localMusicService';
import LyricMatchModal from './modal/LyricMatchModal';
import LocalPlaylistView from './local/LocalPlaylistView';
import Carousel3D from './Carousel3D';
import LocalArtistView from './local/LocalArtistView';
import { deleteLocalPlaylist, updateLocalPlaylist } from '../services/localPlaylistService';

interface LocalMusicViewProps {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    onRefresh: () => void;
    onPlaySong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddToQueue?: (song: LocalSong) => void;
    onPlaylistVisibilityChange?: (isOpen: boolean) => void;
    activeRow: 0 | 1 | 2 | 3;
    setActiveRow: (row: 0 | 1 | 2 | 3) => void;
    selectedGroup: LocalLibraryGroup | null;
    setSelectedGroup: (group: LocalLibraryGroup | null) => void;
    onBackFromDetail?: () => void;
    onMatchSong?: (song: LocalSong) => void;
    focusedFolderIndex?: number;
    setFocusedFolderIndex?: (index: number) => void;
    focusedAlbumIndex?: number;
    setFocusedAlbumIndex?: (index: number) => void;
    focusedArtistIndex?: number;
    setFocusedArtistIndex?: (index: number) => void;
    focusedPlaylistIndex?: number;
    setFocusedPlaylistIndex?: (index: number) => void;
    onSelectArtistGroup?: (artistName: string) => void;
    onSelectAlbumGroup?: (albumName: string) => void;
    theme: any;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
}

/**
 * Find the preferred cover source for a group of songs.
 * Returns a Blob (for embedded covers) or a URL string (for matched covers).
 * Does NOT create ObjectURLs — the caller is responsible for lifecycle management.
 */
const getGroupCoverSource = (songs: LocalSong[]): Blob | string | undefined => {
    const sortedSongs = [...songs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = sortedSongs.find(song => song.embeddedCover || song.matchedCoverUrl);

    if (preferredSong?.embeddedCover) {
        return preferredSong.embeddedCover;
    }

    return preferredSong?.matchedCoverUrl;
};

const LocalMusicView: React.FC<LocalMusicViewProps> = ({
    localSongs,
    localPlaylists,
    onRefresh,
    onPlaySong,
    onAddToQueue,
    onPlaylistVisibilityChange,
    activeRow,
    setActiveRow,
    selectedGroup,
    setSelectedGroup,
    onBackFromDetail,
    onMatchSong,
    focusedFolderIndex = 0,
    setFocusedFolderIndex,
    focusedAlbumIndex = 0,
    setFocusedAlbumIndex,
    focusedArtistIndex = 0,
    setFocusedArtistIndex,
    focusedPlaylistIndex = 0,
    setFocusedPlaylistIndex,
    onSelectArtistGroup,
    onSelectAlbumGroup,
    theme,
    isDaylight,
    hasFloatingPlayer = false
}) => {
    const { t } = useTranslation();
    const allSongsLabel = t('localMusic.allSongs');
    const resolvedAllSongsLabel = allSongsLabel === 'localMusic.allSongs' ? '全部歌曲' : allSongsLabel;

    const [isImporting, setIsImporting] = useState(false);
    const [isScanInProgress, setIsScanInProgress] = useState(false);
    const [matchingLyricsFor, setMatchingLyricsFor] = useState<string | null>(null);
    const [showMatchModal, setShowMatchModal] = useState(false);
    const [selectedSong, setSelectedSong] = useState<LocalSong | null>(null);

    const [needsPermission, setNeedsPermission] = useState(false);

    useEffect(() => {
        const checkPermissions = async () => {
            try {
                if (!('showDirectoryPicker' in window)) return;
                const { getDirHandles } = await import('../services/db');
                const handles = await getDirHandles();
                let needs = false;
                for (const value of Object.values(handles)) {
                    if (await (value as any).queryPermission({ mode: 'read' }) !== 'granted') {
                        needs = true;
                        break;
                    }
                }
                setNeedsPermission(needs);
            } catch (e) {
                console.error("Failed to check permissions", e);
            }
        };
        checkPermissions();
    }, [localSongs]);

    useEffect(() => {
        const handleScanProgress = (event: Event) => {
            const customEvent = event as CustomEvent<{
                active: boolean;
            }>;
            setIsScanInProgress(customEvent.detail.active);
        };

        window.addEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress as EventListener);
        return () => window.removeEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress as EventListener);
    }, []);

    const handleRestorePermissions = async () => {
        try {
            const { getDirHandles } = await import('../services/db');
            const handles = await getDirHandles();
            for (const value of Object.values(handles)) {
                if (await (value as any).queryPermission({ mode: 'read' }) !== 'granted') {
                    await (value as any).requestPermission({ mode: 'read' });
                }
            }
            setNeedsPermission(false);
            onRefresh();
        } catch (e) {
            console.error("Failed to restore permissions", e);
        }
    };

    // Navigation State (Lifted to Parent)
    // const [activeRow, setActiveRow] = useState<0 | 1>(0); 
    // const [selectedGroup, setSelectedGroup] = useState<{ type: 'folder' | 'album', name: string, songs: LocalSong[], coverUrl?: string; } | null>(null);

    // Grouping Logic
    const { groups, coverSourceMap } = useMemo(() => {
        const folders: Record<string, LocalSong[]> = {};
        const albums: Record<string, LocalSong[]> = {};
        const artists: Record<string, LocalSong[]> = {};
        const sourceMap = new Map<string, Blob | string | undefined>();

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

            const artistName = song.matchedArtists || song.artist;
            if (artistName) {
                if (!artists[artistName]) {
                    artists[artistName] = [];
                }
                artists[artistName].push(song);
            }
        });

        // Sort folders alphabetically
        const folderList: LocalLibraryGroup[] = Object.entries(folders).map(([name, songs]) => {
            const id = `folder-${name}`;
            sourceMap.set(id, getGroupCoverSource(songs));
            return {
                id,
                name,
                songs,
                type: 'folder' as const,
                coverUrl: undefined,
                trackCount: songs.length,
                description: t('localMusic.folder')
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        if (localSongs.length > 0) {
            const allSongsId = 'folder-__all-songs__';
            sourceMap.set(allSongsId, getGroupCoverSource(localSongs));
            folderList.unshift({
                id: allSongsId,
                name: resolvedAllSongsLabel,
                songs: localSongs,
                type: 'folder' as const,
                coverUrl: undefined,
                trackCount: localSongs.length,
                description: t('localMusic.folder'),
                isVirtual: true
            });
        }

        // Sort albums
        const albumList: LocalLibraryGroup[] = Object.entries(albums).map(([key, songs]) => {
            // Try to find a song with matched info to get the best metadata
            const representative = songs.find(s => s.matchedAlbumId) || songs[0];
            const name = representative.matchedAlbumName || representative.album || t('localMusic.unknownAlbum');
            const id = `album-${key}`;
            sourceMap.set(id, getGroupCoverSource(songs));

            return {
                id,
                name,
                songs,
                type: 'album' as const,
                coverUrl: undefined,
                trackCount: songs.length,
                description: songs[0]?.artist || t('localMusic.unknownArtist'),
                albumId: representative.matchedAlbumId
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        const artistList: LocalLibraryGroup[] = Object.entries(artists).map(([name, songs]) => {
            const id = `artist-${name}`;
            sourceMap.set(id, getGroupCoverSource(songs));
            return {
                id,
                name,
                songs,
                type: 'artist' as const,
                coverUrl: undefined,
                trackCount: songs.length,
                description: songs[0]?.matchedAlbumName || songs[0]?.album || t('localMusic.unknownAlbum'),
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        const playlistList: LocalLibraryGroup[] = localPlaylists.map(playlist => {
            const songMap = new Map(localSongs.map(song => [song.id, song]));
            const songs = playlist.songIds
                .map(songId => songMap.get(songId))
                .filter((song): song is LocalSong => Boolean(song));

            const id = `playlist-${playlist.id}`;
            sourceMap.set(id, getGroupCoverSource(songs));

            return {
                id,
                playlistId: playlist.id,
                name: playlist.name,
                songs,
                type: 'playlist' as const,
                coverUrl: undefined,
                trackCount: songs.length,
                description: playlist.isFavorite ? t('localMusic.favoritePlaylist') : t('home.playlists'),
                isVirtual: playlist.isFavorite,
            };
        }).sort((left, right) => {
            if (left.isVirtual && !right.isVirtual) {
                return -1;
            }
            if (!left.isVirtual && right.isVirtual) {
                return 1;
            }
            return left.name.localeCompare(right.name);
        });

        return {
            groups: { folders: folderList, albums: albumList, artists: artistList, playlists: playlistList },
            coverSourceMap: sourceMap,
        };
    }, [localPlaylists, localSongs, resolvedAllSongsLabel, t]);

    const [groupCoverObjectUrls, setGroupCoverObjectUrls] = useState<Record<string, string>>({});
    useEffect(() => {
        const nextObjectUrls: Record<string, string> = {};
        const createdUrls: string[] = [];

        const allGroups = [
            ...groups.folders,
            ...groups.albums,
            ...groups.artists,
            ...groups.playlists,
        ];

        for (const group of allGroups) {
            const source = coverSourceMap.get(group.id);
            if (source instanceof Blob) {
                const url = URL.createObjectURL(source);
                nextObjectUrls[group.id] = url;
                createdUrls.push(url);
            }
        }

        setGroupCoverObjectUrls(nextObjectUrls);

        return () => {
            createdUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [groups, coverSourceMap]);

    const groupsWithCovers = useMemo(() => {
        const withCoverUrls = (items: LocalLibraryGroup[]) => items.map(group => {
            const source = coverSourceMap.get(group.id);
            const coverUrl = typeof source === 'string' ? source : groupCoverObjectUrls[group.id];

            return {
                ...group,
                coverUrl,
            };
        });

        return {
            folders: withCoverUrls(groups.folders),
            albums: withCoverUrls(groups.albums),
            artists: withCoverUrls(groups.artists),
            playlists: withCoverUrls(groups.playlists),
        };
    }, [coverSourceMap, groupCoverObjectUrls, groups]);

    const resolvedSelectedGroup = useMemo(() => {
        if (!selectedGroup) return null;

        const sourceGroups =
            selectedGroup.type === 'folder' ? groupsWithCovers.folders
                : selectedGroup.type === 'album' ? groupsWithCovers.albums
                    : selectedGroup.type === 'artist' ? groupsWithCovers.artists
                        : groupsWithCovers.playlists;
        const matchedGroup = sourceGroups.find(group =>
            (selectedGroup.id && group.id === selectedGroup.id) ||
            group.name === selectedGroup.name
        );

        if (matchedGroup) {
            return matchedGroup;
        }

        const fallbackSource = selectedGroup.id ? coverSourceMap.get(selectedGroup.id) : undefined;
        const fallbackCoverUrl = typeof fallbackSource === 'string'
            ? fallbackSource
            : (selectedGroup.id ? groupCoverObjectUrls[selectedGroup.id] : undefined) || selectedGroup.coverUrl;

        return {
            ...selectedGroup,
            coverUrl: fallbackCoverUrl
        };
    }, [coverSourceMap, groupCoverObjectUrls, groupsWithCovers, selectedGroup]);

    const handleFolderImport = async () => {
        if (isScanInProgress) {
            return;
        }

        setIsImporting(true);
        try {
            const importedSongs = await importFolder();
            if (importedSongs.length === 0) {
                console.log('[LocalMusic] Folder import cancelled or no audio files found; skipping notification.');
                return;
            }
            onRefresh();
        } catch (error) {
            console.error('Failed to import folder:', error);
            alert(t('localMusic.importNotSupported'));
        } finally {
            setIsImporting(false);
        }
    };

    const importButtonDisabled = isImporting || isScanInProgress;

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
        if (!selectedGroup || selectedGroup.type !== 'folder' || selectedGroup.isVirtual) return;

        try {
            // Re-import the selected folder and its nested children
            // Pass the folder name so we delete the whole tree on success
            const importedSongs = await resyncFolder(selectedGroup.name);

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

            onRefresh(); // Refresh the UI to show updated songs while keeping the current playlist view open
        } catch (error) {
            console.error('Failed to resync folder:', error);
            alert(t('localMusic.resyncFailed'));
        }
    };


    const handleDeleteFolder = async () => {
        if (!selectedGroup || selectedGroup.type !== 'folder' || selectedGroup.isVirtual) return;

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
            if (diff > 0 && activeRow < 3) setActiveRow((activeRow + 1) as 0 | 1 | 2 | 3);
            if (diff < 0 && activeRow > 0) setActiveRow((activeRow - 1) as 0 | 1 | 2 | 3);
        }
    };

    // Notify parent when playlist view opens/closes
    React.useEffect(() => {
        onPlaylistVisibilityChange?.(resolvedSelectedGroup !== null);
    }, [resolvedSelectedGroup, onPlaylistVisibilityChange]);

    if (resolvedSelectedGroup?.type === 'artist') {
        return (
            <LocalArtistView
                artistName={resolvedSelectedGroup.name}
                coverUrl={resolvedSelectedGroup.coverUrl}
                songs={resolvedSelectedGroup.songs}
                onBack={() => {
                    onPlaylistVisibilityChange?.(false);
                    onBackFromDetail?.();
                }}
                onPlaySong={onPlaySong}
                onAddToQueue={onAddToQueue}
                onSelectAlbum={onSelectAlbumGroup}
                theme={theme}
                isDaylight={isDaylight}
            />
        );
    }

    if (resolvedSelectedGroup) {
        return (
            <LocalPlaylistView
                title={resolvedSelectedGroup.name}
                coverUrl={resolvedSelectedGroup.coverUrl}
                songs={resolvedSelectedGroup.songs}
                onBack={() => {
                    onPlaylistVisibilityChange?.(false);
                    onBackFromDetail?.();
                }}
                onPlaySong={onPlaySong}
                onAddToQueue={onAddToQueue}
                isFolderView={resolvedSelectedGroup.type === 'folder'}
                allSongs={localSongs}
                onResync={resolvedSelectedGroup.type === 'folder' && !resolvedSelectedGroup.isVirtual ? handleResyncFolder : undefined}
                onDelete={resolvedSelectedGroup.type === 'folder' && !resolvedSelectedGroup.isVirtual ? handleDeleteFolder : undefined}
                onMatchSong={onMatchSong}
                onRefresh={onRefresh}
                playlistId={resolvedSelectedGroup.playlistId}
                isEditablePlaylist={resolvedSelectedGroup.type === 'playlist' && !resolvedSelectedGroup.isVirtual}
                onDeletePlaylist={resolvedSelectedGroup.type === 'playlist' && resolvedSelectedGroup.playlistId && !resolvedSelectedGroup.isVirtual
                    ? async () => {
                        await deleteLocalPlaylist(resolvedSelectedGroup.playlistId!);
                        await onRefresh();
                        onBackFromDetail?.();
                    }
                    : undefined}
                onRenamePlaylist={resolvedSelectedGroup.type === 'playlist' && resolvedSelectedGroup.playlistId && !resolvedSelectedGroup.isVirtual
                    ? async (playlistId, name) => {
                        await updateLocalPlaylist(playlistId, playlist => ({
                            ...playlist,
                            name: name.trim(),
                        }));
                        await onRefresh();
                    }
                    : undefined}
                onSelectArtist={onSelectArtistGroup}
                onSelectAlbum={onSelectAlbumGroup}
                theme={theme}
                isDaylight={isDaylight}
            />
        );
    }

    const sections = [
        {
            key: 'folders',
            row: 0 as const,
            label: t('localMusic.foldersAndPlaylists'),
            items: groupsWithCovers.folders,
            emptyMessage: t('localMusic.noFoldersFound'),
            focusedIndex: focusedFolderIndex,
            onFocusedIndexChange: setFocusedFolderIndex,
            withImport: true,
        },
        {
            key: 'albums',
            row: 1 as const,
            label: t('localMusic.albums'),
            items: groupsWithCovers.albums,
            emptyMessage: t('localMusic.noAlbumsFound'),
            focusedIndex: focusedAlbumIndex,
            onFocusedIndexChange: setFocusedAlbumIndex,
        },
        {
            key: 'artists',
            row: 2 as const,
            label: t('localMusic.artists'),
            items: groupsWithCovers.artists,
            emptyMessage: t('localMusic.noArtistsFound'),
            focusedIndex: focusedArtistIndex,
            onFocusedIndexChange: setFocusedArtistIndex,
        },
        {
            key: 'playlists',
            row: 3 as const,
            label: t('localMusic.customPlaylists'),
            items: groupsWithCovers.playlists,
            emptyMessage: t('localMusic.noPlaylistsFound'),
            focusedIndex: focusedPlaylistIndex,
            onFocusedIndexChange: setFocusedPlaylistIndex,
        },
    ];

    const activeSection = sections.find(section => section.row === activeRow) ?? sections[0];

    return (
        <div
            className="w-full h-full flex flex-col p-0 relative"
            // onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-2 z-10">
                {/* Placeholder for future header content */}
            </div>

            {/* Dashboard Content */}
            {needsPermission && (
                <div className={`w-fit mx-auto mb-4 p-2 px-4 rounded-full flex items-center gap-6 z-10 shrink-0 backdrop-blur-md shadow-lg ${isDaylight ? 'bg-black/5 border border-black/10 text-zinc-700' : 'bg-white/5 border border-white/10 text-zinc-300'}`}>
                    <div className="flex items-center gap-2">
                        <FolderOpen size={16} className="opacity-70" />
                        <span className="text-sm font-medium">{t('localMusic.permissionNeeded')}</span>
                    </div>
                    <button onClick={handleRestorePermissions} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all active:scale-95 ${isDaylight ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                        {t('localMusic.grantPermission')}
                    </button>
                </div>
            )}

            <div className="flex-1 min-h-0 relative">
                {localSongs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full opacity-50">
                        <Music size={64} className="mb-4" />
                        <p className="text-lg">{t('localMusic.noLocalMusic')}</p>
                        <button
                            onClick={handleFolderImport}
                            disabled={importButtonDisabled}
                            className={`px-6 py-3 rounded-lg transition-colors text-sm mt-4 flex items-center gap-2 ${
                                importButtonDisabled
                                    ? 'bg-white/5 text-white/50 cursor-not-allowed'
                                    : 'bg-white/10 hover:bg-white/20'
                            }`}
                        >
                            {isImporting || isScanInProgress ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {isScanInProgress ? '扫描中' : t('localMusic.importing')}
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
                    <div className="w-full h-full min-h-0 relative">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeSection.key}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.3 }}
                                className="w-full h-full min-h-0 flex flex-col justify-center"
                            >
                                <div className="flex shrink-0 items-center justify-center gap-2 mb-3 flex-wrap">
                                    {sections.map(section => (
                                        <button
                                            key={section.key}
                                            onClick={() => setActiveRow(section.row)}
                                            className={`px-3 py-1.5 rounded-full text-sm font-medium uppercase tracking-widest transition-all ${activeSection.row === section.row ? 'bg-white/10 opacity-100' : 'opacity-40 hover:opacity-80'}`}
                                        >
                                            {section.label}
                                        </button>
                                    ))}

                                    {activeSection.withImport && (
                                        <button
                                            onClick={handleFolderImport}
                                            className={`p-1.5 rounded-full transition-colors ${
                                                importButtonDisabled
                                                    ? 'bg-white/5 text-white/45 cursor-not-allowed'
                                                    : 'bg-white/10 hover:bg-white/20'
                                            }`}
                                            disabled={importButtonDisabled}
                                            title={isScanInProgress ? '正在扫描媒体库' : 'Import Folder'}
                                        >
                                            {importButtonDisabled ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                                        </button>
                                    )}
                                </div>
                                <div className="w-full flex-[0_1_clamp(460px,40vh,760px)] min-h-0 max-h-[clamp(460px,40vh,760px)]">
                                    <Carousel3D
                                        items={activeSection.items}
                                        onSelect={(item) => setSelectedGroup(item)}
                                        emptyMessage={activeSection.emptyMessage}
                                        initialFocusedIndex={activeSection.focusedIndex}
                                        onFocusedIndexChange={activeSection.onFocusedIndexChange}
                                        isDaylight={isDaylight}
                                        compactLayout
                                        hasFloatingPlayer={hasFloatingPlayer}
                                    />
                                </div>
                            </motion.div>
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
