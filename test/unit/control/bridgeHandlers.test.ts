import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_EVENT_TYPES, CONTROL_TOOLS } from '../../../shared/controlCatalog.mjs';
import { CONTROL_BRIDGE_HANDLERS } from '../../../src/control/registry';
import { createControlBridge } from '../../../src/control/install';
import { ControlEventRing, subscribeControlStoreEvents } from '../../../src/control/events';
import { CONTROL_EVENT_TYPE_VALUES } from '../../../src/control/types';
import type { ControlAppInfo, ControlHostDeps } from '../../../src/control/types';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';
import { PlayerState } from '../../../src/types';
import type { LocalSong, SongResult } from '../../../src/types';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { useAudioSettingsStore } from '../../../src/stores/useAudioSettingsStore';
import { useLyricSettingsStore } from '../../../src/stores/useLyricSettingsStore';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { useSettingsModalStore } from '../../../src/stores/useSettingsModalStore';
import { useSleepTimerStore } from '../../../src/stores/useSleepTimerStore';
import { useThemeSettingsStore } from '../../../src/stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../../src/stores/useVisualizerSettingsStore';

// test/unit/control/bridgeHandlers.test.ts
// The renderer control bridge (control/PROTOCOL.md §2) tested without React or a browser:
// catalog/handler coverage, strict argument validation, error-code mapping, palette passthrough,
// state snapshots, settings, library and the event ring.

const TEST_APP: ControlAppInfo = {
    name: 'Folia',
    version: '9.9.9',
    platform: 'test',
    isElectron: false,
    installedAt: 1000,
};

const BRIDGE_TOOL_NAMES = (CONTROL_TOOLS as Array<{ name: string; executor: string }>)
    .filter(tool => tool.executor === 'bridge')
    .map(tool => tool.name)
    .sort();

type CommandPaletteContextOverrides = {
    [Namespace in keyof CommandPaletteContext]?: Partial<CommandPaletteContext[Namespace]>;
};

