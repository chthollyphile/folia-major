// Copyright (c) 2026 chthollyphile
import type { TextLayout } from '../types';
import { createRng } from '../hanabiRandom';

// src/components/visualizer/hanabi/text/layout.ts
// 排版（纯函数）：把逐字（字宽、所属词、词的字号倍率）按 9 种排法排进文字区，原点 = 文字区中心。
// 超出文字区时先折行 / 换列，再整体缩小；竖排时拉丁字母侧转、中日文直立。

export interface LayoutGlyphInput {
    char: string;
    /** 字宽（字号的倍数）。 */
    advance: number;
    /** 空白（空格）：不画、不占包围盒。 */
    blank: boolean;
    /** 竖排时直立。 */
    upright: boolean;
    word: number;
}

export interface LayoutWordInput {
    /** 字区间 [start, end)。 */
    start: number;
    end: number;
    /** 不是实词（标点、符号、空白）。 */
    blank: boolean;
    /** 全是空白。 */
    space: boolean;
    /** 字号倍率。 */
    scale: number;
}

export interface LayoutParams {
    layout: TextLayout;
    regionWidth: number;
    regionHeight: number;
    /** 主字号（像素）。 */
    fontPx: number;
    /** 整组倾斜（弧度）。 */
    tilt: number;
    seed: string;
    /** 字距（字号的倍数）。 */
    tracking: number;
    /** 相邻两个实词之间额外的间隔（主字号的倍数，逐词色块用）。 */
    wordGap: number;
    /** 行距（行内最大字号的倍数）。 */
    lineHeight: number;
    /** 横排时每个字至少占多宽（字号的倍数，逐字色块用）。 */
    minAdvance: number;
    /** 阶梯：词内逐字抬高（字号的倍数）。 */
    stairStep: number;
    /** 色块 / 阴影在字框外多占的边距（字号的倍数），算包围盒时计入。 */
    padding: number;
}

export interface PlacedGlyph {
    char: string;
    x: number;
    y: number;
    /** 字号（像素，已含词的倍率与整体缩放）。 */
    size: number;
    /** 沿行方向占的长度（像素）。 */
    advance: number;
    /** 行在这个字处的前进方向（弧度）。 */
    angle: number;
    /** 字本身的转角（竖排拉丁字母侧转 90°、弧形排随切线转）。 */
    rotation: number;
    /** 在字自身转角坐标系里的字框（逐字色块、包围盒用）。 */
    boxW: number;
    boxH: number;
    /** 所在的行 / 列 / 词块（runs 的下标）。 */
    row: number;
    word: number;
    blank: boolean;
}

export interface TextPlacement {
    glyphs: PlacedGlyph[];
    /** 行（横排）/ 列（竖排）/ 词块（scatter、vertical-split）：每个是一串字的下标。 */
    rows: number[][];
    /** 缩放后的主字号。 */
    fontPx: number;
    /** 为放进文字区整体缩小的倍率（≤ 1）。 */
    fit: number;
    /** 静止时的包围盒（含边距）。 */
    bounds: { x: number; y: number; width: number; height: number };
    vertical: boolean;
}

// ─── 词的字号 ──────────────────────────────────────────────────────────

const FUNCTION_WORDS = new Set(Array.from('的了在把是我你他她它们和与也就都着过吗呢吧啊呀哦被让给从向到这那之而又很のはがをにでともへやねよかな'));
const MINOR_LATIN = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'me', 'my', 'with', 'and', 'or', 'is', 'i', 'you', 'it', 'by', 'for']);

/**
 * 每个词的字号倍率：重点词（最长的实词，一样长取靠后的）放大到 1 + 0.8 × emphasis，
 * 虚词缩小，标点小一号，其余按种子小幅浮动。
 */
