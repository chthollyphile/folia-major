import type { PlaybackNavigationOptions } from '../../../types/appPlayback';
import type { SongResult } from '../../../types';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { locatePlayingSong } from '../playing-song-locator/playingSongLocator';
import { locatePlayingSongOnWall } from '../lattice/wallLocate';
import type { CommandPaletteContext } from '../../command-palette/types';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getPersonalFmSelection, usePersonalFmModeStore } from '../../../stores/usePersonalFmModeStore';
import { useDesktopSettingsStore } from '../../../stores/useDesktopSettingsStore';
import { openAddToPlaylist, useAddToPlaylistStore } from '../../../stores/useAddToPlaylistStore';
import { useInteractionSettingsStore } from '../../../stores/useInteractionSettingsStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { isLocalPlaybackSong } from '../../../utils/appPlaybackGuards';
import { openHifiSignalPath } from '../../hifi/hifiPanelStore';

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
    | 'previewVolume' | 'togglePlay' | 'toggleLoop' | 'next' | 'prev' | 'queue'
    | 'shuffleQueue' | 'clearQueue' | 'applyQueueBatchOperation' | 'removeQueueSong'
    | 'moveQueueSongToNext' | 'moveQueueSongToEnd' | 'setReplayGainMode' | 'isFmMode'
    | 'isPersonalFmModeSupported' | 'setPersonalFmSelection' | 'runAutoMatchBestLyric' | 'toggleCurrentSongPureMusicMark'
    | 'toggleSongLike' | 'isSongLiked'
> & {
    playSong: (song: SongResult, queue?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => void | Promise<void>;
};

export type NavigationCommandContextDeps = Pick<
    CommandPaletteContext['navigation'],
    | 'navigateToHome' | 'navigateToPlayer' | 'navigateToLattice' | 'selectHomeViewTab' | 'toggleBrowserFullscreen'
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
    const interaction = useInteractionSettingsStore.getState();
    return {
        ...deps,
        queuePaletteKeepOpen: interaction.queuePaletteKeepOpen,
        setQueuePaletteKeepOpen: interaction.setQueuePaletteKeepOpen,
        // Queue selection follows the surface that owns playback at execution time.
        playSong: (song, queue) => deps.playSong(song, queue, false, {
            shouldNavigateToPlayer: useAppViewStore.getState().view !== 'lattice',
        }),
        volume: audio.volume,
        isMuted: audio.isMuted,
        setVolume: audio.handleSetVolume,
        // Read from the store at the press, not from this snapshot: a held key repeats faster
        // than the context is rebuilt, and each step has to start where the last one ended. Turning
        // it up also unmutes, like a keyboard's volume key: otherwise the number rises in silence.
        stepVolume: (delta) => {
            const live = useAudioSettingsStore.getState();
            if (delta > 0 && live.isMuted) {
                live.handleSetMuted(false);
            }
            const next = Math.round(Math.min(1, Math.max(0, live.volume + delta)) * 100) / 100;
            live.handleSetVolume(next);
        },
        toggleMute: audio.handleToggleMute,
        openAddToPlaylist,
        canAddCurrentSongToPlaylist: useAddToPlaylistStore.getState().availability.canAdd,
        canToggleCurrentSongPureMusicMark: isLocalPlaybackSong(usePlaybackStore.getState().currentSong),
        personalFmSelection: getPersonalFmSelection(useOnlineProviderAccountStore.getState().activeProviderId),
        personalFmCatalog: usePersonalFmModeStore.getState().catalogs[useOnlineProviderAccountStore.getState().activeProviderId],
        openAudioEqualizer: audio.openAudioEqualizer,
        applyAudioSoundPreset: audio.handleApplyAudioSoundPreset,
        // Read at the press: a mod's curve comes and goes without this context being rebuilt.
        hasModEqualizerCurve: () => useAudioSettingsStore.getState().audioEqualizerModCurve !== null,
        releaseModEqualizerCurve: () => {
            useAudioSettingsStore.getState().handleReleaseModEqualizerCurve({ kind: 'command' });
        },
        // Read at the press: each new song picks its route without this context being rebuilt.
        isHifiRoute: () => usePlaybackStore.getState().playbackRoute === 'hifi',
        openHifiSignalPath,
    };
};

export const buildNavigationCommandContext = (
    deps: NavigationCommandContextDeps,
): CommandPaletteContext['navigation'] => ({
    ...deps,
    locatePlayingSongOnWall,
    locatePlayingSong,
    isWallpaperMode: useDesktopSettingsStore.getState().wallpaperMode,
    isWindowAlwaysOnTopSupported: useDesktopSettingsStore.getState().windowAlwaysOnTopSupported,
});

export const buildPanelCommandContext = (
    deps: PanelCommandContextDeps,
): CommandPaletteContext['panel'] => deps;