/** A complete stub context; the reference shape is the one command-palette tests use. */
const createContext = (overrides: CommandPaletteContextOverrides = {}): CommandPaletteContext => {
    const base: CommandPaletteContext = {
        scope: { view: 'player', filter: null, grid: null, directory: null, artist: null, chrome: null },
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
            stepVolume: vi.fn(),
            hasModEqualizerCurve: vi.fn(() => false),
            releaseModEqualizerCurve: vi.fn(),
            isHifiRoute: vi.fn(() => false),
            openHifiSignalPath: vi.fn(),
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
            queuePaletteKeepOpen: false,
            setQueuePaletteKeepOpen: vi.fn(),
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
            toggleCurrentSongPureMusicMark: vi.fn(async () => true),
            canToggleCurrentSongPureMusicMark: true,
        },
        navigation: {
            navigateToHome: vi.fn(),
            navigateToPlayer: vi.fn(),
            navigateToLattice: vi.fn(),
            locatePlayingSongOnWall: vi.fn(),
            locatePlayingSong: vi.fn(),
            selectHomeViewTab: vi.fn(),
            toggleBrowserFullscreen: vi.fn(async () => true),
            toggleRemoteControlWindow: vi.fn(async () => true),
            toggleMainWindowAlwaysOnTop: vi.fn(async () => true),
            isWallpaperMode: false,
            isWindowAlwaysOnTopSupported: true,
        },
        panel: {
            setPanelTab: vi.fn(),
            setIsPanelOpen: vi.fn(),
        },
        settings: {
            openSettings: vi.fn(),
            setAppLanguagePreference: vi.fn(async () => undefined),
            toggleTransparentBackground: vi.fn(),
            toggleDaylightMode: vi.fn(),
            toggleBottomSubtitleOverlay: vi.fn(),
            subtitleContentMode: 'translation',
            cycleSubtitleContentMode: vi.fn(),
            toggleSubtitleOverlayBackground: vi.fn(),
            playbackEntryView: 'player',
            setPlaybackEntryView: vi.fn(),
            librarySuiteOptions: vi.fn(() => []),
            activeLibrarySuite: vi.fn(() => 'grid'),
            canChooseLibrarySuite: vi.fn(() => false),
            chooseLibrarySuite: vi.fn(),
            isLibraryWallLookAvailable: vi.fn(() => false),
            libraryWallLook: vi.fn(() => 'partial' as const),
            setLibraryWallLook: vi.fn(),
            libraryWallWindowsPerBlock: vi.fn(() => 3),
            setLibraryWallWindowsPerBlock: vi.fn(),
            toggleLibraryWallStackEdges: vi.fn(),
            libraryWallSeamClear: vi.fn(() => false),
            toggleLibraryWallSeamClear: vi.fn(),
            libraryWallSeamStyle: vi.fn(() => 'paper' as const),
            setLibraryWallSeamStyle: vi.fn(),
            toggleLibraryWallBackdropLyrics: vi.fn(),
            toggleLibraryWallBackdropBlur: vi.fn(),
            ponderHintVisibility: 'always',
            setPonderHintVisibility: vi.fn(),
            togglePonderTouchButton: vi.fn(),
            toggleRememberHomeCardPosition: vi.fn(),
            startPlayerBottomBarPositioning: vi.fn(),
            canStartPlayerBottomBarPositioning: true,
            toggleAlwaysShowPlayerBackButton: vi.fn(),
            toggleGridViewFullBleedCover: vi.fn(),
            toggleGridViewSquareCards: vi.fn(),
            canUseGridViewSquareCards: vi.fn(() => true),
            toggleLatticeVignette: vi.fn(),
            toggleReduceLatticeMotion: vi.fn(),
            toggleFollowSystemReducedMotion: vi.fn(),
            toggleLatticeAutoFocusOnSongChange: vi.fn(),
            latticePosterTintEnabled: true,
            latticePosterTintUseCustomColor: false,
            latticePosterTintColor: '#161419',
            latticePosterTintIntensity: 0.5,
            setLatticePosterTintEnabled: vi.fn(),
            setLatticePosterTintUseCustomColor: vi.fn(),
            setLatticePosterTintColor: vi.fn(),
            setLatticePosterTintIntensity: vi.fn(),
            toggleAlwaysShowTrackSwitchButtons: vi.fn(),
            toggleAlwaysShowMainWindowTitlebar: vi.fn(),
            toggleHideFullscreenButton: vi.fn(),
            toggleNativeMacFullscreenButton: vi.fn(),
            toggleAutoHideCursorWithPlayerChrome: vi.fn(),
            toggleHideCursorWhenIdle: vi.fn(),
            toggleAutoPlayOnLaunch: vi.fn(),
            toggleTranscodeFallback: vi.fn(),
            togglePlaybackFade: vi.fn(),
            toggleAutoSkipUnplayable: vi.fn(),
            canAutoScanLocalLibrary: vi.fn(() => false),
            toggleLocalLibraryAutoScan: vi.fn(),
            canReportPlayback: vi.fn(() => false),
            togglePlaybackReport: vi.fn(),
            voiceInputPauseSupported: false,
            modSystemEnabled: false,
            toggleVoiceInputPause: vi.fn(),
            togglePreventDisplaySleepDuringPlayback: vi.fn(),
            toggleWallpaperMode: vi.fn(),
            toggleCloseToTray: vi.fn(),
            toggleHideRemoteControlTitlebar: vi.fn(),
            toggleRemoteControlExpandCover: vi.fn(),
            unlockRemoteControl: vi.fn(),
            toggleObsKeepMainWindowAnimation: vi.fn(),
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
            lyricStaffPolicy: 'smart',
            cycleLyricStaffPolicy: vi.fn(),
            lyricStaffAbsorbMode: 'off',
            cycleLyricStaffAbsorbMode: vi.fn(),
            automixEnabled: false,
            transitionMode: 'crossfade',
            transitionPerformance: false,
            toggleAutomix: vi.fn(),
            setTransitionMode: vi.fn(),
            toggleTransitionPerformance: vi.fn(),
            canUseTransitionPerformance: vi.fn(() => true),
            libraryWallSeamDirection: vi.fn(() => 'auto' as const),
            setLibraryWallSeamDirection: vi.fn(),
            toggleBackgroundThrottling: vi.fn(),
            toggleRemoteControlTextShade: vi.fn(),
            gpuPreference: vi.fn(() => 'auto' as const),
            setGpuPreference: vi.fn(),
            isHifiSupported: vi.fn(() => false),
            isHifiEnabled: vi.fn(() => false),
            isHifiVolumeConfirmed: vi.fn(() => false),
            setHifiEnabled: vi.fn(),
            toggleHifiExclusive: vi.fn(),
            toggleHifiNavidrome: vi.fn(),
            toggleHifiSoftwareVolume: vi.fn(),
            canRedetectHifiRuntime: vi.fn(() => false),
            redetectHifiRuntime: vi.fn(async () => null),
            canInstallHifiRuntime: vi.fn(() => false),
            installHifiRuntime: vi.fn(async () => null),
        },
        visualizer: {
            visualizerMode: 'classic',
            visualizerBackgroundMode: 'latent',
            setVisualizerMode: vi.fn(),
            toggleRandomVisualizerModePerSong: vi.fn(),
            toggleGlowBlurQuantize: vi.fn(),
            setVisualizerBackgroundMode: vi.fn(),
            setMonetBackgroundTuning: vi.fn(),
            setLatentBackgroundTuning: vi.fn(),
            toggleVideoLayer: vi.fn(),
            toggleSmartBeat: vi.fn(),
            setSmartBeatMode: vi.fn(),
            pickVideoLayerFile: vi.fn(async () => null),
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

const createLocalSong = (overrides: Partial<LocalSong> = {}): LocalSong => ({
    id: 'local-1',
    fileName: 'local-1.flac',
    filePath: '/music/local-1.flac',
    duration: 200_000,
    fileSize: 1024,
    mimeType: 'audio/flac',
    addedAt: 1,
    title: 'Local Test Song',
    titleOrigin: 'import',
    importedMetadata: {
        title: 'Local Test Song',
        titleSource: 'embedded',
        artistNames: ['Local Artist'],
        albumName: 'Local Album',
    },
    ...overrides,
});

const createSong = (overrides: Partial<SongResult> = {}): SongResult => ({
    id: 'song-1',
    name: 'Test Song',
    artists: [{ id: 1, name: 'Test Artist' }],
    album: { id: 1, name: 'Test Album' },
    durationMs: 180_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'song-1' },
    ...overrides,
});

const createDeps = (overrides: Partial<ControlHostDeps> = {}): ControlHostDeps => ({
    context: createContext(),
    localSongs: [],
    enqueue: vi.fn(),
    playLocalSong: vi.fn(async () => {}),
    ...overrides,
});

type BridgeOptions = {
    deps?: ControlHostDeps;
    events?: ControlEventRing;
};

let clock = 1000;
const now = () => {
    clock += 5;
    return clock;
};

const createBridge = ({ deps = createDeps(), events = new ControlEventRing() }: BridgeOptions = {}) => ({
    deps,
    events,
    bridge: createControlBridge({
        getHostDeps: () => deps,
        app: TEST_APP,
        events,
        now,
    }),
});

const resetStores = () => {
    usePlaybackStore.setState({
        currentSong: null,
        audioSrc: null,
        lyrics: null,
        duration: 0,
        playerState: PlayerState.IDLE,
        isLoadingToPlay: false,
        currentLineIndex: -1,
        playQueue: [],
        isFmMode: false,
        replayGainMode: 'off',
        lyricTimelineOffsetMs: 0,
        activePlaybackContext: 'main',
    });
    useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'off', queueAddBehavior: 'append' });
    useVisualizerSettingsStore.setState({
        visualizerMode: 'classic',
        visualizerBackgroundMode: 'latent',
        randomVisualizerModePerSong: false,
        glowBlurQuantize: false,
        smartBeat: { mode: 'off' as const, effects: {} },
    });
    useThemeSettingsStore.setState({
        isDaylight: false,
        followSystemTheme: false,
        useCoverColorBg: false,
        staticMode: false,
        disableHomeDynamicBackground: false,
    });
    useAppViewStore.setState({ view: 'home', isPanelOpen: false, panelTab: 'cover' });
    useSettingsModalStore.setState(state => ({
        settingsModalState: { ...state.settingsModalState, isOpen: false },
    }));
    useSleepTimerStore.setState({ sleepTimerEnabled: false, sleepTimerHours: 0, sleepTimerMinutes: 0, sleepTimerDeadlineMs: null });
    useLyricSettingsStore.setState({ globalLyricTimelineOffsetMs: 0 });
};