export const wordScales = (
    words: ReadonlyArray<{ text: string; blank: boolean; space: boolean }>,
    emphasis: number,
    seed: string,
): number[] => {
    const rng = createRng(`${seed}:word-scale`);
    const e = Math.max(0, Math.min(1, emphasis));
    const lengthOf = (text: string) => Array.from(text).length;
    const minor = (word: { text: string; blank: boolean }) => word.blank
        || (lengthOf(word.text) === 1 && FUNCTION_WORDS.has(word.text))
        || MINOR_LATIN.has(word.text.toLowerCase());
    let key = -1;
    words.forEach((word, index) => {
        if (minor(word)) return;
        if (key < 0 || lengthOf(word.text) >= lengthOf(words[key]!.text)) key = index;
    });
    const solid = words.filter(word => !word.blank).length;
    return words.map((word, index) => {
        const jitter = rng();
        if (word.space) return 1;
        if (word.blank) return 1 - 0.2 * e;
        if (solid <= 1) return 1;
        if (index === key) return 1 + 0.8 * e;
        if (minor(word)) return Math.max(0.6, 1 - 0.32 * e);
        return 1 + (jitter - 0.5) * 0.45 * e;
    });
};

// ─── 排版 ──────────────────────────────────────────────────────────────

/** 竖排时即便属于中日文区也要侧转的符号（长音、破折号、省略号、波浪线）。 */
const ROTATE_IN_VERTICAL = new Set(Array.from('ー—―─～〜…‥－-_=~'));

interface Unit {
    /** 字的下标（按顺序，含空白）。 */
    glyphs: number[];
    /** 全是空白。 */
    space: boolean;
    /** 沿行方向的长度（像素，不含词间隔）。 */
    length: number;
    /** 最大字号。 */
    thickness: number;
}

interface Work {
    x: number;
    y: number;
    size: number;
    advance: number;
    angle: number;
    rotation: number;
    boxW: number;
    boxH: number;
    row: number;
}

const rotate = (x: number, y: number, angle: number) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: x * c - y * s, y: x * s + y * c };
};

/** 把词切成不可拆分的块：标点粘在前一个词上（行首不放标点）。 */
const buildUnits = (glyphs: readonly LayoutGlyphInput[], words: readonly LayoutWordInput[]) => {
    const units: Array<{ words: number[]; space: boolean }> = [];
    words.forEach((word, index) => {
        if (word.end <= word.start) return;
        const last = units[units.length - 1];
        if (word.blank && !word.space && last && !last.space) {
            last.words.push(index);
            return;
        }
        units.push({ words: [index], space: word.space });
    });
    // 行首的标点：并进后一个块。
    if (units.length > 1 && !units[0]!.space && units[0]!.words.every(index => words[index]!.blank)) {
        const first = units.shift()!;
        units[0]!.words.unshift(...first.words);
        units[0]!.space = false;
    }
    return units.map(unit => {
        const indices: number[] = [];
        unit.words.forEach(index => {
            for (let g = words[index]!.start; g < words[index]!.end; g += 1) if (g < glyphs.length) indices.push(g);
        });
        return { glyphs: indices, space: unit.space };
    });
};

/**
 * 把一串长度按顺序分成 k 段，使最长的一段最短（动态规划，块数很少）。
 * gaps[i] = 第 i 块与前一块在同一段里时多出的间隔；空白块在段首段尾不计长度。
 */
export const partitionRuns = (
    units: ReadonlyArray<{ length: number; space: boolean }>,
    gaps: readonly number[],
    k: number,
    /** 在第 i 块前断开的代价（像素，加在新一段的长度上；假名开头的块不宜放在行首）。 */
    breakPenalty?: readonly number[],
): number[][] => {
    const n = units.length;
    if (n === 0) return [];
    const parts = Math.max(1, Math.min(k, units.filter(unit => !unit.space).length || 1));
    const spanLength = (from: number, to: number) => {
        let a = from;
        let b = to;
        while (a <= b && units[a]!.space) a += 1;
        while (b >= a && units[b]!.space) b -= 1;
        let total = 0;
        for (let i = a; i <= b; i += 1) total += units[i]!.length + (i > a ? gaps[i]! : 0);
        return total;
    };
    const INF = Number.POSITIVE_INFINITY;
    const best: number[][] = Array.from({ length: parts + 1 }, () => new Array<number>(n + 1).fill(INF));
    const cut: number[][] = Array.from({ length: parts + 1 }, () => new Array<number>(n + 1).fill(0));
    best[0]![0] = 0;
    for (let p = 1; p <= parts; p += 1) {
        for (let j = 1; j <= n; j += 1) {
            for (let i = p - 1; i < j; i += 1) {
                if (best[p - 1]![i] === INF) continue;
                // 一段里至少有一个实块。
                let solid = false;
                for (let u = i; u < j; u += 1) if (!units[u]!.space) solid = true;
                if (!solid) continue;
                const value = Math.max(best[p - 1]![i]!, spanLength(i, j - 1) + (i > 0 ? breakPenalty?.[i] ?? 0 : 0));
                if (value < best[p]![j]! - 1e-9) {
                    best[p]![j] = value;
                    cut[p]![j] = i;
                }
            }
        }
    }
    let p = parts;
    while (p > 1 && best[p]![n] === INF) p -= 1;
    const runs: number[][] = [];
    let j = n;
    for (let q = p; q >= 1; q -= 1) {
        const i = cut[q]![j]!;
        runs.unshift(Array.from({ length: j - i }, (_, offset) => i + offset));
        j = i;
    }
    return runs;
};

