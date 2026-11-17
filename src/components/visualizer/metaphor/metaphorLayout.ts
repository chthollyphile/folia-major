import type { Line } from '../../../types';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import { segmentLyricWords, segmentTextWords } from '../../../utils/lyrics/wordSegmentation';

// src/components/visualizer/metaphor/metaphorLayout.ts
// 隐喻的排版（纯函数）：一句歌词按词切成 token，再按构图（方阵、阶梯、主词、竖排、散置、齐行）摆到世界坐标里。
// 单位是 em：基础字号的一个字高是 1。字的时间来自 buildLineGraphemeTimeline，词的切分来自 segmentLyricWords，
// 这里不猜时间也不重新分词。量字宽的函数由外面给（运行时是画布，单测里是常数）。

export type MetaphorComposition = 'block' | 'stair' | 'hero' | 'column' | 'scatter' | 'justify';

export interface MetaphorTokenChar { char: string; t0: number; t1: number; }

export interface MetaphorToken {
    text: string;
    chars: MetaphorTokenChar[];
    wordLike: boolean;
    /** 只有空白：占宽度，不出字。 */
    space: boolean;
}

export interface MetaphorRect { x0: number; y0: number; x1: number; y1: number; }

export interface MetaphorGlyph {
    char: string;
    x: number; y: number;
    /** 字高（em 的倍数）。 */
    size: number;
    rot: number;
    t0: number; t1: number;
    /** 属于 words 里的第几个。 */
    word: number;
    accent: boolean;
    /** 关键字自己的颜色（主题 wordColors 里写的色值）；没有就用主题的强调色。 */
    tint?: string | null;
    /** 0..1，这个字自己的随机数（化开时散去的方向、放出的粒子用）。 */
    seed: number;
}

export interface MetaphorWord extends MetaphorRect { t0: number; t1: number; }

export interface MetaphorLayout {
    composition: MetaphorComposition;
    glyphs: MetaphorGlyph[];
    words: MetaphorWord[];
    bounds: MetaphorRect;
}

/** 一个字的步进宽度，em 的倍数。 */
export type MetaphorMeasure = (char: string) => number;

const SPACE_ONLY = /^\s+$/u;
const LINE_HEIGHT = 1.14;

/** 一句歌词 → token：每个 token 带它那几个字各自的演唱时间。 */
export const buildMetaphorTokens = (line: Line): MetaphorToken[] => {
    const timeline = buildLineGraphemeTimeline(line);
    const tokens: MetaphorToken[] = [];
    let cursor = 0;
    for (const part of segmentLyricWords(line)) {
        const count = splitLyricGraphemes(part.segment).length;
        const chars = timeline.slice(cursor, cursor + count).map(item => ({ char: item.char, t0: item.startTime, t1: item.endTime }));
        cursor += count;
        if (chars.length === 0) continue;
        tokens.push({ text: part.segment, chars, wordLike: part.isWordLike, space: SPACE_ONLY.test(part.segment) });
    }
    // 分词和逐字时间线对不上时（不该发生）：剩下的字并进最后一个 token，不丢字
    if (cursor < timeline.length) {
        const rest = timeline.slice(cursor).map(item => ({ char: item.char, t0: item.startTime, t1: item.endTime }));
        const last = tokens.at(-1);
        if (last) last.chars.push(...rest);
        else tokens.push({ text: rest.map(item => item.char).join(''), chars: rest, wordLike: true, space: false });
    }
    return tokens;
};

/** 没有时间的文字（曲名卡）→ token：全部在 time 这一刻就唱完。 */
export const buildMetaphorTextTokens = (text: string, time: number): MetaphorToken[] => (
    segmentTextWords(text).map(part => ({
        text: part.segment,
        chars: splitLyricGraphemes(part.segment).map(char => ({ char, t0: time, t1: time })),
        wordLike: part.isWordLike,
        space: SPACE_ONLY.test(part.segment),
    })).filter(token => token.chars.length > 0)
);

