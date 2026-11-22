import { create } from 'zustand';
import type { FoliaSavableCollection } from '../../library/app/foliaOriginSongs';

// src/components/folia-playlists/foliaPlaylistDialogStore.ts
// Folia 歌单的几个对话框开没开：新建歌单、调整歌单顺序（Folia 页上的），以及转存一张平台歌单 / 专辑、
// 转存来的歌单从原歌单更新（集合页上的）。各套界面只说「打开」，对话框本身由 FoliaPlaylistDialogsHost 画
// （挂在资料库的宿主里，哪套界面都是同一个）。不存任何设置。

export type FoliaPlaylistDialog = 'create' | 'reorder';

/** 转存对话框在做哪件事：把这张集合存成 Folia 歌单，或者把这张转存来的歌单从原歌单更新。 */
export type FoliaTransferRequest =
    | { mode: 'save'; collection: FoliaSavableCollection }
    | { mode: 'refresh'; playlistId: string };

type FoliaPlaylistDialogState = {
    dialog: FoliaPlaylistDialog | null;
    transfer: FoliaTransferRequest | null;
    open: (dialog: FoliaPlaylistDialog) => void;
    close: () => void;
    openTransfer: (request: FoliaTransferRequest) => void;
    closeTransfer: () => void;
};

export const useFoliaPlaylistDialogStore = create<FoliaPlaylistDialogState>(set => ({
    dialog: null,
    transfer: null,
    open: dialog => set({ dialog }),
    close: () => set({ dialog: null }),
    openTransfer: transfer => set({ transfer }),
    closeTransfer: () => set({ transfer: null }),
}));

export const openFoliaPlaylistDialog = (dialog: FoliaPlaylistDialog) => useFoliaPlaylistDialogStore.getState().open(dialog);
export const openFoliaTransferDialog = (request: FoliaTransferRequest) => useFoliaPlaylistDialogStore.getState().openTransfer(request);
