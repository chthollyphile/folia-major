import type { Line, SubtitleContentMode } from '../../types';
import type { RemoteLyricLayout, RemoteLyricMainRow } from '../../types/remoteControl';
import { buildLineGraphemeTimeline } from '../../utils/lyrics/graphemeTiming';

// src/components/remote/remoteLyricText.ts
// The remote window's lyric block as plain rules: what each of its rows shows (set on the remote
// window's settings page, RemoteLyricLayout), how much room each text gets, and how a line is cut
// into the pieces that fill word by word.

export type RemoteSecondLineKind = 'translation' | 'romanization' | 'original' | 'next';

export interface RemoteLyricTexts {
    /** The small line directly under the lyric. Only the 'both' mode has one. */
    romanization: string | null;
    /** The second line, and what it is: the next lyric line is drawn fainter than a translation. */
    second: { text: string; kind: RemoteSecondLineKind } | null;
}

type LyricTextSource = Pick<Line, 'fullText' | 'translation' | 'romanization'>;
type LineTexts = Record<RemoteLyricMainRow, string | null>;

const cleanText = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

/** A line's three texts; a translation or romanization that only repeats the lyric counts as missing. */
const readLineTexts = (line: LyricTextSource): LineTexts => {
    const original = cleanText(line.fullText);
    const unlessLyric = (text: string | null) => (text === original ? null : text);
    return {
        original,
        translation: unlessLyric(cleanText(line.translation)),
        romanization: unlessLyric(cleanText(line.romanization)),
    };
};

/**
 * Picks the texts under the line being sung, following the main window's `subtitleContentMode`.
 * A line that lacks what the mode asks for shows the next lyric line; in 'both' one missing text
 * leaves the other alone, and the next line only shows when both are missing.
 * A translation or romanization that only repeats the lyric counts as missing, and in 'both' a
 * romanization that repeats the translation is shown once, as the translation.
 * Without `nextFallback` the next line never stands in: what the mode asks for and lacks shows nothing.
 */
export const resolveRemoteLyricTexts = (
    mode: SubtitleContentMode,
    line: LyricTextSource | null | undefined,
    nextLine: Pick<Line, 'fullText'> | null | undefined,
    nextFallback = true,
): RemoteLyricTexts => {
    if (!line) {
        return { romanization: null, second: null };
    }

    const { translation, romanization } = readLineTexts(line);
    const nextText = nextFallback ? cleanText(nextLine?.fullText) : null;
    const next: RemoteLyricTexts['second'] = nextText ? { text: nextText, kind: 'next' } : null;

    if (mode === 'translation') {
        return { romanization: null, second: translation ? { text: translation, kind: 'translation' } : next };
    }

    if (mode === 'romanization') {
        return { romanization: null, second: romanization ? { text: romanization, kind: 'romanization' } : next };
    }

    if (mode === 'both') {
        if (!translation && !romanization) {
            return { romanization: null, second: next };
        }
        return {
            romanization: romanization === translation ? null : romanization,
            second: translation ? { text: translation, kind: 'translation' } : null,
        };
    }

    return { romanization: null, second: next };
};

export interface RemoteLyricRows extends RemoteLyricTexts {
    /** What the large row shows in place of the line itself; null draws the line, filled word by word. */
    hero: { text: string; kind: Exclude<RemoteLyricMainRow, 'original'> } | null;
    /** The second pair, the next line: its large row and its small row. Null with one pair or no next line. */
    upcoming: { main: string; sub: string | null } | null;
}

/**
 * The second pair's small row for 'auto': what the 副字幕 puts under a line, one text only, never the
 * text its large row already shows ('both' then takes the other one).
 */
const pickAutoUpcomingSub = (mode: SubtitleContentMode, texts: LineTexts, main: string): string | null => {
    const unlessMain = (text: string | null) => (text === main ? null : text);
    if (mode === 'translation') return unlessMain(texts.translation);
    if (mode === 'romanization') return unlessMain(texts.romanization);
    if (mode === 'both') return unlessMain(texts.translation) ?? unlessMain(texts.romanization);
    return null;
};

/**
 * What each row of the lyric block shows under a layout.
 * A large row asked for a translation or romanization the line lacks shows the line itself. A small
 * row shows nothing when its text is missing or only repeats the large row; with one pair the next
 * line stands in there, as it always has ('auto' keeps the 副字幕's own rules, 'both' included). With
 * two pairs the next line has a pair of its own, so nothing stands in.
 */
