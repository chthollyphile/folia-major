import { PONDER_TARGET_CATEGORIES, type PonderTargetCategory, type PonderTargetDefinition, type PonderTargetId } from '../../types/ponder';

// src/components/ponder/ponderRegistry.ts
// 可教学目标的注册表。照 dev/probes/registry.ts 和 visualizer registry 的做法：
// 新增一个目标只要在 targets/ 下加一个 *.target.ts 并默认导出定义，这里不用改。
//
// eager 加载是有意的 —— 这些文件只有声明式数据，没有 animejs、没有组件，
// 不会把教程层那个懒加载 chunk 拖进 bootstrap。

const targetModules = import.meta.glob<{ default: PonderTargetDefinition }>(
    './targets/*.target.ts',
    { eager: true },
);

const buildRegistry = () => {
    const byId = {} as Record<PonderTargetId, PonderTargetDefinition>;
    for (const [path, module] of Object.entries(targetModules)) {
        if (!module.default) {
            throw new Error(`[PonderRegistry] Missing default export in ${path}`);
        }
        if (byId[module.default.id]) {
            throw new Error(`[PonderRegistry] Duplicate target id "${module.default.id}"`);
        }
        byId[module.default.id] = module.default;
    }
    return byId;
};

export const PONDER_TARGETS = buildRegistry();

export const PONDER_TARGET_LIST = Object.values(PONDER_TARGETS)
    .sort((a, b) => a.id.localeCompare(b.id));

/*
 * 模组（Folium 实验接口 ponder.targets）在运行时追加/撤下的目标。和内建目标一样进
 * PONDER_TARGETS 与 PONDER_TARGET_LIST，所以导航页、悬停命中、命令面板的思索列表不用
 * 各自再认一遍模组目标。id 由 Folium 加上 `<modid>:` 前缀，撞不到内建目标。
 */
export const registerPonderTarget = (definition: PonderTargetDefinition): boolean => {
    if (PONDER_TARGETS[definition.id]) {
        return false;
    }
    PONDER_TARGETS[definition.id] = definition;
    PONDER_TARGET_LIST.push(definition);
    PONDER_TARGET_LIST.sort((a, b) => a.id.localeCompare(b.id));
    return true;
};

export const unregisterPonderTarget = (id: PonderTargetId): boolean => {
    if (!PONDER_TARGETS[id]) {
        return false;
    }
    delete PONDER_TARGETS[id];
    const index = PONDER_TARGET_LIST.findIndex(target => target.id === id);
    if (index >= 0) {
        PONDER_TARGET_LIST.splice(index, 1);
    }
    return true;
};

export const findPonderTarget = (id: PonderTargetId): PonderTargetDefinition | null =>
    PONDER_TARGETS[id] ?? null;

/**
 * 按分类分好组的全部目标。导航页照这个顺序渲染。
 *
 * 从注册表算出来而不是手写一张表：手写的表和注册表必然走散，新加的目标会静悄悄地
 * 不出现在导航页上 —— 而「找不到某个组件的教程」这件事本来就没有任何东西会报警。
 */
export const ponderTargetsByCategory = (): { category: PonderTargetCategory; targets: PonderTargetDefinition[] }[] => (
    PONDER_TARGET_CATEGORIES
        .map(category => ({
            category,
            targets: PONDER_TARGET_LIST.filter(target => target.category === category),
        }))
        .filter(group => group.targets.length > 0)
);

/**
 * 指针底下那个元素属于哪个可教学目标。
 *
 * 一个元素常常同时落在多个目标的选择器里 —— 槽位按钮既在整条控制条内、又是自己的目标。
 * 先比命中深度（最具体的那个才是用户真正指着的东西），深度相同再比 priority。
 */
export const resolveHoveredPonderTarget = (element: Element | null): PonderTargetDefinition | null => {
    if (!element) {
        return null;
    }

    // 导航页上的卡片直接声明自己教的是哪个目标。
    //
    // 不走 hoverSelector：那样每个目标的选择器都要额外写一条指向导航页的分支，
    // 二十多个目标就是二十多处耦合，新加一个目标还会忘。这里反过来 —— 元素说自己是谁。
    const declared = element.closest('[data-ponder-nav-target]');
    if (declared) {
        const id = declared.getAttribute('data-ponder-nav-target');
        return id ? findPonderTarget(id as PonderTargetId) : null;
    }

    let best: PonderTargetDefinition | null = null;
    let bestDepth = -1;
    let bestPriority = -Infinity;

    for (const target of PONDER_TARGET_LIST) {
        if (!target.hoverSelector) {
            continue;
        }
        const matched = element.closest(target.hoverSelector);
        if (!matched) {
            continue;
        }
        let depth = 0;
        for (let node: Element | null = matched; node; node = node.parentElement) {
            depth += 1;
        }
        const priority = target.priority ?? 0;
        if (depth > bestDepth || (depth === bestDepth && priority > bestPriority)) {
            best = target;
            bestDepth = depth;
            bestPriority = priority;
        }
    }

    return best;
};
