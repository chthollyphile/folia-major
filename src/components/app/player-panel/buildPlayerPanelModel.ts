import type React from 'react';
import type { RefObject } from 'react';
import type LegacyUnifiedPanel from '../../UnifiedPanel';

// src/components/app/player-panel/buildPlayerPanelModel.ts

type LegacyUnifiedPanelProps = React.ComponentProps<typeof LegacyUnifiedPanel>;

export type PlayerPanelViewModel = {
    legacyProps: LegacyUnifiedPanelProps;
};

type BuildPlayerPanelModelParams = {
    isPanelOpen: boolean;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    panelTab: LegacyUnifiedPanelProps['playback']['currentTab'];
    setPanelTab: React.Dispatch<React.SetStateAction<LegacyUnifiedPanelProps['playback']['currentTab']>>;
    navigateToHome: LegacyUnifiedPanelProps['playback']['onNavigateHome'];
    handleDirectHomeFromPanel: LegacyUnifiedPanelProps['playback']['onNavigateHomeDirect'];
    coverUrl: string | null;
    currentSong: LegacyUnifiedPanelProps['playback']['currentSong'];
    handleAlbumSelect: LegacyUnifiedPanelProps['playback']['onAlbumSelect'];
    handleArtistSelect: LegacyUnifiedPanelProps['playback']['onSelectArtist'];
    effectiveLoopMode: LegacyUnifiedPanelProps['playback']['loopMode'];
    toggleLoop: LegacyUnifiedPanelProps['playback']['onToggleLoop'];
    handleLike: LegacyUnifiedPanelProps['playback']['onLike'];
    isLiked: boolean;
    generateAITheme: () => void;
    isGeneratingTheme: boolean;
    hasLyrics: boolean;
    canGenerateAITheme: boolean;
    theme: LegacyUnifiedPanelProps['playback']['theme'];
    setTheme: LegacyUnifiedPanelProps['playback']['onThemeChange'];
    bgMode: LegacyUnifiedPanelProps['playback']['bgMode'];
    handleBgModeChange: LegacyUnifiedPanelProps['playback']['onBgModeChange'];
    hasCustomTheme: LegacyUnifiedPanelProps['playback']['hasCustomTheme'];
    handleResetTheme: LegacyUnifiedPanelProps['playback']['onResetTheme'];
    defaultTheme: LegacyUnifiedPanelProps['playback']['defaultTheme'];
    daylightTheme: LegacyUnifiedPanelProps['playback']['daylightTheme'];
    visualizerMode: LegacyUnifiedPanelProps['playback']['visualizerMode'];
    handleSetVisualizerMode: LegacyUnifiedPanelProps['playback']['onVisualizerModeChange'];
    handleManualMatchOnline: LegacyUnifiedPanelProps['playback']['onMatchOnline'];
    handleUpdateLocalLyrics: LegacyUnifiedPanelProps['playback']['onUpdateLocalLyrics'];
    handleChangeLyricsSource: LegacyUnifiedPanelProps['playback']['onChangeLyricsSource'];
    onlineLyricsState: LegacyUnifiedPanelProps['playback']['onlineLyricsState'];
    handleImportOnlineLyrics: LegacyUnifiedPanelProps['playback']['onImportOnlineLyrics'];
    handleChangeOnlineLyricsSource: LegacyUnifiedPanelProps['playback']['onChangeOnlineLyricsSource'];
    handleMatchOnlineLyrics: LegacyUnifiedPanelProps['playback']['onMatchOnlineLyrics'];
    handleClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    handleLyricTimelineOffsetChange: LegacyUnifiedPanelProps['playback']['onLyricTimelineOffsetChange'];
    replayGainMode: LegacyUnifiedPanelProps['playback']['replayGainMode'];
    handleChangeReplayGainMode: LegacyUnifiedPanelProps['playback']['onChangeReplayGainMode'];
    isFmMode: boolean;
    handleFmTrash: LegacyUnifiedPanelProps['playback']['onFmTrash'];
    handleNextTrack: LegacyUnifiedPanelProps['playback']['onNextTrack'];
    handlePrevTrack: LegacyUnifiedPanelProps['playback']['onPrevTrack'];
    playerState: LegacyUnifiedPanelProps['playback']['playerState'];
    togglePlay: LegacyUnifiedPanelProps['playback']['onTogglePlay'];
    volume: LegacyUnifiedPanelProps['playback']['volume'];
    isMuted: LegacyUnifiedPanelProps['playback']['isMuted'];
    handlePreviewVolume: LegacyUnifiedPanelProps['playback']['onVolumePreview'];
    handleSetVolume: LegacyUnifiedPanelProps['playback']['onVolumeChange'];
    handleToggleMute: LegacyUnifiedPanelProps['playback']['onToggleMute'];
    showOpenPanelCloseButton: LegacyUnifiedPanelProps['playback']['showOpenPanelCloseButton'];
    hideToggleButton: boolean;
    activePlaybackContext: 'main' | 'stage';
    isNowPlayingControlDisabled: boolean;
    openSettings: (initialTab: 'help' | 'options') => void;
    openCommandPalette?: LegacyUnifiedPanelProps['playback']['onOpenCommandPalette'];
    isCommandPaletteOpen?: boolean;
    playQueue: LegacyUnifiedPanelProps['queue']['playQueue'];
    playSong: LegacyUnifiedPanelProps['queue']['onPlaySong'];
    queueScrollRef: RefObject<HTMLDivElement | null>;
    shuffleQueue: LegacyUnifiedPanelProps['queue']['onShuffle'];
    localPlaylists: LegacyUnifiedPanelProps['library']['localPlaylists'];
    playlists: LegacyUnifiedPanelProps['library']['neteasePlaylists'];
    saveCurrentQueueAsLocalPlaylist: LegacyUnifiedPanelProps['library']['onSaveCurrentQueueAsPlaylist'];
    addCurrentSongToLocalPlaylist: LegacyUnifiedPanelProps['library']['onAddCurrentSongToLocalPlaylist'];
    createCurrentLocalPlaylist: LegacyUnifiedPanelProps['library']['onCreateCurrentLocalPlaylist'];
    addCurrentSongToNeteasePlaylist: LegacyUnifiedPanelProps['library']['onAddCurrentSongToNeteasePlaylist'];
    addCurrentSongToNavidromePlaylist: LegacyUnifiedPanelProps['library']['onAddCurrentSongToNavidromePlaylist'];
    createCurrentNavidromePlaylist: LegacyUnifiedPanelProps['library']['onCreateCurrentNavidromePlaylist'];
    openCurrentLocalAlbum: LegacyUnifiedPanelProps['library']['onOpenCurrentLocalAlbum'];
    openCurrentLocalArtist: LegacyUnifiedPanelProps['library']['onOpenCurrentLocalArtist'];
    openCurrentNavidromeAlbum: LegacyUnifiedPanelProps['library']['onOpenCurrentNavidromeAlbum'];
    openCurrentNavidromeArtist: LegacyUnifiedPanelProps['library']['onOpenCurrentNavidromeArtist'];
    handleCopySongInfoSuccess: LegacyUnifiedPanelProps['library']['onCopySongInfoSuccess'];
    user: LegacyUnifiedPanelProps['account']['user'];
    handleLogout: LegacyUnifiedPanelProps['account']['onLogout'];
    audioQuality: LegacyUnifiedPanelProps['account']['audioQuality'];
    setAudioQuality: LegacyUnifiedPanelProps['account']['onAudioQualityChange'];
    cacheSize: LegacyUnifiedPanelProps['account']['cacheSize'];
    handleClearCache: LegacyUnifiedPanelProps['account']['onClearCache'];
    handleSyncData: LegacyUnifiedPanelProps['account']['onSyncData'];
    isSyncing: LegacyUnifiedPanelProps['account']['isSyncing'];
    useCoverColorBg: LegacyUnifiedPanelProps['account']['useCoverColorBg'];
    handleToggleCoverColorBg: LegacyUnifiedPanelProps['account']['onToggleCoverColorBg'];
    isDaylight: LegacyUnifiedPanelProps['account']['isDaylight'];
    handleToggleDaylight: () => void;
};

