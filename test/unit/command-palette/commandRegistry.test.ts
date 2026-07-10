import { describe, expect, it, vi } from 'vitest';
import { PlayerState } from '../../../src/types';
import { getCommandPaletteMatches } from '../../../src/components/command-palette/commandRegistry';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

const createContext = (overrides: Partial<CommandPaletteContext> = {}): CommandPaletteContext => ({
    currentSearchSourceTab: 'playlist',
    localSongs: [],
    playerState: PlayerState.PAUSED,
    t: (_key, fallback) => fallback ?? '',
    openSettings: vi.fn(),
    navigateToHome: vi.fn(),
    navigateToPlayer: vi.fn(),
    navigateToSearch: vi.fn(),
    toggleBrowserFullscreen: vi.fn(async () => true),
    setHomeViewTab: vi.fn(),
    setPanelTab: vi.fn(),
    setIsPanelOpen: vi.fn(),
    submitSearch: vi.fn(async () => true),
    togglePlay: vi.fn(),
    toggleLoop: vi.fn(),
    handleNextTrack: vi.fn(),
    handlePrevTrack: vi.fn(),
    shuffleQueue: vi.fn(),
    canGenerateAITheme: true,
    isGeneratingTheme: false,
    generateAITheme: vi.fn(),
    setVisualizerMode: vi.fn(),
    setVisualizerBackgroundMode: vi.fn(),
    setMonetBackgroundTuning: vi.fn(),
    toggleTransparentBackground: vi.fn(),
    hideBottomSubtitleOverlay: false,
    toggleBottomSubtitleOverlay: vi.fn(),
    showSubtitleTranslation: true,
    toggleSubtitleTranslation: vi.fn(),
    toggleDaylightMode: vi.fn(),
    setAppLanguagePreference: vi.fn(async () => undefined),
    enableAlternativeLyricSources: false,
    runAutoMatchBestLyric: vi.fn(async () => true),
    setIsUserGuideModalOpen: vi.fn(),
    openThemeQuickEditor: vi.fn(),
    canOpenThemeQuickEditor: true,
    playQueue: [],
    playSong: vi.fn(),
    ...overrides,
});

