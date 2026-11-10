import type React from 'react';
import type {
    LibraryDeclaredActions,
    LibrarySuiteId,
    LibrarySuiteManifest,
    LibrarySuiteStageProps,
    LibrarySuiteTransitions,
    LibrarySurfaceId,
    LibrarySurfacePropsMap,
} from './core/suite/suite.contract';
import { buildLibrarySuiteIndex, DEFAULT_LIBRARY_SUITE_ID, isLibrarySuiteChoiceAvailable } from './core/suite/librarySuites';

// src/library/registry.ts
// Library 的 suite 注册表：从各 suite 的 `suites/<id>/entry.ts` 自动发现（照 visualizer registry 的做法，
// eager glob；entry 里除默认 suite 外的组件必须是 React.lazy），按 surface 与当前选中的 suite 解析由谁渲染——
// 选中的 suite 没实现就回退默认 suite（grid）。纯规则在 core/suite/librarySuites，这里只做发现与类型还原。
// 只有 UI 侧（首页外壳、集合宿主、suite 切换、DEV 浮层、探针）引用它；core 与 stores 不碰。

type LibrarySuiteEntryModule = { default?: LibrarySuiteManifest };

const suiteEntryModules = import.meta.glob<LibrarySuiteEntryModule>('./suites/*/entry.ts', { eager: true });

const SUITE_INDEX = buildLibrarySuiteIndex(Object.entries(suiteEntryModules).map(([path, module]) => {
    if (!module.default) {
        throw new Error(`[LibraryRegistry] Missing default export in ${path}`);
    }
    return module.default;
}));

export { DEFAULT_LIBRARY_SUITE_ID };

/** 当前构建里可用的 suite（默认 suite 在最前）。DEV 浮层的按钮、探针的 suite 列表都来自这里。 */
export const listLibrarySuites = (): readonly LibrarySuiteManifest[] => SUITE_INDEX.suites;

export const hasLibrarySuite = (suiteId: string): suiteId is LibrarySuiteId => SUITE_INDEX.has(suiteId);

export const getLibrarySuite = (suiteId: string): LibrarySuiteManifest | undefined => SUITE_INDEX.get(suiteId);

/**
 * 实际生效的 suite：store 里存的选择可能是这个构建里没有的（初始选择、旧版本的记录），那时生效的是默认 suite。
 * 设置项、命令面板的 picker 与 DEV 浮层展示「当前 suite」都用它，不直接读 store 的值。
 */
export const resolveActiveLibrarySuiteId = (suiteId: string): LibrarySuiteId => SUITE_INDEX.resolveId(suiteId);

/** 有没有得选（可用的 suite 不止一套）：设置项与命令面板共用这一个判断。 */
export const hasLibrarySuiteChoice = (): boolean => isLibrarySuiteChoiceAvailable(SUITE_INDEX.suites);

export type ResolvedLibrarySurface<Surface extends LibrarySurfaceId> = {
    /** 实际渲染这个 surface 的 suite（回退时是默认 suite）。 */
    suiteId: LibrarySuiteId;
    component: React.ComponentType<LibrarySurfacePropsMap[Surface]>;
    /**
     * 这套 suite 在这个 surface 上声明的动作；同一组输入总是同一个对象，可以直接当 props 传。
     * 类型按 surface 收窄（账户 surface 是 LibraryAccountDeclaredActions）：建索引时已按 surface 校验过动作清单。
     */
    declaredActions: LibrarySurfacePropsMap[Surface]['declaredActions'];
    transitions: LibrarySuiteTransitions | undefined;
    isFallback: boolean;
};

const resolvedCache = new Map<string, ResolvedLibrarySurface<LibrarySurfaceId>>();

/**
 * 这个 surface 由谁渲染：选中的 suite 实现了就用它，否则（或 id 未知、在这个构建里不可用）回退默认 suite。
 * 结果按 (surface, 实际 suite, 回退状态) 缓存，组件引用稳定——在两个都回退到网格的 suite 之间切换不会让网格重新挂载。
 */
