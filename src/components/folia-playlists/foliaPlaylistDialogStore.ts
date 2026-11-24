import { create } from 'zustand';
import type { FoliaSavableCollection } from '../../library/app/foliaOriginSongs';

// src/components/folia-playlists/foliaPlaylistDialogStore.ts
// Folia 歌单的几个对话框开没开：新建歌单、调整歌单顺序（Folia 页上的），以及转存一张平台歌单 / 专辑、
// 转存来的歌单从原歌单更新（集合页上的），以及歌单文件的导出（选保存格式）与导入（读文件、预览、确认）。各套界面只说「打开」，对话框本身由 FoliaPlaylistDialogsHost 画
// （挂在资料库的宿主里，哪套界面都是同一个）。不存任何设置。

export type FoliaPlaylistDialog = 'create' | 'reorder';

/** 转存对话框在做哪件事：把这张集合存成 Folia 歌单，或者把这张转存来的歌单从原歌单更新。 */
export type FoliaTransferRequest =
    | { mode: 'save'; collection: FoliaSavableCollection }
    | { mode: 'refresh'; playlistId: string };

/** 导入对话框关掉时的结果：写成了歌单就有名字和首数；取消、文件不对、没写成是 null。 */
export type FoliaImportOutcome = { playlistName: string | null; count: number };

type FoliaPlaylistDialogState = {
    dialog: FoliaPlaylistDialog | null;
    transfer: FoliaTransferRequest | null;
    /** 导出对话框开着：要导出的那张歌单。 */
    exportPlaylistId: string | null;
    /** 导入对话框开着：选中的文件，和关掉时要告诉谁。 */
    importRequest: { file: File; done: (outcome: FoliaImportOutcome) => void } | null;
    open: (dialog: FoliaPlaylistDialog) => void;
    close: () => void;
    openTransfer: (request: FoliaTransferRequest) => void;
    closeTransfer: () => void;
    openExport: (playlistId: string) => void;
    closeExport: () => void;
    openImport: (file: File, done: (outcome: FoliaImportOutcome) => void) => void;
    closeImport: () => void;
};

export const useFoliaPlaylistDialogStore = create<FoliaPlaylistDialogState>(set => ({
    dialog: null,
    transfer: null,
    open: dialog => set({ dialog }),
    close: () => set({ dialog: null }),
    openTransfer: transfer => set({ transfer }),
    closeTransfer: () => set({ transfer: null }),
    exportPlaylistId: null,
    importRequest: null,
    openExport: exportPlaylistId => set({ exportPlaylistId }),
    closeExport: () => set({ exportPlaylistId: null }),
    openImport: (file, done) => set({ importRequest: { file, done } }),
    closeImport: () => set({ importRequest: null }),
}));

export const openFoliaPlaylistDialog = (dialog: FoliaPlaylistDialog) => useFoliaPlaylistDialogStore.getState().open(dialog);
export const openFoliaTransferDialog = (request: FoliaTransferRequest) => useFoliaPlaylistDialogStore.getState().openTransfer(request);
/** 打开导出对话框（选保存格式：JSON 或 M3U8）。 */
export const openFoliaExportDialog = (playlistId: string) => useFoliaPlaylistDialogStore.getState().openExport(playlistId);
/**
 * 打开导入对话框读这个文件（JSON 与 M3U 都认）；对话框关掉时 resolve。已经开着一个时，新的这次直接算取消。
 */
export const requestFoliaPlaylistImport = (file: File): Promise<FoliaImportOutcome> => new Promise((resolve) => {
    const store = useFoliaPlaylistDialogStore.getState();
    if (store.importRequest) {
        resolve({ playlistName: null, count: 0 });
        return;
    }
    store.openImport(file, (outcome) => {
        useFoliaPlaylistDialogStore.getState().closeImport();
        resolve(outcome);
    });
});
