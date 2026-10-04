import { syncNow } from '../../../services/sync/syncCoordinator';
import { isSyncConfigured } from '../../../services/sync/syncConfig';
import { buildObsCustomCss } from '../../../services/obs/obsCustomCss';
import { hasUploadedObsAsset } from '../../../services/obs/visualSettingsConfig';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand, createAppLanguageCommand, createSettingsCommand, createSettingsAnchorCommand, defineCommand } from '../commandFactories';
import { sleepTimerCommand } from './sleepTimerCommand';
import { lyricExportCommands } from './lyricExportCommands';
import { Gauge, Images, Layers3 } from 'lucide-react';
import { latticePosterTintSurface } from '../surfaces/latticePosterTintSurface';
import { gridViewCardsSurface } from '../surfaces/gridViewCardsSurface';
import { reduceMotionSurface } from '../surfaces/reduceMotionSurface';
import { openCurrentPagePonder } from '../../../services/ponder/pagePonderTarget';

// src/components/command-palette/commands/settingsCommands.ts
// Commands in the `settings` group: settings subviews, app toggles, theme, sync, and desktop-only switches.

export const settingsCommands: CommandPaletteCommand[] = [
    createSettingsCommand('settings-help', 'Open Help', 'Open help and shortcuts', ['help', '帮助'], 'help', null, { executeShortcut: 'h' }),
    {
        id: 'ponder-current-page',
        group: 'settings',
        title: 'Ponder this page',
        description: 'Open the interactive guide for the current page',
        keywords: ['ponder', 'guide', 'tutorial', '思索', '页面教程'],
        execute: () => {
            openCurrentPagePonder();
            return true;
        },
    },
    sleepTimerCommand,
    createSettingsCommand('settings-options', 'Open Options', 'Open the options center', ['settings', 'options', '设置', '选项'], 'options', null, { executeShortcut: 'o' }),
    createSettingsCommand('settings-appearance', 'Appearance settings', 'Open visual and appearance settings', ['appearance', 'visual settings', '外观', '视觉'], 'options', 'appearance'),
    createSettingsAnchorCommand('settings-theme-presets', 'Theme presets', 'Jump to the built-in and saved theme presets', ['preset theme', 'color preset', '预设主题'], 'themePresets'),
    createSettingsAnchorCommand('settings-lyrics-renderer', 'Lyrics renderer', 'Jump to how lyrics are drawn on the player', ['lyric renderer', 'lyric engine', '歌词渲染'], 'lyricsRenderer'),
    createSettingsAnchorCommand('settings-grid-card-style', 'Grid card style', 'Jump to how the home grid draws its cards', ['card style', 'polaroid', 'grid style', '卡片样式'], 'grid3dCardStyle'),
    createSettingsCommand('settings-general', 'General settings', 'Open general app preferences', ['general', 'language settings', 'locale', '通用', '语言'], 'options', 'general'),
    createSettingsAnchorCommand('settings-home-tabs', 'Home tab visibility', 'Choose which tabs the home screen shows', ['hide tabs', 'home tabs', '首页标签'], 'homeTabsVisibility'),
    createToggleCommand(
        'home-card-position-toggle',
        'settings',
        'Remember home card position',
        'Toggle restoring each home section to its last card',
        ['restore card', 'tab position', '卡片定位', '返回首页'],
        context => context.settings.toggleRememberHomeCardPosition(),
    ),
    createSettingsAnchorCommand('settings-playback-entry-view', 'Play opens', 'Jump to which view pressing play opens', ['entry view', 'open on play', 'default view', '播放进入视图', '默认视图'], 'playbackEntryView'),
    {
        id: 'playback-entry-view-player',
        isAvailable: context => (context ? context.settings.playbackEntryView !== 'player' : true),
        group: 'settings',
        title: 'Play opens: Visualizer',
        description: 'Pressing play opens the player and its visualizer',
        keywords: ['entry view player', 'open player on play', 'visualizer', '播放进入播放器', '播放进入可视化'],
        execute: (_input, context) => {
            if (context.settings.playbackEntryView === 'player') return false;
            context.settings.setPlaybackEntryView('player');
            return true;
        },
    },
    {
        id: 'playback-entry-view-lattice',
        isAvailable: context => (context ? context.settings.playbackEntryView !== 'lattice' : true),
        group: 'settings',
        title: 'Play opens: Lattice',
        description: 'Pressing play opens the queue collage',
        keywords: ['entry view lattice', 'open lattice on play', 'queue collage', '播放进入队列拼贴', '播放进入海报墙'],
        execute: (_input, context) => {
            if (context.settings.playbackEntryView === 'lattice') return false;
            context.settings.setPlaybackEntryView('lattice');
            return true;
        },
    },
    createSettingsAnchorCommand('settings-pinned-commands', 'Pinned command slots', 'Choose the three commands pinned in the palette', ['pinned commands', 'quick slots', '固定命令'], 'pinnedCommands'),
    createSettingsCommand('settings-interaction', 'Interaction settings', 'Open keyboard, shortcut and grid interaction settings', ['interaction', 'keyboard', 'hotkey', '交互', '快捷键设置'], 'options', 'interaction'),
    createSettingsAnchorCommand('settings-custom-shortcut', 'Custom shortcuts', 'Jump to the custom keyboard shortcut bindings', ['keybinding', 'rebind', 'hotkey', '自定义快捷键'], 'customShortcut'),
    createSettingsAnchorCommand('settings-grid-action-button', 'Grid action button', 'Jump to what the grid action button slides to', ['grid button', 'action button', '海报墙按钮'], 'gridActionButton'),
    createSettingsCommand('settings-playback', 'Playback settings', 'Open playback behavior settings', ['playback', '播放', '播放设置'], 'options', 'playback'),
    createSettingsAnchorCommand('settings-queue-behavior', 'Queue behavior', 'Jump to how the play queue is built and kept', ['queue settings', 'queue behaviour', '队列行为'], 'queueSettings'),
    createSettingsAnchorCommand('settings-netease-scrobble', 'NetEase listening report', 'Jump to whether finished plays are reported to NetEase Cloud Music', ['scrobble', 'netease scrobble', 'listening report', 'play count', '听歌打卡', '打卡', '听歌排行'], 'scrobbleSettings'),
    createToggleCommand(
        'netease-scrobble-toggle',
        'settings',
        'NetEase listening report',
        'Turn reporting of finished NetEase plays on or off',
        ['scrobble toggle', 'netease scrobble', 'report plays', '听歌打卡', '打卡', '听歌排行'],
        context => context.settings.toggleNeteaseScrobble(),
        // Same predicate the settings panel greys the toggle out with, and a function because
        // signing out has to close the command off while the palette is already open.
        { isAvailable: context => context?.settings.canReportNeteasePlayback() ?? true },
    ),
    createSettingsAnchorCommand('settings-audio-output', 'Audio output', 'Jump to the audio output device and format settings', ['output device', 'audio device', 'sound card', '输出设备'], 'audioOutputSettings'),
    createSettingsAnchorCommand('settings-transition', 'Smart transition', 'Jump to the FOLIA transition settings', ['automix', 'crossfade', 'transition', '智能过渡', '转场'], 'transitionSettings'),
    createSettingsAnchorCommand('settings-local-lyrics-priority', 'Local song lyrics priority', 'Choose whether local songs prefer local or online lyrics', ['local lyrics priority', 'online lyrics first', 'local song lyrics', '本地歌曲歌词优先级', '在线优先', '本地歌词', 'bendigeciyouxianji', 'bdgcyxj'], 'lyrics'),
    createSettingsAnchorCommand('settings-local-lyric-format-order', 'Local lyric file format priority', 'Choose which format wins when a track has several lyric files', ['lyric format priority', 'lyric file order', 'lrc ttml priority', '本地歌词文件格式优先级', '歌词格式', '格式优先级', 'geciwenjiangeshi', 'gcgsyxj'], 'lyrics'),
    createSettingsCommand('settings-integration', 'Integration settings', 'Open Stage, Now Playing, and Navidrome settings', ['integration', 'stage', 'now playing', 'navidrome settings', '集成', '连接'], 'options', 'integration'),
    createSettingsAnchorCommand('settings-navidrome', 'Navidrome server', 'Jump to the Navidrome server connection', ['navidrome', 'subsonic', 'music server', '音乐服务器'], 'navidrome'),
    createSettingsAnchorCommand('settings-stage-mode', 'Stage mode', 'Jump to the Stage external player settings', ['stage', 'external player', '舞台模式'], 'stageMode'),
    {
        id: 'automix-toggle',
        group: 'settings',
        title: 'Smart transition',
        description: 'Turn FOLIA smart transitions on or off',
        keywords: ['automix', 'blend', 'auto mix', 'transition', '智能过渡', '自动混音', '过渡', '开启过渡', 'znguodu'],
        execute: (_input, context) => {
            context.settings.toggleAutomix();
            return true;
        },
    },
    {
        id: 'transition-mode-crossfade',
        isAvailable: context => (context ? context.settings.transitionMode !== 'crossfade' : true),
        group: 'settings',
        title: 'Transition mode: Folia Crossfade',
        description: 'Use the simple one-out one-in crossfade',
        keywords: ['crossfade', 'folia crossfade', 'transition mode crossfade', '交叉淡化', '过渡模式交叉淡化', 'gdmscf'],
        execute: (_input, context) => {
            if (context.settings.transitionMode === 'crossfade') return false;
            context.settings.setTransitionMode('crossfade');
            return true;
        },
    },
    {
        id: 'transition-mode-automix',
        isAvailable: context => (context ? context.settings.transitionMode !== 'automix' : true),
        group: 'settings',
        title: 'Transition mode: Folia Automix',
        description: 'Analyse both tracks and mix them automatically',
        keywords: ['automix', 'folia automix', 'transition mode automix', '自动混音', '过渡模式自动混音', 'gdmsauto'],
        execute: (_input, context) => {
            if (context.settings.transitionMode === 'automix') return false;
            context.settings.setTransitionMode('automix');
            return true;
        },
    },
    {
        id: 'transition-performance-toggle',
        platform: ['electron'],
        // Hidden without a stem model, matching the disabled switch in the transition settings.
        // Without this the command could persist `transitionPerformance = true` in a state the
        // settings panel refuses to produce, and the mode would then be silently on the moment a
        // model finished downloading.
        isAvailable: context => (context ? context.settings.canUseTransitionPerformance() : true),
        group: 'settings',
        title: 'Transition performance mode',
        description: 'Toggle the more aggressive transition (needs the stem model)',
        keywords: ['performance mode', 'transition performance', 'aggressive transition', '表现模式', '过渡表现', '性能模式'],
        execute: (_input, context) => {
            context.settings.toggleTransitionPerformance();
            return true;
        },
    },
    createSettingsAnchorCommand('settings-discord-presence', 'Discord playback status', 'Open Discord Rich Presence settings', ['discord', 'rich presence', 'discord presence', 'playing status', '播放状态', 'discord状态', 'discordzhuangtai', 'dc'], 'discordRichPresence'),
    createSettingsAnchorCommand('settings-obs-browser-source', 'OBS browser source', 'Open OBS browser source settings', ['obs', 'browser source', 'live source', '直播源', '浏览器源'], 'obsBrowserSource'),
    createSettingsAnchorCommand(
        'settings-spout-output',
        'Spout output settings',
        'Open the Windows Spout2 output settings',
        ['spout settings', 'spout output', 'spout capture', 'Spout输出设置', 'Spout设置'],
        'spoutOutput',
        { platform: ['win'] },
    ),
    {
        // Windows-only functional toggle; same IPC path as the integration settings row. No
        // executeShortcut: starting the output spawns a helper process and an offscreen renderer.
        id: 'desktop-toggle-spout-output',
        platform: ['win'],
        group: 'settings',
        title: 'Toggle Spout output',
        description: 'Publish the OBS overlay to OBS via Spout2',
        keywords: [
            'spout', 'spout2', 'spout output', 'spout sender', 'video output',
            'Spout输出', 'Spout发送', '视频输出', '输出画面',
        ],
        execute: async (_input, context) => {
            const toggled = await context.settings.toggleSpoutOutput();
            if (!toggled) {
                return false;
            }
            return true;
        },
    },
    createToggleCommand(
        'obs-toggle-keep-main-window-animation',
        'settings',
        'OBS: keep main window animation',
        'Toggle whether the main window keeps its animation while OBS is connected',
        ['obs keep animation', 'obs main window', 'browser source animation', 'obs 保持动画', 'obs 主窗口动画', '浏览器源主窗口动画', 'obs bcdh', 'obszckdh'],
        context => context.settings.toggleObsKeepMainWindowAnimation(),
        { platform: ['electron'] },
    ),
    {
        id: 'desktop-toggle-lyric-api',
        platform: ['electron'],
        group: 'settings',
        title: 'Lyrics API',
        description: 'Toggle the local unauthenticated lyrics endpoint',
        keywords: ['lyric endpoint', 'local api', '歌词接口', '本地接口'],
        execute: async (_input, context) => {
            if (!window.electron?.getLyricApiStatus || !window.electron?.setLyricApiEnabled) {
                return false;
            }
            const currentStatus = await window.electron.getLyricApiStatus();
            const nextStatus = await window.electron.setLyricApiEnabled(!currentStatus.enabled);
            context.shared.setStatusMsg({
                type: nextStatus.enabled && !nextStatus.running ? 'error' : 'success',
                text: nextStatus.enabled
                    ? nextStatus.running
                        ? context.shared.t('options.lyricApiEnabledStatus', 'Lyrics API enabled at http://127.0.0.1:32109/v1/lyric')
                        : context.shared.t('options.lyricApiEnableFailed', 'Failed to start the Lyrics API')
                    : context.shared.t('options.lyricApiDisabledStatus', 'Lyrics API disabled'),
            });
            return true;
        },
    },
    {
        id: 'settings-obs-copy-css',
        group: 'settings',
        title: 'Copy OBS CSS',
        description: 'Copy the OBS Browser Source Custom CSS carrying uploaded background / portrait / Cappella assets',
        keywords: ['obs css', 'obs custom css', 'obs assets', 'browser source css', '复制 obs css', 'obs 自定义 css', 'obs 资产', 'fuzhiobscss', 'obszidingyicss', 'obszichan', 'fzobscss', 'obszdycss', 'obszc'],
        execute: async (_input, context) => {
            if (!hasUploadedObsAsset()) {
                context.shared.setStatusMsg({
                    type: 'info',
                    text: context.shared.t('commandPalette.obsCssNoAsset', 'No uploaded OBS assets are in use. Upload a custom background, portrait, emoji, or avatar first.'),
                });
                return true;
            }
            try {
                const result = await buildObsCustomCss();
                if (!result) {
                    context.shared.setStatusMsg({ type: 'error', text: context.shared.t('status.copyFailed', 'Copy failed') });
                    return true;
                }
                await navigator.clipboard.writeText(result.css);
                const hintText = result.degradedGifCount > 0
                    ? context.shared
                        .t('options.obsCssCopiedHintDegraded', 'CSS copied; {{count}} GIF asset(s) copied as static frames due to size. Paste it into OBS Browser Source -> Custom CSS.')
                        .replace('{{count}}', String(result.degradedGifCount))
                    : context.shared.t('options.obsCssCopiedHint', 'CSS copied; paste it into OBS Browser Source -> Custom CSS.');
                context.shared.setStatusMsg({ type: 'info', text: hintText });
            } catch (err) {
                console.error('Failed to copy OBS CSS:', err);
                context.shared.setStatusMsg({ type: 'error', text: context.shared.t('status.copyFailed', 'Copy failed') });
            }
            return true;
        },
    },
    createSettingsCommand('settings-storage', 'Storage settings', 'Open cache and storage settings', ['storage', 'cache', '存储', '缓存'], 'options', 'storage'),
    createSettingsAnchorCommand('settings-media-cache', 'Media cache', 'Jump to the downloaded audio cache', ['audio cache', 'downloads', 'offline songs', '音频缓存'], 'mediaCache'),
    createSettingsAnchorCommand('settings-r2-sync', 'Sync server settings', 'Open sync server settings', ['sync server', 'd1 sync', 'cloud sync', 'sync settings', '同步', '云同步', 'd1同步'], 'r2Sync'),
    {
        id: 'sync-now',
        group: 'settings',
        title: 'Sync now',
        description: 'Sync AI themes',
        keywords: ['d1 sync now', 'cloud sync now', '立即同步', '马上同步', 'd1同步'],
        execute: async (_input, context) => {
            if (!isSyncConfigured()) {
                context.shared.setStatusMsg({
                    type: 'info',
                    text: context.shared.t('commandPalette.syncNotConfigured', 'Sync is not enabled. Configure and enable it in Storage settings first.'),
                });
                return true;
            }
            await syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });
            return true;
        },
    },
    ...lyricExportCommands,
    createSettingsCommand(
        'settings-local-library-watch',
        'Local folder watch settings',
        'Open the auto scan settings for imported local folders',
        ['local folder watch', 'auto scan', 'watch folder', '本地文件夹监视', '自动扫描'],
        'options',
        'storage',
        { isAvailable: context => context?.settings.canAutoScanLocalLibrary() ?? true },
    ),
    createToggleCommand(
        'local-library-auto-scan-toggle',
        'settings',
        'Auto scan local folders',
        'Turn automatic rescanning of imported local folders on or off',
        ['auto scan local', 'watch local folders', 'rescan folders', '自动扫描本地', '监视文件夹'],
        context => context.settings.toggleLocalLibraryAutoScan(),
        { isAvailable: context => context?.settings.canAutoScanLocalLibrary() ?? true },
    ),
    createSettingsCommand('settings-desktop', 'Desktop settings', 'Open desktop app settings', ['desktop', 'electron', '桌面', '桌面端'], 'options', 'desktop', { platform: ['electron'] }),
    createSettingsCommand('settings-update-channel', 'Update channel', 'Choose the desktop app release channel', ['release channel', 'realeco', 'limo', 'cielo', '更新通道', '发布通道'], 'options', 'desktop', { platform: ['electron'] }),
    {
        id: 'desktop-toggle-voice-input-pause',
        platform: ['win'],
        isAvailable: context => context?.settings.voiceInputPauseSupported ?? true,
        group: 'settings',
        title: 'Voice input pause',
        description: 'Toggle pausing playback while system voice input uses the microphone',
        keywords: ['voice input', 'dictation', 'voice typing', 'microphone pause', '语音输入', '语音键入', '语音转文字', '麦克风', 'yyzw'],
        execute: (_input, context) => {
            context.settings.toggleVoiceInputPause();
            return true;
        },
    },
    {
        id: 'desktop-toggle-prevent-display-sleep',
        platform: ['electron'],
        group: 'settings',
        title: 'Prevent display sleep during playback',
        description: 'Toggle keeping the display awake while music is playing',
        keywords: ['prevent display sleep', 'keep display awake', 'keep screen on', '播放时阻止休眠', '保持屏幕唤醒', '屏幕常亮', 'bfzzxm'],
        execute: (_input, context) => {
            context.settings.togglePreventDisplaySleepDuringPlayback();
            return true;
        },
    },
    createSettingsCommand('settings-wallpaper-mode', 'Wallpaper mode settings', 'Open wallpaper mode settings', ['wallpaper mode', 'desktop wallpaper', 'lyrics wallpaper', '壁纸模式', '桌面壁纸', '歌词壁纸'], 'options', 'desktop', { platform: ['linux', 'win', 'mac'] }),
    {
        id: 'desktop-toggle-wallpaper-mode',
        platform: ['linux', 'win', 'mac'],
        group: 'settings',
        title: 'Toggle wallpaper mode',
        description: 'Turn the app into a desktop lyrics wallpaper',
        keywords: ['wallpaper mode', 'desktop wallpaper', 'lyrics wallpaper', '壁纸模式', '桌面壁纸', '歌词壁纸'],
        execute: (_input, context) => {
            context.settings.toggleWallpaperMode();
            return true;
        },
    },
    {
        // macOS-only functional desktop toggle; same store/IPC path as the settings row.
        id: 'desktop-toggle-wallpaper-dock-autohide',
        platform: ['mac'],
        group: 'settings',
        title: 'Toggle Dock auto-hide in wallpaper mode',
        description: 'Auto-hide the Dock while Mac wallpaper mode is active (bottom Dock only)',
        keywords: ['dock autohide', 'dock auto-hide', 'auto-hide the dock', 'hide the dock', '自动隐藏Dock', 'Dock自动隐藏', '隐藏Dock'],
        execute: (_input, context) => {
            context.settings.toggleWallpaperMacAutohideDock();
            return true;
        },
    },
    createToggleCommand(
        'desktop-toggle-close-to-tray',
        'settings',
        'Close window to tray',
        'Keep the app running in the tray when the main window is closed',
        ['close to tray', 'hide on close', 'minimize on close', 'tray on close', 'quit on close', '关闭到托盘', '关闭窗口隐藏到托盘', '关闭按钮', '退出到托盘'],
        context => context.settings.toggleCloseToTray(),
        { platform: ['electron'] },
    ),
    createToggleCommand(
        'desktop-toggle-remote-control-hide-titlebar',
        'settings',
        'Remote control: hide top floating bar',
        'Toggle the remote control window top floating window-control bar',
        ['remote control titlebar', 'remote window titlebar', 'hide remote titlebar', '遥控窗口悬浮栏', '隐藏遥控悬浮栏', '隐藏顶部悬浮栏'],
        context => context.settings.toggleHideRemoteControlTitlebar(),
        { platform: ['electron'] },
    ),
    {
        // Pairs with the remote control click-through switch: while the window ignores the mouse this is the way back in.
        id: 'desktop-unlock-remote-control',
        platform: ['electron'],
        group: 'settings',
        title: 'Unlock remote control window',
        description: 'Turn off remote control click-through so the window can be used and moved again',
        keywords: ['unlock remote control', 'remote click through', 'remote window click-through', '解锁远程控制', '解锁遥控窗口', '遥控窗口点击穿透', '取消点击穿透'],
        execute: (_input, context) => {
            context.settings.unlockRemoteControl();
            return true;
        },
    },
    createSettingsCommand('settings-graphics', 'Graphics settings', 'Open static mode, frame rate cap, Linux glow fix and reduced motion', ['graphics', 'performance', 'frame rate', 'fps', 'rendering', '图形', '图形设置', '性能', '帧率', '渲染'], 'options', 'graphics'),
    createSettingsCommand('settings-mods', 'Mod settings', 'Open the mod system switch and the installed mods', ['mod manager', 'mod system', 'plugins', '模组设置', '模组系统', '插件'], 'options', 'mods', { platform: ['electron'] }),
    createSettingsCommand('settings-lab', 'Lab settings', 'Open experimental settings', ['lab', 'experimental', '实验', '实验室'], 'options', 'lab'),
    createSettingsAnchorCommand(
        'settings-ponder-hints',
        'Ponder tutorial hints',
        'Choose when the hold-G tutorial hint appears',
        ['ponder', 'tutorial hint', '思索', '教程提示'],
        'ponderHints',
    ),
    // 三档设置照 playback-entry-view-* 的先例：一值一条命令，isAvailable 把当前值那条藏掉。
    // createToggleCommand 只能表达两态，套不上。
    defineCommand({
        id: 'ponder-hints-always',
        group: 'settings',
        title: 'Ponder hints: always show',
        description: 'Show the hold-G hint on every teachable control',
        keywords: ['ponder hints always', '思索提示 始终显示'],
        isAvailable: context => (context ? context.settings.ponderHintVisibility !== 'always' : true),
        execute: (_input, context) => {
            if (context.settings.ponderHintVisibility === 'always') return false;
            context.settings.setPonderHintVisibility('always');
            return true;
        },
    }),
    defineCommand({
        id: 'ponder-hints-unseen',
        group: 'settings',
        title: 'Ponder hints: only where I have not looked',
        description: 'Stop hinting a control once its tutorial has been watched',
        keywords: ['ponder hints unseen', '思索提示 仅未看过'],
        isAvailable: context => (context ? context.settings.ponderHintVisibility !== 'unseen' : true),
        execute: (_input, context) => {
            if (context.settings.ponderHintVisibility === 'unseen') return false;
            context.settings.setPonderHintVisibility('unseen');
            return true;
        },
    }),
    createToggleCommand(
        'ponder-touch-button-toggle',
        'settings',
        'Ponder button on touch',
        'Show or hide the lightbulb in the top-right corner on touch devices',
        ['ponder touch button', 'lightbulb', '触屏思索按钮', '灯泡按钮'],
        context => context.settings.togglePonderTouchButton(),
    ),
    defineCommand({
        id: 'ponder-hints-off',
        group: 'settings',
        title: 'Ponder hints: off',
        description: 'Never show the hold-G hint',
        keywords: ['ponder hints off', '思索提示 关闭'],
        isAvailable: context => (context ? context.settings.ponderHintVisibility !== 'off' : true),
        execute: (_input, context) => {
            if (context.settings.ponderHintVisibility === 'off') return false;
            context.settings.setPonderHintVisibility('off');
            return true;
        },
    }),
    {
        id: 'settings-player-bottom-bar-position',
        group: 'settings',
        title: 'Reposition bottom bar',
        description: 'Drag the player bottom bar, song card and panel button to a new height',
        keywords: [
            'bottom bar height', 'move progress bar', 'player bar position',
            '底部控制条位置', '进度条高度', '调整底部高度', '移动进度条',
        ],
        isAvailable: context => (context ? context.settings.canStartPlayerBottomBarPositioning : true),
        execute: (_input, context) => {
            context.settings.startPlayerBottomBarPositioning();
            return true;
        },
    },
    // 用 anchor 版而不是 createSettingsCommand：后者只认页面，落在「通用」页顶部，
    // 而槽位选择器在这一页的底部界面那一节里，跳过去等于没跳。
    createSettingsAnchorCommand(
        'settings-player-control-slots',
        'Player button slots',
        'Choose which actions the two buttons beside the progress bar run',
        [
            'progress bar buttons', 'customize player buttons',
            '进度条按钮', '播放按钮自定义', '按钮槽位',
        ],
        'bottomUiSettings',
    ),
    createSettingsCommand('settings-visualizer', 'Visualizer settings', 'Open lyrics animation workbench', ['visualizer workbench', '可视化', '歌词动画', 'donghua'], 'options', 'visualizer'),
    createSettingsCommand('settings-theme-park', 'Color', 'Open theme editor', ['theme park', 'theme', '配色', '主题', '主题公园'], 'options', 'themePark', { executeShortcut: 't' }),
    createSettingsCommand('settings-global-lyric-offset', 'Global timing offset', 'Calibrate lyric timing against Bluetooth or device audio latency', ['lyric delay', 'audio latency', 'bluetooth delay', 'sync lyrics', '全局时间偏移', '歌词延迟', '音画同步', '蓝牙延迟'], 'options', 'globalLyricOffset'),
    createSettingsCommand('settings-lyric-filter', 'Lyric filter', 'Open lyric filter settings', ['lyrics filter', '歌词过滤', '过滤'], 'options', 'lyricFilter'),
    {
        id: 'lyric-staff-policy-cycle',
        group: 'settings',
        title: 'Opening credits handling',
        description: 'Cycle how the credit block at the start of the lyrics is handled',
        keywords: ['opening credits', 'staff credits', 'lyric credits', 'credits', '制作人员', '署名', '开头署名', '前奏署名'],
        execute: (_input, context) => {
            context.settings.cycleLyricStaffPolicy();
            return true;
        },
    },
    {
        id: 'lyric-staff-absorb-cycle',
        // 与设置面板同一个判断：吸收只在 smart 下有意义，hide 不吸收、keep 不处理。
        isAvailable: context => (context ? context.settings.lyricStaffPolicy === 'smart' : true),
        group: 'settings',
        title: 'Opening credits absorb mode',
        description: 'Cycle whether neighbouring lines are folded into the opening credit block',
        keywords: ['absorb', 'absorb neighbouring lines', 'lyric credits absorb', '吸收相邻行', '吸收', '署名吸收', '前奏吸收', 'xsh'],
        execute: (_input, context) => {
            context.settings.cycleLyricStaffAbsorbMode();
            return true;
        },
    },
    {
        id: 'theme-generate-current',
        isAvailable: context => (context ? context.settings.canGenerateAITheme && !context.settings.isGeneratingTheme : true),
        group: 'settings',
        title: 'Generate AI theme',
        description: 'Generate an AI theme for the current song',
        keywords: ['ai theme', 'theme generation', 'generate theme', '生成AI主题', '生成主题', '主题生成', 'aizhuti', 'aizt'],
        execute: (_input, context) => {
            if (!context.settings.canGenerateAITheme || context.settings.isGeneratingTheme) {
                return false;
            }
            context.settings.generateAITheme();
            return true;
        },
    },
    {
        id: 'theme-source-ai',
        isAvailable: context => (context ? context.settings.themeGenerationSource !== 'ai' : true),
        group: 'settings',
        title: 'Theme source: AI inference',
        description: 'Generate song themes by having AI read the lyrics',
        keywords: ['theme source ai', 'ai theme source', 'theme generation source', '主题来源AI', '主题生成来源', 'AI推断', 'aituiduan', 'ztsclly', 'aitd'],
        execute: (_input, context) => {
            if (context.settings.themeGenerationSource === 'ai') {
                return false;
            }
            context.settings.setThemeGenerationSource('ai');
            return true;
        },
    },
    {
        id: 'theme-source-cover',
        isAvailable: context => (context ? context.settings.themeGenerationSource !== 'cover' : true),
        group: 'settings',
        title: 'Theme source: cover colors',
        description: 'Generate song themes from the cover artwork palette',
        keywords: ['theme source cover', 'cover theme source', 'cover colors', 'theme generation source', '主题来源封面', '封面取色', '主题生成来源', 'fengmianqvse', 'zhutilaiyuan'],
        execute: (_input, context) => {
            if (context.settings.themeGenerationSource === 'cover') {
                return false;
            }
            context.settings.setThemeGenerationSource('cover');
            return true;
        },
    },
    {
        id: 'theme-quick-editor',
        isAvailable: context => context?.settings.canOpenThemeQuickEditor ?? true,
        group: 'settings',
        title: 'Quick theme editor',
        description: 'Quickly edit the current AI or custom theme',
        keywords: ['theme editor', 'ai theme editor', 'custom theme editor', '快速主题编辑器', '主题编辑器', '自定义主题编辑器'],
        execute: (_input, context) => {
            if (!context.settings.canOpenThemeQuickEditor) {
                return false;
            }
            context.settings.openThemeQuickEditor();
            return true;
        },
    },
    createToggleCommand('settings-toggle-transparent', 'settings', 'Toggle transparency', 'Toggle transparent player background', ['transparent', 'transparency', '透明', '透明化'], context => context.settings.toggleTransparentBackground()),
    createToggleCommand('settings-toggle-daylight', 'settings', 'Toggle light/dark', 'Toggle theme daylight/midnight mode', ['daylight', 'midnight', 'light', 'dark', '明暗', '切换明暗', '日夜', '日间', '夜间'], context => context.settings.toggleDaylightMode(), { executeShortcut: 'd' }),
    createToggleCommand('settings-toggle-player-back-button', 'settings', 'Always show player back button', 'Toggle whether the player page back button stays visible', ['always show back button', 'player back button', 'back button', '返回按钮', '始终显示返回按钮', '播放页返回按钮', 'fanhui annniu', 'bofangye fanhui annniu', 'fh', 'bfyfh'], context => context.settings.toggleAlwaysShowPlayerBackButton()),
    createToggleCommand('settings-toggle-lattice-vignette', 'settings', 'Lattice vignette', 'Turn the edge vignette on the queue collage on or off', ['lattice', 'vignette', 'queue collage vignette', 'collage vignette', 'poster wall vignette', '暗角', '边缘暗角', '队列拼贴', '队列拼贴暗角', '拼贴暗角'], context => context.settings.toggleLatticeVignette()),
    createToggleCommand('settings-toggle-lattice-auto-focus', 'settings', 'Lattice auto-focus', 'Toggle whether the queue collage follows the playing song when tracks change', ['lattice', 'lattice auto focus', 'queue collage', 'follow playing song', 'follow track changes', 'poster wall follow', '队列拼贴', '切歌自动聚焦', '自动聚焦当前歌曲', '海报墙跟随'], context => context.settings.toggleLatticeAutoFocusOnSongChange()),
    defineCommand({
        id: 'settings-gridview-cards',
        group: 'settings',
        title: 'Grid card look',
        description: 'Adjust full-bleed covers and how far grid cards shrink and fade with distance',
        keywords: ['grid cards', 'folia grid', 'card cover', 'card falloff', 'card size', 'card opacity', '网格卡片', '卡片封面', '卡片衰减'],
        icon: Images,
        requiresInput: true,
        surface: gridViewCardsSurface,
        placeholder: context => context.shared.t('commandPalette.gridViewCardsPlaceholder', 'Adjust the controls below'),
        execute: () => false,
    }),
    createToggleCommand('settings-toggle-gridview-full-bleed-cover', 'settings', 'Full-bleed grid covers', 'Toggle whether grid card artwork fills the whole card', ['full bleed cover', 'edge to edge cover', 'grid cover art', 'cover fills card', '全画幅封面', '封面铺满', '网格卡片封面'], context => context.settings.toggleGridViewFullBleedCover()),
    createToggleCommand(
        'settings-toggle-gridview-square-cards',
        'settings',
        'Square grid cards',
        'Toggle whether full-bleed grid cards are square instead of poster-shaped',
        ['square cards', 'square grid card', 'uncropped cover', 'card aspect ratio', '正方形卡片', '方形卡片', '卡片比例'],
        context => context.settings.toggleGridViewSquareCards(),
        // Same gate the settings panel hides the row behind: squaring the card only means anything
        // once the artwork owns it. A getter, because the parent toggle flips without a re-render.
        { isAvailable: context => (context ? context.settings.canUseGridViewSquareCards() : false) },
    ),
    defineCommand({
        id: 'lattice-poster-tint',
        group: 'settings',
        title: 'Lattice poster tint',
        description: 'Adjust the overlay that quiets posters outside the current queue collage focus',
        keywords: ['lattice', 'lattice tint', 'poster overlay', 'focus tint', 'queue collage', 'queue collage tint', '队列拼贴', '海报叠色', '聚焦叠层', '队列拼贴叠层'],
        icon: Layers3,
        requiresInput: true,
        surface: latticePosterTintSurface,
        placeholder: context => context.shared.t('commandPalette.latticePosterTintPlaceholder', 'Adjust the controls below'),
        execute: () => false,
    }),
    defineCommand({
        id: 'settings-reduce-motion',
        group: 'settings',
        title: 'Reduce motion',
        description: 'Turn down the animation on each surface that has one, or follow the system setting',
        keywords: ['reduced motion', 'animation', 'disable animation', 'motion', 'accessibility motion',
            '降低动态效果', '减少动画', '关闭动画', '动效', '动画效果', '动态效果'],
        icon: Gauge,
        requiresInput: true,
        surface: reduceMotionSurface,
        placeholder: context => context.shared.t('commandPalette.reduceMotionPlaceholder', 'Adjust the controls below'),
        execute: () => false,
    }),
    // The queue collage is the surface #370 was filed about, so it gets a direct toggle as well as
    // a row on the panel above: the listener who lost its animation should not have to find it.
    createToggleCommand('settings-toggle-reduce-lattice-motion', 'settings', 'Reduce queue collage motion', 'Turn the queue collage expansion, camera flight and entrance wave down to instant', ['reduce lattice motion', 'lattice animation', 'queue collage animation', 'collage motion', 'poster wall animation', '队列拼贴动画', '拼贴动效', '降低拼贴动态效果', '海报墙动画'], context => context.settings.toggleReduceLatticeMotion()),
    createToggleCommand('settings-toggle-follow-system-reduced-motion', 'settings', 'Follow system reduced motion', 'Toggle whether the system animation setting is allowed to reduce motion in the app', ['system animation setting', 'os reduced motion', 'system motion preference', '跟随系统动画设置', '跟随系统减少动画', '系统动效偏好'], context => context.settings.toggleFollowSystemReducedMotion()),
    createToggleCommand('settings-toggle-track-switch-buttons', 'settings', 'Always show track switch arrows', 'Toggle whether the progress bar track switch arrows stay visible beside the title', ['track switch buttons', 'previous next arrows', 'progress bar arrows', 'song switch buttons', '切歌箭头', '切换箭头', '始终显示切歌按钮', '进度条切歌按钮', '上一首下一首按钮', 'jinduting qiege', 'sysqgan'], context => context.settings.toggleAlwaysShowTrackSwitchButtons()),
    createToggleCommand('settings-toggle-main-window-titlebar', 'settings', 'Always show window control buttons', 'Toggle whether the main window control buttons stay visible', ['always show window controls', 'window control buttons', 'always show titlebar', 'main window titlebar', 'titlebar', '标题栏', '控制按钮', '始终显示标题栏', '始终显示控制按钮', '主窗口标题栏', 'kongzhi annniu', 'bt', 'zckbt'], context => context.settings.toggleAlwaysShowMainWindowTitlebar()),
    createToggleCommand('settings-toggle-fullscreen-titlebar-button', 'settings', 'Toggle fullscreen button visibility', 'Show or hide the fullscreen button in the desktop window controls', ['fullscreen button', 'titlebar fullscreen', 'window fullscreen button', 'show fullscreen control', 'hide fullscreen button', 'fullscreen button visibility', '全屏按钮', '标题栏全屏按钮', '显示全屏按钮', '隐藏全屏按钮', '窗口全屏控制', 'quanping annniu', 'biaotilan quanping'], context => context.settings.toggleHideFullscreenButton(), { platform: ['electron'] }),
    createToggleCommand('settings-toggle-native-mac-fullscreen-button', 'settings', 'Native macOS fullscreen button', 'Toggle whether the macOS window control enters native fullscreen instead of maximizing', ['mac window control', 'native fullscreen', 'maximize button', 'macOS 全屏', '原生全屏', '窗口按钮'], context => context.settings.toggleNativeMacFullscreenButton(), { platform: ['mac'] }),
    createToggleCommand('settings-toggle-cursor-auto-hide', 'settings', 'Hide cursor with player controls', 'Toggle whether the mouse pointer disappears together with the auto-hidden player controls', ['cursor', 'mouse pointer', 'hide cursor', 'hide mouse', 'pointer', '鼠标', '鼠标指针', '隐藏鼠标', '隐藏指针', '指针自动隐藏'], context => context.settings.toggleAutoHideCursorWithPlayerChrome()),
    createToggleCommand('settings-toggle-auto-play-on-launch', 'settings', 'Auto-play on launch', 'Toggle whether opening the app resumes the last session by itself', ['autoplay', 'auto play', 'resume on open', 'play on startup', '自动播放', '启动自动播放', '进入应用自动播放', '续播'], context => context.settings.toggleAutoPlayOnLaunch()),
    createToggleCommand('settings-toggle-transcode-fallback', 'settings', 'Transcode unsupported audio', 'Toggle Electron recovery for local and Navidrome audio Chromium cannot decode', ['ffmpeg', 'unsupported audio', 'decode fallback', '无法解码', '转码恢复'], context => context.settings.toggleTranscodeFallback(), { platform: ['electron'] }),
    createToggleCommand('settings-toggle-playback-fade', 'settings', 'Fade on pause and resume', 'Toggle the short fade when pausing and resuming playback', ['fade', 'fade in', 'fade out', 'pause fade', 'smooth pause', 'crossfade pause', '淡入淡出', '暂停淡出', '播放淡入', '渐入渐出'], context => context.settings.togglePlaybackFade()),
    createToggleCommand('settings-toggle-bottom-subtitle-overlay', 'settings', 'Toggle bottom subtitle overlay', 'Show or hide the whole bottom subtitle overlay', [
            'bottom subtitle overlay',
            'subtitle overlay',
            'hide subtitle overlay',
            'show subtitle overlay',
            'bottom subtitles',
            'hide bottom subtitles',
            '底部字幕层',
            '隐藏底部字幕层',
            '显示底部字幕层',
            '底部字幕',
            '隐藏底部字幕',
            '显示底部字幕',
            'zimu ceng',
        ], context => context.settings.toggleBottomSubtitleOverlay()),
    createToggleCommand('settings-cycle-subtitle-content-mode', 'settings', 'Cycle subtitle content mode', 'Cycle subtitle content between translation, romanization, and romanization plus translation', [
            'subtitle translation',
            'translation subtitle',
            'show subtitle translation',
            'lyrics translation',
            'caption translation',
            'subtitle romanization',
            'romanized lyrics',
            'romaji',
            'dual subtitle',
            'bilingual subtitle',
            '字幕翻译',
            '显示翻译',
            '翻译字幕',
            '歌词翻译',
            '切换翻译字幕',
            '罗马音',
            '罗马字',
            '双行字幕',
            '副字幕',
        ], context => context.settings.cycleSubtitleContentMode()),
    createToggleCommand('settings-toggle-subtitle-background', 'settings', 'Toggle subtitle background', 'Show or hide the readability background behind visualizer subtitles', [
            'subtitle background',
            'subtitle readability background',
            'caption background',
            'show subtitle background',
            'hide subtitle background',
            '字幕背景',
            '切换字幕背景',
            '显示字幕背景',
            '隐藏字幕背景',
            '字幕底色',
        ], context => context.settings.toggleSubtitleOverlayBackground()),
    createAppLanguageCommand('settings-language-system', 'system', 'Follow system language', 'Use the browser or system language', ['system language', 'follow system', 'auto language', '跟随系统', '系统语言']),
    createAppLanguageCommand('settings-language-zh-CN', 'zh-CN', 'Switch language to Chinese', 'Use Simplified Chinese in the interface', ['chinese', 'simplified chinese', '中文', '简体中文']),
    createAppLanguageCommand('settings-language-en', 'en', 'Switch language to English', 'Use English in the interface', ['english', 'interface english', '英文']),
    createAppLanguageCommand('settings-language-in', 'in', 'Switch language to Indonesian', 'Use Bahasa Indonesia in the interface', ['indonesian', 'bahasa indonesia', 'indonesia', '印尼语', 'bhs'])
];
