import { useEffect, useRef } from 'react';
import type { SongResult } from '@/types';
import { PlayerState } from '@/types';
import {
    usePlaybackStore,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
} from '@/stores/usePlaybackStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { setStatusMessage } from '@/stores/useStatusMessageStore';
import { currentTime } from '@/stores/motionSignals';
import type { PanelTab } from '@/components/UnifiedPanel';
import { clampMediaVolume } from '@/utils/appPlaybackHelpers';
import { resolveLikeAvailability } from '@/utils/playerLikeAvailability';
import { buildFoliumQueueSnapshot, resolveFoliumQueuePlayRequest } from './hostQueue';
import { canShuffleQueue } from '@/utils/playbackNeighbors';
import { rerunLyricsTransform } from '@/services/hostExtensionHooks';
import { resolveFoliumSongRef, toFoliumLines, toFoliumSong } from '../folium/dto';
import { emitFoliumEvent } from '../folium/events';
import { registerFoliumHostActions } from '../folium/services';
import { showRefreshedLyrics } from './hostEvents';
import { registerFoliumQueueWriter, replaceFoliumQueue } from './queue/hostQueueReplace';

// src/mods/runtime/hostActions.ts
// App registers the real host actions behind folium.playback / folium.ui here.
// Handlers are read through a ref, so the registration happens once and always
// calls App's latest callbacks without re-registering on every render.

export interface FoliumAppActions {
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (seconds: number) => void;
    seekToLyricTime: (lyricSeconds: number) => void;
    next: () => void;
    previous: () => void;
    playSong: (song: SongResult) => void | Promise<void>;
    /**
     * playQueueItem: plays `song` within `queue`, which must be the store's playQueue array itself
     * (the queue controller then retries and skips a failure against the live queue), keeping
     * Personal FM on when `isFm`.
     */
    playQueueSong: (song: SongResult, queue: SongResult[], isFm: boolean) => void | Promise<void>;
    enqueue: (song: SongResult) => void;
    navigateToPlayer: () => void;
    navigateToHome: () => void;
    shuffleQueue: () => void;
    toggleLike: () => void | Promise<void>;
    openVolume: () => void;
    /** The displayed song is liked (the value the host's like button shows). */
    isLiked: boolean;
    /** Now-playing controls are off (a blend, no source); the like button greys out with them. */
    controlsDisabled: boolean;
    /** The displayed song's lyrics are still loading (the player's loading mark). */
    isLyricsLoading: boolean;
    /** Folium 1.7: saves a replaced queue for the next launch, as the host's own queue edits are saved. */
    persistQueue: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    /** Folium 1.7: fetches ahead again around the songs a replacement put next to the one playing. */
    refreshQueuePrefetch: (song: SongResult | null, previous: readonly SongResult[], next: SongResult[]) => void;
}

type PlaybackStoreState = ReturnType<typeof usePlaybackStore.getState>;

/*
 * The rule the player bar's shuffle slot asks. Any Stage playback counts as the stage here, as the
 * contract says; the bar and shuffleQueue itself count only the now-playing stage.
 */
const canShuffle = (state: PlaybackStoreState) => (
    canShuffleQueue(state.playQueue.length, state.isFmMode, state.activePlaybackContext === 'stage')
);

