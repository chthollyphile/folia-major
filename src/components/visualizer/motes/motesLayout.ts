import { clearCache, layoutWithLines, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext';
import type { Line } from '../../../types';
import { buildLineGraphemeTimeline, splitLyricGraphemes, type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { measurePrefixOffsets } from '../textMeasureCache';
import { createMotesRandom, hashMotesSeed, MAX_MOTES_PARTICLES, RECOMMENDED_MOTES_PARTICLES, sampleMotesMask } from './motesSampling';

// Lays out intact text, then samples its painted strokes into a bounded particle target field.
export interface MotesLayoutOptions {
    width: number;
    height: number;
    fontFamily: string;
    fontWeight: number;
    fontScale: number;
    density: number;
    seed?: string | number;
}

export interface MotesPreparedLine {
    line: Line;
    width: number;
    height: number;
    fontPx: number;
    particleSize: number;
    timings: GraphemeTiming[];
    x: Float32Array;
    y: Float32Array;
    alpha: Float32Array;
    scatterX: Float32Array;
    scatterY: Float32Array;
    phases: Float32Array;
    glyphIndices: Uint32Array;
}

interface MotesRow {
    text: string;
    start: number;
    end: number;
    width: number;
    left: number;
    top: number;
    offsets: number[];
}

const finitePositive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;

// A web font finishing loading also invalidates Pretext's measurements for the same font string.
export const clearMotesMeasurementCache = () => clearCache();

// Pretext's cursors retain source offsets, including repeated words and whitespace between wraps.
export const layoutMotesText = (line: Line, options: MotesLayoutOptions) => {
    const width = finitePositive(options.width, 1);
    const height = finitePositive(options.height, 1);
    const maxWidth = width * 0.88;
    const maxHeight = height * 0.78;
    let fontPx = Math.max(8, Math.min(112, width * 0.075, height * 0.2) * finitePositive(options.fontScale, 1));
    const fontOf = (size: number) => `${options.fontWeight} ${size}px ${options.fontFamily}`;
    const prepare = () => prepareWithSegments(line.fullText, fontOf(fontPx), { whiteSpace: 'pre-wrap' });
    let prepared = prepare();
    let layout = layoutWithLines(prepared, maxWidth, fontPx * 1.35);
    // Wrapped lyrics can use the available height instead of inheriting a tiny single-line font.
    const wrappedFontPx = Math.min(28, width * 0.12, height * 0.2) * finitePositive(options.fontScale, 1);
    if (layout.lines.length > 1 && wrappedFontPx > fontPx) {
        fontPx = wrappedFontPx;
        prepared = prepare();
        layout = layoutWithLines(prepared, maxWidth, fontPx * 1.35);
    }
    if (layout.height > maxHeight && fontPx > 8) {
        let low = 8; let high = fontPx;
        // Find the largest fitting size; coarse percentage reductions waste a row's worth of space.
        for (let attempt = 0; attempt < 8; attempt += 1) {
            fontPx = (low + high) / 2;
            prepared = prepare();
            layout = layoutWithLines(prepared, maxWidth, fontPx * 1.35);
            if (layout.height <= maxHeight) low = fontPx;
            else high = fontPx;
        }
        fontPx = low;
        prepared = prepare();
        layout = layoutWithLines(prepared, maxWidth, fontPx * 1.35);
    }
    const widest = layout.lines.reduce((max, row) => Math.max(max, row.width), 1);
    const fit = Math.min(1, maxHeight / Math.max(1, layout.height), maxWidth / widest);
    const segmentOffsets = [0];
    prepared.segments.forEach(segment => segmentOffsets.push(segmentOffsets.at(-1)! + splitLyricGraphemes(segment).length));
    const offsetOf = (cursor: LayoutCursor) => (segmentOffsets[cursor.segmentIndex] ?? segmentOffsets.at(-1)!) + cursor.graphemeIndex;
    const lineHeight = fontPx * 1.35 * fit;
    const top = (height - layout.lines.length * lineHeight) / 2;
    const rows: MotesRow[] = layout.lines.map((row, index) => ({
        text: row.text, start: offsetOf(row.start), end: offsetOf(row.end), width: row.width * fit,
        left: (width - row.width * fit) / 2, top: top + index * lineHeight, offsets: [],
    }));
    return { rows, fontPx: fontPx * fit, lineHeight, width, height, font: fontOf(fontPx * fit) };
};

export const prepareMotesLine = (line: Line, options: MotesLayoutOptions): MotesPreparedLine => {
    const layout = layoutMotesText(line, options);
    const timings = buildLineGraphemeTimeline(line);
    const empty = new Float32Array(0);
    const result: MotesPreparedLine = {
        line, width: layout.width, height: layout.height, fontPx: layout.fontPx, particleSize: 1,
        timings, x: empty, y: empty, alpha: empty, scatterX: empty, scatterY: empty, phases: empty,
        glyphIndices: new Uint32Array(0),
    };
    if (!line.fullText.trim() || options.width <= 0 || options.height <= 0) return result;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / layout.width, 900 / layout.height);
    canvas.width = Math.max(1, Math.ceil(layout.width * scale));
    canvas.height = Math.max(1, Math.ceil(layout.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return result;
    context.scale(scale, scale);
    context.font = layout.font;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    for (const row of layout.rows) {
        // Paint the whole row in one call, preserving shaping, kerning and combined glyphs.
        context.fillText(row.text, row.left, row.top + layout.lineHeight / 2);
        row.offsets = measurePrefixOffsets(splitLyricGraphemes(row.text), prefix => context.measureText(prefix).width);
    }
    const density = Math.max(0.6, Math.min(1.6, finitePositive(options.density, 1)));
    const step = Math.max(1, Math.max(1, layout.fontPx / 38) * scale / Math.sqrt(density));
    const seed = hashMotesSeed(`${options.seed ?? ''}|${line.startTime}|${line.fullText}`);
    // Give longer lyrics their own stroke detail instead of sharing one short-line allowance.
    const visibleGlyphs = timings.reduce((count, glyph) => count + Number(Boolean(glyph.char.trim())), 0);
    const budget = Math.min(MAX_MOTES_PARTICLES,
        Math.round(Math.max(RECOMMENDED_MOTES_PARTICLES, visibleGlyphs * 480) * density));
    const points = sampleMotesMask(context.getImageData(0, 0, canvas.width, canvas.height), {
        step, maxPoints: budget, seed,
    });
    const random = createMotesRandom(seed);
    const count = points.x.length;
    const scatterX = new Float32Array(count);
    const scatterY = new Float32Array(count);
    const phases = new Float32Array(count);
    const glyphIndices = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) {
        points.x[index] /= scale;
        points.y[index] /= scale;
        const rowIndex = Math.max(0, Math.min(layout.rows.length - 1,
            Math.floor((points.y[index] - layout.rows[0].top) / layout.lineHeight)));
        const row = layout.rows[rowIndex];
        const localX = points.x[index] - row.left;
        let glyph = 0;
        while (glyph + 1 < row.offsets.length - 1 && row.offsets[glyph + 1] < localX) glyph += 1;
        glyphIndices[index] = Math.min(Math.max(0, timings.length - 1), row.start + glyph);
        const angle = random() * Math.PI * 2;
        const distance = layout.fontPx * (0.35 + random() * 1.1);
        scatterX[index] = Math.cos(angle) * distance;
        scatterY[index] = Math.sin(angle) * distance;
        phases[index] = random() * Math.PI * 2;
    }
    canvas.width = 0;
    canvas.height = 0;
    return {
        ...result, ...points, scatterX, scatterY, phases, glyphIndices,
        particleSize: Math.max(1.6, points.pointSpacing / scale * 1.35),
    };
};
