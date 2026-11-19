import type { MetaphorMeasure } from './metaphorLayout';

// src/components/visualizer/metaphor/metaphorGlyphs.ts
// 隐喻的字形来源：每个字在 2D 画布上画一次，取它的透明度做两遍模糊，存成一格两个通道——
// 紧的（轻微模糊：放大后切阈值，边缘仍然是干净的，和 SDF 一个道理，所以大特写不用更大的贴图）
// 和宽的（大模糊：字周围的一团，开唱时字从这一团里凝出来，也让字和旁边的融球连得上）。
// 笔画密的字（汉字、假名、谚文）用轻一档的字重画、宽的那团也淡一些：墨是切阈值切出来的，本来就比字形胖一圈，
// 粗体的密字一胖笔画就糊到一起，读不出来。
// 注记（线稿上的公式和标签）是另一种字体：衬线的斜体，像手边的演算纸。要它的字时在字前面加 METAPHOR_NOTE_PREFIX。
// 模糊自己算（三遍盒式模糊），不用 ctx.filter：WebKit 没有它。一句的字拼成一张图集（buildMetaphorAtlas）。

/** 字高在格子里占多少像素、四周留多少（宽模糊要的地方）、一格多大。 */
export const METAPHOR_GLYPH_EM = 72;
const PAD = 28;
export const METAPHOR_GLYPH_CELL = METAPHOR_GLYPH_EM + PAD * 2;
/** 一格在世界里的边长：字高的多少倍。 */
export const METAPHOR_GLYPH_WORLD = METAPHOR_GLYPH_CELL / METAPHOR_GLYPH_EM;

