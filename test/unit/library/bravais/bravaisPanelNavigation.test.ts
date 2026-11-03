// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    // jsdom 环境下 node 自带的 localStorage 占位没有 getItem，i18n 初始化会直接抛。
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
            setItem: (key: string, value: string) => { entries.set(key, String(value)); },
            removeItem: (key: string) => { entries.delete(key); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAppNavigation, type NavigationHistoryState } from '@/hooks/useAppNavigation';
import { subscribeCollectionPop, useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import type { GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { collectionKey } from '@/library/core/collection/collectionIdentity';
import {
    closeBravaisPanel,
    openBravaisPanel,
    readPanelHistoryMarker,
    syncPanelWithHistory,
} from '@/library/suites/bravais/bravaisPanelHistory';
import { useBravaisUiStore } from '@/library/suites/bravais/bravaisUiStore';

// test/unit/library/bravais/bravaisPanelNavigation.test.ts
// bravais 列表面板的 history 记录（suite 直接 pushState：当前记录 + bravaisPanel 标记、appHistoryIndex + 1）与 N1 的
// 导航层（真实 useAppNavigation + jsdom history + 历史日志）共存：
// - 面板记录沿用当前记录的 appHistorySession，日志认它是本会话的记录；
// - 面板开着时点到上一层（折叠往返）要连面板记录一起退、落到上一层，弹栈通知一次（stage 的反向翻牌一次）；
// - 应用内返回仍先关面板（只退一步，栈不变，不算弹栈）；
// - 面包屑跳层落在目标层的第一条记录上，不落在它的面板记录上。
// stage 的 popstate 监听在这里由 syncPanelWithHistory 代替（stage 里就是它）。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const online = (type: 'album' | 'artist' | 'playlist', id: string) => ({
    source: 'online',
    providerId: 'netease',
    id,
    name: `${type} ${id}`,
    type,
} as unknown as GridViewCollectionDescriptor);

const root = online('playlist', 'root');
const album = online('album', 'skyline');
const artist = online('artist', 'polaris');

let navigation: ReturnType<typeof useAppNavigation>;
const Harness = () => {
    navigation = useAppNavigation();
    return null;
};

let container: HTMLDivElement;
let reactRoot: Root;
let unsubscribe: () => void;
const pops = vi.fn();

const stackIds = () => useCollectionNavigationStore.getState().snapshot?.stack.map(collection => String(collection.id)) ?? [];
const historyState = () => window.history.state as NavigationHistoryState & { bravaisPanel?: string };
const historyIds = () => historyState().collection?.stack.map(collection => String(collection.id)) ?? [];
const panelFor = () => useBravaisUiStore.getState().panelFor;
/** history.back / go 的 popstate 是异步的：等它落地。 */
const settle = () => act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
});
const run = (fn: () => void) => act(() => { fn(); });

beforeEach(() => {
    localStorage.clear();
    useCollectionNavigationStore.setState({ snapshot: null });
    useAppViewStore.setState({ view: 'home' });
    useBravaisUiStore.setState({ panelFor: null });
    pops.mockReset();
    unsubscribe = subscribeCollectionPop(pops);
    // stage 的 popstate 监听：面板开合跟着当前记录上的标记走。
    window.addEventListener('popstate', syncPanelWithHistory);
    container = document.createElement('div');
    reactRoot = createRoot(container);
    act(() => reactRoot.render(React.createElement(Harness)));
});

afterEach(async () => {
    vi.restoreAllMocks();
    window.removeEventListener('popstate', syncPanelWithHistory);
    unsubscribe();
    act(() => reactRoot.unmount());
    await settle();
});

/** 首页 → 歌单 → 专辑 → 歌手。 */
const openThreeLayers = () => {
    run(() => navigation.navigateToCollection(root, 'home'));
    run(() => navigation.pushCollection(album));
    run(() => navigation.pushCollection(artist));
};

