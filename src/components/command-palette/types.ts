import type React from 'react';
import type { SearchReturnView } from '../../stores/useSearchNavigationStore';
import type { HomeViewTab, LocalSong, PlayerState, SongResult, VisualizerMode, VisualizerBackgroundMode, MonetBackgroundTuning } from '../../types';
import type { PanelTab } from '../UnifiedPanel';
import type { SettingsModalInitialTab, SettingsSubviewId } from '../../stores/useSettingsUiStore';

// src/components/command-palette/types.ts
// Shared command palette contracts used by the registry, hook, and UI shell.

export type CommandPaletteGroup = 'search' | 'settings' | 'navigation' | 'panel' | 'playback' | 'visualizer';

export type CommandPaletteSearchSource = HomeViewTab;

export type CommandPaletteCommand = {
    id: string;
    group: CommandPaletteGroup;
    title: string;
    description: string;
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
    currentSearchSourceTab: HomeViewTab;
    localSongs: LocalSong[];
    playerState: PlayerState;
    t: (key: string, fallback?: string) => string;
    openSettings: (initialTab?: SettingsModalInitialTab, initialSubview?: SettingsSubviewId | null) => void;
    navigateToHome: () => void;
    navigateToPlayer: () => void;
    navigateToSearch: (args: { query: string; sourceTab: HomeViewTab; replace?: boolean; returnView?: SearchReturnView; }) => void;
    toggleBrowserFullscreen: () => Promise<boolean>;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setPanelTab: (tab: PanelTab) => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    submitSearch: (args: {
        query?: string;
        sourceTab: HomeViewTab;
        deps: {
            localSongs: LocalSong[];
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
    setVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    setMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    toggleTransparentBackground: () => void;
    toggleDaylightMode: () => void;
    enableAlternativeLyricSources: boolean;
    runAutoMatchBestLyric: () => Promise<boolean>;
    setIsUserGuideModalOpen: (isOpen: boolean) => void;
};
