import type { LibraryDirectoryItem } from '../../../core/directory/directory.contract';
import { resolveDirectoryFolderLabel } from '../../../core/directory/directoryItems';
import { formatGridMapFolderTitle } from '../../../../utils/gridMapFolderPath';

// src/library/suites/grid/directory/gridMapCardText.ts
// GridMap 卡片上的文字规则（纯函数）：文件夹卡以路径作标题、描述可两行、显示「本目录 N 首」。
// 虚拟的「全部歌曲」没有路径（契约：虚拟条目没有 path），但卡片上把它的名称放在路径的位置——
// 这是 P3.1 之前一直显示的文字，P3.1 保留 isVirtual 后丢过一次，这里固定下来（单测锁定）。
// P3.4 起规则本身在 core/directory/directoryItems（TUI 的目录列表用同一条），这里沿用原名。

type GridMapCardTextItem = Pick<LibraryDirectoryItem, 'type' | 'path' | 'name' | 'isVirtual'>;

/** 文件夹卡占「路径」位置的文字：真实文件夹是路径，虚拟文件夹是名称；不是文件夹为空串。 */
export const resolveGridMapFolderLabel = (item: GridMapCardTextItem): string => resolveDirectoryFolderLabel(item);

/** 卡片标题：文件夹按路径压缩（a/…/z），其余用名称。 */
export const resolveGridMapCardTitle = (item: GridMapCardTextItem): string => {
    const folderLabel = resolveGridMapFolderLabel(item);
    return folderLabel ? formatGridMapFolderTitle(folderLabel) : item.name;
};
