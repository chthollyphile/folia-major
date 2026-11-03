import { create } from 'zustand';
import type { LibraryHomeListHandle, LibraryHomeTabsHandle } from './homeModel.contract';

// src/library/core/home/useLibraryHomeSurfaceStore.ts
// 首页此刻挂着的页签条与列表（任何 suite 的首页都注册，见 core/home/useLibraryHomeSurfaceRegistration）。
// 读的人（行为探针，以后的命令面板）只经句柄拿首页模型的状态、调首页动作，不读组件树。
// 与目录 surface（useLibraryDirectorySurfaceStore）同一个做法：注册顶替之前的持有者，旧实例晚一步注销时
// 不会注销已经接手的新实例。

type LibraryHomeSurfaceState = {
    tabs: LibraryHomeTabsHandle | null;
    list: LibraryHomeListHandle | null;
    /** 返回注销函数。 */
    registerTabs: (handle: LibraryHomeTabsHandle) => () => void;
    registerList: (handle: LibraryHomeListHandle) => () => void;
};

export const useLibraryHomeSurfaceStore = create<LibraryHomeSurfaceState>((set, get) => ({
    tabs: null,
    list: null,
    registerTabs: (handle) => {
        set({ tabs: handle });
        return () => {
            if (get().tabs === handle) set({ tabs: null });
        };
    },
    registerList: (handle) => {
        set({ list: handle });
        return () => {
            if (get().list === handle) set({ list: null });
        };
    },
}));
