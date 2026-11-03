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
import {
    subscribeCollectionPop,
    useCollectionNavigationStore,
} from '@/stores/useCollectionNavigationStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import type { GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// test/unit/navigation/collectionNavigationHistory.test.ts
// N1 在导航层的落地（真实的 useAppNavigation + jsdom 的 history）：要进入的正好是上一层时折成一次应用内返回
// （有历史就 history.back()，之后与浏览器后退同路：popstate → 弹栈通知一次 → 恢复；没有历史时手动弹一层）；
// 更早的层照常压栈、返回路径完整；popCollectionTo 跳层走历史日志 + history.go(-k)，找不到对应记录时兜底
// （先通知，再压一条截短的记录）。弹栈通知的次数就是宿主让 suite 跑 beforeBack 的次数。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Navigation = ReturnType<typeof useAppNavigation>;

const online = (type: 'album' | 'artist' | 'playlist', id: string) => ({
    source: 'online',
    providerId: 'netease',
    id,
    name: `${type} ${id}`,
    type,
} as unknown as GridViewCollectionDescriptor);

const root = online('playlist', 'root');
const skyline = online('album', 'skyline');
const polaris = online('artist', 'polaris');
const delta = online('album', 'delta');
const echo = online('artist', 'echo');

let navigation: Navigation;
const Harness = () => {
    navigation = useAppNavigation();
    return null;
};

let container: HTMLDivElement;
let reactRoot: Root;
let unsubscribe: () => void;
const pops = vi.fn();

const ids = (snapshot: { stack: GridViewCollectionDescriptor[] } | null | undefined) => (
    snapshot?.stack.map(collection => String(collection.id)) ?? []
);
const stackIds = () => ids(useCollectionNavigationStore.getState().snapshot);
const historyState = () => window.history.state as NavigationHistoryState;
/** history.back / go 的 popstate 是异步的：等它落地。 */
const settle = () => act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
});
const run = (fn: () => void) => act(() => { fn(); });

beforeEach(() => {
    localStorage.clear();
    useCollectionNavigationStore.setState({ snapshot: null });
    useAppViewStore.setState({ view: 'home' });
    pops.mockReset();
    unsubscribe = subscribeCollectionPop(pops);
    container = document.createElement('div');
    reactRoot = createRoot(container);
    act(() => reactRoot.render(React.createElement(Harness)));
});

afterEach(async () => {
    vi.restoreAllMocks();
    unsubscribe();
    act(() => reactRoot.unmount());
    await settle();
});

/** 首页 → 根歌单 → Skyline → Polaris。 */
const openThreeLayers = () => {
    run(() => navigation.navigateToCollection(root, 'home'));
    run(() => navigation.pushCollection(skyline));
    run(() => navigation.pushCollection(polaris));
};

