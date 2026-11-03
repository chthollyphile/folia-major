import type { MonetBackgroundImage, MonetBackgroundTuning, Theme } from '../../../types';
import type { MonetBackgroundPaintReply, MonetBackgroundPaintRequest } from './monetBackground.worker';

// src/components/visualizer/monet/monetBackgroundPipeline.ts
// Builds and caches the static Monet poster background so the visualizer only recomputes when inputs change.
// The picture is painted in a worker (monetBackground.worker.ts); this thread only loads the image
// and hands it over.
interface PictureEntry {
    url: Promise<string | null>;
    /** Layers that still want the picture: one no one wants by its turn in the worker is not made. */
    holders: number;
}

const monetBackgroundCache = new Map<string, PictureEntry>();

interface BuildMonetBackgroundOptions {
    coverUrl?: string | null;
    monetBackgroundImage?: MonetBackgroundImage | null;
    theme: Theme;
    tuning: MonetBackgroundTuning;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveSourceUrl = ({
    coverUrl,
    monetBackgroundImage,
    tuning,
}: Pick<BuildMonetBackgroundOptions, 'coverUrl' | 'monetBackgroundImage' | 'tuning'>) => (
    tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null
);

const loadImage = async (src: string): Promise<HTMLImageElement> => {
    const image = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
        image.crossOrigin = 'anonymous';
    }
    image.decoding = 'async';
    
    // Create a promise for the fallback load event
    const loadPromise = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });

    image.src = src;

    try {
        await image.decode();
    } catch (e) {
        // Fallback to waiting for onload if decode() fails or is unsupported
        await loadPromise;
    }
    
    return image;
};

export const getMonetBackgroundCacheKey = ({
    coverUrl,
    monetBackgroundImage,
    theme,
    tuning,
}: BuildMonetBackgroundOptions) => JSON.stringify({
    sourceUrl: resolveSourceUrl({ coverUrl, monetBackgroundImage, tuning }),
    uploadedId: tuning.backgroundSource === 'uploaded-global' ? monetBackgroundImage?.id ?? null : null,
    theme: {
        backgroundColor: theme.backgroundColor,
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
    },
    tuning: {
        backgroundSource: tuning.backgroundSource,
        backgroundBlurPx: tuning.backgroundBlurPx,
        backgroundOverlayOpacity: tuning.backgroundOverlayOpacity,
        backgroundGrayscale: tuning.backgroundGrayscale,
        backgroundSaturation: tuning.backgroundSaturation,
        backgroundWash: tuning.backgroundWash,
        backgroundWashColorMode: tuning.backgroundWashColorMode,
        backgroundWashCustomColor: tuning.backgroundWashCustomColor,
        // Drift is a DOM-side transform and never reaches the bitmap, so it stays out of the key
        // the same way backgroundLayout does; streaks are baked in and must invalidate it.
        backgroundStreaksEnabled: tuning.backgroundStreaksEnabled,
    },
});

let isCanvasFilterSupportedCached: boolean | null = null;

/**
 * Checks if the browser's Canvas 2D context actually supports and applies the filter property.
 * This handles cases like iOS Safari where ctx.filter is defined but silently does nothing.
 */
export const checkCanvasFilterSupport = (): boolean => {
    if (isCanvasFilterSupportedCached !== null) {
        return isCanvasFilterSupportedCached;
    }
    if (typeof document === 'undefined') {
        return false;
    }
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const ctx = canvas.getContext('2d');
        if (!ctx || typeof ctx.filter !== 'string') {
            isCanvasFilterSupportedCached = false;
            if (import.meta.env.DEV) {
                console.log('[MonetBackground] Canvas filter support detection: Unsupported (ctx.filter is missing)');
            }
            return false;
        }
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 2, 2);
        ctx.filter = 'blur(1px)';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        const imgData = ctx.getImageData(1, 1, 1, 1);
        isCanvasFilterSupportedCached = imgData.data[0] > 0;
        if (import.meta.env.DEV) {
            console.log(`[MonetBackground] Canvas filter support detection: ${isCanvasFilterSupportedCached ? 'Supported (native)' : 'Unsupported (CSS blur fallback will be used)'}`);
        }
        return isCanvasFilterSupportedCached;
    } catch (e) {
        isCanvasFilterSupportedCached = false;
        if (import.meta.env.DEV) {
            console.log('[MonetBackground] Canvas filter support detection failed:', e);
        }
        return false;
    }
};