beforeEach(() => {
    clock = 1000;
    resetStores();
});

afterEach(() => {
    resetStores();
});

describe('control catalog coverage', () => {
    it('registers exactly one handler per bridge tool and none for main tools', () => {
        expect(Object.keys(CONTROL_BRIDGE_HANDLERS).sort()).toEqual(BRIDGE_TOOL_NAMES);
        expect(BRIDGE_TOOL_NAMES).toHaveLength(44);
        const mainTools = (CONTROL_TOOLS as Array<{ name: string; executor: string }>)
            .filter(tool => tool.executor === 'main')
            .map(tool => tool.name);
        expect(mainTools.sort()).toEqual(['folia_quit', 'folia_screenshot']);
        mainTools.forEach(name => expect(CONTROL_BRIDGE_HANDLERS).not.toHaveProperty(name));
        Object.values(CONTROL_BRIDGE_HANDLERS).forEach(handler => expect(typeof handler).toBe('function'));
    });

    it('keeps the TypeScript event-type union in sync with the catalog', () => {
        expect([...CONTROL_EVENT_TYPE_VALUES].sort()).toEqual([...(CONTROL_EVENT_TYPES as string[])].sort());
    });

    it('lists every catalog tool with the bridge availability flag', () => {
        const { bridge } = createBridge();
        const tools = bridge.list();
        expect(tools.map(tool => tool.name).sort()).toEqual(
            (CONTROL_TOOLS as Array<{ name: string; executor: string }>).map(tool => tool.name).sort(),
        );
        tools.forEach((tool) => {
            expect(tool.available).toBe(tool.executor === 'bridge');
        });
        expect(bridge.info()).toMatchObject({
            toolCount: 44,
            versions: { app: '9.9.9', catalog: 1 },
        });
    });

    it('reports a bridge-installed app through folia_status and folia_state', async () => {
        usePlaybackStore.setState({
            currentSong: createSong(),
            playQueue: [createSong()],
            playerState: PlayerState.PLAYING,
            duration: 180,
        });
        const { bridge } = createBridge();
        const status = await bridge.invoke('folia_status');
        expect(status.ok).toBe(true);
        if (status.ok) {
            const data = status.data as { app: { version: string }; window: { supported: boolean }; queueLength: number };
            expect(data.app.version).toBe('9.9.9');
            expect(data.window.supported).toBe(false);
            expect(data.queueLength).toBe(1);
        }

        const state = await bridge.invoke('folia_state', { includeQueue: true });
        expect(state.ok).toBe(true);
        if (state.ok) {
            const snapshot = state.data as {
                app: { controlVersion: number };
                playback: { state: string; song: { title: string } | null; currentQueueIndex: number };
                queue: { total: number; items: Array<{ index: number; song: { title: string } }> };
                view: { view: string };
            };
            expect(snapshot.app.controlVersion).toBe(1);
            expect(snapshot.playback.state).toBe('playing');
            expect(snapshot.playback.song?.title).toBe('Test Song');
            expect(snapshot.playback.currentQueueIndex).toBe(0);
            expect(snapshot.queue.total).toBe(1);
            expect(snapshot.queue.items[0]).toMatchObject({ index: 0, song: { title: 'Test Song' } });
        }
    });
});

