import { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import type { Line, Theme } from '@/types';
import type { FoliumParamAccess, FoliumParamValues, FoliumStageContext, FoliumSurface } from './contract';
import { toFoliumLines, toFoliumSongFromMeta, toFoliumTheme } from './dto';

// src/mods/folium/stageContext.ts
// Builds the FoliumStageContext handed to lyric-synced content (visualizers,
// background types, stage layers). One rule decides what goes where:
//   - identity (lyrics, song, staticMode, the static preview line) is a
//     snapshot, and changing it remounts the content;
//   - everything that changes while a song plays (line index, pause, theme,
//     settings, surface) is a getter, and `subscribe` announces the change.
// Putting a per-line value into the snapshot would dispose and remount the
// content on every lyric line, which is what the pre-Folium bridge did.

export interface FoliumStageInputs {
    lines: Line[];
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    paused: boolean;
    theme: Theme;
    isDaylight: boolean;
    songTitle: string | null;
    songArtist: string | null;
    songAlbum: string | null;
    staticMode: boolean;
    surface: FoliumSurface;
    settings: FoliumParamAccess | null;
}

const EMPTY_SETTINGS: FoliumParamValues = Object.freeze({});

export const useFoliumStageContext = (inputs: FoliumStageInputs): FoliumStageContext => {
    const inputsRef = useRef(inputs);
    inputsRef.current = inputs;
    const listenersRef = useRef(new Set<() => void>());

    const notify = () => {
        listenersRef.current.forEach((listener) => {
            try {
                listener();
            } catch (error) {
                console.warn('[Folium] stage subscriber failed', error);
            }
        });
    };

    const { lines, songTitle, songArtist, songAlbum, staticMode, currentLineIndex, settings, currentTime } = inputs;
    const staticLineIndex = staticMode ? currentLineIndex : null;

    const ctx = useMemo<FoliumStageContext>(() => {
        const themeCache = { source: null as Theme | null, daylight: false, value: toFoliumTheme(null, false) };
        return Object.freeze({
            lines: toFoliumLines(lines),
            song: toFoliumSongFromMeta(songTitle, songArtist, songAlbum),
            staticMode,
            staticLineIndex,
            currentTime: Object.freeze({
                get: () => inputsRef.current.currentTime.get(),
                on: (_event: 'change', listener: (seconds: number) => void) => currentTime.on('change', listener),
            }),
            getLineIndex: () => inputsRef.current.currentLineIndex,
            isPaused: () => inputsRef.current.paused,
            // Cached per theme identity so a per-frame read allocates nothing.
            getTheme: () => {
                const { theme, isDaylight } = inputsRef.current;
                if (themeCache.source !== theme || themeCache.daylight !== isDaylight) {
                    themeCache.source = theme;
                    themeCache.daylight = isDaylight;
                    themeCache.value = Object.freeze(toFoliumTheme(theme, isDaylight));
                }
                return themeCache.value;
            },
            getSettings: () => inputsRef.current.settings?.get() ?? EMPTY_SETTINGS,
            getSurface: () => inputsRef.current.surface,
            subscribe: (listener: () => void) => {
                listenersRef.current.add(listener);
                return () => listenersRef.current.delete(listener);
            },
        });
    }, [lines, songTitle, songArtist, songAlbum, staticMode, staticLineIndex, currentTime]);

    const { paused, theme, isDaylight } = inputs;
    const { transparent, hostBackground } = inputs.surface;
    // Skip the first run: a fresh mount already reads current values.
    const primedRef = useRef(false);
    useEffect(() => {
        if (!primedRef.current) {
            primedRef.current = true;
            return;
        }
        notify();
    }, [currentLineIndex, paused, theme, isDaylight, transparent, hostBackground]);

    useEffect(() => settings?.subscribe(notify), [settings]);

    return ctx;
};