describe('bravais list panel records under N1', () => {
    it('writes the panel record with the session marker and the next index', () => {
        openThreeLayers();
        const base = historyState();
        run(() => openBravaisPanel(collectionKey(artist)));
        expect(panelFor()).toBe(collectionKey(artist));
        expect(historyState()).toMatchObject({
            appHistoryIndex: base.appHistoryIndex + 1,
            appHistorySession: base.appHistorySession,
            bravaisPanel: collectionKey(artist),
        });
        expect(historyIds()).toEqual(['root', 'skyline', 'polaris']);
    });

    it('folding into the layer below with the panel open leaves the layer (panel record included), popping once', async () => {
        openThreeLayers();
        const albumIndex = historyState().appHistoryIndex - 1;
        run(() => openBravaisPanel(collectionKey(artist)));
        const go = vi.spyOn(window.history, 'go');

        run(() => navigation.pushCollection(album));
        expect(go).toHaveBeenCalledWith(-2);
        await settle();

        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(historyState().appHistoryIndex).toBe(albumIndex);
        expect(readPanelHistoryMarker()).toBeNull();
        expect(panelFor()).toBeNull();
        // 一次弹栈通知（宿主 beforeBack 一次；bravais 的 stage 看到深度变浅，按返回翻一次）。
        expect(pops).toHaveBeenCalledTimes(1);
    });

    it('folding back onto a layer whose panel stayed open (push keeps it) lands where a back would: the panel reopens', async () => {
        run(() => navigation.navigateToCollection(root, 'home'));
        run(() => navigation.pushCollection(album));
        run(() => openBravaisPanel(collectionKey(album)));
        const panelIndex = historyState().appHistoryIndex;
        run(() => navigation.pushCollection(artist));
        expect(panelFor()).toBe(collectionKey(album));
        const back = vi.spyOn(window.history, 'back');

        run(() => navigation.pushCollection(album));
        expect(back).toHaveBeenCalledTimes(1);
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(historyState().appHistoryIndex).toBe(panelIndex);
        expect(panelFor()).toBe(collectionKey(album));
        expect(pops).toHaveBeenCalledTimes(1);
    });

    it('an in-app back still closes the panel first (one step, same stack)', async () => {
        openThreeLayers();
        run(() => openBravaisPanel(collectionKey(artist)));
        run(() => navigation.backCollection());
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
        expect(panelFor()).toBeNull();
        // 同一个栈：不算弹栈（没有弹栈通知，suite 不跑 beforeBack）。
        expect(pops).not.toHaveBeenCalled();

        // 关掉之后的折叠往返就是普通的一步返回。
        const back = vi.spyOn(window.history, 'back');
        run(() => navigation.pushCollection(album));
        expect(back).toHaveBeenCalledTimes(1);
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline']);
    });

    it('closing the panel in-app while its record is on top goes back one step', async () => {
        openThreeLayers();
        const index = historyState().appHistoryIndex;
        run(() => openBravaisPanel(collectionKey(artist)));
        run(() => closeBravaisPanel());
        await settle();
        expect(historyState().appHistoryIndex).toBe(index);
        expect(panelFor()).toBeNull();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
    });

    it('a breadcrumb jump skips the panel records of the target layer and of the current one', async () => {
        run(() => navigation.navigateToCollection(root, 'home'));
        const rootIndex = historyState().appHistoryIndex;
        run(() => openBravaisPanel(collectionKey(root)));
        run(() => navigation.pushCollection(album));
        run(() => navigation.pushCollection(artist));
        run(() => openBravaisPanel(collectionKey(artist)));
        const go = vi.spyOn(window.history, 'go');

        run(() => navigation.popCollectionTo(1));
        expect(go).toHaveBeenCalledWith(-4);
        await settle();
        expect(stackIds()).toEqual(['root']);
        expect(historyState().appHistoryIndex).toBe(rootIndex);
        expect(panelFor()).toBeNull();
        expect(pops).toHaveBeenCalledTimes(1);
    });

    it('closing everything with a panel record on the root lands before the root', async () => {
        run(() => navigation.navigateToCollection(root, 'home'));
        const rootIndex = historyState().appHistoryIndex;
        run(() => openBravaisPanel(collectionKey(root)));
        run(() => navigation.pushCollection(album));
        const go = vi.spyOn(window.history, 'go');

        run(() => navigation.popCollectionTo(0));
        expect(go).toHaveBeenCalledWith(-3);
        await settle();
        expect(useCollectionNavigationStore.getState().snapshot).toBeNull();
        expect(historyState().appHistoryIndex).toBe(rootIndex - 1);
        expect(panelFor()).toBeNull();
    });
});