export const useFoliumHostActions = (actions: FoliumAppActions) => {
    const actionsRef = useRef(actions);
    actionsRef.current = actions;

    /* Same rule as the player bar's like slot. */
    const canLike = (state: PlaybackStoreState) => !resolveLikeAvailability(
        selectDisplaySong(state),
        actionsRef.current.controlsDisabled,
        state.activePlaybackContext === 'stage',
    ).disabled;

    useEffect(() => {
        registerFoliumHostActions({
            getPlaybackState: () => {
                const state = usePlaybackStore.getState();
                const playerState = selectDisplayPlayerState(state);
                const duration = selectDisplayDuration(state);
                return {
                    song: toFoliumSong(selectDisplaySong(state)),
                    state: playerState === PlayerState.PLAYING ? 'playing' : playerState === PlayerState.PAUSED ? 'paused' : 'stopped',
                    position: currentTime.get(),
                    duration: Number.isFinite(duration) ? duration : 0,
                    liked: Boolean(selectDisplaySong(state)) && actionsRef.current.isLiked,
                    canLike: canLike(state),
                };
            },
            play: () => actionsRef.current.play(),
            pause: () => actionsRef.current.pause(),
            toggle: () => actionsRef.current.toggle(),
            seek: (seconds) => actionsRef.current.seek(seconds),
            seekToLyricTime: (lyricSeconds) => actionsRef.current.seekToLyricTime(lyricSeconds),
            next: () => actionsRef.current.next(),
            previous: () => actionsRef.current.previous(),
            playSongRef: async (ref) => {
                const song = resolveFoliumSongRef(ref);
                if (!song) return false;
                await actionsRef.current.playSong(song);
                return true;
            },
            enqueueSongRef: (ref) => {
                const song = resolveFoliumSongRef(ref);
                if (!song) return false;
                actionsRef.current.enqueue(song);
                return true;
            },
            shuffleQueue: () => {
                if (!canShuffle(usePlaybackStore.getState())) return false;
                actionsRef.current.shuffleQueue();
                return true;
            },
            toggleLike: () => {
                if (!canLike(usePlaybackStore.getState())) return false;
                void actionsRef.current.toggleLike();
                return true;
            },
            // Volume, mute and repeat are store state; App's audio gain follows the store on its own.
            getVolume: () => {
                const audio = useAudioSettingsStore.getState();
                return { volume: clampMediaVolume(audio.volume), muted: audio.isMuted };
            },
            setVolume: (volume) => useAudioSettingsStore.getState().handleSetVolume(volume),
            setMuted: (muted) => useAudioSettingsStore.getState().handleSetMuted(muted),
            getLoopMode: () => useAudioSettingsStore.getState().loopMode,
            // Not gated on Stage playback, like the remote window's repeat button: the mode is a lasting preference.
            setLoopMode: (mode) => useAudioSettingsStore.getState().handleSetLoopMode(mode),
            getQueue: (offset, limit) => buildFoliumQueueSnapshot(usePlaybackStore.getState(), offset, limit),
            playQueueItem: async (index, expectedRef) => {
                const request = resolveFoliumQueuePlayRequest(usePlaybackStore.getState(), index, expectedRef);
                if (!request) return false;
                await actionsRef.current.playQueueSong(request.song, request.queue, request.isFm);
                return true;
            },
            replaceQueue: (modId, refs, expectedVersion) => replaceFoliumQueue(modId, refs, expectedVersion),
            toast: (message, type, durationMs) => setStatusMessage({ type, text: message, ...(durationMs ? { durationMs } : {}) }),
            openPlayerPanel: (tab) => {
                const view = useAppViewStore.getState();
                if (tab) view.setPanelTab(tab as PanelTab);
                view.setIsPanelOpen(true);
            },
            navigate: (target) => (target === 'player' ? actionsRef.current.navigateToPlayer() : actionsRef.current.navigateToHome()),
            openVolume: () => actionsRef.current.openVolume(),
            getLyricLines: () => toFoliumLines(selectDisplayLyrics(usePlaybackStore.getState())?.lines),
            refreshLyrics: () => {
                // While the song's lyrics are still loading there is nothing finished to run on.
                if (actionsRef.current.isLyricsLoading) return;
                const current = usePlaybackStore.getState().lyrics;
                const next = rerunLyricsTransform(current);
                if (next !== current) showRefreshedLyrics(next);
            },
        });
        registerFoliumQueueWriter({
            persist: (song, queue) => actionsRef.current.persistQueue(song, queue),
            refreshPrefetch: (song, previous, next) => actionsRef.current.refreshQueuePrefetch(song, previous, next),
        });
        return () => {
            registerFoliumHostActions(null);
            registerFoliumQueueWriter(null);
        };
    }, []);

    // playback.likeChanged follows the value getState().liked reports, whatever changed it.
    const liked = actions.isLiked;
    const likedPrimedRef = useRef(false);
    useEffect(() => {
        if (!likedPrimedRef.current) {
            likedPrimedRef.current = true;
            return;
        }
        emitFoliumEvent('playback.likeChanged', { liked });
    }, [liked]);
};
