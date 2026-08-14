import TraceSkeleton from 'skeleton-tracing-js';
import { prepareWritingGlyph } from './elegyGeometry';
import type { ElegyTraceRequest, ElegyTraceResponse } from './types';

// src/components/visualizer/elegy/elegyGlyph.worker.ts
// Runs glyph thinning, skeleton tracing, cleanup, and ordering away from Pixi's render thread.
interface ElegyWorkerScope {
    onmessage: ((event: MessageEvent<ElegyTraceRequest>) => void) | null;
    postMessage(message: ElegyTraceResponse): void;
}

const workerScope = self as unknown as ElegyWorkerScope;

workerScope.onmessage = (event: MessageEvent<ElegyTraceRequest>) => {
    const request = event.data;
    if (request.type !== 'trace') return;

    try {
        const result = TraceSkeleton.fromBoolArray(
            Array.from(request.mask),
            request.width,
            request.height,
        );
        const response: ElegyTraceResponse = {
            type: 'traced',
            id: request.id,
            glyph: prepareWritingGlyph(
                request.char,
                request.width,
                request.height,
                result.polylines,
                request.mask,
            ),
        };
        workerScope.postMessage(response);
    } catch (error) {
        const response: ElegyTraceResponse = {
            type: 'failed',
            id: request.id,
            message: error instanceof Error ? error.message : String(error),
        };
        workerScope.postMessage(response);
    }
};

export { };
