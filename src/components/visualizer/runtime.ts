import { MotionValue } from 'framer-motion';
import { useMemo } from 'react';
import { Line } from '../../types';

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
