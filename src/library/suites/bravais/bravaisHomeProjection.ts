import type {
    LibraryDirectoryItem,
    LibraryDirectoryNode,
    LibraryDirectoryNodeSelection,
    LibraryDirectoryVisibilityMode,
} from '../../core/directory/directory.contract';
import type { LibraryHomeCard, LibraryHomeTabView } from '../../core/home/homeModel.contract';
import { homeCardToDirectoryItem } from '../../core/directory/directoryItems';
import { isDirectoryItemHidden, isHideableDirectoryItem } from '../../core/directory/directoryVisibility';
import {
    LIBRARY_HOME_SPECIAL_ORDER,
    resolveLibraryHomeSpecial,
    type LibraryHomeCardSource,
    type LibraryHomeSpecialKind,
} from '../../core/home/homeSpecialCards';
import { resolveDirectoryRows } from '../../core/directory/directoryTree';
import { cycleIndex } from '../../core/home/homeSources';
import { resolveDirectoryNodeSelection, resolveNextDirectoryNodeSelectionTarget } from '../../core/directory/directoryBatch';
import type { LibraryHomeExtraTab } from '../../core/suite/suite.contract';
import type { BravaisItem, BravaisSeamTab } from './bravaisLayer';
import type { BravaisDirectoryRow } from './bravaisHomeModels';
import { homeCardItemKey, projectHomeCardItem, type HomeCardLabels } from './bravaisProjection';

// src/library/suites/bravais/bravaisHomeProjection.ts
// 首页的纯投影（设计稿 §10.5、§5「目录树 = GridMap 的批量模式」）：
// - 首页卡片 → 目录条目（与 GridMap、TUI 同一个映射）→ 墙上的磁贴，带上眼睛按钮、管理隐藏视图里的已隐藏、
//   批量模式里的选中 / 未选中（灰度 + 半透明）；
// - 墙的模式与过滤身份：批量模式与「只看隐藏」怕重复，退化为以缝为中心的有限拼贴；浏览与「管理隐藏」是无限拼贴。
//   过滤身份（wall.filterKey）里带上二级切换的 section，所以切本地四行、进出管理隐藏 / 批量都从缝的两侧边缘整面翻；
// - 目录树面板的行：core 的 resolveDirectoryRows 排树，三态与「仅本层」沿用 resolveDirectoryNodeSelection /
//   resolveNextDirectoryNodeSelectionTarget（与 GridMap 的批量面板同一套）；
// - F6 切页签：跳过不可用的页签，绕回。
// - 特殊集合（core 的 resolveLibraryHomeSpecial）：磁贴带 special（类型标签换样式）；缝里的直达入口（projectHomeShortcuts）
//   只列此刻真有的那几张——数据里有、没被隐藏——按固定先后排。

/** 首页的一个目录条目：带着原卡片与它在墙上的条目 key。 */
export type BravaisHomeEntry = LibraryDirectoryItem & { card: LibraryHomeCard; itemKey: string };

export const toHomeEntry = (card: LibraryHomeCard): BravaisHomeEntry => ({
    ...homeCardToDirectoryItem(card),
    card,
    itemKey: homeCardItemKey(card),
});

export type BravaisHomeWallMode = { mode: 'infinite' | 'finite'; filterKey: string };

/** 墙此刻是哪种拼贴、过滤身份是什么（变了就从缝的两侧边缘翻）。 */
export const resolveHomeWallMode = ({
    section,
    visibilityMode,
    batch,
    query,
}: {
    /** 二级切换的 section（在线页签给页签自己）。 */
    section: string;
    visibilityMode: LibraryDirectoryVisibilityMode;
    /** 目录树面板开着（批量模式）。 */
    batch: boolean;
    /** 这一页的过滤词（目录会话的 query；浏览、管理隐藏、批量模式里都生效）。 */
    query: string;
}): BravaisHomeWallMode => {
    const text = query.trim();
    if (batch) return { mode: 'finite', filterKey: `${section}|batch|${text}` };
    // 当前页过滤（设计稿 §7.6 / §4）：过滤中退化为以缝为中心的有限拼贴（不重复）；过滤身份带上词，换词就从缝的两侧翻。
    if (visibilityMode === 'manage-hidden-only') return { mode: 'finite', filterKey: `${section}|hidden-only${text ? `|${text}` : ''}` };
    if (text) return { mode: 'finite', filterKey: `${section}|${visibilityMode}|filter|${text}` };
    if (visibilityMode === 'manage') return { mode: 'infinite', filterKey: `${section}|manage` };
    return { mode: 'infinite', filterKey: section };
};

