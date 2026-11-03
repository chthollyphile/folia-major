import type { MonetBackgroundTuning } from '../../../types';
import {
    MONET_BACKGROUND_HEIGHT,
    MONET_BACKGROUND_WIDTH,
    paintMonetBackground,
    type MonetBackgroundColors,
} from './monetBackgroundPaint';

// src/components/visualizer/monet/monetBackground.worker.ts
// Makes the Monet background picture off the thread that draws the lyrics. On the main thread one
// picture held it for 150-200 ms on 4 slow cores (reading the pixels back, the colour treatment
// of 2 million pixels, the JPEG), on every song change.

export interface MonetBackgroundPaintRequest {
    id: number;
    image: ImageBitmap;
    colors: MonetBackgroundColors;
    tuning: MonetBackgroundTuning;
    blurPx: number | null;
}

export type MonetBackgroundPaintReply = { id: number; picture: Blob } | { id: number; error: string };

self.onmessage = async (event: MessageEvent<MonetBackgroundPaintRequest>) => {
    const { id, image, colors, tuning, blurPx } = event.data;
    try {
        const canvas = new OffscreenCanvas(MONET_BACKGROUND_WIDTH, MONET_BACKGROUND_HEIGHT);
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('no 2D context');
        }
        paintMonetBackground(context, image, colors, tuning, blurPx);
        const picture = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        self.postMessage({ id, picture } satisfies MonetBackgroundPaintReply);
    } catch (error) {
        self.postMessage({ id, error: String(error) } satisfies MonetBackgroundPaintReply);
    } finally {
        image.close();
    }
};
