import { getSongAlbumLabel, getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { beatImpact, handoffProgress } from '../../../stores/motionSignals';
import { selectCoverUrl, usePlaybackStore } from '../../../stores/usePlaybackStore';
import type { DualTheme } from '../../../types';
import type { VisualizerSharedProps } from '../../visualizer/definition';
import type { LyricPhase, MusicCharacter, SceneContext, SceneEvents, SceneSong } from '../definition';
import { computeLyricPhase, type LyricPhaseState } from './lyricPhase';

// src/components/scenes/engine/sceneSignals.ts
// 信号适配层：把播放页今天已经算好的 VisualizerSharedProps 翻成场景读的信号，不新造数据来源。
// 每帧 step() 一次（算歌词阶段），两帧之间的变化由 diffSceneSignals 变成场景的事件。

/** What the host compares from one frame to the next to tell the scene's events. */
export interface SceneSignalSnapshot {
    seed: string | number | null;
    blending: boolean;
    lineIndex: number;
    phase: LyricPhase;
    paused: boolean;
    /** Lyric seconds. */
    time: number;
}

/** A jump of the lyric clock by more than this (seconds) beyond the frame's own time is a seek. */
export const SEEK_JUMP_SEC = 1.5;

/** The events between two frames, in the order the scene gets them; none on the first frame (the scene reads the current values). */
export const diffSceneSignals = (previous: SceneSignalSnapshot | null, next: SceneSignalSnapshot, dt: number): (keyof SceneEvents)[] => {
    if (!previous) return [];
    const events: (keyof SceneEvents)[] = [];
    const sameSong = previous.seed === next.seed;
    if (!sameSong) events.push('songChange');
    if (next.blending && !previous.blending) events.push('blendStart');
    if (previous.paused !== next.paused) events.push(next.paused ? 'pause' : 'play');
    if (sameSong && Math.abs(next.time - (previous.time + (previous.paused ? 0 : dt))) > SEEK_JUMP_SEC) events.push('seek');
    if (next.lineIndex !== previous.lineIndex) events.push('lineChange');
    if (next.phase !== previous.phase) events.push('phaseChange');
    return events;
};

// ponytail: the main player's analyser reads 0..255 and the previews 0..1; anything above 1.5 is taken as the first.
const unit = (value: number) => Math.min(1, Math.max(0, value > 1.5 ? value / 255 : value));

// The record effects' strengths reach the scene with the room sound (phase 2); until then a clean record.
const CLEAN_RECORD: MusicCharacter = { saturation: 0, bitcrush: 0, wobble: 0, vinylNoise: 0, filter: 0 };

export type SceneSignals = Pick<SceneContext, 'song' | 'lyrics' | 'music' | 'player' | 'display'> & {
    step: () => SceneSignalSnapshot;
};

/** The song's colour pair (useThemeController's songThemePair): the song on screen's, and a blend's incoming song's. */
export interface SceneSongThemes {
    shown: DualTheme;
    incoming: DualTheme;
}

/** The signals of SceneContext, read from the latest props and song themes each time they are asked. */
export const createSceneSignals = (getProps: () => VisualizerSharedProps, getSongThemes: () => SceneSongThemes): SceneSignals => {
    let lyric: LyricPhaseState = computeLyricPhase([], 0);
    const songOf = (props: VisualizerSharedProps): SceneSong => ({
        seed: props.seed ?? null,
        title: props.songTitle ?? null,
        artist: props.songArtist ?? null,
        album: props.songAlbum ?? null,
        coverUrl: props.coverUrl ?? null,
        theme: getSongThemes().shown,
        duration: props.duration ?? 0,
    });
    // A blend's incoming song: the live song while a blend holds the picture on the outgoing one (as useVisualizerSongHandoff reads it).
    const handoff = () => {
        const state = usePlaybackStore.getState();
        const held = state.transitionDisplay;
        const song = state.currentSong;
        if (!held || !song || song.id === held.song?.id) return null;
        return {
            song: {
                seed: song.id,
                title: song.name ?? null,
                artist: getSongArtistLabel(song) || null,
                album: getSongAlbumLabel(song) || null,
                coverUrl: selectCoverUrl(state) ?? null,
                theme: getSongThemes().incoming,
                duration: 0,
            },
            progress: handoffProgress.get(),
        };
    };

    return {
        step: () => {
            const props = getProps();
            const time = props.currentTime.get();
            lyric = computeLyricPhase(props.lines, time);
            return { seed: props.seed ?? null, blending: handoff() !== null, lineIndex: lyric.lineIndex, phase: lyric.phase, paused: Boolean(props.paused), time };
        },
        song: { current: () => songOf(getProps()), handoff },
        lyrics: {
            lines: () => getProps().lines,
            lineIndex: () => lyric.lineIndex,
            phase: () => lyric.phase,
            nextLineIn: () => lyric.nextLineIn,
        },
        music: {
            power: () => unit(getProps().audioPower.get()),
            bands: () => {
                const bands = getProps().audioBands;
                return { bass: unit(bands.bass.get()), lowMid: unit(bands.lowMid.get()), mid: unit(bands.mid.get()), vocal: unit(bands.vocal.get()), treble: unit(bands.treble.get()) };
            },
            beat: () => beatImpact.get(),
            character: () => CLEAN_RECORD,
        },
        player: {
            paused: () => Boolean(getProps().paused),
            lyricTime: () => getProps().currentTime.get(),
        },
        display: {
            isDaylight: () => Boolean(getProps().isDaylight),
            showText: () => getProps().showText ?? true,
            lyricsFontScale: () => getProps().lyricsFontScale ?? 1,
        },
    };
};

/** A press that moves this far (CSS pixels) is a drag that turns the head; less, and it is a click. */
const DRAG_START_PX = 5;
/** How far a drag turns the head, radians per CSS pixel: across half a wide window is about half a turn. */
const LOOK_PER_PX = (0.18 * Math.PI) / 180;

/**
 * Drag to look, for every scene alike: a press on the scene that moves turns the head, as a game's mouse
 * look while the button is held; a press that does not move is a click and reaches the lyrics as ever.
 * The click that ends a drag is swallowed, so a drag that starts on a line does not also act on it.
 * A press the lyric style or background claims is its own drag and turns nothing: one on an element marked
 * `data-takes-drag` (as Machi's canvas is while its camera can be dragged), or one it preventDefaults on
 * pointerdown (as Monet's portrait hanger does while it is placed). The mark is the way for a style that
 * drags all the time: preventDefault on every press would also stop the mousedown other parts listen for.
 */
export const trackLook = (root: HTMLElement) => {
    let yaw = 0;
    let pitch = 0;
    let press: { id: number; x: number; y: number; dragging: boolean; down: PointerEvent } | null = null;
    let swallowClick = false;
    const onDown = (event: PointerEvent) => {
        swallowClick = false;
        if (!event.isPrimary || event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('[data-takes-drag]')) {
            press = null;
            return;
        }
        press ={ id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, down: event };
    };
    const onMove = (event: PointerEvent) => {
        if (!press || event.pointerId !== press.id) return;
        // The button came up where the scene did not hear it (over the player's controls, another window).
        if ((event.buttons & 1) === 0) {
            onEnd(event);
            return;
        }
        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;
        if (!press.dragging) {
            if (Math.hypot(dx, dy) < DRAG_START_PX) return;
            // By now the press has reached the lyric style's handlers: one that claimed it drags on its own.
            if (press.down.defaultPrevented) {
                press = null;
                return;
            }
            press.dragging = true;
            root.setPointerCapture(event.pointerId);
            root.style.cursor = 'grabbing';
        }
        // Right looks right and up looks up, as in a game (yaw and pitch are left and up positive).
        yaw -= dx * LOOK_PER_PX;
        pitch -= dy * LOOK_PER_PX;
        press.x = event.clientX;
        press.y = event.clientY;
    };
    const onEnd = (event: PointerEvent) => {
        if (!press || event.pointerId !== press.id) return;
        // The click, if any, comes right after the pointerup; none comes after a cancel.
        swallowClick = press.dragging && event.type === 'pointerup';
        if (swallowClick) window.setTimeout(() => { swallowClick = false; }, 0);
        press = null;
        root.style.cursor = '';
    };
    const onClick = (event: MouseEvent) => {
        if (!swallowClick) return;
        swallowClick = false;
        event.stopPropagation();
        event.preventDefault();
    };
    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onEnd);
    root.addEventListener('pointercancel', onEnd);
    root.addEventListener('click', onClick, true);
    return {
        look: () => {
            const turned = { yaw, pitch };
            yaw = 0;
            pitch = 0;
            return turned;
        },
        dispose: () => {
            root.removeEventListener('pointerdown', onDown, true);
            root.removeEventListener('pointermove', onMove);
            root.removeEventListener('pointerup', onEnd);
            root.removeEventListener('pointercancel', onEnd);
            root.removeEventListener('click', onClick, true);
            root.style.cursor = '';
        },
    };
};
