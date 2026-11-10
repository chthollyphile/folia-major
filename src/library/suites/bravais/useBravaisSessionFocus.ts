import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getLibraryBrowseSession,
    getLibrarySessionGeneration,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '../../core/shared/useLibraryBrowseSessionStore';

// src/library/suites/bravais/useBravaisSessionFocus.ts
// 集合页的焦点写回浏览会话（与 TUI 的 useLibraryTuiFocus 同一套约定）：stage 每次挪键盘焦点就经层描述的
// onFocusEntry 告诉 surface（离散、低频），surface 只记在 ref 里；压入嵌套层之前写一次（persist），换 suite 的冲刷与
// 卸载时再写一次（flush）——后两者只在用户在这里动过焦点时写，而且挂载以来会话被清过（点了返回按钮 = 完成）就不写。

export const useBravaisSessionFocus = (sessionKey: string) => {
    const [initialKey] = useState(() => getLibraryBrowseSession(sessionKey).focusedEntryKey);
    const currentRef = useRef<string | null>(initialKey);
    const touchedRef = useRef(false);
    const mountGenerationRef = useRef(getLibrarySessionGeneration(sessionKey));

    const noteFocus = useCallback((key: string | null) => {
        currentRef.current = key;
        touchedRef.current = true;
    }, []);

    /** 打开嵌套的专辑 / 歌手、播放之前：把这一项写回会话（返回时焦点回到它）。 */
    const persistFocus = useCallback((key?: string | null) => {
        if (key !== undefined) currentRef.current = key;
        touchedRef.current = true;
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, currentRef.current);
    }, [sessionKey]);

    const flushFocus = useCallback(() => {
        if (!touchedRef.current || !currentRef.current) return;
        if (getLibrarySessionGeneration(sessionKey) !== mountGenerationRef.current) return;
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, currentRef.current);
    }, [sessionKey]);

    useEffect(() => registerLibrarySessionFlush(sessionKey, flushFocus), [flushFocus, sessionKey]);
    useEffect(() => flushFocus, [flushFocus]);

    return { initialKey, noteFocus, persistFocus };
};
