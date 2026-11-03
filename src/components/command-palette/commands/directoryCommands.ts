import { Eye, EyeOff, FolderX, ListChecks, ListPlus, ListX, Play, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { createDirectorySurfaceCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/directoryCommands.ts
// 首页目录（GridMap）的批选与隐藏动作，从键盘也能到。
//
// 只在 GridMap 正在交互时出现（它注册 directory surface，见 core/directory/useLibraryDirectorySurfaceStore），
// 能不能做来自 core 的批量能力——与批量面板的按钮同一个来源，面板不可点的时候命令也不出现。
// 都不带 executeShortcut：删除要确认，其余是只在地图上才有意义的上下文动作。
// 后四条作用于目录里的焦点那一项（隐藏焦点歌单、重扫 / 移除焦点导入根、恢复焦点忽略目录），只有有焦点概念的目录
// （TUI 的目录列表）发布它们；网格用卡片与批量面板目录树上的按钮做同样的事。移除导入根同样先确认。

export const directoryCommands: CommandPaletteCommand[] = [
    createDirectorySurfaceCommand(
        'directory-play-selection',
        'Play selected cards',
        'Play the songs of the cards selected on the map, in card order',
        ['play selection', 'batch play', '播放选中', '批量播放'],
        'play-selection',
        Play,
    ),
    createDirectorySurfaceCommand(
        'directory-enqueue-selection',
        'Queue selected cards',
        'Add the songs of the cards selected on the map to the queue',
        ['enqueue selection', 'batch queue', '加入队列', '批量入队'],
        'enqueue-selection',
        ListPlus,
    ),
    createDirectorySurfaceCommand(
        'directory-create-playlist',
        'New playlist from selection',
        'Create a local playlist with the songs of the selected cards',
        ['playlist from selection', 'save selection', '新建歌单', '选中建歌单'],
        'create-playlist',
        Plus,
        {
            requiresInput: true,
            placeholder: context => context.shared.t('home.gridFolderPlaylistNamePlaceholder', 'Playlist name'),
        },
    ),
    createDirectorySurfaceCommand(
        'directory-remove-selection',
        'Remove selected from library',
        'Ask to remove the selected folders and their songs from the local library',
        ['delete selection', 'remove folders', '删除选中', '从曲库删除'],
        'remove-selection',
        Trash2,
    ),
    createDirectorySurfaceCommand(
        'directory-select-all',
        'Select all filtered cards',
        'Open the batch panel and select every card the filter shows',
        ['select all', 'batch select', '全选', '批量选择'],
        'select-all',
        ListChecks,
    ),
    createDirectorySurfaceCommand(
        'directory-clear-selection',
        'Clear selection',
        'Deselect every card on the map',
        ['deselect', 'select none', '取消选择', '清空选择'],
        'clear-selection',
        ListX,
    ),
    createDirectorySurfaceCommand(
        'directory-manage-hidden',
        'Manage hidden playlists',
        'Show hidden playlists on the map so you can hide or unhide them, or leave that view',
        ['hide playlists', 'unhide', 'hidden', '隐藏歌单', '管理隐藏', '取消隐藏'],
        'manage-hidden',
        EyeOff,
    ),
    createDirectorySurfaceCommand(
        'directory-toggle-hidden',
        'Hide or unhide the focused playlist',
        'Hide the focused playlist from the home directory, or bring it back',
        ['hide', 'unhide', 'hide playlist', '隐藏', '取消隐藏'],
        'toggle-hidden',
        Eye,
    ),
    createDirectorySurfaceCommand(
        'directory-rescan-root',
        'Rescan the focused imported folder',
        'Scan the focused imported root folder again',
        ['rescan', 'rescan folder', '重新扫描', '重扫'],
        'rescan-root',
        RefreshCw,
    ),
    createDirectorySurfaceCommand(
        'directory-remove-root',
        'Remove the focused imported folder',
        'Ask to remove the focused imported root folder and its songs from the local library',
        ['remove root', 'remove imported folder', '移除导入目录', '移除根目录'],
        'remove-root',
        FolderX,
    ),
    createDirectorySurfaceCommand(
        'directory-clear-ignore',
        'Restore the focused ignored folder',
        'Stop ignoring the focused folder and scan it again',
        ['restore folder', 'unignore', '恢复目录', '取消忽略'],
        'clear-ignore',
        RotateCcw,
    ),
];
