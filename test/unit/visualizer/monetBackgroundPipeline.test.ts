// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonetBackgroundTuning, Theme } from '@/types';
import { DEFAULT_MONET_BACKGROUND_TUNING } from '@/types';

// test/unit/visualizer/monetBackgroundPipeline.test.ts
// The Monet pictures are painted in a worker one at a time. A picture no one wants any more by its
// turn (a song skipped, a theme replaced) is not painted, and is made if asked for again.

const posted: string[] = [];
let worker: { onmessage: ((event: MessageEvent) => void) | null; onerror: (() => void) | null } | null = null;

class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
        worker = this;
    }
    postMessage(data: { id: number; image: { source: string } }) {
        posted.push(data.image.source);
        lastId = data.id;
    }
    terminate() {}
}

let lastId = 0;
const reply = () => worker!.onmessage!({ data: { id: lastId, picture: new Blob(['jpeg']) } } as MessageEvent);

class FakeImage {
    src = '';
    crossOrigin = '';
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decode() {
        return Promise.resolve();
    }
}

const theme = { backgroundColor: '#000000', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor: '#ff0000' } as Theme;
const tuning: MonetBackgroundTuning = { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundSource: 'cover-derived' };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let wantMonetBackgroundUrl: typeof import('@/components/visualizer/monet/monetBackgroundPipeline').wantMonetBackgroundUrl;

beforeEach(async () => {
    posted.length = 0;
    worker = null;
    // jsdom has no 2D canvas: the blur check says unsupported without printing that.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('createImageBitmap', async (image: FakeImage) => ({ source: image.src, close: () => {} }));
    let blobs = 0;
    URL.createObjectURL = () => `blob:${(blobs += 1)}`;
    URL.revokeObjectURL = () => {};
    vi.resetModules();
    ({ wantMonetBackgroundUrl } = await import('@/components/visualizer/monet/monetBackgroundPipeline'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Monet pictures in the worker', () => {
    it('a picture released before its turn is not painted, and is made when asked for again', async () => {
        const first = wantMonetBackgroundUrl({ coverUrl: 'cover-a', theme, tuning });
        const skipped = wantMonetBackgroundUrl({ coverUrl: 'cover-b', theme, tuning });
        const last = wantMonetBackgroundUrl({ coverUrl: 'cover-c', theme, tuning });
        await flush();
        expect(posted).toEqual(['cover-a']);

        skipped.release();
        reply();
        expect(await first.url).toBe('blob:1');
        await flush();
        expect(posted).toEqual(['cover-a', 'cover-c']);
        expect(await skipped.url).toBeNull();
        reply();
        expect(await last.url).toBe('blob:2');

        const again = wantMonetBackgroundUrl({ coverUrl: 'cover-b', theme, tuning });
        await flush();
        expect(posted).toEqual(['cover-a', 'cover-c', 'cover-b']);
        reply();
        expect(await again.url).toBe('blob:3');
    });

    it('a picture still held by another layer is painted', async () => {
        wantMonetBackgroundUrl({ coverUrl: 'cover-a', theme, tuning });
        const one = wantMonetBackgroundUrl({ coverUrl: 'cover-b', theme, tuning });
        const other = wantMonetBackgroundUrl({ coverUrl: 'cover-b', theme, tuning });
        await flush();
        one.release();
        reply();
        await flush();
        expect(posted).toEqual(['cover-a', 'cover-b']);
        reply();
        expect(await other.url).toBe('blob:2');
    });

    it('a worker that fails loses only the picture it was painting', async () => {
        const broken = wantMonetBackgroundUrl({ coverUrl: 'cover-a', theme, tuning });
        const next = wantMonetBackgroundUrl({ coverUrl: 'cover-b', theme, tuning });
        await flush();
        const failed = worker!;
        failed.onerror!();
        expect(await broken.url).toBeNull();
        await flush();
        expect(worker).not.toBe(failed);
        expect(posted).toEqual(['cover-a', 'cover-b']);
        reply();
        expect(await next.url).toBe('blob:1');
    });
});
