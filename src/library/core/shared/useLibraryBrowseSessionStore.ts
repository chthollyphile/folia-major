import { create } from 'zustand';
import type { LibraryBrowseSession } from './session.contract';

// src/library/core/shared/useLibraryBrowseSessionStore.ts
// 集合的浏览会话：筛选词和语义焦点（条目键）。跨 renderer 保留——从网格切到列表再切回来，
// 筛选和「看到哪首」都还在。布局坐标（网格的拖拽位置）不在这里，由各 renderer 自己存。
//
// 只在内存里：页面刷新本来就不会恢复打开的集合（启动时会替换掉历史记录）。会话按集合身份分开，
// 返回按钮会清掉它（与原先清掉网格恢复记录一致），Escape 与浏览器后退则保留。P4.5 起「返回按钮 = 完成」由宿主
// 统一执行（library/app 的 GridViewOverlayHost：清会话 + 让每套 suite 忘掉布局记录），不再写在各 suite 的按钮里。
//
// 清掉之后，正在离开的那一层卸载时可能还想把焦点写回（TUI 的卸载写回）：每次清会话把这个键的「代」加一，
// 离开时的写回带着挂载时的代（getLibrarySessionGeneration），代变了就不写，免得把刚清掉的会话又写出来。

const MAX_SESSIONS = 32;

/** 每个会话键被清过几次（「完成」一次加一）；只在内存里，不进 store 状态（不触发订阅者）。 */
const sessionGenerations = new Map<string, number>();

/** 这个会话键现在的代。离开时的写回先比一比：挂载以来被清过（用户点了返回按钮），就不写。 */
export const getLibrarySessionGeneration = (sessionKey: string): number => sessionGenerations.get(sessionKey) ?? 0;
const EMPTY_SESSION: LibraryBrowseSession = { query: '', focusedEntryKey: null };

type LibraryBrowseSessionState = {
    sessions: Record<string, LibraryBrowseSession>;
    /** 最近使用在后；超过上限时从前面丢。 */
    order: string[];
    setQuery: (sessionKey: string, query: string) => void;
    setFocusedEntry: (sessionKey: string, focusedEntryKey: string | null) => void;
    clearSession: (sessionKey: string) => void;
};

// 写一条会话并把它挪到最近使用的位置；超出上限时丢掉最久没用的。
const writeSession = (
    state: Pick<LibraryBrowseSessionState, 'sessions' | 'order'>,
    sessionKey: string,
    patch: Partial<LibraryBrowseSession>,
): Pick<LibraryBrowseSessionState, 'sessions' | 'order'> => {
    const sessions = { ...state.sessions, [sessionKey]: { ...(state.sessions[sessionKey] ?? EMPTY_SESSION), ...patch } };
    const order = [...state.order.filter(key => key !== sessionKey), sessionKey];
    while (order.length > MAX_SESSIONS) {
        const dropped = order.shift()!;
        delete sessions[dropped];
    }
    return { sessions, order };
};

export const useLibraryBrowseSessionStore = create<LibraryBrowseSessionState>((set, get) => ({
    sessions: {},
    order: [],
    setQuery: (sessionKey, query) => {
        if ((get().sessions[sessionKey]?.query ?? '') === query) return;
        set(state => writeSession(state, sessionKey, { query }));
    },
    setFocusedEntry: (sessionKey, focusedEntryKey) => {
        if ((get().sessions[sessionKey]?.focusedEntryKey ?? null) === focusedEntryKey) return;
        set(state => writeSession(state, sessionKey, { focusedEntryKey }));
    },
    clearSession: (sessionKey) => {
        // 没有会话也要换代：正在离开的那一层可能马上就要写回焦点。
        sessionGenerations.set(sessionKey, getLibrarySessionGeneration(sessionKey) + 1);
        if (!get().sessions[sessionKey]) return;
        set(state => {
            const sessions = { ...state.sessions };
            delete sessions[sessionKey];
            return { sessions, order: state.order.filter(key => key !== sessionKey) };
        });
    },
}));

export const getLibraryBrowseSession = (sessionKey: string): LibraryBrowseSession => (
    useLibraryBrowseSessionStore.getState().sessions[sessionKey] ?? EMPTY_SESSION
);

// renderer 把「当前看到哪首」写回会话的时机：网格只在点卡片、嵌套跳转时持久化焦点，切 renderer
// 之前要额外问它一次。每个会话只认最后注册的那个 renderer，旧实例卸载时不会注销新实例。
const sessionFlushers = new Map<string, () => void>();

/** 注册「把焦点写回会话」的回调，返回注销函数。 */
export const registerLibrarySessionFlush = (sessionKey: string, flush: () => void): (() => void) => {
    sessionFlushers.set(sessionKey, flush);
    return () => {
        if (sessionFlushers.get(sessionKey) === flush) {
            sessionFlushers.delete(sessionKey);
        }
    };
};

export const flushLibrarySession = (sessionKey: string): void => {
    sessionFlushers.get(sessionKey)?.();
};
