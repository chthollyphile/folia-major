import type React from 'react';
import type { PlayerState } from '../../../types';
import type LegacyHome from '../../Home';

// src/components/app/home/buildHomeModel.ts

type LegacyHomeProps = React.ComponentProps<typeof LegacyHome>;

export type HomeViewModel = {
    legacyProps: LegacyHomeProps;
};

type BuildHomeModelParams = {
    playSong: LegacyHomeProps['onPlaySong'];
    navigateToPlayer: LegacyHomeProps['onBackToPlayer'];
    refreshUserData: () => Promise<void>;
    user: LegacyHomeProps['user'];
    playlists: LegacyHomeProps['playlists'];
    cloudPlaylist?: LegacyHomeProps['cloudPlaylist'];
    currentSong: LegacyHomeProps['currentTrack'];
    playerState: PlayerState;
    handlePlaylistSelect: LegacyHomeProps['onSelectPlaylist'];
    handleAlbumSelect: LegacyHomeProps['onSelectAlbum'];
    handleArtistSelect: LegacyHomeProps['onSelectArtist'];
    focusedPlaylistIndex?: LegacyHomeProps['focusedPlaylistIndex'];
    setFocusedPlaylistIndex?: LegacyHomeProps['setFocusedPlaylistIndex'];
    focusedFavoriteAlbumIndex?: LegacyHomeProps['focusedFavoriteAlbumIndex'];
    setFocusedFavoriteAlbumIndex?: LegacyHomeProps['setFocusedFavoriteAlbumIndex'];
    focusedRadioIndex?: LegacyHomeProps['focusedRadioIndex'];
    setFocusedRadioIndex?: LegacyHomeProps['setFocusedRadioIndex'];
    pendingOpenSettings?: LegacyHomeProps['pendingOpenSettings'];
    setPendingOpenSettings: React.Dispatch<React.SetStateAction<boolean>>;
    navigateToSearch: (args: { query: string; sourceTab: string; replace?: boolean }) => void;
    openLocalAlbumByName?: LegacyHomeProps['onSelectLocalAlbum'];
    openLocalArtistByName?: LegacyHomeProps['onSelectLocalArtist'];
    localSongs: LegacyHomeProps['localSongs'];
    localPlaylists: LegacyHomeProps['localPlaylists'];
    onRefreshLocalSongs: LegacyHomeProps['onRefreshLocalSongs'];
    onPlayLocalSong: LegacyHomeProps['onPlayLocalSong'];
    onAddLocalSongToQueue?: LegacyHomeProps['onAddLocalSongToQueue'];
    localMusicState: LegacyHomeProps['localMusicState'];
    setLocalMusicState: LegacyHomeProps['setLocalMusicState'];
    onMatchSong?: LegacyHomeProps['onMatchSong'];
    onPlayNavidromeSong?: LegacyHomeProps['onPlayNavidromeSong'];
    onAddNavidromeSongsToQueue?: LegacyHomeProps['onAddNavidromeSongsToQueue'];
    onMatchNavidromeSong?: LegacyHomeProps['onMatchNavidromeSong'];
    navidromeFocusedAlbumIndex?: LegacyHomeProps['navidromeFocusedAlbumIndex'];
    setNavidromeFocusedAlbumIndex?: LegacyHomeProps['setNavidromeFocusedAlbumIndex'];
    pendingNavidromeSelection?: LegacyHomeProps['pendingNavidromeSelection'];
    setPendingNavidromeSelection: React.Dispatch<React.SetStateAction<any>>;
    stageSource?: LegacyHomeProps['stageSource'];
    activePlaybackContext: 'main' | 'stage';
    openStagePlayer: () => Promise<void>;
    stageStatus?: LegacyHomeProps['stageStatus'];
    setStageStatus: React.Dispatch<React.SetStateAction<any>>;
    leaveStagePlayback: () => void;
    clearStagePlaybackSession: () => void;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadStageSessionIntoPlayback: (session: any) => Promise<void>;
    enableNowPlayingStage?: LegacyHomeProps['enableNowPlayingStage'];
    handleToggleNowPlayingStage: (enabled: boolean) => void;
    nowPlayingConnectionStatus?: LegacyHomeProps['nowPlayingConnectionStatus'];
    staticMode?: LegacyHomeProps['staticMode'];
    disableHomeDynamicBackground?: LegacyHomeProps['disableHomeDynamicBackground'];
    hidePlayerProgressBar?: LegacyHomeProps['hidePlayerProgressBar'];
    hidePlayerTranslationSubtitle?: LegacyHomeProps['hidePlayerTranslationSubtitle'];
    hidePlayerRightPanelButton?: LegacyHomeProps['hidePlayerRightPanelButton'];
    handleToggleStaticMode?: LegacyHomeProps['onToggleStaticMode'];
    handleToggleDisableHomeDynamicBackground?: LegacyHomeProps['onToggleDisableHomeDynamicBackground'];
    handleToggleHidePlayerProgressBar?: LegacyHomeProps['onToggleHidePlayerProgressBar'];
    handleToggleHidePlayerTranslationSubtitle?: LegacyHomeProps['onToggleHidePlayerTranslationSubtitle'];
    handleToggleHidePlayerRightPanelButton?: LegacyHomeProps['onToggleHidePlayerRightPanelButton'];
    enableMediaCache?: LegacyHomeProps['enableMediaCache'];
    handleToggleMediaCache?: LegacyHomeProps['onToggleMediaCache'];
    theme: LegacyHomeProps['theme'];
    backgroundOpacity: LegacyHomeProps['backgroundOpacity'];
    handleSetBackgroundOpacity: LegacyHomeProps['setBackgroundOpacity'];
    bgMode: LegacyHomeProps['bgMode'];
    applyDefaultTheme: LegacyHomeProps['onApplyDefaultTheme'];
    hasCustomTheme: LegacyHomeProps['hasCustomTheme'];
    getThemeParkSeedTheme: LegacyHomeProps['themeParkInitialTheme'];
    isCustomThemePreferred: LegacyHomeProps['isCustomThemePreferred'];
    saveCustomDualTheme: LegacyHomeProps['onSaveCustomTheme'];
    applyCustomTheme: LegacyHomeProps['onApplyCustomTheme'];
    handleCustomThemePreferenceChange: LegacyHomeProps['onToggleCustomThemePreferred'];
    isDaylight: LegacyHomeProps['isDaylight'];
    visualizerMode: LegacyHomeProps['visualizerMode'];
    cadenzaTuning: LegacyHomeProps['cadenzaTuning'];
    partitaTuning: LegacyHomeProps['partitaTuning'];
    fumeTuning: LegacyHomeProps['fumeTuning'];
    handleSetVisualizerMode: LegacyHomeProps['onVisualizerModeChange'];
    handleSetPartitaTuning: LegacyHomeProps['onPartitaTuningChange'];
    handleResetPartitaTuning: LegacyHomeProps['onResetPartitaTuning'];
    handleSetFumeTuning: LegacyHomeProps['onFumeTuningChange'];
    handleResetFumeTuning: LegacyHomeProps['onResetFumeTuning'];
    lyricsFontStyle: LegacyHomeProps['lyricsFontStyle'];
    lyricsFontScale: LegacyHomeProps['lyricsFontScale'];
    lyricsCustomFontFamily: LegacyHomeProps['lyricsCustomFontFamily'];
    lyricsCustomFontLabel: LegacyHomeProps['lyricsCustomFontLabel'];
    lyricFilterPattern: LegacyHomeProps['lyricFilterPattern'];
    showOpenPanelCloseButton: LegacyHomeProps['showOpenPanelCloseButton'];
    handleSetLyricsFontStyle: LegacyHomeProps['onLyricsFontStyleChange'];
    handleSetLyricsFontScale: LegacyHomeProps['onLyricsFontScaleChange'];
    handleSetLyricsCustomFont: LegacyHomeProps['onLyricsCustomFontChange'];
    loadCurrentSongLyricPreview: LegacyHomeProps['loadLyricFilterPreview'];
    handleSaveLyricFilterPattern: LegacyHomeProps['onSaveLyricFilterPattern'];
    handleToggleOpenPanelCloseButton: LegacyHomeProps['onToggleOpenPanelCloseButton'];
};

