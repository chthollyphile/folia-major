import { useMemo } from 'react';
import { useNowPlayingCardPositioningEntry } from './now-playing-toast/useNowPlayingCardPositioningEntry';
import { useNowPlayingCardLayoutStore } from './now-playing-toast/nowPlayingCardLayoutStore';
import { currentTime, lyricCurrentTime } from '../../../stores/motionSignals';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { useAppChromeStore } from '../../../stores/useAppChromeStore';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { useStageSettingsStore } from '../../../stores/useStageSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useTranslation } from 'react-i18next';
import {
    selectDisplayCoverUrl,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
    usePlaybackStore,
} from '../../../stores/usePlaybackStore';
import { resolveLikeAvailability } from '../../../utils/playerLikeAvailability';
import { canShuffleQueue } from '../../../utils/playbackNeighbors';
import { buildAppOverlaysModel, type AppOverlaysDeps, type AppOverlaysModel } from './buildAppOverlaysModel';

// src/components/app/overlays/useAppOverlaysModel.ts

const MEMORY_MONITOR_SHORTCUT_LABEL = 'Alt+Shift+M';

/**
 * The overlay model with everything this file can reach on its own already filled in.
 *
 * Store reads, the two motion signals and the five translated labels used to be 25 entries in
 * App.tsx's argument list plus 25 more in its dependency array - and adding one overlay field meant
 * editing App.tsx, the params type and the mapping below. Now a store-backed field is this file
 * alone.
 */
export const useAppOverlaysModel = (deps: AppOverlaysDeps): AppOverlaysModel => {
    const { t } = useTranslation();
    useNowPlayingCardPositioningEntry(deps.navigateToPlayer);
    const cardPositioning = useNowPlayingCardLayoutStore(state => state.isPositioning);
    const currentView = useAppViewStore(state => state.view);
    const isPlayerChromeHidden = useAppChromeStore(state => state.isPlayerChromeHidden);
    const isDevDebugOverlayVisible = useAppChromeStore(state => state.isDevDebugOverlayVisible);
    const isMemoryMonitorVisible = useAppChromeStore(state => state.isMemoryMonitorVisible);
    const isSearchOpen = useSearchNavigationStore(state => state.isSearchOpen);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const stageTrackPillMode = useStageSettingsStore(state => state.stageTrackPillMode);
    const stageTrackPillTimeoutSec = useStageSettingsStore(state => state.stageTrackPillTimeoutSec);
    const playerControlSlotPrimary = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const playerControlSlotSecondary = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const handleSetPlayerBottomBarOffset = usePlayerChromeSettingsStore(state => state.handleSetPlayerBottomBarOffset);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    // The held picture, not the live one: a blend keeps song, lyrics, duration and cover describing
    // the same track for its whole length. See the note on `coverUrl` above.
    const displaySong = usePlaybackStore(selectDisplaySong);
    const displayLyrics = usePlaybackStore(selectDisplayLyrics);
    const displayCoverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const displayDuration = usePlaybackStore(selectDisplayDuration);
    const displayPlayerState = usePlaybackStore(selectDisplayPlayerState);
    const playerControlSlotContext = useMemo(() => ({
        onShuffle: deps.shuffleQueue,
        canShuffle: canShuffleQueue(playQueue.length, isFmMode, deps.isNowPlayingStageActive),
        onLike: deps.handleLike,
        isLiked: deps.isDisplaySongLiked,
        likeDisabled: resolveLikeAvailability(
            displaySong,
            deps.isNowPlayingControlDisabled,
            activePlaybackContext === 'stage',
        ).disabled,
        invokeCommandById: deps.invokeCommandById,
        canInvokeCommandById: deps.canInvokeCommandById,
    }), [
        activePlaybackContext,
        deps.canInvokeCommandById,
        deps.handleLike,
        deps.invokeCommandById,
        deps.isDisplaySongLiked,
        deps.isNowPlayingControlDisabled,
        deps.isNowPlayingStageActive,
        deps.shuffleQueue,
        displaySong,
        isFmMode,
        playQueue.length,
    ]);

    return useMemo(() => buildAppOverlaysModel({
        ...deps,
        currentView,
        isSearchOpen,
        isDaylight,
        isDevDebugOverlayVisible,
        isMemoryMonitorVisible,
        memoryMonitorShortcutLabel: MEMORY_MONITOR_SHORTCUT_LABEL,
        currentTime,
        lyricCurrentTime,
        currentSong: displaySong,
        playerState: displayPlayerState,
        duration: displayDuration,
        audioSrc,
        lyrics: displayLyrics,
        activePlaybackContext,
        isPlayerChromeHidden,
        playQueue,
        isFmMode,
        coverUrl: displayCoverUrl,
        stageTrackPillMode: cardPositioning ? 'always' : stageTrackPillMode,
        stageTrackPillOnScreen: deps.stageTrackPillOnScreen || (cardPositioning && currentView === 'player'),
        stageTrackPillTimeoutSec,
        noTrackText: t('ui.noTrack'),
        prevTrackLabel: t('ui.previousTrack'),
        nextTrackLabel: t('ui.nextTrack'),
        stageTrackPillOpenPlayerLabel: t('ui.stageTrackPillOpenPlayer'),
        stageTrackPillOpenSongCardLabel: t('ui.stageTrackPillOpenSongCard'),
        stageTrackPillFocusLatticeLabel: t('playlist.locatePlaying'),
        playerControlSlotPrimary,
        playerControlSlotSecondary,
        playerControlSlotContext,
        onCommitPlayerBottomBarOffset: handleSetPlayerBottomBarOffset,
        // Spread rather than `deps`: the caller passes an object literal, so depending on the object
        // itself would rebuild this on every render and defeat the memo entirely. The key set is
        // fixed by the call site, so the array keeps a constant length.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [
        ...Object.values(deps),
        cardPositioning,
        currentView,
        isSearchOpen,
        isDaylight,
        isDevDebugOverlayVisible,
        isMemoryMonitorVisible,
        displaySong,
        displayPlayerState,
        displayDuration,
        audioSrc,
        displayLyrics,
        activePlaybackContext,
        isPlayerChromeHidden,
        playQueue,
        isFmMode,
        displayCoverUrl,
        stageTrackPillMode,
        stageTrackPillTimeoutSec,
        playerControlSlotPrimary,
        playerControlSlotSecondary,
        playerControlSlotContext,
        handleSetPlayerBottomBarOffset,
        t,
    ]);
};
