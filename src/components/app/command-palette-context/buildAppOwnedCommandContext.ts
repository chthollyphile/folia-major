import type { CommandPaletteContext } from '../../command-palette/types';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { usePersonalFmModeStore } from '../../../stores/usePersonalFmModeStore';
import { useDesktopSettingsStore } from '../../../stores/useDesktopSettingsStore';
import { openAddToPlaylist, useAddToPlaylistStore } from '../../../stores/useAddToPlaylistStore';

// src/components/app/command-palette-context/buildAppOwnedCommandContext.ts
// The four namespaces whose state genuinely still lives in App.tsx: shared, playback, navigation
// and panel.
//
// Volume, mute, the equalizer entry points and the Personal FM selection are the exceptions —
// those already have stores, so they are read here rather than relayed. Everything else is the
// playback transport and queue, which App.tsx's controller hooks still own; moving those is the
// next slice, not this one.

export type SharedCommandContextDeps = Pick<
    CommandPaletteContext['shared'], 't' | 'currentSong' | 'lyrics' | 'playerState'
>;

export type PlaybackCommandContextDeps = Pick<
    CommandPaletteContext['playback'],
    | 'previewVolume' | 'togglePlay' | 'toggleLoop' | 'next' | 'prev' | 'queue' | 'playSong'
    | 'shuffleQueue' | 'clearQueue' | 'applyQueueBatchOperation' | 'removeQueueSong'
    | 'moveQueueSongToNext' | 'moveQueueSongToEnd' | 'setReplayGainMode' | 'isFmMode'
    | 'isPersonalFmModeSupported' | 'setPersonalFmSelection' | 'runAutoMatchBestLyric'
    | 'toggleSongLike' | 'isSongLiked'
>;

export type NavigationCommandContextDeps = Pick<
    CommandPaletteContext['navigation'],
    | 'navigateToHome' | 'navigateToPlayer' | 'navigateToLattice' | 'setHomeViewTab' | 'toggleBrowserFullscreen'
    | 'toggleRemoteControlWindow' | 'toggleMainWindowAlwaysOnTop'
>;

export type PanelCommandContextDeps = CommandPaletteContext['panel'];

export const buildSharedCommandContext = (
    deps: SharedCommandContextDeps,
): CommandPaletteContext['shared'] => ({
    t: deps.t,
    setStatusMsg: setStatusMessage,
    currentSong: deps.currentSong,
    lyrics: deps.lyrics,
    playerState: deps.playerState,
});

export const buildPlaybackCommandContext = (
    deps: PlaybackCommandContextDeps,
): CommandPaletteContext['playback'] => {
    const audio = useAudioSettingsStore.getState();
    return {
        ...deps,
        volume: audio.volume,
        isMuted: audio.isMuted,
        setVolume: audio.handleSetVolume,
        toggleMute: audio.handleToggleMute,
        openAddToPlaylist,
        canAddCurrentSongToPlaylist: useAddToPlaylistStore.getState().availability.canAdd,
        personalFmSelection: usePersonalFmModeStore.getState().selection,
        openAudioEqualizer: audio.openAudioEqualizer,
        applyAudioSoundPreset: audio.handleApplyAudioSoundPreset,
    };
};

export const buildNavigationCommandContext = (
    deps: NavigationCommandContextDeps,
): CommandPaletteContext['navigation'] => ({
    ...deps,
    isWallpaperMode: useDesktopSettingsStore.getState().wallpaperMode,
});

export const buildPanelCommandContext = (
    deps: PanelCommandContextDeps,
): CommandPaletteContext['panel'] => deps;
