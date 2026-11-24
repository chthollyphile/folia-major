import { create } from 'zustand';
import type { SongResult } from '../../../types';

// src/components/app/scratchpad/songNoteTagPopoverStore.ts
// 速记簿里两块标签小浮层开着哪一块（画它们的是 ScratchpadTagPopovers，挂在速记簿根上一份）：
// - editor：整理一个标签（「时刻」展开整页的组头）：改名 / 合并、往前往后挪、删除；
// - batch：给一批歌打标签或去掉标签（四页画布多选后的浮动菜单「打标签」）。
// 打开的按钮在组头、浮动菜单里，按钮不知道浮层画在哪，这里只记开着什么、贴着哪个按钮（视口坐标）。

export type SongNoteTagPopover =
    | { kind: 'editor'; tagKey: string; anchor: DOMRect }
    | { kind: 'batch'; songs: SongResult[]; anchor: DOMRect };

type SongNoteTagPopoverState = {
    open: SongNoteTagPopover | null;
};

export const useSongNoteTagPopoverStore = create<SongNoteTagPopoverState>(() => ({ open: null }));

/** 按钮的位置：组头、浮动菜单里的按钮由 data 属性找（ScratchpadAction 的 run 不带事件）。找不到时贴着视口正中。 */
const anchorOf = (selector: string): DOMRect => {
    const element = document.querySelector(selector);
    if (element) return element.getBoundingClientRect();
    return new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
};

export const openTagEditor = (tagKey: string, groupKey: string) => {
    useSongNoteTagPopoverStore.setState({
        open: { kind: 'editor', tagKey, anchor: anchorOf(`[data-scratchpad-group="${CSS.escape(groupKey)}"] [data-scratchpad-action="manage-tag"]`) },
    });
};

export const openBatchTagger = (songs: readonly SongResult[]) => {
    if (songs.length === 0) return;
    useSongNoteTagPopoverStore.setState({
        open: { kind: 'batch', songs: [...songs], anchor: anchorOf('[data-scratchpad-selection-action="tag"]') },
    });
};

export const closeTagPopover = () => useSongNoteTagPopoverStore.setState({ open: null });
