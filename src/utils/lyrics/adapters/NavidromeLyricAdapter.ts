import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { LyricProcessingOptions, RawNavidromeLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';
import { detectTimedLyricFormat } from '../formatDetection';
import { normalizeEmbeddedLrcText, normalizeEmbeddedStructuredLyrics } from '../embeddedLrcNormalization';
import {
    isNavidromeStructuredLyricCollection,
    parseNavidromeStructuredLyrics,
    parseNavidromeStructuredLyricsCollection,
    selectPreferredNavidromeStructuredLyric,
} from '../navidromeStructuredLyrics';

// Navidrome v0.63+ exposes precise word timing through OpenSubsonic songLyrics v2 cue lines.
export class NavidromeLyricAdapter implements LyricAdapter<RawNavidromeLyric> {
    async parse(source: RawNavidromeLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        if (source.structuredLyrics && isNavidromeStructuredLyricCollection(source.structuredLyrics)) {
            const parsedStructuredLyrics = parseNavidromeStructuredLyricsCollection(source.structuredLyrics, options);
            if (parsedStructuredLyrics) {
                return parsedStructuredLyrics;
            }

            const mainLyrics = selectPreferredNavidromeStructuredLyric(source.structuredLyrics);
            const translationLyrics = selectPreferredNavidromeStructuredLyric(source.structuredLyrics, 'translation');
            const normalizedMainLyrics = normalizeEmbeddedStructuredLyrics(mainLyrics?.line);
            const normalizedTranslationLyrics = translationLyrics
                ? normalizeEmbeddedStructuredLyrics(translationLyrics.line).mainText
                : normalizedMainLyrics.translationText;
            return await parseLyricsAsync(
                detectTimedLyricFormat(normalizedMainLyrics.mainText),
                normalizedMainLyrics.mainText,
                normalizedTranslationLyrics,
                options
            );
        }

        if (source.structuredLyrics && !Array.isArray(source.structuredLyrics)) {
            const parsedStructuredLyrics = parseNavidromeStructuredLyrics(source.structuredLyrics, options);
            if (parsedStructuredLyrics) {
                return parsedStructuredLyrics;
            }

            const normalized = normalizeEmbeddedStructuredLyrics(source.structuredLyrics.line);
            return await parseLyricsAsync(
                detectTimedLyricFormat(normalized.mainText),
                normalized.mainText,
                normalized.translationText,
                options
            );
        }

        if (source.structuredLyrics && source.structuredLyrics.length > 0) {
            const normalized = normalizeEmbeddedStructuredLyrics(source.structuredLyrics);
            return await parseLyricsAsync(
                detectTimedLyricFormat(normalized.mainText),
                normalized.mainText,
                normalized.translationText,
                options
            );
        }

        if (source.plainLyrics) {
            const normalized = normalizeEmbeddedLrcText(source.plainLyrics);
            return await parseLyricsAsync(
                detectTimedLyricFormat(normalized.mainText),
                normalized.mainText,
                normalized.translationText,
                options
            );
        }

        return null;
    }
}
