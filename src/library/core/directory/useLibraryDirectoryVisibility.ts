import { useCallback } from 'react';
import type { LibraryDirectoryVisibilityMode } from './directory.contract';
import { EMPTY_DIRECTORY_SESSION, toggleHiddenOnlyMode, toggleManageHiddenMode } from './directorySession';
import { getLibraryDirectorySession, useLibraryDirectorySessionStore } from './useLibraryDirectorySessionStore';

// src/library/core/directory/useLibraryDirectoryVisibility.ts
// 目录的隐藏视图（browse / manage / manage-hidden-only）读写目录会话。「管理隐藏」在网格里是 GridMap 侧面板的
// 隐藏编辑模式；命令面板的「管理隐藏」与面板按钮走同一个切换。

export const useLibraryDirectoryVisibility = (sessionId: string) => {
    const visibilityMode = useLibraryDirectorySessionStore(
        state => (state.sessions[sessionId] ?? EMPTY_DIRECTORY_SESSION).visibilityMode,
    );
    const setVisibilityMode = useCallback(
        (mode: LibraryDirectoryVisibilityMode) => useLibraryDirectorySessionStore.getState().setVisibilityMode(sessionId, mode),
        [sessionId],
    );
    const toggleManageHidden = useCallback(
        () => setVisibilityMode(toggleManageHiddenMode(getLibraryDirectorySession(sessionId).visibilityMode)),
        [sessionId, setVisibilityMode],
    );
    const toggleHiddenOnly = useCallback(
        () => setVisibilityMode(toggleHiddenOnlyMode(getLibraryDirectorySession(sessionId).visibilityMode)),
        [sessionId, setVisibilityMode],
    );

    return { visibilityMode, setVisibilityMode, toggleManageHidden, toggleHiddenOnly };
};
