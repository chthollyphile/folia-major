import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getActiveGridViewCollection,
    isCollectionPop,
    notifyCollectionPop,
    subscribeCollectionOpen,
    subscribeCollectionPop,
    useCollectionNavigationStore,
} from '@/stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// test/unit/stores/collectionNavigationStore.test.ts
// 导航栈「不许压一份当前层的副本」这条规则：详情页里的卡片带着自己所属集合的入口
// （专辑详情的曲目卡片有专辑链接、歌手页有歌手链接），照旧压栈的话每点一次多一层，
// 画面没变但返回要按好几次才退得出去。N1 起再折叠紧邻往返：要进入的正好是上一层时当作一次返回（store 不动，
// 交给导航层走应用内返回）；更早的层照常压栈。

const album = (id: string | number): GridViewCollectionDescriptor => ({
    source: 'online',
    providerId: 'netease',
    id,
    name: `Album ${id}`,
    type: 'album',
} as unknown as GridViewCollectionDescriptor);

const artist = (id: string | number): GridViewCollectionDescriptor => ({
    source: 'online',
    providerId: 'netease',
    id,
    name: `Artist ${id}`,
    type: 'artist',
} as unknown as GridViewCollectionDescriptor);

describe('collection navigation store', () => {
    beforeEach(() => {
        useCollectionNavigationStore.setState({ snapshot: null });
    });

    it('pushes a different collection onto the stack', () => {
        useCollectionNavigationStore.getState().openRoot(album('a1'), 'home');
        const decision = useCollectionNavigationStore.getState().push(artist('ar1'));

        expect(decision.kind).toBe('push');
        const snapshot = useCollectionNavigationStore.getState().snapshot;
        expect(decision.kind === 'push' && decision.snapshot).toBe(snapshot);
        expect(snapshot?.stack).toHaveLength(2);
        expect(getActiveGridViewCollection(snapshot)?.type).toBe('artist');
    });

    // 回归点：专辑详情里点曲目卡片上的专辑链接 = 点自己。
    it('refuses to stack a copy of the collection already being viewed', () => {
        useCollectionNavigationStore.getState().openRoot(album('a1'), 'home');
        const pushed = useCollectionNavigationStore.getState().push(album('a1'));

        // noop 表示「什么都没发生」：调用方（useAppNavigation）据此不再写一条浏览器历史。
        expect(pushed).toEqual({ kind: 'noop' });
        expect(useCollectionNavigationStore.getState().snapshot?.stack).toHaveLength(1);
    });

    it('compares ids as strings, because one path may carry a number and another a string', () => {
        useCollectionNavigationStore.getState().openRoot(album(42), 'home');
        expect(useCollectionNavigationStore.getState().push(album('42')).kind).toBe('noop');
    });

    it('still pushes a different type or a different source that happens to share the id', () => {
        useCollectionNavigationStore.getState().openRoot(album('shared'), 'home');

        expect(useCollectionNavigationStore.getState().push(artist('shared')).kind).toBe('push');
        expect(useCollectionNavigationStore.getState().snapshot?.stack).toHaveLength(2);
        useCollectionNavigationStore.getState().push({
            source: 'local',
            id: 'shared',
            name: 'Local',
            type: 'album',
        } as unknown as GridViewCollectionDescriptor);
        expect(useCollectionNavigationStore.getState().snapshot?.stack).toHaveLength(3);
    });

    // 两个 provider 下的歌单 id 可以相同；身份不带 provider 时，后一个会被当成「已经在看的那一层」。
    it('treats the same type and id from another provider as a different collection', () => {
        useCollectionNavigationStore.getState().openRoot(album('same'), 'home');
        const fromOtherProvider = { ...album('same'), providerId: 'kugou' } as GridViewCollectionDescriptor;

        expect(useCollectionNavigationStore.getState().push(fromOtherProvider).kind).toBe('push');
        expect(useCollectionNavigationStore.getState().snapshot?.stack).toHaveLength(2);
        expect(useCollectionNavigationStore.getState().push({ ...fromOtherProvider }).kind).toBe('noop');
    });

    // N1（折叠紧邻往返）：要进入的正好是上一层时是一次返回。store 只给出决定、自己不动：
    // 弹栈由导航层走应用内返回完成（有历史就 history.back()），store 随 popstate 恢复。
    it('decides to go back when the collection is the layer right below the top, without touching the store', () => {
        useCollectionNavigationStore.getState().openRoot(album('a1'), 'home');
        useCollectionNavigationStore.getState().push(artist('ar1'));
        useCollectionNavigationStore.getState().push(album('a2'));
        const before = useCollectionNavigationStore.getState().snapshot;

        const decision = useCollectionNavigationStore.getState().push(artist('ar1'));

        expect(decision).toEqual({ kind: 'back', to: { origin: 'home', stack: [album('a1'), artist('ar1')] } });
        expect(useCollectionNavigationStore.getState().snapshot).toBe(before);
    });

    // 有意只折叠紧邻往返：跳到栈里更早访问过的集合仍然算一次正常导航，退回那一层会连带丢掉中间层级。
    it('still pushes a collection that sits deeper in the stack', () => {
        useCollectionNavigationStore.getState().openRoot(album('a1'), 'home');
        useCollectionNavigationStore.getState().push(artist('ar1'));
        useCollectionNavigationStore.getState().push(album('a2'));

        expect(useCollectionNavigationStore.getState().push(album('a1')).kind).toBe('push');
        expect(useCollectionNavigationStore.getState().snapshot?.stack).toHaveLength(4);
    });

    it('does nothing without an open root', () => {
        expect(useCollectionNavigationStore.getState().push(album('a1')).kind).toBe('noop');
        expect(useCollectionNavigationStore.getState().snapshot).toBeNull();
    });
});

