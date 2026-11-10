import { create } from 'zustand';
import type { LibraryDirectorySurfaceHandle } from './directory.contract';

// src/library/core/directory/useLibraryDirectorySurfaceStore.ts
// 命令面板此刻能操作的首页目录（网格里是打开着的 GridMap）。与集合的 grid surface（stores/useGridSurfaceStore）
// 分开：目录的动作是批选与隐藏，集合的是排序、面板和维护，两套命令各自判断，互不掺和。
// 只有正在交互的那个目录注册；旧实例晚一步卸载时不会注销已经接手的新实例。

type LibraryDirectorySurfaceState = {
    directorySurface: LibraryDirectorySurfaceHandle | null;
    /** 返回注销函数。注册会顶替之前的持有者。 */
    registerDirectorySurface: (handle: LibraryDirectorySurfaceHandle) => () => void;
};

export const useLibraryDirectorySurfaceStore = create<LibraryDirectorySurfaceState>((set, get) => ({
    directorySurface: null,
    registerDirectorySurface: (handle) => {
        set({ directorySurface: handle });
        return () => {
            if (get().directorySurface === handle) {
                set({ directorySurface: null });
            }
        };
    },
}));

/** 注册目录 surface（动作，不需要订阅）。 */
export const registerLibraryDirectorySurface: LibraryDirectorySurfaceState['registerDirectorySurface'] = (handle) => (
    useLibraryDirectorySurfaceStore.getState().registerDirectorySurface(handle)
);
