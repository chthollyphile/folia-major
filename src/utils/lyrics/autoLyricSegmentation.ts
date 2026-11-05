import type { Line, LyricData } from '../../types';
import { HAN_OR_KANA } from './hanKanaText';
import { createStaffCreditMatcher, isColonShaped } from './staffCredits';

// src/utils/lyrics/autoLyricSegmentation.ts
// Which songs the 自动 AI 分词 setting segments, as a pure decision (issue #960). The hook that acts
// on it (hooks/useAutoLyricSegmentation) owns the timing; this file only answers "would a run now
// be wanted, and on which lines".

/** Fewest Chinese or Japanese lyric lines (credits aside) for a song to count as one. */
const MIN_HAN_KANA_LINES = 2;
/** And the share of the lyric lines they must make up, so a stray quoted line does not count. */
const MIN_HAN_KANA_SHARE = 0.2;

const isStaffLine = createStaffCreditMatcher();

/**
 * Whether the sung lines are Chinese or Japanese. Credit lines are left out first: online lyrics
 * of an English song often open with "作词 : …" lines, which keep their Han characters whenever the
 * staff policy leaves them on screen, and must not make the song look like a Chinese one.
 */
export const hasHanKanaLyrics = (lines: Line[]): boolean => {
    const sung = lines.filter(line => !isStaffLine(line) && !isColonShaped(line));
    const hanKana = sung.filter(line => HAN_OR_KANA.test(line.fullText)).length;
    return hanKana >= MIN_HAN_KANA_LINES && hanKana >= sung.length * MIN_HAN_KANA_SHARE;
};

export type AutoLyricSegmentationState = {
    enabled: boolean;
    /** The visualizer mode lays its text out by words, so a saved split would show. */
    usesWords: boolean;
    songKey: string | null;
    /** Playback key whose saved-record load has finished, from the segmentation store. */
    recordSongKey: string | null;
    hasRecord: boolean;
    isLyricsLoading: boolean;
    lyrics: LyricData | null;
    alreadyAttempted: boolean;
};

/**
 * The lines to send when an automatic run is wanted now, else null. Wanted means: the setting is
 * on, the mode draws words, the song's saved-record load is done and found nothing (a saved split,
 * AI or by hand, is never overwritten), the lyrics have settled, the song was not tried yet this
 * session, and the lyrics are Chinese or Japanese — elsewhere spaces already decide the words.
 */
export const pickAutoSegmentationLines = (state: AutoLyricSegmentationState): Line[] | null => {
    const { enabled, usesWords, songKey, recordSongKey, hasRecord, isLyricsLoading, lyrics, alreadyAttempted } = state;
    if (!enabled || !usesWords || !songKey || recordSongKey !== songKey || hasRecord) return null;
    if (isLyricsLoading || !lyrics || alreadyAttempted) return null;
    // Same filter as the command surface, so the record keys match what the surface would write.
    const lines = lyrics.lines.filter(line => Boolean(line.fullText));
    return hasHanKanaLyrics(lines) ? lines : null;
};
