import { useMemo } from 'react';
import type React from 'react';
import type { MotionValue } from 'framer-motion';
import type SettingsModal from '../../modal/SettingsModal';
import type {
    DualTheme,
    LyricData,
    NowPlayingConnectionStatus,
    ReplayGainMode,
    StageSource,
    StageStatus,
} from '../../../types';
import type { useThemeController } from '../../../hooks/useThemeController';
import { type SettingsModalState, useSettingsModalStore } from '../../../stores/useSettingsModalStore';
import type { ObsBrowserSourceStatus } from '../../../types/obsBrowserSource';
import type { PlayerCapConnectionStatus } from '../../../types/playerCap';
import type { LyricApiStatus } from '../../../types/lyricApi';
import type { NowPlayingSenderStatus } from '../../../types/nowPlayingSender';
import { useStageSettingsStore } from '../../../stores/useStageSettingsStore';
import { closeSettings } from '../../../stores/useSettingsModalStore';

// src/components/app/dialogs/buildSettingsDialogModel.ts

type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;
type ThemeController = ReturnType<typeof useThemeController>;

// What this file can read for itself, so the caller never names it. See useSettingsDialogModel.
type SettingsDialogAmbient = {
    state: SettingsModalState;
    currentSongTitle?: string | null;
    currentLyrics: LyricData | null;
    lyricCurrentTime: MotionValue<number>;
    activePlaybackContext: 'main' | 'stage';
    replayGainMode: ReplayGainMode;
};

export type SettingsDialogDeps = {
    themeController: ThemeController;
    themeParkInitialTheme: DualTheme;
    onToggleNavidrome?: (enabled: boolean) => void;
    loadLyricFilterPreview: () => Promise<LyricData | null>;
    onSaveLyricFilterPattern: SettingsDialogProps['onSaveLyricFilterPattern'];
    stageStatus?: StageStatus | null;
    stageSource?: StageSource | null;
    setStageStatus: React.Dispatch<React.SetStateAction<any>>;
    leaveStagePlayback: () => void;
    clearStagePlaybackSession: () => void;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadStageSessionIntoPlayback: (session: any) => Promise<void>;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    playerCapConnectionStatus?: PlayerCapConnectionStatus;
    playerCapPlayers?: string[];
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    onReplayGainModeChange: (mode: ReplayGainMode) => void;
    onToggleTransparentPlayerBackground: (enabled: boolean) => Promise<void> | void;
    obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
    refreshObsBrowserSourceStatus?: () => Promise<ObsBrowserSourceStatus>;
    lyricApiStatus?: LyricApiStatus | null;
    setLyricApiEnabled?: (enabled: boolean) => Promise<LyricApiStatus>;
    nowPlayingSenderStatus?: NowPlayingSenderStatus | null;
    setNowPlayingSenderEnabled?: (enabled: boolean) => Promise<NowPlayingSenderStatus>;
    setNowPlayingSenderProgressIntervalSec?: (intervalSec: number) => Promise<NowPlayingSenderStatus>;
};

type BuildSettingsDialogModelParams = SettingsDialogAmbient & SettingsDialogDeps;

