import { create } from 'zustand';

// src/components/folia-playlists/foliaPlaylistDialogStore.ts
// Folia 页上两个对话框开没开：新建歌单、调整歌单顺序。两套首页（grid、Bravais）只说「打开」，对话框本身由
// FoliaPlaylistDialogsHost 画（挂在资料库的宿主里，哪套界面都是同一个）。不存任何设置。

export type FoliaPlaylistDialog = 'create' | 'reorder';

type FoliaPlaylistDialogState = {
    dialog: FoliaPlaylistDialog | null;
    open: (dialog: FoliaPlaylistDialog) => void;
    close: () => void;
};

export const useFoliaPlaylistDialogStore = create<FoliaPlaylistDialogState>(set => ({
    dialog: null,
    open: dialog => set({ dialog }),
    close: () => set({ dialog: null }),
}));

export const openFoliaPlaylistDialog = (dialog: FoliaPlaylistDialog) => useFoliaPlaylistDialogStore.getState().open(dialog);
