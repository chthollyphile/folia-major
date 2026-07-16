import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Loader2, Music, ListMusic, User, Disc3 } from 'lucide-react';
import DesktopGrid3DSurface, { DesktopGrid3DAction } from '../../folia-grid/DesktopGrid3DSurface';
import { LocalLibraryGroup, LocalPlaylist, LocalSong, Theme } from '../../../types';
import { GridViewCollectionDescriptor, createLocalGridViewCollection } from './gridViewCollectionAdapters';
import { buildLocalGrid3DGroups } from './localGrid3DModel';
import { useDebouncedFocusSync } from '../../../hooks/useDebouncedFocusSync';
import { useLocalLibraryCatalog } from '../../../hooks/useLocalLibraryCatalog';
import { createSafeObjectUrl, isBlob } from '../../../utils/blobGuards';

// src/components/app/home/LocalGrid3DView.tsx
// Desktop-only local music Grid3D overview that opens GridView instead of legacy carousel details.

type LocalRow = 0 | 1 | 2 | 3;

interface LocalGrid3DViewProps {
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    activeRow: LocalRow;
    setActiveRow: (row: LocalRow) => void;
    focusedFolderIndex: number;
    setFocusedFolderIndex: (index: number) => void;
    focusedAlbumIndex: number;
    setFocusedAlbumIndex: (index: number) => void;
    focusedArtistIndex: number;
    setFocusedArtistIndex: (index: number) => void;
    focusedPlaylistIndex: number;
    setFocusedPlaylistIndex: (index: number) => void;
    onImportFolder: () => void;
    importButtonDisabled?: boolean;
    isImporting?: boolean;
    isScanInProgress?: boolean;
    onOpenGridView?: (collection: GridViewCollectionDescriptor) => void;
    theme: Theme;
    isDaylight: boolean;
    hasFloatingPlayer?: boolean;
}

