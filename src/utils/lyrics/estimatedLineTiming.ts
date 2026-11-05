import type { Word } from '../../types';
import { splitLyricGraphemes } from './graphemeTiming';

// Estimates word timing for line-synced lyrics, shared by the parsers and visualizers without the full parser.

/** Spreads a line-synced lyric over evenly weighted tokens: one per CJK character, one per spaced word otherwise. */
export const buildTimedWords = (text: string, startTime: number, endTime: number): Word[] => {
    const duration = Math.max(endTime - startTime, 0.1);
    const rawTokens = text.split(/\s+/).filter(token => token);
    const words: Word[] = [];
    const tokens: Array<{ text: string; weight: number }> = [];
    let totalWeight = 0;

    for (const token of rawTokens) {
        if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(token)) {
            // By grapheme, not UTF-16 unit: an emoji or a CJK Extension B character stays one token.
            splitLyricGraphemes(token).forEach(char => {
                const isPunctuation = /[，。！？、：；"'）]/.test(char);
                const weight = isPunctuation ? 0 : 1;
                tokens.push({ text: char, weight });
                totalWeight += weight;
            });
        } else {
            const weight = 1 + (token.length * 0.15);
            tokens.push({ text: token, weight });
            totalWeight += weight;
        }
    }

    if (totalWeight === 0) {
        totalWeight = 1;
    }

    const activeDuration = duration * 0.9;
    const timePerWeight = activeDuration / totalWeight;
    let currentWordStart = startTime;

    tokens.forEach(token => {
        const wordDuration = token.weight * timePerWeight;
        const finalDuration = Math.max(wordDuration, 0.05);

        words.push({
            text: token.text,
            startTime: currentWordStart,
            endTime: currentWordStart + finalDuration
        });

        if (token.weight > 0) {
            currentWordStart += wordDuration;
        } else {
            currentWordStart += 0.05;
        }
    });

    if (words.length > 0) {
        const lastWord = words[words.length - 1];
        if (lastWord.endTime > endTime) {
            const scale = (endTime - startTime) / (lastWord.endTime - startTime);
            words.forEach(word => {
                word.startTime = startTime + ((word.startTime - startTime) * scale);
                word.endTime = startTime + ((word.endTime - startTime) * scale);
            });
        }
    }

    return words;
};

/**
 * End time of a line-synced LRC line: the next line's start, but a line followed by a long gap ends after
 * a reading-time estimate so its sweep keeps a natural pace and the gap becomes an interlude.
 */
export const estimateLrcLineEndTime = (text: string, startTime: number, nextStartTime: number | undefined): number => {
    let duration = nextStartTime !== undefined ? nextStartTime - startTime : 5;
    const estimatedReadingTime = text.length * 0.5;
    if (duration > estimatedReadingTime + 2 && duration > 5) {
        duration = Math.min(duration, estimatedReadingTime + 2);
    }

    return startTime + duration;
};
