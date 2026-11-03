import type {
    LibraryDirectoryItem,
    LibraryDirectoryVisibilityMode,
    LibraryHiddenCollections,
    LibraryHiddenScope,
} from './directory.contract';

// src/library/core/directory/directoryVisibility.ts
// 目录条目的隐藏规则（原网格的 gridItemVisibility，以及 DesktopGrid3DSurface / GridMap 各写一份的隐藏过滤）。
//
// 隐藏项的产品语义：
// - 只有「歌单类」条目可隐藏：在线歌单 / 云盘 / 电台 / 每日推荐、本地自建歌单（含「我喜欢」）、
//   Navidrome 歌单（含随机 / 收藏两个虚拟歌单）。专辑、歌手、文件夹不可隐藏。
// - 隐藏按来源作用域记：`online:${providerId}`、`local`、`navidrome`（没声明作用域的目录落在 `default`）；
//   同一 id 在不同作用域互不影响。存储 key 与格式不变（localStorage `hidden_grid_playlists`，
//   `Record<scope, id[]>`），旧数据原样可读；取消隐藏后作用域留空数组。
// - 隐藏的条目不出现在浏览、筛选结果和任何批量范围里（browse 视图先去掉隐藏的，筛选与批选都在它之上）；
//   只有「管理隐藏」视图（manage：显示全部并标出隐藏的；manage-hidden-only：只看隐藏的）能看到并取消隐藏。
// - 隐藏只影响首页目录的展示：不删除、不改上游，不影响搜索结果和已打开的集合；不进入视觉配置导入导出
//   （它不是设置项）。
// - 同一份隐藏状态由一个 store 提供（core/collection/useHiddenCollectionsStore），网格滑条、GridMap 和
//   以后的 TUI 目录读同一份。

const HIDEABLE_DIRECTORY_ITEM_TYPES = new Set([
    'playlist',
    'cloud',
    'radio',
    'daily_recommendations',
]);

export type DirectoryVisibilityTarget = Pick<LibraryDirectoryItem, 'type' | 'hideable'>;
type IdentifiedVisibilityTarget = DirectoryVisibilityTarget & Pick<LibraryDirectoryItem, 'id'>;

/** 只有歌单类条目可隐藏；条目显式给了 `hideable` 时以它为准。 */
export const isHideableDirectoryItem = (item: DirectoryVisibilityTarget): boolean => (
    item.hideable ?? Boolean(item.type && HIDEABLE_DIRECTORY_ITEM_TYPES.has(item.type))
);

/** 条目此刻是否处于隐藏状态：可隐藏、且 id 在当前作用域的隐藏集合里。 */
export const isDirectoryItemHidden = (
    item: IdentifiedVisibilityTarget,
    hiddenIds: ReadonlySet<string>,
): boolean => isHideableDirectoryItem(item) && hiddenIds.has(String(item.id));

/** 按隐藏视图过滤目录条目（保持原顺序）。browse 去掉隐藏的；manage 全部；manage-hidden-only 只留隐藏的。 */
export const filterDirectoryByVisibility = <TItem extends IdentifiedVisibilityTarget>(
    items: readonly TItem[],
    hiddenIds: ReadonlySet<string>,
    mode: LibraryDirectoryVisibilityMode,
): TItem[] => {
    if (mode === 'manage') return [...items];
    if (mode === 'manage-hidden-only') return items.filter(item => isDirectoryItemHidden(item, hiddenIds));
    return items.filter(item => !isDirectoryItemHidden(item, hiddenIds));
};

/** 来源列表里的焦点下标在可见列表里的位置；焦点条目被隐藏（或越界）时回到 0。按对象身份匹配。 */
export const resolveVisibleDirectoryIndex = <TItem>(
    sourceItems: readonly TItem[],
    visibleItems: readonly TItem[],
    sourceIndex: number,
): number => {
    const focusedItem = sourceItems[sourceIndex];
    const visibleIndex = focusedItem ? visibleItems.indexOf(focusedItem) : -1;
    return visibleIndex >= 0 ? visibleIndex : 0;
};

/** 可见列表里的下标对应来源列表的下标；找不到时 -1。按对象身份匹配。 */
export const resolveSourceDirectoryIndex = <TItem>(
    sourceItems: readonly TItem[],
    visibleItems: readonly TItem[],
    visibleIndex: number,
): number => {
    const item = visibleItems[visibleIndex];
    return item === undefined ? -1 : sourceItems.indexOf(item);
};

/** 在线 provider 的隐藏作用域。 */
export const onlineHiddenScope = (providerId: string): LibraryHiddenScope => `online:${providerId}`;

/** 一个作用域的隐藏 id 集合（作用域没有记录时为空）。 */
export const hiddenIdsOf = (
    table: LibraryHiddenCollections,
    scope: LibraryHiddenScope,
): ReadonlySet<string> => new Set(table[scope] || []);

/**
 * 把存储里读出的 JSON 规整成隐藏表：不是对象（或是数组）就当空表；每个作用域只留字符串 id，
 * 不是数组的作用域记成空数组。与原 DesktopGrid3DSurface 的读取校验一致。
 */
export const parseHiddenCollections = (raw: unknown): LibraryHiddenCollections => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
        Object.entries(raw).map(([scope, ids]) => [
            scope,
            Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
        ]),
    );
};

/**
 * 设置一个 id 在某作用域的隐藏状态，返回新表；状态本来就是这样时原样返回同一个表（调用方据此跳过写入）。
 * 隐藏追加到末尾；取消隐藏只把它从数组里拿掉，作用域留下（可能是空数组）——与原来的存储格式一致。
 */
export const setHiddenCollection = (
    table: LibraryHiddenCollections,
    scope: LibraryHiddenScope,
    id: string,
    hidden: boolean,
): LibraryHiddenCollections => {
    const current = table[scope] || [];
    if (current.includes(id) === hidden) return table;
    return {
        ...table,
        [scope]: hidden ? [...current, id] : current.filter(candidate => candidate !== id),
    };
};

/** 切换一个 id 在某作用域的隐藏状态。 */
export const toggleHiddenCollection = (
    table: LibraryHiddenCollections,
    scope: LibraryHiddenScope,
    id: string,
): LibraryHiddenCollections => setHiddenCollection(table, scope, id, !(table[scope] || []).includes(id));