interface Placed {
    token: MetaphorToken;
    index: number;
    /** 左缘、行中线。 */
    x: number; y: number;
    size: number;
    rot: number;
    width: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const tokenAdvance = (token: MetaphorToken, measure: MetaphorMeasure) => token.chars.reduce((sum, item) => sum + measure(item.char), 0);

/** 按 token 折行：行首行尾的空白不算。 */
const wrapRows = (tokens: MetaphorToken[], widths: number[], maxWidth: number): number[][] => {
    const rows: number[][] = [];
    let row: number[] = [];
    let width = 0;
    tokens.forEach((token, index) => {
        if (row.length === 0 && token.space) return;
        if (row.length > 0 && !token.space && width + widths[index] > maxWidth) {
            rows.push(row);
            row = [];
            width = 0;
        }
        row.push(index);
        width += widths[index];
    });
    if (row.length > 0) rows.push(row);
    return rows.map(indices => {
        const trimmed = [...indices];
        while (trimmed.length > 0 && tokens[trimmed[trimmed.length - 1]].space) trimmed.pop();
        return trimmed;
    }).filter(indices => indices.length > 0);
};

const rowWidth = (row: number[], widths: number[], sizes: number[]) => row.reduce((sum, index) => sum + widths[index] * sizes[index], 0);

export interface MetaphorLayoutInput {
    tokens: MetaphorToken[];
    composition: MetaphorComposition;
    measure: MetaphorMeasure;
    /** 0..1 的随机数，按顺序取。 */
    rng: () => number;
    /** 这个词要不要用强调色（主题的关键词）。 */
    isAccent?: (text: string) => boolean;
    /** 每个 token 的关键字颜色（和 tokens 一一对应，不是关键字的是 null）：有颜色的词用这个颜色的强调墨。 */
    tints?: ReadonlyArray<string | null>;
}

/** 把一行行 token 从上往下摆：align 决定每行的左缘。 */
const placeRows = (
    rows: number[][],
    input: MetaphorLayoutInput,
    widths: number[],
    sizes: number[],
    rowLeft: (width: number, rowIndex: number) => number,
    tokenRot: (index: number) => number,
): Placed[] => {
    const placed: Placed[] = [];
    let top = 0;
    rows.forEach((row, rowIndex) => {
        const height = Math.max(...row.map(index => sizes[index])) * LINE_HEIGHT;
        let x = rowLeft(rowWidth(row, widths, sizes), rowIndex);
        for (const index of row) {
            const width = widths[index] * sizes[index];
            placed.push({ token: input.tokens[index], index, x, y: top - height / 2, size: sizes[index], rot: tokenRot(index), width });
            x += width;
        }
        top -= height;
    });
    return placed;
};

const FLAT = () => 0;

const placeBlock = (input: MetaphorLayoutInput, widths: number[], total: number): Placed[] => {
    const sizes = widths.map(() => 1);
    const rows = wrapRows(input.tokens, widths, clamp(Math.sqrt(total * 2.2), 3.5, 11));
    return placeRows(rows, input, widths, sizes, width => -width / 2, FLAT);
};

const placeStair = (input: MetaphorLayoutInput, widths: number[], total: number): Placed[] => {
    const sizes = widths.map(() => 1);
    const rows = wrapRows(input.tokens, widths, clamp(Math.sqrt(total * 1.4), 3, 8));
    const step = 0.7 + input.rng() * 0.6;
    return placeRows(rows, input, widths, sizes, (_width, rowIndex) => rowIndex * step, FLAT);
};

const placeHero = (input: MetaphorLayoutInput, widths: number[], total: number): Placed[] => {
    const { tokens } = input;
    let hero = -1;
    tokens.forEach((token, index) => {
        if (token.wordLike && (hero < 0 || widths[index] >= widths[hero])) hero = index;
    });
    if (hero < 0) return placeBlock(input, widths, total);
    const heroSize = clamp(7 / Math.max(widths[hero], 0.5), 1.6, 3);
    const heroWidth = widths[hero] * heroSize;
    const sizes = widths.map((_, index) => (index === hero ? heroSize : 1));
    const sideWidth = Math.max(heroWidth, 4.5);
    const before = wrapRows(tokens.slice(0, hero), widths.slice(0, hero), sideWidth);
    const after = wrapRows(tokens.slice(hero + 1), widths.slice(hero + 1), sideWidth).map(row => row.map(index => index + hero + 1));
    const rows = [...before, [hero], ...after];
    // 前面的行贴主词左缘，后面的行贴主词右缘
    return placeRows(rows, input, widths, sizes, (width, rowIndex) => (rowIndex <= before.length ? 0 : heroWidth - width), FLAT);
};

const placeScatter = (input: MetaphorLayoutInput, widths: number[], total: number): Placed[] => {
    const sizes = input.tokens.map(token => (token.wordLike ? 0.8 + input.rng() * 0.8 : 1));
    const scaled = widths.map((width, index) => width * sizes[index]);
    const rows = wrapRows(input.tokens, scaled, clamp(Math.sqrt(total * 2), 3.5, 9));
    const rots = input.tokens.map(token => (token.space ? 0 : (input.rng() - 0.5) * 0.18));
    const shifts = rows.map(() => (input.rng() - 0.5) * 2.2);
    return placeRows(rows, input, widths, sizes, (width, rowIndex) => -width / 2 + shifts[rowIndex], index => rots[index]);
};

/** 齐行：每一行放大到和最宽的那行一样宽（短的行字就大），左右对齐成一块——海报上的排法。 */
const JUSTIFY_MAX = 2.6;

const placeJustify = (input: MetaphorLayoutInput, widths: number[], total: number): Placed[] => {
    const rows = wrapRows(input.tokens, widths, clamp(Math.sqrt(total * 1.5), 3, 8));
    const unit = widths.map(() => 1);
    const rowWidths = rows.map(row => rowWidth(row, widths, unit));
    const target = Math.max(...rowWidths);
    const sizes = [...unit];
    rows.forEach((row, rowIndex) => {
        const size = clamp(target / Math.max(0.5, rowWidths[rowIndex]), 1, JUSTIFY_MAX);
        for (const index of row) sizes[index] = size;
    });
    // 放大封顶的行不够宽：一行靠左、一行靠右
    return placeRows(rows, input, widths, sizes, (width, rowIndex) => (rowIndex % 2 === 0 ? -target / 2 : target / 2 - width), FLAT);
};

/** 竖排：一列最多六个字，从右往左排；每个字单独摆，不走 Placed。 */
const COLUMN_MAX = 6;
const COLUMN_PITCH = 1.08;
const COLUMN_GAP = 1.3;

interface Slot { x: number; y: number; size: number; rot: number; half: number; }

/**
 * 排一句：返回每个字的位置、每个词的包围盒和整句的包围盒，整句的中心在原点。
 * 竖排只在调用方确认是中日文短句时才选（metaphorProgram.ts 的 pickComposition）。
 */
export const buildMetaphorLayout = (input: MetaphorLayoutInput): MetaphorLayout => {
    const { tokens, measure, rng } = input;
    const widths = tokens.map(token => tokenAdvance(token, measure));
    const total = widths.reduce((sum, width) => sum + width, 0);
    const glyphs: MetaphorGlyph[] = [];
    const words: MetaphorWord[] = [];
    const tints = tokens.map((token, index) => (token.space ? null : input.tints?.[index] ?? null));
    const accents = tokens.map((token, index) => !token.space && (tints[index] !== null || Boolean(input.isAccent?.(token.text.trim()))));

    const pushWord = (slots: Array<Slot & MetaphorTokenChar>, accent: boolean, tint: string | null = null) => {
        if (slots.length === 0) return;
        const word = words.length;
        const rect: MetaphorWord = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, t0: Infinity, t1: -Infinity };
        for (const slot of slots) {
            rect.x0 = Math.min(rect.x0, slot.x - slot.half);
            rect.x1 = Math.max(rect.x1, slot.x + slot.half);
            rect.y0 = Math.min(rect.y0, slot.y - slot.size * 0.55);
            rect.y1 = Math.max(rect.y1, slot.y + slot.size * 0.55);
            rect.t0 = Math.min(rect.t0, slot.t0);
            rect.t1 = Math.max(rect.t1, slot.t1);
            glyphs.push({ char: slot.char, x: slot.x, y: slot.y, size: slot.size, rot: slot.rot, t0: slot.t0, t1: slot.t1, word, accent, tint, seed: rng() });
        }
        words.push(rect);
    };

