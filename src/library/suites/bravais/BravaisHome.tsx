import React, { useCallback } from 'react';
import type { LibraryHomeSurfaceProps } from '../../core/suite/suite.contract';
import type { LibraryHomeTabKey } from '../../core/home/homeModel.contract';
import { isOnlineHomeTab } from '../../core/home/homeSources';
import { useLibraryHomeSources } from '../../core/home/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../core/home/online/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../core/home/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../core/home/useLibraryHomeDirectory';
import { useLibraryHomeTabsRegistration } from '../../core/home/useLibraryHomeSurfaceRegistration';
import { setBravaisSearchOpen } from './bravaisHomeUiStore';
import { useBravaisHomeChrome } from './useBravaisHomeChrome';
import { BravaisHomeLocal, BravaisHomeNavidrome, BravaisHomeOnline } from './BravaisHomeSources';
import BravaisHomeExplore from './BravaisHomeExplore';
import { BravaisHomeNoSources } from './BravaisHomeNotice';
import BravaisHomeFolia from './BravaisHomeFolia';

// src/library/suites/bravais/BravaisHome.tsx
// 首页 surface（B9，设计稿 §10.5）：两级页签——缝里一级是组（Folia、当前在线音源、本地、Navidrome），二级是组里的页
// （在线组的歌单 / 电台 / 专辑 / 探索，本地三行，Navidrome 的 section）。各页（歌单 / 电台 / 专辑 / 探索 / 本地 / Navidrome）都铺墙；
// Folia 组是聚合歌单的墙（BravaisHomeFolia）。探索按网格探索拼贴的
// 排法铺（BravaisHomeExplore）。与 TUI、网格用同一套首页
// 绑定（来源与页签、在线列表、首页资源与动作都来自 core，换 suite 不重新请求），按当前来源挂一个来源组件
// （BravaisHomeSources），它把当前页签 / section 的卡片投影成首页层推进 stage store；这里自己只渲染一个不可见的锚点。
// 切页签 = 换首页层（`home:<页签>`）：stage 整墙出场 → 入场；本地四行、Navidrome 的 section 是缝里的二级切换，不换层。
// 页签条交给首页 surface 句柄（useLibraryHomeTabsRegistration），命令面板的「打开歌单 / 本地…」写的是同一个页签。

const BravaisHome: React.FC<LibraryHomeSurfaceProps> = (props) => {
    const {
        account,
        user,
        playlists,
        cloudPlaylist,
        navidromeEnabled,
        localMusicState,
        setLocalMusicState,
        homeResources,
        directoryActions,
        onOpenGridView,
        isInteractive,
        declaredActions,
    } = props;
    const sources = useLibraryHomeSources({ account, user, playlists, cloudPlaylist, navidromeEnabled, folia: true });
    const { tab, setTab, tabs, groups, noOnlineSources, online } = sources;
    const onlineList = useLibraryHomeOnline(homeResources, sources);
    const { scanPercent, snapshot: actionState } = useLibraryHomeActions(homeResources.actions);
    const { directoryKey, hiddenScope } = useLibraryHomeDirectory({
        tab,
        providerId: online.providerId,
        localRow: localMusicState.activeRow,
    });

    const selectTab = useCallback((key: LibraryHomeTabKey) => {
        const target = tabs.find(candidate => candidate.key === key);
        // 不可用的页不让选，除非它是某个组的落点：在线组一页都不可用（没有启用音源、当前音源没有这些页）时仍要进得去，
        // 那一页说的正是为什么不可用、去哪里启用。
        if (!target || (target.disabledReason && !groups.some(group => group.target === key))) return false;
        props.onNativeTabSelected?.();
        setBravaisSearchOpen(false);
        setTab(key);
        return true;
    }, [groups, setTab, tabs, props.onNativeTabSelected]);

    const chrome = useBravaisHomeChrome({
        tab,
        tabs,
        groups,
        noOnlineSources,
        providerId: online.providerId,
        selectTab,
        scanPercent,
        scanning: Boolean(actionState.scan?.active),
        props,
    });
    // F6 的循环也交给句柄：模组的首页页面盖住首页时墙的按键监听让出，页面里按 F6 经句柄接着循环。
    useLibraryHomeTabsRegistration({
        getState: () => ({ active: tab, tabs, groups }),
        setTab: selectTab,
        cycleTab: chrome.cycleTab,
    });
    const tabLabel = (key: LibraryHomeTabKey) => tabs.find(candidate => candidate.key === key)?.label ?? key;
    const common = {
        chrome,
        directoryKey,
        hiddenScope,
        declaredActions,
        isInteractive,
        homeActions: homeResources.actions,
        onOpenGridView,
    };

    return (
        <div
            data-library-home="bravais"
            data-library-surface="home"
            data-ponder-page-scope="bravais-wall"
            aria-hidden
            className="pointer-events-none absolute inset-0"
        >
            {tab === 'folia' ? (
                <BravaisHomeFolia {...common} meta={tabLabel('folia')} playlists={props.localPlaylists} localSongs={props.localSongs} />
            ) : isOnlineHomeTab(tab) && chrome.noSources ? (
                <BravaisHomeNoSources chrome={chrome} isInteractive={isInteractive} meta={groups.find(group => group.key === 'online')?.label ?? ''} layerKey={`home:${tab}`} />
            ) : tab === 'explore' ? (
                <BravaisHomeExplore
                    chrome={chrome}
                    online={online}
                    account={account}
                    isInteractive={isInteractive}
                    declaredActions={declaredActions}
                    playback={props.playback}
                    onPlaySong={props.onPlaySong}
                    onOpenGridView={onOpenGridView}
                />
            ) : isOnlineHomeTab(tab) ? (
                <BravaisHomeOnline {...common} tab={tab} online={online} list={onlineList} account={account} />
            ) : tab === 'local' ? (
                <BravaisHomeLocal
                    {...common}
                    meta={tabLabel('local')}
                    localSongs={props.localSongs}
                    catalog={props.localLibraryCatalog}
                    activeRow={localMusicState.activeRow}
                    setActiveRow={row => setLocalMusicState(previous => ({ ...previous, activeRow: row }))}
                    treesResource={homeResources.localDirectoryTrees}
                    directoryActions={directoryActions}
                />
            ) : (
                <BravaisHomeNavidrome {...common} meta={tabLabel('navidrome')} overview={homeResources.navidromeOverview} />
            )}
        </div>
    );
};

export default BravaisHome;
