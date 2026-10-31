import { create } from 'zustand';

// src/library/suites/grid/home/gridMapVisibilityStore.ts
// 网格首页的 GridMap 是否正显示（含退场动画期间）。与 core 目录会话的 openDirectoryKey 分开：
// 会话要等地图退场结束才关（筛选结果不能先跳回全部），页头却要在地图开始退场时就淡回来，
// 所以这里同步跟着 showGridMap 翻转。

type GridMapVisibilityState = {
    /** 此刻网格首页上显示着（或正在退场）的目录；没有为 null。 */
    visibleDirectoryKey: string | null;
    show: (directoryKey: string) => void;
    /** 只清掉自己的那个 key：旧 surface 的卸载不能把新 surface 刚打开的地图抹掉。 */
    hide: (directoryKey: string) => void;
};

export const useGridMapVisibilityStore = create<GridMapVisibilityState>((set, get) => ({
    visibleDirectoryKey: null,
    show: (directoryKey) => {
        if (get().visibleDirectoryKey === directoryKey) return;
        set({ visibleDirectoryKey: directoryKey });
    },
    hide: (directoryKey) => {
        if (get().visibleDirectoryKey !== directoryKey) return;
        set({ visibleDirectoryKey: null });
    },
}));