describe('command palette registry', () => {
    it('parses source-specific search input', async () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('local touhou');

        expect(match.command.id).toBe('search-local');
        expect(match.input).toBe('touhou');

        await match.command.execute(match.input, context);

        expect(context.submitSearch).toHaveBeenCalledWith(expect.objectContaining({
            query: 'touhou',
            sourceTab: 'local',
            returnView: 'player',
        }));
        expect(context.navigateToSearch).toHaveBeenCalledWith(expect.objectContaining({
            query: 'touhou',
            sourceTab: 'local',
            returnView: 'player',
        }));
    });

    it('opens settings subviews through the settings command', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('integration');

        expect(match.command.id).toBe('settings-integration');
        match.command.execute(match.input, context);

        expect(context.openSettings).toHaveBeenCalledWith('options', 'integration');
    });

    it('matches sync server settings and manual sync commands', () => {
        expect(getCommandPaletteMatches('sync server')[0].command.id).toBe('settings-r2-sync');
        expect(getCommandPaletteMatches('立即同步')[0].command.id).toBe('sync-now');
    });

    it('opens general settings and executes direct language switch commands', async () => {
        const context = createContext();

        const [generalMatch] = getCommandPaletteMatches('通用');
        expect(generalMatch.command.id).toBe('settings-general');
        generalMatch.command.execute(generalMatch.input, context);
        expect(context.openSettings).toHaveBeenCalledWith('options', 'general');

        const [systemLanguageMatch] = getCommandPaletteMatches('跟随系统');
        expect(systemLanguageMatch.command.id).toBe('settings-language-system');
        await systemLanguageMatch.command.execute(systemLanguageMatch.input, context);
        expect(context.setAppLanguagePreference).toHaveBeenCalledWith('system');

        const [englishMatch] = getCommandPaletteMatches('english');
        expect(englishMatch.command.id).toBe('settings-language-en');
        await englishMatch.command.execute(englishMatch.input, context);
        expect(context.setAppLanguagePreference).toHaveBeenCalledWith('en');
    });

    it('previews recognized search commands with parsed input', () => {
        const translations: Record<string, string> = {
            'commandPalette.previewSearch': '搜索{{source}}歌曲：{{query}}',
            'commandPalette.sourceCurrent': '当前来源',
        };
        const context = createContext({
            t: (key, fallback) => translations[key] ?? fallback ?? '',
        });
        const [match] = getCommandPaletteMatches('search 你好世界');

        expect(match.command.id).toBe('search-current');
        expect(match.input).toBe('你好世界');
        expect(match.command.getPreview?.(match.input, context)).toBe('搜索当前来源歌曲：你好世界');
    });

    it('does not preview search commands before input is provided', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('search');

        expect(match.command.id).toBe('search-current');
        expect(match.input).toBe('');
        expect(match.command.getPreview?.(match.input, context)).toBeNull();
    });

    it('matches commands by Chinese keyword and pinyin', () => {
        expect(getCommandPaletteMatches('本地 bad apple')[0].command.id).toBe('search-local');
        expect(getCommandPaletteMatches('bendi bad apple')[0].command.id).toBe('search-local');
        expect(getCommandPaletteMatches('设置')[0].command.id).toBe('settings-options');
        expect(getCommandPaletteMatches('shezhi')[0].command.id).toBe('settings-options');
        expect(getCommandPaletteMatches('心象')[0].command.id).toBe('visualizer-cadenza');
        expect(getCommandPaletteMatches('xinxiang')[0].command.id).toBe('visualizer-cadenza');
    });

    it('executes transparent player background and daylight theme toggle commands', () => {
        const context = createContext();

        const [matchTransparent] = getCommandPaletteMatches('透明化');
        expect(matchTransparent.command.id).toBe('settings-toggle-transparent');
        matchTransparent.command.execute(matchTransparent.input, context);
        expect(context.toggleTransparentBackground).toHaveBeenCalled();

        const [matchDaylight] = getCommandPaletteMatches('切换明暗');
        expect(matchDaylight.command.id).toBe('settings-toggle-daylight');
        matchDaylight.command.execute(matchDaylight.input, context);
        expect(context.toggleDaylightMode).toHaveBeenCalled();

        const [matchBottomSubtitleOverlay] = getCommandPaletteMatches('隐藏底部字幕层');
        expect(matchBottomSubtitleOverlay.command.id).toBe('settings-toggle-bottom-subtitle-overlay');
        matchBottomSubtitleOverlay.command.execute(matchBottomSubtitleOverlay.input, context);
        expect(context.toggleBottomSubtitleOverlay).toHaveBeenCalled();

        const [matchSubtitleTranslation] = getCommandPaletteMatches('字幕翻译');
        expect(matchSubtitleTranslation.command.id).toBe('settings-toggle-subtitle-translation');
        matchSubtitleTranslation.command.execute(matchSubtitleTranslation.input, context);
        expect(context.toggleSubtitleTranslation).toHaveBeenCalled();
    });

    it('executes the current song AI theme generation command', () => {
        const context = createContext();

        const [match] = getCommandPaletteMatches('生成AI主题', context);
        expect(match.command.id).toBe('theme-generate-current');

        match.command.execute(match.input, context);
        expect(context.generateAITheme).toHaveBeenCalled();
    });

    it('hides the AI theme generation command when unavailable or already running', () => {
        expect(getCommandPaletteMatches('生成AI主题', createContext({
            canGenerateAITheme: false,
        })).some(match => match.command.id === 'theme-generate-current')).toBe(false);

        expect(getCommandPaletteMatches('生成AI主题', createContext({
            isGeneratingTheme: true,
        })).some(match => match.command.id === 'theme-generate-current')).toBe(false);
    });

    it('executes the current editable theme quick editor command', () => {
        const context = createContext();

        const [match] = getCommandPaletteMatches('快速主题编辑器', context);
        expect(match.command.id).toBe('theme-quick-editor');

        match.command.execute(match.input, context);
        expect(context.openThemeQuickEditor).toHaveBeenCalled();
    });

    it('hides the theme quick editor command when no editable theme is available', () => {
        expect(getCommandPaletteMatches('快速主题编辑器', createContext({
            canOpenThemeQuickEditor: false,
        })).some(match => match.command.id === 'theme-quick-editor')).toBe(false);
    });

    it('filters out non-current search commands when context is provided', () => {
        const context = createContext({ currentSearchSourceTab: 'local' });

        const matches = getCommandPaletteMatches('search touhou', context);
        const searchMatches = matches.filter(m => m.command.group === 'search');

        expect(searchMatches).toHaveLength(1);
        expect(searchMatches[0].command.id).toBe('search-current');
    });

    it('returns all search commands when context is not provided', () => {
        const matches = getCommandPaletteMatches('search');
        const searchMatches = matches.filter(m => m.command.group === 'search');
        // search-current, search-local, search-navidrome, search-netease
        expect(searchMatches.length).toBe(4);
    });

    it('matches and executes color/theme-park command', () => {
        const context = createContext();
        
        const matchesColor = getCommandPaletteMatches('color');
        expect(matchesColor[0].command.id).toBe('settings-theme-park');
        
        const matchesPeise = getCommandPaletteMatches('配色');
        expect(matchesPeise[0].command.id).toBe('settings-theme-park');

        const matchesZhuti = getCommandPaletteMatches('zhutigongyuan');
        expect(matchesZhuti[0].command.id).toBe('settings-theme-park');

        matchesColor[0].command.execute('', context);
        expect(context.openSettings).toHaveBeenCalledWith('options', 'themePark');
    });

    it('executes navigation commands', async () => {
        const context = createContext();
        
        const [matchHome] = getCommandPaletteMatches('home');
        expect(matchHome.command.id).toBe('navigate-home');
        matchHome.command.execute('', context);
        expect(context.navigateToHome).toHaveBeenCalled();

        const [matchPlayer] = getCommandPaletteMatches('player');
        expect(matchPlayer.command.id).toBe('navigate-player');
        matchPlayer.command.execute('', context);
        expect(context.navigateToPlayer).toHaveBeenCalled();

        const [matchFullscreen] = getCommandPaletteMatches('浏览器全屏');
        expect(matchFullscreen.command.id).toBe('browser-fullscreen');
        await matchFullscreen.command.execute('', context);
        expect(context.toggleBrowserFullscreen).toHaveBeenCalled();
    });

    it('executes home tab navigation commands', () => {
        const context = createContext();
        
        const [matchLocalTab] = getCommandPaletteMatches('local music');
        expect(matchLocalTab.command.id).toBe('home-local');
        matchLocalTab.command.execute('', context);
        expect(context.setHomeViewTab).toHaveBeenCalledWith('local');
        expect(context.navigateToHome).toHaveBeenCalled();
    });

    it('executes playback controls', () => {
        const context = createContext({ playerState: PlayerState.PAUSED });
        
        const [matchPlay] = getCommandPaletteMatches('play');
        expect(matchPlay.command.id).toBe('playback-play');
        matchPlay.command.execute('', context);
        expect(context.togglePlay).toHaveBeenCalled();

        const contextPlaying = createContext({ playerState: PlayerState.PLAYING });
        const [matchPause] = getCommandPaletteMatches('pause');
        expect(matchPause.command.id).toBe('playback-pause');
        matchPause.command.execute('', contextPlaying);
        expect(contextPlaying.togglePlay).toHaveBeenCalled();
        
        const [matchNext] = getCommandPaletteMatches('next');
        expect(matchNext.command.id).toBe('playback-next');
        matchNext.command.execute('', context);
        expect(context.handleNextTrack).toHaveBeenCalled();

        const [matchPrev] = getCommandPaletteMatches('prev');
        expect(matchPrev.command.id).toBe('playback-prev');
        matchPrev.command.execute('', context);
        expect(context.handlePrevTrack).toHaveBeenCalled();

        const [matchLoop] = getCommandPaletteMatches('loop');
        expect(matchLoop.command.id).toBe('playback-loop');
        matchLoop.command.execute('', context);
        expect(context.toggleLoop).toHaveBeenCalled();

        const [matchShuffle] = getCommandPaletteMatches('shuffle');
        expect(matchShuffle.command.id).toBe('playback-shuffle');
        matchShuffle.command.execute('', context);
        expect(context.shuffleQueue).toHaveBeenCalled();
    });

    it('shows best lyric auto-match command only when alternative lyric sources are enabled', async () => {
        const disabledContext = createContext({ enableAlternativeLyricSources: false });
        expect(getCommandPaletteMatches('最佳歌词', disabledContext).some(match => match.command.id === 'playback-auto-match-best-lyric')).toBe(false);

        const enabledContext = createContext({ enableAlternativeLyricSources: true });
        const [match] = getCommandPaletteMatches('最佳歌词', enabledContext);
        expect(match.command.id).toBe('playback-auto-match-best-lyric');

        await match.command.execute(match.input, enabledContext);
        expect(enabledContext.runAutoMatchBestLyric).toHaveBeenCalled();
    });

    it('filters out settings-desktop command in a web browser environment without electron', () => {
        vi.stubGlobal('window', {});

        try {
            const matches = getCommandPaletteMatches('desktop');
            const hasDesktopCommand = matches.some(m => m.command.id === 'settings-desktop');
            expect(hasDesktopCommand).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('retains settings-desktop command in desktop app environment', () => {
        vi.stubGlobal('window', { electron: {} });

        try {
            const matches = getCommandPaletteMatches('desktop');
            const hasDesktopCommand = matches.some(m => m.command.id === 'settings-desktop');
            expect(hasDesktopCommand).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('limits suggestions to ten commands', () => {
        expect(getCommandPaletteMatches('')).toHaveLength(10);
    });

    it('matches and executes background and visualizer monet switching commands', () => {
        const context = createContext();

        const [matchMonet] = getCommandPaletteMatches('切换到可视化：莫奈');
        expect(matchMonet.command.id).toBe('visualizer-monet');
        matchMonet.command.execute('', context);
        expect(context.setVisualizerMode).toHaveBeenCalledWith('monet');

        const [matchFullOverlay] = getCommandPaletteMatches('全屏叠色');
        expect(matchFullOverlay.command.id).toBe('background-monet-full-overlay');
        matchFullOverlay.command.execute('', context);
        expect(context.setVisualizerBackgroundMode).toHaveBeenCalledWith('monet');
        expect(context.setMonetBackgroundTuning).toHaveBeenCalledWith({ backgroundLayout: 'full-overlay' });

        const [matchHalfGradient] = getCommandPaletteMatches('半屏渐变');
        expect(matchHalfGradient.command.id).toBe('background-monet-half-gradient');
        matchHalfGradient.command.execute('', context);
        expect(context.setVisualizerBackgroundMode).toHaveBeenCalledWith('monet');
        expect(context.setMonetBackgroundTuning).toHaveBeenCalledWith({ backgroundLayout: 'half-pane-gradient' });

        const [matchCommon] = getCommandPaletteMatches('通用背景');
        expect(matchCommon.command.id).toBe('background-common');
        matchCommon.command.execute('', context);
        expect(context.setVisualizerBackgroundMode).toHaveBeenCalledWith('common');
    });
});
