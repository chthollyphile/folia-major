// Plain ESM module shared with the Vercel and Worker runtimes; resolved through allowJs.
import { buildSegmentationManualPrompt } from '../../shared/lyricSegmentationPrompt.mjs';
import { requestLyricSegmentation } from './aiText';

// src/services/lyricSegmentationAi.ts
// Renderer-side entry to lyric word segmentation. Each request leaves through ./aiText (the
// desktop bridge, or the deployment's own route on the web); this file batches the lines, checks
// what comes back and reports progress.
//
// The prompt shown to the user for the copy-and-paste path comes from the same shared module the
// three server paths use, so "run it yourself" and "run it for me" ask for identical output.
//
// Requests are batched, but the batch is large enough that a normal song is a single call.
//
// Batching was originally added because a whole song took a minute; that turned out to be Gemini's
// thinking tokens, and with those off the picture reverses — each request carries ~1.4s of fixed
// network cost, so splitting a song makes it slower. Measured end to end: 43 lines took 6.5s as
// three batches and 3.6s as one.
//
// The machinery stays because it costs nothing when unused and still covers the case one request
// cannot: output grows at roughly 18 tokens per line, so a very long lyric would otherwise run
// into SEGMENTATION_MAX_OUTPUT_TOKENS and truncate, failing the whole song instead of one batch.

/**
 * Lines per request. Sized so essentially every song is one call, while keeping a batch's output
 * (~1800 tokens at 100 lines) well clear of the token ceiling.
 */
export const SEGMENTATION_BATCH_SIZE = 100;

/** The full prompt a user copies into a model site, lyrics included. */
export const buildLyricSegmentationPrompt = (lines: string[]): string => (
    buildSegmentationManualPrompt(lines)
);

/**
 * A null row is a line the model got wrong, already rejected server-side; it keeps the default
 * split. Only the row count is structural, since it is what maps rows back onto lyric lines.
 */
const assertBoundaries = (value: unknown, lines: string[]): (string[] | null)[] => {
    if (!Array.isArray(value) || value.length !== lines.length) {
        throw new Error('Segmentation response did not cover every line');
    }
    return value.map(row => (Array.isArray(row) ? row.map(segment => String(segment)) : null));
};

/** One request, with its answer checked against the lines. */
const segmentBatch = async (lines: string[], signal?: AbortSignal): Promise<(string[] | null)[]> => (
    assertBoundaries(await requestLyricSegmentation(lines, signal), lines)
);

export interface SegmentationProgress {
    /** Lines whose batch has come back, successfully or not. */
    done: number;
    total: number;
}

export interface SegmentationRunResult {
    /** Boundaries by index into the input; a null entry keeps that line on the default split. */
    boundaries: (string[] | null)[];
    appliedCount: number;
    /** One message per failed batch. Empty when everything landed. */
    failures: string[];
}

export interface SegmentLyricsOptions {
    signal?: AbortSignal;
    onProgress?: (progress: SegmentationProgress) => void;
}

/**
 * Segments the given lyric lines with the configured model, one batch at a time.
 *
 * A failed batch is reported rather than thrown: its lines simply keep the default split, which is
 * correct output, not corrupt output. On a lyric long enough to need more than one batch, throwing
 * the whole run away because the model fumbled one of them is the worse trade — the user paid for
 * the batches that did come back. A run where nothing landed still throws, since there is nothing
 * to save.
 */
export const segmentLyricsWithAi = async (
    lines: string[],
    { signal, onProgress }: SegmentLyricsOptions = {},
): Promise<SegmentationRunResult> => {
    if (lines.length === 0) {
        throw new Error('No lyric lines to segment');
    }

    const boundaries: (string[] | null)[] = new Array(lines.length).fill(null);
    const failures: string[] = [];
    let appliedCount = 0;

    for (let start = 0; start < lines.length; start += SEGMENTATION_BATCH_SIZE) {
        if (signal?.aborted) {
            throw new DOMException('Segmentation cancelled', 'AbortError');
        }

        const batch = lines.slice(start, start + SEGMENTATION_BATCH_SIZE);
        try {
            const result = await segmentBatch(batch, signal);
            result.forEach((row, offset) => {
                if (!row) return;
                boundaries[start + offset] = row;
                appliedCount += 1;
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw error;
            }
            failures.push(error instanceof Error ? error.message : String(error));
        }

        onProgress?.({ done: Math.min(start + SEGMENTATION_BATCH_SIZE, lines.length), total: lines.length });
    }

    if (appliedCount === 0) {
        throw new Error(failures[0] || 'Failed to segment lyrics');
    }

    return { boundaries, appliedCount, failures };
};
