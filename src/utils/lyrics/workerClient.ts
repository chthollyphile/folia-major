import { LyricData } from '../../types';
import type { LyricParseFormat } from './parserCore';
import type { LyricProcessingOptions } from './types';

let lyricsWorker: Worker | null = null;
let workerRequestId = 0;
const workerCallbacks = new Map<string, (data: LyricData | null) => void>();

export const initLyricsWorker = (): Worker => {
    if (!lyricsWorker) {
        // Need to use correct relative path or alias
        lyricsWorker = new Worker(
            new URL('../../workers/lyricsParser.worker.ts', import.meta.url),
            { type: 'module' }
        );
        lyricsWorker.onmessage = (e) => {
            const { type, data, requestId, message } = e.data;
            const callback = workerCallbacks.get(requestId);
            if (callback) {
                workerCallbacks.delete(requestId);
                if (type === 'result') {
                    callback(data);
                } else {
                    console.warn('[LyricsWorker] parsing error:', message);
                    callback(null);
                }
            }
        };
    }
    return lyricsWorker;
};

export const parseLyricsAsync = (
    format: LyricParseFormat,
    content: string,
    translation?: string,
    options?: LyricProcessingOptions
): Promise<LyricData | null> => {
    return new Promise((resolve) => {
        const worker = initLyricsWorker();
        const requestId = `req_${++workerRequestId}`;
        workerCallbacks.set(requestId, resolve);
        worker.postMessage({ type: 'parse', format, content, translation, options, requestId });
    });
};
