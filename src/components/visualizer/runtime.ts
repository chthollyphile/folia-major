import { MotionValue } from 'framer-motion';
import { useMemo } from 'react';
import { Line } from '../../types';

// Shared runtime helpers for all visualizers.
// This file is intentionally tiny: it only answers "what line should I care about right now?"
// and "should I preheat the next line yet?" so each renderer can stay opinionated about its own layout.
export interface VisualizerPreheatWindow {
    minLead: number;
    maxLead: number;
}

interface GetRecentCompletedLineOptions {
    lines: Line[];
    currentLineIndex: number;
    currentTime: number;
    getLineEndTime?: (line: Line) => number;
}

interface PrepareActiveAndUpcomingOptions<TPreparedState> {
    activeLine: Line | null | undefined;
    upcomingLine: Line | null | undefined;
    prepareLine: (line: Line | null | undefined) => TPreparedState | null;
}

interface UseVisualizerRuntimeOptions {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    getLineEndTime?: (line: Line) => number;
}

// This only matters when there is no active line.
// It is mainly here so subtitle overlays can keep showing the last translation during small gaps.
export const getRecentCompletedLine = ({
    lines,
    currentLineIndex,
    currentTime,
    getLineEndTime = (line: Line) => line.endTime,
}: GetRecentCompletedLineOptions): Line | null => {
    if (currentLineIndex !== -1 || lines.length === 0) {
        return null;
    }

    for (let i = lines.length - 1; i >= 0; i--) {
        if (currentTime > getLineEndTime(lines[i])) {
            return lines[i];
        }
    }

    return null;
};

// If a line is active, upcoming is just the next line in the array.
// If nothing is active yet, upcoming means "the first line whose startTime is still ahead of us".
export const getUpcomingLine = (
    lines: Line[],
    currentLineIndex: number,
    currentTime: number
): Line | null => {
    const activeLine = lines[currentLineIndex];
    if (activeLine) {
        return lines[currentLineIndex + 1] ?? null;
    }

    for (const line of lines) {
        if (line.startTime > currentTime) {
            return line;
        }
    }

    return null;
};

// Most modes only need 1-2 lines of lookahead for subtitles or preheat, so keep this cheap and explicit.
export const getUpcomingLines = (
    lines: Line[],
    currentLineIndex: number,
    count = 2
): Line[] => {
    if (currentLineIndex < 0) {
        return [];
    }

    return lines.slice(currentLineIndex + 1, currentLineIndex + 1 + count);
};

// Preheat windows are deliberately defined in lead time, not absolute timestamps.
// That makes them easier to tune per visualizer without coupling to line duration.
export const shouldPreheatLine = (
    line: Line | null | undefined,
    currentTime: number,
    window: VisualizerPreheatWindow
): boolean => {
    if (!line) {
        return false;
    }

    const leadTime = line.startTime - currentTime;
    return leadTime >= window.minLead && leadTime <= window.maxLead;
};

// Common prepare flow:
// 1. prepare the active line if there is one,
// 2. always try to warm the upcoming line as a side effect,
// 3. return only the active prepared state to the caller.
export const prepareActiveAndUpcoming = <TPreparedState>({
    activeLine,
    upcomingLine,
    prepareLine,
}: PrepareActiveAndUpcomingOptions<TPreparedState>): TPreparedState | null => {
    if (!activeLine) {
        prepareLine(upcomingLine);
        return null;
    }

    const currentState = prepareLine(activeLine);
    prepareLine(upcomingLine);
    return currentState;
};

// This hook is intentionally just a small runtime bundle.
// Heavy layout/canvas work should not live here, otherwise every mode would pay for the same abstraction.
export const useVisualizerRuntime = ({
    currentTime,
    currentLineIndex,
    lines,
    getLineEndTime,
}: UseVisualizerRuntimeOptions) => {
    const currentTimeValue = currentTime.get();
    const activeLine = lines[currentLineIndex] ?? null;

    const recentCompletedLine = useMemo(() => getRecentCompletedLine({
        lines,
        currentLineIndex,
        currentTime: currentTimeValue,
        getLineEndTime,
    }), [currentLineIndex, currentTimeValue, getLineEndTime, lines]);

    const upcomingLine = useMemo(
        () => getUpcomingLine(lines, currentLineIndex, currentTimeValue),
        [currentLineIndex, currentTimeValue, lines]
    );

    const nextLines = useMemo(
        () => getUpcomingLines(lines, currentLineIndex, 2),
        [currentLineIndex, lines]
    );

    return {
        currentTimeValue,
        activeLine,
        recentCompletedLine,
        upcomingLine,
        nextLines,
    };
};
