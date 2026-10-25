import * as THREE from 'three';
import type { Line } from '../../../types';
import { isInterludeLine } from '../../../utils/lyrics/parserCore';
import { SCREEN } from './cinemaLayout';
import type { CinemaCaption } from './cinemaScene';

// src/components/scenes/cinema/cinemaCaption.ts
// A lyric line as a frame of film for the cinema hall's screen: light on black, the screen's shape,
// the line large and its translation smaller below, in the theme's fonts (the browser's own text
// engine, as diorama/dioramaTextRaster.ts explains). Also which line the film shows at a given time.

const WIDTH = 2048;
const HEIGHT = Math.round((WIDTH * SCREEN.height) / SCREEN.width);
const MAX_TEXT_WIDTH = WIDTH * 0.84;
/** Warm white, the colour of a projector bulb. */
const MAIN_COLOR = '#fff3dd';
const TRANSLATION_COLOR = 'rgba(255, 238, 214, 0.74)';

export interface CinemaCaptionFonts {
    stack: string;
    translationStack: string;
    weight: number;
}

/** Cuts text where a line may break: after each CJK character, between words elsewhere. */
const breakUnits = (text: string) => text.match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+|\s+/g) ?? [];

/** Wraps text to at most maxLines lines no wider than width, or null when it does not fit. */
const wrapTo = (context: CanvasRenderingContext2D, text: string, maxLines: number, width: number): string[] | null => {
    const lines: string[] = [];
    let current = '';
    for (const unit of breakUnits(text)) {
        const candidate = current + unit;
        if (!current.trim() || context.measureText(candidate.trimEnd()).width <= width) {
            current = candidate;
            continue;
        }
        lines.push(current.trim());
        current = unit.trimStart();
        if (lines.length >= maxLines) return null;
    }
    if (current.trim()) lines.push(current.trim());
    return lines.length <= maxLines && lines.every(line => context.measureText(line).width <= MAX_TEXT_WIDTH) ? lines : null;
};

/** Wraps to at most maxLines lines of even length (no word left alone on the last line), or null. */
const wrap = (context: CanvasRenderingContext2D, text: string, maxLines: number): string[] | null => {
    const total = context.measureText(text).width;
    if (total <= MAX_TEXT_WIDTH) return [text];
    for (let lines = 2; lines <= maxLines; lines += 1) {
        for (let slack = 1.04; slack <= 1.4; slack += 0.06) {
            const wrapped = wrapTo(context, text, lines, Math.min(MAX_TEXT_WIDTH, (total / lines) * slack));
            if (wrapped) return wrapped;
        }
    }
    return wrapTo(context, text, maxLines, MAX_TEXT_WIDTH);
};

/**
 * The size and lines for the text: one line at a large size if it fits, else the largest size from
 * `sizes` at which it fits in maxLines; the smallest, cut to fit, when none does.
 */
const fit = (context: CanvasRenderingContext2D, text: string, font: (size: number) => string, sizes: number[], maxLines: number) => {
    for (const size of sizes.filter(value => value >= sizes[0] * 0.72)) {
        context.font = font(size);
        if (context.measureText(text).width <= MAX_TEXT_WIDTH) return { size, lines: [text] };
    }
    for (const size of sizes) {
        context.font = font(size);
        const lines = wrap(context, text, maxLines);
        if (lines) return { size, lines };
    }
    const size = sizes[sizes.length - 1];
    context.font = font(size);
    return { size, lines: wrap(context, text, maxLines + 1) ?? [text] };
};

const sizesFrom = (largest: number, smallest: number) => {
    const sizes: number[] = [];
    for (let size = largest; size > smallest; size = Math.round(size * 0.9)) sizes.push(size);
    sizes.push(smallest);
    return sizes;
};

/** The light the frame throws, per screen third: the average of each third, linear. */
const thirdLights = (canvas: HTMLCanvasElement): CinemaCaption['light'] => {
    const sample = document.createElement('canvas');
    sample.width = 24;
    sample.height = 8;
    const context = sample.getContext('2d', { willReadFrequently: true });
    const sums = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    if (context) {
        context.drawImage(canvas, 0, 0, 24, 8);
        const pixels = context.getImageData(0, 0, 24, 8).data;
        for (let index = 0; index < 24 * 8; index += 1) {
            const sum = sums[Math.floor((index % 24) / 8)];
            sum[0] += pixels[index * 4];
            sum[1] += pixels[index * 4 + 1];
            sum[2] += pixels[index * 4 + 2];
        }
    }
    const [left, middle, right] = sums.map(([r, g, b]) => new THREE.Color().setRGB(r / 64 / 255, g / 64 / 255, b / 64 / 255, THREE.SRGBColorSpace));
    return [left, middle, right];
};

/** Draws a line (and its translation) as a frame of film. */
export const rasterCinemaCaption = (text: string, translation: string | null, fonts: CinemaCaptionFonts): CinemaCaption => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (context) {
        context.fillStyle = '#000000';
        context.fillRect(0, 0, WIDTH, HEIGHT);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const main = fit(context, text, size => `${fonts.weight} ${size}px ${fonts.stack}`, sizesFrom(156, 86), 2);
        const second = translation
            ? fit(context, translation, size => `400 ${size}px ${fonts.translationStack}`, sizesFrom(66, 44), 2)
            : null;
        const mainStep = main.size * 1.22;
        const secondStep = second ? second.size * 1.32 : 0;
        const gap = second ? main.size * 0.55 : 0;
        const block = main.lines.length * mainStep + gap + (second ? second.lines.length * secondStep : 0);
        let y = HEIGHT / 2 - block / 2 + mainStep / 2;
        // A soft glow under the letters, as the light spreads a little in the screen's surface.
        context.font = `${fonts.weight} ${main.size}px ${fonts.stack}`;
        context.fillStyle = MAIN_COLOR;
        context.shadowColor = 'rgba(255, 228, 190, 0.45)';
        context.shadowBlur = main.size * 0.22;
        main.lines.forEach(line => {
            context.fillText(line, WIDTH / 2, y);
            y += mainStep;
        });
        if (second) {
            y += gap - mainStep / 2 + secondStep / 2;
            context.font = `400 ${second.size}px ${fonts.translationStack}`;
            context.fillStyle = TRANSLATION_COLOR;
            context.shadowBlur = second.size * 0.18;
            second.lines.forEach(line => {
                context.fillText(line, WIDTH / 2, y);
                y += secondStep;
            });
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    return { texture, light: thirdLights(canvas) };
};

/** How long a line stays on the film after it ends, when the next one is far off. */
const HOLD_SECONDS = 1.6;

const hasWords = (line: Line | undefined): line is Line => !!line && !isInterludeLine(line) && line.fullText.trim().length > 0;

/**
 * The line the film shows at time t: the current line, held after it ends until the next one starts,
 * unless the pause is long; -1 for none (an interlude, an instrumental, before the first line).
 */
export const shownCinemaLine = (lines: readonly Line[], currentLineIndex: number, t: number): number => {
    const line = lines[currentLineIndex];
    if (!hasWords(line)) return -1;
    const next = lines[currentLineIndex + 1];
    const nextStart = hasWords(next) ? next.startTime : Number.POSITIVE_INFINITY;
    if (t > line.endTime + HOLD_SECONDS && nextStart - t > 0.25) return -1;
    return currentLineIndex;
};
