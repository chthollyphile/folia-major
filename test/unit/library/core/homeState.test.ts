import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import type { LibraryDirectoryNode } from '@/library/core/directory/directory.contract';
import type { LibraryHomeListHandle } from '@/library/core/home/homeModel.contract';
import { createLocalDirectoryTrees } from '@/library/core/directory/localDirectoryTrees.service';
import { resolveHomeDirectoryKey, resolveHomeHiddenScope } from '@/library/core/home/homeSources';

// test/unit/library/core/homeState.test.ts
// 首页的几处状态：目录会话 key 与隐藏作用域（原先三个视图各自在 JSX 里算）、本地文件夹树资源、
// Navidrome section 记忆（同一个 localStorage 键）、首页 surface 句柄的注册 / 顶替。

const node = (path: string): LibraryDirectoryNode => ({
    id: path,
    name: path,
    path,
    rootPath: path,
    depth: 0,
    directTrackCount: 1,
    totalTrackCount: 1,
    children: [],
});

describe('home directory key and hidden scope', () => {
    it('keys online lists by provider and tab (the playlist tab reads as playlists)', () => {
        const base = { providerId: 'p', localSection: 'folders', navidromeSection: 'albums' };
        expect(resolveHomeDirectoryKey({ ...base, tab: 'playlist' })).toBe('home:online:p:playlists');
        expect(resolveHomeDirectoryKey({ ...base, tab: 'albums' })).toBe('home:online:p:albums');
        expect(resolveHomeDirectoryKey({ ...base, tab: 'radio' })).toBe('home:online:p:radio');
        expect(resolveHomeDirectoryKey({ ...base, tab: 'local', localSection: 'artists' })).toBe('home:local:artists');
        expect(resolveHomeDirectoryKey({ ...base, tab: 'navidrome', navidromeSection: 'playlists' })).toBe('home:navidrome:playlists');
    });

    it('scopes hidden items per provider, local and Navidrome', () => {
        expect(resolveHomeHiddenScope('playlist', 'p')).toBe('online:p');
        expect(resolveHomeHiddenScope('radio', 'q')).toBe('online:q');
        expect(resolveHomeHiddenScope('local', 'p')).toBe('local');
        expect(resolveHomeHiddenScope('navidrome', 'p')).toBe('navidrome');
    });
});

describe('createLocalDirectoryTrees', () => {
    it('loads the trees for the given songs and marks them loaded', async () => {
        const loadTrees = vi.fn(async () => [node('A')]);
        const trees = createLocalDirectoryTrees({ loadTrees });
        expect(trees.getSnapshot()).toEqual({ trees: [], loaded: false });
        const songs = [{ id: '1' }] as LocalSong[];
        await trees.load(songs);
        expect(loadTrees).toHaveBeenCalledWith(songs);
        expect(trees.getSnapshot()).toEqual({ trees: [node('A')], loaded: true });
        await trees.load();
        expect(loadTrees).toHaveBeenLastCalledWith(undefined);
    });

    it('a failure gives an empty tree (still loaded)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const trees = createLocalDirectoryTrees({ loadTrees: async () => { throw new Error('no handles'); } });
        await trees.load();
        expect(trees.getSnapshot()).toEqual({ trees: [], loaded: true });
        warn.mockRestore();
    });

    it('a later load wins over an earlier one that answers late', async () => {
        let resolveFirst!: (value: LibraryDirectoryNode[]) => void;
        const loadTrees = vi.fn()
            .mockImplementationOnce(() => new Promise<LibraryDirectoryNode[]>(resolve => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce([node('new')]);
        const trees = createLocalDirectoryTrees({ loadTrees });
        const older = trees.load();
        await trees.load();
        resolveFirst([node('old')]);
        await older;
        expect(trees.getSnapshot().trees.map(item => item.path)).toEqual(['new']);
    });
});

describe('useNavidromeHomeSectionStore', () => {
    const KEY = 'folia_navidrome_last_section';
    const loadStore = async (initial?: string) => {
        const storage = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]]);
        vi.stubGlobal('window', {});
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        });
        vi.resetModules();
        const { useNavidromeHomeSectionStore } = await import('@/library/core/home/navidrome/useNavidromeHomeSectionStore');
        return { useNavidromeHomeSectionStore, storage };
    };
    afterEach(() => vi.unstubAllGlobals());

    it('starts from the stored section and writes changes under the same key', async () => {
        const { useNavidromeHomeSectionStore, storage } = await loadStore('artists');
        expect(useNavidromeHomeSectionStore.getState().section).toBe('artists');
        useNavidromeHomeSectionStore.getState().setSection('playlists');
        expect(storage.get(KEY)).toBe('playlists');
        expect(useNavidromeHomeSectionStore.getState().section).toBe('playlists');
    });

    it('ignores an unknown stored value and rereads storage on hydrate', async () => {
        const { useNavidromeHomeSectionStore, storage } = await loadStore('bogus');
        expect(useNavidromeHomeSectionStore.getState().section).toBe('albums');
        storage.set(KEY, 'recently-added');
        useNavidromeHomeSectionStore.getState().hydrate();
        expect(useNavidromeHomeSectionStore.getState().section).toBe('recently-added');
    });
});

describe('useLibraryHomeSurfaceStore', () => {
    const listHandle = (tab: 'local' | 'navidrome'): LibraryHomeListHandle => ({
        getState: () => ({
            tab,
            directoryKey: `home:${tab}:x`,
            hiddenScope: tab,
            sections: [],
            items: [],
            isLoading: false,
            actions: [],
            batchSelectionType: null,
        }),
        setSection: () => true,
        runAction: () => true,
    });

    it('a new registration takes over; the old one unregistering late leaves it in place', async () => {
        const { useLibraryHomeSurfaceStore } = await import('@/library/core/home/useLibraryHomeSurfaceStore');
        const local = listHandle('local');
        const navidrome = listHandle('navidrome');
        const releaseLocal = useLibraryHomeSurfaceStore.getState().registerList(local);
        const releaseNavidrome = useLibraryHomeSurfaceStore.getState().registerList(navidrome);
        releaseLocal();
        expect(useLibraryHomeSurfaceStore.getState().list).toBe(navidrome);
        releaseNavidrome();
        expect(useLibraryHomeSurfaceStore.getState().list).toBeNull();
    });

    it('tabs register the same way', async () => {
        const { useLibraryHomeSurfaceStore } = await import('@/library/core/home/useLibraryHomeSurfaceStore');
        const handle = { getState: () => ({ active: 'local' as const, tabs: [] }), setTab: () => true };
        const release = useLibraryHomeSurfaceStore.getState().registerTabs(handle);
        expect(useLibraryHomeSurfaceStore.getState().tabs).toBe(handle);
        release();
        expect(useLibraryHomeSurfaceStore.getState().tabs).toBeNull();
    });
});
