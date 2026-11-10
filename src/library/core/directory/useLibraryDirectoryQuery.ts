import { useCallback, useMemo } from 'react';
import type { LibraryQueryPort } from '../shared/session.contract';
import { getLibraryDirectorySession, useLibraryDirectorySessionStore } from './useLibraryDirectorySessionStore';

// src/library/core/directory/useLibraryDirectoryQuery.ts
// 目录的筛选词读写目录会话（不是组件状态）。键入仍交给命令面板：renderer 把这里的端口连同自己的 anchor
// 交给 useGridCommandFilter 注册（与集合的 useLibrarySessionQuery 同一个做法）。

export const useLibraryDirectoryQuery = (sessionId: string) => {
    const query = useLibraryDirectorySessionStore(state => state.sessions[sessionId]?.query ?? '');
    const setQuery = useCallback(
        (next: string) => useLibraryDirectorySessionStore.getState().setQuery(sessionId, next),
        [sessionId],
    );
    // 端口每次现读会话，命令面板拿到的总是最新的筛选词。
    const port = useMemo<LibraryQueryPort>(() => ({
        getQuery: () => getLibraryDirectorySession(sessionId).query,
        setQuery,
    }), [sessionId, setQuery]);

    return { query, setQuery, port };
};
