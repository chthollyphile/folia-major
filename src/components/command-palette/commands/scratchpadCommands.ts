import { NotebookPen, PanelLeft } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createSettingsAnchorCommand, createToggleCommand } from '../commandFactories';
import { collectToScratchpad, toggleScratchpad } from '../../../stores/useScratchpadStore';
import { isStagePlaybackSong } from '../../../utils/appPlaybackGuards';
import { selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useScratchpadSettingsStore } from '../../../stores/useScratchpadSettingsStore';

// src/components/command-palette/commands/scratchpadCommands.ts
// 速记簿的命令：开合左边的抽屉，把正在播的这首记进去（不动队列），这两条都能绑全局快捷键；
// 另有显示 / 隐藏左缘的悬浮把手，和跳到设置里速记簿那一组（主页与歌单页）。
// 开合抽屉是 Ctrl+J（J 取 jot / 记，设置帮助页「键盘快捷键」里列着），执行模式 `:j`；记下这首是 `:s`（收）。

export const scratchpadCommands: CommandPaletteCommand[] = [
    createToggleCommand(
        'scratchpad-toggle',
        'panel',
        'Open or close the scratchpad',
        'Slide out the scratchpad: songs to hear or sort out later',
        ['scratchpad', 'later', 'listen later', 'notebook', '速记簿', '稍后再听', '暂存', '记事本'],
        () => toggleScratchpad(),
        { icon: NotebookPen, openHotkey: { key: 'j', ctrl: true }, executeShortcut: 'j' },
    ),
    createToggleCommand(
        'scratchpad-collect-current',
        'playback',
        'Jot the current song into the scratchpad',
        'Keep this song for later without touching the queue',
        ['scratchpad', 'later', 'jot', 'save for later', '速记簿', '稍后再听', '记下', '暂存'],
        () => {
            // 屏幕上的那首：自动混音过渡中 currentSong 已经是淡入的下一首，记下的应该是听得见、看得见的这首。
            const song = selectDisplaySong(usePlaybackStore.getState());
            if (song && !isStagePlaybackSong(song)) collectToScratchpad([song]);
        },
        {
            icon: NotebookPen,
            executeShortcut: 's',
            isAvailable: context => (context ? Boolean(context.shared.currentSong && !isStagePlaybackSong(context.shared.currentSong)) : true),
        },
    ),
    createToggleCommand(
        'scratchpad-handle-toggle',
        'settings',
        'Show or hide the scratchpad side tab',
        'The tab on the left edge that opens the scratchpad',
        ['scratchpad tab', 'side tab', 'edge handle', 'hide tab', '速记簿', '悬浮标签', '左侧标签', '把手'],
        () => useScratchpadSettingsStore.getState().toggleShowHandle(),
        { icon: PanelLeft },
    ),
    createSettingsAnchorCommand(
        'settings-scratchpad',
        'Scratchpad settings',
        'Whether the side tab shows, and how high it sits',
        ['scratchpad', 'side tab height', 'edge handle', '速记簿', '悬浮标签高度', '把手位置'],
        'scratchpadSettings',
    ),
];
