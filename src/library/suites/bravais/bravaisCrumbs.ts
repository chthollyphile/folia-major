import type { LibraryNavigationCrumb } from '../../core/suite/suite.contract';

// src/library/suites/bravais/bravaisCrumbs.ts
// 缝里的面包屑（设计稿 §5，B11）：「书库 › 中间层… › 当前层（› 列表）」。纯计算，组件在 BravaisSeamCrumbs。
// - 每一项知道点了去哪：根（书库 / 搜索 / 播放页）与中间层给 onPopTo 的 depth（保留的层数，按导航栈里的位置算——
//   N1 只折叠紧邻往返，栈里可以有重复的集合，点哪一项退到哪一层）；当前层只在面板开着时可点（= 关面板）。
// - 中间层多于 1 层时折叠成「…」，只留紧挨当前层的那一层；点「…」原地展开全部层（展开状态在组件里，换层复位）。
// - 中间层的名字来自宿主的 trail（导航栈投影）。trail 与正在画的那一层对不上时（缝的内容翻转途中，旧内容还在、
//   导航已经换了）退回旧的画法：中间层只画一个不可点的「…」。

/** 折叠时保留紧挨当前层的几层中间层。 */
export const BRAVAIS_CRUMB_VISIBLE_LAYERS = 1;

export type BravaisCrumbTarget = { label: string; depth: number };

export type BravaisCrumb =
    /** 根：depth 0 = 整个关掉（回到书库首页，或从搜索 / 播放页打开时回到那里）。 */
    | { kind: 'root'; label: string; depth: 0 }
    /** 中间层：退到第 depth 层（保留 depth 层）。 */
    | { kind: 'layer'; label: string; depth: number }
    /** 折叠起来的中间层；hidden 为空表示名字不知道（不可点）。 */
    | { kind: 'more'; hidden: readonly BravaisCrumbTarget[] }
    /** 正在看的这一层；面板开着时点它关面板。 */
    | { kind: 'current'; label: string; closesPanel: boolean }
    /** 面板（「列表」「目录」「搜索」）。 */
    | { kind: 'panel'; label: string };

export type BravaisCrumbsInput = {
    rootLabel: string;
    /** 导航深度（首页为 0）。 */
    depth: number;
    trail: readonly LibraryNavigationCrumb[] | undefined;
    /** 正在画的那一层的键（集合 / 歌手页是 collectionKey）。 */
    layerKey: string;
    currentLabel: string;
    /** 面板开着时它的名字（「列表」）；没有面板为 undefined。 */
    panelLabel?: string;
    /** 用户点开了「…」。 */
    expanded: boolean;
};

/** trail 是不是正描述着这一层（栈顶就是它，长度与深度一致）。 */
const trailMatches = (trail: readonly LibraryNavigationCrumb[] | undefined, depth: number, layerKey: string) => (
    Boolean(trail) && trail!.length === depth && depth > 0 && trail![depth - 1].key === layerKey
);

/** 面包屑的各项（自左向右）。 */
export const buildBravaisCrumbs = ({
    rootLabel,
    depth,
    trail,
    layerKey,
    currentLabel,
    panelLabel,
    expanded,
}: BravaisCrumbsInput): BravaisCrumb[] => {
    const crumbs: BravaisCrumb[] = [{ kind: 'root', label: rootLabel, depth: 0 }];
    if (trailMatches(trail, depth, layerKey)) {
        const middle = trail!.slice(0, depth - 1).map((crumb, index) => ({ label: crumb.name, depth: index + 1 }));
        const folded = !expanded && middle.length > BRAVAIS_CRUMB_VISIBLE_LAYERS;
        const hidden = folded ? middle.slice(0, middle.length - BRAVAIS_CRUMB_VISIBLE_LAYERS) : [];
        if (hidden.length > 0) crumbs.push({ kind: 'more', hidden });
        for (const target of middle.slice(hidden.length)) crumbs.push({ kind: 'layer', ...target });
    } else if (depth > 1) {
        crumbs.push({ kind: 'more', hidden: [] });
    }
    crumbs.push({ kind: 'current', label: currentLabel, closesPanel: panelLabel !== undefined });
    if (panelLabel !== undefined) crumbs.push({ kind: 'panel', label: panelLabel });
    return crumbs;
};
