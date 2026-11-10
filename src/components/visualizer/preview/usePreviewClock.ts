import { useEffect, useMemo, useState } from 'react';
import { motionValue, useMotionValue, useMotionValueEvent, type MotionValue } from 'framer-motion';
import type { AudioBands, VisualizerMode } from '../../../types';
import {
    findPreviewPlaceholderLineIndex,
    getPreviewPlaceholderStartOffset,
    VIS_PLAYGROUND_PREVIEW_PLACEHOLDERS,
    type PreviewPlaceholder,
    type PreviewPlaceholderId,
} from '../PreviewPlaceholder';
import { useVisPlaygroundPreviewPlayback } from './useVisPlaygroundPreviewPlayback';

// src/components/visualizer/preview/usePreviewClock.ts
// The clock of a lyric preview: the sample song's time, the stand-in audio levels and the line
// that is sung, driven by one animation-frame loop (useVisPlaygroundPreviewPlayback). The big
// sample reads it directly. A small picture beside it reads the same clock through a tap of its
// own, so there is one loop however many pictures show.

export type PreviewClock = {
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    /** The line sung at `currentTime`, or -1 between lines. */
    currentLineIndex: number;
    /** The sample song. */
    placeholder: PreviewPlaceholder;
};

type PreviewClockOptions = {
    /** The style the big sample shows: the clock starts where that style's preview starts. */
    mode: VisualizerMode;
    placeholderId?: PreviewPlaceholderId;
    paused?: boolean;
};

export const usePreviewClock = ({ mode, placeholderId = 'default', paused = false }: PreviewClockOptions): PreviewClock => {
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0.24);
    const bass = useMotionValue(0.18);
    const lowMid = useMotionValue(0.15);
    const mid = useMotionValue(0.12);
    const vocal = useMotionValue(0.2);
    const treble = useMotionValue(0.1);
    const spectrum = useMotionValue(new Uint8Array(64));
    const placeholder = VIS_PLAYGROUND_PREVIEW_PLACEHOLDERS[placeholderId];
    const [currentLineIndex, setCurrentLineIndex] = useState(() => findPreviewPlaceholderLineIndex(placeholder.lines, 0));

    const audioBands = useMemo<AudioBands>(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
        spectrum,
    }), [bass, lowMid, mid, spectrum, treble, vocal]);

    useVisPlaygroundPreviewPlayback({
        audioPower,
        bass,
        lowMid,
        mid,
        vocal,
        treble,
        spectrum,
        currentTime,
        visualizerMode: mode,
        loopDuration: placeholder.loopDuration,
        playbackKey: placeholderId,
        isPaused: paused,
    });

    useEffect(() => {
        const offset = getPreviewPlaceholderStartOffset(mode, placeholder.loopDuration);
        setCurrentLineIndex(findPreviewPlaceholderLineIndex(placeholder.lines, offset));
    }, [placeholder, mode]);

    useMotionValueEvent(currentTime, 'change', (latest) => {
        const nextIndex = findPreviewPlaceholderLineIndex(placeholder.lines, latest);
        setCurrentLineIndex(prev => (prev === nextIndex ? prev : nextIndex));
    });

    return useMemo(
        () => ({ currentTime, audioPower, audioBands, currentLineIndex, placeholder }),
        [currentTime, audioPower, audioBands, currentLineIndex, placeholder],
    );
};

/** The moment of the sample song an image shows: well into its second line, where every style has words on screen. */
export const posterTime = (placeholder: PreviewPlaceholder): number => {
    const line = placeholder.lines[1] ?? placeholder.lines[0];
    return line ? line.startTime + (line.endTime - line.startTime) * 0.6 : 0;
};

/** How far a held time steps, in seconds: far too little to show. */
export const HELD_TIME_STEP = 0.0001;

export type ClockValues = Pick<PreviewClock, 'currentTime' | 'audioPower' | 'audioBands'>;

/** The motion values of a clock, in one fixed order. */
export const valuesOf =(clock: ClockValues): MotionValue<unknown>[] => [
    clock.currentTime,
    clock.audioPower,
    clock.audioBands.bass,
    clock.audioBands.lowMid,
    clock.audioBands.mid,
    clock.audioBands.vocal,
    clock.audioBands.treble,
    ...(clock.audioBands.spectrum ? [clock.audioBands.spectrum] : []),
] as MotionValue<unknown>[];

/**
 * One picture's tap of the clock: motion values of its own that follow the clock while the picture
 * runs, and stand still while its image is made: the time at the poster moment, the sound as it
 * was when the tap was made. A style that listens to the clock's own values cannot be held still.
 */
export const useClockTap = (clock: PreviewClock, running: boolean): Pick<PreviewClock, 'currentTime' | 'audioPower' | 'audioBands' | 'currentLineIndex'> => {
    const poster = posterTime(clock.placeholder);
    const tap = useMemo<ClockValues>(() => ({
        currentTime: motionValue(poster),
        audioPower: motionValue(clock.audioPower.get()),
        audioBands: {
            bass: motionValue(clock.audioBands.bass.get()),
            lowMid: motionValue(clock.audioBands.lowMid.get()),
            mid: motionValue(clock.audioBands.mid.get()),
            vocal: motionValue(clock.audioBands.vocal.get()),
            treble: motionValue(clock.audioBands.treble.get()),
            spectrum: motionValue(clock.audioBands.spectrum?.get() ?? new Uint8Array(64)),
        },
        // The clock is read when the tap is made; later moments are set below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);

    useEffect(() => {
        if (!running) {
            // Several styles draw a line only when they are told the time, and their module may load
            // after this ran. So the held time steps back and forth by a hair, once a frame.
            let frame = 0;
            let odd = false;
            const tell = () => {
                odd = !odd;
                tap.currentTime.set(poster + (odd ? HELD_TIME_STEP : 0));
                frame = window.requestAnimationFrame(tell);
            };
            tell();
            return () => window.cancelAnimationFrame(frame);
        }
        const from = valuesOf(clock);
        const to = valuesOf(tap);
        const stops = from.map((value, index) => {
            to[index].set(value.get());
            return value.on('change', latest => to[index].set(latest));
        });
        return () => stops.forEach(stop => stop());
        // The clock's values are the same objects for its life; only whether the picture runs changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running, poster, tap]);

    return {
        ...tap,
        currentLineIndex: running
            ? clock.currentLineIndex
            : findPreviewPlaceholderLineIndex(clock.placeholder.lines, poster),
    };
};
