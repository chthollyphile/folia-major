import type { LyricData, LyricProviderSource } from '../../types';
import { isLyricMatchSourceOffered } from './lyricMatchSources';
import { buildLyricSourceOrder } from './sourcePriority';

// src/utils/lyrics/ownWordTiming.ts
// When the automatic lyric pick keeps a song's own word-level lyrics (a platform that sets
// `prefersOwnWordByWord`) and when it asks the preferred source first (issue #1127).

/** The source the automatic pick asks first: the preferred one while it is on offer, else the default. */
export const firstLyricSourceAsked = (preferredSource?: LyricProviderSource): LyricProviderSource => (
    buildLyricSourceOrder(preferredSource && isLyricMatchSourceOffered(preferredSource) ? preferredSource : undefined)[0]
);

export interface OwnWordTimingCheck {
    /** The lyric source the song's own platform is, if it is one. */
    ownSource: LyricProviderSource | null | undefined;
    /** Whether that platform keeps its own word timing (`OnlineLyricsProvider.prefersOwnWordByWord`). */
    prefersOwn: boolean;
    /** The song's own lyrics. */
    lyrics: LyricData | null | undefined;
    /** The listener's setting: off, the song's own lyrics are matched like any other source's. */
    keepOwn: boolean;
}

/**
 * Whether the song's own word-level lyrics are kept over every source but the preferred one:
 * the preferred source is still asked first, and its word-level match wins.
 */
export const keepsOwnWordTiming = ({ ownSource, prefersOwn, lyrics, keepOwn }: OwnWordTimingCheck): boolean => (
    keepOwn && prefersOwn && Boolean(ownSource) && lyrics?.isWordByWord === true
);

/**
 * Whether the automatic pick ends on the song's own word-level lyrics without asking any source,
 * which is when they are kept and the source asked first is the song's own platform.
 */
export const settlesOnOwnWordTiming = (
    check: OwnWordTimingCheck,
    preferredSource: LyricProviderSource | undefined,
): boolean => keepsOwnWordTiming(check) && firstLyricSourceAsked(preferredSource) === check.ownSource;
