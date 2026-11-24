import type { SongResult } from '../../types';
import { useScratchpadStore } from '../../stores/useScratchpadStore';
import { useSongNotesStore } from './useSongNotesStore';

// src/components/song-notes/songNoteNavigation.ts
// 从别处去速记簿「时刻」页的两条路：
// - 看一首歌的评论与标签（另外三页卡片上的「评论」钮）：收起的面板，看那一首（顶上出「回到正在播放」）；
// - 看一个标签组（命令 #标签、首页 Folia 的标签卡）：展开整页，滚到那一组。

export const openSongComments = (song: SongResult) => {
    useSongNotesStore.getState().view(song);
    const scratchpad = useScratchpadStore.getState();
    scratchpad.setTab('comments');
    scratchpad.setExpanded(false);
    scratchpad.setOpen(true);
};

export const openSongNoteTag = (tagKey: string) => {
    useSongNotesStore.getState().focusTag(tagKey);
    const scratchpad = useScratchpadStore.getState();
    scratchpad.setTab('comments');
    scratchpad.setExpanded(true);
    scratchpad.setOpen(true);
};
