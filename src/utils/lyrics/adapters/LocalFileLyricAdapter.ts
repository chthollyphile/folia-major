import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { LyricProcessingOptions, RawLocalFileLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';
import { splitCombinedTimeline } from '../timelineSplitter';
import { detectTimedLyricFormat } from '../formatDetection';

export class LocalFileLyricAdapter implements LyricAdapter<RawLocalFileLyric> {
    async parse(source: RawLocalFileLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        if (!source.lrcContent) return null;
        
        let mainLrc = source.lrcContent;
        let transLrc = source.tLrcContent || '';
        let format = source.formatHint || detectTimedLyricFormat(mainLrc);

        if (!transLrc && format !== 'ttml') {
            const { main, trans } = splitCombinedTimeline(mainLrc);
            mainLrc = main;
            transLrc = trans;
            format = source.formatHint || detectTimedLyricFormat(mainLrc);
        }

        return await parseLyricsAsync(format, mainLrc, transLrc, options);
    }
}
