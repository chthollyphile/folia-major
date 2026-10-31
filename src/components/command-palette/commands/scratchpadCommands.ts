import { NotebookPen } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand } from '../commandFactories';
import { collectToScratchpad, toggleScratchpad } from '../../../stores/useScratchpadStore';
import { isStagePlaybackSong } from '../../../utils/appPlaybackGuards';

// src/components/command-palette/commands/scratchpadCommands.ts
// 速记簿的两条命令：开合左边的抽屉，把正在播的这首记进去（不动队列）。两条都能绑全局快捷键。

export const scratchpadCommands: CommandPaletteCommand[] = [
    createToggleCommand(
        'scratchpad-toggle',
        'panel',
        'Open or close the scratchpad',
        'Slide out the scratchpad: songs to hear or sort out later',
        ['scratchpad', 'later', 'listen later', 'notebook', '速记簿', '稍后再听', '暂存', '记事本'],
        () => toggleScratchpad(),
        { icon: NotebookPen },
    ),
    createToggleCommand(
        'scratchpad-collect-current',
        'playback',
        'Jot the current song into the scratchpad',
        'Keep this song for later without touching the queue',
        ['scratchpad', 'later', 'jot', 'save for later', '速记簿', '稍后再听', '记下', '暂存'],
        context => {
            const song = context.shared.currentSong;
            if (song) collectToScratchpad([song]);
        },
        {
            icon: NotebookPen,
            isAvailable: context => (context ? Boolean(context.shared.currentSong && !isStagePlaybackSong(context.shared.currentSong)) : true),
        },
    ),
];
