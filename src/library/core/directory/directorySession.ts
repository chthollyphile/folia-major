import type {
    LibraryDirectoryRef,
    LibraryDirectorySession,
    LibraryDirectoryVisibilityMode,
} from './directory.contract';

// src/library/core/directory/directorySession.ts
// 目录会话的纯规则：目录 key（会话按它分开）与会话的变换（筛选词、按 id 的批选、隐藏视图）。
// 状态本身在 core/directory/useLibraryDirectorySessionStore；这里不读 store，store 与探针、单测共用这些变换。

/** 首页目录的会话 key：`home:local:folders`、`home:online:${providerId}:playlists`、`home:navidrome:${section}`。 */
export const directoryKey = (ref: LibraryDirectoryRef): string => {
    switch (ref.source) {
        case 'online': return `home:online:${ref.providerId}:${ref.section}`;
        case 'local': return `home:local:${ref.section}`;
        case 'navidrome': return `home:navidrome:${ref.section}`;
    }
    return 'home:unknown';
};

/** 没有声明自己是哪个目录的首页列表落在这里（与隐藏项作用域的 default 同义）。 */
export const DEFAULT_DIRECTORY_SESSION_ID = 'home:default';

export const EMPTY_DIRECTORY_SESSION: LibraryDirectorySession = Object.freeze({
    query: '',
    selectedIds: Object.freeze([]) as readonly string[],
    visibilityMode: 'browse',
});

/** 会话里有没有要带给另一套 suite 看的东西（筛选词、选择或管理隐藏视图）。 */
export const hasDirectorySessionState = (session: LibraryDirectorySession): boolean => (
    session.query !== '' || session.selectedIds.length > 0 || session.visibilityMode !== 'browse'
);

/** 选中或取消一批条目；选中的追加在后（已选的保留原位置），取消的移除。没变化时返回原会话。 */
export const setDirectorySelection = (
    session: LibraryDirectorySession,
    itemIds: readonly string[],
    selected: boolean,
): LibraryDirectorySession => {
    const current = new Set(session.selectedIds);
    if (selected) {
        const added = itemIds.filter((id, index) => !current.has(id) && itemIds.indexOf(id) === index);
        return added.length === 0 ? session : { ...session, selectedIds: [...session.selectedIds, ...added] };
    }
    const removing = new Set(itemIds);
    const next = session.selectedIds.filter(id => !removing.has(id));
    return next.length === session.selectedIds.length ? session : { ...session, selectedIds: next };
};

/** 切换一个条目的选中状态。 */
export const toggleDirectorySelection = (
    session: LibraryDirectorySession,
    itemId: string,
): LibraryDirectorySession => setDirectorySelection(session, [itemId], !session.selectedIds.includes(itemId));

/** 用一组 id 替换整个选择（去重，保持给出的顺序）。 */
export const replaceDirectorySelection = (
    session: LibraryDirectorySession,
    itemIds: readonly string[],
): LibraryDirectorySession => {
    const next = [...new Set(itemIds)];
    const same = next.length === session.selectedIds.length && next.every((id, index) => session.selectedIds[index] === id);
    return same ? session : { ...session, selectedIds: next };
};

/**
 * 「管理隐藏」的开关：browse ↔ manage；从 manage-hidden-only 关掉也回到 browse
 * （与 GridMap 原先的「完成隐藏」一样，顺带退出只看隐藏的）。
 */
export const toggleManageHiddenMode = (mode: LibraryDirectoryVisibilityMode): LibraryDirectoryVisibilityMode => (
    mode === 'browse' ? 'manage' : 'browse'
);

/** 管理隐藏里「只看隐藏的 / 显示全部」的开关；不在管理视图时不变。 */
export const toggleHiddenOnlyMode = (mode: LibraryDirectoryVisibilityMode): LibraryDirectoryVisibilityMode => {
    if (mode === 'manage') return 'manage-hidden-only';
    if (mode === 'manage-hidden-only') return 'manage';
    return mode;
};
