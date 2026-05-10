export type LineTimingClass = 'normal' | 'short' | 'micro';
export type LineTransitionMode = 'normal' | 'fast' | 'none';
export type WordRevealMode = 'normal' | 'fast' | 'instant';

export interface RenderHintWordLike {
    endTime: number;
}

export interface LineRenderHints {
    rawDuration: number;
    timingClass: LineTimingClass;
    renderEndTime: number;
    lineTransitionMode: LineTransitionMode;
    wordRevealMode: WordRevealMode;
}

export interface RenderHintLineLike {
    startTime: number;
    endTime: number;
    words?: RenderHintWordLike[];
    renderHints?: LineRenderHints;
}

export interface RenderHintLyricDataLike<TLine extends RenderHintLineLike = RenderHintLineLike> {
    lines: TLine[];
}

export interface MigrationResult<T> {
    value: T;
    changed: boolean;
}

export const MICRO_LINE_DURATION_THRESHOLD = 0.10;
export const SHORT_LINE_DURATION_THRESHOLD = 0.18;
export const MICRO_LINE_RENDER_FLOOR = 0.067;

export interface LineTransitionTiming {
    enterDuration: number;
    exitDuration: number;
    linePassHold: number;
}

const getLastWordEndTime = (line: Pick<RenderHintLineLike, 'endTime' | 'words'>): number => {
    const lastWord = line.words?.[line.words.length - 1];
    return lastWord?.endTime ?? line.endTime;
};

export const getLineTransitionTiming = (
    rawDuration: number,
    lineTransitionMode: LineTransitionMode,
    wordRevealMode: WordRevealMode
): LineTransitionTiming => {
    if (lineTransitionMode === 'none') {
        return {
            enterDuration: 0,
            exitDuration: 0,
            linePassHold: 0,
        };
    }

    if (lineTransitionMode === 'fast') {
        return {
            enterDuration: clamp(rawDuration * 0.45, 0.045, 0.06),
            exitDuration: clamp(rawDuration * 0.22, 0.03, 0.04),
            linePassHold: wordRevealMode === 'instant' ? 0 : 0.03,
        };
    }

    return {
        enterDuration: Math.min(0.42, Math.max(0.22, Math.max(rawDuration, 0.12) * 0.34)),
        exitDuration: Math.min(0.32, Math.max(0.18, Math.max(rawDuration, 0.12) * 0.18)),
        linePassHold: wordRevealMode === 'instant' ? 0 : 0.06,
    };
};

const getTimingClass = (rawDuration: number): LineTimingClass => {
    if (rawDuration < MICRO_LINE_DURATION_THRESHOLD) {
        return 'micro';
    }

    if (rawDuration < SHORT_LINE_DURATION_THRESHOLD) {
        return 'short';
    }

    return 'normal';
};

const getLineTransitionMode = (timingClass: LineTimingClass): LineTransitionMode => {
    if (timingClass === 'micro') {
        return 'none';
    }

    if (timingClass === 'short') {
        return 'fast';
    }

    return 'normal';
};

