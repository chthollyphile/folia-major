import { describe, expect, it } from 'vitest';
import {
    filterDirectoryByVisibility,
    hiddenIdsOf,
    isDirectoryItemHidden,
    isHideableDirectoryItem,
    onlineHiddenScope,
    parseHiddenCollections,
    resolveSourceDirectoryIndex,
    resolveVisibleDirectoryIndex,
    setHiddenCollection,
    toggleHiddenCollection,
} from '@/library/core/directory/directoryVisibility';
import type { LibraryHiddenCollections } from '@/library/core/directory/directory.contract';

// test/unit/library/core/directoryVisibility.test.ts
// 隐藏项的产品语义（见 directoryVisibility 的文件头）：只有歌单类可隐藏；按作用域记、互不影响；
// 浏览视图去掉隐藏的，管理视图看全部或只看隐藏的；存储格式 Record<scope, id[]>，取消隐藏留空数组。

describe('directory item visibility', () => {
    it.each([
        'playlist',
        'cloud',
        'radio',
        'daily_recommendations',
    ])('allows hiding %s items', type => {
        expect(isHideableDirectoryItem({ type })).toBe(true);
    });

    it.each([
        'album',
        'artist',
        'folder',
        undefined,
    ])('keeps %s items outside playlist hiding', type => {
        expect(isHideableDirectoryItem({ type })).toBe(false);
    });
});

describe('explicit hideable flag', () => {
    it('wins over the type rule in both directions', () => {
        expect(isHideableDirectoryItem({ type: 'album', hideable: true })).toBe(true);
        expect(isHideableDirectoryItem({ type: 'playlist', hideable: false })).toBe(false);
    });
});

describe('filterDirectoryByVisibility', () => {
    const items = [
        { id: 'pl-1', type: 'playlist' },
        { id: 'al-1', type: 'album' },
        { id: 'pl-2', type: 'playlist' },
        { id: 7, type: 'radio' },
        { id: 'fo-1', type: 'folder' },
    ];
    // 不可隐藏的条目即使 id 在隐藏表里也照常显示（文件夹不受隐藏影响）。
    const hidden = new Set(['pl-2', '7', 'fo-1']);

    it('browse drops hidden hideable items and keeps order', () => {
        expect(filterDirectoryByVisibility(items, hidden, 'browse').map(item => item.id)).toEqual(['pl-1', 'al-1', 'fo-1']);
    });

    it('manage shows everything; manage-hidden-only shows only the hidden ones', () => {
        expect(filterDirectoryByVisibility(items, hidden, 'manage').map(item => item.id)).toEqual(['pl-1', 'al-1', 'pl-2', 7, 'fo-1']);
        expect(filterDirectoryByVisibility(items, hidden, 'manage-hidden-only').map(item => item.id)).toEqual(['pl-2', 7]);
    });

    it('marks an item hidden only when it is hideable and listed', () => {
        expect(isDirectoryItemHidden(items[2], hidden)).toBe(true);
        expect(isDirectoryItemHidden(items[4], hidden)).toBe(false);
        expect(isDirectoryItemHidden(items[0], hidden)).toBe(false);
    });

    it('maps the source focus into the visible list and back by identity', () => {
        const visible = filterDirectoryByVisibility(items, hidden, 'browse');
        expect(resolveVisibleDirectoryIndex(items, visible, 1)).toBe(1);
        expect(resolveVisibleDirectoryIndex(items, visible, 4)).toBe(2);
        // 焦点落在隐藏的条目上、或越界：回到第一张。
        expect(resolveVisibleDirectoryIndex(items, visible, 2)).toBe(0);
        expect(resolveVisibleDirectoryIndex(items, visible, 99)).toBe(0);
        expect(resolveSourceDirectoryIndex(items, visible, 2)).toBe(4);
        expect(resolveSourceDirectoryIndex(items, visible, 9)).toBe(-1);
    });
});

describe('hidden collections table', () => {
    it('keeps scopes apart: the same id hidden for one provider stays visible elsewhere', () => {
        const table = toggleHiddenCollection({}, onlineHiddenScope('a'), 'same');
        expect(table).toEqual({ 'online:a': ['same'] });
        expect(hiddenIdsOf(table, 'online:b').has('same')).toBe(false);
        expect(hiddenIdsOf(table, 'local').has('same')).toBe(false);
        expect(hiddenIdsOf(table, 'online:a').has('same')).toBe(true);
    });

    it('appends on hide and leaves an empty array on unhide (the stored format)', () => {
        let table: LibraryHiddenCollections = { navidrome: ['__navi_random__'] };
        table = toggleHiddenCollection(table, 'local', 'playlist-1');
        table = toggleHiddenCollection(table, 'local', 'playlist-2');
        expect(table.local).toEqual(['playlist-1', 'playlist-2']);
        table = toggleHiddenCollection(table, 'local', 'playlist-1');
        table = toggleHiddenCollection(table, 'local', 'playlist-2');
        expect(table).toEqual({ navidrome: ['__navi_random__'], local: [] });
    });

    it('returns the same table when setHidden changes nothing', () => {
        const table: LibraryHiddenCollections = { local: ['x'] };
        expect(setHiddenCollection(table, 'local', 'x', true)).toBe(table);
        expect(setHiddenCollection(table, 'navidrome', 'x', false)).toBe(table);
        expect(setHiddenCollection(table, 'local', 'x', false)).toEqual({ local: [] });
    });

    it('reads old data as-is and sanitises anything else', () => {
        expect(parseHiddenCollections({ 'online:netease': ['1', '2'], local: [] })).toEqual({ 'online:netease': ['1', '2'], local: [] });
        expect(parseHiddenCollections({ local: ['a', 3, null, 'b'], navidrome: 'x' })).toEqual({ local: ['a', 'b'], navidrome: [] });
        expect(parseHiddenCollections(['a'])).toEqual({});
        expect(parseHiddenCollections(null)).toEqual({});
        expect(parseHiddenCollections('x')).toEqual({});
    });
});
