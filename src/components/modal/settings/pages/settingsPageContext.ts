import { createContext, useContext } from 'react';
import type React from 'react';
import type { NowPlayingConnectionStatus, ReplayGainMode, StageSource, StageStatus, ThemeMode } from '../../../../types';
import type { LyricApiStatus } from '../../../../types/lyricApi';
import type { NavidromeServerProfile } from '../../../../types/navidrome';
import type { ObsBrowserSourceStatus } from '../../../../types/obsBrowserSource';
import type { PlayerCapConnectionStatus } from '../../../../types/playerCap';
import type { ThemeGenerationSource } from '../../../../services/themePreferences';
import type { ConfigThemeControls } from './storage/visualConfigTransfer';

// src/components/modal/settings/pages/settingsPageContext.ts
// What a settings page gets from the dialog. A setting that lives in a store is read from its store
// by the page itself; this carries only what the dialog or the app shell holds: theme state that is
// not in a store, the dialogs a row opens, and the state the dialog keeps while it is open.

/** The kinds of data the app keeps on disk, each of which can be cleared on its own. */
export type CacheCategory = 'playlist' | 'lyrics' | 'cover' | 'media' | 'analysis';

/** A provider key the desktop app keeps in its main process. */
export type AiApiKeyName = 'GEMINI_API_KEY' | 'OPENAI_API_KEY';

/** The desktop app's settings file, as far as the settings dialog reads and writes it. */
export type ElectronSettingsState = {
    /** Drafts of a replacement key: a saved key never reaches the renderer. */
    GEMINI_API_KEY: string;
    OPENAI_API_KEY: string;
    OPENAI_API_URL: string;
    OPENAI_API_MODEL: string;
    OPENAI_API_TEMPERATURE: string;
    OPENAI_API_STREAM: boolean;
    AI_PROVIDER: string;
    USE_SYSTEM_PROXY_FOR_AI: boolean;
    ENABLE_UPDATE_CHECK: boolean;
    ENABLE_AUTO_UPDATE: boolean;
    UPDATE_CHANNEL: 'realeco' | 'limo' | 'cielo' | 'internal';
    STAGE_MODE_SOURCE: string;
    DISCORD_RICH_PRESENCE_ENABLED: boolean;
};

