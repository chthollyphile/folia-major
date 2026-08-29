import type { CommandPaletteCommand } from '../types';
import { createToggleCommand, createHomeTabCommand } from '../commandFactories';

// src/components/command-palette/commands/navigationCommands.ts
// Commands in the `navigation` group: moving between home tabs, the player, and window-level views.

export const navigationCommands: CommandPaletteCommand[] = [
    createToggleCommand('navigate-home', 'navigation', 'Go home', 'Return to home view', ['home', '首页', '主页', 'shouye', 'zhuye', 'sy', 'zy'], context => context.navigation.navigateToHome()),
    createToggleCommand('navigate-player', 'navigation', 'Go player', 'Return to player view', ['player', '播放页', '播放器', 'bofangye', 'bofangqi', 'bfy', 'bfq'], context => context.navigation.navigateToPlayer()),
    {
        id: 'browser-fullscreen',
        group: 'navigation',
        title: 'Fullscreen',
        description: 'Toggle browser fullscreen',
        keywords: ['fullscreen', 'full screen', 'f11', 'browser fullscreen', '全屏', '浏览器全屏', 'quanping', 'liulanqiquanping', 'qp', 'llqqp'],
        isAvailable: (context) => !context?.navigation.isWallpaperMode,
        execute: (_input, context) => context.navigation.toggleBrowserFullscreen(),
    },
    createHomeTabCommand('playlist', 'Open playlists', 'Open playlist home tab', ['playlist', 'playlists', '歌单', 'gedan', 'gd']),
    createHomeTabCommand('local', 'Open local music', 'Open local music tab', ['local music', 'local', '本地', '本地音乐', 'bendi', 'bendiyinyue', 'bd', 'bdyy']),
    createHomeTabCommand('albums', 'Open albums', 'Open albums tab', ['albums', 'album', '专辑', 'zhuanji', 'zj']),
    createHomeTabCommand('navidrome', 'Open Navidrome', 'Open Navidrome tab', ['navidrome', 'navi', '服务器', 'fuwuqi', 'fwq']),
    createHomeTabCommand('radio', 'Open radio', 'Open radio tab', ['radio', 'fm', '电台', 'diantai', 'dt']),
    {
        id: 'desktop-toggle-remote-control',
        platform: ['electron'],
        group: 'navigation',
        title: 'Toggle remote control window',
        description: 'Open or close the remote control window',
        keywords: ['remote control', 'remote window', 'toggle remote', '遥控窗口', '切换遥控窗口', '打开遥控', 'yaokongchuangkou', 'qiehuanyaokongchuangkou', 'ykck', 'qhykck'],
        execute: (_input, context) => context.navigation.toggleRemoteControlWindow(),
    },
    {
        id: 'desktop-toggle-main-window-always-on-top',
        platform: ['electron'],
        group: 'navigation',
        title: 'Toggle main window always on top',
        description: 'Pin or unpin the main window above other windows',
        keywords: ['always on top', 'main window on top', 'pin main window', '主窗口置顶', '切换主窗口置顶', '取消主窗口置顶', 'zhuchuangkouzhiding', 'qiehuanzhuchuangkouzhiding', 'zckzd', 'qhzckzd'],
        isAvailable: (context) => !context?.navigation.isWallpaperMode,
        execute: (_input, context) => context.navigation.toggleMainWindowAlwaysOnTop(),
    }
];