type HomeItemFlags = Pick<BravaisItem, 'hideable' | 'hidden' | 'selected' | 'dimmed' | 'direct'>;

/** 投影缓存：卡片与标记都没变的条目复用上一次的对象（磁贴按条目身份 memo，选一张卡不该让整面墙重渲染）。 */
export type BravaisHomeItemCache = Map<string, { card: LibraryHomeCard; flags: string; labels: HomeCardLabels; item: BravaisItem }>;

export const createHomeItemCache = (): BravaisHomeItemCache => new Map();

const flagsKey = (flags: HomeItemFlags) => [flags.hideable, flags.hidden, flags.selected, flags.dimmed, flags.direct].map(Number).join('');

const projectHomeItem = (
    card: LibraryHomeCard,
    itemKey: string,
    labels: HomeCardLabels,
    flags: HomeItemFlags,
    special: LibraryHomeSpecialKind | null,
): BravaisItem => {
    const item = projectHomeCardItem(card, labels, { key: itemKey, direct: flags.direct });
    (Object.keys(flags) as (keyof HomeItemFlags)[]).forEach(key => {
        if (flags[key]) item[key] = true;
    });
    if (special) item.special = special;
    return item;
};

/**
 * 墙上显示的条目（调用方已按隐藏视图与批量的过滤词选好了 entries）：
 * - 可隐藏的（歌单类）带眼睛按钮；管理隐藏视图里已隐藏的灰度 + 半透明；
 * - 批量模式（selectedIds 不为 null）里没选中的灰度 + 半透明，选中的带勾；
 * - 私人 FM 点了直接播放（direct）。
 */
export const projectHomeWallItems = (
    entries: readonly BravaisHomeEntry[],
    {
        hiddenIds,
        visibilityMode,
        selectedIds,
        isDirect,
        source,
    }: {
        hiddenIds: ReadonlySet<string>;
        visibilityMode: LibraryDirectoryVisibilityMode;
        /** 批量模式的选择；不在批量模式时为 null。 */
        selectedIds: ReadonlySet<string> | null;
        isDirect: (card: LibraryHomeCard) => boolean;
        /** 卡片来源（特殊集合的判定按来源解释身份字段）。 */
        source: LibraryHomeCardSource;
    },
    labels: HomeCardLabels,
    cache?: BravaisHomeItemCache,
): BravaisItem[] => entries.map(entry => {
    const id = String(entry.id);
    const hideable = isHideableDirectoryItem(entry);
    const hidden = hideable && hiddenIds.has(id);
    const selected = selectedIds ? selectedIds.has(id) : false;
    const flags: HomeItemFlags = {
        hideable,
        hidden: hidden && visibilityMode !== 'browse',
        selected,
        dimmed: selectedIds ? !selected : visibilityMode !== 'browse' && hidden,
        direct: isDirect(entry.card),
    };
    const key = flagsKey(flags);
    const cached = cache?.get(entry.itemKey);
    if (cached && cached.card === entry.card && cached.flags === key && cached.labels === labels) return cached.item;
    const item = projectHomeItem(entry.card, entry.itemKey, labels, flags, resolveLibraryHomeSpecial(entry.card, source));
    cache?.set(entry.itemKey, { card: entry.card, flags: key, labels, item });
    return item;
});

