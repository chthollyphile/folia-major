import { colorWithAlpha } from '../colorMix';
import type { MonetBackgroundImage, MonetTuning, Theme } from '../../../types';

// src/components/visualizer/monet/monetBackgroundPipeline.ts
// Builds and caches the static Monet poster background so the visualizer only recomputes when inputs change.
const MONET_BACKGROUND_WIDTH = 1920;
const MONET_BACKGROUND_HEIGHT = 1080;
const monetBackgroundCache = new Map<string, Promise<string | null>>();

interface BuildMonetBackgroundOptions {
    coverUrl?: string | null;
    monetBackgroundImage?: MonetBackgroundImage | null;
    theme: Theme;
    tuning: MonetTuning;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
});

const drawCoverCropped = (
    context: CanvasRenderingContext2D,
    image: CanvasImageSource,
    width: number,
    height: number,
    cropMode: MonetTuning['backgroundCropMode'],
) => {
    const imageWidth = 'width' in image ? image.width : width;
    const imageHeight = 'height' in image ? image.height : height;
    if (!imageWidth || !imageHeight) {
        return;
    }

    const scale = cropMode === 'full-artwork'
        ? Math.min(width / imageWidth, height / imageHeight)
        : Math.max(width / imageWidth, height / imageHeight) * (cropMode === 'focus-cover' ? 1.12 : 1);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const offsetX = cropMode === 'focus-cover'
        ? width * 0.58 - drawWidth * 0.5
        : (width - drawWidth) / 2;
    const offsetY = cropMode === 'focus-cover'
        ? height * 0.46 - drawHeight * 0.5
        : (height - drawHeight) / 2;

    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
};

const paintMonetOverlay = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: Theme,
    tuning: MonetTuning,
) => {
    const overlayGradient = context.createLinearGradient(0, 0, width, height);
    overlayGradient.addColorStop(0, colorWithAlpha(theme.accentColor, tuning.backgroundOverlayOpacity * 0.9));
    overlayGradient.addColorStop(0.42, colorWithAlpha(theme.backgroundColor, tuning.backgroundOverlayOpacity * 0.76));
    overlayGradient.addColorStop(1, colorWithAlpha(theme.primaryColor, tuning.backgroundOverlayOpacity * 0.5));
    context.fillStyle = overlayGradient;
    context.fillRect(0, 0, width, height);

    const leftBloom = context.createRadialGradient(width * 0.18, height * 0.34, 0, width * 0.18, height * 0.34, width * 0.55);
    leftBloom.addColorStop(0, colorWithAlpha(theme.accentColor, tuning.backgroundOverlayOpacity * 0.4));
    leftBloom.addColorStop(1, colorWithAlpha(theme.backgroundColor, 0));
    context.fillStyle = leftBloom;
    context.fillRect(0, 0, width, height);

    context.fillStyle = colorWithAlpha(theme.backgroundColor, 0.12);
    for (let index = 0; index < 18; index += 1) {
        const x = (index * 127) % width;
        const y = ((index * 211) % height) - 40;
        context.fillRect(x, y, 1, height * 0.28);
    }
};

export const getMonetBackgroundCacheKey = ({
    coverUrl,
    monetBackgroundImage,
    theme,
    tuning,
}: BuildMonetBackgroundOptions) => JSON.stringify({
    coverUrl: coverUrl ?? null,
    uploadedId: monetBackgroundImage?.id ?? null,
    theme: {
        backgroundColor: theme.backgroundColor,
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
        secondaryColor: theme.secondaryColor,
    },
    tuning,
});

export const buildMonetBackgroundDataUrl = async ({
    coverUrl,
    monetBackgroundImage,
    theme,
    tuning,
}: BuildMonetBackgroundOptions): Promise<string | null> => {
    const sourceUrl = tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null;
    if (!sourceUrl) {
        return null;
    }

    const image = await loadImage(sourceUrl);
    const canvas = document.createElement('canvas');
    canvas.width = MONET_BACKGROUND_WIDTH;
    canvas.height = MONET_BACKGROUND_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }

    context.fillStyle = theme.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.filter = `blur(${Math.max(0, tuning.backgroundBlurPx)}px) saturate(1.06)`;
    drawCoverCropped(context, image, canvas.width, canvas.height, tuning.backgroundCropMode);

    paintMonetOverlay(context, canvas.width, canvas.height, theme, tuning);

    return canvas.toDataURL('image/jpeg', 0.92);
};

export const resolveMonetBackgroundDataUrl = (options: BuildMonetBackgroundOptions) => {
    const cacheKey = getMonetBackgroundCacheKey(options);
    const cached = monetBackgroundCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const next = buildMonetBackgroundDataUrl(options).catch(() => null);
    monetBackgroundCache.set(cacheKey, next);
    return next;
};
