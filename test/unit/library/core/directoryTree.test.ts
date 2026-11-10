import { describe, expect, it } from 'vitest';
import type { LibraryDirectoryItem, LibraryDirectoryNode } from '@/library/core/directory/directory.contract';
import type { LibraryHomeTabView } from '@/library/core/home/homeModel.contract';
import { resolveDirectoryRows } from '@/library/core/directory/directoryTree';
import { homeCardToDirectoryItem, resolveDirectoryFolderLabel } from '@/library/core/directory/directoryItems';
import {
    DIRECTORY_SURFACE_ACTION_SOURCES,
    filterDeclaredDirectorySurfaceActions,
    resolveDirectorySurfaceActions,
} from '@/library/core/directory/directorySurface';
import { resolveDirectoryBatchCapabilities, resolveDirectoryBatchContext } from '@/library/core/directory/directoryBatch';
import { resolveHomeSourceGroups } from '@/library/core/home/homeSources';
import { LIBRARY_HOME_ACTION_IDS } from '@/library/core/suite/librarySuites';

// test/unit/library/core/directoryTree.test.ts
// P3.4 给列表形态的首页（TUI）补的纯规则：目录的「列表 / 树」行（文件夹树与条目对上，对不上的节点只表达层级，
// 虚拟条目排在树前）、首页卡片到目录条目的映射（与 GridMap 同一条）、作用于焦点那一项的目录动作、
// 首页动作声明的过滤、一级页签按来源分组。

const node = (path: string, children: LibraryDirectoryNode[] = [], patch: Partial<LibraryDirectoryNode> = {}): LibraryDirectoryNode => ({
    id: path,
    name: path.split('/').at(-1)!,
    path,
    rootPath: path.split('/')[0],
    depth: path.split('/').length - 1,
    directTrackCount: 1,
    totalTrackCount: 1,
    children,
    ...patch,
});
const folder = (path: string, extra: Partial<LibraryDirectoryItem> = {}): LibraryDirectoryItem => ({
    id: `folder-${path}`,
    name: path,
    type: 'folder',
    path,
    trackIds: [path],
    ...extra,
});
const allSongs: LibraryDirectoryItem = { id: 'all', name: 'All Songs', type: 'folder', isVirtual: true, trackIds: ['x'] };

// Music（没有直属歌曲）下有 Alpha（含 Live）与 Beta；Music/Hidden 被忽略；Extra 是另一个导入根。
const trees = [
    node('Extra'),
    node('Music', [
        node('Music/Alpha', [node('Music/Alpha/Live')]),
        node('Music/Beta'),
        node('Music/Hidden', [], { ignored: true, directTrackCount: 0, totalTrackCount: 0 }),
    ], { directTrackCount: 0, totalTrackCount: 3 }),
];
const items = [allSongs, folder('Extra'), folder('Music/Alpha'), folder('Music/Alpha/Live'), folder('Music/Beta')];
const summarize = (rows: ReturnType<typeof resolveDirectoryRows>) => rows.map(row => (
    `${'  '.repeat(row.depth)}${row.kind === 'item' ? row.item.id : `[${row.node.path}]`}${row.expandable ? (row.expanded ? ' -' : ' +') : ''}`
));

describe('directory rows', () => {
    it('lists items flat when there is no tree', () => {
        expect(resolveDirectoryRows({ displayItems: items }).map(row => [row.key, row.depth, row.parentKey]))
            .toEqual(items.map(item => [`item:${item.id}`, 0, null]));
    });

    it('lays local folders out as a tree: matched nodes are items, the rest are structure, virtual items come first', () => {
        const rows = resolveDirectoryRows({ displayItems: items, trees });
        expect(summarize(rows)).toEqual([
            'all',
            'folder-Extra',
            '[Music] -',
            '  folder-Music/Alpha -',
            '    folder-Music/Alpha/Live',
            '  folder-Music/Beta',
            '  [Music/Hidden]',
        ]);
        const live = rows.find(row => row.key === 'item:folder-Music/Alpha/Live')!;
        expect(live.parentKey).toBe('item:folder-Music/Alpha');
        expect(rows.find(row => row.key === 'item:folder-Music/Alpha')!.parentKey).toBe('node:Music');
        expect(rows.find(row => row.key === 'node:Music/Hidden')).toMatchObject({ kind: 'node', node: { ignored: true } });
    });

    it('collapses the nodes it is told to, and filters the tree to matches and their ancestors', () => {
        expect(summarize(resolveDirectoryRows({ displayItems: items, trees, collapsedIds: new Set(['Music/Alpha']) })))
            .toContain('  folder-Music/Alpha +');
        // 折叠起来的子文件夹不显示，也不会被当成树外的条目排到前面去。
        expect(resolveDirectoryRows({ displayItems: items, trees, collapsedIds: new Set(['Music/Alpha']) }).map(row => row.key))
            .not.toContain('item:folder-Music/Alpha/Live');

        const filtered = [folder('Music/Alpha/Live')];
        expect(summarize(resolveDirectoryRows({ displayItems: filtered, trees, query: 'live' }))).toEqual([
            '[Music] -',
            '  [Music/Alpha] -',
            '    folder-Music/Alpha/Live',
        ]);
    });

    it('compacts a single-child chain without songs into one row', () => {
        const chain = [node('Root', [node('Root/Only', [node('Root/Only/Leaf')], { directTrackCount: 0 })], { directTrackCount: 0 })];
        const rows = resolveDirectoryRows({ displayItems: [folder('Root/Only/Leaf')], trees: chain });
        expect(rows.map(row => [row.kind, row.node?.name, row.depth])).toEqual([
            ['node', 'Root', 0],
            ['item', 'Only / Leaf', 1],
        ]);
    });
});

