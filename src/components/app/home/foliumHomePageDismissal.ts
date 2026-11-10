import type { LibraryHomeTabKey } from '../../../library/core/home/homeModel.contract';
import { closeFoliumHomeTab, useFoliumHomeTabStore } from '../../../mods/folium/registries/homeTabs';
import { subscribeCollectionOpen } from '../../../stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';

// src/components/app/home/foliumHomePageDismissal.ts
// 首页之外的导航关掉模组首页页面（FoliumHomePage）的两条规则。页面的选中态（activeId）在 Home 卸载、首页藏起时都还在，
// 这两条不能挂在 Home 外壳上：Lattice 下 Home 整个卸载，播放页下首页藏起超过 350ms 后首页 surface 与它的页签句柄也不在了。
// - 显式打开集合（installFoliumHomePageDismissal，主窗口启动时装一次）：集合层画在原生首页那一层里，页面开着时那一层
//   inert 并整个压在页面下面，打开的集合看不见也点不了，所以先关掉页面。只认 openRoot 与 push 压了新一层；页面打开在
//   已有集合之上（快照不变）、浏览器前进后退恢复的集合（restore）都不关，页面照旧在最上面。
// - 首页 surface 不在时选原生页签（selectNativeHomeTabWithoutSurface，命令面板用）：重选当前页签时 homeViewTab 不变，
//   Home 外壳对它的监听收不到；Lattice 下外壳本身也不在。所以像挂着的 surface 的页签句柄那样，直接关掉页面。

/** 装上「显式打开集合时关掉开着的模组首页页面」，返回卸下函数。 */
export const installFoliumHomePageDismissal = (): (() => void) => subscribeCollectionOpen(() => {
    if (useFoliumHomeTabStore.getState().activeId !== null) closeFoliumHomeTab();
});

/**
 * 没有首页 surface 的页签句柄可用时（或句柄不接这个页签时）选原生首页页签：关掉开着的模组首页页面，再写 homeViewTab。
 * 命令面板的「打开歌单 / 本地音乐…」在句柄之外走这里（CommandPaletteNavigationContext.selectHomeViewTab）。
 */
export const selectNativeHomeTabWithoutSurface = (key: LibraryHomeTabKey): void => {
    closeFoliumHomeTab();
    useSearchNavigationStore.getState().setHomeViewTab(key);
};
