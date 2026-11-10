import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CollectionView } from '../../core/collection/useCollectionView';
import { resolveRowAfterRemoval } from '../../core/collection/collectionEntries';
import {
    getLibraryBrowseSession,
    getLibrarySessionGeneration,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '../../core/shared/useLibraryBrowseSessionStore';

// src/library/suites/tui/useLibraryTuiFocus.ts
// TUI 的焦点按条目键记，而不是按行号：筛选变了、分页追加了，同一首仍是同一首；
// 焦点那首不在当前行里时落到第一行。初值取自浏览会话（例如刚从网格切过来）。
// 例外是删除：焦点条目被删掉（或被替换）之后，焦点落在原位置的下一行，删的是最后一行就落到上一行
// （core/collection/collectionEntries 的 resolveRowAfterRemoval）。
// 写回会话（P4.4）：播放、压入嵌套的专辑 / 歌手页之前写一次（persistFocus），换 suite 的冲刷与卸载时再写一次
// （flushFocus）——后两者只在用户在这里动过焦点时才写：没动过就写，会把会话里的焦点（例如网格记下的那首、
// 还没分页到的那首）盖成第一行。

/** 一次删除发起时的焦点：它从行里消失时据此换算新焦点。 */
type PendingRemovalFocus = {
    key: string;
    row: number;
    rowKeys: readonly string[];
    /** 发起时的筛选：筛选变了，消失就不是删除造成的。 */
    query: string;
};

export const useLibraryTuiFocus = (sessionKey: string, view: CollectionView, committedQuery = '') => {
    /** 每一行对应的展示下标（在 view.displayTracks 里）。 */
    const rowDisplayIndexes = useMemo(
        () => view.matchIndexes ?? view.displayTracks.map((_, index) => index),
        [view.displayTracks, view.matchIndexes],
    );
    const rowKeys = useMemo(
        () => rowDisplayIndexes.map(index => view.entryKeyAt(index) ?? ''),
        [rowDisplayIndexes, view],
    );

    const [focusedKey, setFocusedKey] = useState<string | null>(() => getLibraryBrowseSession(sessionKey).focusedEntryKey);
    const focusedKeyRef = useRef(focusedKey);
    focusedKeyRef.current = focusedKey;

    const [removal, setRemoval] = useState<PendingRemovalFocus | null>(null);

    // 焦点条目在删除之后消失：换算成原位置的下一行。渲染时就用换算结果（不闪到第一行），随后写回状态。
    let effectiveKey = focusedKey;
    const foundKey = focusedKey ? rowKeys.indexOf(focusedKey) : -1;
    const settlesRemoval = Boolean(removal)
        && removal!.key === focusedKey
        && removal!.query === committedQuery
        && foundKey < 0
        && removal!.rowKeys !== rowKeys;
    if (settlesRemoval) {
        const row = resolveRowAfterRemoval(removal!.rowKeys, removal!.row, rowKeys);
        effectiveKey = row >= 0 ? rowKeys[row] : null;
    }
    useLayoutEffect(() => {
        if (!settlesRemoval) return;
        setFocusedKey(effectiveKey);
        setRemoval(null);
    }, [effectiveKey, settlesRemoval]);

    const found = effectiveKey ? rowKeys.indexOf(effectiveKey) : -1;
    const focusedRow = rowKeys.length === 0 ? -1 : Math.max(found, 0);
    // 此刻真正落在哪一项（焦点那首不在行里时是第一行）：卸载时按它写回。
    const currentKeyRef = useRef<string | null>(null);
    currentKeyRef.current = focusedRow >= 0 ? rowKeys[focusedRow] || null : null;
    /** 用户在这里动过焦点（移动、点击、删除、播放 / 打开）。 */
    const touchedRef = useRef(false);
    /** 挂载时会话的代（见 core/shared/useLibraryBrowseSessionStore）。 */
    const mountGenerationRef = useRef(getLibrarySessionGeneration(sessionKey));

    const moveFocus = useCallback((resolve: (current: number) => number) => {
        if (rowKeys.length === 0) return;
        const next = resolve(Math.max(focusedRow, 0));
        touchedRef.current = true;
        setRemoval(null);
        setFocusedKey(rowKeys[Math.max(0, Math.min(next, rowKeys.length - 1))] ?? null);
    }, [focusedRow, rowKeys]);

    /** 删除焦点行之前调用：它消失时焦点落到原位置的下一行。 */
    const markRemoval = useCallback((row: number) => {
        const key = rowKeys[row];
        if (!key) return;
        touchedRef.current = true;
        setFocusedKey(key);
        setRemoval({ key, row, rowKeys, query: committedQuery });
    }, [committedQuery, rowKeys]);

    /** 删除没做成时撤掉标记（做成了不撤：行可能还没换成新的，等它消失时换算）。 */
    const clearRemoval = useCallback((key: string) => {
        setRemoval(current => (current?.key === key ? null : current));
    }, []);

    const focusRow = useCallback((row: number) => moveFocus(() => row), [moveFocus]);

    /** 把焦点写回会话（播放、压入嵌套层之前）；给了行号就写那一行（例如双击的行）。 */
    const persistFocus = useCallback((row: number = focusedRow) => {
        const key = row >= 0 ? rowKeys[row] : focusedKeyRef.current;
        touchedRef.current = true;
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, key || null);
    }, [focusedRow, rowKeys, sessionKey]);
    /** 冲刷（换 suite 之前）与卸载时用：没动过焦点、或者还没有任何行（数据没到）时什么都不写；
     *  挂载以来会话被清过（用户点了返回按钮 = 完成，宿主先清会话再返回）时也不写。 */
    const flushFocus = useCallback(() => {
        if (!touchedRef.current || !currentKeyRef.current) return;
        if (getLibrarySessionGeneration(sessionKey) !== mountGenerationRef.current) return;
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, currentKeyRef.current);
    }, [sessionKey]);

    useEffect(() => registerLibrarySessionFlush(sessionKey, flushFocus), [flushFocus, sessionKey]);
    // 卸载时（压入下一层、返回、换 suite）也写一次：回来时焦点还在这一项上。
    useEffect(() => flushFocus, [flushFocus]);

    return { rowDisplayIndexes, rowKeys, focusedRow, moveFocus, focusRow, persistFocus, markRemoval, clearRemoval };
};
