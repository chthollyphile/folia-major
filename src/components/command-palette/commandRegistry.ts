import { PlayerState, type HomeViewTab, type VisualizerMode, type VisualizerBackgroundMode, type MonetBackgroundTuning } from '../../types';
import type { PanelTab } from '../UnifiedPanel';
import type {
    CommandPaletteCommand,
    CommandPaletteContext,
    CommandPaletteMatch,
    CommandPaletteSearchSource,
} from './types';

// src/components/command-palette/commandRegistry.ts
// Defines command palette entries and the lightweight matching used for autocomplete.

const MAX_COMMAND_MATCHES = 10;

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const getSearchSourceLabel = (sourceTab: HomeViewTab, context: CommandPaletteContext) => {
    if (sourceTab === 'local') {
        return context.t('commandPalette.sourceLocal', 'local library');
    }
    if (sourceTab === 'navidrome') {
        return context.t('commandPalette.sourceNavidrome', 'Navidrome');
    }
    return context.t('commandPalette.sourceNetease', 'NetEase Cloud Music');
};

const buildSearchPreview = (
    input: string,
    sourceTab: HomeViewTab,
    context: CommandPaletteContext,
    isCurrentSource: boolean
) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
        return null;
    }

    const sourceLabel = isCurrentSource
        ? context.t('commandPalette.sourceCurrent', 'current source')
        : getSearchSourceLabel(sourceTab, context);

    return context.t('commandPalette.previewSearch', 'Search {{source}} songs: {{query}}')
        .replace('{{source}}', sourceLabel)
        .replace('{{query}}', trimmedInput);
};

const runSearch = async (
    query: string,
    sourceTab: CommandPaletteSearchSource,
    context: CommandPaletteContext
) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        return false;
    }

    const didSearch = await context.submitSearch({
        query: trimmedQuery,
        sourceTab,
        deps: {
            localSongs: context.localSongs,
            t: context.t,
        },
        returnView: 'player',
    });

    if (didSearch) {
        context.navigateToSearch({
            query: trimmedQuery,
            sourceTab,
            replace: typeof window !== 'undefined' && Boolean(window.history.state?.search),
            returnView: 'player',
        });
    }

    return didSearch;
};

const createSearchCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    resolveSource: (context: CommandPaletteContext) => HomeViewTab
): CommandPaletteCommand => ({
    id,
    group: 'search',
    title,
    description,
    keywords,
    placeholder: `${keywords[0]} ${description}`,
    requiresInput: true,
    getPreview: (input, context) => buildSearchPreview(
        input,
        resolveSource(context),
        context,
        id === 'search-current'
    ),
    execute: (input, context) => runSearch(input, resolveSource(context), context),
});

const createSettingsCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    initialTab: 'help' | 'options',
    initialSubview: Parameters<CommandPaletteContext['openSettings']>[1] = null
): CommandPaletteCommand => ({
    id,
    group: 'settings',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.openSettings(initialTab, initialSubview);
        return true;
    },
});

const createHomeTabCommand = (
    tab: HomeViewTab,
    title: string,
    description: string,
    keywords: string[]
): CommandPaletteCommand => ({
    id: `home-${tab}`,
    group: 'navigation',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.setHomeViewTab(tab);
        context.navigateToHome();
        return true;
    },
});

const createPanelCommand = (
    tab: PanelTab,
    title: string,
    description: string,
    keywords: string[]
): CommandPaletteCommand => ({
    id: `panel-${tab}`,
    group: 'panel',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.setPanelTab(tab);
        context.setIsPanelOpen(true);
        return true;
    },
});

const createVisualizerCommand = (
    mode: VisualizerMode,
    title: string,
    description: string,
    keywords: string[]
): CommandPaletteCommand => ({
    id: `visualizer-${mode}`,
    group: 'visualizer',
    title,
    description,
    keywords,
    execute: (_input, context) => {
        context.setVisualizerMode(mode);
        return true;
    },
});

