import type React from 'react';
import type SettingsModal from '../../modal/SettingsModal';
import type {
    DualTheme,
    LyricData,
    StageSource,
    StageStatus,
} from '../../../types';
import type { useAppPreferences } from '../../../hooks/useAppPreferences';
import type { useThemeController } from '../../../hooks/useThemeController';

// src/components/app/dialogs/buildSettingsDialogModel.ts

type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;
type AppPreferences = ReturnType<typeof useAppPreferences>;
type ThemeController = ReturnType<typeof useThemeController>;

export type SettingsModalState = {
    isOpen: boolean;
    initialTab: NonNullable<SettingsDialogProps['initialTab']>;
};

type BuildSettingsDialogModelParams = {
    state: SettingsModalState;
    onClose: () => void;
    preferences: AppPreferences;
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
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
};

// Builds the global settings dialog props without tying the modal to Home.
export const buildSettingsDialogModel = ({
    state,
    onClose,
    preferences,
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
    onAudioOutputDeviceChange,
}: BuildSettingsDialogModelParams): SettingsDialogProps | null => {
    if (!state.isOpen) {
        return null;
    }

    return {
        staticMode: preferences.staticMode,
        disableHomeDynamicBackground: preferences.disableHomeDynamicBackground,
        hidePlayerProgressBar: preferences.hidePlayerProgressBar,
        hidePlayerTranslationSubtitle: preferences.hidePlayerTranslationSubtitle,
        hidePlayerRightPanelButton: preferences.hidePlayerRightPanelButton,
        transparentPlayerBackground: preferences.transparentPlayerBackground,
        disableVisualizerVignette: preferences.disableVisualizerVignette,
        disableVisualizerGeometricBackground: preferences.disableVisualizerGeometricBackground,
        minimizeToTray: preferences.minimizeToTray,
        hideTaskbarIcon: preferences.hideTaskbarIcon,
        openPlayerOnLaunch: preferences.openPlayerOnLaunch,
        onToggleStaticMode: preferences.handleToggleStaticMode,
        onToggleDisableHomeDynamicBackground: preferences.handleToggleDisableHomeDynamicBackground,
        onToggleHidePlayerProgressBar: preferences.handleToggleHidePlayerProgressBar,
        onToggleHidePlayerTranslationSubtitle: preferences.handleToggleHidePlayerTranslationSubtitle,
        onToggleHidePlayerRightPanelButton: preferences.handleToggleHidePlayerRightPanelButton,
        onToggleTransparentPlayerBackground: preferences.handleToggleTransparentPlayerBackground,
        onToggleDisableVisualizerVignette: preferences.handleToggleDisableVisualizerVignette,
        onToggleDisableVisualizerGeometricBackground: preferences.handleToggleDisableVisualizerGeometricBackground,
        onToggleMinimizeToTray: preferences.handleToggleMinimizeToTray,
        onToggleHideTaskbarIcon: preferences.handleToggleHideTaskbarIcon,
        onToggleOpenPlayerOnLaunch: preferences.handleToggleOpenPlayerOnLaunch,
        enableMediaCache: preferences.enableMediaCache,
        onToggleMediaCache: preferences.handleToggleMediaCache,
        theme: themeController.theme,
        backgroundOpacity: preferences.backgroundOpacity,
        setBackgroundOpacity: preferences.handleSetBackgroundOpacity,
        bgMode: themeController.bgMode,
        onApplyDefaultTheme: themeController.applyDefaultTheme,
        hasCustomTheme: themeController.hasCustomTheme,
        themeParkInitialTheme,
        isCustomThemePreferred: themeController.isCustomThemePreferred,
        songThemeAutoSwitchEnabled: themeController.songThemeAutoSwitchEnabled,
        onSaveCustomTheme: themeController.saveCustomDualTheme,
        onApplyCustomTheme: themeController.applyCustomTheme,
        onToggleCustomThemePreferred: themeController.handleCustomThemePreferenceChange,
        onToggleSongThemeAutoSwitch: themeController.handleSongThemeAutoSwitchChange,
        isDaylight: preferences.isDaylight,
        onToggleNavidrome,
        visualizerMode: preferences.visualizerMode,
        cadenzaTuning: preferences.cadenzaTuning,
        partitaTuning: preferences.partitaTuning,
        fumeTuning: preferences.fumeTuning,
        cappellaTuning: preferences.cappellaTuning,
        tiltTuning: preferences.tiltTuning,
        cappellaCustomEmojiImages: preferences.cappellaCustomEmojiImages,
        onVisualizerModeChange: preferences.handleSetVisualizerMode,
        onPartitaTuningChange: preferences.handleSetPartitaTuning,
        onResetPartitaTuning: preferences.handleResetPartitaTuning,
        onFumeTuningChange: preferences.handleSetFumeTuning,
        onResetFumeTuning: preferences.handleResetFumeTuning,
        onCappellaTuningChange: preferences.handleSetCappellaTuning,
        onResetCappellaTuning: preferences.handleResetCappellaTuning,
        onTiltTuningChange: preferences.handleSetTiltTuning,
        onResetTiltTuning: preferences.handleResetTiltTuning,
        onImportCappellaCustomEmojiPack: preferences.handleImportCustomCappellaEmojiPack,
        onClearCappellaCustomEmojiPack: preferences.handleClearCustomCappellaEmojiPack,
        isLoadingCappellaCustomEmojiPack: preferences.isLoadingCappellaCustomEmojiPack,
        lyricsFontStyle: preferences.lyricsFontStyle,
        lyricsFontScale: preferences.lyricsFontScale,
        lyricsCustomFontFamily: preferences.lyricsCustomFontFamily,
        lyricsCustomFontLabel: preferences.lyricsCustomFontLabel,
        lyricFilterPattern: preferences.lyricFilterPattern,
        currentSongTitle,
        showOpenPanelCloseButton: preferences.showOpenPanelCloseButton,
        onLyricsFontStyleChange: preferences.handleSetLyricsFontStyle,
        onLyricsFontScaleChange: preferences.handleSetLyricsFontScale,
        onLyricsCustomFontChange: preferences.handleSetLyricsCustomFont,
        onLyricsCustomFontUpload: preferences.handleUploadLyricsCustomFont,
        loadLyricFilterPreview,
        onSaveLyricFilterPattern,
        onToggleOpenPanelCloseButton: preferences.handleToggleOpenPanelCloseButton,
        stageStatus,
        stageSource,
        enableNowPlayingStage: preferences.enableNowPlayingStage,
        nowPlayingConnectionStatus: preferences.nowPlayingConnectionStatus,
        queueAddBehavior: preferences.queueAddBehavior,
        onQueueAddBehaviorChange: preferences.handleSetQueueAddBehavior,
        audioOutputDeviceId: preferences.audioOutputDeviceId,
        onAudioOutputDeviceChange,
        initialTab: state.initialTab,
        onClose,
        onToggleStageMode: async (enabled) => {
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
            preferences.handleToggleNowPlayingStage(enabled);
            if (!enabled && activePlaybackContext === 'stage') {
                leaveStagePlayback();
            }
        },
    };
};
