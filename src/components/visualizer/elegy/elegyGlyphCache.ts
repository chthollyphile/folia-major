import type { WritingGlyph } from './types';
import type { ElegyTraceRequest, ElegyTraceResponse } from './types';

// src/components/visualizer/elegy/elegyGlyphCache.ts
// Rasterizes browser fonts once and owns the in-memory glyph/worker request cache.
const GLYPH_RESOLUTION = 256;
const GLYPH_FONT_SIZE = GLYPH_RESOLUTION * 0.75;
const GLYPH_PADDING = 12;
const ALPHA_THRESHOLD = 128;

export interface ElegyGlyphAsset {
    char: string;
    canvas: HTMLCanvasElement | null;
    glyph: WritingGlyph | null;
    rasterSize: number;
    advance: number;
    left: number;
    ascent: number;
    descent: number;
}

interface PendingTrace {
    resolve: (glyph: WritingGlyph) => void;
    reject: (error: Error) => void;
}

interface ElegyGlyphCacheOptions {
    fontFamily: string;
    fontWeight: string | number;
    fontStyle?: string;
    color: string;
}

const isBlank = (char: string) => /^\s+$/u.test(char);

export class ElegyGlyphCache {
    private readonly assets = new Map<string, Promise<ElegyGlyphAsset>>();
    private readonly pending = new Map<number, PendingTrace>();
    private readonly worker: Worker;
    private nextRequestId = 1;
    private destroyed = false;
    private workerError: Error | null = null;

    constructor(private readonly options: ElegyGlyphCacheOptions) {
        this.worker = new Worker(new URL('./elegyGlyph.worker.ts', import.meta.url), {
            type: 'module',
            name: 'folia-elegy-glyph-tracer',
        });
        this.worker.onmessage = this.handleWorkerMessage;
        this.worker.onerror = this.handleWorkerError;
    }

    get fontSize() {
        return GLYPH_FONT_SIZE;
    }

    prepare(char: string) {
        const key = `${this.options.fontFamily}|${this.options.fontWeight}|${this.options.fontStyle ?? 'normal'}|${char}`;
        const cached = this.assets.get(key);
        if (cached) return cached;

        const pending = this.rasterizeAndTrace(char);
        this.assets.set(key, pending);
        return pending;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.worker.terminate();
        const error = new Error('Elegy glyph cache was destroyed');
        this.pending.forEach(({ reject }) => reject(error));
        this.pending.clear();
        this.assets.clear();
    }

    private readonly handleWorkerMessage = (event: MessageEvent<ElegyTraceResponse>) => {
        const response = event.data;
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);

        if (response.type === 'failed') {
            pending.reject(new Error(response.message));
            return;
        }
        pending.resolve(response.glyph);
    };

    private readonly handleWorkerError = (event: ErrorEvent) => {
        const error = new Error(event.message || 'Elegy glyph worker failed');
        this.workerError = error;
        this.pending.forEach(({ reject }) => reject(error));
        this.pending.clear();
    };

    private trace(char: string, width: number, height: number, mask: Uint8Array) {
        if (this.destroyed) return Promise.reject(new Error('Elegy glyph cache was destroyed'));
        if (this.workerError) return Promise.reject(this.workerError);
        const id = this.nextRequestId;
        this.nextRequestId += 1;
        const request: ElegyTraceRequest = { type: 'trace', id, char, width, height, mask };

        return new Promise<WritingGlyph>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage(request, [mask.buffer]);
        });
    }

    // Browser-side rasterization guarantees that loaded CSS/custom fonts match the visible glyph.
    private async rasterizeAndTrace(char: string): Promise<ElegyGlyphAsset> {
        const fontStyle = this.options.fontStyle ?? 'normal';
        const font = `${fontStyle} ${this.options.fontWeight} ${GLYPH_FONT_SIZE}px ${this.options.fontFamily}`;
        await document.fonts?.load(font, char);

        const measuringCanvas = document.createElement('canvas');
        const measuringContext = measuringCanvas.getContext('2d');
        if (!measuringContext) throw new Error('Elegy could not create a glyph canvas');
        measuringContext.font = font;
        const metrics = measuringContext.measureText(char);
        const left = Math.max(0, metrics.actualBoundingBoxLeft || 0);
        const right = Math.max(metrics.actualBoundingBoxRight || metrics.width, 1);
        const ascent = Math.max(metrics.actualBoundingBoxAscent || GLYPH_FONT_SIZE * 0.8, 1);
        const descent = Math.max(metrics.actualBoundingBoxDescent || GLYPH_FONT_SIZE * 0.2, 0);
        const advance = Math.max(metrics.width, isBlank(char) ? GLYPH_FONT_SIZE * 0.35 : 1);

        if (isBlank(char)) {
            return {
                char,
                canvas: null,
                glyph: null,
                rasterSize: 1,
                advance,
                left,
                ascent,
                descent,
            };
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(left + right + GLYPH_PADDING * 2));
        canvas.height = Math.max(1, Math.ceil(ascent + descent + GLYPH_PADDING * 2));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Elegy could not create a glyph raster context');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = font;
        context.textBaseline = 'alphabetic';
        context.fillStyle = this.options.color;
        context.fillText(char, GLYPH_PADDING + left, GLYPH_PADDING + ascent);

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const mask = new Uint8Array(canvas.width * canvas.height);
        for (let index = 0; index < mask.length; index += 1) {
            mask[index] = imageData.data[index * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
        }
        const glyph = await this.trace(char, canvas.width, canvas.height, mask);

        return {
            char,
            canvas,
            glyph,
            rasterSize: Math.max(canvas.width, canvas.height),
            advance,
            left: left + GLYPH_PADDING,
            ascent: ascent + GLYPH_PADDING,
            descent: descent + GLYPH_PADDING,
        };
    }
}
