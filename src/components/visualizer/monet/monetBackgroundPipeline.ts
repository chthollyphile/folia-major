import { colorWithAlpha, parseColorChannels } from '../colorMix';
import type { MonetBackgroundImage, MonetBackgroundTuning, Theme } from '../../../types';

// src/components/visualizer/monet/monetBackgroundPipeline.ts
// Builds and caches the static Monet poster background so the visualizer only recomputes when inputs change.
const MONET_BACKGROUND_WIDTH = 1920;
const MONET_BACKGROUND_HEIGHT = 1080;
const monetBackgroundCache = new Map<string, Promise<string | null>>();

interface BuildMonetBackgroundOptions {
    coverUrl?: string | null;
    monetBackgroundImage?: MonetBackgroundImage | null;
    theme: Theme;
    tuning: MonetBackgroundTuning;
}

interface RgbChannels {
    r: number;
    g: number;
    b: number;
}

const FALLBACK_DARK: RgbChannels = { r: 10, g: 10, b: 12 };
const FALLBACK_LIGHT: RgbChannels = { r: 245, g: 245, b: 245 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const luminanceOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const resolveWashEndpoints = (
    background: RgbChannels,
    primary: RgbChannels,
) => {
    const backgroundLuminance = luminanceOf(background.r, background.g, background.b);
    const primaryLuminance = luminanceOf(primary.r, primary.g, primary.b);

    return backgroundLuminance <= primaryLuminance
        ? { shadow: background, highlight: primary }
        : { shadow: primary, highlight: background };
};

const resolveSourceUrl = ({
    coverUrl,
    monetBackgroundImage,
    tuning,
}: Pick<BuildMonetBackgroundOptions, 'coverUrl' | 'monetBackgroundImage' | 'tuning'>) => (
    tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null
);

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
        image.crossOrigin = 'anonymous';
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
});

const drawCoverCropped = (
    context: CanvasRenderingContext2D,
    image: CanvasImageSource,
    width: number,
    height: number,
) => {
    const imageWidth = 'width' in image ? image.width : width;
    const imageHeight = 'height' in image ? image.height : height;
    if (!imageWidth || !imageHeight) {
        return;
    }

    const scale = Math.max(width / imageWidth, height / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
};

const resolveThemeChannel = (color: string, fallback: RgbChannels): RgbChannels => {
    const parsed = parseColorChannels(color);
    return parsed
        ? {
            r: clamp(parsed.r, 0, 255),
            g: clamp(parsed.g, 0, 255),
            b: clamp(parsed.b, 0, 255),
        }
        : fallback;
};

export const resolveWashColor = (
    normalizedLuminance: number,
    background: RgbChannels,
    accent: RgbChannels,
    primary: RgbChannels,
): RgbChannels => {
    const { shadow, highlight } = resolveWashEndpoints(background, primary);
    if (normalizedLuminance <= 0.55) {
        const amount = normalizedLuminance / 0.55;
        return {
            r: mix(shadow.r, accent.r, amount),
            g: mix(shadow.g, accent.g, amount),
            b: mix(shadow.b, accent.b, amount),
        };
    }

    const amount = (normalizedLuminance - 0.55) / 0.45;
    return {
        r: mix(accent.r, highlight.r, amount),
        g: mix(accent.g, highlight.g, amount),
        b: mix(accent.b, highlight.b, amount),
    };
};

// Applies the stable canvas-only color treatment so Safari never needs CSS filters for Monet backgrounds.
const applyBackgroundPostProcessing = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: Theme,
    tuning: MonetBackgroundTuning,
) => {
    const grayscale = clamp(tuning.backgroundGrayscale, 0, 1);
    const saturation = clamp(tuning.backgroundSaturation, 0, 2);
    const wash = clamp(tuning.backgroundWash, 0, 1);
    if (grayscale <= 0 && Math.abs(saturation - 1) < 0.001 && wash <= 0) {
        return;
    }

    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    const background = resolveThemeChannel(theme.backgroundColor, FALLBACK_DARK);
    const accent = resolveThemeChannel(theme.accentColor, background);
    const primary = resolveThemeChannel(theme.primaryColor, FALLBACK_LIGHT);
    const customWash = resolveThemeChannel(tuning.backgroundWashCustomColor, accent);
    const washAccent = tuning.backgroundWashColorMode === 'custom' ? customWash : accent;

    for (let index = 0; index < data.length; index += 4) {
        let r = data[index];
        let g = data[index + 1];
        let b = data[index + 2];
        const alpha = data[index + 3];
        if (alpha === 0) {
            continue;
        }

        const luminance = luminanceOf(r, g, b);
        if (grayscale > 0) {
            r = mix(r, luminance, grayscale);
            g = mix(g, luminance, grayscale);
            b = mix(b, luminance, grayscale);
        }

        if (Math.abs(saturation - 1) >= 0.001) {
            const saturatedLuminance = luminanceOf(r, g, b);
            r = saturatedLuminance + (r - saturatedLuminance) * saturation;
            g = saturatedLuminance + (g - saturatedLuminance) * saturation;
            b = saturatedLuminance + (b - saturatedLuminance) * saturation;
        }

        if (wash > 0) {
            const washColor = resolveWashColor(clamp(luminance / 255, 0, 1), background, washAccent, primary);
            r = mix(r, washColor.r, wash);
            g = mix(g, washColor.g, wash);
            b = mix(b, washColor.b, wash);
        }

        data[index] = Math.round(clamp(r, 0, 255));
        data[index + 1] = Math.round(clamp(g, 0, 255));
        data[index + 2] = Math.round(clamp(b, 0, 255));
    }

    context.putImageData(imageData, 0, 0);
};

