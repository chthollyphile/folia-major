import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Loader2, Music, ListMusic, User, Disc3 } from 'lucide-react';
import DesktopGrid3DSurface, { DesktopGrid3DAction } from '../../folia-grid/DesktopGrid3DSurface';
import { LocalLibraryGroup, LocalPlaylist, LocalSong, Theme } from '../../../types';
import { GridViewCollectionDescriptor, createLocalGridViewCollection } from './gridViewCollectionAdapters';
import { buildLocalGrid3DGroups } from './localGrid3DModel';

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
    const groups = useMemo(
        () => buildLocalGrid3DGroups(localSongs, localPlaylists, t),
        [localPlaylists, localSongs, t]
    );

    const sections = useMemo(() => [
        {
            key: 'folders',
            row: 0 as LocalRow,
            label: t('localMusic.foldersAndPlaylists'),
            icon: <FolderOpen size={13} />,
            items: groups.folders,
            focusedIndex: focusedFolderIndex,
            setFocusedIndex: setFocusedFolderIndex,
            emptyMessage: t('localMusic.noFoldersFound'),
        },
        {
            key: 'albums',
            row: 1 as LocalRow,
            label: t('localMusic.albums'),
            icon: <Disc3 size={13} />,
            items: groups.albums,
            focusedIndex: focusedAlbumIndex,
            setFocusedIndex: setFocusedAlbumIndex,
            emptyMessage: t('localMusic.noAlbumsFound'),
        },
        {
            key: 'artists',
            row: 2 as LocalRow,
            label: t('localMusic.artists'),
            icon: <User size={13} />,
            items: groups.artists,
            focusedIndex: focusedArtistIndex,
            setFocusedIndex: setFocusedArtistIndex,
            emptyMessage: t('localMusic.noArtistsFound'),
        },
        {
            key: 'playlists',
            row: 3 as LocalRow,
            label: t('localMusic.customPlaylists') || t('home.playlists'),
            icon: <ListMusic size={13} />,
            items: groups.playlists,
            focusedIndex: focusedPlaylistIndex,
            setFocusedIndex: setFocusedPlaylistIndex,
            emptyMessage: t('localMusic.noPlaylistsFound'),
        },
    ], [
        focusedAlbumIndex,
        focusedArtistIndex,
        focusedFolderIndex,
        focusedPlaylistIndex,
        groups,
        setFocusedAlbumIndex,
        setFocusedArtistIndex,
        setFocusedFolderIndex,
        setFocusedPlaylistIndex,
        t,
    ]);

    const activeSection = sections.find(section => section.row === activeRow) ?? sections[0];

    const actions: DesktopGrid3DAction[] = [
        ...sections.map(section => ({
            id: section.key,
            label: section.label,
            icon: section.icon,
            active: activeSection.row === section.row,
            onClick: () => setActiveRow(section.row),
        })),
        {
            id: 'import-folder',
            label: isScanInProgress ? '扫描中' : isImporting ? t('localMusic.importing') : t('localMusic.importFolder'),
            icon: importButtonDisabled ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />,
            disabled: importButtonDisabled,
            onClick: onImportFolder,
            title: isScanInProgress ? '正在扫描媒体库' : t('localMusic.importFolder'),
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
                    {isScanInProgress ? '扫描中' : isImporting ? t('localMusic.importing') : t('localMusic.importFolder')}
                </button>
            </div>
        );
    }

    return (
        <DesktopGrid3DSurface
            title={String(activeSection.label)}
            mapButtonLabel={t('home.allAlbums') || '全部'}
            items={activeSection.items.map((item: LocalLibraryGroup) => ({
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
            actions={actions}
            emptyMessage={activeSection.emptyMessage}
            theme={theme}
            isDaylight={isDaylight}
            hasFloatingPlayer={hasFloatingPlayer}
        />
    );
};

export default LocalGrid3DView;
