import type { Line, SubtitleContentMode } from '../../types';
import { buildLineGraphemeTimeline } from '../../utils/lyrics/graphemeTiming';

// src/components/remote/remoteLyricText.ts
// The remote window's lyric block as plain rules: which text goes under the line being sung, how
// much room each text gets, and how a line is cut into the pieces that fill word by word.

export type RemoteSecondLineKind = 'translation' | 'romanization' | 'next';

export interface RemoteLyricTexts {
    /** The small line directly under the lyric. Only the 'both' mode has one. */
    romanization: string | null;
    /** The second line, and what it is: the next lyric line is drawn fainter than a translation. */
    second: { text: string; kind: RemoteSecondLineKind } | null;
}

const cleanText = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

/**
 * Picks the texts under the line being sung, following the main window's `subtitleContentMode`.
 * A line that lacks what the mode asks for shows the next lyric line; in 'both' one missing text
 * leaves the other alone, and the next line only shows when both are missing.
 * A translation or romanization that only repeats the lyric counts as missing, and in 'both' a
 * romanization that repeats the translation is shown once, as the translation.
 */
export const resolveRemoteLyricTexts = (
    mode: SubtitleContentMode,
    line: Pick<Line, 'fullText' | 'translation' | 'romanization'> | null | undefined,
    nextLine: Pick<Line, 'fullText'> | null | undefined,
): RemoteLyricTexts => {
    if (!line) {
        return { romanization: null, second: null };
    }

    const lyricText = cleanText(line.fullText);
    const unlessLyric = (text: string | null) => (text === lyricText ? null : text);
    const translation = unlessLyric(cleanText(line.translation));
    const romanization = unlessLyric(cleanText(line.romanization));
    const nextText = cleanText(nextLine?.fullText);
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
}: RemoteLyricFitInput): RemoteLyricFit => {
    const mainOnOneLine = mainLinesAtLarge <= 1;
    const showRomanization = hasRomanization && (mainOnOneLine || !hasSecond);
    const secondMaxLines = !hasSecond ? 0 : mainOnOneLine && !showRomanization ? 2 : 1;

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