describe('unified envelope', () => {
    it('returns ok:true with tool/data/durationMs/ts', async () => {
        const { bridge, deps } = createBridge();
        const result = await bridge.invoke('folia_navigate', { view: 'player' });
        expect(result).toMatchObject({ ok: true, tool: 'folia_navigate' });
        if (result.ok) {
            expect(result.data).toEqual({ view: 'player' });
            expect(result.durationMs).toBe(5);
            expect(typeof result.ts).toBe('number');
        }
        expect(deps.context.navigation.navigateToPlayer).toHaveBeenCalledTimes(1);
    });

    it('never throws and reports unknown tools', async () => {
        const { bridge } = createBridge();
        const result = await bridge.invoke('folia_not_a_tool');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.tool).toBe('folia_not_a_tool');
            expect(result.error.code).toBe('unknown_tool');
            expect(result.error.message).toContain('folia_not_a_tool');
        }
        await expect(bridge.invoke('folia_also_missing')).resolves.toMatchObject({ ok: false });
    });
});

describe('strict argument validation', () => {
    const expectBadRequest = async (tool: string, args?: Record<string, unknown>) => {
        const { bridge } = createBridge();
        const result = await bridge.invoke(tool, args);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('bad_request');
        }
        return result;
    };

    it('rejects missing required arguments', async () => {
        await expectBadRequest('folia_navigate');
        await expectBadRequest('folia_palette_run');
        await expectBadRequest('folia_queue_play');
        await expectBadRequest('folia_visual_tuning', { target: 'monet' });
    });

    it('rejects unknown arguments, wrong types, enums and ranges', async () => {
        await expectBadRequest('folia_volume', { loudness: 1 });
        await expectBadRequest('folia_volume', { level: 200 });
        await expectBadRequest('folia_volume', { level: 'loud' });
        await expectBadRequest('folia_queue_play', { index: 1.5 });
        await expectBadRequest('folia_queue', { limit: 0 });
        await expectBadRequest('folia_navigate', { view: 'nowhere' });
        await expectBadRequest('folia_palette_run', { id: 42 });
        await expectBadRequest('folia_events', { waitMs: 20_000 });
        await expectBadRequest('folia_state', [] as unknown as Record<string, unknown>);
    });
});