export const resolveRemoteLyricRows = (
    layout: RemoteLyricLayout,
    mode: SubtitleContentMode,
    line: LyricTextSource | null | undefined,
    nextLine: LyricTextSource | null | undefined,
): RemoteLyricRows => {
    if (!line) {
        return { hero: null, romanization: null, second: null, upcoming: null };
    }

    const [mainRow, subRow, nextMainRow, nextSubRow] = layout.rows;
    const twoPairs = layout.pairs === 2;
    const texts = readLineTexts(line);
    const heroText = mainRow === 'original' ? null : texts[mainRow];
    const hero: RemoteLyricRows['hero'] = heroText && mainRow !== 'original' ? { text: heroText, kind: mainRow } : null;
    const shownMain = hero?.text ?? texts.original;
    const nextText = twoPairs ? null : cleanText(nextLine?.fullText);
    const next: RemoteLyricTexts['second'] = nextText ? { text: nextText, kind: 'next' } : null;

    let under: RemoteLyricTexts;
    if (subRow === 'none') {
        under = { romanization: null, second: null };
    } else if (subRow === 'auto') {
        under = resolveRemoteLyricTexts(mode, line, nextLine, !twoPairs);
        // A large row showing the translation or romanization takes it from under the line.
        if (under.romanization === shownMain) {
            under = { ...under, romanization: null };
        }
        if (under.second && under.second.kind !== 'next' && under.second.text === shownMain) {
            under = { ...under, second: null };
        }
        // With nothing left under the line, the next line stands in, as for a line without the text at all.
        if (!under.romanization && !under.second) {
            under = { ...under, second: next };
        }
    } else {
        const text = texts[subRow];
        under = { romanization: null, second: text && text !== shownMain ? { text, kind: subRow } : next };
    }

    let upcoming: RemoteLyricRows['upcoming'] = null;
    if (twoPairs && nextLine) {
        const nextTexts = readLineTexts(nextLine);
        const main = nextTexts[nextMainRow] ?? nextTexts.original;
        if (main) {
            const sub = nextSubRow === 'none'
                ? null
                : nextSubRow === 'auto' ? pickAutoUpcomingSub(mode, nextTexts, main) : nextTexts[nextSubRow];
            upcoming = { main, sub: sub && sub !== main ? sub : null };
        }
    }

    return { hero, ...under, upcoming };
};

/** The block starts at y 40 and must not pass y 117. */
export const REMOTE_LYRIC_BLOCK_MAX_HEIGHT = 77;
const LARGE_LINE_HEIGHT = 26;
const SMALL_LINE_HEIGHT = 22;
const ROMANIZATION_HEIGHT = 1 + 15;
const SECOND_LINE_GAP = 4;
const SECOND_LINE_HEIGHT = 19;

export interface RemoteLyricFitInput {
    /** How many lines the lyric takes at the large size (20 px) in the block's width. */
    mainLinesAtLarge: number;
    hasRomanization: boolean;
    hasSecond: boolean;
    /** Two pairs are set: the second line keeps to one line, leaving the next pair room below. */
    secondOnOneLine?: boolean;
}

export interface RemoteLyricFit {
    /** 20 px / 26, or 17 px / 22 for a lyric that does not fit two lines at 20 px. */
    size: 'large' | 'small';
    mainLines: 1 | 2;
    showRomanization: boolean;
    secondMaxLines: 0 | 1 | 2;
}

/**
 * Shares the block's 77 px between the lyric, the romanization and the second line.
 * The lyric comes first, then the second line, then the romanization: a lyric on one line leaves
 * the second line two lines (one when a romanization sits between them); a lyric on two lines
 * leaves it one line and drops the romanization unless it is the only text under the lyric.
 */
export const resolveRemoteLyricFit = ({
    mainLinesAtLarge,
    hasRomanization,
    hasSecond,
    secondOnOneLine = false,
}: RemoteLyricFitInput): RemoteLyricFit => {
    const mainOnOneLine = mainLinesAtLarge <= 1;
    const showRomanization = hasRomanization && (mainOnOneLine || !hasSecond);
    const secondMaxLines = !hasSecond ? 0 : mainOnOneLine && !showRomanization && !secondOnOneLine ? 2 : 1;

    return {
        size: mainLinesAtLarge > 2 ? 'small' : 'large',
        mainLines: mainOnOneLine ? 1 : 2,
        showRomanization,
        secondMaxLines,
    };
};

/** The tallest the block can get under a fit, in px. */
export const resolveRemoteLyricBlockHeight = (fit: RemoteLyricFit): number => (
    fit.mainLines * (fit.size === 'small' ? SMALL_LINE_HEIGHT : LARGE_LINE_HEIGHT)
    + (fit.showRomanization ? ROMANIZATION_HEIGHT : 0)
    + (fit.secondMaxLines > 0 ? SECOND_LINE_GAP + fit.secondMaxLines * SECOND_LINE_HEIGHT : 0)
);