export const layoutText = (
    glyphInputs: readonly LayoutGlyphInput[],
    words: readonly LayoutWordInput[],
    params: LayoutParams,
): TextPlacement => {
    const { layout, regionWidth: W, regionHeight: H, fontPx } = params;
    const rng = createRng(`${params.seed}:layout`);
    const vertical = layout === 'vertical' || layout === 'vertical-split';
    const count = glyphInputs.length;
    const sizes = glyphInputs.map(glyph => fontPx * (words[glyph.word]?.scale ?? 1));
    const turned = glyphInputs.map(glyph => vertical && (!glyph.upright || ROTATE_IN_VERTICAL.has(glyph.char)));
    // 沿行方向的长度。
    const along = glyphInputs.map((glyph, index) => {
        const size = sizes[index]!;
        if (glyph.blank) return glyph.advance * size;
        if (vertical && !turned[index]) return size * (1 + params.tracking * 0.6);
        return (Math.max(glyph.advance, vertical ? 0 : params.minAdvance) + params.tracking) * size;
    });
    const work: Work[] = glyphInputs.map((_, index) => ({
        x: 0, y: 0, size: sizes[index]!, advance: along[index]!, angle: 0, rotation: 0, boxW: 0, boxH: 0, row: 0,
    }));
    const unitList = buildUnits(glyphInputs, words);
    const units: Unit[] = unitList.map(unit => ({
        glyphs: unit.glyphs,
        space: unit.space,
        length: unit.glyphs.reduce((sum, index) => sum + along[index]!, 0),
        thickness: unit.glyphs.reduce((max, index) => (glyphInputs[index]!.blank ? max : Math.max(max, sizes[index]!)), 0) || fontPx,
    }));
    const gaps = units.map((unit, index) => (index > 0 && !unit.space && !units[index - 1]!.space ? params.wordGap * fontPx : 0));
    // 假名、长音、标点开头的块尽量不放在行首（「終|わり」这种断法）。
    const penalties = units.map(unit => {
        const first = glyphInputs[unit.glyphs[0] ?? 0]?.char ?? '';
        return /^[぀-ゟ゠-ヿー、。，．！？]/.test(first) ? fontPx * 1.2 : 0;
    });
    const rows: number[][] = [];

    /** 在行坐标系里排一段：s = 沿行位置（从 0 起），n = 法向偏移（向「下」为正）。返回长度。 */
    const flow = (unitIndices: readonly number[], rowIndex: number, place: (glyph: number, s: number, n: number) => void) => {
        let a = 0;
        let b = unitIndices.length - 1;
        while (a <= b && units[unitIndices[a]!]!.space) a += 1;
        while (b >= a && units[unitIndices[b]!]!.space) b -= 1;
        const thick = unitIndices.reduce((max, u) => Math.max(max, units[u]!.space ? 0 : units[u]!.thickness), 0) || fontPx;
        let s = 0;
        const members: number[] = [];
        for (let k = 0; k < unitIndices.length; k += 1) {
            const unit = units[unitIndices[k]!]!;
            const outside = k < a || k > b;
            if (k > a && k <= b) s += gaps[unitIndices[k]!]!;
            let wordStart = -1;
            let stepIndex = 0;
            unit.glyphs.forEach(glyph => {
                const size = sizes[glyph]!;
                const advance = outside ? 0 : along[glyph]!;
                const word = glyphInputs[glyph]!.word;
                if (word !== wordStart) {
                    wordStart = word;
                    stepIndex = 0;
                }
                // 横排按底边对齐（小字往下沉），竖排居中；阶梯在词内逐字抬高。
                const settle = vertical ? 0 : (thick - size) * 0.42;
                const stair = glyphInputs[glyph]!.blank ? 0 : -params.stairStep * size * (stepIndex % 3);
                if (!glyphInputs[glyph]!.blank) stepIndex += 1;
                work[glyph]!.row = rowIndex;
                work[glyph]!.advance = advance;
                place(glyph, s + advance / 2, settle + stair);
                s += advance;
                members.push(glyph);
            });
        }
        rows[rowIndex] = members;
        return { length: s, thickness: thick };
    };

    const runLength = (unitIndices: readonly number[]) => {
        let a = 0;
        let b = unitIndices.length - 1;
        while (a <= b && units[unitIndices[a]!]!.space) a += 1;
        while (b >= a && units[unitIndices[b]!]!.space) b -= 1;
        let total = 0;
        for (let k = a; k <= b; k += 1) total += units[unitIndices[k]!]!.length + (k > a ? gaps[unitIndices[k]!]! : 0);
        return total;
    };
    const runThickness = (unitIndices: readonly number[]) =>
        unitIndices.reduce((max, u) => Math.max(max, units[u]!.space ? 0 : units[u]!.thickness), 0) || fontPx;

    /** 选行数：在 [kMin, kMax] 里取能放得最大（缩得最少）的，差不多时取行少的。 */
    const chooseRuns = (kMin: number, kMax: number, main: number, cross: number, pitch: number) => {
        let bestRuns: number[][] = [];
        let bestFit = -1;
        for (let k = kMin; k <= kMax; k += 1) {
            const runs = partitionRuns(units, gaps, k, penalties);
            if (runs.length < Math.min(k, kMin)) continue;
            const longest = Math.max(...runs.map(runLength), 1);
            const across = runs.reduce((sum, run) => sum + runThickness(run) * pitch, 0);
            const fit = Math.min(1, main / longest, cross / across);
            if (fit > bestFit * 1.08 || bestRuns.length === 0) {
                bestFit = fit;
                bestRuns = runs;
            }
            if (fit >= 1) break;
        }
        return bestRuns;
    };

    const solidUnits = units.filter(unit => !unit.space).length;
    /** 自由摆放（scatter / vertical-split）的块：单个假名粘到前一块上（「咲|い|た」→「咲いた」），块不超过 5 个字。 */
    const chunkUnits = () => {
        const chunks: number[][] = [];
        units.forEach((unit, index) => {
            if (unit.space) return;
            const last = chunks[chunks.length - 1];
            const text = unit.glyphs.map(glyph => glyphInputs[glyph]!.char).join('');
            const kana = unit.glyphs.length === 1 && /^[぀-ゟ゠-ヿー]$/.test(text);
            const lastLength = last ? last.reduce((sum, u) => sum + units[u]!.glyphs.length, 0) : 0;
            if (last && kana && lastLength < 5) last.push(index);
            else chunks.push([index]);
        });
        return chunks;
    };
    const placeStraight = (glyph: number, x: number, y: number, rowIndex: number) => {
        const w = work[glyph]!;
        w.x = x;
        w.y = y;
        w.row = rowIndex;
    };

    switch (layout) {
        case 'center':
        case 'left':
        case 'right':
        case 'stagger':
        case 'diagonal': {
            let kMin = 1;
            let kMax = layout === 'diagonal' ? 2 : 3;
            if (layout === 'stagger') {
                kMin = Math.min(solidUnits, solidUnits >= 5 ? 3 : 2);
                kMax = Math.min(solidUnits, 3);
                kMin = Math.max(1, kMin);
                kMax = Math.max(kMin, kMax);
            }
            const slope = layout === 'diagonal' ? -Math.min(0.42, Math.max(0.2, Math.atan2(H * 0.7, W))) : 0;
            const runs = chooseRuns(kMin, kMax, layout === 'diagonal' ? W * 0.95 : W, H, params.lineHeight);
            const pitchFactor = layout === 'stagger' ? params.lineHeight * 0.94 : params.lineHeight;
            let cursorY = 0;
            const lengths = runs.map(runLength);
            const longest = Math.max(...lengths, 1);
            const staggerAmp = fontPx * (0.9 + rng() * 0.6);
            runs.forEach((run, rowIndex) => {
                const thick = runThickness(run);
                if (rowIndex > 0) cursorY += thick * pitchFactor * 0.5;
                const L = lengths[rowIndex]!;
                let x0: number;
                if (layout === 'left') x0 = 0;
                else if (layout === 'right') x0 = -L;
                else if (layout === 'stagger') {
                    const room = Math.max(0, (longest - L) / 2);
                    const side = rowIndex % 2 === 0 ? -1 : 1;
                    x0 = -L / 2 + side * Math.max(staggerAmp, room * 0.9) * (runs.length === 1 ? 0 : 1);
                } else x0 = -L / 2;
                const rowY = cursorY;
                flow(run, rowIndex, (glyph, s, n) => {
                    if (layout === 'diagonal') {
                        const x = x0 + s;
                        placeStraight(glyph, x, rowY + n + (x - (x0 + L / 2)) * Math.tan(slope), rowIndex);
                        const w = work[glyph]!;
                        // 字直立、水平间距不变，沿斜线的长度要除以 cos。
                        w.advance /= Math.cos(slope);
                        w.angle = slope;
                        w.rotation = slope * 0.3;
                    } else placeStraight(glyph, x0 + s, rowY + n, rowIndex);
                });
                cursorY += thick * pitchFactor * 0.5;
            });
            break;
        }
        case 'arc': {
            const runs = chooseRuns(1, 2, W * 0.95, H, params.lineHeight);
            const lengths = runs.map(runLength);
            const longest = Math.max(...lengths, 1);
            const radius0 = Math.max(longest / 1.3, W * 0.62);
            let depth = 0;
            runs.forEach((run, rowIndex) => {
                const thick = runThickness(run);
                if (rowIndex > 0) depth += thick * params.lineHeight * 0.5;
                const R = Math.max(radius0 - depth, longest / 2.6);
                const L = lengths[rowIndex]!;
                const centerY = radius0;
                flow(run, rowIndex, (glyph, s, n) => {
                    const a = (s - L / 2) / R;
                    const r = R - n;
                    const w = work[glyph]!;
                    w.x = r * Math.sin(a);
                    w.y = centerY - r * Math.cos(a);
                    w.angle = a;
                    w.rotation = a;
                });
                depth += thick * params.lineHeight * 0.5;
            });
            break;
        }
        case 'vertical': {
            const runs = chooseRuns(1, 4, H, W, params.lineHeight);
            let cursorX = 0;
            runs.forEach((run, colIndex) => {
                const thick = runThickness(run);
                if (colIndex > 0) cursorX -= thick * params.lineHeight * 0.5;
                const colX = cursorX;
                flow(run, colIndex, (glyph, s, n) => {
                    const w = work[glyph]!;
                    w.x = colX - n;
                    w.y = s;
                    w.angle = Math.PI / 2;
                    w.rotation = turned[glyph] ? Math.PI / 2 : 0;
                });
                cursorX -= thick * params.lineHeight * 0.5;
            });
            break;
        }
        case 'vertical-split': {
            // 块交替落在右 / 左两列（右列先），纵向互相咬合；太长时分成几组两列，从右往左排。
            const chunks = chunkUnits();
            const lengths = chunks.map(runLength);
            const estimate = (groups: number) => {
                const per = Math.ceil(chunks.length / groups);
                return Math.max(1, ...Array.from({ length: groups }, (_, g) => lengths.slice(g * per, (g + 1) * per)
                    .reduce((sum, length) => sum + length * 0.6, 0)));
            };
            let groups = 1;
            while (groups < 3 && estimate(groups) > H && chunks.length > groups * 2) groups += 1;
            const per = Math.ceil(chunks.length / groups) || 1;
            let cursorX = 0;
            let runIndex = 0;
            for (let g = 0; g < groups; g += 1) {
                const members = chunks.slice(g * per, (g + 1) * per);
                const memberLengths = lengths.slice(g * per, (g + 1) * per);
                if (members.length === 0) continue;
                const thick = Math.max(...members.map(runThickness));
                const pitch = thick * params.lineHeight;
                if (g > 0) cursorX -= pitch * 1.1;
                const tops: number[] = [];
                const ends: number[] = [];
                members.forEach((chunk, k) => {
                    const side = k % 2 === 0 ? 0.5 : -0.5;
                    let top = 0;
                    if (k >= 1) top = Math.max(top, tops[k - 1]! + memberLengths[k - 1]! * 0.5);
                    if (k >= 2) top = Math.max(top, ends[k - 2]! + fontPx * 0.2);
                    tops.push(top);
                    ends.push(top + memberLengths[k]!);
                    const colX = cursorX + side * pitch * (members.length > 1 ? 1 : 0) - pitch * 0.5;
                    flow(chunk, runIndex, (glyph, s, n) => {
                        const w = work[glyph]!;
                        w.x = colX - n;
                        w.y = top + s;
                        w.angle = Math.PI / 2;
                        w.rotation = turned[glyph] ? Math.PI / 2 : 0;
                    });
                    runIndex += 1;
                });
                cursorX -= pitch;
            }
            break;
        }
        case 'scatter': {
            // 词块大小不一、散落在文字区里，但保持阅读顺序：先把词块（单个假名粘到前一块上）分成几行，
            // 行内随机间隔、上下随机错开、各自微微倾斜；行距留够错开的余量，所以天然不重叠。
            const chunks = chunkUnits();
            const pad = params.padding * fontPx;
            const extra = chunks.map(() => 0.8 + rng() * 0.5);
            const rotations = chunks.map(() => (rng() - 0.5) * 0.16);
            const gapsAfter = chunks.map(() => fontPx * (0.35 + rng() * 0.8));
            const jitterRand = chunks.map(() => rng() * 2 - 1);
            const dims = chunks.map((chunk, k) => {
                const w = runLength(chunk) * extra[k]! + pad * 2;
                const h = runThickness(chunk) * extra[k]! * (1.12 + params.stairStep * 4) + pad * 2;
                const c = Math.abs(Math.cos(rotations[k]!));
                const s = Math.abs(Math.sin(rotations[k]!));
                return { w, h, aabbW: w * c + h * s, aabbH: w * s + h * c };
            });
            const n = chunks.length;
            let bestRows: number[][] = [];
            let bestScore = -Infinity;
            for (let r = 1; r <= Math.min(4, n); r += 1) {
                const rowsOf = partitionRuns(dims.map(d => ({ length: d.aabbW, space: false })), dims.map((_, k) => (k > 0 ? gapsAfter[k - 1]! : 0)), r);
                const widths = rowsOf.map(row => row.reduce((sum, k, i) => sum + dims[k]!.aabbW + (i > 0 ? gapsAfter[k - 1]! : 0), 0));
                const heights = rowsOf.map(row => Math.max(...row.map(k => dims[k]!.aabbH)) * 1.5);
                const fit = Math.min(1, W / Math.max(...widths), H / heights.reduce((sum, h) => sum + h, 0));
                // 至少三块时偏向多行（散开的感觉）。
                const score = fit + (n >= 3 && rowsOf.length >= 2 ? 0.08 : 0) + (rowsOf.length === Math.min(3, n) ? 0.04 : 0);
                if (score > bestScore) {
                    bestScore = score;
                    bestRows = rowsOf;
                }
            }
            const rowHeights = bestRows.map(row => Math.max(...row.map(k => dims[k]!.aabbH)));
            const widths = bestRows.map(row => row.reduce((sum, k, i) => sum + dims[k]!.aabbW + (i > 0 ? gapsAfter[k - 1]! : 0), 0));
            const widest = Math.max(...widths, 1);
            let cursorY = 0;
            bestRows.forEach((row, r) => {
                const rowH = rowHeights[r]!;
                const jitter = rowH * 0.22;
                if (r > 0) cursorY += rowHeights[r - 1]! / 2 + rowH / 2 + (rowHeights[r - 1]! * 0.22 + jitter) + fontPx * 0.1;
                const slack = Math.max(0, widest - widths[r]!);
                let cursorX = -widths[r]! / 2 + (rng() - 0.5) * (slack + fontPx * 1.2) * (bestRows.length > 1 ? 1 : 0);
                row.forEach((k, i) => {
                    if (i > 0) cursorX += gapsAfter[k - 1]!;
                    const d = dims[k]!;
                    const cx = cursorX + d.aabbW / 2;
                    const cy = cursorY + jitterRand[k]! * (jitter + (rowH - d.aabbH) * 0.5);
                    cursorX += d.aabbW;
                    const chunk = chunks[k]!;
                    const L = runLength(chunk) * extra[k]!;
                    const angle = rotations[k]!;
                    flow(chunk, k, (glyph, s, nOffset) => {
                        const w = work[glyph]!;
                        const local = rotate(s * extra[k]! - L / 2, nOffset * extra[k]!, angle);
                        w.x = cx + local.x;
                        w.y = cy + local.y;
                        w.angle = angle;
                        w.rotation = angle;
                        w.size = sizes[glyph]! * extra[k]!;
                        w.advance *= extra[k]!;
                    });
                });
            });
            break;
        }
    }
    if (layout === 'scatter' || layout === 'vertical-split') {
        // 空白字（词块之外的空格）落在前一个字的位置，不占地方。
        units.forEach(unit => {
            if (!unit.space) return;
            unit.glyphs.forEach(glyph => {
                const prev = work[Math.max(0, glyph - 1)]!;
                const w = work[glyph]!;
                w.x = prev.x;
                w.y = prev.y;
                w.angle = prev.angle;
                w.rotation = prev.rotation;
                w.advance = 0;
                w.row = prev.row;
            });
        });
    }

    // 字框（在字自身转角坐标系里）：横向 = 沿行长度，纵向 = 字号。竖排直立字的行方向在纵向。
    work.forEach((w, index) => {
        const verticalUpright = vertical && !turned[index];
        w.boxW = verticalUpright ? w.size * 1.12 : Math.max(w.advance, 0.01);
        w.boxH = verticalUpright ? Math.max(w.advance, 0.01) : w.size * 1.12;
        if (layout === 'diagonal') {
            // 斜排的字基本直立：字框取水平宽度。
            w.boxW = Math.max(w.advance * Math.cos(w.angle), 0.01);
        }
    });

    // 整组倾斜。
    if (params.tilt) {
        work.forEach(w => {
            const p = rotate(w.x, w.y, params.tilt);
            w.x = p.x;
            w.y = p.y;
            w.angle += params.tilt;
            w.rotation += params.tilt;
        });
    }

    const measure = () => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        work.forEach((w, index) => {
            if (glyphInputs[index]!.blank) return;
            const pad = params.padding * w.size;
            const hw = w.boxW / 2 + pad;
            const hh = w.boxH / 2 + pad;
            const c = Math.abs(Math.cos(w.rotation));
            const s = Math.abs(Math.sin(w.rotation));
            const ex = hw * c + hh * s;
            const ey = hw * s + hh * c;
            minX = Math.min(minX, w.x - ex);
            maxX = Math.max(maxX, w.x + ex);
            minY = Math.min(minY, w.y - ey);
            maxY = Math.max(maxY, w.y + ey);
        });
        if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        return { minX, minY, maxX, maxY };
    };

    let box = measure();
    const fit = Math.min(1, W / Math.max(1e-6, box.maxX - box.minX), H / Math.max(1e-6, box.maxY - box.minY));
    if (fit < 1) {
        work.forEach(w => {
            w.x *= fit;
            w.y *= fit;
            w.size *= fit;
            w.advance *= fit;
            w.boxW *= fit;
            w.boxH *= fit;
        });
        box = measure();
    }
    // 对齐：left / right 贴文字区边缘，其余居中。
    const shiftX = layout === 'left' ? -W / 2 - box.minX : layout === 'right' ? W / 2 - box.maxX : -(box.minX + box.maxX) / 2;
    const shiftY = -(box.minY + box.maxY) / 2;
    work.forEach(w => {
        w.x += shiftX;
        w.y += shiftY;
    });

    const placed: PlacedGlyph[] = work.map((w, index) => ({
        char: glyphInputs[index]!.char,
        x: w.x,
        y: w.y,
        size: w.size,
        advance: w.advance,
        angle: w.angle,
        rotation: w.rotation,
        boxW: w.boxW,
        boxH: w.boxH,
        row: w.row,
        word: glyphInputs[index]!.word,
        blank: glyphInputs[index]!.blank,
    }));
    return {
        glyphs: placed,
        rows: rows.filter(Boolean).map(run => run.filter(index => index < count)),
        fontPx: fontPx * fit,
        fit,
        bounds: {
            x: box.minX + shiftX,
            y: box.minY + shiftY,
            width: box.maxX - box.minX,
            height: box.maxY - box.minY,
        },
        vertical,
    };
};
