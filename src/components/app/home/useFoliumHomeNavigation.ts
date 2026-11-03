import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getI18n } from 'react-i18next';
import { useFoliumRegistryEntries } from '../../../mods/runtime/registry';
import { closeFoliumHomeTab, homeTabsRegistry, selectFoliumHomeTab, useFoliumHomeTabStore } from '../../../mods/folium/registries/homeTabs';
import { resolveFoliumLabel } from '../../../mods/params/params';
import type { LibraryHomeExtraTab } from '../../../library/core/suite/suite.contract';
import type { LibraryHomeTabKey } from '../../../library/core/home/homeModel.contract';
import { useLibraryHomeSurfaceStore } from '../../../library/core/home/useLibraryHomeSurfaceStore';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';

// src/components/app/home/useFoliumHomeNavigation.ts
// Resolve localized owned pages without sending their IDs to native data-source navigation.
// Home 外壳常驻调用它，所以这里只订阅生成扩展页签必需的东西：注册表条目、开着的页面（activeId），有条目时再加界面语言。
// 没装模组时条目一直是同一个空数组、activeId 一直是 null、语言读作空串，首页外壳的渲染次数与没有模组接口时相同。
// 原生页签、日夜间这些只有页面开着才用得到的订阅在 FoliumHomePage 里，随页面挂载。

const subscribeLanguage = (onChange: () => void) => {
    const i18n = getI18n();
    i18n?.on('languageChanged', onChange);
    return () => { i18n?.off('languageChanged', onChange); };
};

export function useFoliumHomeNavigation() {
    const entries = useFoliumRegistryEntries(homeTabsRegistry);
    const activeId = useFoliumHomeTabStore(state => state.activeId);
    // 标签按界面语言解析；没有条目时快照恒为空串，切语言不让外壳重渲染。
    const hasEntries = entries.length > 0;
    const language = useSyncExternalStore(subscribeLanguage, () => (hasEntries ? getI18n()?.language ?? '' : ''));
    const extraTabs = useMemo<LibraryHomeExtraTab[]>(() => [...entries]
        .sort((left, right) => (left.def.order ?? 500) - (right.def.order ?? 500) || left.id.localeCompare(right.id))
        .map(entry => ({ id: entry.id, label: resolveFoliumLabel(entry.def.label, language, entry.name),
            active: entry.id === activeId,
            select: () => { selectFoliumHomeTab(entry.id); } })), [activeId, entries, language]);
    const activeEntry = entries.find(entry => entry.id === activeId) ?? null;
    const pageOpen = activeEntry !== null;
    // Native commands continue to select the original music-source tabs, dismissing an owned page.
    // 只在有页面开着时监听。监听挂在外壳（而不是 FoliumHomePage）上：首页在播放页下整个藏起时页面组件已经卸载，
    // 这时命令面板选原生页签只会写 homeViewTab（首页 surface 不在，没有页签句柄），回到首页仍要看到选的那个页签。
    useEffect(() => {
        if (!pageOpen) return undefined;
        return useSearchNavigationStore.subscribe((state, previous) => {
            if (state.homeViewTab !== previous.homeViewTab) closeFoliumHomeTab();
        });
    }, [pageOpen]);
    return { extraTabs, activeEntry };
}

/**
 * 页面页头里点原生页签：走首页 surface 登记的页签句柄（与命令面板选原生页签同一条路），而不是直接写 homeViewTab，
 * 套件选页签时的副作用（Bravais 收起缝里的搜索框、TUI 收起账户列表；Grid / Bravais 的句柄自己也会先关掉页面）
 * 不会被绕过。句柄拒绝（页签不可选）时什么都不做，页面留着；没有句柄时退回 writeHomeViewTab。切过去了就关掉页面。
 * 返回页签有没有切过去。
 */
export const selectNativeHomeTabFromPage = (key: LibraryHomeTabKey, writeHomeViewTab: (key: LibraryHomeTabKey) => void): boolean => {
    const handle = useLibraryHomeSurfaceStore.getState().tabs;
    if (handle) {
        if (!handle.setTab(key)) return false;
    } else {
        writeHomeViewTab(key);
    }
    closeFoliumHomeTab();
    return true;
};
