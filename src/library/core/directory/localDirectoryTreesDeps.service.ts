import { loadLocalLibraryDirectoryTrees } from '../../../services/localLibraryDirectoryTree';
import type { LocalDirectoryTreesDeps } from './localDirectoryTrees.service';

// src/library/core/directory/localDirectoryTreesDeps.service.ts
// 本地文件夹树的默认装配：经曲库服务读导入根的快照（services/localLibraryDirectoryTree）。单测注入假 loadTrees。

export const localDirectoryTreesDeps: LocalDirectoryTreesDeps = {
    loadTrees: songs => loadLocalLibraryDirectoryTrees(songs),
};