/** 缝里一个直达入口要的东西（还没接上「打开」：surface 拿 card 去开，stage 拿 itemKey 去墙上找起点）。 */
export type BravaisHomeShortcutSpec = {
    special: LibraryHomeSpecialKind;
    /** 全名（卡片名，已翻译）：入口只显示图标，它进 aria-label / title。 */
    label: string;
    card: LibraryHomeCard;
    /** 这张卡在墙上的条目 key（此刻不一定在墙上：本地别的 section、被过滤掉）。 */
    itemKey: string;
    /** 点了直接播放、不进新层（私人 FM）。 */
    direct: boolean;
};

/**
 * 直达入口：这个来源里（不限当前 section）此刻真有的特殊集合，每种一个，按固定先后。被隐藏的不列（隐藏的条目不出现在
 * 浏览里，入口同理）；过滤词不影响（入口不是墙的内容）。
 */
export const projectHomeShortcuts = (
    cards: readonly LibraryHomeCard[],
    {
        source,
        hiddenIds,
        isDirect,
    }: {
        source: LibraryHomeCardSource;
        hiddenIds: ReadonlySet<string>;
        isDirect: (card: LibraryHomeCard) => boolean;
    },
): BravaisHomeShortcutSpec[] => {
    const found = new Map<LibraryHomeSpecialKind, BravaisHomeShortcutSpec>();
    for (const card of cards) {
        const special = resolveLibraryHomeSpecial(card, source);
        if (!special || found.has(special)) continue;
        if (isDirectoryItemHidden(homeCardToDirectoryItem(card), hiddenIds)) continue;
        found.set(special, { special, label: card.name, card, itemKey: homeCardItemKey(card), direct: isDirect(card) });
    }
    return LIBRARY_HOME_SPECIAL_ORDER.flatMap(special => {
        const spec = found.get(special);
        return spec ? [spec] : [];
    });
};

export type BravaisDirectoryRowLabels = {
    ignored: string;
    /** 「仅本层 N 首」。 */
    direct: (count: number) => string;
    /** 「已选 N / M」。 */
    selection: (selected: number, total: number) => string;
    /** 「N 首」。 */
    tracks: (count: number) => string;
};

/** 点一行之后要怎么改选择（三态 + 仅本层，与 GridMap 的目录树一致）。 */
export type BravaisDirectoryRowTarget = { ids: string[]; selected: boolean };

const rowSelectionTarget = (selection: LibraryDirectoryNodeSelection): BravaisDirectoryRowTarget => {
    const next = resolveNextDirectoryNodeSelectionTarget(selection);
    if (next === 'none') return { ids: selection.itemIds, selected: false };
    if (next === 'direct') return { ids: selection.directItemIds, selected: true };
    return { ids: selection.itemIds, selected: true };
};

/**
 * 目录树面板的行与每一行被点时的选择变化。displayItems 是已按过滤词筛过的条目（与批量范围同一份）；trees 给了
 * （本地文件夹）就排成树（筛选时只留匹配的文件夹与上层、压缩单子链、collapsedIds 里的不展开），树节点的三态按子树下
 * 显示着的卡片算；专辑 / 歌手（没有树）是平铺的条目，只有选中与没选中。
 */