interface PaintJob {
    request: Omit<MonetBackgroundPaintRequest, 'id'>;
    /** Whether a layer still wants the picture, asked when its turn comes. */
    wanted: () => boolean;
    /** The picture, null where it could not be made, undefined where no one wanted it any more. */
    settle: (picture: Blob | null | undefined) => void;
}

let painter: Worker | null = null;
let lastRequestId = 0;
let painting: (PaintJob & { id: number }) | null = null;
// One picture at a time in the worker, the others wait here. A picture no layer wants any more by
// its turn (a song skipped, a theme replaced within the settle time) is dropped unpainted: in the
// worker's own queue it would be painted, 150-250 ms on slow cores, ahead of the one to be shown.
const queuedPaints: PaintJob[] = [];

const paintNext = () => {
    while (!painting && queuedPaints.length > 0) {
        const job = queuedPaints.shift()!;
        if (!job.wanted()) {
            job.request.image.close();
            job.settle(undefined);
            continue;
        }
        const id = (lastRequestId += 1);
        painting = { ...job, id };
        try {
            ensurePainter().postMessage({ ...job.request, id } satisfies MonetBackgroundPaintRequest, { transfer: [job.request.image] });
        } catch {
            painting = null;
            job.request.image.close();
            job.settle(null);
        }
    }
};

const finishPainting = (picture: Blob | null) => {
    const job = painting;
    painting = null;
    job?.settle(picture);
    paintNext();
};

/** The worker that paints the pictures, started with the first one. */
const ensurePainter = (): Worker => {
    if (painter) {
        return painter;
    }
    const worker = new Worker(new URL('./monetBackground.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MonetBackgroundPaintReply>) => {
        if (event.data.id === painting?.id) {
            finishPainting('picture' in event.data ? event.data.picture : null);
        }
    };
    // The worker failed (it could not start, or broke on a picture): that picture is not made, and
    // the next one starts another worker.
    worker.onerror = () => {
        worker.terminate();
        painter = null;
        finishPainting(null);
    };
    painter = worker;
    return worker;
};

const paintOffThread = (request: PaintJob['request'], wanted: PaintJob['wanted']) => new Promise<Blob | null | undefined>((settle) => {
    queuedPaints.push({ request, wanted, settle });
    paintNext();
});

/** The picture's blob URL; null where it could not be made, undefined where no one wanted it by its turn. */
const buildMonetBackgroundUrl = async ({
    coverUrl,
    monetBackgroundImage,
    theme,
    tuning,
}: BuildMonetBackgroundOptions, wanted: PaintJob['wanted']): Promise<string | null | undefined> => {
    const sourceUrl = resolveSourceUrl({ coverUrl, monetBackgroundImage, tuning });
    if (!sourceUrl) {
        return null;
    }

    const image = await createImageBitmap(await loadImage(sourceUrl));
    const picture = await paintOffThread({
        image,
        colors: {
            backgroundColor: theme.backgroundColor,
            primaryColor: theme.primaryColor,
            accentColor: theme.accentColor,
        },
        tuning,
        blurPx: checkCanvasFilterSupport() ? clamp(tuning.backgroundBlurPx, 0, 60) : null,
    }, wanted);
    if (!picture) {
        return picture;
    }

    const url = URL.createObjectURL(picture);
    // Decoded (off this thread) before it is handed over: the background says it is ready only once
    // its picture can be drawn.
    const decoded = new Image();
    decoded.src = url;
    try {
        await decoded.decode();
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
    return url;
};

/**
 * The picture for these inputs, made once and kept. The caller releases it once it no longer wants
 * it: a picture no one wants by its turn in the worker is not made, and is made if asked for again.
 */
export const wantMonetBackgroundUrl = (options: BuildMonetBackgroundOptions): { url: Promise<string | null>; release: () => void } => {
    const cacheKey = getMonetBackgroundCacheKey(options);
    let entry = monetBackgroundCache.get(cacheKey);
    if (!entry) {
        const made: PictureEntry = { url: Promise.resolve(null), holders: 0 };
        const wanted = () => {
            if (made.holders > 0) {
                return true;
            }
            if (monetBackgroundCache.get(cacheKey) === made) {
                monetBackgroundCache.delete(cacheKey);
            }
            return false;
        };
        made.url = buildMonetBackgroundUrl(options, wanted).then(url => url ?? null, () => null);
        monetBackgroundCache.set(cacheKey, made);
        entry = made;
    }
    const held = entry;
    held.holders += 1;
    let released = false;
    return {
        url: held.url,
        release: () => {
            if (!released) {
                released = true;
                held.holders -= 1;
            }
        },
    };
};
