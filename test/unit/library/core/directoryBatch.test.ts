import { describe, expect, it, vi } from 'vitest';
import {
    canRunDirectoryBatchAction,
    compactDirectoryTrees,
    filterDirectoryTreesByItems,
    flattenExpandedDirectoryNodes,
    resolveDirectoryBatchActions,
    resolveDirectoryBatchCapabilities,
    resolveDirectoryBatchContext,
    resolveDirectoryBatchScope,
    resolveDirectoryNodeSelection,
    resolveNextDirectoryNodeSelectionTarget,
    runDirectoryBatchAction,
} from '@/library/core/directory/directoryBatch';
import type { LibraryDirectoryBatchConfig, LibraryDirectoryBatchController, LibraryDirectoryItem, LibraryDirectoryNode } from '@/library/core/directory/directory.contract';

// test/unit/library/core/directoryBatch.test.ts
// 目录批量的纯规则：范围 = 可见（去隐藏）→ 筛选 → 选中（按稳定 id，不是排除集合）；选中的条目按卡片顺序、
// 歌按条目顺序去重并保留第一次出现的位置；目录树三态选择；section 的批量动作、能力与分派。

describe('directory batch scope', () => {
    const items: LibraryDirectoryItem[] = [
        { id: 'a', name: 'Alpha', type: 'folder', trackIds: ['1', '2'] },
        { id: 'b', name: 'Beta', type: 'folder', trackIds: ['2', '3'] },
        { id: 'c', name: 'Alpha Live', type: 'folder', trackIds: ['4'] },
    ];

    it('starts empty: nothing is selected until an id is', () => {
        expect(resolveDirectoryBatchContext(items, new Set())).toEqual({ items: [], trackIds: [] });
    });

    it('orders the selected cards by card order, not by the order they were clicked', () => {
        expect(resolveDirectoryBatchContext(items, new Set(['c', 'a'])).items.map(item => item.id)).toEqual(['a', 'c']);
    });

    it('de-duplicates tracks and keeps their first occurrence', () => {
        expect(resolveDirectoryBatchContext(items, new Set(['b', 'a']))).toEqual({
            items: [items[0], items[1]],
            trackIds: ['1', '2', '3'],
        });
    });

    it('takes only the filtered cards; a selected card filtered out comes back with its selection when the query clears', () => {
        const selectedIds = new Set(['a', 'b']);
        const filtered = resolveDirectoryBatchScope({ items, hiddenIds: new Set(), visibilityMode: 'browse', query: 'alpha', selectedIds });
        expect(filtered.displayItems.map(item => item.id)).toEqual(['a', 'c']);
        expect(filtered.context).toEqual({ items: [items[0]], trackIds: ['1', '2'] });

        const cleared = resolveDirectoryBatchScope({ items, hiddenIds: new Set(), visibilityMode: 'browse', query: '', selectedIds });
        expect(cleared.context.items.map(item => item.id)).toEqual(['a', 'b']);
    });

    it('never puts a hidden item in the scope while browsing, even if its id is selected', () => {
        const playlists: LibraryDirectoryItem[] = [
            { id: 'p1', name: 'One', type: 'playlist', trackIds: ['1'] },
            { id: 'p2', name: 'Two', type: 'playlist', trackIds: ['2'] },
        ];
        const scope = resolveDirectoryBatchScope({
            items: playlists, hiddenIds: new Set(['p1']), visibilityMode: 'browse', query: '', selectedIds: new Set(['p1', 'p2']),
        });
        expect(scope.visibleItems.map(item => item.id)).toEqual(['p2']);
        expect(scope.context.trackIds).toEqual(['2']);
        const manage = resolveDirectoryBatchScope({
            items: playlists, hiddenIds: new Set(['p1']), visibilityMode: 'manage-hidden-only', query: '', selectedIds: new Set(),
        });
        expect(manage.displayItems.map(item => item.id)).toEqual(['p1']);
    });
});