// Builds the full Home model from raw app dependencies so App.tsx no longer assembles nested props inline.
export const buildHomeModel = ({
    playSong,
    navigateToPlayer,
    refreshUserData,
    user,
    playlists,
    cloudPlaylist,
    currentSong,
    playerState,
    handlePlaylistSelect,
    handleAlbumSelect,
    handleArtistSelect,
    focusedPlaylistIndex,
    setFocusedPlaylistIndex,
    focusedFavoriteAlbumIndex,
    setFocusedFavoriteAlbumIndex,
    focusedRadioIndex,
    setFocusedRadioIndex,
    pendingOpenSettings,
    setPendingOpenSettings,
    navigateToSearch,
    openLocalAlbumByName,
    openLocalArtistByName,
    localSongs,
    localPlaylists,
    onRefreshLocalSongs,
    onPlayLocalSong,
    onAddLocalSongToQueue,
    localMusicState,
    setLocalMusicState,
    onMatchSong,
    onPlayNavidromeSong,
    onAddNavidromeSongsToQueue,
    onMatchNavidromeSong,
    navidromeFocusedAlbumIndex,
    setNavidromeFocusedAlbumIndex,
    pendingNavidromeSelection,
    setPendingNavidromeSelection,
    stageSource,
    activePlaybackContext,
    openStagePlayer,
    stageStatus,
    setStageStatus,
    leaveStagePlayback,
    clearStagePlaybackSession,
    clearPersistedStagePlaybackCache,
    loadStageSessionIntoPlayback,
    enableNowPlayingStage,
    handleToggleNowPlayingStage,
    nowPlayingConnectionStatus,
    staticMode,
    disableHomeDynamicBackground,
    hidePlayerProgressBar,
    hidePlayerTranslationSubtitle,
    hidePlayerRightPanelButton,
    handleToggleStaticMode,
    handleToggleDisableHomeDynamicBackground,
    handleToggleHidePlayerProgressBar,
    handleToggleHidePlayerTranslationSubtitle,
    handleToggleHidePlayerRightPanelButton,
    enableMediaCache,
    handleToggleMediaCache,
    theme,
    backgroundOpacity,
    handleSetBackgroundOpacity,
    bgMode,
    applyDefaultTheme,
    hasCustomTheme,
    getThemeParkSeedTheme,
    isCustomThemePreferred,
    saveCustomDualTheme,
    applyCustomTheme,
    handleCustomThemePreferenceChange,
    isDaylight,
    visualizerMode,
    cadenzaTuning,
    partitaTuning,
    fumeTuning,
    handleSetVisualizerMode,
    handleSetPartitaTuning,
    handleResetPartitaTuning,
    handleSetFumeTuning,
    handleResetFumeTuning,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsCustomFontFamily,
    lyricsCustomFontLabel,
    lyricFilterPattern,
    showOpenPanelCloseButton,
    handleSetLyricsFontStyle,
    handleSetLyricsFontScale,
    handleSetLyricsCustomFont,
    loadCurrentSongLyricPreview,
    handleSaveLyricFilterPattern,
    handleToggleOpenPanelCloseButton,
}: BuildHomeModelParams): HomeViewModel => {
    return {
        legacyProps: {
            onPlaySong: playSong,
            onBackToPlayer: navigateToPlayer,
            onRefreshUser: () => refreshUserData(),
            user,
            playlists,
            cloudPlaylist,
            currentTrack: currentSong,
            isPlaying: playerState === 'playing',
            onSelectPlaylist: handlePlaylistSelect,
            onSelectAlbum: handleAlbumSelect,
            onSelectArtist: handleArtistSelect,
            focusedPlaylistIndex,
            setFocusedPlaylistIndex,
            focusedFavoriteAlbumIndex,
            setFocusedFavoriteAlbumIndex,
            focusedRadioIndex,
            setFocusedRadioIndex,
            pendingOpenSettings,
            onPendingOpenSettingsHandled: () => setPendingOpenSettings(false),
            onSearchCommitted: (query, sourceTab, replace = false) => {
                navigateToSearch({ query, sourceTab, replace });
            },
            onSelectLocalAlbum: openLocalAlbumByName,
            onSelectLocalArtist: openLocalArtistByName,
            localSongs,
            localPlaylists,
            onRefreshLocalSongs,
            onPlayLocalSong,
            onAddLocalSongToQueue,
            localMusicState,
            setLocalMusicState,
            onMatchSong,
            onPlayNavidromeSong,
            onAddNavidromeSongsToQueue,
            onMatchNavidromeSong,
            navidromeFocusedAlbumIndex,
            setNavidromeFocusedAlbumIndex,
            pendingNavidromeSelection,
            onPendingNavidromeSelectionHandled: () => setPendingNavidromeSelection(null),
            stageEnabled: Boolean(stageSource),
            stageSource,
            stageIsActive: activePlaybackContext === 'stage',
            onOpenStagePlayer: () => {
                void openStagePlayer();
            },
            stageStatus,
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
                if (!window.electron?.saveSettings) {
                    return;
                }
                await window.electron.saveSettings('STAGE_MODE_SOURCE', source);
            },
            onRegenerateStageToken: async () => {
                const nextStatus = await window.electron?.regenerateStageToken();
                if (nextStatus) {
                    setStageStatus(nextStatus);
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
            enableNowPlayingStage,
            onToggleNowPlayingStage: async (enabled) => {
                handleToggleNowPlayingStage(enabled);
                if (!enabled && activePlaybackContext === 'stage') {
                    leaveStagePlayback();
                }
            },
            nowPlayingConnectionStatus,
            staticMode,
            disableHomeDynamicBackground,
            hidePlayerProgressBar,
            hidePlayerTranslationSubtitle,
            hidePlayerRightPanelButton,
            onToggleStaticMode: handleToggleStaticMode,
            onToggleDisableHomeDynamicBackground: handleToggleDisableHomeDynamicBackground,
            onToggleHidePlayerProgressBar: handleToggleHidePlayerProgressBar,
            onToggleHidePlayerTranslationSubtitle: handleToggleHidePlayerTranslationSubtitle,
            onToggleHidePlayerRightPanelButton: handleToggleHidePlayerRightPanelButton,
            enableMediaCache,
            onToggleMediaCache: handleToggleMediaCache,
            theme,
            backgroundOpacity,
            setBackgroundOpacity: handleSetBackgroundOpacity,
            bgMode,
            onApplyDefaultTheme: applyDefaultTheme,
            hasCustomTheme,
            themeParkInitialTheme: getThemeParkSeedTheme,
            isCustomThemePreferred,
            onSaveCustomTheme: saveCustomDualTheme,
            onApplyCustomTheme: applyCustomTheme,
            onToggleCustomThemePreferred: handleCustomThemePreferenceChange,
            isDaylight,
            visualizerMode,
            cadenzaTuning,
            partitaTuning,
            fumeTuning,
            onVisualizerModeChange: handleSetVisualizerMode,
            onPartitaTuningChange: handleSetPartitaTuning,
            onResetPartitaTuning: handleResetPartitaTuning,
            onFumeTuningChange: handleSetFumeTuning,
            onResetFumeTuning: handleResetFumeTuning,
            lyricsFontStyle,
            lyricsFontScale,
            lyricsCustomFontFamily,
            lyricsCustomFontLabel,
            lyricFilterPattern,
            currentSongTitle: currentSong?.name || null,
            showOpenPanelCloseButton,
            onLyricsFontStyleChange: handleSetLyricsFontStyle,
            onLyricsFontScaleChange: handleSetLyricsFontScale,
            onLyricsCustomFontChange: handleSetLyricsCustomFont,
            loadLyricFilterPreview: loadCurrentSongLyricPreview,
            onSaveLyricFilterPattern: handleSaveLyricFilterPattern,
            onToggleOpenPanelCloseButton: handleToggleOpenPanelCloseButton,
        },
    };
};
