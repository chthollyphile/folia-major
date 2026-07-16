import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import LegacyHome from '../../Home';
import GridView, { GridViewSourceActions } from '../../GridView';
import ArtistGridView from '../../ArtistGridView';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { getActiveGridViewCollection, useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { LocalSong, SongResult, UnifiedSong } from '../../../types';
import { resolveNavidromePlaybackCarrier } from '../../../utils/appPlaybackGuards';
import { deleteFolderSongs, resyncAllFolders, resyncFolder } from '../../../services/localMusicService';
import { deleteLocalPlaylist, removeSongsFromLocalPlaylist, updateLocalPlaylist } from '../../../services/localPlaylistService';
import { getNavidromeConfig, navidromeApi } from '../../../services/navidromeService';
import { createSafeObjectUrl, getBlobObjectUrlSignature, isBlob } from '../../../utils/blobGuards';
import {
    GridViewCollectionDescriptor,
    LocalGridViewCollectionDescriptor,
    isLocalGridViewCollection,
    isNavidromeGridViewCollection,
    refreshLocalGridViewCollection,
    resolveLocalAlbumArtistDisplay,
    resolveLocalGridViewTracks,
    resolveNavidromeGridViewTracks,
} from './gridViewCollectionAdapters';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import { LocalLibraryEntityPanel } from '../../modal/LocalLibraryEntityPanel';
import { LocalFolderSongInfoPanel } from '../../modal/LocalFolderSongInfoPanel';
import { LocalSongMetadataMatchDialog } from '../../modal/LocalSongMetadataMatchDialog';
import { buildLocalLibraryIndex, followEntityRedirect } from '../../../utils/localLibraryIndex';
import { applyLocalSongCoverDisplay } from '../../../services/playbackAdapters';

// src/components/app/home/GridViewOverlayHost.tsx
// Hosts the GridView overlay outside Grid3D so it can be opened/restored independently.

type LegacyHomeProps = React.ComponentProps<typeof LegacyHome>;

type GridViewOverlayHostProps = {
    legacyProps: LegacyHomeProps;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    onBackCollection: () => void;
    children: (openGridView: (collection: GridViewCollectionDescriptor) => void) => React.ReactNode;
};

type LocalTrackCoverObjectUrlEntry = {
    signature: string;
    url: string;
};

const getPersistentCoverUrl = (url?: string) => (
    url && !url.startsWith('blob:') ? url : undefined
);

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
    localSongs: LocalSong[],
    getLocalCoverObjectUrl: (song: LocalSong) => string | undefined
): string | undefined => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const songs = tracks
        .map(track => track.localRef ? songsById.get(track.localRef.songId) : undefined)
        .filter((song): song is LocalSong => Boolean(song))
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = songs.find(song => {
        const hasEmbeddedCover = isBlob(song.embeddedCover);
        if (song.useOnlineCover) {
            return song.onlineMetadata?.coverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.onlineMetadata?.coverUrl;
    });

    if (!preferredSong) {
        return undefined;
    }

    if (preferredSong.useOnlineCover && preferredSong.onlineMetadata?.coverUrl) {
        return preferredSong.onlineMetadata.coverUrl;
    }

    if (isBlob(preferredSong.embeddedCover)) {
        return getLocalCoverObjectUrl(preferredSong);
    }

    return preferredSong.onlineMetadata?.coverUrl;
};

