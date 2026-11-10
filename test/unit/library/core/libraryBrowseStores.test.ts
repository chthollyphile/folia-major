import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    flushLibrarySession,
    getLibraryBrowseSession,
    getLibrarySessionGeneration,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '@/library/core/shared/useLibraryBrowseSessionStore';

// test/unit/library/core/libraryBrowseStores.test.ts
// 浏览会话（筛选词、语义焦点）按集合分开、有上限；「把焦点写回会话」的回调只认最后注册的那个。
// 本地排序 store 沿用原来的两个 localStorage 键与取值校验。

describe('library browse session store', () => {
    beforeEach(() => useLibraryBrowseSessionStore.setState({ sessions: {}, order: [] }));

    it('keeps query and focus per collection and clears one without touching the others', () => {
        const store = useLibraryBrowseSessionStore.getState();
        store.setQuery('a', 'cedar');
        store.setFocusedEntry('a', 'online:p:1-0');
        store.setQuery('b', 'amber');
        store.clearSession('b');

        expect(getLibraryBrowseSession('a')).toEqual({ query: 'cedar', focusedEntryKey: 'online:p:1-0' });
        expect(getLibraryBrowseSession('b')).toEqual({ query: '', focusedEntryKey: null });
    });

    // P4.5：「完成」清会话时换代。正在离开的那一层（TUI）卸载时的写回带着挂载时的代，代变了就不写。
    it('bumps the generation on every clear, even when there was no session to clear', () => {
        const store = useLibraryBrowseSessionStore.getState();
        const start = getLibrarySessionGeneration('gen');
        store.clearSession('gen');
        expect(getLibrarySessionGeneration('gen')).toBe(start + 1);
        store.setQuery('gen', 'q');
        store.clearSession('gen');
        expect(getLibrarySessionGeneration('gen')).toBe(start + 2);
        expect(getLibrarySessionGeneration('other')).toBe(0);
    });

    it('drops the least recently used session beyond 32', () => {
        const store = useLibraryBrowseSessionStore.getState();
        for (let index = 0; index < 33; index += 1) store.setQuery(`s${index}`, 'q');
        store.setQuery('s1', 'touched');
        store.setQuery('s33', 'q');

        const { sessions } = useLibraryBrowseSessionStore.getState();
        expect(Object.keys(sessions)).toHaveLength(32);
        expect(sessions.s0).toBeUndefined();
        expect(sessions.s2).toBeUndefined();
        expect(sessions.s1?.query).toBe('touched');
    });

    it('does not notify for a write that changes nothing', () => {
        const listener = vi.fn();
        const unsubscribe = useLibraryBrowseSessionStore.subscribe(listener);
        useLibraryBrowseSessionStore.getState().setQuery('a', '');
        useLibraryBrowseSessionStore.getState().setFocusedEntry('a', null);
        expect(listener).not.toHaveBeenCalled();
        unsubscribe();
    });

    it('flushes only through the latest registered renderer', () => {
        const oldFlush = vi.fn();
        const newFlush = vi.fn();
        const unregisterOld = registerLibrarySessionFlush('a', oldFlush);
        const unregisterNew = registerLibrarySessionFlush('a', newFlush);
        unregisterOld();
        flushLibrarySession('a');
        expect(oldFlush).not.toHaveBeenCalled();
        expect(newFlush).toHaveBeenCalledTimes(1);
        unregisterNew();
        flushLibrarySession('a');
        expect(newFlush).toHaveBeenCalledTimes(1);
    });
});

describe('local track sort store', () => {
    it('reads the existing keys, falls back on unknown values and writes choices back', async () => {
        const storage = new Map<string, string>([
            ['local_track_sort_field', 'albumTrack'],
            ['local_track_sort_direction', 'sideways'],
        ]);
        vi.stubGlobal('window', {});
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        });
        vi.resetModules();
        const { useLocalTrackSortStore } = await import('@/library/core/directory/useLocalTrackSortStore');

        expect(useLocalTrackSortStore.getState()).toMatchObject({ field: 'albumTrack', direction: 'asc' });
        useLocalTrackSortStore.getState().setField('fileLastModified');
        useLocalTrackSortStore.getState().setDirection('desc');
        expect(storage.get('local_track_sort_field')).toBe('fileLastModified');
        expect(storage.get('local_track_sort_direction')).toBe('desc');
        vi.unstubAllGlobals();
    });
});