describe('folding an immediate round trip into a back', () => {
    it('goes back through browser history when the collection is the layer right below the top', async () => {
        openThreeLayers();
        const startIndex = historyState().appHistoryIndex;
        const back = vi.spyOn(window.history, 'back');
        const go = vi.spyOn(window.history, 'go');

        run(() => navigation.pushCollection(skyline));
        // 与应用内返回同一条路：history.back()，store 不先动，等 popstate。
        expect(back).toHaveBeenCalledTimes(1);
        expect(go).not.toHaveBeenCalled();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
        await settle();

        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(historyState().appHistoryIndex).toBe(startIndex - 1);
        // 一次弹栈通知（宿主据此只跑一次 beforeBack）。
        expect(pops).toHaveBeenCalledTimes(1);
        expect(ids(pops.mock.calls[0][0])).toEqual(['root', 'skyline', 'polaris']);
        expect(ids(pops.mock.calls[0][1])).toEqual(['root', 'skyline']);
    });

    it('keeps the depth at 2–3 when bouncing between album and artist, and back lands on the previous different collection', async () => {
        openThreeLayers();
        const deepestIndex = historyState().appHistoryIndex;
        const deepestLength = window.history.length;
        for (let round = 0; round < 4; round += 1) {
            run(() => navigation.pushCollection(skyline));
            await settle();
            expect(stackIds()).toEqual(['root', 'skyline']);
            run(() => navigation.pushCollection(polaris));
            await settle();
            expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
            expect(historyState().appHistoryIndex).toBe(deepestIndex);
            expect(window.history.length).toBe(deepestLength);
        }
        expect(pops).toHaveBeenCalledTimes(4);

        // 应用内返回一次落到上一个不同的集合，历史记录与 store 一致。
        run(() => navigation.backCollection());
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(ids(historyState().collection)).toEqual(['root', 'skyline']);
        expect(pops).toHaveBeenCalledTimes(5);

        // 浏览器后退与应用内返回落在同一层：前进回到 Polaris，再用浏览器后退。
        window.history.forward();
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
        window.history.back();
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(pops).toHaveBeenCalledTimes(6);
    });

    it('still pushes a collection deeper in the stack, and back returns along the full path', async () => {
        // A B C D E 再点 B → A B C D E B；返回回到 E。
        run(() => navigation.navigateToCollection(root, 'home'));
        for (const collection of [skyline, polaris, delta, echo]) run(() => navigation.pushCollection(collection));
        const index = historyState().appHistoryIndex;
        const back = vi.spyOn(window.history, 'back');

        run(() => navigation.pushCollection(skyline));
        expect(back).not.toHaveBeenCalled();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris', 'delta', 'echo', 'skyline']);
        expect(historyState().appHistoryIndex).toBe(index + 1);

        run(() => navigation.backCollection());
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris', 'delta', 'echo']);
        run(() => navigation.backCollection());
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris', 'delta']);
        expect(pops).toHaveBeenCalledTimes(2);
    });

    it('ignores a second click while the history back is in flight', async () => {
        openThreeLayers();
        const back = vi.spyOn(window.history, 'back');
        const go = vi.spyOn(window.history, 'go');
        run(() => navigation.pushCollection(skyline));
        // 按旧栈再算一遍还是 back：不能再退一层。新的压栈、跳层也等它落地。
        run(() => navigation.pushCollection(skyline));
        run(() => navigation.pushCollection(online('album', 'other')));
        run(() => navigation.popCollectionTo(1));
        expect(back).toHaveBeenCalledTimes(1);
        expect(go).not.toHaveBeenCalled();
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(pops).toHaveBeenCalledTimes(1);

        // 落地之后照常。
        run(() => navigation.pushCollection(polaris));
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
    });

    it('pops locally (notify, then restore) when there is no history entry for the collection', () => {
        openThreeLayers();
        // 例如集合层不是经由带集合的历史记录到达的：应用内返回没有历史可退。
        window.history.replaceState({ ...historyState(), collection: null }, '');
        const back = vi.spyOn(window.history, 'back');

        run(() => navigation.pushCollection(skyline));
        expect(back).not.toHaveBeenCalled();
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(pops).toHaveBeenCalledTimes(1);
    });

    it('still ignores the collection on top and pushes new ones as before', async () => {
        run(() => navigation.navigateToCollection(root, 'home'));
        const index = historyState().appHistoryIndex;
        run(() => navigation.pushCollection(root));
        await settle();
        expect(historyState().appHistoryIndex).toBe(index);
        expect(stackIds()).toEqual(['root']);

        run(() => navigation.pushCollection(skyline));
        expect(historyState().appHistoryIndex).toBe(index + 1);
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(pops).not.toHaveBeenCalled();
    });
});

describe('popCollectionTo', () => {
    it('jumps to a depth through history.go(-k), and depth 0 closes the collection layer', async () => {
        openThreeLayers();
        run(() => navigation.popCollectionTo(3));
        run(() => navigation.popCollectionTo(-1));
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris']);
        expect(pops).not.toHaveBeenCalled();

        const go = vi.spyOn(window.history, 'go');
        run(() => navigation.popCollectionTo(1));
        expect(go).toHaveBeenCalledWith(-2);
        await settle();
        expect(stackIds()).toEqual(['root']);
        expect(pops).toHaveBeenCalledTimes(1);

        run(() => navigation.pushCollection(polaris));
        run(() => navigation.popCollectionTo(0));
        await settle();
        expect(useCollectionNavigationStore.getState().snapshot).toBeNull();
        expect(historyState().collection ?? null).toBeNull();
        expect(historyState().view).toBe('home');
        expect(pops).toHaveBeenCalledTimes(2);
    });

    it('counts positions when the stack holds a duplicate', async () => {
        run(() => navigation.navigateToCollection(root, 'home'));
        for (const collection of [skyline, polaris, delta, echo, skyline]) run(() => navigation.pushCollection(collection));
        expect(stackIds()).toEqual(['root', 'skyline', 'polaris', 'delta', 'echo', 'skyline']);
        const go = vi.spyOn(window.history, 'go');

        // 面包屑上靠前的那个 Skyline（第 2 层）：退 4 步，而不是落到栈顶那一份。
        run(() => navigation.popCollectionTo(2));
        expect(go).toHaveBeenCalledWith(-4);
        await settle();
        expect(stackIds()).toEqual(['root', 'skyline']);
        expect(pops).toHaveBeenCalledTimes(1);
    });

    it('falls back to notify-then-push when the history entry cannot be found', async () => {
        openThreeLayers();
        // 当前记录换成另一个页面会话写的（例如刷新之前留下的）：日志对不上了。
        const current = historyState();
        window.history.replaceState({ ...current, appHistorySession: 'before-reload' }, '');
        const go = vi.spyOn(window.history, 'go');
        const lengthBefore = window.history.length;

        run(() => navigation.popCollectionTo(1));
        await settle();

        expect(go).not.toHaveBeenCalled();
        expect(pops).toHaveBeenCalledTimes(1);
        expect(stackIds()).toEqual(['root']);
        expect(window.history.length).toBe(lengthBefore + 1);
        expect(ids(historyState().collection)).toEqual(['root']);
    });
});