// Builds the global settings dialog props without tying the modal to Home.
export const buildSettingsDialogModel = ({
    state,
    themeController,
    themeParkInitialTheme,
    onToggleNavidrome,
    currentSongTitle,
    loadLyricFilterPreview,
    onSaveLyricFilterPattern,
    currentLyrics,
    lyricCurrentTime,
    stageStatus,
    stageSource,
    activePlaybackContext,
    setStageStatus,
    leaveStagePlayback,
    clearStagePlaybackSession,
    clearPersistedStagePlaybackCache,
    loadStageSessionIntoPlayback,
    nowPlayingConnectionStatus,
    playerCapConnectionStatus,
    playerCapPlayers,
    onAudioOutputDeviceChange,
    replayGainMode,
    onReplayGainModeChange,
    onToggleTransparentPlayerBackground,
    obsBrowserSourceStatus,
    refreshObsBrowserSourceStatus,
    lyricApiStatus,
    setLyricApiEnabled,
    nowPlayingSenderStatus,
    setNowPlayingSenderEnabled,
    setNowPlayingSenderProgressIntervalSec,
}: BuildSettingsDialogModelParams): SettingsDialogProps | null => {
    if (!state.isOpen) {
        return null;
    }

    return {
        theme: themeController.theme,
        bgMode: themeController.bgMode,
        onApplyDefaultTheme: themeController.applyDefaultTheme,
        hasCustomTheme: themeController.hasCustomTheme,
        themeParkInitialTheme,
        isCustomThemePreferred: themeController.isCustomThemePreferred,
        songThemeAutoSwitchEnabled: themeController.songThemeAutoSwitchEnabled,
        songThemeAutoGenerateEnabled: themeController.songThemeAutoGenerateEnabled,
        onSaveCustomTheme: themeController.saveCustomDualTheme,
        onSaveAiTheme: themeController.saveEditedAiDualTheme,
        onApplyCustomTheme: themeController.applyCustomTheme,
        onToggleCustomThemePreferred: themeController.handleCustomThemePreferenceChange,
        onToggleSongThemeAutoSwitch: themeController.handleSongThemeAutoSwitchChange,
        onToggleSongThemeAutoGenerate: themeController.handleSongThemeAutoGenerateChange,
        themeGenerationSource: themeController.themeGenerationSource,
        onChangeThemeGenerationSource: themeController.handleThemeGenerationSourceChange,
        onToggleNavidrome,
        currentSongTitle,
        loadLyricFilterPreview,
        onSaveLyricFilterPattern,
        currentLyrics,
        lyricCurrentTime,
        stageStatus,
        stageSource,
        nowPlayingConnectionStatus,
        playerCapConnectionStatus,
        playerCapPlayers,
        obsBrowserSourceStatus,
        lyricApiStatus,
        onToggleLyricApi: setLyricApiEnabled
            ? async (enabled) => {
                await setLyricApiEnabled(enabled);
            }
            : undefined,
        nowPlayingSenderStatus,
        onToggleNowPlayingSender: setNowPlayingSenderEnabled
            ? async (enabled) => {
                await setNowPlayingSenderEnabled(enabled);
            }
            : undefined,
        onChangeNowPlayingSenderProgressInterval: setNowPlayingSenderProgressIntervalSec
            ? async (intervalSec) => {
                await setNowPlayingSenderProgressIntervalSec(intervalSec);
            }
            : undefined,
        onToggleObsBrowserSource: async (enabled) => {
            const nextStatus = await window.electron?.setObsBrowserSourceEnabled?.(enabled);
            if (!nextStatus) {
                await refreshObsBrowserSourceStatus?.();
            }
        },
        onRegenerateObsBrowserSourceToken: async () => {
            const nextStatus = await window.electron?.regenerateObsBrowserSourceToken?.();
            if (!nextStatus) {
                await refreshObsBrowserSourceStatus?.();
            }
        },
        onAudioOutputDeviceChange,
        replayGainMode,
        onReplayGainModeChange,
        onToggleTransparentPlayerBackground,
        initialTab: state.initialTab,
        initialSubview: state.initialSubview ?? null,
        initialVisualizerSection: state.initialVisualizerSection ?? null,
        initialAnchor: state.initialAnchor ?? null,
        onClose: closeSettings,
        onToggleStageMode: async (enabled) => {
            try {
                const nextStatus = await window.electron?.setStageEnabled(enabled);
                if (nextStatus) {
                    setStageStatus(nextStatus);
                    if (!enabled && activePlaybackContext === 'stage') {
                        leaveStagePlayback();
                    }
                    if (!enabled) {
                        clearStagePlaybackSession();
                        await clearPersistedStagePlaybackCache();
                    }
                }
            } catch (error) {
                console.error('[buildSettingsDialogModel] Failed to toggle stage mode:', error);
            }
        },
        onStageSourceChange: async (source) => {
            await window.electron?.saveSettings?.('STAGE_MODE_SOURCE', source);
        },
        onRegenerateStageToken: async () => {
            const nextStatus = await window.electron?.regenerateStageToken();
            if (nextStatus) {
                setStageStatus(nextStatus);
                if (activePlaybackContext === 'stage') {
                    await loadStageSessionIntoPlayback(null);
                }
            }
        },
        onClearStageState: async () => {
            const nextStatus = await window.electron?.clearStageState();
            if (nextStatus) {
                setStageStatus(nextStatus);
                if (activePlaybackContext === 'stage') {
                    await loadStageSessionIntoPlayback(null);
                }
            }
        },
        onToggleNowPlayingStage: async (enabled) => {
            useStageSettingsStore.getState().handleToggleNowPlayingStage(enabled);
            if (!enabled && activePlaybackContext === 'stage') {
                leaveStagePlayback();
            }
        },
        aiTheme: themeController.aiTheme,
        customTheme: themeController.customTheme,
    };
};
