import type { LibrarySuiteId } from '../core/suite/suite.contract';
import { getActiveLibrarySuiteId, useActiveLibrarySuiteId } from './librarySuiteChoice';

// src/library/app/bravaisLibraryActive.ts
// 「当前是 bravais」的唯一判断：bravais 专属的设置（透光档位与每块窗数）在设置分区里显不显示、对应命令的 isAvailable，
// 都用这里。比较的是**生效** suite（store 里的选择经 registry 解析后的那套），不是 store 原值——
// 开发阶段的初始选择就是 bravais，但它不在 registry 里时生效的是 grid，这时不该出现 bravais 的设置。
// 只认 id 字符串，不 import suite 本身（suite 之外只有 registry 引用 suite）。

export const BRAVAIS_LIBRARY_SUITE_ID: LibrarySuiteId = 'bravais';

/** 这个生效 suite id 是不是 bravais（纯规则）。 */
export const isBravaisLibrarySuite = (activeSuiteId: string): boolean => activeSuiteId === BRAVAIS_LIBRARY_SUITE_ID;

/** 此刻生效的 suite 是不是 bravais（非响应式，命令面板经 context 调用）。 */
export const isBravaisLibraryActive = (): boolean => isBravaisLibrarySuite(getActiveLibrarySuiteId());

/** 生效的 suite 是不是 bravais（响应式，设置分区用）。 */
export const useIsBravaisLibraryActive = (): boolean => isBravaisLibrarySuite(useActiveLibrarySuiteId());
