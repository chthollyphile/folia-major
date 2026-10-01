import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildSettingsDialogModel } from '../../../src/components/app/dialogs/buildSettingsDialogModel';
import type { NowPlayingSenderStatus } from '../../../src/types/nowPlayingSender';

// test/unit/settings/settingsDialogNowPlayingSender.test.ts
// Regression: useNowPlayingSenderPublisher's status/toggle lived in App.tsx but was never
// threaded through the settings dialog deps, so the "连接与集成 → Now Playing 发送" switch
// silently rendered nothing. These assertions pin the pass-through.

const status: NowPlayingSenderStatus = {
    enabled: true,
    running: true,
    port: 9863,
    url: 'http://127.0.0.1:9863/api/query',
    wsUrl: 'ws://127.0.0.1:9863/api/ws/lyric',
    clientCount: 0,
    progressIntervalSec: 0.5,
    error: null,
};

const build = (deps: Record<string, unknown>) => buildSettingsDialogModel({
    state: { isOpen: true } as never,
    themeController: {
        theme: null,
        bgMode: 'static',
        applyDefaultTheme: vi.fn(),
        hasCustomTheme: false,
        isCustomThemePreferred: false,
        songThemeAutoSwitchEnabled: false,
        songThemeAutoGenerateEnabled: false,
        saveCustomDualTheme: vi.fn(),
        saveEditedAiDualTheme: vi.fn(),
        applyCustomTheme: vi.fn(),
        handleCustomThemePreferenceChange: vi.fn(),
        handleSongThemeAutoSwitchChange: vi.fn(),
        handleSongThemeAutoGenerateChange: vi.fn(),
        themeGenerationSource: 'lyrics',
        handleThemeGenerationSourceChange: vi.fn(),
    } as never,
    themeParkInitialTheme: null as never,
    loadLyricFilterPreview: vi.fn(),
    onSaveLyricFilterPattern: vi.fn(),
    currentLyrics: null,
    lyricCurrentTime: { get: () => 0 } as never,
    activePlaybackContext: 'main',
    replayGainMode: 'off',
    setStageStatus: vi.fn(),
    leaveStagePlayback: vi.fn(),
    clearStagePlaybackSession: vi.fn(),
    clearPersistedStagePlaybackCache: vi.fn(),
    loadStageSessionIntoPlayback: vi.fn(),
    onAudioOutputDeviceChange: vi.fn(),
    onReplayGainModeChange: vi.fn(),
    onToggleTransparentPlayerBackground: vi.fn(),
    ...deps,
});

describe('settings dialog Now Playing sender wiring', () => {
    it('forwards the sender status so the integration panel can render the switch', () => {
        const model = build({ nowPlayingSenderStatus: status });

        expect(model?.nowPlayingSenderStatus).toEqual(status);
    });

    it('forwards the enable toggle', async () => {
        const setEnabled = vi.fn(async () => status);

        const model = build({
            nowPlayingSenderStatus: status,
            setNowPlayingSenderEnabled: setEnabled,
        });

        await model?.onToggleNowPlayingSender?.(false);

        expect(setEnabled).toHaveBeenCalledWith(false);
    });

    it('leaves the callback undefined when the hook is absent (web build)', () => {
        const model = build({});

        expect(model?.onToggleNowPlayingSender).toBeUndefined();
    });

    it('forwards the heartbeat interval setter', async () => {
        const setIntervalSec = vi.fn(async () => ({ ...status, progressIntervalSec: 0 }));

        const model = build({
            nowPlayingSenderStatus: status,
            setNowPlayingSenderProgressIntervalSec: setIntervalSec,
        });

        await model?.onChangeNowPlayingSenderProgressInterval?.(0);

        expect(setIntervalSec).toHaveBeenCalledWith(0);
    });

    it('leaves the interval setter undefined without the hook', () => {
        const model = build({ nowPlayingSenderStatus: status });

        expect(model?.onChangeNowPlayingSenderProgressInterval).toBeUndefined();
    });
});

// The heartbeat dial is a functional setting, so it needs both a control in the card and a
// command-palette entry, and the command must not silently pick up the settings-panel capability
// detection a second time.
describe('Now Playing sender heartbeat control', () => {
    const read = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

    it('renders a one-decimal slider in the sender card, wired to the setter', () => {
        const card = read('../../../src/components/modal/settings/NowPlayingSenderCard.tsx');

        expect(card).toContain("step={0.1}");
        expect(card).toContain('NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC');
        expect(card).toContain('NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC');
        expect(card).toContain('onChangeProgressIntervalSec');
        // `0` is a distinct state, not just the bottom of the range.
        expect(card).toContain('nowPlayingSenderProgressIntervalOff');
    });

    it('passes the callback down through the integration subview', () => {
        const subview = read('../../../src/components/modal/settings/IntegrationSettingsSubview.tsx');

        expect(subview).toContain('onChangeProgressIntervalSec={nowPlayingSender.onChangeProgressIntervalSec}');
    });

    it('registers a command-palette entry for the interval', () => {
        const commands = read('../../../src/components/command-palette/commands/settingsCommands.ts');

        expect(commands).toContain("id: 'desktop-cycle-now-playing-sender-interval'");
        expect(commands).toContain("platform: ['electron']");
        expect(commands).toContain('setNowPlayingSenderProgressInterval');
    });
});
