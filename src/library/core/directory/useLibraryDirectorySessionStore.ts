import { create } from 'zustand';
import type { LibraryDirectorySession, LibraryDirectoryVisibilityMode } from './directory.contract';
import {
    EMPTY_DIRECTORY_SESSION,
    replaceDirectorySelection,
    setDirectorySelection,
    toggleDirectorySelection,
} from './directorySession';

// src/library/core/directory/useLibraryDirectorySessionStore.ts
// 首页目录的浏览会话：筛选词、按稳定 id 的批选、隐藏视图（manage / manage-hidden-only）。原来是 GridMap 的
// 组件状态；提到这里后网格的 GridMap 与 TUI 的目录列表读写同一份，换 suite 不丢。
//
// 会话按目录 key 分开（core/directory/directorySession 的 directoryKey），只在内存里。生命周期跟着「目录被打开 / 关闭」
// 这个语义动作，不跟某个 suite 的组件挂载：
// - openDirectory(key)：首页上打开了这个目录（网格打开 GridMap；TUI 的目录视图一直开着，显示哪个目录就打开哪个）。
//   已经是打开着的那个目录时什么都不做（换 suite 时新 suite 接着用同一份会话）；打开别的目录会先关掉之前打开的那个，
//   新目录从空会话开始。
// - closeDirectory(key)：关掉目录（网格关 GridMap——退场动画结束之后才清，地图还在淡出时筛选结果不能先跳回全部；
//   TUI 在列表里按 Esc 关闭目录；首页整个离开时宿主关掉打开着的那个）。关掉就丢掉整个会话：
//   「关闭 GridMap 即丢掉筛选」（P3.0 锁定）在两个 suite 里是同一条规则。
// - 网格打开 / 关闭批量面板时清掉选择与隐藏视图（resetSelection）是网格自己的规则，不属于目录的开关。

type LibraryDirectorySessionState = {
    sessions: Record<string, LibraryDirectorySession>;
    /** 首页上此刻打开着的目录（没有为 null）。同一时间只开一个。 */
    openDirectoryKey: string | null;
    /** 打开一个目录：已经打开着时保留会话；否则关掉之前打开的那个，从空会话开始。 */
    openDirectory: (sessionId: string) => void;
    /** 关掉一个目录并丢掉它的会话（它是打开着的那个时同时清掉 openDirectoryKey）。 */
    closeDirectory: (sessionId: string) => void;
    setQuery: (sessionId: string, query: string) => void;
    /** 选中或取消一批条目。 */
    setSelected: (sessionId: string, itemIds: readonly string[], selected: boolean) => void;
    toggleSelected: (sessionId: string, itemId: string) => void;
    /** 用一组 id 替换整个选择（全选筛选结果用它）。 */
    replaceSelection: (sessionId: string, itemIds: readonly string[]) => void;
    setVisibilityMode: (sessionId: string, mode: LibraryDirectoryVisibilityMode) => void;
    /** 清空选择并回到浏览视图（打开 / 关闭批量面板时）。筛选词保留。 */
    resetSelection: (sessionId: string) => void;
    /** 丢掉整个会话（不改变哪个目录打开着）。 */
    clearSession: (sessionId: string) => void;
};

export const useLibraryDirectorySessionStore = create<LibraryDirectorySessionState>((set, get) => {
    // 变换没改动会话（返回同一个对象）就不写、不通知订阅者。
    const update = (sessionId: string, change: (session: LibraryDirectorySession) => LibraryDirectorySession) => {
        const current = get().sessions[sessionId] ?? EMPTY_DIRECTORY_SESSION;
        const next = change(current);
        if (next === current) return;
        set(state => ({ sessions: { ...state.sessions, [sessionId]: next } }));
    };

    const dropSessions = (ids: readonly (string | null)[], openDirectoryKey: string | null) => set(state => {
        const sessions = { ...state.sessions };
        ids.forEach(id => {
            if (id !== null) delete sessions[id];
        });
        return { sessions, openDirectoryKey };
    });

    return {
        sessions: {},
        openDirectoryKey: null,
        openDirectory: (sessionId) => {
            const current = get().openDirectoryKey;
            if (current === sessionId) return;
            dropSessions([current, sessionId], sessionId);
        },
        closeDirectory: (sessionId) => {
            const current = get().openDirectoryKey;
            if (current !== sessionId && !get().sessions[sessionId]) return;
            dropSessions([sessionId], current === sessionId ? null : current);
        },
        setQuery: (sessionId, query) => update(sessionId, session => (
            session.query === query ? session : { ...session, query }
        )),
        setSelected: (sessionId, itemIds, selected) => update(sessionId, session => setDirectorySelection(session, itemIds, selected)),
        toggleSelected: (sessionId, itemId) => update(sessionId, session => toggleDirectorySelection(session, itemId)),
        replaceSelection: (sessionId, itemIds) => update(sessionId, session => replaceDirectorySelection(session, itemIds)),
        setVisibilityMode: (sessionId, mode) => update(sessionId, session => (
            session.visibilityMode === mode ? session : { ...session, visibilityMode: mode }
        )),
        resetSelection: (sessionId) => update(sessionId, session => (
            session.selectedIds.length === 0 && session.visibilityMode === 'browse'
                ? session
                : { ...session, selectedIds: [], visibilityMode: 'browse' }
        )),
        clearSession: (sessionId) => {
            if (!get().sessions[sessionId]) return;
            set(state => {
                const sessions = { ...state.sessions };
                delete sessions[sessionId];
                return { sessions };
            });
        },
    };
});

/** 关掉此刻打开着的目录（首页整个离开时，宿主调）。 */
export const closeOpenLibraryDirectory = (): void => {
    const { openDirectoryKey, closeDirectory } = useLibraryDirectorySessionStore.getState();
    if (openDirectoryKey !== null) closeDirectory(openDirectoryKey);
};

/** 现读一个目录会话（没有就是空会话）。 */
export const getLibraryDirectorySession = (sessionId: string): LibraryDirectorySession => (
    useLibraryDirectorySessionStore.getState().sessions[sessionId] ?? EMPTY_DIRECTORY_SESSION
);
