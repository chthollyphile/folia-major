import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/core/hiddenCollectionsStore.test.ts
// 隐藏项 store：沿用 localStorage `hidden_grid_playlists` 与它的格式（Record<scope, id[]>），
// 旧数据原样读出；切换写回同一格式（取消隐藏留空数组）；没变化不写；存储坏了退回空表。

const STORAGE_KEY = 'hidden_grid_playlists';

const loadStore = async (initial?: string, options: { throwOnSet?: boolean } = {}) => {
    const storage = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
    const setItem = vi.fn((key: string, value: string) => {
        if (options.throwOnSet) throw new Error('quota');
        storage.set(key, value);
    });
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem,
    });
    vi.resetModules();
    const { useHiddenCollectionsStore } = await import('@/library/core/collection/useHiddenCollectionsStore');
    return { useHiddenCollectionsStore, storage, setItem };
};

describe('hidden collections store', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the existing table and writes toggles back in the same format', async () => {
        const { useHiddenCollectionsStore, storage } = await loadStore(JSON.stringify({ 'online:a': ['owned'], navidrome: [] }));
        expect(useHiddenCollectionsStore.getState().hiddenByScope).toEqual({ 'online:a': ['owned'], navidrome: [] });

        useHiddenCollectionsStore.getState().toggleHidden('local', 'playlist-1');
        useHiddenCollectionsStore.getState().toggleHidden('online:a', 'owned');
        expect(JSON.parse(storage.get(STORAGE_KEY)!)).toEqual({ 'online:a': [], navidrome: [], local: ['playlist-1'] });
        expect(useHiddenCollectionsStore.getState().hiddenByScope).toEqual({ 'online:a': [], navidrome: [], local: ['playlist-1'] });
    });

    it('does not write or notify when setHidden changes nothing', async () => {
        const { useHiddenCollectionsStore, setItem } = await loadStore(JSON.stringify({ local: ['x'] }));
        const listener = vi.fn();
        const unsubscribe = useHiddenCollectionsStore.subscribe(listener);
        useHiddenCollectionsStore.getState().setHidden('local', 'x', true);
        useHiddenCollectionsStore.getState().setHidden('navidrome', 'y', false);
        expect(setItem).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        unsubscribe();
    });

    it('starts empty from broken storage and keeps changes in memory when writing fails', async () => {
        const { useHiddenCollectionsStore } = await loadStore('{not json', { throwOnSet: true });
        expect(useHiddenCollectionsStore.getState().hiddenByScope).toEqual({});
        useHiddenCollectionsStore.getState().toggleHidden('default', 'a');
        expect(useHiddenCollectionsStore.getState().hiddenByScope).toEqual({ default: ['a'] });
    });

    it('hydrate re-reads storage written elsewhere', async () => {
        const { useHiddenCollectionsStore, storage } = await loadStore();
        expect(useHiddenCollectionsStore.getState().hiddenByScope).toEqual({});
        storage.set(STORAGE_KEY, JSON.stringify({ local: ['p'] }));
        useHiddenCollectionsStore.getState().hydrate();
        expect(useHiddenCollectionsStore.getState().hiddenByScope).toEqual({ local: ['p'] });
    });
});