export type SettingsPageContextValue = {
    /** Running in the desktop app. */
    isElectron: boolean;
    /** Theme state and actions that the app shell owns. */
    themeControls: {
        bgMode: ThemeMode;
        hasCustomTheme: boolean;
        isCustomThemePreferred: boolean;
        songThemeAutoSwitchEnabled: boolean;
        songThemeAutoGenerateEnabled: boolean;
        themeGenerationSource: ThemeGenerationSource;
        /** Whether the AI provider has a saved key; without one the AI source cannot be chosen. */
        aiApiKeyStatus: 'loading' | 'configured' | 'missing';
        onApplyDefaultTheme: () => void;
        onApplyCustomTheme: () => void;
        onToggleCustomThemePreferred: (enabled: boolean) => void;
        onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
        onToggleSongThemeAutoGenerate: (enabled: boolean) => void;
        onChangeThemeGenerationSource: (source: ThemeGenerationSource) => void;
    };
    /** Opens the lyric animation workbench over the dialog. */
    onOpenVisPlayground: () => void;
    /** Opens the lyric font picker over the dialog, to choose a system font or upload one. */
    onOpenLyricsFontPicker: () => void;
    /** Opens the theme colour editor over the dialog. */
    onOpenThemePark: () => void;
    onToggleTransparentPlayerBackground: (enabled: boolean) => void;
    /**
     * State the dialog itself holds (the desktop app's settings file, the Navidrome form, cache
     * sizes) and what the app shell hands it, grouped by the page that first read it. It holds
     * only keys a page reads.
     */
    viewProps: {
        /** The app shell's theme state and actions that a config of the visual settings carries. */
        appearance: ConfigThemeControls;
        /** Playback state the app shell owns, and the two lyric dialogs the dialog opens. */
        playback: {
            onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
            onOpenGlobalLyricOffsetSettings: () => void;
            onOpenLyricFilterSettings: () => void;
            replayGainMode: ReplayGainMode;
            onReplayGainModeChange: (mode: ReplayGainMode) => void;
        };
        integration: {
            /** The Navidrome connection form, which the dialog holds while it is open. */
            navidrome: {
                navidromeConfigured: boolean;
                navidromeEnabled: boolean;
                navidromePassword: string;
                navidromeServerProfile: NavidromeServerProfile | null;
                navidromeTestStatus: 'idle' | 'testing' | 'success' | 'failed';
                navidromeUrl: string;
                navidromeUsername: string;
                /** A Docker deployment set a preset account and the form is not on it: the preset can be put back. */
                navidromeCanRestorePreset: boolean;
                navidromeRestoreFailed: boolean;
                navidromeRestoring: boolean;
                /** The saved connection is the deployment's preset account. */
                navidromeUsesPreset: boolean;
                onRestoreNavidromePreset: () => Promise<void> | void;
                onClearNavidrome: () => void;
                onToggleNavidrome: (enabled: boolean) => void;
                setNavidromePassword: (value: string) => void;
                setNavidromeUrl: (value: string) => void;
                setNavidromeUsername: (value: string) => void;
                testNavidromeConnection: () => Promise<void> | void;
            };
            discord: {
                enabled: boolean;
                onToggle: (enabled: boolean) => Promise<void> | void;
                status?: ElectronDiscordPresenceStatus | null;
            };
            lyricApi: {
                status?: LyricApiStatus | null;
                onToggle?: (enabled: boolean) => Promise<void> | void;
            };
            /** Stage mode and the OBS browser source, as the app shell reports and switches them. */
            stage: {
                nowPlayingConnectionStatus: NowPlayingConnectionStatus;
                obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
                onRegenerateObsBrowserSourceToken?: () => Promise<void> | void;
                onRegenerateStageToken?: () => Promise<void> | void;
                onStageSourceChange?: (source: StageSource) => Promise<void> | void;
                onToggleObsBrowserSource?: (enabled: boolean) => Promise<void> | void;
                onToggleStageMode?: (enabled: boolean) => Promise<void> | void;
                playerCapConnectionStatus?: PlayerCapConnectionStatus;
                playerCapPlayers?: string[];
                stageSource?: StageSource | null;
                stageStatus?: StageStatus | null;
            };
        };
        /** What the app keeps on disk: the sizes the dialog measured, and clearing one kind. */
        storage: {
            cacheDirectory: string;
            cacheDirectoryIsDefault: boolean;
            cacheDirectoryStatus: 'idle' | 'choosing';
            cacheSizes: Record<CacheCategory, string>;
            /** The kind being cleared now. */
            isCleaning: CacheCategory | null;
            mediaCount: number;
            onChooseCacheDirectory: () => void;
            onClear: (category: CacheCategory) => void;
        };
        desktop: {
            /** The desktop app's settings file and its update state, as the dialog holds them while it is open. */
            model: {
                canDownloadUpdate: boolean;
                canEnableAutoUpdate: boolean;
                electronSaveStatus: 'idle' | 'saving' | 'saved';
                electronSettings: ElectronSettingsState;
                onCheckForUpdates: () => Promise<void> | void;
                /** Removes a saved key from the main process at once. */
                onClearAiApiKey: (key: AiApiKeyName) => Promise<void> | void;
                onDownloadUpdate: () => Promise<void> | void;
                onInstallUpdate: () => Promise<void> | void;
                onOpenBaiduDownload: () => Promise<void> | void;
                onOpenChinaDownload: () => Promise<void> | void;
                onUpdateChannelChange: (channel: 'realeco' | 'limo' | 'cielo') => Promise<void> | void;
                onSaveElectronSettings: () => Promise<void> | void;
                onToggleAutoUpdate: () => Promise<void> | void;
                onToggleUpdateCheck: () => Promise<void> | void;
                /** Which provider keys the main process has saved. */
                savedAiApiKeys: Record<AiApiKeyName, boolean>;
                /** The endpoint the saved OpenAI-compatible key is sent to, and only to. */
                savedOpenAIKeyEndpoint: string | null;
                setElectronSettings: React.Dispatch<React.SetStateAction<ElectronSettingsState>>;
                /** The update state in a few words, for the button that checks again. */
                updateBadgeLabel: string;
                updateStatus: ElectronUpdateStatus | null;
            };
            preferences: {
                openPlayerOnLaunch: boolean;
                onToggleOpenPlayerOnLaunch: (enabled: boolean) => void;
            };
        };
        lab: {
            /** Pausing playback while voice input is in use; only the Windows desktop app supports it. */
            voiceInputPause: {
                enabled: boolean;
                supported: boolean;
                onToggle: () => void;
            };
        };
    };
};

export const SettingsPageContext = createContext<SettingsPageContextValue | null>(null);

export const useSettingsPage = (): SettingsPageContextValue => {
    const value = useContext(SettingsPageContext);
    if (!value) {
        throw new Error('[Settings] A settings page was rendered outside the settings dialog.');
    }
    return value;
};
