import { useRef } from 'react';
import type {
    LibraryDirectoryBatchCapabilities,
    LibraryDirectoryBatchContext,
    LibraryDirectoryBatchActionId,
    LibraryDirectoryVisibilityMode,
} from '../../core/directory/directory.contract';
import type { LibraryDeclaredActions } from '../../core/suite/suite.contract';
import type { LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import { filterDeclaredDirectorySurfaceActions, resolveDirectorySurfaceActions } from '../../core/directory/directorySurface';
import { isHideableDirectoryItem } from '../../core/directory/directoryVisibility';
import { useLibraryDirectorySurfaceRegistration } from '../../core/directory/useLibraryDirectorySurfaceRegistration';
import type { BravaisHomeEntry } from './bravaisHomeProjection';

// src/library/suites/bravais/useBravaisHomeDirectorySurface.ts
// 首页墙交给命令面板的目录 surface（useLibraryDirectorySurfaceRegistration，与 TUI 的目录列表同一个做法）：墙一直是
// 当前目录，所以可交互时一直注册。动作 = core 判定（resolveDirectorySurfaceActions，与面板按钮同源）∩ entry 声明的首页
// 动作。批量的那几个从关着的面板发起时先把面板打开（命令面板的「全选」= 进入批量模式并全选筛选结果，与 GridMap 一致）；
// 「移除所选」翻成面板底部的确认态；「隐藏焦点歌单」作用于墙上键盘焦点的那一张。根上的动作在目录树的行上，这里不给焦点
// 的根（墙上的卡片是文件夹，不是导入根）。

export const useBravaisHomeDirectorySurface = ({
    isInteractive,
    directoryKey,
    declaredActions,
    capabilities,
    context,
    displayItems,
    selectedIds,
    visibilityMode,
    hasHideableItems,
    focusedEntry,
    openPanel,
    replaceSelection,
    toggleManageHidden,
    toggleHidden,
    requestRemove,
    runAction,
}: {
    isInteractive: boolean;
    directoryKey: string;
    declaredActions: LibraryDeclaredActions;
    capabilities: LibraryDirectoryBatchCapabilities | null;
    context: LibraryDirectoryBatchContext<BravaisHomeEntry>;
    displayItems: readonly BravaisHomeEntry[];
    selectedIds: ReadonlySet<string>;
    visibilityMode: LibraryDirectoryVisibilityMode;
    hasHideableItems: boolean;
    /** 墙上键盘焦点的那一项（没有为 null）。 */
    focusedEntry: BravaisHomeEntry | null;
    openPanel: () => void;
    replaceSelection: (ids: readonly string[]) => void;
    toggleManageHidden: () => void;
    toggleHidden: (entry: BravaisHomeEntry) => void;
    requestRemove: () => void;
    runAction: (action: LibraryDirectoryBatchActionId, arg?: string) => Promise<LibraryMutationResult | null>;
}) => {
    const availableActions = filterDeclaredDirectorySurfaceActions(resolveDirectorySurfaceActions({
        capabilities,
        context,
        displayItemCount: displayItems.length,
        selectedItemCount: selectedIds.size,
        hasHideableItems,
        focused: focusedEntry ? { hideable: isHideableDirectoryItem(focusedEntry) } : null,
    }), declaredActions);
    const latest = useRef({ displayItems, focusedEntry });
    latest.current = { displayItems, focusedEntry };

    useLibraryDirectorySurfaceRegistration({
        isInteractive,
        getState: () => ({
            directoryKey,
            availableActions,
            displayItemCount: displayItems.length,
            selectedItemCount: selectedIds.size,
            selectedTrackCount: context.trackIds.length,
            visibilityMode,
        }),
        run: (action, input) => {
            if (!availableActions.includes(action)) return false;
            switch (action) {
                case 'play-selection':
                    void runAction('play');
                    return true;
                case 'enqueue-selection':
                    void runAction('enqueue');
                    return true;
                case 'create-playlist': {
                    const name = input?.trim();
                    if (!name) return false;
                    void runAction('create-playlist', name);
                    return true;
                }
                case 'remove-selection':
                    requestRemove();
                    return true;
                case 'select-all':
                    openPanel();
                    replaceSelection(latest.current.displayItems.map(entry => String(entry.id)));
                    return true;
                case 'clear-selection':
                    replaceSelection([]);
                    return true;
                case 'manage-hidden':
                    toggleManageHidden();
                    return true;
                case 'toggle-hidden': {
                    const entry = latest.current.focusedEntry;
                    if (!entry) return false;
                    toggleHidden(entry);
                    return true;
                }
                default:
                    return false;
            }
        },
    });
};
