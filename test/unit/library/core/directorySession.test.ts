import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    directoryKey,
    EMPTY_DIRECTORY_SESSION,
    replaceDirectorySelection,
    setDirectorySelection,
    toggleDirectorySelection,
    toggleHiddenOnlyMode,
    toggleManageHiddenMode,
} from '@/library/core/directory/directorySession';
import { getLibraryDirectorySession, useLibraryDirectorySessionStore } from '@/library/core/directory/useLibraryDirectorySessionStore';

// test/unit/library/core/directorySession.test.ts
// 目录会话：key 的格式、按稳定 id 的批选变换、隐藏视图的切换，以及 store 按 key 分开、没变化不通知、
// 面板开关清选择与隐藏视图（筛选词保留）、关掉目录丢整个会话。

describe('directory key', () => {
    it('names each home directory by source and section', () => {
        expect(directoryKey({ source: 'local', section: 'folders' })).toBe('home:local:folders');
        expect(directoryKey({ source: 'online', providerId: 'netease', section: 'playlists' })).toBe('home:online:netease:playlists');
        expect(directoryKey({ source: 'navidrome', section: 'recently-added' })).toBe('home:navidrome:recently-added');
    });
});

describe('directory selection transforms', () => {
    it('appends new ids once, keeps existing positions, and returns the same session when nothing changes', () => {
        const one = setDirectorySelection(EMPTY_DIRECTORY_SESSION, ['b', 'a', 'b'], true);
        expect(one.selectedIds).toEqual(['b', 'a']);
        expect(setDirectorySelection(one, ['a'], true)).toBe(one);
        expect(setDirectorySelection(one, ['c'], false)).toBe(one);
        expect(setDirectorySelection(one, ['b'], false).selectedIds).toEqual(['a']);
    });

    it('toggles and replaces by id', () => {
        const toggled = toggleDirectorySelection(toggleDirectorySelection(EMPTY_DIRECTORY_SESSION, 'x'), 'y');
        expect(toggled.selectedIds).toEqual(['x', 'y']);
        expect(toggleDirectorySelection(toggled, 'x').selectedIds).toEqual(['y']);
        const replaced = replaceDirectorySelection(toggled, ['z', 'z', 'x']);
        expect(replaced.selectedIds).toEqual(['z', 'x']);
        expect(replaceDirectorySelection(replaced, ['z', 'x'])).toBe(replaced);
    });

    it('switches the manage-hidden view like the panel buttons', () => {
        expect(toggleManageHiddenMode('browse')).toBe('manage');
        expect(toggleManageHiddenMode('manage')).toBe('browse');
        expect(toggleManageHiddenMode('manage-hidden-only')).toBe('browse');
        expect(toggleHiddenOnlyMode('manage')).toBe('manage-hidden-only');
        expect(toggleHiddenOnlyMode('manage-hidden-only')).toBe('manage');
        expect(toggleHiddenOnlyMode('browse')).toBe('browse');
    });
});

describe('directory session store', () => {
    const local = 'home:local:folders';
    const online = 'home:online:a:playlists';

    beforeEach(() => {
        useLibraryDirectorySessionStore.setState({ sessions: {} });
    });

    it('keeps sessions apart by key', () => {
        const store = useLibraryDirectorySessionStore.getState();
        store.setQuery(local, 'alpha');
        store.setSelected(local, ['a'], true);
        store.setVisibilityMode(online, 'manage');
        expect(getLibraryDirectorySession(local)).toEqual({ query: 'alpha', selectedIds: ['a'], visibilityMode: 'browse' });
        expect(getLibraryDirectorySession(online)).toEqual({ query: '', selectedIds: [], visibilityMode: 'manage' });
    });

    it('does not notify when a write changes nothing', () => {
        const store = useLibraryDirectorySessionStore.getState();
        store.setQuery(local, 'alpha');
        const listener = vi.fn();
        const unsubscribe = useLibraryDirectorySessionStore.subscribe(listener);
        store.setQuery(local, 'alpha');
        store.setSelected(local, [], true);
        store.resetSelection(local);
        store.clearSession('home:navidrome:albums');
        expect(listener).not.toHaveBeenCalled();
        unsubscribe();
    });

    it('resets selection and hidden view for the panel but keeps the query; clearing drops the whole session', () => {
        const store = useLibraryDirectorySessionStore.getState();
        store.setQuery(local, 'alpha');
        store.replaceSelection(local, ['a', 'b']);
        store.setVisibilityMode(local, 'manage-hidden-only');
        store.resetSelection(local);
        expect(getLibraryDirectorySession(local)).toEqual({ query: 'alpha', selectedIds: [], visibilityMode: 'browse' });

        store.clearSession(local);
        expect(useLibraryDirectorySessionStore.getState().sessions[local]).toBeUndefined();
        expect(getLibraryDirectorySession(local)).toBe(EMPTY_DIRECTORY_SESSION);
    });
});
