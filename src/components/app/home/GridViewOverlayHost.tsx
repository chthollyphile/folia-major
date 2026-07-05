import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import LegacyHome from '../../Home';
import GridView, { GridViewSourceActions } from '../../GridView';
import ArtistGridView from '../../ArtistGridView';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { LocalSong, SongResult, UnifiedSong } from '../../../types';
import { NavidromeSong } from '../../../types/navidrome';
import { resolveNavidromePlaybackCarrier } from '../../../utils/appPlaybackGuards';
import { deleteFolderSongs, resyncFolder } from '../../../services/localMusicService';
import { deleteLocalPlaylist, removeSongsFromLocalPlaylist, updateLocalPlaylist } from '../../../services/localPlaylistService';
import { getNavidromeConfig, navidromeApi } from '../../../services/navidromeService';
import { getBlobObjectUrlSignature, isBlob } from '../../../utils/blobGuards';
import {
    GridViewCollectionDescriptor,
    LocalGridViewCollectionDescriptor,
    isLocalGridViewCollection,
    isNavidromeGridViewCollection,
    resolveLocalGridViewTracks,
    resolveNavidromeGridViewTracks,
} from './gridViewCollectionAdapters';

// src/components/app/home/GridViewOverlayHost.tsx
// Hosts the GridView overlay outside Grid3D so it can be opened/restored independently.

type LegacyHomeProps = React.ComponentProps<typeof LegacyHome>;

type GridViewOverlayHostProps = {
    legacyProps: LegacyHomeProps;
    children: (openGridView: (collection: GridViewCollectionDescriptor) => void) => React.ReactNode;
};

type StoredGridViewCollection = {
    collection: GridViewCollectionDescriptor;
    homeViewTab: string;
};

type LocalTrackCoverObjectUrlEntry = {
    signature: string;
    url: string;
};

export const GRID_VIEW_ACTIVE_COLLECTION_KEY = 'folia_gridview_active_collection';

const getPersistentCoverUrl = (url?: string) => (
    url && !url.startsWith('blob:') ? url : undefined
);

const withLocalTrackCoverUrl = (track: UnifiedSong, coverUrl: string): UnifiedSong => ({
    ...track,
    al: track.al ? { ...track.al, picUrl: coverUrl } : { id: 0, name: '', picUrl: coverUrl },
    album: track.album ? { ...track.album, picUrl: coverUrl } : { id: 0, name: '', picUrl: coverUrl },
});

const getLocalTrackCoverObjectUrlSignature = (song: LocalSong): string | null => {
    if (!isBlob(song.embeddedCover)) {
        return null;
    }

    return getBlobObjectUrlSignature(song.embeddedCover, [
        song.id,
        song.fileSignature || '',
        song.fileSize,
        song.fileLastModified || 0,
    ]);
};

