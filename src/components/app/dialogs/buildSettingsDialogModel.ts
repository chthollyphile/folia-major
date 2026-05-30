import type React from 'react';
import type SettingsModal from '../../modal/SettingsModal';
import type {
    CappellaEmojiImage,
    CappellaTuning,
    CadenzaTuning,
    DualTheme,
    FumeTuning,
    LyricData,
    NowPlayingConnectionStatus,
    PartitaTuning,
    QueueAddBehavior,
    StageSource,
    StageStatus,
    StoredCustomLyricsFont,
    Theme,
    ThemeMode,
    TiltTuning,
    VisualizerMode,
} from '../../../types';

// src/components/app/dialogs/buildSettingsDialogModel.ts

type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;

export type SettingsModalState = {
    isOpen: boolean;
    initialTab: NonNullable<SettingsDialogProps['initialTab']>;
};

type BuildSettingsDialogModelParams = {
    state: SettingsModalState;
    onClose: () => void;
    staticMode?: boolean;
    disableHomeDynamicBackground?: boolean;
    hidePlayerProgressBar?: boolean;
    hidePlayerTranslationSubtitle?: boolean;
    hidePlayerRightPanelButton?: boolean;
    transparentPlayerBackground?: boolean;
    disableVisualizerVignette?: boolean;
    disableVisualizerGeometricBackground?: boolean;
    minimizeToTray?: boolean;
    hideTaskbarIcon?: boolean;
    openPlayerOnLaunch?: boolean;
    onToggleStaticMode?: (enable: boolean) => void;
    onToggleDisableHomeDynamicBackground?: (disable: boolean) => void;
    onToggleHidePlayerProgressBar?: (enable: boolean) => void;
    onToggleHidePlayerTranslationSubtitle?: (enable: boolean) => void;
    onToggleHidePlayerRightPanelButton?: (enable: boolean) => void;
    onToggleTransparentPlayerBackground?: (enable: boolean) => void;
    onToggleDisableVisualizerVignette?: (disable: boolean) => void;
    onToggleDisableVisualizerGeometricBackground?: (disable: boolean) => void;
    onToggleMinimizeToTray?: (enable: boolean) => void;
    onToggleHideTaskbarIcon?: (enable: boolean) => void;
    onToggleOpenPlayerOnLaunch?: (enable: boolean) => void;
    enableMediaCache?: boolean;
    onToggleMediaCache?: (enable: boolean) => void;
    theme?: Theme;
    backgroundOpacity: number;
    setBackgroundOpacity: (opacity: number) => void;
    bgMode: ThemeMode;
    onApplyDefaultTheme: () => void;
    hasCustomTheme: boolean;
    themeParkInitialTheme: DualTheme;
    isCustomThemePreferred: boolean;
    songThemeAutoSwitchEnabled: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onApplyCustomTheme: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    isDaylight: boolean;
    onToggleNavidrome?: (enabled: boolean) => void;
    visualizerMode: VisualizerMode;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    cappellaTuning: CappellaTuning;
    tiltTuning: TiltTuning;
    cappellaCustomEmojiImages: CappellaEmojiImage[];
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    onPartitaTuningChange: (patch: Partial<PartitaTuning>) => void;
    onResetPartitaTuning: () => void;
    onFumeTuningChange: (patch: Partial<FumeTuning>) => void;
    onResetFumeTuning: () => void;
    onCappellaTuningChange: (patch: Partial<CappellaTuning>) => void;
    onResetCappellaTuning: () => void;
    onTiltTuningChange: (patch: Partial<TiltTuning>) => void;
    onResetTiltTuning: () => void;
    onImportCappellaCustomEmojiPack: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomEmojiPack: () => Promise<void> | void;
    isLoadingCappellaCustomEmojiPack: boolean;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsCustomFontFamily: string | null;
    lyricsCustomFontLabel: string | null;
    lyricFilterPattern: string;
    currentSongTitle?: string | null;
    showOpenPanelCloseButton: boolean;
    onLyricsFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onLyricsFontScaleChange: (fontScale: number) => void;
    onLyricsCustomFontChange: (font: StoredCustomLyricsFont | null) => void;
    onLyricsCustomFontUpload: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    loadLyricFilterPreview: () => Promise<LyricData | null>;
    onSaveLyricFilterPattern: (pattern: string) => Promise<void> | void;
    onToggleOpenPanelCloseButton: (enable: boolean) => void;
    stageStatus?: StageStatus | null;
    stageSource?: StageSource | null;
    activePlaybackContext: 'main' | 'stage';
    setStageStatus: React.Dispatch<React.SetStateAction<any>>;
    leaveStagePlayback: () => void;
    clearStagePlaybackSession: () => void;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadStageSessionIntoPlayback: (session: any) => Promise<void>;
    enableNowPlayingStage?: boolean;
    onToggleNowPlayingStage: (enabled: boolean) => void;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    queueAddBehavior: QueueAddBehavior;
    onQueueAddBehaviorChange: (behavior: QueueAddBehavior) => void;
    audioOutputDeviceId: string;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
};

// Builds the global settings dialog props without tying the modal to Home.
export const buildSettingsDialogModel = ({
    state,
    onClose,
    activePlaybackContext,
    setStageStatus,
    leaveStagePlayback,
    clearStagePlaybackSession,
    clearPersistedStagePlaybackCache,
    loadStageSessionIntoPlayback,
    onToggleNowPlayingStage,
    ...settingsProps
}: BuildSettingsDialogModelParams): SettingsDialogProps | null => {
    if (!state.isOpen) {
        return null;
    }

    return {
        ...settingsProps,
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
            onToggleNowPlayingStage(enabled);
            if (!enabled && activePlaybackContext === 'stage') {
                leaveStagePlayback();
            }
        },
    };
};
