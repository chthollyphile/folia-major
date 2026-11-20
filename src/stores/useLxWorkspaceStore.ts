import { create } from 'zustand';
import type { LxPublicPlatform } from '../services/onlineMusic/lxmusic/lxFacade';

// src/stores/useLxWorkspaceStore.ts
// 「洛雪工作台」的开合与当前页签。放在 store 里是因为入口在登录页（Library 那棵树），
// 而页面本身挂在应用级浮层上（那里才拿得到播放 / 加入队列的回调）。

export type LxWorkspaceTab = 'playlist' | 'radio' | 'album' | 'chart' | 'mine' | 'local' | 'search' | 'source';

/** 从首页榜单列表点进工作台时，要直接落到哪一家的哪个榜。 */
export type LxWorkspaceChartTarget = { platform: LxPublicPlatform; chartId: string };

/**
 * 哪个来源选中后要直接打开工作台，由来源自己声明（在这里，而不是登录窗里）。
 * 登录模块按主线的架构约定不认识任何平台 id，只问这个判断。
 */
export const isLxWorkspaceProvider = (providerId: string): boolean => providerId === 'lxmusic';

type LxWorkspaceState = {
    isOpen: boolean;
    tab: LxWorkspaceTab;
    /** 首页点某个榜留下的一次性目标：工作台落到该榜后清掉。 */
    pendingChart: LxWorkspaceChartTarget | null;
    open: (tab?: LxWorkspaceTab, chart?: LxWorkspaceChartTarget) => void;
    close: () => void;
    setTab: (tab: LxWorkspaceTab) => void;
    clearPendingChart: () => void;
};

export const useLxWorkspaceStore = create<LxWorkspaceState>((set, get) => ({
    isOpen: false,
    tab: 'playlist',
    pendingChart: null,
    open: (tab, chart) => set({
        isOpen: true,
        tab: tab ?? get().tab,
        pendingChart: chart ?? (tab === 'chart' ? get().pendingChart : null),
    }),
    close: () => set({ isOpen: false }),
    setTab: (tab) => set({ tab }),
    clearPendingChart: () => set({ pendingChart: null }),
}));