describe('home cards in a directory', () => {
    it('folders describe themselves by their path; the virtual All Songs has no path but shows its name there', () => {
        expect(homeCardToDirectoryItem({ id: 'f', name: 'Music/Beta', type: 'folder', description: 'Folder' }))
            .toMatchObject({ path: 'Music/Beta', description: 'Music/Beta' });
        const virtual = homeCardToDirectoryItem({ id: 'all', name: 'All Songs', type: 'folder', description: 'Folder', isVirtual: true });
        expect(virtual).toMatchObject({ path: undefined, description: 'All Songs', isVirtual: true });
        expect(resolveDirectoryFolderLabel(virtual)).toBe('All Songs');
        expect(resolveDirectoryFolderLabel({ name: 'Mix', type: 'playlist' })).toBe('');
        expect(homeCardToDirectoryItem({ id: 'p', name: 'Mix', type: 'playlist', description: 'by me' }))
            .toMatchObject({ path: undefined, description: 'by me' });
    });
});

describe('directory actions on the focused entry', () => {
    const context = resolveDirectoryBatchContext([folder('Extra')], new Set());
    const folders = resolveDirectoryBatchCapabilities({ selectionType: 'folders' }, context, null);
    const base = { context, displayItemCount: 1, selectedItemCount: 0, hasHideableItems: false };

    it('offers the root actions on a root and clear-ignore on an ignored folder, only in folder directories', () => {
        expect(resolveDirectorySurfaceActions({ ...base, capabilities: folders, focused: { rootPath: 'Music' } }))
            .toEqual(['select-all', 'rescan-root', 'remove-root']);
        expect(resolveDirectorySurfaceActions({ ...base, capabilities: folders, focused: { ignoredPath: 'Music/Hidden' } }))
            .toEqual(['select-all', 'clear-ignore']);
        const albums = resolveDirectoryBatchCapabilities({ selectionType: 'albums' }, context, null);
        expect(resolveDirectorySurfaceActions({ ...base, capabilities: albums, focused: { rootPath: 'Music' } }))
            .toEqual(['select-all']);
        // 进行中时根上的动作也不可用（与目录树上的按钮一样）。
        const busy = resolveDirectoryBatchCapabilities({ selectionType: 'folders' }, context, { action: 'rescan-root', rootPath: 'Music' });
        expect(resolveDirectorySurfaceActions({ ...base, capabilities: busy, focused: { rootPath: 'Music' } }))
            .toEqual(['select-all']);
    });

    it('offers toggle-hidden only with a hideable focus; without a focus nothing changes for the grid', () => {
        const hideable = { ...base, capabilities: null, hasHideableItems: true };
        expect(resolveDirectorySurfaceActions({ ...hideable, focused: { hideable: true } })).toEqual(['manage-hidden', 'toggle-hidden']);
        expect(resolveDirectorySurfaceActions({ ...hideable, focused: { hideable: false } })).toEqual(['manage-hidden']);
        expect(resolveDirectorySurfaceActions(hideable)).toEqual(['manage-hidden']);
    });

    it('keeps only what the suite declares for its home', () => {
        expect(Object.values(DIRECTORY_SURFACE_ACTION_SOURCES).every(action => LIBRARY_HOME_ACTION_IDS.includes(action))).toBe(true);
        const declared = { actions: ['directory-select', 'directory-manage-hidden'] as const, extraActions: [] };
        expect(filterDeclaredDirectorySurfaceActions(
            ['play-selection', 'select-all', 'clear-selection', 'manage-hidden', 'toggle-hidden'],
            declared,
        )).toEqual(['select-all', 'clear-selection', 'manage-hidden']);
    });
});

describe('home sources', () => {
    const tab = (key: LibraryHomeTabView['key'], disabledReason?: string): LibraryHomeTabView => ({ key, label: key, ...(disabledReason ? { disabledReason } : {}) });

    it('groups the first-level tabs by source and marks a source unavailable only when all its tabs are', () => {
        expect(resolveHomeSourceGroups([tab('playlist'), tab('radio', 'no radio'), tab('albums'), tab('local'), tab('navidrome')]).map(group => [
            group.source,
            group.tabs.map(member => member.key),
            group.disabledReason ?? null,
        ])).toEqual([
            ['online', ['playlist', 'radio', 'albums'], null],
            ['local', ['local'], null],
            ['navidrome', ['navidrome'], null],
        ]);
        expect(resolveHomeSourceGroups([tab('playlist', 'sign in'), tab('local', 'insecure')])).toEqual([
            { source: 'online', tabs: [tab('playlist', 'sign in')], disabledReason: 'sign in' },
            { source: 'local', tabs: [tab('local', 'insecure')], disabledReason: 'insecure' },
        ]);
    });
});
