import { useEffect, useRef, useState } from 'react';
import type { LibraryHomeResources } from '../core/home/homeModel.contract';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { createFavoriteAlbumsFeed, createRadioFeed } from '../core/home/online/onlineHomeFeeds.service';
import { onlineHomeFeedDeps } from '../core/home/online/onlineHomeFeedDeps.service';
import { createLibraryHomeActions } from '../core/home/libraryHomeActions.service';
import { createNavidromeHomeLibrary } from '../core/home/navidrome/navidromeHomeLibrary.service';
import { navidromeHomeLibraryDeps } from '../core/home/navidrome/navidromeHomeLibraryDeps.service';
import { createLocalDirectoryTrees } from '../core/directory/localDirectoryTrees.service';
import { localDirectoryTreesDeps } from '../core/directory/localDirectoryTreesDeps.service';
import { invalidateLeftHomeTab, releaseLibraryHomeResources } from '../core/home/libraryHomeLifetime.service';
import { closeOpenLibraryDirectory } from '../core/directory/useLibraryDirectorySessionStore';
import { useSearchNavigationStore } from '../../stores/useSearchNavigationStore';
import { createLibraryHomePort } from './createLibraryHomePort';

// src/library/app/useLibraryHomeResources.ts
// 首页外壳持有的首页资源（与 useLibraryDirectoryBatchController 同一个做法）：一个首页一份，生命周期跟着首页，
// 不随渲染重建——任何 suite 的首页都订阅同一份。数据的归属由正在显示的首页 surface 经绑定设置、读取经绑定 ensure；
// 换 suite 时新 surface 认领的是同一份数据，不重新请求。数据什么时候作废由这里按「首页真的离开」决定
// （core/home/libraryHomeLifetime.service）：首页整个藏起（active=false，切到播放页之后）或宿主卸载时放掉在线数据的归属、
// 让 Navidrome 概览与文件夹树作废，并关掉打开着的目录（目录会话随之丢掉）；离开 Navidrome / 本地页签时让那个页签的
// 数据作废。首页动作的端口经 ref 现读最新的 surface。
//
// 「收藏专辑变了」的通知仍是窗口事件 `folia-refresh-favorite-albums`（变更端口在订阅 / 取消订阅专辑后派发，
// 应用里别处与探针也派发它）：在这里保留一个兼容的监听，收到就让收藏专辑资源重新读。监听放在宿主而不是某个
// suite 的首页里，换 suite 不会漏掉通知；资源本身不碰 window，单测不需要 DOM 事件。

export const FAVORITE_ALBUMS_CHANGED_EVENT = 'folia-refresh-favorite-albums';

export const useLibraryHomeResources = (
    surface: HomeSurfaceProps,
    {
        active = true,
    }: {
        /** 首页此刻在显示（Home 外壳在 isHomeFullyHidden 时为 false：首页的 surface 已经卸载）。 */
        active?: boolean;
    } = {},
): LibraryHomeResources => {
    // 渲染时赋值（不放 effect）：effect 之前的窗口里动作会读到上一次渲染的曲库与回调。
    const surfaceRef = useRef(surface);
    surfaceRef.current = surface;
    const [resources] = useState<LibraryHomeResources>(() => ({
        favoriteAlbums: createFavoriteAlbumsFeed(onlineHomeFeedDeps),
        radioFeed: createRadioFeed(onlineHomeFeedDeps),
        actions: createLibraryHomeActions(createLibraryHomePort(() => surfaceRef.current)),
        navidromeOverview: createNavidromeHomeLibrary(navidromeHomeLibraryDeps),
        localDirectoryTrees: createLocalDirectoryTrees(localDirectoryTreesDeps),
    }));

    // 首页真的离开：藏起（surface 已在同一次提交里卸载，子组件的清理先于这里）与宿主卸载都算。
    // 回到首页时 surface 重新挂载、绑定重新认领与 ensure，于是重新读（homeCardPosition 的延迟专辑用例锁着它）。
    useEffect(() => {
        if (!active) return undefined;
        return () => {
            releaseLibraryHomeResources(resources);
            closeOpenLibraryDirectory();
        };
    }, [active, resources]);

    // 页签切换不经任何 suite：直接看搜索导航 store 的首页页签（订阅不触发渲染，Home 不因此重渲染）。
    useEffect(() => useSearchNavigationStore.subscribe((state, previous) => {
        invalidateLeftHomeTab(resources, previous.homeViewTab, state.homeViewTab);
    }), [resources]);

    useEffect(() => {
        const reloadFavoriteAlbums = () => {
            void resources.favoriteAlbums.reload();
        };
        window.addEventListener(FAVORITE_ALBUMS_CHANGED_EVENT, reloadFavoriteAlbums);
        return () => window.removeEventListener(FAVORITE_ALBUMS_CHANGED_EVENT, reloadFavoriteAlbums);
    }, [resources]);

    return resources;
};
