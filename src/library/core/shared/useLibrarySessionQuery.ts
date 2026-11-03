import { useCallback, useMemo } from 'react';
import type { LibraryQueryPort } from './session.contract';
import { getLibraryBrowseSession, useLibraryBrowseSessionStore } from './useLibraryBrowseSessionStore';

// src/library/core/shared/useLibrarySessionQuery.ts
// renderer 的筛选词读写会话，而不是自己的组件状态：换 renderer 时筛选还在。键入仍交给命令面板：
// renderer 把这里给出的 LibraryQueryPort 连同自己的 anchor 交给 useGridCommandFilter 注册（anchor 是 DOM，
// 只属于 renderer，core 不碰）；挂载时会话里已有筛选就把筛选框带出来，也在那里（reopenIfFiltered）。

export const useLibrarySessionQuery = (sessionKey: string) => {
    const query = useLibraryBrowseSessionStore(state => state.sessions[sessionKey]?.query ?? '');
    const setQuery = useCallback(
        (next: string) => useLibraryBrowseSessionStore.getState().setQuery(sessionKey, next),
        [sessionKey],
    );
    // 端口每次现读会话，命令面板拿到的总是最新的筛选词（不经过某一次渲染的闭包）。
    const port = useMemo<LibraryQueryPort>(() => ({
        getQuery: () => getLibraryBrowseSession(sessionKey).query,
        setQuery,
    }), [sessionKey, setQuery]);

    return { query, setQuery, port };
};