const getWordRevealMode = (timingClass: LineTimingClass): WordRevealMode => {
    if (timingClass === 'micro') {
        return 'instant';
    }

    if (timingClass === 'short') {
        return 'fast';
    }

    return 'normal';
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const buildLineRenderEndTime = (
    line: Pick<RenderHintLineLike, 'startTime' | 'endTime' | 'words'>,
    rawDuration: number,
    lineTransitionMode: LineTransitionMode,
    wordRevealMode: WordRevealMode
): number => {
    // renderEndTime is the latest point a visualizer may keep this line on screen for
    // active/pass/exit polish after reveal has finished. It is not a guaranteed standalone
    // timeline: a later line may start earlier and force the current renderer to cut that
    // extra window short.
    if (lineTransitionMode === 'none') {
        return Math.max(line.endTime, line.startTime + MICRO_LINE_RENDER_FLOOR);
    }

    const transitionTiming = getLineTransitionTiming(rawDuration, lineTransitionMode, wordRevealMode);
    const linePassStart = Math.max(getLastWordEndTime(line), line.startTime) + transitionTiming.linePassHold;
    const exitStart = lineTransitionMode === 'fast'
        ? Math.max(line.startTime + transitionTiming.enterDuration + 0.01, linePassStart, line.endTime - transitionTiming.exitDuration)
        : Math.max(linePassStart, line.endTime - transitionTiming.exitDuration);

    return Math.max(line.endTime, exitStart + transitionTiming.exitDuration);
};

export function buildLineRenderHints(line: RenderHintLineLike): LineRenderHints;
export function buildLineRenderHints(startTime: number, endTime: number): LineRenderHints;
export function buildLineRenderHints(lineOrStart: RenderHintLineLike | number, endTime?: number): LineRenderHints {
    const line = typeof lineOrStart === 'number'
        ? { startTime: lineOrStart, endTime: endTime ?? lineOrStart }
        : lineOrStart;
    const rawDuration = Math.max(line.endTime - line.startTime, 0);
    const timingClass = getTimingClass(rawDuration);
    const lineTransitionMode = getLineTransitionMode(timingClass);
    const wordRevealMode = getWordRevealMode(timingClass);

    return {
        rawDuration,
        timingClass,
        renderEndTime: buildLineRenderEndTime(line, rawDuration, lineTransitionMode, wordRevealMode),
        lineTransitionMode,
        wordRevealMode,
    };
}

export const getLineRenderHints = <T extends RenderHintLineLike>(line: T | null | undefined): LineRenderHints | null => {
    if (!line) {
        return null;
    }

    return line.renderHints ?? buildLineRenderHints(line);
};

export const getLineRenderEndTime = <T extends RenderHintLineLike>(line: T | null | undefined): number => {
    if (!line) {
        return Number.NEGATIVE_INFINITY;
    }

    return getLineRenderHints(line)?.renderEndTime ?? line.endTime;
};

const hasExpectedRenderHints = (line: RenderHintLineLike, expected: LineRenderHints): boolean => {
    const current = line.renderHints;

    return Boolean(
        current
        && current.rawDuration === expected.rawDuration
        && current.timingClass === expected.timingClass
        && current.renderEndTime === expected.renderEndTime
        && current.lineTransitionMode === expected.lineTransitionMode
        && current.wordRevealMode === expected.wordRevealMode
    );
};

export const migrateLyricLinesRenderHints = <T extends RenderHintLineLike>(lines: T[]): MigrationResult<T[]> => {
    let changed = false;

    const nextLines = lines.map(line => {
        const renderHints = buildLineRenderHints(line);
        if (hasExpectedRenderHints(line, renderHints)) {
            return line;
        }

        changed = true;
        return {
            ...line,
            renderHints,
        };
    });

    return {
        value: changed ? nextLines : lines,
        changed,
    };
};

export const annotateLyricLines = <T extends RenderHintLineLike>(lines: T[]): T[] => {
    return migrateLyricLinesRenderHints(lines).value;
};

export const ensureLyricLinesRenderHints = <T extends RenderHintLineLike>(lines: T[]): T[] => {
    return migrateLyricLinesRenderHints(lines).value;
};

export function migrateLyricDataRenderHints<T extends RenderHintLyricDataLike>(lyrics: T): MigrationResult<T>;
export function migrateLyricDataRenderHints<T extends RenderHintLyricDataLike>(
    lyrics: T | null | undefined
): MigrationResult<T | null>;
export function migrateLyricDataRenderHints<T extends RenderHintLyricDataLike>(
    lyrics: T | null | undefined
): MigrationResult<T | null> {
    if (!lyrics) {
        return { value: null, changed: false };
    }

    const migration = migrateLyricLinesRenderHints(lyrics.lines);
    if (!migration.changed) {
        return { value: lyrics, changed: false };
    }

    return {
        value: {
            ...lyrics,
            lines: migration.value,
        },
        changed: true,
    };
}

export const ensureLyricDataRenderHints = <T extends RenderHintLyricDataLike>(lyrics: T | null | undefined): T | null => {
    return migrateLyricDataRenderHints(lyrics).value;
};