    if (input.composition === 'column') {
        const cells = tokens.flatMap((token, index) => (token.space ? [] : token.chars.map(item => ({ item, index }))));
        const columns = Math.max(1, Math.ceil(cells.length / COLUMN_MAX));
        const perColumn = Math.ceil(cells.length / columns);
        const byToken = new Map<number, Array<Slot & MetaphorTokenChar>>();
        cells.forEach(({ item, index }, order) => {
            const column = Math.floor(order / perColumn);
            const slot = { ...item, x: -column * COLUMN_GAP, y: -(order % perColumn) * COLUMN_PITCH - column * 0.5, size: 1, rot: 0, half: 0.5 };
            const list = byToken.get(index);
            if (list) list.push(slot);
            else byToken.set(index, [slot]);
        });
        byToken.forEach((slots, index) => pushWord(slots, accents[index], tints[index]));
    } else {
        const place = { block: placeBlock, stair: placeStair, hero: placeHero, scatter: placeScatter, justify: placeJustify }[input.composition];
        for (const placed of place(input, widths, total)) {
            if (placed.token.space) continue;
            const centerX = placed.x + placed.width / 2;
            const cos = Math.cos(placed.rot);
            const sin = Math.sin(placed.rot);
            let pen = placed.x;
            const slots = placed.token.chars.map(item => {
                const advance = measure(item.char) * placed.size;
                const dx = pen + advance / 2 - centerX;
                pen += advance;
                return { ...item, x: centerX + dx * cos, y: placed.y + dx * sin, size: placed.size, rot: placed.rot, half: advance / 2 };
            });
            pushWord(slots, accents[placed.index], tints[placed.index]);
        }
    }

    if (words.length === 0) {
        return { composition: input.composition, glyphs, words, bounds: { x0: -1, y0: -0.5, x1: 1, y1: 0.5 } };
    }
    const bounds = words.reduce<MetaphorRect>((box, word) => ({
        x0: Math.min(box.x0, word.x0), y0: Math.min(box.y0, word.y0), x1: Math.max(box.x1, word.x1), y1: Math.max(box.y1, word.y1),
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const cx = (bounds.x0 + bounds.x1) / 2;
    const cy = (bounds.y0 + bounds.y1) / 2;
    for (const glyph of glyphs) { glyph.x -= cx; glyph.y -= cy; }
    for (const word of words) { word.x0 -= cx; word.x1 -= cx; word.y0 -= cy; word.y1 -= cy; }
    return { composition: input.composition, glyphs, words, bounds: { x0: bounds.x0 - cx, y0: bounds.y0 - cy, x1: bounds.x1 - cx, y1: bounds.y1 - cy } };
};