// P4.5：弹栈通知。浏览器后退（popstate）直接恢复历史里的栈、不经过集合宿主；宿主靠这个通知在 store 变化之前
// 让 suite 跑 beforeBack。只有真正的弹栈才通知：压栈、换成别的集合、只换视图都不算。
describe('collection pop notification', () => {
    beforeEach(() => {
        useCollectionNavigationStore.setState({ snapshot: null });
    });

    it('recognises a pop: closing, or the same root with fewer of the same layers', () => {
        const from = { origin: 'home' as const, stack: [album(1), artist(2)] };
        expect(isCollectionPop(from, null)).toBe(true);
        expect(isCollectionPop(from, { origin: 'home', stack: [album(1)] })).toBe(true);
        expect(isCollectionPop(from, { origin: 'home', stack: [album(1), artist(2), album(3)] })).toBe(false);
        expect(isCollectionPop(from, { origin: 'home', stack: [album(9)] })).toBe(false);
        expect(isCollectionPop(from, { origin: 'search', stack: [album(1)] })).toBe(false);
        expect(isCollectionPop(from, from)).toBe(false);
        expect(isCollectionPop(null, null)).toBe(false);
    });

    it('notifies with the snapshot before the store changes, and only for pops', () => {
        const store = useCollectionNavigationStore.getState();
        store.openRoot(album(1), 'home');
        store.push(artist(2));
        const before = useCollectionNavigationStore.getState().snapshot!;
        const seen = vi.fn((from: unknown) => {
            // 监听者运行时 store 还是弹栈前的样子。
            expect(useCollectionNavigationStore.getState().snapshot).toBe(from);
        });
        const unsubscribe = subscribeCollectionPop(seen);

        notifyCollectionPop({ ...before, stack: [...before.stack, album(3)] });
        expect(seen).not.toHaveBeenCalled();
        const next = { ...before, stack: [album(1)] };
        notifyCollectionPop(next);
        expect(seen).toHaveBeenCalledTimes(1);
        expect(seen).toHaveBeenCalledWith(before, next);

        unsubscribe();
        notifyCollectionPop(null);
        expect(seen).toHaveBeenCalledTimes(1);
    });
});

// 「显式打开了集合」：openRoot 与真的压了新一层的 push 通知，store 已经是新快照；历史恢复、清空、noop / back 不通知。
// 盖在首页上的模组首页页面据此让开（components/app/home/foliumHomePageDismissal）。
describe('collection open notification', () => {
    beforeEach(() => {
        useCollectionNavigationStore.setState({ snapshot: null });
    });

    it('notifies after openRoot and an actual push, and not for restores, clears, noops or backs', () => {
        const seen = vi.fn((snapshot: unknown) => {
            expect(useCollectionNavigationStore.getState().snapshot).toBe(snapshot);
        });
        const unsubscribe = subscribeCollectionOpen(seen);
        const store = useCollectionNavigationStore.getState();

        const root = store.openRoot(album(1), 'player');
        expect(seen).toHaveBeenCalledTimes(1);
        expect(seen).toHaveBeenLastCalledWith(root);
        const pushed = store.push(artist(2));
        expect(seen).toHaveBeenCalledTimes(2);
        expect(seen).toHaveBeenLastCalledWith(pushed.kind === 'push' ? pushed.snapshot : null);

        expect(store.push(artist(2)).kind).toBe('noop');
        expect(store.push(album(1)).kind).toBe('back');
        store.restore({ origin: 'home', stack: [album(1), artist(2), album(3)] });
        store.restore(null);
        store.clear();
        expect(seen).toHaveBeenCalledTimes(2);

        unsubscribe();
        store.openRoot(album(4), 'search');
        expect(seen).toHaveBeenCalledTimes(2);
    });
});