describe('error-code mapping', () => {
    it('maps no current song to no_song', async () => {
        const { bridge } = createBridge();
        const missingLocal = await bridge.invoke('folia_library', { action: 'play', id: 'missing' });
        expect(missingLocal.ok).toBe(false);
        if (!missingLocal.ok) {
            expect(missingLocal.error.code).toBe('no_song');
        }
        for (const tool of ['folia_like', 'folia_lyric_offset']) {
            const result = await bridge.invoke(tool, tool === 'folia_lyric_offset' ? { deltaMs: 100 } : {});
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('no_song');
            }
        }
    });

    it('maps semantic argument problems to bad_request', async () => {
        const { bridge } = createBridge();
        const cases: Array<[string, Record<string, unknown>]> = [
            ['folia_seek', {}],
            ['folia_seek', { seconds: 1, percent: 50 }],
            ['folia_queue_play', { index: 0 }],
            ['folia_queue_add', {}],
            ['folia_queue_move', { from: 0 }],
            ['folia_settings_write', { key: 'not.a.setting', value: 1 }],
            ['folia_visualizer_set', { mode: 'no-such-mode' }],
            ['folia_settings_read', { store: 'no-such-store' }],
        ];
        for (const [tool, args] of cases) {
            const result = await bridge.invoke(tool, args);
            expect(result.ok, tool).toBe(false);
            if (!result.ok) {
                expect(result.error.code, tool).toBe('bad_request');
            }
        }
    });

    it('maps missing desktop capabilities to unsupported', async () => {
        const { bridge } = createBridge();
        const result = await bridge.invoke('folia_window', { action: 'minimize' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('unsupported');
        }
        const status = await bridge.invoke('folia_window', { action: 'status' });
        expect(status.ok).toBe(true);
        if (status.ok) {
            expect((status.data as { supported: boolean }).supported).toBe(false);
        }
    });
});