export const projectDirectoryRows = ({
    displayItems,
    trees,
    query,
    collapsedIds,
    selectedIds,
    labels,
}: {
    displayItems: readonly LibraryDirectoryItem[];
    trees?: readonly LibraryDirectoryNode[];
    query: string;
    collapsedIds: ReadonlySet<string>;
    selectedIds: ReadonlySet<string>;
    labels: BravaisDirectoryRowLabels;
}): { rows: BravaisDirectoryRow[]; targets: ReadonlyMap<string, BravaisDirectoryRowTarget> } => {
    const targets = new Map<string, BravaisDirectoryRowTarget>();
    const rows = resolveDirectoryRows({ displayItems, trees, query, collapsedIds }).map((row): BravaisDirectoryRow => {
        const node = row.node;
        if (!node) {
            // 平铺的条目（专辑、歌手、树外的「全部歌曲」）：选中与没选中。
            const item = row.kind === 'item' ? row.item : null;
            const id = item ? String(item.id) : '';
            const selected = selectedIds.has(id);
            targets.set(row.key, { ids: [id], selected: !selected });
            return {
                key: row.key,
                label: item?.name ?? '',
                detail: typeof item?.trackCount === 'number' ? labels.tracks(item.trackCount) : item?.description ?? '',
                depth: row.depth,
                selection: selected ? 'all' : 'none',
                selectable: Boolean(item),
                expandable: false,
                expanded: false,
                ignored: false,
            };
        }
        const selection = resolveDirectoryNodeSelection(node.path, displayItems, selectedIds);
        targets.set(row.key, rowSelectionTarget(selection));
        const ignored = Boolean(node.ignored);
        return {
            key: row.key,
            label: node.name,
            detail: ignored
                ? labels.ignored
                : selection.state === 'direct'
                    ? labels.direct(node.directTrackCount)
                    : selection.itemIds.length > 0 && selection.selectedCount > 0
                        ? labels.selection(selection.selectedCount, selection.itemIds.length)
                        : labels.tracks(node.totalTrackCount),
            depth: row.depth,
            selection: selection.state,
            selectable: selection.itemIds.length > 0,
            expandable: row.expandable,
            expanded: row.expanded,
            nodeId: node.id,
            ignored,
            ...(row.depth === 0 && !ignored ? { rootPath: node.rootPath } : {}),
            ...(ignored ? { ignoredPath: node.path } : {}),
        };
    });
    return { rows, targets };
};

/** 全选框的三态：一个没选 / 显示着的全选了 / 部分。 */
export const resolveSelectAllState = (selectedCount: number, displayCount: number): 'none' | 'partial' | 'all' => (
    selectedCount === 0 ? 'none' : selectedCount >= displayCount ? 'all' : 'partial'
);

/**
 * F6 / Shift+F6：从当前页签往前 / 往后找下一个可用的（绕回）；只有它自己可用时为 null。
 * 走 core 的 cycleIndex，与网格 / TUI 的 Tab 循环同一套规则（当前页签被隐藏、不在列表里时，往前从最后一个找起）。
 */
export const cycleHomeTab = (
    tabs: readonly { key: string; disabledReason?: string }[],
    active: string,
    delta: 1 | -1,
): string | null => {
    const index = cycleIndex(tabs, tabs.findIndex(tab => tab.key === active), delta, tab => !tab.disabledReason);
    return index < 0 || tabs[index].key === active ? null : tabs[index].key;
};

/**
 * 缝里的一级页签：原生页签，后面接宿主交来的扩展页签（模组的首页页面；id 带模组前缀 `modid:name`，不会与原生的
 * key 撞上）。选中态以宿主为准：扩展页签开着时原生页签都不算选中，aria-selected 与高亮跟着走。
 */
export const projectHomeSeamTabs = (
    tabs: readonly LibraryHomeTabView[],
    active: string,
    extraTabs: readonly Pick<LibraryHomeExtraTab, 'id' | 'label' | 'active'>[] = [],
): BravaisSeamTab[] => {
    const extraActive = extraTabs.some(tab => tab.active);
    return [
        ...tabs.map(candidate => ({
            key: candidate.key,
            label: candidate.label,
            active: !extraActive && candidate.key === active,
            disabled: Boolean(candidate.disabledReason),
        })),
        ...extraTabs.map(entry => ({ key: entry.id, label: entry.label, active: entry.active, disabled: false })),
    ];
};

/**
 * F6 / Shift+F6 的那一排：原生页签加扩展页签（与网格首页 Tab 循环的 navigationTabs 同一个顺序），当前项是开着的
 * 扩展页签，没有就是原生的当前页签。返回下一个要选的 key，规则同 cycleHomeTab。
 */
export const cycleHomeSeamTab = (
    tabs: readonly Pick<LibraryHomeTabView, 'key' | 'disabledReason'>[],
    active: string,
    extraTabs: readonly Pick<LibraryHomeExtraTab, 'id' | 'active'>[],
    delta: 1 | -1,
): string | null => cycleHomeTab(
    [...tabs, ...extraTabs.map(entry => ({ key: entry.id }))],
    extraTabs.find(entry => entry.active)?.id ?? active,
    delta,
);
