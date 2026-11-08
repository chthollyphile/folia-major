import { afterEach, describe, expect, it } from 'vitest';
import '@/library/registry';
import { GRID_LIBRARY_SUITE_ID, isGridLibraryActive, isGridLibrarySuite } from '@/library/app/gridLibraryActive';
import { useLibrarySuiteStore } from '@/library/core/suite/useLibrarySuiteStore';

// test/unit/library/app/gridLibraryActive.test.ts
// 「当前是网格」的共享谓词：只有网格界面读的设置（首页卡片样式、记住卡片位置、网格卡片、海报墙按钮滑动去向）
// 在设置页、设置搜索、命令面板与思索里的门控都用它。和 bravaisLibraryActive 一样比较生效 suite：
// 存着一个不存在的 id 时生效的是网格，谓词为真。

afterEach(() => {
    useLibrarySuiteStore.setState({ suite: 'grid' });
});

describe('isGridLibrarySuite', () => {
    it('matches only the grid id', () => {
        expect(GRID_LIBRARY_SUITE_ID).toBe('grid');
        expect(isGridLibrarySuite('grid')).toBe(true);
        expect(isGridLibrarySuite('bravais')).toBe(false);
        expect(isGridLibrarySuite('tui')).toBe(false);
    });
});

describe('isGridLibraryActive', () => {
    it('follows the effective suite, not the stored id', () => {
        useLibrarySuiteStore.setState({ suite: 'grid' });
        expect(isGridLibraryActive()).toBe(true);
        useLibrarySuiteStore.setState({ suite: 'bravais' });
        expect(isGridLibraryActive()).toBe(false);
        // An id the registry does not know resolves to the default suite, the grid.
        useLibrarySuiteStore.setState({ suite: 'retired' });
        expect(isGridLibraryActive()).toBe(true);
    });
});