describe('palette passthrough', () => {
    it('lists available commands from the live registry', async () => {
        const { bridge } = createBridge();
        const result = await bridge.invoke('folia_palette_list', {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const data = result.data as { commands: Array<{ id: string; available: boolean }>; total: number };
        expect(data.total).toBeGreaterThan(50);
        expect(data.commands.every(command => command.available)).toBe(true);
        expect(data.commands.some(command => command.id === 'playback-next')).toBe(true);
        expect(data.commands.some(command => command.id === 'navigate-home')).toBe(true);
    });

    it('runs a command with command.execute and records palette.executed', async () => {
        const events = new ControlEventRing();
        const { bridge, deps } = createBridge({ events });
        const result = await bridge.invoke('folia_palette_run', { id: 'playback-next' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toMatchObject({ ok: true, id: 'playback-next' });
        }
        expect(deps.context.playback.next).toHaveBeenCalledTimes(1);
        const page = await events.read({ since: 0 });
        expect(page.events.map(event => event.type)).toContain('palette.executed');
        expect(page.events[page.events.length - 1]!.data).toMatchObject({ id: 'playback-next' });
    });

    it('passes the input through to the command and maps refusals', async () => {
        const { bridge, deps } = createBridge();
        await expect(bridge.invoke('folia_palette_run', { id: 'no-such-command' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'bad_request' },
        });
        // `playback-like` is unavailable while no song is current.
        await expect(bridge.invoke('folia_palette_run', { id: 'playback-like' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'unavailable' },
        });
        expect(deps.context.playback.toggleSongLike).not.toHaveBeenCalled();

        const settingsContext = createContext({ scope: { view: 'player' } });
        const settingsDeps = createDeps({ context: settingsContext });
        const { bridge: settingsBridge } = createBridge({ deps: settingsDeps });
        const result = await settingsBridge.invoke('folia_palette_run', { id: 'settings-toggle-daylight' });
        expect(result.ok).toBe(true);
        expect(settingsContext.settings.toggleDaylightMode).toHaveBeenCalledTimes(1);
    });
});

describe('settings and library handlers', () => {
    it('writes whitelisted settings through store actions and reads them back', async () => {
        const { bridge } = createBridge();
        await expect(bridge.invoke('folia_settings_write', { key: 'audio.volume', value: 35 })).resolves.toMatchObject({
            ok: true,
            data: { value: 0.35, written: true },
        });
        await expect(bridge.invoke('folia_settings_write', { key: 'theme.staticMode', value: true })).resolves.toMatchObject({
            ok: true,
        });
        await expect(bridge.invoke('folia_settings_write', { key: 'visualizer.mode', value: 'fume' })).resolves.toMatchObject({
            ok: true,
        });
        const read = await bridge.invoke('folia_settings_read', { store: 'audio', key: 'volume' });
        expect(read.ok).toBe(true);
        if (read.ok) {
            expect(read.data).toMatchObject({ store: 'audio', key: 'volume', value: 0.35 });
        }
        const theme = await bridge.invoke('folia_settings_read', { store: 'theme' });
        expect(theme.ok).toBe(true);
        if (theme.ok) {
            expect((theme.data as { settings: { staticMode: boolean } }).settings.staticMode).toBe(true);
        }
        await expect(bridge.invoke('folia_settings_write', { key: 'audio.muted', value: 'yes' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'bad_request' },
        });
    });

    it('opens the settings dialog with validated subviews and anchors', async () => {
        const { bridge } = createBridge();
        await expect(bridge.invoke('folia_settings_open', { subview: 'appearance' })).resolves.toMatchObject({
            ok: true,
            data: { open: true, tab: 'options', subview: 'appearance' },
        });
        await expect(bridge.invoke('folia_settings_open', { subview: 'nope' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'bad_request' },
        });
        await expect(bridge.invoke('folia_settings_open', { anchor: 'nope' })).resolves.toMatchObject({
            ok: false,
            error: { code: 'bad_request' },
        });
    });

    it('lists, searches and plays local library songs', async () => {
        const localSong = createLocalSong();
        const deps = createDeps({ localSongs: [localSong] });
        const { bridge } = createBridge({ deps });

        const list = await bridge.invoke('folia_library', { action: 'list' });
        expect(list.ok).toBe(true);
        if (list.ok) {
            expect(list.data).toMatchObject({
                total: 1,
                items: [{ index: 0, title: 'Local Test Song', artist: 'Local Artist', isLocal: true }],
            });
        }

        const search = await bridge.invoke('folia_library', { action: 'search', query: 'local artist' });
        expect(search.ok).toBe(true);
        if (search.ok) {
            expect((search.data as { total: number }).total).toBe(1);
        }

        const play = await bridge.invoke('folia_library', { action: 'play', id: 'local-1' });
        expect(play.ok).toBe(true);
        expect(deps.playLocalSong).toHaveBeenCalledWith(localSong);
    });
});

describe('visualizer, appearance and navigation handlers', () => {
    it('lists visualizers/backgrounds and validates mode ids', async () => {
        const { bridge, deps } = createBridge();
        const list = await bridge.invoke('folia_visualizer_list');
        expect(list.ok).toBe(true);
        if (list.ok) {
            const data = list.data as { visualizers: Array<{ mode: string }>; backgrounds: Array<{ mode: string }> };
            expect(data.visualizers.map(entry => entry.mode)).toContain('fume');
            expect(data.backgrounds.map(entry => entry.mode)).toContain('latent');
        }
        const set = await bridge.invoke('folia_visualizer_set', { mode: 'fume' });
        expect(set.ok).toBe(true);
        expect(deps.context.visualizer.setVisualizerMode).toHaveBeenCalledWith('fume');
        const background = await bridge.invoke('folia_background_set', { mode: 'sora' });
        expect(background.ok).toBe(true);
        expect(deps.context.visualizer.setVisualizerBackgroundMode).toHaveBeenCalledWith('sora');
    });

    it('patches tuning, smart beat and appearance', async () => {
        const { bridge, deps } = createBridge();
        await expect(bridge.invoke('folia_visual_tuning', {
            target: 'monet',
            patch: { backgroundLayout: 'full-overlay' },
        })).resolves.toMatchObject({ ok: true });
        expect(deps.context.visualizer.setMonetBackgroundTuning).toHaveBeenCalledWith({
            backgroundLayout: 'full-overlay',
        });

        const smartBeat = await bridge.invoke('folia_smart_beat', { enabled: true });
        expect(smartBeat.ok).toBe(true);
        if (smartBeat.ok) {
            expect((smartBeat.data as { enabled: boolean }).enabled).toBe(true);
        }

        const appearance = await bridge.invoke('folia_appearance', { daylight: true });
        expect(appearance.ok).toBe(true);
        if (appearance.ok) {
            expect((appearance.data as { daylight: boolean }).daylight).toBe(true);
        }
    });

    it('navigates views and drives the panel', async () => {
        const { bridge, deps } = createBridge();
        await expect(bridge.invoke('folia_navigate', { view: 'lattice' })).resolves.toMatchObject({ ok: true });
        expect(deps.context.navigation.navigateToLattice).toHaveBeenCalledTimes(1);

        await expect(bridge.invoke('folia_panel', { tab: 'queue', open: true })).resolves.toMatchObject({
            ok: true,
            data: { open: true, tab: 'queue' },
        });
        expect(deps.context.panel.setPanelTab).toHaveBeenCalledWith('queue');
        expect(deps.context.panel.setIsPanelOpen).toHaveBeenCalledWith(true);
    });
});

describe('event stream', () => {
    it('starts at the current cursor and pages forward', async () => {
        const events = new ControlEventRing();
        const { bridge } = createBridge({ events });
        events.record('view.changed', { view: 'home' });
        const empty = await bridge.events();
        expect(empty.events).toEqual([]);
        expect(empty.cursor).toBe(1);

        const page = await bridge.events({ since: 0 });
        expect(page.events.map(event => event.seq)).toEqual([1]);
        expect(page.cursor).toBe(1);

        const result = await bridge.invoke('folia_events', { since: 0, limit: 10 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect((result.data as { cursor: number }).cursor).toBe(1);
        }
    });

    it('keeps a 500-entry ring and long-polls without events', async () => {
        const ring = new ControlEventRing(500);
        for (let index = 1; index <= 510; index += 1) {
            ring.record('view.changed', { index });
        }
        expect(ring.currentSeq()).toBe(510);
        const page = await ring.read({ since: 0, limit: 200 });
        expect(page.events).toHaveLength(200);
        expect(page.events[0]!.seq).toBe(11);

        const small = new ControlEventRing(3);
        small.record('view.changed', { index: 1 });
        small.record('view.changed', { index: 2 });
        small.record('view.changed', { index: 3 });
        small.record('view.changed', { index: 4 });
        const retained = await small.read({ since: 0, limit: 10 });
        expect(retained.events.map(event => event.seq)).toEqual([2, 3, 4]);

        const startedAt = Date.now();
        const waited = await small.read({ since: 4, waitMs: 20 });
        expect(waited.events).toEqual([]);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
    });

    it('records catalog event types from the app stores', async () => {
        const ring = new ControlEventRing();
        const unsubscribe = subscribeControlStoreEvents(ring);

        usePlaybackStore.getState().setCurrentSong(createSong());
        usePlaybackStore.getState().setPlayerState(PlayerState.PLAYING);
        usePlaybackStore.getState().setPlayQueue([createSong()]);
        useAudioSettingsStore.getState().handleSetVolume(0.42);
        useAudioSettingsStore.getState().handleSetMuted(true);
        useAudioSettingsStore.getState().handleSetLoopMode('all');
        useVisualizerSettingsStore.getState().handleSetVisualizerMode('fume', { notify: false });
        useVisualizerSettingsStore.getState().handleSetVisualizerBackgroundMode('sora');
        useThemeSettingsStore.getState().setDaylightPreference(true);
        useAppViewStore.getState().setIsPanelOpen(true);

        unsubscribe();

        const page = await ring.read({ since: 0, limit: 200 });
        const types = new Set(page.events.map(event => event.type));
        const catalogTypes = new Set(CONTROL_EVENT_TYPES as string[]);
        page.events.forEach(event => expect(catalogTypes.has(event.type)).toBe(true));
        expect([...types].sort()).toEqual([
            'playback.loopModeChanged',
            'playback.queueChanged',
            'playback.songChanged',
            'playback.stateChanged',
            'playback.volumeChanged',
            'theme.changed',
            'view.changed',
            'visualizer.backgroundChanged',
            'visualizer.modeChanged',
        ]);
    });
});
