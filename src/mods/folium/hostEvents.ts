import type { Line, LyricData, SongResult } from '@/types';
import { PlayerState } from '@/types';
import {
    usePlaybackStore,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
} from '@/stores/usePlaybackStore';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { installBeforePlayHook, installLyricsTransformHook } from '@/services/hostExtensionHooks';
import type { FoliumBeforePlayEvent, FoliumLine, FoliumLyricsTransformEvent, FoliumPlaybackState, FoliumSong } from './contract';
import { resolveFoliumSongRef, toFoliumLines, toFoliumSong } from './dto';
import { dispatchFoliumHookAsync, dispatchFoliumHookSync, emitFoliumEvent, hasFoliumEventHandlers } from './events';

// src/mods/folium/hostEvents.ts
// Main-window wiring between host state and the Folium event bus:
//   - installs the two hooks the host exposes (src/services/hostExtensionHooks):
//     `lyrics.transform` at the lyrics setter and `playback.beforePlay` at the
//     start of playSong;
//   - turns store changes into notifications (song, transport state, lyrics,
//     view, visualizer mode). Theme and seek notifications come from the host
//     bridge hook in App, which is where the theme lives.
// Everything is a no-op until some mod listens.

/*
 * Maps transformed DTO lines back to host lines. A line object the handler
 * left in place keeps its original host Line (with render hints, agents,
 * background vocals…); a new or edited one is rebuilt from its DTO fields.
 */
const toHostLines = (original: readonly Line[], originalDtos: readonly FoliumLine[], next: readonly FoliumLine[]): Line[] => {
    const indexByDto = new Map(originalDtos.map((dto, index) => [dto, index] as const));
    const lines: Line[] = [];
    next.forEach((dto) => {
        const index = indexByDto.get(dto);
        if (index !== undefined) {
            lines.push(original[index]);
            return;
        }
        if (!dto || typeof dto.text !== 'string' || !Number.isFinite(dto.startTime) || !Number.isFinite(dto.endTime)) {
            return;
        }
        const words = Array.isArray(dto.words)
            ? dto.words
                .filter((word) => word && typeof word.text === 'string' && Number.isFinite(word.startTime) && Number.isFinite(word.endTime))
                .map((word) => ({ text: word.text, startTime: word.startTime, endTime: word.endTime }))
            : [];
        lines.push({
            words: words.length > 0 ? words : [{ text: dto.text, startTime: dto.startTime, endTime: dto.endTime }],
            startTime: dto.startTime,
            endTime: dto.endTime,
            fullText: dto.text,
            ...(typeof dto.translation === 'string' ? { translation: dto.translation } : {}),
            ...(typeof dto.romanization === 'string' ? { romanization: dto.romanization } : {}),
        });
    });
    return lines;
};

const transformLyrics = (lyrics: LyricData): LyricData => {
    if (!hasFoliumEventHandlers('lyrics.transform') || !Array.isArray(lyrics.lines)) return lyrics;
    const originalDtos = toFoliumLines(lyrics.lines);
    const event: FoliumLyricsTransformEvent = {
        song: toFoliumSong(usePlaybackStore.getState().currentSong),
        lines: originalDtos,
    };
    dispatchFoliumHookSync('lyrics.transform', event);
    if (event.lines === originalDtos || !Array.isArray(event.lines)) return lyrics;
    return { ...lyrics, lines: toHostLines(lyrics.lines, originalDtos, event.lines) };
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

const toFoliumPlaybackState = (state: PlayerState): FoliumPlaybackState => {
    if (state === PlayerState.PLAYING) return 'playing';
    if (state === PlayerState.PAUSED) return 'paused';
    return 'stopped';
};

let installed = false;

/** Installs hooks and store notifications (main window only; idempotent). */
export const installFoliumHostEvents = () => {
    if (installed) return;
    installed = true;
    installLyricsTransformHook(transformLyrics);
    installBeforePlayHook(beforePlay, () => hasFoliumEventHandlers('playback.beforePlay'));

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
        if (lyrics !== selectDisplayLyrics(previous)) {
            emitFoliumEvent('lyrics.loaded', { song: toFoliumSong(song), lines: toFoliumLines(lyrics?.lines) });
        }
    });
    useAppViewStore.subscribe((state, previous) => {
        if (state.view !== previous.view) {
            emitFoliumEvent('app.viewChanged', { view: String(state.view) });
        }
    });
    useVisualizerSettingsStore.subscribe((state, previous) => {
        if (state.visualizerMode !== previous.visualizerMode) {
            emitFoliumEvent('visualizer.modeChanged', { mode: state.visualizerMode });
        }
    });
};