export const LocalGrid3DView: React.FC<LocalGrid3DViewProps> = ({
    localSongs,
    localPlaylists,
    activeRow,
    setActiveRow,
    focusedFolderIndex,
    setFocusedFolderIndex,
    focusedAlbumIndex,
    setFocusedAlbumIndex,
    focusedArtistIndex,
    setFocusedArtistIndex,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    onImportFolder,
    importButtonDisabled = false,
    isImporting = false,
    isScanInProgress = false,
    onOpenGridView,
    theme,
    isDaylight,
    hasFloatingPlayer = false,
}) => {
    const { t } = useTranslation();
    const catalog = useLocalLibraryCatalog(localSongs);
    const { groups, coverSourceMap } = useMemo(() => {
        const rawGroups = buildLocalGrid3DGroups(localSongs, localPlaylists, t, catalog.ready ? catalog : undefined);
        const sourceMap = new Map<string, Blob | string | undefined>();

        const processItems = (items: LocalLibraryGroup[]) => items.map(item => {
            sourceMap.set(item.id, item.coverUrl);
            return {
                ...item,
                coverUrl: undefined,
            };
        });

        return {
            groups: {
                folders: processItems(rawGroups.folders),
                albums: processItems(rawGroups.albums),
                artists: processItems(rawGroups.artists),
                playlists: processItems(rawGroups.playlists),
            },
            coverSourceMap: sourceMap,
        };
    }, [catalog.assignments, catalog.entities, catalog.ready, localPlaylists, localSongs, t]);

    const [localFolderIndex, setLocalFolderIndex] = useDebouncedFocusSync(focusedFolderIndex, setFocusedFolderIndex);
    const [localAlbumIndex, setLocalAlbumIndex] = useDebouncedFocusSync(focusedAlbumIndex, setFocusedAlbumIndex);
    const [localArtistIndex, setLocalArtistIndex] = useDebouncedFocusSync(focusedArtistIndex, setFocusedArtistIndex);
    const [localPlaylistIndex, setLocalPlaylistIndex] = useDebouncedFocusSync(focusedPlaylistIndex, setFocusedPlaylistIndex);

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
            if (isBlob(source)) {
                const url = createSafeObjectUrl(source);
                if (!url) continue;
                nextObjectUrls[group.id] = url;
                createdUrls.push(url);
            }
        }

        setGroupCoverObjectUrls(current => {
            if (createdUrls.length === 0 && Object.keys(current).length === 0) {
                return current;
            }
            return nextObjectUrls;
        });

        return () => {
            createdUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [groups, coverSourceMap]);

    const groupsWithCovers = useMemo(() => {
        const withCoverUrls = (items: typeof groups.folders) => items.map(group => {
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

    const sections = useMemo(() => [
        {
            key: 'folders',
            row: 0 as LocalRow,
            label: t('localMusic.foldersAndPlaylists'),
            icon: <FolderOpen size={13} />,
            items: groupsWithCovers.folders,
            focusedIndex: localFolderIndex,
            setFocusedIndex: setLocalFolderIndex,
            emptyMessage: t('localMusic.noFoldersFound'),
        },
        {
            key: 'albums',
            row: 1 as LocalRow,
            label: t('localMusic.albums'),
            icon: <Disc3 size={13} />,
            items: groupsWithCovers.albums,
            focusedIndex: localAlbumIndex,
            setFocusedIndex: setLocalAlbumIndex,
            emptyMessage: t('localMusic.noAlbumsFound'),
        },
        {
            key: 'artists',
            row: 2 as LocalRow,
            label: t('localMusic.artists'),
            icon: <User size={13} />,
            items: groupsWithCovers.artists,
            focusedIndex: localArtistIndex,
            setFocusedIndex: setLocalArtistIndex,
            emptyMessage: t('localMusic.noArtistsFound'),
        },
        {
            key: 'playlists',
            row: 3 as LocalRow,
            label: t('localMusic.customPlaylists') || t('home.playlists'),
            icon: <ListMusic size={13} />,
            items: groupsWithCovers.playlists,
            focusedIndex: localPlaylistIndex,
            setFocusedIndex: setLocalPlaylistIndex,
            emptyMessage: t('localMusic.noPlaylistsFound'),
        },
    ], [
        localAlbumIndex,
        localArtistIndex,
        localFolderIndex,
        localPlaylistIndex,
        groupsWithCovers,
        setLocalAlbumIndex,
        setLocalArtistIndex,
        setLocalFolderIndex,
        setLocalPlaylistIndex,
        t,
    ]);

    const activeSection = sections.find(section => section.row === activeRow) ?? sections[0];

    const tabs: DesktopGrid3DAction[] = sections.map(section => ({
        id: section.key,
        label: section.label,
        icon: section.icon,
        active: activeSection.row === section.row,
        onClick: () => setActiveRow(section.row),
    }));

    const actions: DesktopGrid3DAction[] = [
        {
            id: 'import-folder',
            label: isScanInProgress ? t('options.scanning') : isImporting ? t('localMusic.importing') : t('localMusic.importFolder'),
            icon: importButtonDisabled ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />,
            disabled: importButtonDisabled,
            onClick: onImportFolder,
            title: isScanInProgress ? t('options.scanningMediaLib') : t('localMusic.importFolder'),
        },
    ];

    if (localSongs.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 opacity-60">
                <Music size={64} />
                <p className="text-lg">{t('localMusic.noLocalMusic')}</p>
                <button
                    onClick={onImportFolder}
                    disabled={importButtonDisabled}
                    className="px-6 py-3 rounded-full transition-colors text-sm flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {importButtonDisabled ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                    {isScanInProgress ? t('options.scanning') : isImporting ? t('localMusic.importing') : t('localMusic.importFolder')}
                </button>
            </div>
        );
    }

    return (
        <DesktopGrid3DSurface
            title={String(activeSection.label)}
            mapButtonLabel={t('home.allAlbums')}
            items={activeSection.items.map((item: any) => ({
                id: item.id,
                name: item.name,
                coverUrl: item.coverUrl,
                description: item.description,
                trackCount: item.trackCount,
                type: item.type,
            }))}
            focusedIndex={activeSection.focusedIndex}
            onFocusedIndexChange={activeSection.setFocusedIndex}
            onSelect={(_, index) => {
                const group = activeSection.items[index];
                if (group) {
                    onOpenGridView?.(createLocalGridViewCollection(group));
                }
            }}
            tabs={tabs}
            actions={actions}
            emptyMessage={activeSection.emptyMessage}
            theme={theme}
            isDaylight={isDaylight}
            hasFloatingPlayer={hasFloatingPlayer}
        />
    );
};

export default LocalGrid3DView;