const CELL = METAPHOR_GLYPH_CELL;
const BASELINE = 0.86;
const TIGHT_RADIUS = 1;
const WIDE_RADIUS = 6;
const WIDE_GAIN = 1.5;
/** 笔画密的字：字重最多到这一档，宽通道乘这么多。 */
const DENSE_WEIGHT = 500;
const DENSE_WIDE = 0.6;
const DENSE_CHAR = /[\u2E80-\u2FDF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u;
const CACHE_LIMIT = 400;
/** 字前面带这个就是注记的字。 */
export const METAPHOR_NOTE_PREFIX = '\u0001';
const NOTE_FONT = `italic 500 ${METAPHOR_GLYPH_EM}px "Cambria Math", "STIX Two Math", Cambria, Georgia, "Times New Roman", serif`;
const ATLAS_COLUMNS = 8;

/** 一个方向上的盒式模糊（滑动窗口求和，边界外当 0）。 */
const blurLines = (source: Float32Array, target: Float32Array, radius: number, step: number, lineStep: number) => {
    const window = radius * 2 + 1;
    for (let line = 0; line < CELL; line += 1) {
        const base = line * lineStep;
        let sum = 0;
        for (let index = 0; index <= radius; index += 1) sum += source[base + index * step];
        for (let index = 0; index < CELL; index += 1) {
            target[base + index * step] = sum / window;
            const add = index + radius + 1;
            const drop = index - radius;
            if (add < CELL) sum += source[base + add * step];
            if (drop >= 0) sum -= source[base + drop * step];
        }
    }
};

/** 三遍盒式模糊，近似高斯；结果留在 buffer 里，scratch 是工作区。 */
const blur = (buffer: Float32Array, scratch: Float32Array, radius: number) => {
    for (let pass = 0; pass < 3; pass += 1) {
        blurLines(buffer, scratch, radius, 1, CELL);
        blurLines(scratch, buffer, radius, CELL, 1);
    }
};

export interface MetaphorAtlas {
    data: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
    /** 每个字在图集里的那一格：左、上、右、下（0..1，上是数据的第一行）。 */
    rects: Map<string, [number, number, number, number]>;
}

export class MetaphorGlyphSource {
    private readonly canvas = document.createElement('canvas');
    private readonly context: CanvasRenderingContext2D;
    private readonly cells = new Map<string, Uint8Array>();
    private readonly advances = new Map<string, number>();
    private readonly work = new Float32Array(CELL * CELL);
    private readonly wide = new Float32Array(CELL * CELL);
    private readonly scratch = new Float32Array(CELL * CELL);
    private font = '';
    private denseFont = '';

    constructor(stack: string, weight: number) {
        this.canvas.width = CELL;
        this.canvas.height = CELL;
        const context = this.canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D canvas is unavailable');
        this.context = context;
        this.setFont(stack, weight);
    }

    /** 换字体或字重：变了返回 true，缓存作废。 */
    setFont(stack: string, weight: number): boolean {
        const font = `${weight} ${METAPHOR_GLYPH_EM}px ${stack}`;
        if (font === this.font) return false;
        this.font = font;
        this.denseFont = `${Math.min(weight, DENSE_WEIGHT)} ${METAPHOR_GLYPH_EM}px ${stack}`;
        this.clear();
        return true;
    }

    clear() {
        this.cells.clear();
        this.advances.clear();
    }

    /** 主题字体加载好了没有（没好时画的是回退字体）。 */
    fontReady(): boolean {
        try {
            return document.fonts.check(this.font);
        } catch {
            return true;
        }
    }

    /** 一个字的步进宽度，字高的倍数。 */
    readonly measure: MetaphorMeasure = char => this.advance(char, char, this.font);

    /** 注记的一个字的步进宽度。 */
    readonly measureNote: MetaphorMeasure = char => this.advance(METAPHOR_NOTE_PREFIX + char, char, NOTE_FONT);

    private advance(key: string, char: string, font: string) {
        let advance = this.advances.get(key);
        if (advance === undefined) {
            this.context.font = font;
            advance = Math.max(0.2, this.context.measureText(char).width / METAPHOR_GLYPH_EM);
            if (this.advances.size >= CACHE_LIMIT * 2) this.advances.clear();
            this.advances.set(key, advance);
        }
        return advance;
    }

    /** 一个字的一格：CELL × CELL，每像素两个字节（紧、宽）。key 是字本身，或者 METAPHOR_NOTE_PREFIX 加字。 */
    cell(key: string): Uint8Array {
        const cached = this.cells.get(key);
        if (cached) return cached;
        const { context, work, wide, scratch } = this;
        const note = key.startsWith(METAPHOR_NOTE_PREFIX);
        const char = note ? key.slice(METAPHOR_NOTE_PREFIX.length) : key;
        const dense = !note && DENSE_CHAR.test(char);
        const wideGain = dense ? WIDE_GAIN * DENSE_WIDE : WIDE_GAIN;
        context.clearRect(0, 0, CELL, CELL);
        context.font = note ? NOTE_FONT : dense ? this.denseFont : this.font;
        context.textAlign = 'center';
        context.textBaseline = 'alphabetic';
        context.fillStyle = '#fff';
        context.fillText(char, CELL / 2, PAD + METAPHOR_GLYPH_EM * BASELINE);
        const pixels = context.getImageData(0, 0, CELL, CELL).data;
        for (let index = 0; index < work.length; index += 1) {
            work[index] = pixels[index * 4 + 3] / 255;
            wide[index] = work[index];
        }
        blur(work, scratch, TIGHT_RADIUS);
        blur(wide, scratch, WIDE_RADIUS);
        const cell = new Uint8Array(CELL * CELL * 2);
        for (let index = 0; index < work.length; index += 1) {
            cell[index * 2] = Math.round(Math.min(1, work[index]) * 255);
            cell[index * 2 + 1] = Math.round(Math.min(1, wide[index] * wideGain) * 255);
        }
        if (this.cells.size >= CACHE_LIMIT) this.cells.clear();
        this.cells.set(key, cell);
        return cell;
    }
}

/** 把几个字的格子拼成一张 RGBA 图集（R 紧、G 宽）；同一个字只占一格。 */
export const buildMetaphorAtlas = (source: MetaphorGlyphSource, chars: readonly string[]): MetaphorAtlas => {
    const unique = Array.from(new Set(chars));
    const columns = Math.max(1, Math.min(ATLAS_COLUMNS, unique.length));
    const rows = Math.max(1, Math.ceil(unique.length / columns));
    const width = columns * CELL;
    const height = rows * CELL;
    const data = new Uint8Array(width * height * 4);
    const rects: MetaphorAtlas['rects'] = new Map();
    unique.forEach((char, order) => {
        const column = order % columns;
        const row = Math.floor(order / columns);
        const cell = source.cell(char);
        for (let y = 0; y < CELL; y += 1) {
            let to = ((row * CELL + y) * width + column * CELL) * 4;
            let from = y * CELL * 2;
            for (let x = 0; x < CELL; x += 1) {
                data[to] = cell[from];
                data[to + 1] = cell[from + 1];
                data[to + 3] = 255;
                to += 4;
                from += 2;
            }
        }
        rects.set(char, [column / columns, row / rows, (column + 1) / columns, (row + 1) / rows]);
    });
    return { data, width, height, rects };
};
