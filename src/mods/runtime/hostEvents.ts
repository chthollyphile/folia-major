import type { LyricData, SongResult } from '@/types';
import { PlayerState } from '@/types';
import {
    usePlaybackStore,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
    setLyricsState,
} from '@/stores/usePlaybackStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { installBeforePlayHook, installLyricsTransformHook, installPlaybackFailedListener, type PlaybackFailedNotice } from '@/services/hostExtensionHooks';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { clampMediaVolume } from '@/utils/appPlaybackHelpers';
import type { FoliumBeforePlayEvent, FoliumLyricsTransformEvent, FoliumPlaybackState, FoliumSong } from '../folium/contract';
import { fromFoliumLines, resolveFoliumSongRef, toFoliumLines, toFoliumPlaybackFailureReason, toFoliumSong } from '../folium/dto';
import { dispatchFoliumHookAsync, dispatchFoliumHookSync, emitFoliumEvent, emitFoliumEventPerMod, hasFoliumEventHandlers } from '../folium/events';
import { findFoliumQueueCurrentIndex, resolveFoliumQueueKind } from './hostQueue';
import { takeFoliumQueueChange } from './queue/queueVersion';

// src/mods/runtime/hostEvents.ts
// Main-window wiring between host state and the Folium event bus:
//   - installs the two hooks the host exposes (src/services/hostExtensionHooks):
//     `lyrics.transform` at the lyrics setter and `playback.beforePlay` at the
//     start of playSong;
//   - turns store changes into notifications (song, transport state, lyrics,
//     view). Theme and seek notifications come from the host bridge hook in
//     App, which is where the theme lives; the visualizer mode and the other
//     `visualizer.*` events from runtime/visualizer/hostVisualizer.ts.
//   - the queue outline, volume / mute and the repeat mode;
//   - turns the host's playback failure notice into `playback.failed`.
// Everything is a no-op until some mod listens.

const transformLyrics = (lyrics: LyricData): LyricData => {
    if (!hasFoliumEventHandlers('lyrics.transform') || !Array.isArray(lyrics.lines)) return lyrics;
    const originalDtos = toFoliumLines(lyrics.lines);
    const event: FoliumLyricsTransformEvent = {
        song: toFoliumSong(usePlaybackStore.getState().currentSong),
        lines: originalDtos,
    };
    dispatchFoliumHookSync('lyrics.transform', event);
    if (event.lines === originalDtos || !Array.isArray(event.lines)) return lyrics;
    return { ...lyrics, lines: fromFoliumLines(lyrics.lines, originalDtos, event.lines) };
};

/*
 * beforePlay: every handler sees the same event; the first cancel ends the
 * chain. A replacement must carry a host `ref`; an unknown ref is ignored
 * (the original song plays) rather than failing playback.
 */
const beforePlay = async (song: SongResult) => {
    const dto = toFoliumSong(song) as FoliumSong;
    let cancelled = false;
    let replacement: FoliumSong | null = null;
    const event: FoliumBeforePlayEvent = {
        song: dto,
        get cancelled() {
            return cancelled;
        },
        cancel: () => {
            cancelled = true;
        },
        replaceWith: (next: FoliumSong) => {
            replacement = next;
        },
    };
    await dispatchFoliumHookAsync('playback.beforePlay', event, () => cancelled);
    const replaced = resolveFoliumSongRef((replacement as FoliumSong | null)?.ref);
    return { cancel: cancelled, song: replaced ?? song };
};

// playback.failed: the host reports through hostExtensionHooks so its playback layer never imports
// this module. Checked for listeners first: toFoliumSong takes a slot in the shared ref pool.
const emitPlaybackFailed = (notice: PlaybackFailedNotice) => {
    if (!hasFoliumEventHandlers('playback.failed')) return;
    emitFoliumEvent('playback.failed', {
        song: toFoliumSong(notice.song),
        reason: toFoliumPlaybackFailureReason(notice.reason),
        phase: notice.phase,
        willAutoSkip: notice.willAutoSkip,
    });
};

const toFoliumPlaybackState = (state: PlayerState): FoliumPlaybackState => {
    if (state === PlayerState.PLAYING) return 'playing';
    if (state === PlayerState.PAUSED) return 'paused';
    return 'stopped';
};

type PlaybackStoreState = ReturnType<typeof usePlaybackStore.getState>;

const displayedSongKey = (song: SongResult | null) => (song ? getPlaybackSongKey(song) : null);

