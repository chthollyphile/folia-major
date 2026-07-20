import type React from 'react';
import type { RefObject } from 'react';
import type UnifiedPanel from '../../UnifiedPanel';

// src/components/app/player-panel/buildPlayerPanelModel.ts

type UnifiedPanelProps = React.ComponentProps<typeof UnifiedPanel>;

export type PlayerPanelViewModel = {
    panelProps: UnifiedPanelProps;
};

type BuildPlayerPanelModelParams = {
    isPanelOpen: boolean;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    panelTab: UnifiedPanelProps['playback']['currentTab'];
    setPanelTab: React.Dispatch<React.SetStateAction<UnifiedPanelProps['playback']['currentTab']>>;
    navigateToHome: UnifiedPanelProps['playback']['onNavigateHome'];
    handleDirectHomeFromPanel: UnifiedPanelProps['playback']['onNavigateHomeDirect'];
    coverUrl: string | null;
    currentSong: UnifiedPanelProps['playback']['currentSong'];
    handleAlbumSelect: UnifiedPanelProps['playback']['onAlbumSelect'];
    handleArtistSelect: UnifiedPanelProps['playback']['onSelectArtist'];
    effectiveLoopMode: UnifiedPanelProps['playback']['loopMode'];
    toggleLoop: UnifiedPanelProps['playback']['onToggleLoop'];
    handleLike: UnifiedPanelProps['playback']['onLike'];
    isLiked: boolean;
    generateAITheme: () => void;
    isGeneratingTheme: boolean;
    hasLyrics: boolean;
    canGenerateAITheme: boolean;
    theme: UnifiedPanelProps['playback']['theme'];
    setTheme: UnifiedPanelProps['playback']['onThemeChange'];
    bgMode: UnifiedPanelProps['playback']['bgMode'];
    handleBgModeChange: UnifiedPanelProps['playback']['onBgModeChange'];
    hasCustomTheme: UnifiedPanelProps['playback']['hasCustomTheme'];
    themeSourceModel: UnifiedPanelProps['playback']['themeSourceModel'];
    handleResetTheme: UnifiedPanelProps['playback']['onResetTheme'];
    defaultTheme: UnifiedPanelProps['playback']['defaultTheme'];
    daylightTheme: UnifiedPanelProps['playback']['daylightTheme'];
    visualizerMode: UnifiedPanelProps['playback']['visualizerMode'];
    handleSetVisualizerMode: UnifiedPanelProps['playback']['onVisualizerModeChange'];
    handleManualMatchOnline: UnifiedPanelProps['playback']['onMatchOnline'];
    handleUpdateLocalLyrics: UnifiedPanelProps['playback']['onUpdateLocalLyrics'];
    handleChangeLyricsSource: UnifiedPanelProps['playback']['onChangeLyricsSource'];
    onlineLyricsState: UnifiedPanelProps['playback']['onlineLyricsState'];
    handleImportOnlineLyrics: UnifiedPanelProps['playback']['onImportOnlineLyrics'];
    handleChangeOnlineLyricsSource: UnifiedPanelProps['playback']['onChangeOnlineLyricsSource'];
    handleMatchOnlineLyrics: UnifiedPanelProps['playback']['onMatchOnlineLyrics'];
    handleClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    handleLyricTimelineOffsetChange: UnifiedPanelProps['playback']['onLyricTimelineOffsetChange'];
    replayGainMode: UnifiedPanelProps['playback']['replayGainMode'];
    handleChangeReplayGainMode: UnifiedPanelProps['playback']['onChangeReplayGainMode'];
    isFmMode: boolean;
    handleFmTrash: UnifiedPanelProps['playback']['onFmTrash'];
    handleNextTrack: UnifiedPanelProps['playback']['onNextTrack'];
    handlePrevTrack: UnifiedPanelProps['playback']['onPrevTrack'];
    playerState: UnifiedPanelProps['playback']['playerState'];
    togglePlay: UnifiedPanelProps['playback']['onTogglePlay'];
    volume: UnifiedPanelProps['playback']['volume'];
    isMuted: UnifiedPanelProps['playback']['isMuted'];
    handlePreviewVolume: UnifiedPanelProps['playback']['onVolumePreview'];
    handleSetVolume: UnifiedPanelProps['playback']['onVolumeChange'];
    handleToggleMute: UnifiedPanelProps['playback']['onToggleMute'];
    showOpenPanelCloseButton: UnifiedPanelProps['playback']['showOpenPanelCloseButton'];
    hideToggleButton: boolean;
    activePlaybackContext: 'main' | 'stage';
    isNowPlayingControlDisabled: boolean;
    openSettings: (initialTab: 'help' | 'options') => void;
    openCommandPalette?: UnifiedPanelProps['playback']['onOpenCommandPalette'];
    isCommandPaletteOpen?: boolean;
    playQueue: UnifiedPanelProps['queue']['playQueue'];
    playSong: UnifiedPanelProps['queue']['onPlaySong'];
    queueScrollRef: RefObject<HTMLDivElement | null>;
    shuffleQueue: UnifiedPanelProps['queue']['onShuffle'];
    removeQueueSong: UnifiedPanelProps['queue']['onRemoveSong'];
    moveQueueSongToEnd: UnifiedPanelProps['queue']['onMoveSongToEnd'];
    moveQueueSongToNext: UnifiedPanelProps['queue']['onMoveSongToNext'];
    localPlaylists: UnifiedPanelProps['library']['localPlaylists'];
    onlinePlaylists: UnifiedPanelProps['library']['onlinePlaylists'];
    saveCurrentQueueAsLocalPlaylist: UnifiedPanelProps['library']['onSaveCurrentQueueAsPlaylist'];
    addCurrentSongToLocalPlaylist: UnifiedPanelProps['library']['onAddCurrentSongToLocalPlaylist'];
    createCurrentLocalPlaylist: UnifiedPanelProps['library']['onCreateCurrentLocalPlaylist'];
    addCurrentSongToOnlinePlaylist: UnifiedPanelProps['library']['onAddCurrentSongToOnlinePlaylist'];
    addCurrentSongToNavidromePlaylist: UnifiedPanelProps['library']['onAddCurrentSongToNavidromePlaylist'];
    createCurrentNavidromePlaylist: UnifiedPanelProps['library']['onCreateCurrentNavidromePlaylist'];
    openCurrentLocalAlbum: UnifiedPanelProps['library']['onOpenCurrentLocalAlbum'];
    openCurrentLocalArtist: UnifiedPanelProps['library']['onOpenCurrentLocalArtist'];
    openCurrentNavidromeAlbum: UnifiedPanelProps['library']['onOpenCurrentNavidromeAlbum'];
    openCurrentNavidromeArtist: UnifiedPanelProps['library']['onOpenCurrentNavidromeArtist'];
    handleCopySongInfoSuccess: UnifiedPanelProps['library']['onCopySongInfoSuccess'];
    user: UnifiedPanelProps['account']['user'];
    handleLogout: UnifiedPanelProps['account']['onLogout'];
    audioQuality: UnifiedPanelProps['account']['audioQuality'];
    setAudioQuality: UnifiedPanelProps['account']['onAudioQualityChange'];
    cacheSize: UnifiedPanelProps['account']['cacheSize'];
    handleClearCache: UnifiedPanelProps['account']['onClearCache'];
    handleSyncData: UnifiedPanelProps['account']['onSyncData'];
    isSyncing: UnifiedPanelProps['account']['isSyncing'];
    useCoverColorBg: UnifiedPanelProps['account']['useCoverColorBg'];
    handleToggleCoverColorBg: UnifiedPanelProps['account']['onToggleCoverColorBg'];
    isDaylight: UnifiedPanelProps['account']['isDaylight'];
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
    themeSourceModel,
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
    removeQueueSong,
    moveQueueSongToEnd,
    moveQueueSongToNext,
    localPlaylists,
    onlinePlaylists,
    saveCurrentQueueAsLocalPlaylist,
    addCurrentSongToLocalPlaylist,
    createCurrentLocalPlaylist,
    addCurrentSongToOnlinePlaylist,
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
    panelProps: {
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
            themeSourceModel,
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
            onRemoveSong: removeQueueSong,
            onMoveSongToEnd: moveQueueSongToEnd,
            onMoveSongToNext: moveQueueSongToNext,
        },
        library: {
            localPlaylists,
            onlinePlaylists,
            onSaveCurrentQueueAsPlaylist: saveCurrentQueueAsLocalPlaylist,
            onAddCurrentSongToLocalPlaylist: addCurrentSongToLocalPlaylist,
            onCreateCurrentLocalPlaylist: createCurrentLocalPlaylist,
            onAddCurrentSongToOnlinePlaylist: addCurrentSongToOnlinePlaylist,
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
