import { LyricData } from '../../types';
import { resolveLyricProcessingOptions } from './filtering';
import { ensureLyricDataRenderHints } from './renderHints';
import { RawLyricSource } from './types';
import { EmbeddedLyricAdapter } from './adapters/EmbeddedLyricAdapter';
import { NeteaseLyricAdapter } from './adapters/NeteaseLyricAdapter';
import { NavidromeLyricAdapter } from './adapters/NavidromeLyricAdapter';
import { LocalFileLyricAdapter } from './adapters/LocalFileLyricAdapter';
import { QrcLyricAdapter } from './adapters/QrcLyricAdapter';
import type { LyricProcessingOptions } from './types';

export class LyricParserFactory {
    static async parse(source: RawLyricSource, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        const resolvedOptions = resolveLyricProcessingOptions(options);
        let parsed: LyricData | null = null;

        switch (source.type) {
            case 'embedded':
                parsed = await new EmbeddedLyricAdapter().parse(source, resolvedOptions);
                break;
            case 'netease':
                parsed = await new NeteaseLyricAdapter().parse(source, resolvedOptions);
                break;
            case 'navidrome':
                parsed = await new NavidromeLyricAdapter().parse(source, resolvedOptions);
                break;
            case 'local':
                parsed = await new LocalFileLyricAdapter().parse(source, resolvedOptions);
                break;
            case 'qrc':
                parsed = await new QrcLyricAdapter().parse(source, resolvedOptions);
                break;
            default:
                console.warn('[LyricParserFactory] Unknown lyric source type:', (source as any)?.type);
                return null;
        }

        // The listener's line rules are not applied here: parsed lyrics are cached, and the rules
        // run where lyrics are shown (createLyricsSetter), so a change of the rules needs no new fetch.
        return ensureLyricDataRenderHints(parsed);
    }
}
