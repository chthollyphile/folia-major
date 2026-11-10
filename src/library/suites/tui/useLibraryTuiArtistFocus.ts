import { useCallback, useEffect, useRef, useState } from 'react';
import { artistEntryPane } from '../../core/artist/artistSurface';
import {
    getLibraryBrowseSession,
    getLibrarySessionGeneration,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '../../core/shared/useLibraryBrowseSessionStore';

// src/library/suites/tui/useLibraryTuiArtistFocus.ts
// TUI 歌手页的焦点：两栏（热门歌曲 / 专辑）各记一个条目键（song:… / album:…，与网格认同一个键），外加当前在哪一栏。
// 初值取自浏览会话（例如刚从网格切过来）；焦点那一项不在当前行里（筛选变了、专辑还没分页到）时落到第一行，
// 等它出现再回到它。播放 / 打开专辑之前、切换 suite 之前（会话冲刷）和卸载时，把当前栏的焦点写回会话。

export type LibraryTuiArtistPane = 'songs' | 'albums';

export const useLibraryTuiArtistFocus = (sessionKey: string, songKeys: readonly string[], albumKeys: readonly string[]) => {
    const [initialKey] = useState(() => getLibraryBrowseSession(sessionKey).focusedEntryKey);
    const [pane, setPane] = useState<LibraryTuiArtistPane>(() => artistEntryPane(initialKey) ?? 'songs');
    const [songKey, setSongKey] = useState<string | null>(() => (artistEntryPane(initialKey) === 'songs' ? initialKey : null));
    const [albumKey, setAlbumKey] = useState<string | null>(() => (artistEntryPane(initialKey) === 'albums' ? initialKey : null));

    const rowOf = (keys: readonly string[], key: string | null) => (keys.length === 0 ? -1 : Math.max(key ? keys.indexOf(key) : 0, 0));
    const songRow = rowOf(songKeys, songKey);
    const albumRow = rowOf(albumKeys, albumKey);
    const focusedRow = pane === 'songs' ? songRow : albumRow;
    const rowCount = pane === 'songs' ? songKeys.length : albumKeys.length;
    const focusedKey = pane === 'songs' ? songKeys[songRow] ?? null : albumKeys[albumRow] ?? null;
    const focusedKeyRef = useRef(focusedKey);
    focusedKeyRef.current = focusedKey;
    // 用户在这里动过焦点（或会话里本来就有）才写回：没动过就写第一行，会让网格回来时不再停在介绍卡上。
    const touchedRef = useRef(Boolean(initialKey));
    /** 挂载时会话的代（见 core/shared/useLibraryBrowseSessionStore）。 */
    const mountGenerationRef = useRef(getLibrarySessionGeneration(sessionKey));

    /** 在当前栏里移动焦点（resolve 拿到当前行号，返回新行号）。 */
    const moveFocus = useCallback((resolve: (current: number) => number) => {
        const keys = pane === 'songs' ? songKeys : albumKeys;
        if (keys.length === 0) return;
        touchedRef.current = true;
        const next = keys[Math.max(0, Math.min(resolve(Math.max(focusedRow, 0)), keys.length - 1))] ?? null;
        if (pane === 'songs') setSongKey(next);
        else setAlbumKey(next);
    }, [albumKeys, focusedRow, pane, songKeys]);

    /** 把焦点放到某一栏的某一行（点击）。 */
    const focusRow = useCallback((target: LibraryTuiArtistPane, row: number) => {
        const keys = target === 'songs' ? songKeys : albumKeys;
        const key = keys[row];
        if (!key) return;
        touchedRef.current = true;
        setPane(target);
        if (target === 'songs') setSongKey(key);
        else setAlbumKey(key);
    }, [albumKeys, songKeys]);

    /** Tab：换到另一栏（那一栏没有行时不动）。 */
    const togglePane = useCallback(() => {
        const target: LibraryTuiArtistPane = pane === 'songs' ? 'albums' : 'songs';
        if ((target === 'songs' ? songKeys : albumKeys).length === 0) return;
        touchedRef.current = true;
        setPane(target);
    }, [albumKeys, pane, songKeys]);

    /** 把焦点写回会话；给了键就写那一项（例如双击的那一行）。 */
    const persistFocus = useCallback((key?: string | null) => {
        if (key) touchedRef.current = true;
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, (key ?? focusedKeyRef.current) || null);
    }, [sessionKey]);
    /** 冲刷与卸载时用：没动过焦点、或者还没有任何行（数据没到）时什么都不写；挂载以来会话被清过（返回按钮 =
     *  完成，宿主先清会话再返回）时也不写，否则卸载会把刚清掉的会话又写出来。 */
    const flushFocus = useCallback(() => {
        if (getLibrarySessionGeneration(sessionKey) !== mountGenerationRef.current) return;
        if (touchedRef.current && focusedKeyRef.current) persistFocus();
    }, [persistFocus, sessionKey]);

    useEffect(() => registerLibrarySessionFlush(sessionKey, flushFocus), [flushFocus, sessionKey]);
    // 卸载时（压入下一层、返回、换 suite）也写一次：回来时焦点还在这一项上。
    useEffect(() => flushFocus, [flushFocus]);

    return { pane, songRow, albumRow, focusedRow, rowCount, focusedKey, moveFocus, focusRow, togglePane, persistFocus };
};