// Builds the player panel model from raw app state and actions so App.tsx no longer assembles nested props inline.
export const buildPlayerPanelModel = ({
    isPanelOpen,
    setIsPanelOpen,
    panelTab,
    setPanelTab,
    navigateToHome,
    handleDirectHomeFromPanel,
    coverUrl,
    currentSong,
    handleAlbumSelect,
    handleArtistSelect,
    effectiveLoopMode,
    toggleLoop,
    handleLike,
    isLiked,
    generateAITheme,
    isGeneratingTheme,
    hasLyrics,
    canGenerateAITheme,
    theme,
    setTheme,
    bgMode,
    handleBgModeChange,
    hasCustomTheme,
    handleResetTheme,
    defaultTheme,
    daylightTheme,
    visualizerMode,
    handleSetVisualizerMode,
    handleManualMatchOnline,
    handleUpdateLocalLyrics,
    handleChangeLyricsSource,
    onlineLyricsState,
    handleImportOnlineLyrics,
    handleChangeOnlineLyricsSource,
    handleMatchOnlineLyrics,
    handleClearOnlineLyricsState,
    lyricTimelineOffsetMs,
    handleLyricTimelineOffsetChange,
    replayGainMode,
    handleChangeReplayGainMode,
    isFmMode,
    handleFmTrash,
    handleNextTrack,
    handlePrevTrack,
    playerState,
    togglePlay,
    volume,
    isMuted,
    handlePreviewVolume,
    handleSetVolume,
    handleToggleMute,
    showOpenPanelCloseButton,
    hideToggleButton,
    activePlaybackContext,
    isNowPlayingControlDisabled,
    openSettings,
    openCommandPalette,
    isCommandPaletteOpen,
    playQueue,
    playSong,
    queueScrollRef,
    shuffleQueue,
    localPlaylists,
    playlists,
    saveCurrentQueueAsLocalPlaylist,
    addCurrentSongToLocalPlaylist,
    createCurrentLocalPlaylist,
    addCurrentSongToNeteasePlaylist,
    addCurrentSongToNavidromePlaylist,
    createCurrentNavidromePlaylist,
    openCurrentLocalAlbum,
    openCurrentLocalArtist,
    openCurrentNavidromeAlbum,
    openCurrentNavidromeArtist,
    handleCopySongInfoSuccess,
    user,
    handleLogout,
    audioQuality,
    setAudioQuality,
    cacheSize,
    handleClearCache,
    handleSyncData,
    isSyncing,
    useCoverColorBg,
    handleToggleCoverColorBg,
    isDaylight,
    handleToggleDaylight,
}: BuildPlayerPanelModelParams): PlayerPanelViewModel => ({
    legacyProps: {
        playback: {
            isOpen: isPanelOpen,
            currentTab: panelTab,
            onTabChange: setPanelTab,
            onToggle: () => setIsPanelOpen(!isPanelOpen),
            onNavigateHome: navigateToHome,
            onNavigateHomeDirect: handleDirectHomeFromPanel,
            coverUrl,
            currentSong,
            onAlbumSelect: handleAlbumSelect,
            onSelectArtist: handleArtistSelect,
            loopMode: effectiveLoopMode,
            onToggleLoop: toggleLoop,
            onLike: handleLike,
            isLiked,
            onGenerateAITheme: generateAITheme,
            isGeneratingTheme,
            hasLyrics,
            canGenerateAITheme,
            theme,
            onThemeChange: setTheme,
            bgMode,
            onBgModeChange: handleBgModeChange,
            hasCustomTheme,
            onResetTheme: handleResetTheme,
            defaultTheme,
            daylightTheme,
            visualizerMode,
            onVisualizerModeChange: handleSetVisualizerMode,
            onMatchOnline: handleManualMatchOnline,
            onUpdateLocalLyrics: handleUpdateLocalLyrics,
            onChangeLyricsSource: handleChangeLyricsSource,
            onlineLyricsState,
            onImportOnlineLyrics: handleImportOnlineLyrics,
            onChangeOnlineLyricsSource: handleChangeOnlineLyricsSource,
            onMatchOnlineLyrics: handleMatchOnlineLyrics,
            onClearOnlineLyricsState: handleClearOnlineLyricsState,
            lyricTimelineOffsetMs,
            onLyricTimelineOffsetChange: handleLyricTimelineOffsetChange,
            replayGainMode,
            onChangeReplayGainMode: handleChangeReplayGainMode,
            isFmMode,
            onFmTrash: handleFmTrash,
            onNextTrack: handleNextTrack,
            onPrevTrack: handlePrevTrack,
            playerState,
            onTogglePlay: togglePlay,
            volume,
            isMuted,
            onVolumePreview: handlePreviewVolume,
            onVolumeChange: handleSetVolume,
            onToggleMute: handleToggleMute,
            showOpenPanelCloseButton,
            hideToggleButton,
            isStageContext: activePlaybackContext === 'stage',
            playbackControlsDisabled: isNowPlayingControlDisabled,
            onOpenSettings: () => {
                openSettings('options');
            },
            onOpenCommandPalette: openCommandPalette,
            isCommandPaletteOpen,
        },
        queue: {
            playQueue,
            onPlaySong: playSong,
            queueScrollRef,
            onShuffle: shuffleQueue,
        },
        library: {
            localPlaylists,
            neteasePlaylists: playlists,
            onSaveCurrentQueueAsPlaylist: saveCurrentQueueAsLocalPlaylist,
            onAddCurrentSongToLocalPlaylist: addCurrentSongToLocalPlaylist,
            onCreateCurrentLocalPlaylist: createCurrentLocalPlaylist,
            onAddCurrentSongToNeteasePlaylist: addCurrentSongToNeteasePlaylist,
            onAddCurrentSongToNavidromePlaylist: addCurrentSongToNavidromePlaylist,
            onCreateCurrentNavidromePlaylist: createCurrentNavidromePlaylist,
            onOpenCurrentLocalAlbum: openCurrentLocalAlbum,
            onOpenCurrentLocalArtist: openCurrentLocalArtist,
            onOpenCurrentNavidromeAlbum: openCurrentNavidromeAlbum,
            onOpenCurrentNavidromeArtist: openCurrentNavidromeArtist,
            onCopySongInfoSuccess: handleCopySongInfoSuccess,
        },
        account: {
            user,
            onLogout: handleLogout,
            audioQuality,
            onAudioQualityChange: setAudioQuality,
            cacheSize,
            onClearCache: handleClearCache,
            onSyncData: handleSyncData,
            isSyncing,
            useCoverColorBg,
            onToggleCoverColorBg: handleToggleCoverColorBg,
            isDaylight,
            onToggleDaylight: handleToggleDaylight,
        },
    },
});
