import type { CommandPaletteCommand } from '../types';
import { defineCommand, createToggleCommand, createHomeTabCommand } from '../commandFactories';

// src/components/command-palette/commands/navigationCommands.ts
// Commands in the `navigation` group: moving between home tabs, the player, and window-level views.

export const navigationCommands: CommandPaletteCommand[] = [
    defineCommand({
        id: 'lattice-focus-current', group: 'navigation', scope: 'lattice',
        title: 'Focus current song', description: 'Center the playing song on the wall',
        keywords: ['recenter', 'now playing', '聚焦当前歌曲', '回到当前歌曲'],
        isAvailable: context => !context || context.navigation.canFocusLatticeCurrentSong,
        execute: (_input, context) => context.navigation.focusLatticeCurrentSong(),
    }),
    createToggleCommand('navigate-home', 'navigation', 'Go home', 'Return to home view', ['home', '首页', '主页'], context => context.navigation.navigateToHome()),
    createToggleCommand('navigate-player', 'navigation', 'Go player', 'Return to player view', ['player', '播放页', '播放器'], context => context.navigation.navigateToPlayer()),
    createToggleCommand('navigate-lattice', 'navigation', 'Open song wall', 'Show the play queue as a poster wall', ['lattice', 'song wall', 'poster wall', '歌曲墙', '海报墙'], context => context.navigation.navigateToLattice()),
    {
        id: 'browser-fullscreen',
        group: 'navigation',
        title: 'Fullscreen',
        description: 'Toggle browser fullscreen',
        keywords: ['full screen', 'f11', 'browser fullscreen', '全屏', '浏览器全屏'],
        isAvailable: (context) => !context?.navigation.isWallpaperMode,
        execute: (_input, context) => context.navigation.toggleBrowserFullscreen(),
    },
    createHomeTabCommand('playlist', 'Open playlists', 'Open playlist home tab', ['playlist', 'playlists', '歌单']),
    createHomeTabCommand('local', 'Open local music', 'Open local music tab', ['local music', 'local', '本地', '本地音乐']),
    createHomeTabCommand('albums', 'Open albums', 'Open albums tab', ['albums', 'album', '专辑']),
    createHomeTabCommand('navidrome', 'Open Navidrome', 'Open Navidrome tab', ['navidrome', 'navi', '服务器']),
    createHomeTabCommand('radio', 'Open radio', 'Open radio tab', ['radio', 'fm', '电台']),
    {
        id: 'desktop-toggle-remote-control',
        platform: ['electron'],
        group: 'navigation',
        title: 'Toggle remote control window',
        description: 'Open or close the remote control window',
        keywords: ['remote control', 'remote window', 'toggle remote', '遥控窗口', '切换遥控窗口', '打开遥控'],
        execute: (_input, context) => context.navigation.toggleRemoteControlWindow(),
    },
    {
        id: 'desktop-toggle-main-window-always-on-top',
        platform: ['electron'],
        group: 'navigation',
        title: 'Toggle main window always on top',
        description: 'Pin or unpin the main window above other windows',
        keywords: ['always on top', 'main window on top', 'pin main window', '主窗口置顶', '切换主窗口置顶', '取消主窗口置顶'],
        isAvailable: (context) => !context?.navigation.isWallpaperMode,
        execute: (_input, context) => context.navigation.toggleMainWindowAlwaysOnTop(),
    }
];
