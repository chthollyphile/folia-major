import type React from 'react';
import type { SearchReturnView, SearchSource } from '../../stores/useSearchNavigationStore';
import type { LocalLibraryDisplayCatalog } from '../../services/playbackAdapters';
import type { HomeViewTab, LatentBackgroundTuning, LocalSong, PlayerState, SongResult, StatusMessage, VisualizerMode, VisualizerBackgroundMode, MonetBackgroundTuning } from '../../types';
import type { AppLanguagePreference } from '../../i18n/config';
import type { PanelTab } from '../UnifiedPanel';
import type { SettingsModalInitialTab, SettingsSubviewId } from '../../stores/useSettingsUiStore';

// src/components/command-palette/types.ts
// Shared command palette contracts used by the registry, hook, and UI shell.

export type CommandPaletteGroup = 'search' | 'settings' | 'navigation' | 'panel' | 'playback' | 'visualizer';

export type CommandPaletteSearchSource = SearchSource;

export type CommandPaletteCommand = {
    id: string;
    group: CommandPaletteGroup;
    title: string;
    description: string;
    textSource?: 'i18n' | 'runtime';
    keywords: string[];
    placeholder?: string;
    requiresInput?: boolean;
    getPreview?: (input: string, context: CommandPaletteContext) => string | null;
    execute: (input: string, context: CommandPaletteContext) => Promise<boolean> | boolean;
};

export type CommandPaletteMatch = {
    command: CommandPaletteCommand;
    score: number;
    input: string;
    previewText?: string | null;
};

export type CommandPaletteContext = {
    currentSearchSourceTab: SearchSource;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryDisplayCatalog;
    playerState: PlayerState;
    t: (key: string, fallback?: string) => string;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    openSettings: (initialTab?: SettingsModalInitialTab, initialSubview?: SettingsSubviewId | null) => void;
    navigateToHome: () => void;
    navigateToPlayer: () => void;
    navigateToSearch: (args: { query: string; sourceTab: SearchSource; replace?: boolean; returnView?: SearchReturnView; }) => void;
    toggleBrowserFullscreen: () => Promise<boolean>;
    toggleRemoteControlWindow: () => Promise<boolean>;
    toggleMainWindowAlwaysOnTop: () => Promise<boolean>;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setPanelTab: (tab: PanelTab) => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    submitSearch: (args: {
        query?: string;
        sourceTab: SearchSource;
        deps: {
            localSongs: LocalSong[];
            localLibraryCatalog?: LocalLibraryDisplayCatalog;
            t: (key: string, fallback?: string) => string;
        };
        returnView?: SearchReturnView;
    }) => Promise<boolean>;
    togglePlay: () => void;
    toggleLoop: () => void;
    handleNextTrack: () => void;
    handlePrevTrack: () => void;
    shuffleQueue: () => void;
    playQueue: SongResult[];
    playSong: (song: SongResult, queue?: SongResult[]) => void | Promise<void>;
    canGenerateAITheme: boolean;
    isGeneratingTheme: boolean;
    generateAITheme: () => void;
    setVisualizerMode: (mode: VisualizerMode) => void;
    randomVisualizerModePerSong: boolean;
    toggleRandomVisualizerModePerSong: () => void;
    setVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    setMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    setLatentBackgroundTuning: (patch: Partial<LatentBackgroundTuning>) => void;
    toggleTransparentBackground: () => void;
    hideBottomSubtitleOverlay: boolean;
    toggleBottomSubtitleOverlay: () => void;
    showSubtitleTranslation: boolean;
    toggleSubtitleTranslation: () => void;
    subtitleOverlayBackground: boolean;
    toggleSubtitleOverlayBackground: () => void;
    toggleDaylightMode: () => void;
    voiceInputPauseEnabled: boolean;
    voiceInputPauseSupported: boolean;
    toggleVoiceInputPause: () => void;
    setAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void> | void;
    enableAlternativeLyricSources: boolean;
    runAutoMatchBestLyric: () => Promise<boolean>;
    setIsUserGuideModalOpen: (isOpen: boolean) => void;
    openThemeQuickEditor: () => void;
    canOpenThemeQuickEditor: boolean;
};
