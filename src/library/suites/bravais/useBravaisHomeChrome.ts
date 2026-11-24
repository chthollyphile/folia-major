import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeSurfaceProps } from '../../core/suite/suite.contract';
import type {
    LibraryHomeGroupView,
    LibraryHomeTabKey,
    LibraryHomeTabView,
} from '../../core/home/homeModel.contract';
import { isOnlineHomeTab } from '../../core/home/homeSources';
import type { BravaisSeamTab } from './bravaisLayer';
import type { BravaisHomeSearch, BravaisHomeSection, BravaisHomeTool } from './bravaisHomeModels';
import { cycleHomeSeamTab, projectHomeSeamGroups } from './bravaisHomeProjection';
import { setBravaisSearchOpen, useBravaisHomeUiStore } from './bravaisHomeUiStore';
import { openSettings } from '../../../stores/useSettingsModalStore';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { selectBravaisHasCurrentSong } from './bravaisBack';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useUpdateIndicator } from '../../../hooks/useUpdateIndicator';
import { resolveSearchSource, useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';

// src/library/suites/bravais/useBravaisHomeChrome.ts
// 首页缝里与来源无关的那一部分（设计稿 §10.5）：一级页签（首页两级页签的组：Folia、当前在线音源、本地、Navidrome，后面接
// 模组的首页页面；在线组的页签只是页签，换音源在账户 / 登录窗口里做）、在线组的二级切换（歌单 / 推荐 / 探索 / 专辑，缝里与本地四行同一个位置）、F6 的循环
// （仍按页一个个轮，不按组）、全局搜索框（提交走 onSearchCommitted
// 去 SearchWorkspace，过渡期唯一的离墙路径）、app 级入口（打开队列 = 整墙切到 Lattice、回到播放页、舞台播放器、
// 设置）与扫描进度。设置格在发现新版本（且还没在设置里看过）时带提示点，与 grid 首页设置按钮旁的「发现新版本」同源。各来源的墙（BravaisHomeSources）在它之上补自己的二级切换、「⋯」与刷新。
// 回调身份稳定（latest-ref），层描述不因它们换身份。

export type BravaisHomeChrome = {
    title: string;
    tabs: readonly BravaisSeamTab[];
    onSelectTab: (key: string) => void;
    cycleTab: (delta: 1 | -1) => boolean;
    /** 在线组的二级切换（不到两页时为空：只有一页就不画）；各在线页的墙与探索页都把它放进缝里。 */
    onlineSections: readonly BravaisHomeSection[] | undefined;
    onSelectOnlineSection: (key: string) => void;
    /** 一个音源都没启用：在线组的墙说这件事，并给去「设置 → 音源」的入口（只桌面版有这一页，没有时为 undefined）。 */
    noSources: boolean;
    openSourceSettings: (() => void) | undefined;
    /** 搜索放最前，app 级入口放最后；来源自己的按钮插在中间。 */
    searchTool: BravaisHomeTool;
    appTools: readonly BravaisHomeTool[];
    search: BravaisHomeSearch;
    /** 本地导入 / 重扫时的扫描进度（没有在扫描时为 null）。 */
    scan: string | null;
};

type ChromeProps = Pick<
    LibraryHomeSurfaceProps,
    | 'onSearchCommitted' | 'onOpenLattice' | 'onBackToPlayer' | 'onOpenStagePlayer' | 'stageEnabled' | 'stageIsActive' | 'onOpenSettings'
    | 'localSongs' | 'localLibraryCatalog'
    | 'extraTabs'
>;

export const useBravaisHomeChrome = ({
    tab,
    tabs,
    groups,
    noOnlineSources,
    providerId,
    selectTab,
    scanPercent,
    scanning,
    props,
}: {
    tab: LibraryHomeTabKey;
    tabs: readonly LibraryHomeTabView[];
    groups: readonly LibraryHomeGroupView[];
    /** 一个音源都没启用（useLibraryHomeSources 的 noOnlineSources）。 */
    noOnlineSources: boolean;
    /** 在线页签搜索的来源：当前在线 provider。 */
    providerId: string;
    selectTab: (key: LibraryHomeTabKey) => boolean;
    scanPercent: number;
    scanning: boolean;
    props: ChromeProps;
}): BravaisHomeChrome => {
    const { t } = useTranslation();
    const searchOpen = useBravaisHomeUiStore(state => state.searchOpen);
    const latest = useRef({ tab, tabs, groups, providerId, selectTab, props });
    latest.current = { tab, tabs, groups, providerId, selectTab, props };

    // 扩展页签（模组的首页页面）交给宿主打开；原生的页走 selectTab（收起搜索框、通知宿主关掉开着的页面）。
    const selectSeamTab = useCallback((key: string): boolean => {
        const extra = latest.current.props.extraTabs?.find(tab => tab.id === key);
        if (!extra) return latest.current.selectTab(key as LibraryHomeTabKey);
        extra.select();
        return true;
    }, []);
    // 一级那一排点的是组（或扩展页签）：去这一组记住的那一页。
    const onSelectTab = useCallback((key: string) => {
        const group = latest.current.groups.find(candidate => candidate.key === key);
        if (!group) {
            selectSeamTab(key);
            return;
        }
        if (group.target) selectSeamTab(group.target);
    }, [selectSeamTab]);
    const onSelectOnlineSection = useCallback((key: string) => {
        selectSeamTab(key);
    }, [selectSeamTab]);
    // F6 与网格首页的 Tab 循环一样把扩展页签也排进来（在原生页签后面）。
    const cycleTab = useCallback((delta: 1 | -1) => {
        const { tab: current, tabs: all, props: host } = latest.current;
        const next = cycleHomeSeamTab(all, current, host.extraTabs ?? [], delta);
        return next ? selectSeamTab(next) : false;
    }, [selectSeamTab]);

    const seamTabs = useMemo<BravaisSeamTab[]>(
        () => projectHomeSeamGroups(groups, props.extraTabs),
        [groups, props.extraTabs],
    );
    const onlineGroup = groups.find(group => group.key === 'online');
    const extraOpen = props.extraTabs?.some(extra => extra.active) ?? false;
    const onlineSections = useMemo<BravaisHomeSection[] | undefined>(() => {
        // 一个音源都没启用时没有二级页签可言（页都是空的）；只有一页时也不画。
        if (!onlineGroup || noOnlineSources || onlineGroup.tabs.length < 2) return undefined;
        return onlineGroup.tabs.map(page => ({
            key: page.key,
            label: page.label,
            active: !extraOpen && page.key === tab,
            disabled: Boolean(page.disabledReason),
            title: page.disabledReason || undefined,
        }));
    }, [extraOpen, noOnlineSources, onlineGroup, tab]);

    // 「设置 → 音源」只在桌面版有。
    const openSourceSettings = useMemo(
        () => (typeof window !== 'undefined' && window.electron ? () => openSettings('options', 'sources', null, 'sourceList') : undefined),
        [],
    );
    // 与网格首页同一条路：先 submitSearch 发请求（搜索页随它打开并显示加载中），完成后再 onSearchCommitted 压历史。
    // 只压历史时，历史恢复按「来源 + 词」查缓存，查不到就是空结果，要在搜索页再回车一次才真正搜索。
    // 两步必须用同一个来源：在线页签是当前 provider（resolveSearchSource 对在线页签只会回落到网易）。
    const submitSearch = useCallback(async (query: string) => {
        const { tab: current, providerId: activeProviderId, props: host } = latest.current;
        const sourceTab = isOnlineHomeTab(current) ? activeProviderId : resolveSearchSource(current);
        const didSearch = await useSearchNavigationStore.getState().submitSearch({
            query,
            sourceTab,
            deps: {
                localSongs: host.localSongs,
                localLibraryCatalog: host.localLibraryCatalog,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });
        if (didSearch) host.onSearchCommitted(query, sourceTab);
    }, [t]);

    const search = useMemo<BravaisHomeSearch>(() => ({
        title: t('libraryBravaisHome.search'),
        placeholder: t('libraryBravaisHome.searchPlaceholder'),
        hint: t('libraryBravaisHome.searchHint'),
        submitLabel: t('libraryBravaisHome.searchSubmit'),
        closeLabel: t('libraryBravaisHome.searchClose'),
        onSubmit: query => { void submitSearch(query); },
    }), [submitSearch, t]);

    const searchTool = useMemo<BravaisHomeTool>(() => ({
        id: 'search',
        // 与「过滤当前页」区分：工具格里的这一格是去在线平台搜索（切到搜索页），不是收窄这面墙。
        label: t('libraryBravaisHome.searchOnline'),
        pressed: searchOpen,
        run: () => {
            const seam = useBravaisSeamStore.getState();
            if (seam.level === 'hidden') seam.restore();
            setBravaisSearchOpen(!useBravaisHomeUiStore.getState().searchOpen);
        },
    }), [searchOpen, t]);

    const { onOpenLattice, onBackToPlayer, onOpenStagePlayer, stageEnabled, stageIsActive, onOpenSettings } = props;
    const stageActive = Boolean(stageIsActive);
    const hasLattice = Boolean(onOpenLattice);
    const hasStage = Boolean(onOpenStagePlayer && stageEnabled);
    const hasSettings = Boolean(onOpenSettings);
    // 「回到播放页」与左上角返回同一个判断：有当前歌曲才显示（没有歌时去的是空的播放页）。
    const hasCurrentSong = usePlaybackStore(selectBravaisHasCurrentSong);
    const hasPlayer = Boolean(onBackToPlayer) && hasCurrentSong;
    const updateAvailable = useUpdateIndicator();
    const appTools = useMemo<BravaisHomeTool[]>(() => {
        const tools: BravaisHomeTool[] = [];
        if (hasLattice) tools.push({ id: 'queue', label: t('home.lattice'), run: () => latest.current.props.onOpenLattice?.() });
        if (hasPlayer) tools.push({ id: 'player', label: t('libraryBravaisHome.backToPlayer'), run: () => latest.current.props.onBackToPlayer() });
        // fb11：舞台开着时它单独占工具格最上面一行（图标 + 短名「舞台」），active 与 grid 的 data-stage-active 同义。
        if (hasStage) tools.push({ id: 'stage', label: t('libraryBravaisHome.stagePlayer'), shortLabel: t('libraryBravaisHome.stageShort'), active: stageActive, run: () => latest.current.props.onOpenStagePlayer?.() });
        // 新版本说明在设置的「帮助」页（默认页）顶部，打开设置即视为看过，提示点随之消失。
        if (hasSettings) tools.push({
            id: 'settings',
            label: t('libraryBravaisHome.settings'),
            badge: updateAvailable ? t('options.updateAvailable') : undefined,
            run: () => latest.current.props.onOpenSettings?.('help'),
        });
        return tools;
    }, [hasLattice, hasPlayer, hasSettings, hasStage, stageActive, t, updateAvailable]);

    const scan = scanning ? t('libraryBravaisHome.scanProgress', { percent: scanPercent }) : null;

    return useMemo(() => ({
        title: t('libraryBravais.homeTitle'),
        tabs: seamTabs,
        onSelectTab,
        cycleTab,
        onlineSections,
        onSelectOnlineSection,
        noSources: noOnlineSources,
        openSourceSettings,
        searchTool,
        appTools,
        search,
        scan,
    }), [
        appTools, cycleTab, noOnlineSources, onSelectOnlineSection, onSelectTab, onlineSections, openSourceSettings,
        scan, search, searchTool, seamTabs, t,
    ]);
};