export const COMMAND_PALETTE_COMMANDS: CommandPaletteCommand[] = [
    createSearchCommand('search-current', 'Search songs', 'Search songs in the current source', ['search', 'find', 'song', '搜索', '搜歌', 'sousuo', 'souge', 'ss', 'sg'], context => context.currentSearchSourceTab),
    createSearchCommand('search-local', 'Search local songs', 'Search local library', ['local', 'local search', 'search local', '本地', '本地音乐', 'bendi', 'bendiyinyue', 'bd', 'bdyy'], () => 'local'),
    createSearchCommand('search-navidrome', 'Search Navidrome songs', 'Search Navidrome library', ['navi', 'navidrome', 'search navidrome', '导航', '服务器', 'fuwuqi', 'fwq'], () => 'navidrome'),
    createSearchCommand('search-netease', 'Search NetEase songs', 'Search NetEase Cloud Music', ['netease', 'cloud', 'search netease', '网易云', '网抑云', 'wangyiyun', 'wyy'], () => 'playlist'),

    createSettingsCommand('settings-help', 'Open Help', 'Open help and shortcuts', ['help', '帮助', 'bangzhu', 'bz'], 'help'),
    createSettingsCommand('settings-options', 'Open Options', 'Open the options center', ['settings', 'options', '设置', '选项', 'shezhi', 'xuanxiang', 'sz', 'xx'], 'options'),
    createSettingsCommand('settings-appearance', 'Appearance settings', 'Open visual and appearance settings', ['appearance', 'visual settings', '外观', '视觉', 'waiguan', 'shijue', 'wg', 'sj'], 'options', 'appearance'),
    createSettingsCommand('settings-playback', 'Playback settings', 'Open playback behavior settings', ['playback settings', 'playback', '播放', '播放设置', 'bofang', 'bofangshezhi', 'bf', 'bfsz'], 'options', 'playback'),
    createSettingsCommand('settings-integration', 'Integration settings', 'Open Stage, Now Playing, and Navidrome settings', ['integration', 'stage', 'now playing', 'navidrome settings', '集成', '连接', 'jicheng', 'lianjie', 'jc', 'lj'], 'options', 'integration'),
    createSettingsCommand('settings-obs-browser-source', 'OBS browser source', 'Open OBS browser source settings', ['obs', 'browser source', 'live source', '直播源', '浏览器源', 'zhiboyuan', 'liulanqiyuan', 'zby', 'llqy'], 'options', 'integration'),
    createSettingsCommand('settings-storage', 'Storage settings', 'Open cache and storage settings', ['storage', 'cache', '存储', '缓存', 'cunchu', 'huancun', 'cc', 'hc'], 'options', 'storage'),
    createSettingsCommand('settings-desktop', 'Desktop settings', 'Open desktop app settings', ['desktop', 'electron', '桌面', '桌面端', 'zhuomian', 'zhuomianduan', 'zm', 'zmd'], 'options', 'desktop'),
    createSettingsCommand('settings-lab', 'Lab settings', 'Open experimental settings', ['lab', 'experimental', '实验', '实验室', 'shiyan', 'shiyanshi', 'sy', 'sys'], 'options', 'lab'),
    createSettingsCommand('settings-visualizer', 'Visualizer settings', 'Open lyrics animation workbench', ['visualizer settings', 'visualizer workbench', '可视化', '歌词动画', 'keshihua', 'gecidonghua', 'ksh', 'gcdh'], 'options', 'visualizer'),
    createSettingsCommand('settings-theme-park', 'Color', 'Open theme editor', ['color', 'theme park', 'theme', '配色', '主题', '主题公园', 'peise', 'zhuti', 'zhutigongyuan', 'ps', 'zt', 'ztgy'], 'options', 'themePark'),
    createSettingsCommand('settings-lyric-filter', 'Lyric filter', 'Open lyric filter settings', ['lyric filter', 'lyrics filter', '歌词过滤', '过滤', 'geciguolv', 'guolv', 'gcgl', 'gl'], 'options', 'lyricFilter'),

    {
        id: 'navigate-home',
        group: 'navigation',
        title: 'Go home',
        description: 'Return to home view',
        keywords: ['home', '首页', '主页', 'shouye', 'zhuye', 'sy', 'zy'],
        execute: (_input, context) => {
            context.navigateToHome();
            return true;
        },
    },
    {
        id: 'navigate-player',
        group: 'navigation',
        title: 'Go player',
        description: 'Return to player view',
        keywords: ['player', '播放页', '播放器', 'bofangye', 'bofangqi', 'bfy', 'bfq'],
        execute: (_input, context) => {
            context.navigateToPlayer();
            return true;
        },
    },
    createHomeTabCommand('playlist', 'Open playlists', 'Open playlist home tab', ['playlist', 'playlists', '歌单', 'gedan', 'gd']),
    createHomeTabCommand('local', 'Open local music', 'Open local music tab', ['local music', 'local', '本地', '本地音乐', 'bendi', 'bendiyinyue', 'bd', 'bdyy']),
    createHomeTabCommand('albums', 'Open albums', 'Open albums tab', ['albums', 'album', '专辑', 'zhuanji', 'zj']),
    createHomeTabCommand('navidrome', 'Open Navidrome', 'Open Navidrome tab', ['navidrome', 'navi', '服务器', 'fuwuqi', 'fwq']),
    createHomeTabCommand('radio', 'Open radio', 'Open radio tab', ['radio', 'fm', '电台', 'diantai', 'dt']),

    createPanelCommand('cover', 'Panel: cover', 'Open the cover panel tab', ['panel cover', 'cover panel', '封面', 'fengmian', 'fm']),
    createPanelCommand('controls', 'Panel: controls', 'Open the controls panel tab', ['panel controls', 'controls panel', '控制', 'kongzhi', 'kz']),
    createPanelCommand('queue', 'Panel: queue', 'Open the queue panel tab', ['panel queue', 'queue panel', '队列', 'duilie', 'dl']),
    createPanelCommand('account', 'Panel: account', 'Open the account panel tab', ['panel account', 'account panel', '账号', '账户', 'zhanghao', 'zhanghu', 'zh']),
    createPanelCommand('local', 'Panel: local', 'Open the local panel tab', ['panel local', 'local panel', '本地面板', 'bendimianban', 'bdmb']),
    createPanelCommand('navi', 'Panel: Navidrome', 'Open the Navidrome panel tab', ['panel navi', 'panel navidrome', 'navi panel', 'navidrome 面板', '服务器面板', 'fuwuqimianban', 'fwqmb']),
    createPanelCommand('onlineLyrics', 'Panel: lyrics', 'Open the online lyrics panel tab', ['panel lyrics', 'lyrics panel', '歌词面板', 'gecimianban', 'gcmb']),

    {
        id: 'playback-play',
        group: 'playback',
        title: 'Play',
        description: 'Start playback when paused',
        keywords: ['play', '播放', 'bofang', 'bf'],
        execute: (_input, context) => {
            if (context.playerState !== PlayerState.PLAYING) {
                context.togglePlay();
            }
            return true;
        },
    },
    {
        id: 'playback-pause',
        group: 'playback',
        title: 'Pause',
        description: 'Pause current playback',
        keywords: ['pause', '暂停', 'zanting', 'zt'],
        execute: (_input, context) => {
            if (context.playerState === PlayerState.PLAYING) {
                context.togglePlay();
            }
            return true;
        },
    },
    {
        id: 'playback-next',
        group: 'playback',
        title: 'Next track',
        description: 'Play the next track',
        keywords: ['next', '下一首', 'xiayishou', 'xys'],
        execute: (_input, context) => {
            context.handleNextTrack();
            return true;
        },
    },
    {
        id: 'playback-prev',
        group: 'playback',
        title: 'Previous track',
        description: 'Play the previous track',
        keywords: ['prev', 'previous', '上一首', 'shangyishou', 'sys'],
        execute: (_input, context) => {
            context.handlePrevTrack();
            return true;
        },
    },
    {
        id: 'playback-loop',
        group: 'playback',
        title: 'Toggle loop',
        description: 'Change loop mode',
        keywords: ['loop', '循环', 'xunhuan', 'xh'],
        execute: (_input, context) => {
            context.toggleLoop();
            return true;
        },
    },
    {
        id: 'playback-shuffle',
        group: 'playback',
        title: 'Shuffle queue',
        description: 'Shuffle current play queue',
        keywords: ['shuffle queue', 'shuffle', '打乱', '打乱队列', 'daluan', 'daluanduilie', 'dl'],
        execute: (_input, context) => {
            context.shuffleQueue();
            return true;
        },
    },
    {
        id: 'playback-auto-match-best-lyric',
        group: 'playback',
        title: 'Match best lyrics',
        description: 'Run automatic best lyric matching for the current song',
        keywords: ['best lyrics', 'match best lyrics', 'auto match lyrics', '最佳歌词', '匹配最佳歌词', '自动匹配歌词', 'zuijiageci', 'pipeizuijiageci', 'zidongpipeigeci', 'zjgc', 'ppzjgc', 'zdppgc'],
        execute: (_input, context) => context.runAutoMatchBestLyric(),
    },

    createVisualizerCommand('classic', 'Visualizer: Luminous', 'Switch to classic visualizer', ['visualizer classic', 'classic', '流光', 'liuguang', 'lg']),
    createVisualizerCommand('cadenza', 'Visualizer: Mindscape', 'Switch to cadenza visualizer', ['visualizer cadenza', 'cadenza', 'mindscape', '心象', 'xinxiang', 'xx']),
    createVisualizerCommand('partita', 'Visualizer: Partita', 'Switch to partita visualizer', ['visualizer partita', 'partita', '云阶', 'yunjie', 'yj']),
    createVisualizerCommand('fume', 'Visualizer: Fume', 'Switch to fume visualizer', ['visualizer fume', 'fume', '浮名', 'fuming', 'fm']),
    createVisualizerCommand('cappella', 'Visualizer: Cappella', 'Switch to cappella visualizer', ['visualizer cappella', 'cappella', '群唱', 'qunchang', 'qc']),
    createVisualizerCommand('tilt', 'Visualizer: Tilt', 'Switch to tilt visualizer', ['visualizer tilt', 'tilt', '倾诉', 'qingsu', 'qs']),
    createVisualizerCommand('monet', 'Visualizer: Monet', 'Switch to Monet visualizer', ['visualizer monet', 'monet', '莫奈', 'monai', 'mn', '切换到可视化：莫奈', '切换到可视化莫奈']),

    {
        id: 'background-monet-full-overlay',
        group: 'visualizer',
        title: 'Background: Monet Full Screen Overlay',
        description: 'Switch background to Monet full screen overlay layout',
        keywords: ['monet full screen', 'monet full', 'overlay', '莫奈全屏叠色', '全屏叠色', '莫奈', 'mnqpds', 'qpds', '背景切换到 莫奈: 全屏叠色', '背景切换到莫奈全屏叠色'],
        execute: (_input, context) => {
            context.setVisualizerBackgroundMode('monet');
            context.setMonetBackgroundTuning({ backgroundLayout: 'full-overlay' });
            return true;
        },
    },
    {
        id: 'background-monet-half-gradient',
        group: 'visualizer',
        title: 'Background: Monet Half Screen Gradient',
        description: 'Switch background to Monet half screen gradient layout',
        keywords: ['monet half screen', 'monet half', 'gradient', '莫奈半屏渐变', '半屏渐变', '莫奈', 'mnbpjb', 'bpjb', '背景切换到 莫奈: 半屏渐变', '背景切换到莫奈半屏渐变'],
        execute: (_input, context) => {
            context.setVisualizerBackgroundMode('monet');
            context.setMonetBackgroundTuning({ backgroundLayout: 'half-pane-gradient' });
            return true;
        },
    },
    {
        id: 'background-common',
        group: 'visualizer',
        title: 'Background: Common',
        description: 'Switch background to general layout',
        keywords: ['background common', 'background general', 'common', 'general', '通用背景', '通用', 'tybj', 'ty', '背景切换到 通用', '背景切换到通用'],
        execute: (_input, context) => {
            context.setVisualizerBackgroundMode('common');
            return true;
        },
    },
    {
        id: 'background-url',
        group: 'visualizer',
        title: 'Background: Embedded Background',
        description: 'Switch background to embedded webpage mode',
        keywords: ['embedded background', 'embed background', 'background embed', 'background url', 'url background', 'url', 'webpage', '嵌入背景', '网页背景', 'qianrubeijing', 'qrbj', 'wybj', '背景切换到 嵌入背景', '背景切换到嵌入背景'],
        execute: (_input, context) => {
            context.setVisualizerBackgroundMode('url');
            return true;
        },
    },
    {
        id: 'settings-toggle-transparent',
        group: 'settings',
        title: 'Toggle transparency',
        description: 'Toggle transparent player background',
        keywords: ['transparent', 'transparency', '透明', '透明化', 'touming', 'touminghua', 'tm', 'tmh'],
        execute: (_input, context) => {
            context.toggleTransparentBackground();
            return true;
        },
    },
    {
        id: 'settings-toggle-daylight',
        group: 'settings',
        title: 'Toggle light/dark',
        description: 'Toggle theme daylight/midnight mode',
        keywords: ['daylight', 'midnight', 'light', 'dark', '明暗', '切换明暗', '日夜', '日间', '夜间', 'qiehuanmingan', 'ry', 'rj', 'yj'],
        execute: (_input, context) => {
            context.toggleDaylightMode();
            return true;
        },
    },
    {
        id: 'settings-toggle-alternative-lyric-sources',
        group: 'settings',
        title: 'Toggle alternative lyric sources',
        description: 'Toggle alternative lyric sources (QQ Music, Kugou Music)',
        keywords: ['alternative lyrics', 'more lyrics', 'alternative lyric sources', '更多歌词源', '备选歌词源', 'qiehuanbexuangece', 'gdyy', 'gecly'],
        execute: (_input, context) => {
            context.toggleAlternativeLyricSources();
            return true;
        },
    },
];

