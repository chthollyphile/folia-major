import { Loader2, RefreshCw, type LucideIcon } from 'lucide-react';

// src/library/suites/bravais/bravaisSeamQuickCells.ts
// 信息条的动作格（2026-11-13 用户选的方案 C「按优先级自动补位」）：一排同样大小的图标格，固定格（收藏、列表、首页的工具）
// 排在前面，剩下的格子按优先级从「⋯」菜单里补，放不下的才留在「⋯」。删除、折叠这类不给优先级的项永远在「⋯」里。
// 这里只做纯计算：格子数按宽度量（useBravaisSeamQuickSlots），哪几项提出来、「⋯」还要不要画由 planQuickCells 定。

/** 能提到格子里的菜单项：给了 priority（越小越先）的才提，没给的只在「⋯」里。 */
export type BravaisQuickCandidate = { id: string; priority?: number };

export type BravaisQuickPlan<T> = {
    /** 提到格子里的项，按优先级排。 */
    promoted: T[];
    /** 留在「⋯」里的项，保持原来的顺序。 */
    rest: T[];
    /** 还要不要画「⋯」。 */
    more: boolean;
};

/** 按优先级挑出最多 `count` 项提到格子里，其余（保持原顺序）留在「⋯」。 */
export const pickQuickCells = <T extends BravaisQuickCandidate>(items: readonly T[], count: number): { promoted: T[]; rest: T[] } => {
    const promoted = items
        .map((item, index) => ({ item, index }))
        .filter(entry => entry.item.priority !== undefined)
        .sort((a, b) => (a.item.priority ?? 0) - (b.item.priority ?? 0) || a.index - b.index)
        .slice(0, Math.max(0, count))
        .map(entry => entry.item);
    const taken = new Set(promoted.map(item => item.id));
    return { promoted, rest: items.filter(item => !taken.has(item.id)) };
};

/**
 * 按格子数分配：`slots` 是这一排一共放得下几格，`fixed` 是固定格占掉的格数，`extraMenu` 是「⋯」里另有不能提出来的东西
 * （折叠信息条、app 级入口）。「⋯」本身占一格；提出来以后「⋯」里什么都不剩、也没有别的东西时，那一格让给菜单项。
 * `slots` 为 null（还没量到）时全部提出来，量到后再收。
 */
export const planQuickCells = <T extends BravaisQuickCandidate>(
    items: readonly T[],
    slots: number | null,
    fixed: number,
    extraMenu: boolean,
): BravaisQuickPlan<T> => {
    const promotable = items.filter(item => item.priority !== undefined).length;
    if (slots === null) {
        const all = pickQuickCells(items, promotable);
        return { ...all, more: all.rest.length > 0 || extraMenu };
    }
    const free = Math.max(0, slots - fixed);
    // 全部放得下、「⋯」里也不剩别的：不画「⋯」。
    if (!extraMenu && promotable === items.length && promotable <= free) {
        return { ...pickQuickCells(items, promotable), more: false };
    }
    const { promoted, rest } = pickQuickCells(items, free - 1);
    return { promoted, rest, more: rest.length > 0 || extraMenu };
};

/** 一排放得下几格：容器宽、格宽、格间距（都按像素）。 */
export const quickSlotsForWidth = (width: number, cell: number, gap: number): number => (
    cell > 0 ? Math.max(0, Math.floor((width + gap) / (cell + gap) + 1e-6)) : 0
);

/**
 * 能提到格子里的项和它们的先后（用户在方案 C 的预览里看过的顺序）。集合页：加入歌单 > 收进速记簿 > 改名 > 设置封面 >
 * 重新导入 / 重新拉取 > 实体信息 > 导出 > 整理歌曲信息（收藏、列表是固定格，不在这里）；首页：目录 > 导入文件夹 > 刷新 >
 * 导入歌单文件。不在表里的（删除、管理隐藏、过滤当前页、回到播放页）只在「⋯」里。
 */
const QUICK_ORDER: Readonly<Record<string, number>> = {
    'add-to-playlist': 0,
    'collect-scratchpad': 1,
    rename: 2,
    'set-cover': 3,
    'resync-folder': 4,
    'resync-all-folders': 4,
    reload: 4,
    'edit-entity': 5,
    'export-playlist': 6,
    'organize-song-info': 7,
    directory: 0,
    'home-import-folder': 1,
    'home-refresh-folders': 2,
    'refresh-navidrome': 2,
    'refresh-explore': 2,
    'home-import-playlist': 3,
};

/** 一项在动作格里的优先级（不在表里的返回 undefined：只在「⋯」里）。 */
export const quickPriority = (id: string): number | undefined => QUICK_ORDER[id];

/** 海报（歌手 / 专辑）上动作格的样式：海报自己的方块按钮，方成一格（BravaisSeamCollectionMenu 的 cellClassName）。 */
export const BRAVAIS_POSTER_QUICK_CELL = 'bravais-poster-button is-icon';

/**
 * 一格进行中时画哪个图标：刷新的箭头本身就是转圈的样子，照旧转它；别的图标（导入文件夹、导入歌单文件……）转起来不像在
 * 忙（用户实测：文件夹在转），换成转圈的加载图标。
 */
export const quickBusyIcon = <T,>(icon: T): T | LucideIcon => ((icon as unknown) === RefreshCw ? icon : Loader2);