const resolveLocalCollectionCoverUrlFromTracks = (
    tracks: UnifiedSong[],
    getLocalCoverObjectUrl: (song: LocalSong) => string | undefined
): string | undefined => {
    const songs = tracks
        .map(track => track.localData)
        .filter((song): song is LocalSong => Boolean(song))
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = songs.find(song => {
        const hasEmbeddedCover = isBlob(song.embeddedCover);
        if (song.useOnlineCover) {
            return song.matchedCoverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.matchedCoverUrl;
    });

    if (!preferredSong) {
        return undefined;
    }

    if (preferredSong.useOnlineCover && preferredSong.matchedCoverUrl) {
        return preferredSong.matchedCoverUrl;
    }

    if (isBlob(preferredSong.embeddedCover)) {
        return getLocalCoverObjectUrl(preferredSong);
    }

    return preferredSong.matchedCoverUrl;
};

const resolveLiveLocalCollection = (
    collection: LocalGridViewCollectionDescriptor,
    legacyProps: LegacyHomeProps
): LocalGridViewCollectionDescriptor | null => {
    if (!collection.playlistId) {
        return collection;
    }

    const playlist = legacyProps.localPlaylists.find(item => item.id === collection.playlistId);
    if (!playlist) {
        return null;
    }

    const validSongIds = new Set(legacyProps.localSongs.map(song => song.id));
    const songIds = playlist.songIds.filter(songId => validSongIds.has(songId));

    return {
        ...collection,
        name: playlist.name,
        songIds,
        trackCount: songIds.length,
        isVirtual: playlist.isFavorite,
    };
};

const GridViewOverlayHost: React.FC<GridViewOverlayHostProps> = ({ legacyProps, children }) => {
    const activeGridViewCollection = useSettingsUiStore(state => state.activeGridViewCollection);
    const setActiveGridViewCollection = useSettingsUiStore(state => state.setActiveGridViewCollection);
    const isDaylight = useSettingsUiStore(state => state.isDaylight);
    const onBackToPlayer = legacyProps.onBackToPlayer;
    const { homeViewTab, setHomeViewTab } = useSearchNavigationStore(useShallow(state => ({
        homeViewTab: state.homeViewTab,
        setHomeViewTab: state.setHomeViewTab,
    })));
    const [collectionHistory, setCollectionHistory] = useState<GridViewCollectionDescriptor[]>(() => (
        activeGridViewCollection ? [activeGridViewCollection] : []
    ));
    const selectedCollection = collectionHistory[collectionHistory.length - 1] || null;
    const [externalTracks, setExternalTracks] = useState<SongResult[] | undefined>(undefined);
    const [externalTracksLoading, setExternalTracksLoading] = useState(false);
    const [resolvedLocalCollectionCoverUrl, setResolvedLocalCollectionCoverUrl] = useState<string | undefined>(undefined);
    const [navidromePlaylistItems, setNavidromePlaylistItems] = useState<Array<{ id: string | number; name: string; description?: string; }>>([]);
    const localTrackCoverObjectUrlsRef = useRef(new Map<string, LocalTrackCoverObjectUrlEntry>());
    const selectedCollectionKey = selectedCollection
        ? `${selectedCollection.source}:${selectedCollection.type}:${String(selectedCollection.id)}`
        : '';
    const liveSelectedCollection = useMemo(() => {
        if (!selectedCollection || !isLocalGridViewCollection(selectedCollection)) {
            return selectedCollection;
        }

        return resolveLiveLocalCollection(selectedCollection, legacyProps);
    }, [legacyProps.localPlaylists, legacyProps.localSongs, selectedCollection]);
    const displaySelectedCollection = useMemo(() => {
        if (!liveSelectedCollection) {
            return null;
        }

        if (!isLocalGridViewCollection(liveSelectedCollection)) {
            return liveSelectedCollection;
        }

        const coverUrl = resolvedLocalCollectionCoverUrl
            || getPersistentCoverUrl(liveSelectedCollection.coverUrl)
            || getPersistentCoverUrl(liveSelectedCollection.coverImgUrl)
            || getPersistentCoverUrl(liveSelectedCollection.picUrl);

        return {
            ...liveSelectedCollection,
            coverUrl,
            coverImgUrl: coverUrl,
            picUrl: coverUrl,
        };
    }, [liveSelectedCollection, resolvedLocalCollectionCoverUrl]);

    const clearLocalTrackCoverObjectUrls = useCallback(() => {
        localTrackCoverObjectUrlsRef.current.forEach(entry => URL.revokeObjectURL(entry.url));
        localTrackCoverObjectUrlsRef.current.clear();
    }, []);

    const pruneLocalTrackCoverObjectUrls = useCallback((activeSongIds: Set<string>) => {
        localTrackCoverObjectUrlsRef.current.forEach((entry, songId) => {
            if (!activeSongIds.has(songId)) {
                URL.revokeObjectURL(entry.url);
                localTrackCoverObjectUrlsRef.current.delete(songId);
            }
        });
    }, []);

    const getOrCreateLocalTrackCoverObjectUrl = useCallback((song: LocalSong) => {
        const signature = getLocalTrackCoverObjectUrlSignature(song);
        if (!signature || !isBlob(song.embeddedCover)) {
            return undefined;
        }

        const cached = localTrackCoverObjectUrlsRef.current.get(song.id);
        if (cached?.signature === signature) {
            return cached.url;
        }

        if (cached) {
            URL.revokeObjectURL(cached.url);
        }

        const url = URL.createObjectURL(song.embeddedCover);
        localTrackCoverObjectUrlsRef.current.set(song.id, { signature, url });
        return url;
    }, []);

    useEffect(() => clearLocalTrackCoverObjectUrls, [clearLocalTrackCoverObjectUrls]);

    useEffect(() => {
        if (collectionHistory.length > 0) return;

        try {
            const saved = sessionStorage.getItem(GRID_VIEW_ACTIVE_COLLECTION_KEY);
            if (!saved) return;

            const parsed = JSON.parse(saved) as StoredGridViewCollection;
            if (parsed?.collection?.id === undefined || parsed.collection.id === null || !parsed.collection.name) return;

            setCollectionHistory([parsed.collection]);
            setActiveGridViewCollection(parsed.collection);
            if (parsed.homeViewTab) {
                setHomeViewTab(parsed.homeViewTab as any);
            }
        } catch {
            sessionStorage.removeItem(GRID_VIEW_ACTIVE_COLLECTION_KEY);
        }
    }, [collectionHistory.length, setHomeViewTab, setActiveGridViewCollection]);

    useEffect(() => {
        if (activeGridViewCollection) {
            const currentTop = collectionHistory[collectionHistory.length - 1];
            if (currentTop?.id === activeGridViewCollection.id && currentTop?.source === activeGridViewCollection.source) {
                return;
            }
            setCollectionHistory([activeGridViewCollection]);
            sessionStorage.setItem(
                GRID_VIEW_ACTIVE_COLLECTION_KEY,
                JSON.stringify({ collection: activeGridViewCollection, homeViewTab })
            );
        } else {
            setCollectionHistory([]);
            sessionStorage.removeItem(GRID_VIEW_ACTIVE_COLLECTION_KEY);
        }
    }, [activeGridViewCollection, homeViewTab]);

    const openGridView = useCallback((collection: GridViewCollectionDescriptor) => {
        setCollectionHistory([collection]);
        setActiveGridViewCollection(collection);
        sessionStorage.setItem(
            GRID_VIEW_ACTIVE_COLLECTION_KEY,
            JSON.stringify({ collection, homeViewTab })
        );
    }, [homeViewTab, setActiveGridViewCollection]);

    const closeGridView = useCallback(() => {
        const shouldReturnToPlayer = Boolean(selectedCollection?.returnToPlayerOnClose);
        sessionStorage.removeItem(GRID_VIEW_ACTIVE_COLLECTION_KEY);
        setCollectionHistory([]);
        setActiveGridViewCollection(null);
        if (shouldReturnToPlayer) {
            onBackToPlayer();
        }
    }, [onBackToPlayer, selectedCollection?.returnToPlayerOnClose, setActiveGridViewCollection]);

    const handlePushCollection = useCallback((col: GridViewCollectionDescriptor) => {
        setCollectionHistory(prev => [...prev, col]);
        setActiveGridViewCollection(col);
        sessionStorage.setItem(
            GRID_VIEW_ACTIVE_COLLECTION_KEY,
            JSON.stringify({ collection: col, homeViewTab })
        );
    }, [homeViewTab, setActiveGridViewCollection]);

    const handleBackCollection = useCallback(() => {
        if (collectionHistory.length > 1) {
            const nextHistory = collectionHistory.slice(0, -1);
            setCollectionHistory(nextHistory);
            const newTop = nextHistory[nextHistory.length - 1];
            setActiveGridViewCollection(newTop);
            sessionStorage.setItem(
                GRID_VIEW_ACTIVE_COLLECTION_KEY,
                JSON.stringify({ collection: newTop, homeViewTab })
            );
        } else {
            closeGridView();
        }
    }, [collectionHistory, closeGridView, homeViewTab, setActiveGridViewCollection]);

    const handlePushAlbumCollection = useCallback((albumId: number | string, album?: any) => {
        if (!selectedCollection) return;

        const source = selectedCollection.source;
        const albumName = album?.name || '专辑';
        const albumCoverUrl = album?.coverImgUrl || album?.coverUrl || album?.picUrl;
        if (source === 'netease') {
            handlePushCollection({
                source: 'netease',
                id: Number(albumId),
                name: albumName,
                type: 'album',
                coverImgUrl: albumCoverUrl,
                coverUrl: albumCoverUrl,
                picUrl: albumCoverUrl,
            });
        } else if (source === 'navidrome') {
            handlePushCollection({
                source: 'navidrome',
                id: String(albumId),
                name: albumName,
                type: 'album',
                coverImgUrl: albumCoverUrl,
                coverUrl: albumCoverUrl,
                picUrl: albumCoverUrl,
            });
        } else if (source === 'local') {
            const localAlbumName = album?.name || String(albumId);
            const localCoverUrl = albumCoverUrl;
            const albumSongs = legacyProps.localSongs.filter(song => (song.album || '').toLowerCase() === localAlbumName.toLowerCase());
            handlePushCollection({
                source: 'local',
                id: localAlbumName,
                name: localAlbumName,
                type: 'album',
                coverImgUrl: localCoverUrl,
                coverUrl: localCoverUrl,
                picUrl: localCoverUrl,
                songIds: albumSongs.map(song => song.id),
            });
        }
    }, [handlePushCollection, legacyProps.localSongs, selectedCollection]);

    useEffect(() => {
        if (!selectedCollection) {
            setExternalTracks(undefined);
            setExternalTracksLoading(false);
            setResolvedLocalCollectionCoverUrl(undefined);
            setNavidromePlaylistItems([]);
            clearLocalTrackCoverObjectUrls();
            return;
        }

        if (selectedCollection.source === 'netease') {
            setExternalTracks(undefined);
            setExternalTracksLoading(false);
            setResolvedLocalCollectionCoverUrl(undefined);
            setNavidromePlaylistItems([]);
            clearLocalTrackCoverObjectUrls();
        }
    }, [clearLocalTrackCoverObjectUrls, selectedCollectionKey]);

    useEffect(() => {
        if (!selectedCollection || !isLocalGridViewCollection(selectedCollection)) {
            return;
        }

        if (!liveSelectedCollection || !isLocalGridViewCollection(liveSelectedCollection)) {
            closeGridView();
            return;
        }

        const resolvedTracks = resolveLocalGridViewTracks(liveSelectedCollection, legacyProps.localSongs) as UnifiedSong[];
        if (liveSelectedCollection.songIds.length > 0 && resolvedTracks.length === 0) {
            closeGridView();
            return;
        }

        setNavidromePlaylistItems([]);
        setResolvedLocalCollectionCoverUrl(resolveLocalCollectionCoverUrlFromTracks(
            resolvedTracks,
            getOrCreateLocalTrackCoverObjectUrl
        ));

        const activeTrackCoverSongIds = new Set<string>();
        const processedTracks = resolvedTracks.map(track => {
            const localData = track.localData;
            if (!localData) return track;

            const preferOnlineCover = localData.useOnlineCover === true;
            if (preferOnlineCover && localData.matchedCoverUrl) {
                return track;
            }

            if (isBlob(localData.embeddedCover)) {
                const url = getOrCreateLocalTrackCoverObjectUrl(localData);
                if (url) {
                    activeTrackCoverSongIds.add(localData.id);
                    return withLocalTrackCoverUrl(track, url);
                }
            }

            return track;
        });
        pruneLocalTrackCoverObjectUrls(activeTrackCoverSongIds);

        setExternalTracks(processedTracks);
        setExternalTracksLoading(false);
    }, [
        closeGridView,
        getOrCreateLocalTrackCoverObjectUrl,
        legacyProps.localSongs,
        liveSelectedCollection,
        pruneLocalTrackCoverObjectUrls,
        selectedCollection,
    ]);

    useEffect(() => {
        if (!selectedCollection || !isNavidromeGridViewCollection(selectedCollection)) {
            return;
        }

        let cancelled = false;
        setExternalTracks([]);
        setExternalTracksLoading(true);
        setResolvedLocalCollectionCoverUrl(undefined);
        clearLocalTrackCoverObjectUrls();

        resolveNavidromeGridViewTracks(selectedCollection)
            .then((tracks) => {
                if (!cancelled) {
                    setExternalTracks(tracks);
                }
            })
            .catch((error) => {
                console.error('[GridViewOverlayHost] Failed to load Navidrome GridView tracks:', error);
                if (!cancelled) {
                    setExternalTracks([]);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setExternalTracksLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        clearLocalTrackCoverObjectUrls,
        selectedCollection,
    ]);

    const refreshNavidromePlaylists = useCallback(async () => {
        const config = getNavidromeConfig();
        if (!config) {
            setNavidromePlaylistItems([]);
            return;
        }

        const playlists = await navidromeApi.getPlaylists(config);
        setNavidromePlaylistItems(playlists.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            description: playlist.owner,
        })));
    }, []);

    useEffect(() => {
        if (selectedCollection && isNavidromeGridViewCollection(selectedCollection)) {
            void refreshNavidromePlaylists();
        }
    }, [refreshNavidromePlaylists, selectedCollection]);

    const handleSelectTrack = useCallback((track: SongResult, queue: SongResult[]) => {
        const unifiedTrack = track as UnifiedSong;
        if (unifiedTrack.isNavidrome) {
            const naviSong = resolveNavidromePlaybackCarrier(unifiedTrack);
            if (naviSong) {
                const naviQueue = queue
                    .map(t => resolveNavidromePlaybackCarrier(t))
                    .filter((t): t is NavidromeSong => Boolean(t));
                legacyProps.onPlayNavidromeSong?.(naviSong, naviQueue);
                return;
            }
        }
        if (unifiedTrack.isLocal && unifiedTrack.localData) {
            const localQueue = queue
                .map(t => (t as UnifiedSong).localData)
                .filter((song): song is LocalSong => Boolean(song));
            legacyProps.onPlayLocalSong?.(unifiedTrack.localData, localQueue);
            return;
        }
        legacyProps.onPlaySong(track, queue);
    }, [legacyProps]);

    const handleAddTrackToQueue = useCallback((track: SongResult) => {
        const unifiedTrack = track as UnifiedSong;
        if (unifiedTrack.isLocal && unifiedTrack.localData) {
            legacyProps.onAddLocalSongToQueue?.(unifiedTrack.localData);
            return;
        }
        if (unifiedTrack.isNavidrome) {
            const naviSong = resolveNavidromePlaybackCarrier(unifiedTrack);
            if (naviSong) {
                legacyProps.onAddNavidromeSongsToQueue?.([naviSong]);
                return;
            }
        }
        legacyProps.onAddSongToQueue?.(track);
    }, [legacyProps]);

    const sourceActions = useMemo<GridViewSourceActions>(() => ({
        local: {
            onRefresh: legacyProps.onRefreshLocalSongs,
            onResyncFolder: async (collection) => {
                const importedSongs = await resyncFolder(collection.name);
                if (importedSongs !== null) {
                    legacyProps.onRefreshLocalSongs();
                }
            },
            onDeleteFolder: async (collection) => {
                await deleteFolderSongs(collection.name);
                legacyProps.onRefreshLocalSongs();
            },
            onRenamePlaylist: async (playlistId, name) => {
                await updateLocalPlaylist(playlistId, playlist => ({
                    ...playlist,
                    name: name.trim(),
                }));
                legacyProps.onRefreshLocalSongs();
            },
            onDeletePlaylist: async (playlistId) => {
                await deleteLocalPlaylist(playlistId);
                legacyProps.onRefreshLocalSongs();
            },
            onRemovePlaylistSongs: async (playlistId, songIds) => {
                await removeSongsFromLocalPlaylist(playlistId, songIds);
                legacyProps.onRefreshLocalSongs();
            },
        },
        navidrome: {
            availablePlaylists: navidromePlaylistItems,
            onAddToPlaylist: async (playlistId, songs) => {
                const config = getNavidromeConfig();
                if (!config) return;

                await navidromeApi.updatePlaylist(config, String(playlistId), {
                    songIdsToAdd: songs
                        .map(song => (song as UnifiedSong).navidromeData?.id)
                        .filter((id): id is string => Boolean(id)),
                });
                await refreshNavidromePlaylists();
            },
            onCreatePlaylist: async (name, songs) => {
                const config = getNavidromeConfig();
                if (!config) return;

                await navidromeApi.createPlaylist(
                    config,
                    name,
                    songs
                        .map(song => (song as UnifiedSong).navidromeData?.id)
                        .filter((id): id is string => Boolean(id))
                );
                await refreshNavidromePlaylists();
            },
            onRenamePlaylist: async (playlistId, name) => {
                const config = getNavidromeConfig();
                if (!config) return;

                await navidromeApi.updatePlaylist(config, playlistId, { name });
                await refreshNavidromePlaylists();
            },
            onDeletePlaylist: async (playlistId) => {
                const config = getNavidromeConfig();
                if (!config) return;

                await navidromeApi.deletePlaylist(config, playlistId);
                await refreshNavidromePlaylists();
            },
            onRemovePlaylistSongs: async (playlistId, songIndexes) => {
                const config = getNavidromeConfig();
                if (!config) return;

                await navidromeApi.updatePlaylist(config, playlistId, {
                    songIndexesToRemove: songIndexes,
                });
            },
        },
    }), [legacyProps, navidromePlaylistItems, refreshNavidromePlaylists]);

    return (
        <>
            {children(openGridView)}
            <AnimatePresence initial={false}>
                {selectedCollection && (
                    <motion.div
                        key="grid-transition-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="fixed inset-0 z-[49] pointer-events-none"
                        style={{ backgroundColor: 'var(--bg-color)' }}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
                {displaySelectedCollection && (
                    displaySelectedCollection.type === 'artist' ? (
                        <ArtistGridView
                            key={selectedCollectionKey}
                            collection={displaySelectedCollection}
                            onBack={handleBackCollection}
                            onSelectTrack={handleSelectTrack}
                            onAddTrackToQueue={handleAddTrackToQueue}
                            onPlayAll={legacyProps.onPlayAll}
                            onAddAllToQueue={legacyProps.onAddAllToQueue}
                            onSelectAlbum={handlePushAlbumCollection}
                            theme={legacyProps.theme}
                            isDaylight={isDaylight}
                            localSongs={legacyProps.localSongs}
                        />
                    ) : (
                        <GridView
                            key={selectedCollectionKey}
                            title={displaySelectedCollection.name}
                            subtitle={(displaySelectedCollection as any).creator?.nickname || (displaySelectedCollection as any).artists?.[0]?.name || displaySelectedCollection.description || ''}
                            collection={displaySelectedCollection}
                            mode="tracks"
                            onBack={handleBackCollection}
                            onSelectTrack={handleSelectTrack}
                            onAddTrackToQueue={handleAddTrackToQueue}
                            onPlayAll={legacyProps.onPlayAll}
                            onAddAllToQueue={legacyProps.onAddAllToQueue}
                            onSelectAlbum={handlePushAlbumCollection}
                            onSelectArtist={(artistId) => {
                                const source = selectedCollection.source;
                                if (source === 'netease') {
                                    handlePushCollection({
                                        source: 'netease',
                                        id: Number(artistId),
                                        name: '歌手',
                                        type: 'artist',
                                    });
                                } else if (source === 'navidrome') {
                                    handlePushCollection({
                                        source: 'navidrome',
                                        id: String(artistId),
                                        name: '歌手',
                                        type: 'artist',
                                    });
                                } else if (source === 'local') {
                                    const artistSongs = legacyProps.localSongs.filter(song => (song.matchedArtists || song.artist || '').toLowerCase() === String(artistId).toLowerCase());
                                    handlePushCollection({
                                        source: 'local',
                                        id: String(artistId),
                                        name: String(artistId),
                                        type: 'artist',
                                        songIds: artistSongs.map(song => song.id),
                                    });
                                }
                            }}
                            currentUserId={legacyProps.user?.userId}
                            onPlaylistMutated={legacyProps.onRefreshUser}
                            externalTracks={externalTracks}
                            externalTracksLoading={externalTracksLoading}
                            sourceActions={sourceActions}
                            theme={legacyProps.theme}
                            isDaylight={isDaylight}
                        />
                    )
                )}
            </AnimatePresence>
        </>
    );
};

export default GridViewOverlayHost;