export const getCommandPaletteMatches = (query: string, context?: CommandPaletteContext): CommandPaletteMatch[] => {
    const normalizedQuery = normalize(query);

    const filteredCommands = COMMAND_PALETTE_COMMANDS.filter(command => {
        if (command.id === 'settings-desktop') {
            const isWebBrowser = typeof window !== 'undefined';
            const isElectron = isWebBrowser && Boolean((window as any).electron);
            if (isWebBrowser && !isElectron) {
                return false;
            }
        }

        if (command.id === 'playback-auto-match-best-lyric') {
            return Boolean(context?.enableAlternativeLyricSources);
        }

        if (command.group === 'search') {
            if (command.id === 'search-current') return true;
            if (context) {
                return false;
            }
        }
        return true;
    });

    if (!normalizedQuery) {
        return filteredCommands.slice(0, MAX_COMMAND_MATCHES).map((command, index) => ({
            command,
            score: 100 - index,
            input: '',
        }));
    }

    const matches = filteredCommands
        .map(command => {
            let bestScore = 0;
            let bestInput = '';

            for (const keyword of command.keywords) {
                const normalizedKeyword = normalize(keyword);
                if (normalizedQuery === normalizedKeyword) {
                    bestScore = Math.max(bestScore, 120);
                } else if (normalizedKeyword.startsWith(normalizedQuery)) {
                    bestScore = Math.max(bestScore, 100 - normalizedKeyword.length);
                } else if (normalizedQuery.startsWith(`${normalizedKeyword} `)) {
                    bestScore = Math.max(bestScore, 90 + normalizedKeyword.length + (command.requiresInput ? 20 : 0));
                    bestInput = query.trim().slice(keyword.length).trim();
                } else if (normalizedKeyword.includes(normalizedQuery)) {
                    bestScore = Math.max(bestScore, 60 - normalizedKeyword.indexOf(normalizedQuery));
                }
            }

            return bestScore > 0 ? { command, score: bestScore, input: bestInput } : null;
        })
        .filter((match): match is CommandPaletteMatch => Boolean(match))
        .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));

    return matches.slice(0, MAX_COMMAND_MATCHES);
};
