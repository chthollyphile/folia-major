import { ListMusic, ListPlus, Play, RefreshCw, RotateCcw, Shuffle, SquarePen } from 'lucide-react';
import { createArtistSurfaceCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/artistCommands.ts
// 歌手页的动作，从键盘也能到（P4.2）。
//
// 只在歌手页正在交互时出现（它注册 artist surface，见 core/artist/useLibraryArtistSurfaceStore），能不能做来自
// core 的歌手能力（core/artist/artistSurface）再与渲染它的 suite 的声明取交集——与页面上的按钮、键位同一个来源。
// 单曲的播放 / 入队、打开专辑 / 歌手作用于某一张卡或某一行，不在这里（与集合页一致）；筛选是命令面板自己的筛选框。
// 都不带 executeShortcut：它们只在歌手页上有意义，不值得占一个全局前缀。

export const artistCommands: CommandPaletteCommand[] = [
    createArtistSurfaceCommand(
        'artist-play-top-songs',
        'Play top songs',
        "Play the artist's playable top songs from the first one",
        ['play artist', 'play popular', '播放热门', '播放歌手'],
        'play-top-songs',
        Play,
    ),
    createArtistSurfaceCommand(
        'artist-shuffle-top-songs',
        'Shuffle play top songs',
        "Make the artist's playable top songs the play queue in shuffled order",
        ['shuffle artist', 'shuffle popular', 'random', '随机播放热门', '随机播放歌手', '打乱播放'],
        'shuffle-top-songs',
        Shuffle,
    ),
    createArtistSurfaceCommand(
        'artist-enqueue-top-songs',
        'Queue top songs',
        "Add the artist's top songs to the play queue",
        ['queue popular', 'add top songs', '热门歌曲入队', '加入队列'],
        'enqueue-top-songs',
        ListPlus,
    ),
    createArtistSurfaceCommand(
        'artist-reload',
        'Reload artist',
        'Load the artist page again from the source',
        ['refresh artist', 'retry', '重新加载', '刷新歌手'],
        'reload',
        RefreshCw,
    ),
    createArtistSurfaceCommand(
        'artist-retry-albums',
        'Resume loading albums',
        'Retry the album page that failed and keep loading the rest',
        ['retry albums', 'resume albums', '继续加载专辑', '重试'],
        'retry-albums',
        RotateCcw,
    ),
    createArtistSurfaceCommand(
        'artist-edit-entity',
        'Edit artist info',
        'Open the local library editor for this artist',
        ['edit artist', 'artist info', '编辑歌手', '歌手信息'],
        'edit-entity',
        SquarePen,
    ),
    // #918：不在任何专辑里的单曲只在「全部歌曲」那一层看得到；只给在线歌手，热门歌曲之外还有歌时才出现。
    createArtistSurfaceCommand(
        'artist-open-all-songs',
        'Open all songs',
        'List every song by this artist on one page, including singles outside any album',
        ['every song', 'artist songs', 'singles', '所有歌曲', '单曲'],
        'open-all-songs',
        ListMusic,
    ),
];