describe('directory tree', () => {
    const child: LibraryDirectoryNode = {
        id: 'root:root/child', name: 'child', path: 'root/child', rootPath: 'root', depth: 1,
        directTrackCount: 1, totalTrackCount: 1, children: [],
    };
    const root: LibraryDirectoryNode = {
        id: 'root:root', name: 'root', path: 'root', rootPath: 'root', depth: 0,
        directTrackCount: 0, totalTrackCount: 1, children: [child],
    };

    it('only exposes descendants of expanded nodes', () => {
        expect(flattenExpandedDirectoryNodes([root], new Set()).map(node => node.path)).toEqual(['root']);
        expect(flattenExpandedDirectoryNodes([root], new Set([root.id])).map(node => node.path)).toEqual(['root', 'root/child']);
    });

    it('resolves parent checkbox state from filtered descendant cards', () => {
        const items: LibraryDirectoryItem[] = [
            { id: 'root', name: 'root', path: 'root', trackIds: ['1'] },
            { id: 'child', name: 'child', path: 'root/child', trackIds: ['2'] },
            { id: 'other', name: 'other', path: 'other', trackIds: ['3'] },
        ];

        expect(resolveDirectoryNodeSelection('root', items, new Set(['root', 'other']))).toEqual({
            itemIds: ['root', 'child'],
            directItemIds: ['root'],
            selectedCount: 1,
            state: 'direct',
        });
        expect(resolveDirectoryNodeSelection('root', items, new Set(['child']))).toMatchObject({
            selectedCount: 1,
            state: 'partial',
        });
        expect(resolveDirectoryNodeSelection('root', items, new Set())).toMatchObject({ selectedCount: 0, state: 'none' });
        expect(resolveDirectoryNodeSelection('root/child', items, new Set(['child']))).toEqual({
            itemIds: ['child'],
            directItemIds: ['child'],
            selectedCount: 1,
            state: 'all',
        });
    });

    it('cycles subtree selection through none and direct-folder-only states', () => {
        const items: LibraryDirectoryItem[] = [
            { id: 'root', name: 'root', path: 'root', trackIds: ['1'] },
            { id: 'child', name: 'child', path: 'root/child', trackIds: ['2'] },
        ];
        const all = resolveDirectoryNodeSelection('root', items, new Set(['root', 'child']));
        const none = resolveDirectoryNodeSelection('root', items, new Set());
        const direct = resolveDirectoryNodeSelection('root', items, new Set(['root']));

        expect(resolveNextDirectoryNodeSelectionTarget(all)).toBe('none');
        expect(resolveNextDirectoryNodeSelectionTarget(none)).toBe('direct');
        expect(resolveNextDirectoryNodeSelectionTarget(direct)).toBe('all');
    });

    it('keeps leaf folders on a two-state selection cycle', () => {
        const items: LibraryDirectoryItem[] = [{ id: 'leaf', name: 'leaf', path: 'root/leaf', trackIds: ['1'] }];
        const none = resolveDirectoryNodeSelection('root/leaf', items, new Set());

        expect(resolveNextDirectoryNodeSelectionTarget(none)).toBe('all');
    });

    it('compacts deep single-child chains but keeps roots and branching nodes separate', () => {
        const leaf: LibraryDirectoryNode = {
            id: 'root:a/b/c', name: 'c', path: 'root/a/b/c', rootPath: 'root', depth: 3,
            directTrackCount: 1, totalTrackCount: 1, children: [],
        };
        const middleB: LibraryDirectoryNode = {
            ...leaf, id: 'root:a/b', name: 'b', path: 'root/a/b', depth: 2,
            directTrackCount: 0, children: [leaf],
        };
        const middleA: LibraryDirectoryNode = {
            ...middleB, id: 'root:a', name: 'a', path: 'root/a', depth: 1,
            children: [middleB],
        };
        const deepRoot: LibraryDirectoryNode = {
            ...middleA, id: 'root:root', name: 'root', path: 'root', depth: 0,
            children: [middleA],
        };

        const [compactedRoot] = compactDirectoryTrees([deepRoot]);

        expect(compactedRoot.name).toBe('root');
        expect(compactedRoot.children[0]).toMatchObject({
            id: leaf.id,
            name: 'a / b / c',
            path: leaf.path,
            depth: 1,
        });
    });

    it('stops compacting when an intermediate folder contains direct tracks', () => {
        const trackedParent: LibraryDirectoryNode = {
            id: 'root:a', name: 'a', path: 'root/a', rootPath: 'root', depth: 1,
            directTrackCount: 1, totalTrackCount: 2, children: [{
                id: 'root:a/b', name: 'b', path: 'root/a/b', rootPath: 'root', depth: 2,
                directTrackCount: 1, totalTrackCount: 1, children: [],
            }],
        };
        const deepRoot: LibraryDirectoryNode = {
            id: 'root:root', name: 'root', path: 'root', rootPath: 'root', depth: 0,
            directTrackCount: 0, totalTrackCount: 2, children: [trackedParent],
        };

        const [compactedRoot] = compactDirectoryTrees([deepRoot]);
        expect(compactedRoot.children[0].name).toBe('a');
        expect(compactedRoot.children[0].children[0].name).toBe('b');
    });

    it('keeps matching folders and their ancestors when filtering the tree', () => {
        const album: LibraryDirectoryNode = {
            id: 'root:music/album', name: 'album', path: 'music/album', rootPath: 'music', depth: 1,
            directTrackCount: 1, totalTrackCount: 1, children: [],
        };
        const other: LibraryDirectoryNode = {
            id: 'root:music/other', name: 'other', path: 'music/other', rootPath: 'music', depth: 1,
            directTrackCount: 1, totalTrackCount: 1, children: [],
        };
        const root: LibraryDirectoryNode = {
            id: 'root:music', name: 'music', path: 'music', rootPath: 'music', depth: 0,
            directTrackCount: 0, totalTrackCount: 2, children: [album, other],
        };

        const [filteredRoot] = filterDirectoryTreesByItems([root], [
            { id: 'album', name: 'album', path: 'music/album' },
        ]);

        expect(filteredRoot.path).toBe('music');
        expect(filteredRoot.children.map(node => node.path)).toEqual(['music/album']);
    });
});

