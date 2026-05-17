import { useMemo } from 'react';
import type React from 'react';
import LegacyHome from '../../Home';

// Home view model flattens grouped app state into the legacy Home surface.
type LegacyHomeProps = React.ComponentProps<typeof LegacyHome>;

type HomeViewModelInput = {
    navigation: {
        onPlaySong: LegacyHomeProps['onPlaySong'];
        onBackToPlayer: LegacyHomeProps['onBackToPlayer'];
        onRefreshUser: LegacyHomeProps['onRefreshUser'];
        user: LegacyHomeProps['user'];
        playlists: LegacyHomeProps['playlists'];
        cloudPlaylist?: LegacyHomeProps['cloudPlaylist'];
        currentTrack?: LegacyHomeProps['currentTrack'];
        isPlaying: LegacyHomeProps['isPlaying'];
        onSelectPlaylist: LegacyHomeProps['onSelectPlaylist'];
        onSelectAlbum: LegacyHomeProps['onSelectAlbum'];
        onSelectArtist: LegacyHomeProps['onSelectArtist'];
        focusedPlaylistIndex?: LegacyHomeProps['focusedPlaylistIndex'];
        setFocusedPlaylistIndex?: LegacyHomeProps['setFocusedPlaylistIndex'];
        focusedFavoriteAlbumIndex?: LegacyHomeProps['focusedFavoriteAlbumIndex'];
        setFocusedFavoriteAlbumIndex?: LegacyHomeProps['setFocusedFavoriteAlbumIndex'];
        focusedRadioIndex?: LegacyHomeProps['focusedRadioIndex'];
        setFocusedRadioIndex?: LegacyHomeProps['setFocusedRadioIndex'];
        pendingOpenSettings?: LegacyHomeProps['pendingOpenSettings'];
        onPendingOpenSettingsHandled?: LegacyHomeProps['onPendingOpenSettingsHandled'];
    };
    search: {
        onSearchCommitted: LegacyHomeProps['onSearchCommitted'];
    };
    localLibrary: {
        onSelectLocalAlbum?: LegacyHomeProps['onSelectLocalAlbum'];
        onSelectLocalArtist?: LegacyHomeProps['onSelectLocalArtist'];
        localSongs: LegacyHomeProps['localSongs'];
        localPlaylists: LegacyHomeProps['localPlaylists'];
        onRefreshLocalSongs: LegacyHomeProps['onRefreshLocalSongs'];
        onPlayLocalSong: LegacyHomeProps['onPlayLocalSong'];
        onAddLocalSongToQueue?: LegacyHomeProps['onAddLocalSongToQueue'];
        localMusicState: LegacyHomeProps['localMusicState'];
        setLocalMusicState: LegacyHomeProps['setLocalMusicState'];
        onMatchSong?: LegacyHomeProps['onMatchSong'];
    };
    navidrome: {
        onPlayNavidromeSong?: LegacyHomeProps['onPlayNavidromeSong'];
        onAddNavidromeSongsToQueue?: LegacyHomeProps['onAddNavidromeSongsToQueue'];
        onMatchNavidromeSong?: LegacyHomeProps['onMatchNavidromeSong'];
        navidromeFocusedAlbumIndex?: LegacyHomeProps['navidromeFocusedAlbumIndex'];
        setNavidromeFocusedAlbumIndex?: LegacyHomeProps['setNavidromeFocusedAlbumIndex'];
        pendingNavidromeSelection?: LegacyHomeProps['pendingNavidromeSelection'];
        onPendingNavidromeSelectionHandled?: LegacyHomeProps['onPendingNavidromeSelectionHandled'];
    };
    stage: {
        stageEnabled?: LegacyHomeProps['stageEnabled'];
        stageSource?: LegacyHomeProps['stageSource'];
        stageIsActive?: LegacyHomeProps['stageIsActive'];
        onOpenStagePlayer?: LegacyHomeProps['onOpenStagePlayer'];
        stageStatus?: LegacyHomeProps['stageStatus'];
        onToggleStageMode?: LegacyHomeProps['onToggleStageMode'];
        onStageSourceChange?: LegacyHomeProps['onStageSourceChange'];
        onRegenerateStageToken?: LegacyHomeProps['onRegenerateStageToken'];
        onClearStageState?: LegacyHomeProps['onClearStageState'];
        enableNowPlayingStage?: LegacyHomeProps['enableNowPlayingStage'];
        onToggleNowPlayingStage?: LegacyHomeProps['onToggleNowPlayingStage'];
        nowPlayingConnectionStatus?: LegacyHomeProps['nowPlayingConnectionStatus'];
    };
    appearance: {
        staticMode?: LegacyHomeProps['staticMode'];
        disableHomeDynamicBackground?: LegacyHomeProps['disableHomeDynamicBackground'];
        hidePlayerProgressBar?: LegacyHomeProps['hidePlayerProgressBar'];
        hidePlayerTranslationSubtitle?: LegacyHomeProps['hidePlayerTranslationSubtitle'];
        hidePlayerRightPanelButton?: LegacyHomeProps['hidePlayerRightPanelButton'];
        onToggleStaticMode?: LegacyHomeProps['onToggleStaticMode'];
        onToggleDisableHomeDynamicBackground?: LegacyHomeProps['onToggleDisableHomeDynamicBackground'];
        onToggleHidePlayerProgressBar?: LegacyHomeProps['onToggleHidePlayerProgressBar'];
        onToggleHidePlayerTranslationSubtitle?: LegacyHomeProps['onToggleHidePlayerTranslationSubtitle'];
        onToggleHidePlayerRightPanelButton?: LegacyHomeProps['onToggleHidePlayerRightPanelButton'];
        enableMediaCache?: LegacyHomeProps['enableMediaCache'];
        onToggleMediaCache?: LegacyHomeProps['onToggleMediaCache'];
        theme: LegacyHomeProps['theme'];
        backgroundOpacity: LegacyHomeProps['backgroundOpacity'];
        setBackgroundOpacity: LegacyHomeProps['setBackgroundOpacity'];
        bgMode: LegacyHomeProps['bgMode'];
        onApplyDefaultTheme: LegacyHomeProps['onApplyDefaultTheme'];
        hasCustomTheme: LegacyHomeProps['hasCustomTheme'];
        themeParkInitialTheme: LegacyHomeProps['themeParkInitialTheme'];
        isCustomThemePreferred: LegacyHomeProps['isCustomThemePreferred'];
        onSaveCustomTheme: LegacyHomeProps['onSaveCustomTheme'];
        onApplyCustomTheme: LegacyHomeProps['onApplyCustomTheme'];
        onToggleCustomThemePreferred: LegacyHomeProps['onToggleCustomThemePreferred'];
        isDaylight: LegacyHomeProps['isDaylight'];
        visualizerMode: LegacyHomeProps['visualizerMode'];
        cadenzaTuning: LegacyHomeProps['cadenzaTuning'];
        partitaTuning: LegacyHomeProps['partitaTuning'];
        fumeTuning: LegacyHomeProps['fumeTuning'];
        onVisualizerModeChange: LegacyHomeProps['onVisualizerModeChange'];
        onPartitaTuningChange: LegacyHomeProps['onPartitaTuningChange'];
        onResetPartitaTuning: LegacyHomeProps['onResetPartitaTuning'];
        onFumeTuningChange: LegacyHomeProps['onFumeTuningChange'];
        onResetFumeTuning: LegacyHomeProps['onResetFumeTuning'];
        lyricsFontStyle: LegacyHomeProps['lyricsFontStyle'];
        lyricsFontScale: LegacyHomeProps['lyricsFontScale'];
        lyricsCustomFontFamily: LegacyHomeProps['lyricsCustomFontFamily'];
        lyricsCustomFontLabel: LegacyHomeProps['lyricsCustomFontLabel'];
        lyricFilterPattern: LegacyHomeProps['lyricFilterPattern'];
        currentSongTitle?: LegacyHomeProps['currentSongTitle'];
        showOpenPanelCloseButton: LegacyHomeProps['showOpenPanelCloseButton'];
        onLyricsFontStyleChange: LegacyHomeProps['onLyricsFontStyleChange'];
        onLyricsFontScaleChange: LegacyHomeProps['onLyricsFontScaleChange'];
        onLyricsCustomFontChange: LegacyHomeProps['onLyricsCustomFontChange'];
        loadLyricFilterPreview: LegacyHomeProps['loadLyricFilterPreview'];
        onSaveLyricFilterPattern: LegacyHomeProps['onSaveLyricFilterPattern'];
        onToggleOpenPanelCloseButton: LegacyHomeProps['onToggleOpenPanelCloseButton'];
    };
};

export type HomeViewModel = HomeViewModelInput & {
    legacyProps: LegacyHomeProps;
};

export const useHomeViewModel = (input: HomeViewModelInput): HomeViewModel => {
    return useMemo(() => ({
        ...input,
        legacyProps: {
            ...input.navigation,
            ...input.search,
            ...input.localLibrary,
            ...input.navidrome,
            ...input.stage,
            ...input.appearance,
        },
    }), [input]);
};