const paintMonetOverlay = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: Theme,
    tuning: MonetBackgroundTuning,
) => {
    const overlay = clamp(tuning.backgroundOverlayOpacity, 0, 1);
    const overlayGradient = context.createLinearGradient(0, 0, width, height);
    overlayGradient.addColorStop(0, colorWithAlpha(theme.accentColor, 0.08 + overlay * 0.62));
    overlayGradient.addColorStop(0.44, colorWithAlpha(theme.backgroundColor, 0.16 + overlay * 0.58));
    overlayGradient.addColorStop(1, colorWithAlpha(theme.primaryColor, 0.06 + overlay * 0.36));
    context.fillStyle = overlayGradient;
    context.fillRect(0, 0, width, height);

    const leftBloom = context.createRadialGradient(width * 0.18, height * 0.34, 0, width * 0.18, height * 0.34, width * 0.55);
    leftBloom.addColorStop(0, colorWithAlpha(theme.accentColor, overlay * 0.42));
    leftBloom.addColorStop(1, colorWithAlpha(theme.backgroundColor, 0));
    context.fillStyle = leftBloom;
    context.fillRect(0, 0, width, height);

    const rightVeil = context.createLinearGradient(width * 0.45, 0, width, 0);
    rightVeil.addColorStop(0, colorWithAlpha(theme.backgroundColor, 0));
    rightVeil.addColorStop(1, colorWithAlpha(theme.backgroundColor, 0.18 + overlay * 0.38));
    context.fillStyle = rightVeil;
    context.fillRect(0, 0, width, height);

    context.fillStyle = colorWithAlpha(theme.backgroundColor, 0.1 + overlay * 0.08);
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
    },
});

export const buildMonetBackgroundDataUrl = async ({
    coverUrl,
    monetBackgroundImage,
    theme,
    tuning,
}: BuildMonetBackgroundOptions): Promise<string | null> => {
    const sourceUrl = resolveSourceUrl({ coverUrl, monetBackgroundImage, tuning });
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

    context.save();
    context.filter = `blur(${clamp(tuning.backgroundBlurPx, 0, 60)}px)`;
    drawCoverCropped(context, image, canvas.width, canvas.height);
    context.restore();

    applyBackgroundPostProcessing(context, canvas.width, canvas.height, theme, tuning);
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
