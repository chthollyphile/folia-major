import { syncNow } from '../../../services/sync/syncCoordinator';
import { isSyncConfigured } from '../../../services/sync/syncConfig';
import { buildObsCustomCss } from '../../../services/obs/obsCustomCss';
import { hasUploadedObsAsset } from '../../../services/obs/visualSettingsConfig';
import type { CommandPaletteCommand } from '../types';
import { createToggleCommand, createAppLanguageCommand, createSettingsCommand } from '../commandFactories';
import { sleepTimerCommand } from './sleepTimerCommand';

// src/components/command-palette/commands/settingsCommands.ts
// Commands in the `settings` group: settings subviews, app toggles, theme, sync, and desktop-only switches.

export const settingsCommands: CommandPaletteCommand[] = [
    createSettingsCommand('settings-help', 'Open Help', 'Open help and shortcuts', ['help', '帮助'], 'help', null, { executeShortcut: 'h' }),
    sleepTimerCommand,
    {
        id: 'show-user-guide',
        group: 'settings',
        title: 'Show User Guide',
        description: 'Open the user guide tutorial',
        keywords: ['guide', 'help', 'tutorial', '用户指引', '指南', '帮助'],
        execute: (_input, context) => {
            context.settings.setIsUserGuideModalOpen(true);
            return true;
        },
    },
    createSettingsCommand('settings-options', 'Open Options', 'Open the options center', ['settings', 'options', '设置', '选项'], 'options', null, { executeShortcut: 'o' }),
    createSettingsCommand('settings-appearance', 'Appearance settings', 'Open visual and appearance settings', ['appearance', 'visual settings', '外观', '视觉'], 'options', 'appearance'),
    createSettingsCommand('settings-general', 'General settings', 'Open general app preferences', ['general', 'language settings', 'locale', '通用', '语言'], 'options', 'general'),
    createSettingsCommand('settings-playback', 'Playback settings', 'Open playback behavior settings', ['playback', '播放', '播放设置'], 'options', 'playback'),
    createSettingsCommand('settings-local-lyrics-priority', 'Local song lyrics priority', 'Choose whether local songs prefer local or online lyrics', ['local lyrics priority', 'online lyrics first', 'local song lyrics', '本地歌曲歌词优先级', '在线优先', '本地歌词', 'bendigeciyouxianji', 'bdgcyxj'], 'options', 'playback'),
    createSettingsCommand('settings-integration', 'Integration settings', 'Open Stage, Now Playing, and Navidrome settings', ['integration', 'stage', 'now playing', 'navidrome settings', '集成', '连接'], 'options', 'integration'),
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
    createSettingsCommand('settings-discord-presence', 'Discord playback status', 'Open Discord Rich Presence settings', ['discord', 'rich presence', 'discord presence', 'playing status', '播放状态', 'discord状态', 'discordzhuangtai', 'dc'], 'options', 'integration'),
    createSettingsCommand('settings-obs-browser-source', 'OBS browser source', 'Open OBS browser source settings', ['obs', 'browser source', 'live source', '直播源', '浏览器源'], 'options', 'integration'),
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
    createSettingsCommand('settings-r2-sync', 'Sync server settings', 'Open sync server settings', ['sync server', 'd1 sync', 'cloud sync', 'sync settings', '同步', '云同步', 'd1同步'], 'options', 'storage'),
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
    createSettingsCommand('settings-lab', 'Lab settings', 'Open experimental settings', ['lab', 'experimental', '实验', '实验室'], 'options', 'lab'),
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
    createSettingsCommand(
        'settings-player-control-slots',
        'Player button slots',
        'Choose which actions the two buttons beside the progress bar run',
        [
            'progress bar buttons', 'customize player buttons',
            '进度条按钮', '播放按钮自定义', '按钮槽位',
        ],
        'options',
        'general',
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
    createToggleCommand('settings-toggle-lattice-vignette', 'settings', 'Toggle queue collage vignette', 'Turn the edge vignette on the queue collage on or off', ['vignette', 'lattice vignette', 'queue collage vignette', 'collage vignette', 'poster wall vignette', '暗角', '边缘暗角', '队列拼贴暗角', '拼贴暗角'], context => context.settings.toggleLatticeVignette()),
    createToggleCommand('settings-toggle-track-switch-buttons', 'settings', 'Always show track switch arrows', 'Toggle whether the progress bar track switch arrows stay visible beside the title', ['track switch buttons', 'previous next arrows', 'progress bar arrows', 'song switch buttons', '切歌箭头', '切换箭头', '始终显示切歌按钮', '进度条切歌按钮', '上一首下一首按钮', 'jinduting qiege', 'sysqgan'], context => context.settings.toggleAlwaysShowTrackSwitchButtons()),
    createToggleCommand('settings-toggle-main-window-titlebar', 'settings', 'Always show window control buttons', 'Toggle whether the main window control buttons stay visible', ['always show window controls', 'window control buttons', 'always show titlebar', 'main window titlebar', 'titlebar', '标题栏', '控制按钮', '始终显示标题栏', '始终显示控制按钮', '主窗口标题栏', 'kongzhi annniu', 'bt', 'zckbt'], context => context.settings.toggleAlwaysShowMainWindowTitlebar()),
    createToggleCommand('settings-toggle-auto-play-on-launch', 'settings', 'Auto-play on launch', 'Toggle whether opening the app resumes the last session by itself', ['autoplay', 'auto play', 'resume on open', 'play on startup', '自动播放', '启动自动播放', '进入应用自动播放', '续播'], context => context.settings.toggleAutoPlayOnLaunch()),
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
    createToggleCommand('settings-cycle-subtitle-content-mode', 'settings', 'Cycle subtitle content mode', 'Switch between translation and romanization subtitle modes', [
            'subtitle translation',
            'translation subtitle',
            'show subtitle translation',
            'lyrics translation',
            'caption translation',
            'subtitle romanization',
            'romanized lyrics',
            'romaji',
            '字幕翻译',
            '显示翻译',
            '翻译字幕',
            '歌词翻译',
            '切换翻译字幕',
            '罗马音',
            '罗马字',
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