describe('directory batch actions', () => {
    const controller = (): LibraryDirectoryBatchController => ({
        getSnapshot: () => ({ pending: null }),
        subscribe: () => () => {},
        play: vi.fn(async () => ({ ok: true as const })),
        enqueue: vi.fn(async () => ({ ok: true as const })),
        createPlaylist: vi.fn(async () => ({ ok: true as const })),
        remove: vi.fn(async (_context, options) => {
            await options?.after?.();
            return { ok: true as const };
        }),
        clearIgnore: vi.fn(async () => ({ ok: true as const })),
        rescanRoot: vi.fn(async () => ({ ok: true as const })),
        removeRoot: vi.fn(async () => ({ ok: true as const })),
    });
    const context = { items: [], trackIds: ['1'] };

    it('gives albums and artists play, enqueue and create-playlist only', () => {
        expect(resolveDirectoryBatchActions({ selectionType: 'albums' })).toEqual(['play', 'enqueue', 'create-playlist']);
        expect(resolveDirectoryBatchActions({ selectionType: 'artists' })).toEqual(['play', 'enqueue', 'create-playlist']);
    });

    it('gives folders every action, in a fixed order', () => {
        expect(resolveDirectoryBatchActions({ selectionType: 'folders' }))
            .toEqual(['play', 'enqueue', 'create-playlist', 'remove', 'rescan-root', 'remove-root', 'clear-ignore']);
    });

    it('lets the scope actions run only with songs in scope and nothing pending', () => {
        const ready = resolveDirectoryBatchCapabilities({ selectionType: 'folders' }, context, null);
        expect(ready.canUseTracks).toBe(true);
        expect(canRunDirectoryBatchAction(ready, 'play')).toBe(true);
        expect(canRunDirectoryBatchAction(resolveDirectoryBatchCapabilities({ selectionType: 'folders' }, { trackIds: [] }, null), 'remove')).toBe(false);
        const busy = resolveDirectoryBatchCapabilities({ selectionType: 'folders' }, context, { action: 'play' });
        expect(busy.canUseTracks).toBe(false);
        expect(canRunDirectoryBatchAction(busy, 'enqueue')).toBe(false);
        expect(canRunDirectoryBatchAction(resolveDirectoryBatchCapabilities({ selectionType: 'albums' }, context, null), 'remove')).toBe(false);
    });

    it('dispatches to the controller, refusing unsupported actions and missing arguments', async () => {
        const albums: LibraryDirectoryBatchConfig = { selectionType: 'albums', controller: controller() };
        expect(await runDirectoryBatchAction(albums, 'remove', context)).toEqual({ ok: false, reason: 'unsupported' });
        expect(albums.controller.remove).not.toHaveBeenCalled();
        expect(await runDirectoryBatchAction(albums, 'play', context)).toEqual({ ok: true });
        expect(albums.controller.play).toHaveBeenCalledWith(context);
        expect(await runDirectoryBatchAction(albums, 'create-playlist', context, '  ')).toEqual({ ok: false, reason: 'unsupported' });

        const afterAction = vi.fn();
        const folders: LibraryDirectoryBatchConfig = { selectionType: 'folders', controller: controller(), afterAction };
        expect(await runDirectoryBatchAction(folders, 'rescan-root', context)).toEqual({ ok: false, reason: 'unsupported' });
        await runDirectoryBatchAction(folders, 'rescan-root', context, 'Music');
        expect(folders.controller.rescanRoot).toHaveBeenCalledWith('Music', expect.objectContaining({ after: expect.any(Function) }));
        await runDirectoryBatchAction(folders, 'remove', context);
        expect(afterAction).toHaveBeenCalledWith('remove');
    });
});
