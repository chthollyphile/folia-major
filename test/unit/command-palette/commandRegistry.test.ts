import { describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '../../../src/types';
import { COMMAND_PALETTE_COMMANDS, getAvailableCommandPaletteCommands, getCommandPaletteMatches, getQueueSongMatches } from '../../../src/components/command-palette/commandRegistry';
import { sleepTimerSurface } from '../../../src/components/command-palette/surfaces/sleepTimerSurface';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

type CommandPaletteContextOverrides = {
    [Namespace in keyof CommandPaletteContext]?: Partial<CommandPaletteContext[Namespace]>;
};

// Merges per-namespace overrides onto a fully stubbed context so a test only states the
// fields it actually cares about.
const createContext = (overrides: CommandPaletteContextOverrides = {}): CommandPaletteContext => {
    const base: CommandPaletteContext = {
        // The palette's original and still most common surface; the home cases say so explicitly.
        scope: { view: 'player', filter: null },
        shared: {
            t: (_key: string, fallback?: string) => fallback ?? '',
            setStatusMsg: vi.fn(),
            currentSong: null,
            lyrics: null,
            playerState: PlayerState.PAUSED,
        },
        search: {
            currentSearchSourceTab: 'netease',
            localSongs: [],
            localLibraryCatalog: { entities: [], assignments: [] },
            navigateToSearch: vi.fn(),
            submitSearch: vi.fn(async () => true),
        },
        playback: {
            volume: 0.5,
            isMuted: false,
            setVolume: vi.fn(),
            toggleMute: vi.fn(),
            toggleSongLike: vi.fn(),
            isSongLiked: false,
            openAddToPlaylist: vi.fn(),
            canAddCurrentSongToPlaylist: true,
            previewVolume: vi.fn(),
            isFmMode: false,
            personalFmSelection: { mode: 'DEFAULT' as const, scene: null },
            isPersonalFmModeSupported: true,
            setPersonalFmSelection: vi.fn(),
            togglePlay: vi.fn(),
            toggleLoop: vi.fn(),
            next: vi.fn(),
            prev: vi.fn(),
            queue: [],
            playSong: vi.fn(),
            shuffleQueue: vi.fn(),
            clearQueue: vi.fn(),
            applyQueueBatchOperation: vi.fn(() => true),
            removeQueueSong: vi.fn(),
            moveQueueSongToNext: vi.fn(),
            moveQueueSongToEnd: vi.fn(),
            setReplayGainMode: vi.fn(),
            openAudioEqualizer: vi.fn(),
            applyAudioSoundPreset: vi.fn(),
            runAutoMatchBestLyric: vi.fn(async () => true),
        },
        navigation: {
        navigateToHome: vi.fn(),
        navigateToPlayer: vi.fn(),
        navigateToLattice: vi.fn(),
            setHomeViewTab: vi.fn(),
            toggleBrowserFullscreen: vi.fn(async () => true),
            toggleRemoteControlWindow: vi.fn(async () => true),
            toggleMainWindowAlwaysOnTop: vi.fn(async () => true),
            isWallpaperMode: false,
        },
        panel: {
            setPanelTab: vi.fn(),
            setIsPanelOpen: vi.fn(),
        },
        settings: {
            openSettings: vi.fn(),
            lyricStaffPolicy: 'smart' as const,
            cycleLyricStaffPolicy: vi.fn(),
            lyricStaffAbsorbMode: 'off' as const,
            cycleLyricStaffAbsorbMode: vi.fn(),
            setIsUserGuideModalOpen: vi.fn(),
            setAppLanguagePreference: vi.fn(async () => undefined),
            toggleTransparentBackground: vi.fn(),
            toggleDaylightMode: vi.fn(),
            toggleBottomSubtitleOverlay: vi.fn(),
            subtitleContentMode: 'translation',
            cycleSubtitleContentMode: vi.fn(),
            toggleSubtitleOverlayBackground: vi.fn(),
            startPlayerBottomBarPositioning: vi.fn(),
            canStartPlayerBottomBarPositioning: true,
            toggleAlwaysShowPlayerBackButton: vi.fn(),
            toggleAlwaysShowTrackSwitchButtons: vi.fn(),
            toggleAutoPlayOnLaunch: vi.fn(),
            toggleAlwaysShowMainWindowTitlebar: vi.fn(),
            voiceInputPauseSupported: false,
            modSystemEnabled: false,
            toggleVoiceInputPause: vi.fn(),
            togglePreventDisplaySleepDuringPlayback: vi.fn(),
            toggleWallpaperMode: vi.fn(),
            toggleWallpaperMacAutohideDock: vi.fn(),
            sleepTimerEnabled: false,
            setSleepTimerEnabled: vi.fn(),
            sleepTimerHours: 0,
            setSleepTimerHours: vi.fn(),
            sleepTimerMinutes: 0,
            setSleepTimerMinutes: vi.fn(),
            sleepTimerDeadlineMs: null,
            canGenerateAITheme: true,
            isGeneratingTheme: false,
            generateAITheme: vi.fn(),
            openThemeQuickEditor: vi.fn(),
            canOpenThemeQuickEditor: true,
            themeGenerationSource: 'ai',
            setThemeGenerationSource: vi.fn(),
            automixEnabled: false,
            transitionMode: 'crossfade',
            transitionPerformance: false,
            toggleAutomix: vi.fn(),
            setTransitionMode: vi.fn(),
            toggleTransitionPerformance: vi.fn(),
            canUseTransitionPerformance: vi.fn(() => true),
        },
        visualizer: {
            visualizerMode: 'classic',
            visualizerBackgroundMode: 'latent',
            setVisualizerMode: vi.fn(),
            toggleRandomVisualizerModePerSong: vi.fn(),
            setVisualizerBackgroundMode: vi.fn(),
            setMonetBackgroundTuning: vi.fn(),
            setLatentBackgroundTuning: vi.fn(),
            usesWordSegmentation: true,
            lyricSegmentation: {
                record: null,
                isAiAvailable: true,
                save: vi.fn(async () => {}),
                reset: vi.fn(async () => {}),
            },
        },
    };

    return Object.fromEntries(
        Object.entries(base).map(([namespace, values]) => [
            namespace,
            { ...values, ...overrides[namespace as keyof CommandPaletteContext] },
        ]),
    ) as CommandPaletteContext;
};

describe('command palette registry', () => {
    it('cycles the subtitle content mode via the unified command', async () => {
        const context = createContext();
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === 'settings-cycle-subtitle-content-mode');

        expect(command).toBeDefined();
        await command!.execute('', context);
        expect(context.settings.cycleSubtitleContentMode).toHaveBeenCalled();
    });

    it('parses source-specific search input', async () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('local touhou');

        expect(match.command.id).toBe('search-local');
        expect(match.input).toBe('touhou');

        await match.command.execute(match.input, context);

        expect(context.search.submitSearch).toHaveBeenCalledWith(expect.objectContaining({
            query: 'touhou',
            sourceTab: 'local',
            returnView: 'player',
        }));
        expect(context.search.navigateToSearch).toHaveBeenCalledWith(expect.objectContaining({
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

        expect(context.settings.openSettings).toHaveBeenCalledWith('options', 'integration');
    });

    it('opens the local lyrics priority setting from the command palette', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('在线优先');

        expect(match.command.id).toBe('settings-local-lyrics-priority');
        match.command.execute(match.input, context);

        expect(context.settings.openSettings).toHaveBeenCalledWith('options', 'playback');
    });

    it('switches ReplayGain modes from the command palette', () => {
        const context = createContext();

        const [trackMatch] = getCommandPaletteMatches('单曲增益');
        expect(trackMatch.command.id).toBe('playback-replaygain-track');
        trackMatch.command.execute(trackMatch.input, context);
        expect(context.playback.setReplayGainMode).toHaveBeenCalledWith('track');

        const [albumMatch] = getCommandPaletteMatches('album gain');
        expect(albumMatch.command.id).toBe('playback-replaygain-album');
        albumMatch.command.execute(albumMatch.input, context);
        expect(context.playback.setReplayGainMode).toHaveBeenCalledWith('album');

        const [offMatch] = getCommandPaletteMatches('关闭音频增益');
        expect(offMatch.command.id).toBe('playback-replaygain-off');
        offMatch.command.execute(offMatch.input, context);
        expect(context.playback.setReplayGainMode).toHaveBeenCalledWith('off');
    });

    it('opens the controls panel and ten-band equalizer', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('十段均衡器', context);

        expect(match.command.id).toBe('playback-equalizer');
        match.command.execute(match.input, context);

        expect(context.panel.setPanelTab).toHaveBeenCalledWith('controls');
        expect(context.panel.setIsPanelOpen).toHaveBeenCalledWith(true);
        expect(context.playback.openAudioEqualizer).toHaveBeenCalled();
    });

    it('opens the volume control command and accepts only values from 0 to 100', () => {
        const context = createContext({ playback: { volume: 0.42 } });
        const [match] = getCommandPaletteMatches('音量条');

        expect(match.command.id).toBe('playback-volume');
        expect(match.command.requiresInput).toBe(true);
        expect(match.command.getInitialInput?.(context)).toBe('42');
        expect(match.command.execute('75', context)).toBe(true);
        expect(context.playback.setVolume).toHaveBeenCalledWith(0.75);

        expect(match.command.execute('-1', context)).toBe(false);
        expect(match.command.execute('101', context)).toBe(false);
        expect(match.command.execute('loud', context)).toBe(false);
        expect(context.playback.setVolume).toHaveBeenCalledTimes(1);
    });

    it('sets, enables, and disables the sleep timer from minute input and flags', () => {
        const context = createContext();
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === 'sleep-timer');
        const [directMatch] = getCommandPaletteMatches('sleep timer --on 90', context);

        expect(command).toBeDefined();
        expect(command!.syntax).toBeDefined();
        expect(directMatch.command.id).toBe('sleep-timer');
        expect(directMatch.input).toBe('--on 90');
        expect(directMatch.command.execute(directMatch.input, context)).toBe(true);
        expect(context.settings.setSleepTimerHours).toHaveBeenCalledWith(1);
        expect(context.settings.setSleepTimerMinutes).toHaveBeenCalledWith(30);
        expect(context.settings.setSleepTimerEnabled).toHaveBeenCalledWith(true);

        expect(command!.execute('--off', context)).toBe(true);
        expect(context.settings.setSleepTimerEnabled).toHaveBeenLastCalledWith(false);
    });

    it('keeps the sleep timer unchanged when command input is invalid', () => {
        const context = createContext();
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === 'sleep-timer')!;

        expect(command.execute('--on nope', context)).toBe(false);
        expect(context.settings.setSleepTimerHours).not.toHaveBeenCalled();
        expect(context.settings.setSleepTimerMinutes).not.toHaveBeenCalled();
        expect(context.settings.setSleepTimerEnabled).not.toHaveBeenCalled();
        expect(context.shared.setStatusMsg).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('previews command input in the sleep timer surface without changing its settings', () => {
        const context = createContext({
            settings: { sleepTimerHours: 0, sleepTimerMinutes: 15 },
        });

        // This surface always declares a body; `mapProps` is only optional for the inline ones.
        const props = sleepTimerSurface.mapProps!({
            context,
            query: '--on 90',
            setQuery: vi.fn(),
            matches: [],
            activeIndex: 0,
            setActiveIndex: vi.fn(),
            isExecuting: false,
            executeMatch: vi.fn(),
            executeCommand: vi.fn(),
            close: vi.fn(),
            isDaylight: false,
            theme: {} as never,
        });

        expect(props).toMatchObject({ hours: 1, minutes: 30 });
        expect(context.settings.setSleepTimerHours).not.toHaveBeenCalled();
        expect(context.settings.setSleepTimerMinutes).not.toHaveBeenCalled();
    });

    it('applies a full sound preset from the command palette', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('低保真', context);

        expect(match.command.id).toBe('playback-sound-preset-lofi');
        match.command.execute(match.input, context);

        expect(context.playback.applyAudioSoundPreset).toHaveBeenCalledWith('lofi');
    });

    it('matches sync server settings and manual sync commands', () => {
        expect(getCommandPaletteMatches('sync server')[0].command.id).toBe('settings-r2-sync');
        expect(getCommandPaletteMatches('立即同步')[0].command.id).toBe('sync-now');
    });

    it('shows a toast instead of syncing when sync is not configured', async () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('立即同步');

        await match.command.execute(match.input, context);

        expect(context.shared.setStatusMsg).toHaveBeenCalledWith({
            type: 'info',
            text: 'Sync is not enabled. Configure and enable it in Storage settings first.',
        });
    });

    it('opens general settings and executes direct language switch commands', async () => {
        const context = createContext();

        const [generalMatch] = getCommandPaletteMatches('通用');
        expect(generalMatch.command.id).toBe('settings-general');
        generalMatch.command.execute(generalMatch.input, context);
        expect(context.settings.openSettings).toHaveBeenCalledWith('options', 'general');

        const playerControlSlotsCommand = COMMAND_PALETTE_COMMANDS.find(
            command => command.id === 'settings-player-control-slots',
        );
        expect(playerControlSlotsCommand).toBeDefined();
        playerControlSlotsCommand!.execute('', context);
        expect(context.settings.openSettings).toHaveBeenLastCalledWith('options', 'general');

        const [systemLanguageMatch] = getCommandPaletteMatches('跟随系统');
        expect(systemLanguageMatch.command.id).toBe('settings-language-system');
        await systemLanguageMatch.command.execute(systemLanguageMatch.input, context);
        expect(context.settings.setAppLanguagePreference).toHaveBeenCalledWith('system');

        const [englishMatch] = getCommandPaletteMatches('english');
        expect(englishMatch.command.id).toBe('settings-language-en');
        await englishMatch.command.execute(englishMatch.input, context);
        expect(context.settings.setAppLanguagePreference).toHaveBeenCalledWith('en');
    });

    it('previews recognized search commands with parsed input', () => {
        const translations: Record<string, string> = {
            'commandPalette.previewSearch': '搜索{{source}}歌曲：{{query}}',
            'commandPalette.sourceCurrent': '当前来源',
        };
        const context = createContext({
            shared: { t: (key: string, fallback?: string) => translations[key] ?? fallback ?? '' },
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

    it('keeps the complete queue available for virtualization and preserves queue search', () => {
        const playQueue = Array.from({ length: 24 }, (_, index): SongResult => ({
            id: index + 1,
            name: index === 17 ? 'Needle Song' : `Queue Song ${index + 1}`,
            artists: [{ id: index + 1, name: `Artist ${index + 1}` }],
            album: { id: index + 1, name: `Album ${index + 1}` },
            durationMs: 180_000,
        }));
        const context = createContext({ playback: { queue: playQueue } });

        const fullQueue = getQueueSongMatches('', context);
        const filteredQueue = getQueueSongMatches('needle', context);

        expect(fullQueue).toHaveLength(playQueue.length);
        expect(fullQueue[17].command.queueIndex).toBe(17);
        expect(fullQueue[17].command.queueSong).toBe(playQueue[17]);
        expect(filteredQueue).toHaveLength(1);
        expect(filteredQueue[0].command.queueIndex).toBe(17);
    });

    it('clears the play queue and hides the command when the queue is empty', () => {
        const playQueue: SongResult[] = [{
            id: 1,
            name: 'Queue Song 1',
            artists: [{ id: 1, name: 'Artist 1' }],
            album: { id: 1, name: 'Album 1' },
            durationMs: 180_000,
        }];
        const context = createContext({ playback: { queue: playQueue } });

        const [match] = getCommandPaletteMatches('清空队列', context);
        expect(match.command.id).toBe('playback-clear-queue');
        expect(match.command.execute(match.input, context)).toBe(true);
        expect(context.playback.clearQueue).toHaveBeenCalled();

        expect(getCommandPaletteMatches('清空队列', createContext())
            .some(entry => entry.command.id === 'playback-clear-queue')).toBe(false);
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
        expect(context.settings.toggleTransparentBackground).toHaveBeenCalled();

        const [matchDaylight] = getCommandPaletteMatches('切换明暗');
        expect(matchDaylight.command.id).toBe('settings-toggle-daylight');
        matchDaylight.command.execute(matchDaylight.input, context);
        expect(context.settings.toggleDaylightMode).toHaveBeenCalled();

        const [matchBottomSubtitleOverlay] = getCommandPaletteMatches('隐藏底部字幕层');
        expect(matchBottomSubtitleOverlay.command.id).toBe('settings-toggle-bottom-subtitle-overlay');
        matchBottomSubtitleOverlay.command.execute(matchBottomSubtitleOverlay.input, context);
        expect(context.settings.toggleBottomSubtitleOverlay).toHaveBeenCalled();

        const [playerBackButtonMatch] = getCommandPaletteMatches('始终显示返回按钮');
        expect(playerBackButtonMatch.command.id).toBe('settings-toggle-player-back-button');
        playerBackButtonMatch.command.execute(playerBackButtonMatch.input, context);
        expect(context.settings.toggleAlwaysShowPlayerBackButton).toHaveBeenCalled();

        const [mainWindowTitlebarMatch] = getCommandPaletteMatches('始终显示标题栏');
        expect(mainWindowTitlebarMatch.command.id).toBe('settings-toggle-main-window-titlebar');
        mainWindowTitlebarMatch.command.execute(mainWindowTitlebarMatch.input, context);
        expect(context.settings.toggleAlwaysShowMainWindowTitlebar).toHaveBeenCalled();

        const [matchSubtitleCycle] = getCommandPaletteMatches('字幕翻译');
        expect(matchSubtitleCycle.command.id).toBe('settings-cycle-subtitle-content-mode');
        matchSubtitleCycle.command.execute(matchSubtitleCycle.input, context);
        expect(context.settings.cycleSubtitleContentMode).toHaveBeenCalled();

        const [matchSubtitleBackground] = getCommandPaletteMatches('字幕背景');
        expect(matchSubtitleBackground.command.id).toBe('settings-toggle-subtitle-background');
        matchSubtitleBackground.command.execute(matchSubtitleBackground.input, context);
        expect(context.settings.toggleSubtitleOverlayBackground).toHaveBeenCalled();
    });

    it('executes the current song AI theme generation command', () => {
        const context = createContext();

        const [match] = getCommandPaletteMatches('生成AI主题', context);
        expect(match.command.id).toBe('theme-generate-current');

        match.command.execute(match.input, context);
        expect(context.settings.generateAITheme).toHaveBeenCalled();
    });

    it('hides the AI theme generation command when unavailable or already running', () => {
        expect(getCommandPaletteMatches('生成AI主题', createContext({
            settings: { canGenerateAITheme: false },
        })).some(match => match.command.id === 'theme-generate-current')).toBe(false);

        expect(getCommandPaletteMatches('生成AI主题', createContext({
            settings: { isGeneratingTheme: true },
        })).some(match => match.command.id === 'theme-generate-current')).toBe(false);
    });

    it('executes the current editable theme quick editor command', () => {
        const context = createContext();

        const [match] = getCommandPaletteMatches('快速主题编辑器', context);
        expect(match.command.id).toBe('theme-quick-editor');

        match.command.execute(match.input, context);
        expect(context.settings.openThemeQuickEditor).toHaveBeenCalled();
    });

    it('hides the theme quick editor command when no editable theme is available', () => {
        expect(getCommandPaletteMatches('快速主题编辑器', createContext({
            settings: { canOpenThemeQuickEditor: false },
        })).some(match => match.command.id === 'theme-quick-editor')).toBe(false);
    });

    it('filters out non-current search commands when context is provided', () => {
        const context = createContext({ search: { currentSearchSourceTab: 'local' } });

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
        expect(context.settings.openSettings).toHaveBeenCalledWith('options', 'themePark');
    });

    it('executes navigation commands', async () => {
        const context = createContext();
        
        const [matchHome] = getCommandPaletteMatches('home');
        expect(matchHome.command.id).toBe('navigate-home');
        matchHome.command.execute('', context);
        expect(context.navigation.navigateToHome).toHaveBeenCalled();

        const [matchPlayer] = getCommandPaletteMatches('player');
        expect(matchPlayer.command.id).toBe('navigate-player');
        matchPlayer.command.execute('', context);
        expect(context.navigation.navigateToPlayer).toHaveBeenCalled();

        const [matchFullscreen] = getCommandPaletteMatches('浏览器全屏');
        expect(matchFullscreen.command.id).toBe('browser-fullscreen');
        await matchFullscreen.command.execute('', context);
        expect(context.navigation.toggleBrowserFullscreen).toHaveBeenCalled();
    });

    it('executes home tab navigation commands', () => {
        const context = createContext();
        
        const [matchLocalTab] = getCommandPaletteMatches('local music');
        expect(matchLocalTab.command.id).toBe('home-local');
        matchLocalTab.command.execute('', context);
        expect(context.navigation.setHomeViewTab).toHaveBeenCalledWith('local');
        expect(context.navigation.navigateToHome).toHaveBeenCalled();
    });

    it('executes playback controls', () => {
        const context = createContext({ shared: { playerState: PlayerState.PAUSED } });
        
        const [matchPlay] = getCommandPaletteMatches('play');
        expect(matchPlay.command.id).toBe('playback-play');
        matchPlay.command.execute('', context);
        expect(context.playback.togglePlay).toHaveBeenCalled();

        const contextPlaying = createContext({ shared: { playerState: PlayerState.PLAYING } });
        const [matchPause] = getCommandPaletteMatches('pause');
        expect(matchPause.command.id).toBe('playback-pause');
        matchPause.command.execute('', contextPlaying);
        expect(contextPlaying.playback.togglePlay).toHaveBeenCalled();
        
        const [matchNext] = getCommandPaletteMatches('next');
        expect(matchNext.command.id).toBe('playback-next');
        matchNext.command.execute('', context);
        expect(context.playback.next).toHaveBeenCalled();

        const [matchPrev] = getCommandPaletteMatches('prev');
        expect(matchPrev.command.id).toBe('playback-prev');
        matchPrev.command.execute('', context);
        expect(context.playback.prev).toHaveBeenCalled();

        const [matchLoop] = getCommandPaletteMatches('loop');
        expect(matchLoop.command.id).toBe('playback-loop');
        matchLoop.command.execute('', context);
        expect(context.playback.toggleLoop).toHaveBeenCalled();

        const [matchShuffle] = getCommandPaletteMatches('shuffle');
        expect(matchShuffle.command.id).toBe('playback-shuffle');
        matchShuffle.command.execute('', context);
        expect(context.playback.shuffleQueue).toHaveBeenCalled();
    });

    it('always exposes the best lyric auto-match command', async () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('最佳歌词', context);
        expect(match.command.id).toBe('playback-auto-match-best-lyric');

        await match.command.execute(match.input, context);
        expect(context.playback.runAutoMatchBestLyric).toHaveBeenCalled();
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

    it('allows recent input commands to fill the ten-command landing list', () => {
        const recentIds = [
            'queue',
            'search-current',
            'playback-prev',
            'playback-next',
            'playback-pause',
            'playback-play',
            'playback-loop',
            'playback-shuffle',
            'panel-queue',
            'settings-general',
        ];

        expect(getCommandPaletteMatches('', createContext(), recentIds).map(match => match.command.id))
            .toEqual(recentIds);
    });

    it('prioritizes remembered commands within the same search match quality', () => {
        const matches = getCommandPaletteMatches(
            'panel',
            createContext(),
            ['panel-controls', 'panel-queue'],
        );
        const panelCommandIds = matches
            .map(match => match.command.id)
            .filter(commandId => commandId.startsWith('panel-'));

        expect(panelCommandIds.slice(0, 2)).toEqual(['panel-controls', 'panel-queue']);
    });

    it('uses MRU order when remembered commands are equally strong exact matches', () => {
        const matches = getCommandPaletteMatches(
            'local',
            undefined,
            ['home-local', 'search-local'],
        );

        expect(matches.slice(0, 2).map(match => match.command.id))
            .toEqual(['home-local', 'search-local']);
    });

    it('keeps an exact non-remembered match above a fuzzy remembered match', () => {
        const matches = getCommandPaletteMatches(
            'queue',
            createContext(),
            ['panel-queue'],
        );

        expect(matches[0].command.id).toBe('queue');
        expect(matches.findIndex(match => match.command.id === 'panel-queue')).toBeGreaterThan(0);
    });

    it('matches and executes background and visualizer monet switching commands', () => {
        const context = createContext();

        const [matchMonet] = getCommandPaletteMatches('切换到可视化：莫奈');
        expect(matchMonet.command.id).toBe('visualizer-monet');
        matchMonet.command.execute('', context);
        expect(context.visualizer.setVisualizerMode).toHaveBeenCalledWith('monet');

        const [matchFullOverlay] = getCommandPaletteMatches('全屏叠色');
        expect(matchFullOverlay.command.id).toBe('background-monet-full-overlay');
        matchFullOverlay.command.execute('', context);
        expect(context.visualizer.setVisualizerBackgroundMode).toHaveBeenCalledWith('monet');
        expect(context.visualizer.setMonetBackgroundTuning).toHaveBeenCalledWith({ backgroundLayout: 'full-overlay' });

        const [matchHalfGradient] = getCommandPaletteMatches('半屏渐变');
        expect(matchHalfGradient.command.id).toBe('background-monet-half-gradient');
        matchHalfGradient.command.execute('', context);
        expect(context.visualizer.setVisualizerBackgroundMode).toHaveBeenCalledWith('monet');
        expect(context.visualizer.setMonetBackgroundTuning).toHaveBeenCalledWith({ backgroundLayout: 'half-pane-gradient' });

        const [matchCommon] = getCommandPaletteMatches('通用背景');
        expect(matchCommon.command.id).toBe('background-common');
        matchCommon.command.execute('', context);
        expect(context.visualizer.setVisualizerBackgroundMode).toHaveBeenCalledWith('common');

        const [matchNomand] = getCommandPaletteMatches('像素画');
        expect(matchNomand.command.id).toBe('background-nomand');
        matchNomand.command.execute('', context);
        expect(context.visualizer.setVisualizerBackgroundMode).toHaveBeenCalledWith('nomand');

        const [matchLatent] = getCommandPaletteMatches('隐现背景');
        expect(matchLatent.command.id).toBe('background-latent');
        matchLatent.command.execute('', context);
        expect(context.visualizer.setVisualizerBackgroundMode).toHaveBeenCalledWith('latent');

        const [matchLatentFluid] = getCommandPaletteMatches('隐现流体');
        expect(matchLatentFluid.command.id).toBe('background-latent-mesh');
        matchLatentFluid.command.execute('', context);
        expect(context.visualizer.setLatentBackgroundTuning).toHaveBeenCalledWith({ displayMode: 'mesh' });
    });

    it('matches and executes the Diorama visualizer command', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('镜台');

        expect(match.command.id).toBe('visualizer-diorama');
        match.command.execute('', context);
        expect(context.visualizer.setVisualizerMode).toHaveBeenCalledWith('diorama');
    });

    it('matches and executes desktop window toggle commands', async () => {
        vi.stubGlobal('window', { electron: {} });

        try {
            const context = createContext();
            const [remoteMatch] = getCommandPaletteMatches('切换遥控窗口', context);
            expect(remoteMatch.command.id).toBe('desktop-toggle-remote-control');
            await remoteMatch.command.execute('', context);
            expect(context.navigation.toggleRemoteControlWindow).toHaveBeenCalled();

            const [topMatch] = getCommandPaletteMatches('主窗口置顶', context);
            expect(topMatch.command.id).toBe('desktop-toggle-main-window-always-on-top');
            await topMatch.command.execute('', context);
            expect(context.navigation.toggleMainWindowAlwaysOnTop).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('toggles the desktop-local lyrics API', async () => {
        const getLyricApiStatus = vi.fn().mockResolvedValue({ enabled: false, running: false });
        const setLyricApiEnabled = vi.fn().mockResolvedValue({ enabled: true, running: true });
        vi.stubGlobal('window', { electron: { getLyricApiStatus, setLyricApiEnabled } });

        try {
            const context = createContext();
            const [match] = getCommandPaletteMatches('歌词接口', context);
            expect(match.command.id).toBe('desktop-toggle-lyric-api');
            await match.command.execute('', context);
            expect(setLyricApiEnabled).toHaveBeenCalledWith(true);
            expect(context.shared.setStatusMsg).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('matches and executes the desktop display sleep toggle', async () => {
        vi.stubGlobal('window', { electron: {} });
        try {
            const context = createContext();
            const [match] = getCommandPaletteMatches('播放时阻止休眠', context);
            expect(match.command.id).toBe('desktop-toggle-prevent-display-sleep');
            await match.command.execute('', context);
            expect(context.settings.togglePreventDisplaySleepDuringPlayback).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('toggles random visualizer mode for each song', () => {
        const context = createContext();
        const [match] = getCommandPaletteMatches('每首歌随机动画');

        expect(match.command.id).toBe('visualizer-toggle-random-per-song');
        match.command.execute('', context);
        expect(context.visualizer.toggleRandomVisualizerModePerSong).toHaveBeenCalled();
    });
});

describe('filter-view stands in for the grids own search box', () => {
    // 这条命令只有在有人「读键入」时才成立：它写的是注册方，不是自己的状态。
    const withFilter = (query = '') => {
        const setQuery = vi.fn();
        const context = createContext({
            scope: { view: 'home', filter: { getQuery: () => query, setQuery, getAnchor: () => null } },
        });
        return { context, setQuery };
    };

    const surface = () => COMMAND_PALETTE_COMMANDS.find(command => command.id === 'filter-view')!.surface!;

    const surfaceArgs = (context: CommandPaletteContext, query: string) => ({
        context,
        query,
        setQuery: vi.fn(),
        matches: [],
        activeIndex: 0,
        setActiveIndex: vi.fn(),
        isExecuting: false,
        executeMatch: vi.fn(async () => true),
        executeCommand: vi.fn(async () => true),
        close: vi.fn(),
    });

    it('is withheld where nothing reads typed characters', () => {
        const ids = getAvailableCommandPaletteCommands(createContext()).map(command => command.id);
        expect(ids).not.toContain('filter-view');
    });

    it('is offered as soon as a surface registers one', () => {
        const ids = getAvailableCommandPaletteCommands(withFilter().context).map(command => command.id);
        expect(ids).toContain('filter-view');
    });

    it('resumes the filter already in place instead of discarding it', () => {
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === 'filter-view')!;
        expect(command.getInitialInput!(withFilter('blue').context)).toBe('blue');
    });

    it('writes every keystroke straight through', () => {
        const { context, setQuery } = withFilter();
        surface().onQueryChange!(surfaceArgs(context, 'blu'));
        expect(setQuery).toHaveBeenCalledWith('blu');
    });

    it('clears the filter on escape, then lets the box close', () => {
        const { context, setQuery } = withFilter('blue');
        const keepOpen = surface().onEscape!(surfaceArgs(context, 'blue'));
        expect(setQuery).toHaveBeenCalledWith('');
        expect(keepOpen).toBe(false);
    });

    it('swallows Enter, because closing would hide the only sign the view is filtered', () => {
        const { context } = withFilter('blue');
        const args = surfaceArgs(context, 'blue');
        expect(surface().onSubmit!(args)).toBe(true);
        expect(args.close).not.toHaveBeenCalled();
    });

    it('draws itself inline, with no body of its own', () => {
        expect(surface().presentation).toBe('inline');
        expect(surface().load).toBeUndefined();
    });
});

describe('the player surface gates the panel commands', () => {
    // 面板长在播放页上；命令面板放开到全 app 之后，这些命令在首页没有可开的东西。
    // 置灰而不是隐藏——它们在播放页始终存在，凭视图消失会让列表看起来在闪。
    const PLAYER_SURFACE_COMMAND_IDS = [
        'panel-cover', 'panel-controls', 'panel-queue', 'panel-account',
        'panel-local', 'panel-navi', 'panel-onlineLyrics', 'playback-equalizer',
    ];

    const availableIds = (view: 'home' | 'player') => (
        getAvailableCommandPaletteCommands(createContext({ scope: { view, filter: null } })).map(command => command.id)
    );

    it('offers them on the player', () => {
        const ids = availableIds('player');
        PLAYER_SURFACE_COMMAND_IDS.forEach(id => expect(ids).toContain(id));
    });

    it('withdraws them on home', () => {
        const ids = availableIds('home');
        PLAYER_SURFACE_COMMAND_IDS.forEach(id => expect(ids).not.toContain(id));
    });

    it('leaves the rest of the registry alone on home', () => {
        const ids = availableIds('home');
        expect(ids).toContain('playback-next');
        expect(ids).toContain('navigate-player');
        expect(ids).toContain('visualizer-picker');
    });

    it('keeps them listed when nobody states a scope', () => {
        // 契约测试与固定命令选择器都在没有 app 的情况下问可用性，两者都要看到完整注册表。
        const ids = COMMAND_PALETTE_COMMANDS
            .filter(command => command.isAvailable?.(undefined) ?? true)
            .map(command => command.id);
        PLAYER_SURFACE_COMMAND_IDS.forEach(id => expect(ids).toContain(id));
    });
});

describe('personal FM withdraws the queue commands', () => {
    // 队列面板里的每个操作最终都会走普通 playSong 或改队列，而私人 FM 只在播放停留在 FM 路径上
    // 才活着——所以 FM 播放期间这些命令整体下线，而不是让用户操作完才发现掉出了电台。
    const QUEUE_COMMAND_IDS = ['queue', 'playback-shuffle', 'playback-clear-queue'];

    const availableIds = (isFmMode: boolean) => getAvailableCommandPaletteCommands(createContext({
        playback: { isFmMode, queue: [{ id: 1, name: 'Song' } as unknown as SongResult] },
    })).map(command => command.id);

    it('offers them while Personal FM is off', () => {
        const ids = availableIds(false);
        QUEUE_COMMAND_IDS.forEach(id => expect(ids).toContain(id));
    });

    it('withdraws them while Personal FM is on air', () => {
        const ids = availableIds(true);
        QUEUE_COMMAND_IDS.forEach(id => expect(ids).not.toContain(id));
    });

    it('keeps the FM mode picker and transport reachable', () => {
        const ids = availableIds(true);
        expect(ids).toContain('playback-fm-mode');
        expect(ids).toContain('playback-next');
    });
});

describe('theme generation source commands', () => {
    it('offers only the source that is not already active', () => {
        const aiContext = createContext({ settings: { themeGenerationSource: 'ai' } });
        const aiIds = getCommandPaletteMatches('theme source', aiContext).map(match => match.command.id);
        expect(aiIds).toContain('theme-source-cover');
        expect(aiIds).not.toContain('theme-source-ai');

        const coverContext = createContext({ settings: { themeGenerationSource: 'cover' } });
        const coverIds = getCommandPaletteMatches('theme source', coverContext).map(match => match.command.id);
        expect(coverIds).toContain('theme-source-ai');
        expect(coverIds).not.toContain('theme-source-cover');
    });

    it('switches the source when executed', () => {
        const context = createContext({ settings: { themeGenerationSource: 'ai' } });
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === 'theme-source-cover');

        expect(command?.execute('', context)).toBe(true);
        expect(context.settings.setThemeGenerationSource).toHaveBeenCalledWith('cover');
    });

    it('is findable by its Chinese name', () => {
        const ids = getCommandPaletteMatches('封面取色', createContext({ settings: { themeGenerationSource: 'ai' } }))
            .map(match => match.command.id);
        expect(ids).toContain('theme-source-cover');
    });
});

// The settings panel disables the performance switch when there is no stem model to run it. The
// command has to ask the same question: otherwise it can persist `transitionPerformance = true` in
// a state the panel refuses to produce, and the mode is silently on once a model does arrive.
describe('transition performance command', () => {
    const availableIds = (canUseTransitionPerformance: boolean) => (
        getAvailableCommandPaletteCommands(createContext({ settings: { canUseTransitionPerformance: () => canUseTransitionPerformance } }))
            .map(command => command.id)
    );

    it('is offered once a stem model can run', () => {
        expect(availableIds(true)).toContain('transition-performance-toggle');
    });

    it('is withdrawn while no stem model is installed', () => {
        expect(availableIds(false)).not.toContain('transition-performance-toggle');
    });

    it('stays out of the matches for a direct search', () => {
        const context = createContext({ settings: { canUseTransitionPerformance: () => false } });
        const ids = getCommandPaletteMatches('performance mode', context).map(match => match.command.id);
        expect(ids).not.toContain('transition-performance-toggle');
    });
});

// Both commands read one state and act on it, so what matters here is that each acts only on the
// state that calls for it. Which state they are handed is App's side of the contract: a blend must
// pass the DISPLAY transport, since the raw one goes IDLE for the length of an arm while the
// outgoing deck is still sounding - given the raw state, Play called toggle (which during a blend
// pauses) and Pause found no PLAYING to toggle, so both named the opposite of what they did.
describe('play and pause commands', () => {
    const execute = (id: string, playerState: PlayerState) => {
        const context = createContext({ shared: { playerState } });
        COMMAND_PALETTE_COMMANDS.find(entry => entry.id === id)!.execute('', context);
        return context.playback.togglePlay;
    };

    it('pauses audible playback and leaves Play alone', () => {
        expect(execute('playback-pause', PlayerState.PLAYING)).toHaveBeenCalled();
        expect(execute('playback-play', PlayerState.PLAYING)).not.toHaveBeenCalled();
    });

    it('starts paused playback and leaves Pause alone', () => {
        expect(execute('playback-play', PlayerState.PAUSED)).toHaveBeenCalled();
        expect(execute('playback-pause', PlayerState.PAUSED)).not.toHaveBeenCalled();
    });
});