export const resolveLibrarySurface = <Surface extends LibrarySurfaceId>(
    surface: Surface,
    suiteId: string,
): ResolvedLibrarySurface<Surface> => {
    const resolved = SUITE_INDEX.resolve(surface, suiteId);
    // 未知或当前构建不可用的 id 共用解析结果；缓存大小由有限的 surface / suite 组合决定。
    const cacheKey = `${surface}\u0000${resolved.suite.id}\u0000${resolved.isFallback}`;
    const cached = resolvedCache.get(cacheKey);
    if (cached) return cached as unknown as ResolvedLibrarySurface<Surface>;

    const result: ResolvedLibrarySurface<Surface> = {
        suiteId: resolved.suite.id,
        // 契约里的组件只是结构化的最小类型；entry 里放的都是 React 组件（即时或 lazy），这里还原。
        component: resolved.declaration.component as unknown as React.ComponentType<LibrarySurfacePropsMap[Surface]>,
        declaredActions: resolved.declaredActions as LibrarySurfacePropsMap[Surface]['declaredActions'],
        transitions: resolved.suite.transitions,
        isFallback: resolved.isFallback,
    };
    resolvedCache.set(cacheKey, result as unknown as ResolvedLibrarySurface<LibrarySurfaceId>);
    return result;
};

/** 用于门控的有效动作集：渲染这个 surface 的那套 suite 声明的动作（再与 core 能力取交集的是 surface 自己）。 */
export const resolveLibrarySurfaceActions = (surface: LibrarySurfaceId, suiteId: string): LibraryDeclaredActions => (
    resolveLibrarySurface(surface, suiteId).declaredActions
);

/** 声明了转场层的 suite（宿主常驻渲染它们的 Overlay，只有当前负责集合层的那套收到 enabled）。 */
export const listLibrarySuiteOverlays = (): ReadonlyArray<{
    suiteId: LibrarySuiteId;
    Overlay: React.ComponentType<{ enabled: boolean }>;
}> => SUITE_INDEX.suites.flatMap(suite => (
    suite.transitions?.Overlay
        ? [{ suiteId: suite.id, Overlay: suite.transitions.Overlay as unknown as React.ComponentType<{ enabled: boolean }> }]
        : []
));

export type ResolvedLibraryStage = {
    /** stage 所属的 suite（就是生效的 suite）。 */
    suiteId: LibrarySuiteId;
    component: React.ComponentType<LibrarySuiteStageProps>;
};

/**
 * 生效 suite 的 stage（B1）：宿主只挂这一个。id 未知或不可用时生效的是默认 suite（grid 没有 stage），结果为 null；
 * 选中的 suite 没声明 stage 也是 null（stage 属于整套 suite，不回退）。同一套 suite 总是同一个对象。
 */
export const resolveLibraryStage = (suiteId: string): ResolvedLibraryStage | null => (
    // 契约里的组件只是结构化的最小类型；entry 里放的是 React 组件（非默认 suite 为 lazy），这里只还原类型。
    SUITE_INDEX.resolveStage(suiteId) as unknown as ResolvedLibraryStage | null
);

/**
 * 生效 suite 的 stage 是否参与与 Lattice 的翻牌交接（manifest 的 stageWallHandoff）。离开 Lattice 回首页的那一刻
 * stage 还没挂上，App 的交接 director 用它决定要不要让 Lattice 留着等 stage 接手；没有 stage（grid / TUI）时为 false。
 */
export const libraryStageHandsOffWall = (suiteId: string): boolean => {
    const stage = resolveLibraryStage(suiteId);
    return Boolean(stage && SUITE_INDEX.get(stage.suiteId)?.stageWallHandoff);
};

/**
 * 「完成」（返回按钮）时忘掉这一层的布局记录：问**每一套**可用的 suite，不只是正在渲染它的那套
 * （在 TUI 里看完的集合，下次在网格里打开也从头开始）。没有布局记录的 suite 不声明 layout。
 */
export const forgetLibraryLayouts = (sessionKey: string): void => {
    for (const suite of SUITE_INDEX.suites) {
        suite.layout?.forget(sessionKey);
    }
};
