import type React from 'react';
import type SettingsModal from '../../modal/SettingsModal';
import type {
    DualTheme,
    LyricData,
    NowPlayingConnectionStatus,
    StageSource,
    StageStatus,
} from '../../../types';
import type { useThemeController } from '../../../hooks/useThemeController';
import { type SettingsModalState, useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import type { ObsBrowserSourceStatus } from '../../../types/obsBrowserSource';

// src/components/app/dialogs/buildSettingsDialogModel.ts

type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;
type ThemeController = ReturnType<typeof useThemeController>;

type BuildSettingsDialogModelParams = {
    state: SettingsModalState;
    onClose: () => void;
    themeController: ThemeController;
    themeParkInitialTheme: DualTheme;
    onToggleNavidrome?: (enabled: boolean) => void;
    currentSongTitle?: string | null;
    loadLyricFilterPreview: () => Promise<LyricData | null>;
    onSaveLyricFilterPattern: (pattern: string) => Promise<void> | void;
    stageStatus?: StageStatus | null;
    stageSource?: StageSource | null;
    activePlaybackContext: 'main' | 'stage';
    setStageStatus: React.Dispatch<React.SetStateAction<any>>;
    leaveStagePlayback: () => void;
    clearStagePlaybackSession: () => void;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadStageSessionIntoPlayback: (session: any) => Promise<void>;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    onToggleTransparentPlayerBackground: (enabled: boolean) => Promise<void> | void;
    obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
    refreshObsBrowserSourceStatus?: () => Promise<ObsBrowserSourceStatus>;
};

// Builds the global settings dialog props without tying the modal to Home.
export const buildSettingsDialogModel = ({
    state,
    onClose,
    themeController,
    themeParkInitialTheme,
    onToggleNavidrome,
    currentSongTitle,
    loadLyricFilterPreview,
    onSaveLyricFilterPattern,
    stageStatus,
    stageSource,
    activePlaybackContext,
    setStageStatus,
    leaveStagePlayback,
    clearStagePlaybackSession,
    clearPersistedStagePlaybackCache,
    loadStageSessionIntoPlayback,
    nowPlayingConnectionStatus,
    onAudioOutputDeviceChange,
    onToggleTransparentPlayerBackground,
    obsBrowserSourceStatus,
    refreshObsBrowserSourceStatus,
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
        onApplyCustomTheme: themeController.applyCustomTheme,
        onToggleCustomThemePreferred: themeController.handleCustomThemePreferenceChange,
        onToggleSongThemeAutoSwitch: themeController.handleSongThemeAutoSwitchChange,
        onToggleSongThemeAutoGenerate: themeController.handleSongThemeAutoGenerateChange,
        onToggleNavidrome,
        currentSongTitle,
        loadLyricFilterPreview,
        onSaveLyricFilterPattern,
        stageStatus,
        stageSource,
        nowPlayingConnectionStatus,
        obsBrowserSourceStatus,
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
        onToggleTransparentPlayerBackground,
        initialTab: state.initialTab,
        initialSubview: state.initialSubview ?? null,
        onClose,
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
            useSettingsUiStore.getState().handleToggleNowPlayingStage(enabled);
            if (!enabled && activePlaybackContext === 'stage') {
                leaveStagePlayback();
            }
        },
        aiTheme: themeController.aiTheme,
        customTheme: themeController.customTheme,
    };
};