/*
 * What playback.queueChanged reports moved: the queue array, FM / Stage, or the displayed song's key.
 * Folium 1.7: also the end of an automix blend (cancelled back to the outgoing song too, where the key
 * stays), so a mod whose replaceQueue was refused `transition` hears when to try again.
 */
const queueOutlineChanged = (state: PlaybackStoreState, previous: PlaybackStoreState) => {
    if (
        state.playQueue !== previous.playQueue
        || state.isFmMode !== previous.isFmMode
        || state.activePlaybackContext !== previous.activePlaybackContext
        || (previous.transitionDisplay !== null && state.transitionDisplay === null)
    ) {
        return true;
    }
    const song = selectDisplaySong(state);
    const before = selectDisplaySong(previous);
    return song !== before && displayedSongKey(song) !== displayedSongKey(before);
};

/*
 * playback.queueChanged: one event per task, a microtask after the first
 * change, read from the state as it settled (playSong writes the queue, the
 * song and FM mode one after another). Never deduplicated by payload: a
 * shuffle keeps both the length and the current index.
 * Folium 1.7: with the queue's version, and `byThisMod` true only for the mod whose replaceQueue made
 * this change (runtime/queue/queueVersion.ts says which, once).
 */
let queueChangePending = false;
const emitQueueChanged = () => {
    queueChangePending = false;
    if (!hasFoliumEventHandlers('playback.queueChanged')) return;
    const state = usePlaybackStore.getState();
    const { version, writer } = takeFoliumQueueChange(state.playQueue, resolveFoliumQueueKind(state));
    const length = state.playQueue.length;
    const currentIndex = findFoliumQueueCurrentIndex(state);
    emitFoliumEventPerMod('playback.queueChanged', (modId) => ({ length, currentIndex, version, byThisMod: writer === modId }));
};

let installed = false;
// A refresh's result is being written (showRefreshedLyrics).
let writingRefresh = false;

/*
 * Shows what folium.lyrics.refresh() made. It is the same song's lyrics rebuilt, not a new load, so it is not
 * announced as lyrics.loaded. A lyrics.loaded handler that refreshes, at once or later, therefore starts
 * nothing again.
 */
export const showRefreshedLyrics = (lyrics: LyricData | null) => {
    writingRefresh = true;
    try {
        setLyricsState(lyrics);
    } finally {
        writingRefresh = false;
    }
};

/** Installs hooks and store notifications (main window only; idempotent). */
export const installFoliumHostEvents = () => {
    if (installed) return;
    installed = true;
    installLyricsTransformHook(transformLyrics);
    installBeforePlayHook(beforePlay, () => hasFoliumEventHandlers('playback.beforePlay'));
    installPlaybackFailedListener(emitPlaybackFailed);

    usePlaybackStore.subscribe((state, previous) => {
        const song = selectDisplaySong(state);
        if (song !== selectDisplaySong(previous)) {
            emitFoliumEvent('playback.songChanged', { song: toFoliumSong(song) });
        }
        const playerState = selectDisplayPlayerState(state);
        if (playerState !== selectDisplayPlayerState(previous)) {
            emitFoliumEvent('playback.stateChanged', { state: toFoliumPlaybackState(playerState) });
        }
        const lyrics = selectDisplayLyrics(state);
        if (lyrics !== selectDisplayLyrics(previous) && !writingRefresh) {
            emitFoliumEvent('lyrics.loaded', { song: toFoliumSong(song), lines: toFoliumLines(lyrics?.lines) });
        }
        if (!queueChangePending && hasFoliumEventHandlers('playback.queueChanged') && queueOutlineChanged(state, previous)) {
            queueChangePending = true;
            queueMicrotask(emitQueueChanged);
        }
    });
    useAudioSettingsStore.subscribe((state, previous) => {
        if (state.volume !== previous.volume || state.isMuted !== previous.isMuted) {
            emitFoliumEvent('playback.volumeChanged', { volume: clampMediaVolume(state.volume), muted: state.isMuted });
        }
        if (state.loopMode !== previous.loopMode) {
            emitFoliumEvent('playback.loopModeChanged', { mode: state.loopMode });
        }
    });
    useAppViewStore.subscribe((state, previous) => {
        if (state.view !== previous.view) {
            emitFoliumEvent('app.viewChanged', { view: String(state.view) });
        }
    });
    // visualizer.modeChanged, with who changed the mode, is emitted by runtime/visualizer/hostVisualizer.ts.
};
