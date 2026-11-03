import { useEffect, useRef } from 'react';
import type { LibraryQueryPort } from '../../core/shared/session.contract';
import { useCommittedQuery } from '../../core/shared/useCommittedQuery';
import { registerCommandFilter } from '../../../stores/useAppViewStore';
import { hasBlockingWindow } from '../../../utils/keyboardTargets';
import { resolveBravaisTypingKey } from './bravaisKeyboardModel';
import { setBravaisFilterEditing, useBravaisUiStore } from './bravaisUiStore';

// src/library/suites/bravais/useBravaisSeamFilter.ts
// 每面墙的「当前页过滤」（设计稿 §7.6「过滤：缝里的输入位」）：过滤词落在这一层的 core 会话 query 上（集合 / 歌手页是
// 浏览会话 useLibrarySessionQuery，首页各页签是目录会话 useLibraryDirectoryQuery，换 suite 不丢），输入位是缝自己的
// （BravaisSeamFilterField）。这里向命令面板注册同一个 query（scope.filter：命令面板的 filter-view 与 `--play` / `--add`
// 仍作用于它），并声明 ownInput：墙上打字时命令面板留下自己的 `:`（与可选的 `s`）之后把按键交给缝——
// - 输入位挂着（缝是完整信息条 / 首页窄缝 / 面板）：把焦点挪进去、不 preventDefault，这一下按键本身落进输入框；
// - 还没挂（书脊、折叠、翻牌途中）：标记「正在输入」让缝临时展开，字符先追加进 query（输入法的开头没有字，只展开），
//   输入位挂上时拿焦点、光标在末尾。
// 输入法组词期间墙用的过滤词停在组词开始前的那一个，组完再提交（filterComposing 由输入位报告）。

/** 把焦点挪进此刻挂着的输入位（光标放到末尾）；挪不进去（没挂、在翻走的那一半里）返回 false。 */
export const focusBravaisFilterInput = (): boolean => {
    const input = useBravaisUiStore.getState().filterInput;
    if (!input || !input.isConnected || input.closest('[inert]')) return false;
    if (document.activeElement !== input) {
        const end = input.value.length;
        try {
            input.setSelectionRange(end, end);
        } catch {
            // 个别输入类型不支持选区：照样聚焦。
        }
        input.focus({ preventScroll: true });
    }
    return document.activeElement === input;
};

/** 打开过滤输入位（命令面板的 openCommandFilter 请求、首页「⋯」里的「过滤当前页」、书脊上的过滤图标）。 */
export const openBravaisFilter = () => {
    setBravaisFilterEditing(true);
    focusBravaisFilterInput();
};

/** 墙上的一下打字：交给缝里的输入位（见文件头）。返回 false 时按键原样放行。 */
const takeBravaisFilterKey = (event: KeyboardEvent, port: LibraryQueryPort, reserved: readonly string[]): boolean => {
    const kind = resolveBravaisTypingKey(event, reserved);
    if (!kind || hasBlockingWindow()) return false;
    setBravaisFilterEditing(true);
    if (focusBravaisFilterInput()) return true;
    if (kind === 'char') {
        event.preventDefault();
        port.setQuery(`${port.getQuery()}${event.key}`);
    }
    return true;
};

/** 组词期间按住的过滤词（组词开始前的值）；不在组词就是传入的值。 */
const useCompositionHold = (query: string) => {
    const isComposing = useBravaisUiStore(state => state.filterComposing);
    const heldRef = useRef(query);
    if (!isComposing) heldRef.current = query;
    return isComposing ? heldRef.current : query;
};

/**
 * 注册这一层的过滤（只在这一层可交互时）并给出墙与范围实际用的过滤词（防抖、组词按住之后）。
 * `reserved`：这一层上不当过滤字符的键（首页非批量模式时的 `/` 是全局搜索），按下时现读。
 */
export const useBravaisSeamFilter = ({
    port,
    query,
    isActive,
    reserved,
}: {
    port: LibraryQueryPort;
    query: string;
    isActive: boolean;
    reserved?: () => readonly string[];
}) => {
    const latest = useRef({ port, reserved });
    latest.current = { port, reserved };

    useEffect(() => {
        if (!isActive) return undefined;
        return registerCommandFilter({
            getQuery: () => latest.current.port.getQuery(),
            setQuery: next => latest.current.port.setQuery(next),
            // 缝自己画输入位：命令面板的 filter-view（列表里选它、Ctrl/Cmd+F）没有锚点可贴，退回它自己的浮层。
            getAnchor: () => null,
            focusResults: () => useBravaisUiStore.getState().focusFirst?.() ?? false,
            ownInput: {
                takeKey: event => takeBravaisFilterKey(event, latest.current.port, latest.current.reserved?.() ?? []),
                open: openBravaisFilter,
            },
        });
    }, [isActive]);

    return useCommittedQuery(useCompositionHold(query));
};
