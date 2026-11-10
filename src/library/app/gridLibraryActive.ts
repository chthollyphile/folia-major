import type { LibrarySuiteId } from '../core/suite/suite.contract';
import { getActiveLibrarySuiteId, useActiveLibrarySuiteId } from './librarySuiteChoice';

// src/library/app/gridLibraryActive.ts
// 「当前是网格（经典）」的唯一判断：只有网格界面读的设置（首页卡片样式、记住首页卡片位置、网格卡片一组、
// 海报墙按钮的滑动去向）在设置页里显不显示、对应命令与思索章节的 isAvailable，都用这里。与 bravaisLibraryActive
// 同一个口径：比较的是**生效** suite，不是 store 原值。只认 id 字符串，不 import suite 本身。

export const GRID_LIBRARY_SUITE_ID: LibrarySuiteId = 'grid';

/** 这个生效 suite id 是不是网格（纯规则）。 */
export const isGridLibrarySuite = (activeSuiteId: string): boolean => activeSuiteId === GRID_LIBRARY_SUITE_ID;

/** 此刻生效的 suite 是不是网格（非响应式，设置搜索、命令面板与思索用）。 */
export const isGridLibraryActive = (): boolean => isGridLibrarySuite(getActiveLibrarySuiteId());

/** 生效的 suite 是不是网格（响应式，设置页用）。 */
export const useIsGridLibraryActive = (): boolean => isGridLibrarySuite(useActiveLibrarySuiteId());
