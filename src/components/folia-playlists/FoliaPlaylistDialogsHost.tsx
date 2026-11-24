import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { FoliaPlaylistSummary } from '../../types/foliaPlaylist';
import { createFoliaPlaylist, reorderFoliaPlaylists } from '../../services/foliaPlaylist/foliaPlaylistService';
import { useFoliaPlaylistContent, useFoliaPlaylistsStore } from '../../stores/useFoliaPlaylistsStore';
import { useScratchpadStore } from '../../stores/useScratchpadStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { useLibraryHomeFolia } from '../../library/core/home/useLibraryHomeFolia';
import FoliaPlaylistOrderDialog from '../folia-playlist-order/FoliaPlaylistOrderDialog';
import type { OrderSong } from '../folia-playlist-order/playlistOrderDraft';
import TextInputDialog from '../shared/TextInputDialog';
import { useFoliaPlaylistDialogStore } from './foliaPlaylistDialogStore';
import { FoliaPlaylistExportDialog, FoliaPlaylistImportDialog } from './FoliaPlaylistFileDialogs';
import FoliaTransferDialog from './FoliaTransferDialog';

// src/components/folia-playlists/FoliaPlaylistDialogsHost.tsx
// Folia 页的两个对话框：新建歌单（只要一个名字，建出来是空的）、调整歌单顺序（歌单本身的先后，用排歌的那个编辑器，
// 一行一张歌单）。「我喜欢的音乐」固定在最前，不进编辑器。
// 另有集合页上的转存对话框（把平台歌单 / 专辑存成 Folia 歌单、从原歌单更新）：FoliaTransferDialog；
// 歌单文件的导出（选 JSON 或 M3U8）与导入（两种都认，先预览）：FoliaPlaylistFileDialogs。

type Props = {
    playlists: readonly FoliaPlaylistSummary[];
    localSongs: readonly LocalSong[];
    isDaylight: boolean;
};

/** 调整歌单顺序：打开那一刻的歌单是一份草稿，保存时歌单增减过就不写（编辑器提示重新打开）。 */
const ReorderPlaylists: React.FC<Props & { onClose: () => void }> = ({ playlists, localSongs, isDaylight, onClose }) => {
    const { t } = useTranslation();
    const folia = useLibraryHomeFolia({ playlists, localSongs });
    // 只在打开时取一次：编辑期间歌单变了由保存时的校验说。
    const [rows] = useState<OrderSong[]>(() => folia.groups.filter(group => !group.isVirtual).map(group => ({
        id: group.playlistId ?? group.id,
        title: group.name,
        fileName: '',
        artist: t('localPlaylistOrder.songCount', { count: group.trackCount ?? 0 }),
        coverUrl: typeof group.coverUrl === 'string' ? group.coverUrl : undefined,
    })));
    const save = async (orderedIds: string[]) => {
        const favoriteIds = useFoliaPlaylistsStore.getState().playlists.filter(playlist => playlist.isFavorite).map(playlist => playlist.id);
        return reorderFoliaPlaylists([...favoriteIds, ...orderedIds]);
    };
    return (
        <FoliaPlaylistOrderDialog
            noun="playlists"
            name={t('home.foliaTitle')}
            songs={rows}
            isDaylight={isDaylight}
            onClose={onClose}
            onSave={save}
        />
    );
};

const FoliaPlaylistDialogsHost: React.FC<Props> = (props) => {
    const { t } = useTranslation();
    const dialog = useFoliaPlaylistDialogStore(state => state.dialog);
    const close = useFoliaPlaylistDialogStore(state => state.close);
    const transfer = useFoliaPlaylistDialogStore(state => state.transfer);
    const closeTransfer = useFoliaPlaylistDialogStore(state => state.closeTransfer);
    const exportPlaylistId = useFoliaPlaylistDialogStore(state => state.exportPlaylistId);
    const closeExport = useFoliaPlaylistDialogStore(state => state.closeExport);
    const importRequest = useFoliaPlaylistDialogStore(state => state.importRequest);
    // 导出要这张歌单的全部条目：窗口要开的时候才读，读到了再画。
    const { playlist: exportPlaylist } = useFoliaPlaylistContent(exportPlaylistId);
    // 这两个对话框和首页层在同一个层叠上下文里，盖不过左边的速记簿：开着时让它藏起来。
    useEffect(() => {
        if (dialog !== 'reorder') return;
        useScratchpadStore.getState().setCovered(true);
        return () => useScratchpadStore.getState().setCovered(false);
    }, [dialog]);

    return (
        <>
            <TextInputDialog
                isOpen={dialog === 'create'}
                title={t('localMusic.createPlaylist')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.createPlaylist')}
                isDaylight={props.isDaylight}
                onClose={close}
                onConfirm={async name => {
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    try {
                        await createFoliaPlaylist(trimmed);
                        setStatusMessage({ type: 'success', text: t('foliaPlaylist.created', { name: trimmed }) });
                    } catch (error) {
                        console.warn('[FoliaPlaylist] Failed to create a playlist', error);
                        setStatusMessage({ type: 'error', text: t('status.playlistUpdateFailed') });
                    }
                    close();
                }}
            />
            {dialog === 'reorder' && <ReorderPlaylists {...props} onClose={close} />}
            {transfer && (
                <FoliaTransferDialog
                    // 换了一张就是另一个对话框：名字、选择、进行中的状态都从头来。
                    key={transfer.mode === 'save' ? `save:${transfer.collection.source}:${transfer.collection.id}` : `refresh:${transfer.playlistId}`}
                    request={transfer}
                    playlists={props.playlists}
                    isDaylight={props.isDaylight}
                    onClose={closeTransfer}
                />
            )}
            {exportPlaylist && (
                <FoliaPlaylistExportDialog
                    key={`export:${exportPlaylist.id}`}
                    playlist={exportPlaylist}
                    name={exportPlaylist.isFavorite ? t('localMusic.favoritePlaylist') : exportPlaylist.name}
                    localSongs={props.localSongs}
                    isDaylight={props.isDaylight}
                    onClose={closeExport}
                />
            )}
            {importRequest && (
                <FoliaPlaylistImportDialog
                    file={importRequest.file}
                    playlists={props.playlists}
                    localSongs={props.localSongs}
                    isDaylight={props.isDaylight}
                    onDone={importRequest.done}
                />
            )}
        </>
    );
};

export default FoliaPlaylistDialogsHost;
