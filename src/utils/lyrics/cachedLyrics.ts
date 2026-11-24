import type { LyricData } from '../../types';

// src/utils/lyrics/cachedLyrics.ts
// What cached lyrics say about when they were saved.

/**
 * Whether lyrics were saved before chorus lines recorded where their chorus came from (#1333): they mark chorus
 * lines, none of which says so. Such lines read as guessed from repeated text, so a chorus the source gave (a
 * platform's chorus ranges, a TTML songPart) gets no tick on the progress bar for as long as the entry is read.
 * Every host path that marks a chorus line now records an origin (chorusEffects.ts, ttmlConversion.ts,
 * chorusResolver.ts for marks that came with the lyrics, the mod DTO mapping), so newer lyrics never look so.
 */
export const savedBeforeChorusOrigin = (lyrics: Pick<LyricData, 'lines'>): boolean => {
    const chorusLines = lyrics.lines.filter(line => line.isChorus);
    return chorusLines.length > 0 && chorusLines.every(line => line.chorusOrigin === undefined);
};
