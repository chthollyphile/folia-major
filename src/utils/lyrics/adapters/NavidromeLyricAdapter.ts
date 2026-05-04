import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { LyricProcessingOptions, RawNavidromeLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';
import { detectTimedLyricFormat } from '../formatDetection';
import { normalizeEmbeddedStructuredLyrics } from '../embeddedLrcNormalization';

// It's possible for Navidrome to provide embedded lyrics, but we need to reimplement the lyric fetching logic to get them directly from files, not the API (the API messed up the formatting and made it impossible to parse them correctly). 
// maybe do this later, since not much people use Navidrome and the API is still usable, just not ideal.
export class NavidromeLyricAdapter implements LyricAdapter<RawNavidromeLyric> {
    async parse(source: RawNavidromeLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
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
            return await parseLyricsAsync(detectTimedLyricFormat(source.plainLyrics), source.plainLyrics, '', options);
        }

        return null;
    }
}
