/**
 * Lyrics Parser Web Worker
 *
 * Message API:
 * Request: { type: 'parse', format: 'lrc' | 'enhanced-lrc' | 'yrc' | 'qrc' | 'vtt', content: string, translation?: string, requestId?: string }
 * Response: { type: 'result', data: LyricData, requestId?: string } | { type: 'error', message: string, requestId?: string }
 */

import { parseLyricsByFormat, type LyricParseFormat } from '../utils/lyrics/parserCore';

const normalizeWorkerFormat = (format: string): LyricParseFormat => {
    if (format === 'yrc' || format === 'qrc' || format === 'enhanced-lrc' || format === 'vtt') {
        return format;
    }

    return 'lrc';
};

if (typeof self !== 'undefined') {
    self.onmessage = (e: MessageEvent) => {
        const { type, format, content, translation, options, requestId } = e.data;

        if (type !== 'parse') {
            self.postMessage({ type: 'error', message: 'Unknown message type', requestId });
            return;
        }

        try {
            const result = parseLyricsByFormat(normalizeWorkerFormat(format), content, translation || '', options);
            self.postMessage({ type: 'result', data: result, requestId });
        } catch (err) {
            self.postMessage({ type: 'error', message: String(err), requestId });
        }
    };
}
