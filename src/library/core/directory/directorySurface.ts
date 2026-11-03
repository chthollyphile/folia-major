import type {
    LibraryDirectoryBatchCapabilities,
    LibraryDirectoryBatchContext,
    LibraryDirectoryFocusedTarget,
    LibraryDirectorySurfaceActionId,
} from './directory.contract';
import type { LibraryDeclaredActions, LibraryHomeActionId } from '../suite/suite.contract';
import { canRunDirectoryBatchAction } from './directoryBatch';

// src/library/core/directory/directorySurface.ts
// 目录的命令面板 surface 此刻提供哪些动作。批量动作与面板按钮同源（resolveDirectoryBatchCapabilities）：
// 面板按钮不可点的时候，命令也不出现。「管理隐藏」只在没有批量的目录里有（两者在 GridMap 侧面板里互斥）。
// 作用于焦点那一项的动作（隐藏焦点条目、导入根上的重扫 / 移除、恢复忽略目录）只在调用方给出焦点时才有：
// 有焦点概念的目录（TUI 的列表）给，网格的 GridMap 不给（它用卡片与目录树上的按钮做这些）。

const SCOPE_COMMANDS: Array<[LibraryDirectorySurfaceActionId, 'play' | 'enqueue' | 'create-playlist' | 'remove']> = [
    ['play-selection', 'play'],
    ['enqueue-selection', 'enqueue'],
    ['create-playlist', 'create-playlist'],
    ['remove-selection', 'remove'],
];

/** 目录 surface 动作 → 首页 surface 的语义动作（suite 在 entry 的 home 声明里列的那套）。 */
export const DIRECTORY_SURFACE_ACTION_SOURCES: Readonly<Record<LibraryDirectorySurfaceActionId, LibraryHomeActionId>> = {
    'play-selection': 'directory-play-selection',
    'enqueue-selection': 'directory-enqueue-selection',
    'create-playlist': 'directory-create-playlist',
    'remove-selection': 'directory-remove-selection',
    'select-all': 'directory-select',
    'clear-selection': 'directory-select',
    'manage-hidden': 'directory-manage-hidden',
    'toggle-hidden': 'directory-toggle-hidden',
    'rescan-root': 'directory-rescan-root',
    'remove-root': 'directory-remove-root',
    'clear-ignore': 'directory-clear-ignore',
};

/** 目录 surface 的可用动作（固定顺序）。 */
export const resolveDirectorySurfaceActions = ({
    capabilities,
    context,
    displayItemCount,
    selectedItemCount,
    hasHideableItems,
    focused,
}: {
    /** 批量能力；目录没有批量（在线、Navidrome、本地歌单）时为 null。 */
    capabilities: LibraryDirectoryBatchCapabilities | null;
    /** 当前批量范围（筛选后选中的条目与歌）。 */
    context: Pick<LibraryDirectoryBatchContext, 'items'>;
    /** 筛选之后显示的条目数。 */
    displayItemCount: number;
    /** 会话里选中的条目数（含被筛掉的）。 */
    selectedItemCount: number;
    hasHideableItems: boolean;
    /** 焦点那一项（只有有焦点概念的目录给）。 */
    focused?: LibraryDirectoryFocusedTarget | null;
}): LibraryDirectorySurfaceActionId[] => {
    if (!capabilities) {
        if (!hasHideableItems) return [];
        return focused?.hideable ? ['manage-hidden', 'toggle-hidden'] : ['manage-hidden'];
    }
    const actions: LibraryDirectorySurfaceActionId[] = SCOPE_COMMANDS
        .filter(([, batchAction]) => canRunDirectoryBatchAction(capabilities, batchAction))
        .map(([command]) => command);
    if (displayItemCount > 0 && context.items.length < displayItemCount) actions.push('select-all');
    if (selectedItemCount > 0) actions.push('clear-selection');
    // 根上的动作同一时间也只能做一个（与目录树上的按钮一样，进行中时不可用）。
    if (!capabilities.pending) {
        if (focused?.rootPath && capabilities.actions.includes('rescan-root')) actions.push('rescan-root');
        if (focused?.rootPath && capabilities.actions.includes('remove-root')) actions.push('remove-root');
        if (focused?.ignoredPath && capabilities.actions.includes('clear-ignore')) actions.push('clear-ignore');
    }
    return actions;
};

/** 只留下渲染首页的那套 suite 声明了的动作（声明 ∩ core 判定，顺序按 actions）。 */
export const filterDeclaredDirectorySurfaceActions = (
    actions: readonly LibraryDirectorySurfaceActionId[],
    declared: LibraryDeclaredActions,
): LibraryDirectorySurfaceActionId[] => actions.filter(action => (
    declared.actions.includes(DIRECTORY_SURFACE_ACTION_SOURCES[action])
));
