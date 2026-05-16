import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { LyricProcessingOptions, RawQrcLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';

export class QrcLyricAdapter implements LyricAdapter<RawQrcLyric> {
    async parse(source: RawQrcLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        if (!source.qrcContent?.trim()) return null;

        return parseLyricsAsync('qrc', source.qrcContent, source.translationContent || '', options);
    }
}
