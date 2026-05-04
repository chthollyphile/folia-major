import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { processNeteaseLyrics } from '../neteaseProcessing';
import { LyricProcessingOptions, RawNeteaseLyric } from '../types';

export class NeteaseLyricAdapter implements LyricAdapter<RawNeteaseLyric> {
    async parse(source: RawNeteaseLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        return (await processNeteaseLyrics(source, options)).lyrics;
    }
}