const resolveLiveLocalCollection = (
    collection: LocalGridViewCollectionDescriptor,
    legacyProps: LegacyHomeProps,
    catalog: LocalLibraryCatalogSnapshot,
): LocalGridViewCollectionDescriptor | null => {
    if (!collection.playlistId) {
        return refreshLocalGridViewCollection(
            collection,
            legacyProps.localSongs,
            catalog.ready ? catalog : undefined,
        );
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

const GridViewOverlayHost: React.FC<GridViewOverlayHostProps> = ({
    legacyProps,
    onOpenCollection,
    onPushCollection,
    onBackCollection,
    children,
}) => {
    const collectionSnapshot = useCollectionNavigationStore(state => state.snapshot);
    const isDaylight = useSettingsUiStore(state => state.isDaylight);
    const localLibraryCatalog = legacyProps.localLibraryCatalog;
    const selectedCollection = getActiveGridViewCollection(collectionSnapshot);
    const [externalTracks, setExternalTracks] = useState<SongResult[] | undefined>(undefined);
    const [externalTracksLoading, setExternalTracksLoading] = useState(false);
    const [resolvedLocalCollectionCoverUrl, setResolvedLocalCollectionCoverUrl] = useState<string | undefined>(undefined);
    const [navidromePlaylistItems, setNavidromePlaylistItems] = useState<Array<{ id: string | number; name: string; description?: string; }>>([]);
    const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
    const [organizingFolder, setOrganizingFolder] = useState<LocalGridViewCollectionDescriptor | null>(null);
    const [matchingSongId, setMatchingSongId] = useState<string | null>(null);
    const localTrackCoverObjectUrlsRef = useRef(new Map<string, LocalTrackCoverObjectUrlEntry>());
    const selectedCollectionKey = selectedCollection
        ? `${selectedCollection.source}:${selectedCollection.type}:${String(selectedCollection.id)}`
        : '';
    const liveSelectedCollection = useMemo(() => {
        if (!selectedCollection || !isLocalGridViewCollection(selectedCollection)) {
            return selectedCollection;
        }

        return resolveLiveLocalCollection(selectedCollection, legacyProps, localLibraryCatalog);
    }, [legacyProps.localPlaylists, legacyProps.localSongs, localLibraryCatalog, selectedCollection]);
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

        const url = createSafeObjectUrl(song.embeddedCover);
        if (!url) return undefined;
        localTrackCoverObjectUrlsRef.current.set(song.id, { signature, url });
        return url;
    }, []);

    useEffect(() => clearLocalTrackCoverObjectUrls, [clearLocalTrackCoverObjectUrls]);

    const openGridView = useCallback((collection: GridViewCollectionDescriptor) => {
        onOpenCollection(collection);
    }, [onOpenCollection]);

    const handlePushCollection = useCallback((col: GridViewCollectionDescriptor) => {
        onPushCollection(col);
    }, [onPushCollection]);

    const handleBackCollection = useCallback(() => {
        onBackCollection();
    }, [onBackCollection]);

    useEffect(() => {
        if (
            localLibraryCatalog.ready &&
            selectedCollection &&
            isLocalGridViewCollection(selectedCollection) &&
            selectedCollection.entityId &&
            liveSelectedCollection &&
            isLocalGridViewCollection(liveSelectedCollection) &&
            liveSelectedCollection.trackCount === 0
        ) {
            handleBackCollection();
        }
    }, [handleBackCollection, liveSelectedCollection, localLibraryCatalog.ready, selectedCollection]);

    const handlePushAlbumCollection = useCallback((albumId: number | string, album?: any) => {
        if (!selectedCollection) return;

        const source = selectedCollection.source;
        const albumName = album?.name || '';
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
            const catalogIndex = buildLocalLibraryIndex(
                localLibraryCatalog.entities,
                localLibraryCatalog.assignments,
            );
            const activeEntityId = followEntityRedirect(String(albumId), catalogIndex.entitiesById);
            const localAlbumEntity = activeEntityId
                ? catalogIndex.entitiesById.get(activeEntityId)
                : localLibraryCatalog.entities.find(entity => (
                    entity.kind === 'album' && !entity.mergedInto && entity.displayName === album?.name
                ));
            if (localAlbumEntity?.kind !== 'album') return;
            const selectedAlbumSourceId = selectedCollection.entityId
                || (selectedCollection.type === 'album' ? String(selectedCollection.id) : undefined);
            const selectedAlbumEntityId = selectedAlbumSourceId
                ? followEntityRedirect(selectedAlbumSourceId, catalogIndex.entitiesById)
                : undefined;
            if (selectedCollection.type === 'album' && selectedAlbumEntityId === localAlbumEntity.id) {
                return;
            }
            const localAlbumName = localAlbumEntity.displayName;
            const localCoverUrl = albumCoverUrl;
            const memberIds = new Set(localLibraryCatalog.assignments
                .filter(assignment => assignment.albumEntityId && (
                    followEntityRedirect(assignment.albumEntityId, catalogIndex.entitiesById) === localAlbumEntity.id
                ))
                .map(assignment => assignment.songId));
            const albumSongs = legacyProps.localSongs.filter(song => memberIds.has(song.id));
            const albumArtist = resolveLocalAlbumArtistDisplay(
                albumSongs.map(song => song.id),
                localLibraryCatalog,
            );
            handlePushCollection({
                source: 'local',
                id: localAlbumEntity.id,
                entityId: localAlbumEntity.id,
                name: localAlbumName,
                type: 'album',
                coverImgUrl: localCoverUrl,
                coverUrl: localCoverUrl,
                picUrl: localCoverUrl,
                description: albumArtist,
                albumArtist,
                songIds: albumSongs.map(song => song.id),
            });
        }
    }, [handlePushCollection, legacyProps.localSongs, localLibraryCatalog, selectedCollection]);

    const handlePushArtistCollection = useCallback((artistId: number | string, artist?: any) => {
        if (!selectedCollection) return;

        const source = selectedCollection.source;
        const artistName = artist?.name || String(artistId);
        if (source === 'netease') {
            handlePushCollection({
                source: 'netease',
                id: Number(artistId),
                name: artistName,
                type: 'artist',
            });
            return;
        }
        if (source === 'navidrome') {
            handlePushCollection({
                source: 'navidrome',
                id: String(artistId),
                name: artistName,
                type: 'artist',
            });
            return;
        }

        const catalogIndex = buildLocalLibraryIndex(
            localLibraryCatalog.entities,
            localLibraryCatalog.assignments,
        );
        const activeEntityId = followEntityRedirect(String(artistId), catalogIndex.entitiesById);
        const artistEntity = activeEntityId
            ? catalogIndex.entitiesById.get(activeEntityId)
            : localLibraryCatalog.entities.find(entity => (
                entity.kind === 'artist' && !entity.mergedInto && entity.displayName === artistName
            ));
        if (!artistEntity) return;
        const memberIds = new Set(localLibraryCatalog.assignments
            .filter(assignment => assignment.artistEntityIds.some(entityId => (
                followEntityRedirect(entityId, catalogIndex.entitiesById) === artistEntity.id
            )))
            .map(assignment => assignment.songId));
        const artistSongs = legacyProps.localSongs.filter(song => memberIds.has(song.id));
        handlePushCollection({
            source: 'local',
            id: artistEntity.id,
            entityId: artistEntity.id,
            name: artistEntity.displayName,
            type: 'artist',
            songIds: artistSongs.map(song => song.id),
        });
    }, [handlePushCollection, legacyProps.localSongs, localLibraryCatalog, selectedCollection]);

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
            handleBackCollection();
            return;
        }

        const resolvedTracks = resolveLocalGridViewTracks(
            liveSelectedCollection,
            legacyProps.localSongs,
            localLibraryCatalog,
        ) as UnifiedSong[];
        if (liveSelectedCollection.songIds.length > 0 && resolvedTracks.length === 0) {
            handleBackCollection();
            return;
        }

        setNavidromePlaylistItems([]);
        setResolvedLocalCollectionCoverUrl(resolveLocalCollectionCoverUrlFromTracks(
            resolvedTracks,
            legacyProps.localSongs,
            getOrCreateLocalTrackCoverObjectUrl
        ));

        const activeTrackCoverSongIds = new Set<string>();
        const localSongsById = new Map(legacyProps.localSongs.map(song => [song.id, song]));
        const processedTracks = resolvedTracks.map(track => {
            const localData = track.localRef ? localSongsById.get(track.localRef.songId) : undefined;
            if (!localData) return track;

            const preferOnlineCover = localData.useOnlineCover === true;
            if (preferOnlineCover && localData.onlineMetadata?.coverUrl) {
                return track;
            }

            if (isBlob(localData.embeddedCover)) {
                const url = getOrCreateLocalTrackCoverObjectUrl(localData);
                if (url) {
                    activeTrackCoverSongIds.add(localData.id);
                    return applyLocalSongCoverDisplay(track, url);
                }
            }

            return track;
        });
        pruneLocalTrackCoverObjectUrls(activeTrackCoverSongIds);

        setExternalTracks(processedTracks);
        setExternalTracksLoading(false);
    }, [
        handleBackCollection,
        getOrCreateLocalTrackCoverObjectUrl,
        legacyProps.localSongs,
        liveSelectedCollection,
        localLibraryCatalog,
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
        legacyProps.onPlaySong(track, queue);
    }, [legacyProps]);

    const handleAddTrackToQueue = useCallback((track: SongResult) => {
        const unifiedTrack = track as UnifiedSong;
        const localSongId = unifiedTrack.localRef?.songId;
        const localSong = localSongId ? legacyProps.localSongs.find(song => song.id === localSongId) : undefined;
        if (unifiedTrack.isLocal && localSong) {
            legacyProps.onAddLocalSongToQueue?.(localSong);
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
            onEditEntity: async (entityId) => setEditingEntityId(entityId),
            onOrganizeFolderSongInfo: async (collection) => {
                if (isLocalGridViewCollection(collection) && collection.type === 'folder' && !collection.isVirtual) {
                    setOrganizingFolder(collection);
                }
            },
            onMatchSong: async (songId) => setMatchingSongId(songId),
            onResyncFolder: async (collection) => {
                const importedSongs = await resyncFolder(collection.name);
                if (importedSongs !== null) {
                    await legacyProps.onRefreshLocalSongs();
                }
            },
            onResyncAllFolders: async () => {
                const importedSongs = await resyncAllFolders();
                if (importedSongs !== null) {
                    await legacyProps.onRefreshLocalSongs();
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

    const editingEntity = editingEntityId
        ? localLibraryCatalog.entities.find(entity => entity.id === editingEntityId)
        : undefined;
    const editingEntityMemberIds = new Set(localLibraryCatalog.assignments
        .filter(assignment => editingEntity?.kind === 'artist'
            ? assignment.artistEntityIds.includes(editingEntity.id)
            : assignment.albumEntityId === editingEntity?.id)
        .map(assignment => assignment.songId));
    const editingEntitySongs = legacyProps.localSongs.filter(song => editingEntityMemberIds.has(song.id));
    const organizingFolderSongs = organizingFolder
        ? organizingFolder.songIds
            .map(songId => legacyProps.localSongs.find(song => song.id === songId))
            .filter((song): song is LocalSong => Boolean(song))
        : [];
    const matchingSong = matchingSongId
        ? legacyProps.localSongs.find(song => song.id === matchingSongId)
        : undefined;
    const matchingSongAssignment = matchingSongId
        ? localLibraryCatalog.assignments.find(assignment => assignment.songId === matchingSongId)
        : undefined;

    return (
        <>
            <div
                className="absolute inset-0"
                aria-hidden={Boolean(selectedCollection)}
                style={{
                    visibility: selectedCollection ? 'hidden' : 'visible',
                    pointerEvents: selectedCollection ? 'none' : 'auto',
                }}
            >
                {children(openGridView)}
            </div>
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
                            onSelectArtist={handlePushArtistCollection}
                            theme={legacyProps.theme}
                            isDaylight={isDaylight}
                            localSongs={legacyProps.localSongs}
                            onEditEntity={(entityId) => setEditingEntityId(entityId)}
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
                            onSelectArtist={handlePushArtistCollection}
                            currentUserId={legacyProps.user?.userId}
                            onPlaylistMutated={legacyProps.onRefreshUser}
                            onStatusMessage={legacyProps.onStatusMessage}
                            externalTracks={externalTracks}
                            externalTracksLoading={externalTracksLoading}
                            sourceActions={sourceActions}
                            theme={legacyProps.theme}
                            isDaylight={isDaylight}
                        />
                    )
                )}
            </AnimatePresence>
            {editingEntity && (
                <LocalLibraryEntityPanel
                    entity={editingEntity}
                    sameKindEntities={localLibraryCatalog.entities.filter(entity => entity.kind === editingEntity.kind)}
                    memberSongs={editingEntitySongs}
                    isDaylight={isDaylight}
                    onClose={() => setEditingEntityId(null)}
                    onChanged={async () => {
                        await localLibraryCatalog.reload();
                        await legacyProps.onRefreshLocalSongs();
                    }}
                />
            )}
            {organizingFolder && (
                <LocalFolderSongInfoPanel
                    folderName={organizingFolder.name}
                    songs={organizingFolderSongs}
                    assignments={localLibraryCatalog.assignments}
                    isDaylight={isDaylight}
                    onClose={() => setOrganizingFolder(null)}
                    onChanged={async () => {
                        await localLibraryCatalog.reload();
                        await legacyProps.onRefreshLocalSongs();
                    }}
                />
            )}
            {matchingSong && (
                <LocalSongMetadataMatchDialog
                    song={matchingSong}
                    assignment={matchingSongAssignment}
                    isDaylight={isDaylight}
                    onClose={() => setMatchingSongId(null)}
                    onChanged={async () => {
                        await localLibraryCatalog.reload();
                        await legacyProps.onRefreshLocalSongs();
                    }}
                />
            )}
        </>
    );
};

export default GridViewOverlayHost;