/** Idle, the keys gone and the line along the bottom edge, the block may reach y 150. */
export const REMOTE_LYRIC_IDLE_MAX_HEIGHT = 110;
/** The next pair, one line each: 6 px above it, a 15 px / 20 row and a 12 px / 16 row. */
const UPCOMING_GAP = 6;
const UPCOMING_MAIN_HEIGHT = 20;
const UPCOMING_SUB_HEIGHT = 16;

/**
 * Which rows of the next pair fit under the first pair when idle: the large row first, the small
 * one only when there is room for both.
 */
export const resolveRemoteUpcomingFit = (fit: RemoteLyricFit, hasSub: boolean): { main: boolean; sub: boolean } => {
    const room = REMOTE_LYRIC_IDLE_MAX_HEIGHT - resolveRemoteLyricBlockHeight(fit) - UPCOMING_GAP;
    const main = room >= UPCOMING_MAIN_HEIGHT;
    return { main, sub: main && hasSub && room >= UPCOMING_MAIN_HEIGHT + UPCOMING_SUB_HEIGHT };
};

/** The tallest the next pair can be under a fit, in px, the gap above it included. */
export const resolveRemoteUpcomingHeight = (rows: { main: boolean; sub: boolean }): number => (
    rows.main ? UPCOMING_GAP + UPCOMING_MAIN_HEIGHT + (rows.sub ? UPCOMING_SUB_HEIGHT : 0) : 0
);

export interface RemoteLyricSegment {
    text: string;
    /** A timed piece fills from startTime to endTime; an untimed one (spaces, loose punctuation) lights at startTime. */
    timed: boolean;
    startTime: number;
    endTime: number;
}

const WHITESPACE_ONLY = /^\s+$/;

/** A piece while the line is being cut: which word it came from and how many characters it holds. */
type RemoteLyricPiece = RemoteLyricSegment & { wordIndex?: number; length: number };

/**
 * Cuts a word-timed line into the pieces the window draws, in the order of `fullText`: one piece
 * per timed word, and the spaces and punctuation between words as pieces of their own. A word
 * with a space inside becomes several pieces that share the word's time by their length, so the
 * fill passes over them one after the other. Returns an empty list for a line timed by line only.
 */
export const buildRemoteLyricSegments = (line: Line): RemoteLyricSegment[] => {
    if (!line.words?.length) {
        return [];
    }

    const pieces: RemoteLyricPiece[] = [];
    const piecesByWord = new Map<number, RemoteLyricPiece[]>();
    let current: RemoteLyricPiece | null = null;

    const flush = () => {
        if (current && current.text) {
            pieces.push(current);
            if (current.wordIndex !== undefined) {
                piecesByWord.set(current.wordIndex, [...(piecesByWord.get(current.wordIndex) ?? []), current]);
            }
        }
        current = null;
    };

    for (const grapheme of buildLineGraphemeTimeline(line)) {
        if (!grapheme) {
            continue;
        }

        // A space never belongs to a timed piece: it has nothing to fill, and the line wraps at it.
        const word = WHITESPACE_ONLY.test(grapheme.char) || grapheme.wordIndex === undefined
            ? undefined
            : line.words[grapheme.wordIndex];
        const wordIndex = word ? grapheme.wordIndex : undefined;

        if (!current || wordIndex !== current.wordIndex) {
            flush();
            current = word
                ? { text: '', timed: true, startTime: word.startTime, endTime: word.endTime, wordIndex, length: 0 }
                : { text: '', timed: false, startTime: grapheme.startTime, endTime: grapheme.startTime, length: 0 };
        }

        current.text += grapheme.char;
        current.length += 1;
    }
    flush();

    piecesByWord.forEach((wordPieces, wordIndex) => {
        if (wordPieces.length < 2) {
            return;
        }

        const word = line.words[wordIndex];
        const totalLength = wordPieces.reduce((sum, piece) => sum + piece.length, 0);
        let startTime = word.startTime;
        wordPieces.forEach((piece, index) => {
            piece.startTime = startTime;
            startTime = index === wordPieces.length - 1
                ? word.endTime
                : startTime + (word.endTime - word.startTime) * (piece.length / totalLength);
            piece.endTime = startTime;
        });
    });

    return pieces.map(({ text, timed, startTime, endTime }) => ({ text, timed, startTime, endTime }));
};
