import type { LibrarySuiteId } from '../core/suite/suite.contract';
import { flushLibrarySession } from '../core/shared/useLibraryBrowseSessionStore';
import { useLibrarySuiteStore } from '../core/suite/useLibrarySuiteStore';
import { hasLibrarySuite, listLibrarySuites, resolveActiveLibrarySuiteId } from '../registry';

// src/library/app/switchLibrarySuite.ts
// 切换集合浏览用的 UI suite：先让当前 suite 把焦点写回浏览会话，再让各 suite 丢掉还没用掉的转场计划
// （网格的移形换影计划是给它的入场准备的，经 entry 的 transitions.reset 清掉，这里不再直接 import 网格），
// 最后切换。浮层和行为探针都走这一条，测到的就是用户点到的。id 不在 registry 里（或这个构建里不可用）时什么都不做。
// B0 起切换即「用户选择」：store 把它写进存储。比较的是**实际生效**的 suite——store 里存的可能是这个构建里没有的
// 初始选择（例如 bravais 合入之前），那时生效的是网格；再选网格画面不变，也不算一次选择，什么都不做。

export const switchLibrarySuite = (sessionKey: string, suiteId: LibrarySuiteId): void => {
    if (!hasLibrarySuite(suiteId) || resolveActiveLibrarySuiteId(useLibrarySuiteStore.getState().suite) === suiteId) return;
    flushLibrarySession(sessionKey);
    for (const suite of listLibrarySuites()) {
        suite.transitions?.reset?.();
    }
    useLibrarySuiteStore.getState().setSuite(suiteId);
};
