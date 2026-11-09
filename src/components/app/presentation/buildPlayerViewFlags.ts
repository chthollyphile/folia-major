import type { PlaybackRoute } from '../../../types/hifi';

// src/components/app/presentation/buildPlayerViewFlags.ts

// Builds top-level player-view booleans used by the shell, overlays, and floating controls.
export const buildPlayerViewFlags = ({
    currentView,
    disableHomeDynamicBackground,
    hidePlayerProgressBar,
    hidePlayerTranslationSubtitle,
    hidePlayerRightPanelButton,
    isNowPlayingControlDisabled,
    activePlaybackContext,
    stageActiveEntryKind,
    audioSrc,
    duration,
    playbackRoute,
    hasHifiTrack,
    hasExternalSong,
}: {
    currentView: string;
    disableHomeDynamicBackground: boolean;
    hidePlayerProgressBar: boolean;
    hidePlayerTranslationSubtitle: boolean;
    hidePlayerRightPanelButton: boolean;
    isNowPlayingControlDisabled: boolean;
    activePlaybackContext: 'main' | 'stage';
    stageActiveEntryKind: string | null;
    audioSrc: string | null;
    duration: number;
    /** Which engine sounds the current song. On 'hifi' audioSrc is always null: mpv plays it. */
    playbackRoute: PlaybackRoute;
    /** useHifiTrackStore has a current track (loading, ready, or the one mpv still holds). */
    hasHifiTrack: boolean;
    /** The song on screen plays in a provider's own player outside this app (external route). */
    hasExternalSong: boolean;
}) => {
    const isPlayerView = currentView === 'player';
    return {
        isPlayerView,
        shouldPauseVisualizerBackground: currentView !== 'player' && disableHomeDynamicBackground,
        shouldHidePlayerProgressBar: isPlayerView && hidePlayerProgressBar,
        shouldHidePlayerTranslationSubtitle: isPlayerView && hidePlayerTranslationSubtitle,
        shouldHidePlayerRightPanelButton: isPlayerView && hidePlayerRightPanelButton,
        canToggleCurrentPlayback: !isNowPlayingControlDisabled && Boolean(
            audioSrc
            || (playbackRoute === 'hifi' && hasHifiTrack)
            // Not gated on the route: a song restored paused has no route of its own yet, and the
            // transport starts the provider's player when it is pressed.
            || hasExternalSong
            || (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && duration > 0),
        ),
    };
};
