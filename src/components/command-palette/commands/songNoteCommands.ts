import { MessageSquareQuote, Pin } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand } from '../commandFactories';
import { useScratchpadStore } from '../../../stores/useScratchpadStore';
import { isStagePlaybackSong } from '../../../utils/appPlaybackGuards';
import { markSongMoment } from '../../song-notes/songNotePin';
import { useSongNotesStore } from '../../song-notes/useSongNotesStore';

// src/components/command-palette/commands/songNoteCommands.ts
// 歌曲评论的命令（plan/music-notes-integration-plan.md「命令」）：
// - 记下这个时刻（执行模式 `:k`，取 mark 的末字母；`:m`、`:s`、`:p` 都已有）：在正在播的这首的当前位置留一道时间轴标记，不写字，
//   想写字就到速记簿「评论」页里改，或把胶囊右侧的槽位换成「记下这个时刻」（点了弹框写一句）；
//   槽位和这条命令是一对（PLAYER_CONTROL_SLOT_COMMAND_IDS），能不能用跟这里的 isAvailable 走；
// - 写评论：打开速记簿的「评论」页（看正在播的这首），输入框接焦点。

export const songNoteCommands: CommandPaletteCommand[] = [
    createToggleCommand(
        'song-notes-mark-moment',
        'playback',
        'Mark this moment',
        'Leave a timeline mark on the current song at this position',
        ['mark', 'pin', 'bookmark', 'timestamp', 'comment', '标记', '时刻', '书签', '时间轴', '评论', '图钉'],
        markSongMoment,
        {
            icon: Pin,
            executeShortcut: 'k',
            // 也上胶囊上方那排浮动命令：点了和槽位一样，在按钮上方弹「记下这个时刻」小框（借槽位 mark-moment 的解析）。
            isAvailable: context => (context ? Boolean(context.shared.currentSong && !isStagePlaybackSong(context.shared.currentSong)) : true),
        },
    ),
    createToggleCommand(
        'song-notes-write',
        'panel',
        'Write a comment',
        'Open the Moments page of the scratchpad for the current song',
        ['comment', 'note', 'tag', 'review', '评论', '笔记', '标签', '写评论', '速记簿'],
        () => {
            useSongNotesStore.getState().view(null);
            useSongNotesStore.getState().requestCompose();
            const scratchpad = useScratchpadStore.getState();
            scratchpad.setTab('comments');
            scratchpad.setExpanded(false);
            scratchpad.setOpen(true);
        },
        { icon: MessageSquareQuote },
    ),
];
