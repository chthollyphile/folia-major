import { colorWithAlpha, parseColorChannels } from '../colorMix';
import type { MonetBackgroundTuning, Theme } from '../../../types';

// src/components/visualizer/monet/monetBackgroundPaint.ts
// Paints the Monet poster background onto a 2D canvas: the cover cropped and blurred, the colour
// treatment pixel by pixel, the overlay. It touches no document, so it runs in the worker that
// makes the picture (monetBackground.worker.ts).
export const MONET_BACKGROUND_WIDTH = 1920;
export const MONET_BACKGROUND_HEIGHT = 1080;

/** The theme colours the picture is made with. */
export type MonetBackgroundColors = Pick<Theme, 'backgroundColor' | 'primaryColor' | 'accentColor'>;

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

const drawCoverCropped = (
    context: OffscreenCanvasRenderingContext2D,
    image: ImageBitmap,
    width: number,
    height: number,
) => {
    const imageWidth = image.width;
    const imageHeight = image.height;
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
    context: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
    theme: MonetBackgroundColors,
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
    context: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
    theme: MonetBackgroundColors,
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

    if (tuning.backgroundStreaksEnabled === false) {
        return;
    }

    context.fillStyle = colorWithAlpha(theme.backgroundColor, 0.1 + overlay * 0.08);
    for (let index = 0; index < 18; index += 1) {
        const x = (index * 127) % width;
        const y = ((index * 211) % height) - 40;
        context.fillRect(x, y, 1, height * 0.28);
    }
};

/**
 * The whole picture on a canvas of MONET_BACKGROUND_WIDTH x MONET_BACKGROUND_HEIGHT. `blurPx` is
 * the canvas blur, or null where the page blurs the picture with CSS instead.
 */
export const paintMonetBackground = (
    context: OffscreenCanvasRenderingContext2D,
    image: ImageBitmap,
    colors: MonetBackgroundColors,
    tuning: MonetBackgroundTuning,
    blurPx: number | null,
) => {
    const { width, height } = context.canvas;
    context.fillStyle = colors.backgroundColor;
    context.fillRect(0, 0, width, height);

    context.save();
    if (blurPx !== null) {
        context.filter = `blur(${blurPx}px)`;
    }
    drawCoverCropped(context, image, width, height);
    context.restore();

    applyBackgroundPostProcessing(context, width, height, colors, tuning);
    paintMonetOverlay(context, width, height, colors, tuning);
};
