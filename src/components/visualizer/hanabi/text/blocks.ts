// Copyright (c) 2026 chthollyphile
import type { Container, Graphics } from 'pixi.js';
import { createRng } from '../hanabiRandom';
import type { BlockStyle, ExitFx, HanabiPalette, PixiModule } from '../types';
import { clamp01, easeInOutCubic, exitPose, type FxContext } from './animations';
import type { LayoutWordInput, PlacedGlyph, TextPlacement } from './layout';

// src/components/visualizer/hanabi/text/blocks.ts
// 字底色块：12 种 BlockStyle。每块在构建时画一次 Graphics（局部坐标），逐帧只改 transform / scale / alpha；
// 需要逐段画出的（outline 框线、弧形排的色带）才逐帧重画，且只在进度变化时重画。色块跟着自己的字入场、退场。

export interface BlockLayoutParams {
    tracking: number;
    wordGap: number;
    lineHeight: number;
    minAdvance: number;
    stairStep: number;
    padding: number;
}

/** 每种色块对排版的要求：逐字色块要字距、逐词色块要词间隔、色带要行距。 */
export const blockLayoutParams = (style: BlockStyle, hardShadow: boolean): BlockLayoutParams => {
    const base: Record<BlockStyle, BlockLayoutParams> = {
        none: { tracking: 0.02, wordGap: 0.12, lineHeight: 1.12, minAdvance: 0, stairStep: 0, padding: 0.1 },
        tile: { tracking: 0.14, wordGap: 0.12, lineHeight: 1.3, minAdvance: 0.86, stairStep: 0, padding: 0.1 },
        band: { tracking: 0.04, wordGap: 0.14, lineHeight: 1.42, minAdvance: 0, stairStep: 0, padding: 0.3 },
        slant: { tracking: 0.04, wordGap: 0.72, lineHeight: 1.42, minAdvance: 0, stairStep: 0, padding: 0.36 },
        double: { tracking: 0.04, wordGap: 0.68, lineHeight: 1.5, minAdvance: 0, stairStep: 0, padding: 0.4 },
        pill: { tracking: 0.04, wordGap: 0.6, lineHeight: 1.42, minAdvance: 0, stairStep: 0, padding: 0.4 },
        split: { tracking: 0.04, wordGap: 0.58, lineHeight: 1.42, minAdvance: 0, stairStep: 0, padding: 0.3 },
        ticket: { tracking: 0.05, wordGap: 0.72, lineHeight: 1.48, minAdvance: 0, stairStep: 0, padding: 0.45 },
        marker: { tracking: 0.03, wordGap: 0.14, lineHeight: 1.3, minAdvance: 0, stairStep: 0, padding: 0.14 },
        outline: { tracking: 0.04, wordGap: 0.3, lineHeight: 1.55, minAdvance: 0, stairStep: 0, padding: 0.32 },
        circle: { tracking: 0.24, wordGap: 0.14, lineHeight: 1.4, minAdvance: 0.95, stairStep: 0, padding: 0.12 },
        stair: { tracking: 0.06, wordGap: 0.12, lineHeight: 1.6, minAdvance: 0.82, stairStep: 0.16, padding: 0.3 },
    };
    const params = { ...base[style] };
    if (hardShadow) params.padding += 0.08;
    return params;
};

/** 字色：实心色块上用 ink，没有色块 / 只有框线 / 荧光笔只垫半个字时用 paper。 */
export const blockTextRole = (style: BlockStyle): 'ink' | 'paper' =>
    (style === 'none' || style === 'outline' || style === 'marker' ? 'paper' : 'ink');

/** 把颜色压暗（硬阴影、单色调色板时的第二层）。 */
export const darken = (color: number, amount: number) => {
    const k = 1 - amount;
    const r = Math.round(((color >> 16) & 0xff) * k);
    const g = Math.round(((color >> 8) & 0xff) * k);
    const b = Math.round((color & 0xff) * k);
    return (r << 16) | (g << 8) | b;
};

export interface RunFrame {
    cx: number;
    cy: number;
    angle: number;
    length: number;
    thickness: number;
    /** 行方向变化明显（弧形排）：色带沿折线画。 */
    curved: boolean;
    /** 弧形时的中心线折点（含两端）与各点法向。 */
    points: Array<{ x: number; y: number; nx: number; ny: number; s: number }>;
}

/**
 * 一串字的色块框：沿行方向与法向投影所有字框取范围（大小字、阶梯错落都包进去），两端再各加 padL、上下加 padT。
 */
export const runFrame = (glyphs: readonly PlacedGlyph[], indices: readonly number[], padL: number, padT: number): RunFrame | null => {
    const members = indices.map(index => glyphs[index]!).filter(glyph => !glyph.blank);
    if (members.length === 0) return null;
    let sin = 0;
    let cos = 0;
    members.forEach(glyph => { sin += Math.sin(glyph.angle); cos += Math.cos(glyph.angle); });
    const angle = Math.atan2(sin, cos);
    const tx = Math.cos(angle), ty = Math.sin(angle);
    const nx = -ty, ny = tx;
    const origin = members[0]!;
    let minT = Infinity, maxT = -Infinity, minN = Infinity, maxN = -Infinity;
    let curved = false;
    members.forEach(glyph => {
        if (Math.abs(Math.atan2(Math.sin(glyph.angle - angle), Math.cos(glyph.angle - angle))) > 0.08) curved = true;
        const px = glyph.x - origin.x, py = glyph.y - origin.y;
        const pt = px * tx + py * ty;
        const pn = px * nx + py * ny;
        minT = Math.min(minT, pt - glyph.advance / 2);
        maxT = Math.max(maxT, pt + glyph.advance / 2);
        minN = Math.min(minN, pn - glyph.size * 0.56);
        maxN = Math.max(maxN, pn + glyph.size * 0.56);
    });
    const midT = (minT + maxT) / 2;
    const midN = (minN + maxN) / 2;
    const thickness = maxN - minN + padT * 2;
    const frame: RunFrame = {
        cx: origin.x + tx * midT + nx * midN,
        cy: origin.y + ty * midT + ny * midN,
        angle,
        length: maxT - minT + padL * 2,
        thickness,
        curved,
        points: [],
    };
    if (curved) {
        // 沿各字中心线的折点：首字前缘（外加 padL）、相邻两字之间、末字后缘（外加 padL）；各自按字的法向。
        const edge = (glyph: PlacedGlyph, side: number, extra: number) => ({
            x: glyph.x + Math.cos(glyph.angle) * (glyph.advance / 2 + extra) * side,
            y: glyph.y + Math.sin(glyph.angle) * (glyph.advance / 2 + extra) * side,
            nx: -Math.sin(glyph.angle),
            ny: Math.cos(glyph.angle),
        });
        const raw = [edge(members[0]!, -1, padL)];
        for (let k = 1; k < members.length; k += 1) {
            const a = edge(members[k - 1]!, 1, 0), b = edge(members[k]!, -1, 0);
            raw.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, nx: (a.nx + b.nx) / 2, ny: (a.ny + b.ny) / 2 });
        }
        raw.push(edge(members[members.length - 1]!, 1, padL));
        let s = 0;
        frame.points = raw.map((point, index) => {
            if (index > 0) s += Math.hypot(point.x - raw[index - 1]!.x, point.y - raw[index - 1]!.y);
            const len = Math.hypot(point.nx, point.ny) || 1;
            return { x: point.x, y: point.y, nx: point.nx / len, ny: point.ny / len, s };
        });
    }
    return frame;
};

export interface BlocksOptions {
    pixi: PixiModule;
    style: BlockStyle;
    placement: TextPlacement;
    words: readonly LayoutWordInput[];
    palette: HanabiPalette;
    opacity: number;
    motion: number;
    exit: ExitFx;
    seed: string;
    /** 逐字（下标与 placement.glyphs 一致）：入场开始、退场开始与结束。空白字为 NaN。 */
    enterStart: readonly number[];
    exitStart: readonly number[];
    exitEnd: readonly number[];
    /** 文字组中心。 */
    centerX: number;
    centerY: number;
}

export interface HanabiBlocks {
    view: Container;
    update: (time: number) => void;
    /** 第 i 个字下面的色块颜色（没有色块为 null），硬阴影取色用。 */
    colorOf: (glyph: number) => number | null;
    destroy: () => void;
}

type Anchor = 'center' | 'start' | 'bottom';

interface Part {
    g: Graphics;
    lag: number;
    /** 屏幕空间的固定偏移（double 的影子层）。 */
    ox: number;
    oy: number;
    /** split 的上下半：入场时从两侧滑入的方向。 */
    slide: number;
}

interface Piece {
    parts: Part[];
    anchor: Anchor;
    /** 锚点位置、方向与尺寸。 */
    x: number;
    y: number;
    angle: number;
    length: number;
    thickness: number;
    /** 动作的尺寸单位（像素，≈ 字号）。 */
    unit: number;
    enterStart: number;
    enterDur: number;
    exitStart: number;
    exitEnd: number;
    rand: [number, number, number, number];
    toCenterX: number;
    toCenterY: number;
    /** 逐帧重画（outline 框线、弧形色带）：参数为可见区间 [a, b] 与厚度倍率。 */
    redraw?: (g: Graphics, a: number, b: number, thick: number) => void;
    lastKey: string;
}

const SWEEP: ReadonlySet<BlockStyle> = new Set<BlockStyle>(['band', 'slant', 'double', 'marker', 'outline']);

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

export const createBlocks = (options: BlocksOptions): HanabiBlocks => {
    const { pixi, style, placement, palette } = options;
    const view = new pixi.Container();
    view.label = 'hanabi-blocks';
    const back = new pixi.Container();
    const front = new pixi.Container();
    view.addChild(back, front);
    const colors = palette.blocks.length > 0 ? palette.blocks : [palette.accent];
    const colorAt = (index: number) => colors[((index % colors.length) + colors.length) % colors.length]!;
    const second = (index: number) => (colors.length > 1 ? colorAt(index + 1) : darken(colorAt(index), 0.35));
    const glyphColor = new Map<number, number>();
    const pieces: Piece[] = [];
    const rng = createRng(`${options.seed}:blocks`);
    const glyphs = placement.glyphs;
    const fontPx = placement.fontPx;

    const makeGraphics = (layer: Container) => {
        const g = new pixi.Graphics();
        layer.addChild(g);
        return g;
    };

    const timesOf = (indices: readonly number[]) => {
        let first = Infinity, last = -Infinity, exitStart = Infinity, exitEnd = -Infinity;
        indices.forEach(index => {
            const start = options.enterStart[index]!;
            if (!Number.isFinite(start)) return;
            first = Math.min(first, start);
            last = Math.max(last, start);
            exitStart = Math.min(exitStart, options.exitStart[index]!);
            exitEnd = Math.max(exitEnd, options.exitEnd[index]!);
        });
        return { first, last, exitStart, exitEnd };
    };

    const newPiece = (
        partsSpec: Array<{ layer: Container; lag?: number; ox?: number; oy?: number; slide?: number }>,
        anchor: Anchor,
        frame: { x: number; y: number; angle: number; length: number; thickness: number; unit: number },
        timing: { enterStart: number; enterDur: number; exitStart: number; exitEnd: number },
    ): Piece => {
        const piece: Piece = {
            parts: partsSpec.map(spec => ({ g: makeGraphics(spec.layer), lag: spec.lag ?? 0, ox: spec.ox ?? 0, oy: spec.oy ?? 0, slide: spec.slide ?? 0 })),
            anchor,
            ...frame,
            ...timing,
            rand: [rng(), rng(), rng(), rng()],
            toCenterX: (options.centerX - frame.x) / Math.max(1, frame.unit),
            toCenterY: (options.centerY - frame.y) / Math.max(1, frame.unit),
            lastKey: '',
        };
        pieces.push(piece);
        return piece;
    };

    // ─── 逐字的色块（tile / circle / stair / marker） ───
    const perGlyph = style === 'tile' || style === 'circle' || style === 'stair' || style === 'marker';
    // 阶梯：同一行同一个词里，每块都向下延伸到最低那个字的底边，底边对齐、顶边错落。
    const stairDrop = new Map<number, number>();
    if (style === 'stair') {
        const groups = new Map<string, number[]>();
        glyphs.forEach((glyph, index) => {
            if (glyph.blank) return;
            const key = `${glyph.row}:${glyph.word}`;
            groups.set(key, [...(groups.get(key) ?? []), index]);
        });
        groups.forEach(indices => {
            const first = glyphs[indices[0]!]!;
            const nx = -Math.sin(first.angle), ny = Math.cos(first.angle);
            const bottoms = indices.map(index => {
                const glyph = glyphs[index]!;
                return (glyph.x - first.x) * nx + (glyph.y - first.y) * ny + glyph.size * 0.56;
            });
            const lowest = Math.max(...bottoms);
            indices.forEach((index, k) => stairDrop.set(index, lowest - bottoms[k]!));
        });
    }
    if (perGlyph) {
        let ordinal = 0;
        glyphs.forEach((glyph, index) => {
            if (glyph.blank || !Number.isFinite(options.enterStart[index]!)) return;
            const color = style === 'marker' ? colorAt(glyph.word) : colorAt(ordinal);
            ordinal += 1;
            const start = options.enterStart[index]!;
            const timing = {
                enterStart: start - (style === 'marker' ? 0 : 0.05),
                enterDur: style === 'marker' ? 0.28 : 0.34,
                exitStart: options.exitStart[index]!,
                exitEnd: options.exitEnd[index]!,
            };
            const size = glyph.size;
            if (style === 'tile' || style === 'circle') {
                const piece = newPiece([{ layer: front }], 'center',
                    { x: glyph.x, y: glyph.y, angle: glyph.rotation, length: glyph.boxW, thickness: glyph.boxH, unit: size }, timing);
                const g = piece.parts[0]!.g;
                if (style === 'tile') {
                    const inset = size * 0.035;
                    g.roundRect(-glyph.boxW / 2 + inset, -glyph.boxH / 2, glyph.boxW - inset * 2, glyph.boxH, size * 0.06).fill({ color: 0xffffff });
                } else {
                    g.circle(0, 0, Math.max(size * 0.64, Math.max(glyph.boxW, glyph.boxH) * 0.5)).fill({ color: 0xffffff });
                }
                g.tint = color;
                glyphColor.set(index, color);
                return;
            }
            // stair / marker 沿行方向。
            const tx = Math.cos(glyph.angle), ty = Math.sin(glyph.angle);
            const nx = -ty, ny = tx;
            if (style === 'stair') {
                const h = size * 1.12;
                const depth = size * 0.3 + (stairDrop.get(index) ?? 0);
                // 底边为锚点：从底往上长出来。
                const piece = newPiece([{ layer: front }], 'bottom', {
                    x: glyph.x + nx * (h / 2 + depth), y: glyph.y + ny * (h / 2 + depth),
                    angle: glyph.angle, length: glyph.advance, thickness: h + depth, unit: size,
                }, timing);
                const g = piece.parts[0]!.g;
                g.rect(-glyph.advance / 2, -(h + depth), glyph.advance, h + depth).fill({ color: 0xffffff });
                // 台阶的顶面一条亮边。
                g.rect(-glyph.advance / 2, -(h + depth), glyph.advance, size * 0.07).fill({ color: 0xffffff, alpha: 0.45 });
                g.tint = color;
                glyphColor.set(index, color);
                return;
            }
            // marker：字的下半部一道粗笔触，从字的前缘扫到后缘。
            const L = glyph.advance + size * 0.08;
            const piece = newPiece([{ layer: front }], 'start', {
                x: glyph.x - tx * L / 2, y: glyph.y - ty * L / 2, angle: glyph.angle, length: L, thickness: size * 0.5, unit: size,
            }, timing);
            const g = piece.parts[0]!.g;
            const top = size * 0.06;
            const bottom = size * 0.58;
            const wob = size * 0.06;
            g.poly([wob, top + wob * 0.5, L, top, L - wob, bottom, 0, bottom - wob * 0.4]).fill({ color: 0xffffff, alpha: 0.92 });
            g.tint = color;
            glyphColor.set(index, color);
        });
    }

    // ─── 逐词的色块（slant / double / pill / split / ticket） ───
    const perWord = style === 'slant' || style === 'double' || style === 'pill' || style === 'split' || style === 'ticket';
    if (perWord) {
        // 分组：同一行里相邻的同一个词；标点并进前一个词。
        const groups: Array<{ indices: number[]; word: number }> = [];
        glyphs.forEach((glyph, index) => {
            if (glyph.blank) return;
            const punct = options.words[glyph.word]?.blank ?? false;
            const last = groups[groups.length - 1];
            const lastGlyph = last ? glyphs[last.indices[last.indices.length - 1]!]! : null;
            if (last && lastGlyph && lastGlyph.row === glyph.row && (last.word === glyph.word || punct)) {
                last.indices.push(index);
                return;
            }
            groups.push({ indices: [index], word: glyph.word });
        });
        groups.forEach((group, ordinal) => {
            const frame = runFrame(glyphs, group.indices, fontPx * (style === 'pill' ? 0.26 : 0.2), fontPx * 0.1);
            if (!frame) return;
            const times = timesOf(group.indices);
            if (!Number.isFinite(times.first)) return;
            const color = colorAt(ordinal);
            const color2 = second(ordinal);
            const L = frame.length;
            const T = frame.thickness;
            const tx = Math.cos(frame.angle), ty = Math.sin(frame.angle);
            const sweep = style === 'slant' || style === 'double';
            const timing = {
                enterStart: times.first - 0.08,
                enterDur: sweep ? times.last - times.first + 0.42 : 0.44,
                exitStart: times.exitStart,
                exitEnd: times.exitEnd,
            };
            const base = sweep
                ? { x: frame.cx - tx * L / 2, y: frame.cy - ty * L / 2, angle: frame.angle, length: L, thickness: T, unit: T / 1.3 }
                : { x: frame.cx, y: frame.cy, angle: frame.angle, length: L, thickness: T, unit: T / 1.3 };
            group.indices.forEach(index => glyphColor.set(index, color));
            if (style === 'slant') {
                const piece = newPiece([{ layer: front }], 'start', base, timing);
                const sk = T * 0.36;
                piece.parts[0]!.g.poly([sk / 2, -T / 2, L + sk / 2, -T / 2, L - sk / 2, T / 2, -sk / 2, T / 2]).fill({ color: 0xffffff });
                piece.parts[0]!.g.tint = color;
            } else if (style === 'double') {
                const off = T * 0.13;
                const piece = newPiece([{ layer: back, lag: 0.09, ox: off, oy: off * 1.1 }, { layer: front }], 'start', base, timing);
                piece.parts.forEach((part, k) => {
                    part.g.rect(0, -T / 2, L, T).fill({ color: 0xffffff });
                    part.g.tint = k === 0 ? color2 : color;
                });
            } else if (style === 'pill') {
                const piece = newPiece([{ layer: front }], 'center', base, timing);
                piece.parts[0]!.g.roundRect(-L / 2, -T / 2, L, T, T / 2).fill({ color: 0xffffff });
                piece.parts[0]!.g.tint = color;
            } else if (style === 'split') {
                const piece = newPiece([{ layer: front, slide: -1 }, { layer: front, slide: 1 }], 'center', base, timing);
                piece.parts[0]!.g.rect(-L / 2, -T / 2, L, T / 2 + 0.5).fill({ color: 0xffffff });
                piece.parts[0]!.g.tint = color;
                piece.parts[1]!.g.rect(-L / 2, 0, L, T / 2).fill({ color: 0xffffff });
                piece.parts[1]!.g.tint = color2;
            } else {
                const piece = newPiece([{ layer: front }], 'center', base, timing);
                const g = piece.parts[0]!.g;
                const r = T * 0.2;
                g.moveTo(-L / 2, -T / 2).lineTo(L / 2, -T / 2).lineTo(L / 2, -r)
                    .arc(L / 2, 0, r, -Math.PI / 2, Math.PI / 2, true)
                    .lineTo(L / 2, T / 2).lineTo(-L / 2, T / 2).lineTo(-L / 2, r)
                    .arc(-L / 2, 0, r, Math.PI / 2, -Math.PI / 2, true)
                    .closePath()
                    .fill({ color: 0xffffff });
                // 撕口处的虚线（票根）。
                const stubX = L / 2 - Math.min(T * 0.62, L * 0.2);
                for (let y = -T / 2 + T * 0.14; y < T / 2 - T * 0.1; y += T * 0.16) {
                    g.circle(stubX, y, Math.max(0.8, T * 0.028)).fill({ color: 0x000000, alpha: 0.28 });
                }
                g.tint = color;
            }
        });
    }

    // ─── 逐行的色块（band / outline） ───
    if (style === 'band' || style === 'outline') {
        placement.rows.forEach((row, rowIndex) => {
            const padL = fontPx * (style === 'band' ? 0.32 : 0.26);
            const padT = fontPx * (style === 'band' ? 0.12 : 0.16);
            const frame = runFrame(glyphs, row, padL, padT);
            if (!frame) return;
            const times = timesOf(row);
            if (!Number.isFinite(times.first)) return;
            const color = colorAt(rowIndex);
            row.forEach(index => { if (!glyphs[index]!.blank) glyphColor.set(index, color); });
            const L = frame.length;
            const T = frame.thickness;
            const tx = Math.cos(frame.angle), ty = Math.sin(frame.angle);
            const timing = {
                enterStart: times.first - 0.1,
                enterDur: times.last - times.first + 0.45,
                exitStart: times.exitStart,
                exitEnd: times.exitEnd,
            };
            if (style === 'band' && frame.curved) {
                // 弧形排：沿中心折线画一段 [a, b]。
                const piece = newPiece([{ layer: front }], 'center', { x: 0, y: 0, angle: 0, length: L, thickness: T, unit: T / 1.3 }, timing);
                piece.toCenterX = 0;
                piece.toCenterY = 0;
                const points = frame.points;
                const total = points[points.length - 1]!.s || 1;
                piece.redraw = (g, a, b, thick) => {
                    g.clear();
                    if (b <= a) return;
                    const sa = a * total, sb = b * total;
                    const at = (s: number) => {
                        let k = 1;
                        while (k < points.length - 1 && points[k]!.s < s) k += 1;
                        const p0 = points[k - 1]!, p1 = points[k]!;
                        const f = p1.s > p0.s ? clamp01((s - p0.s) / (p1.s - p0.s)) : 0;
                        return {
                            x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f,
                            nx: p0.nx + (p1.nx - p0.nx) * f, ny: p0.ny + (p1.ny - p0.ny) * f,
                        };
                    };
                    const spine = [at(sa), ...points.filter(point => point.s > sa && point.s < sb), at(sb)];
                    const half = (T / 2) * thick;
                    const top: number[] = [];
                    spine.forEach(point => top.push(point.x - point.nx * half, point.y - point.ny * half));
                    const back: number[] = [];
                    for (let k = spine.length - 1; k >= 0; k -= 1) {
                        const point = spine[k]!;
                        back.push(point.x + point.nx * half, point.y + point.ny * half);
                    }
                    g.poly([...top, ...back]).fill({ color: 0xffffff });
                };
                piece.parts[0]!.g.tint = color;
                return;
            }
            if (style === 'band') {
                const piece = newPiece([{ layer: front }], 'start',
                    { x: frame.cx - tx * L / 2, y: frame.cy - ty * L / 2, angle: frame.angle, length: L, thickness: T, unit: T / 1.3 }, timing);
                const g = piece.parts[0]!.g;
                g.rect(0, -T / 2, L, T).fill({ color });
                // 帯的下缘一道细的第二色。
                if (colors.length > 1) g.rect(0, T / 2 - T * 0.1, L, T * 0.1).fill({ color: second(rowIndex) });
                return;
            }
            // outline：矩形框线从两个对角同时顺时针画出。
            const piece = newPiece([{ layer: front }], 'center',
                { x: frame.cx, y: frame.cy, angle: frame.angle, length: L, thickness: T, unit: T / 1.3 }, timing);
            const stroke = Math.max(1.5, T * 0.07);
            const perimeter = 2 * (L + T);
            const corners = [[-L / 2, -T / 2], [L / 2, -T / 2], [L / 2, T / 2], [-L / 2, T / 2]] as const;
            const trace = (g: Graphics, startCorner: number, from: number, to: number) => {
                // 从 startCorner 顺时针走过 [from, to]（周长比例），画折线。
                let travelled = 0;
                let started = false;
                for (let k = 0; k < 4 && travelled < to * perimeter; k += 1) {
                    const a = corners[(startCorner + k) % 4]!;
                    const b = corners[(startCorner + k + 1) % 4]!;
                    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    const s0 = Math.max(from * perimeter, travelled);
                    const s1 = Math.min(to * perimeter, travelled + seg);
                    if (s1 > s0) {
                        const f0 = (s0 - travelled) / seg, f1 = (s1 - travelled) / seg;
                        const x0 = a[0] + (b[0] - a[0]) * f0, y0 = a[1] + (b[1] - a[1]) * f0;
                        const x1 = a[0] + (b[0] - a[0]) * f1, y1 = a[1] + (b[1] - a[1]) * f1;
                        if (!started) {
                            g.moveTo(x0, y0);
                            started = true;
                        }
                        g.lineTo(x1, y1);
                    }
                    travelled += seg;
                }
                if (started) g.stroke({ width: stroke, color: 0xffffff, join: 'miter', cap: 'square' });
            };
            piece.redraw = (g, a, b) => {
                g.clear();
                if (b <= a) return;
                // 两笔各走半圈：一笔从左上角、一笔从右下角。
                trace(g, 0, a / 2, b / 2);
                trace(g, 2, a / 2, b / 2);
            };
            piece.parts[0]!.g.tint = color;
        });
    }

    const exitContext = (piece: Piece, time: number): FxContext => ({
        index: 0,
        count: 1,
        rand: piece.rand,
        toCenterX: piece.toCenterX,
        toCenterY: piece.toCenterY,
        dirX: Math.cos(piece.angle),
        dirY: Math.sin(piece.angle),
        time,
        motion: options.motion,
        slideDistance: 7,
    });

    const update = (time: number) => {
        pieces.forEach(piece => {
            piece.parts.forEach(part => {
                const g = part.g;
                const t = time - part.lag;
                if (t < piece.enterStart || t >= piece.exitEnd) {
                    g.visible = false;
                    return;
                }
                const q = clamp01((t - piece.enterStart) / Math.max(1e-3, piece.enterDur));
                const xq = piece.exitEnd > piece.exitStart ? clamp01((t - piece.exitStart) / (piece.exitEnd - piece.exitStart)) : 0;
                const tx = Math.cos(piece.angle), ty = Math.sin(piece.angle);
                let sx = 1, sy = 1, rot = 0, alpha = 1, dx = 0, dy = 0;
                // 可见区间（沿行方向，0..1）：扫出 / 收起的色块用。
                let a = 0, b = 1;
                switch (style) {
                    case 'tile': {
                        const s = easeOutBack(q, 2.2);
                        sx = s;
                        sy = s;
                        rot = (piece.rand[0] - 0.5) * 0.6 * (1 - easeOutCubic(q));
                        alpha = clamp01(q * 5);
                        break;
                    }
                    case 'circle': {
                        const s = q >= 1 ? 1 : 1 - Math.cos(q * Math.PI * 3.5) * Math.exp(-5 * q) * (1 - q);
                        sx = s;
                        sy = s;
                        alpha = clamp01(q * 5);
                        break;
                    }
                    case 'stair':
                        sy = Math.max(0, easeOutBack(q, 1.8));
                        alpha = clamp01(q * 6);
                        break;
                    case 'marker':
                        b = easeOutCubic(q);
                        break;
                    case 'band':
                        b = easeOutQuart(q);
                        sy = q < 0.22 ? 0.14 : 0.14 + 0.86 * easeOutBack((q - 0.22) / 0.78, 1.8);
                        break;
                    case 'slant':
                    case 'double':
                        b = easeOutExpo(q);
                        break;
                    case 'outline':
                        b = easeInOutCubic(q);
                        break;
                    case 'pill':
                        sx = 0.2 + 0.8 * easeOutBack(q, 1.4);
                        sy = Math.max(0, easeOutBack(clamp01(q * 1.5), 2.2));
                        alpha = clamp01(q * 4);
                        break;
                    case 'split': {
                        const e = easeOutExpo(q);
                        dx = tx * part.slide * (1 - e) * piece.length * 0.7;
                        dy = ty * part.slide * (1 - e) * piece.length * 0.7;
                        alpha = clamp01(q * 4);
                        break;
                    }
                    case 'ticket':
                        sy = Math.max(0, easeOutBack(q, 2.5));
                        sx = 0.7 + 0.3 * easeOutCubic(q);
                        rot = -0.25 * (1 - easeOutCubic(q));
                        alpha = clamp01(q * 4);
                        break;
                    case 'none':
                        break;
                }
                if (xq > 0) {
                    if (SWEEP.has(style)) {
                        // 扫出来的色块：跟着字从行首收起；blink / dissolve 同步闪灭。
                        a = Math.max(a, easeInOutCubic(xq));
                        if (options.exit === 'blink' || options.exit === 'dissolve') alpha *= exitPose(options.exit, xq, exitContext(piece, t - piece.exitStart)).alpha;
                        else alpha *= 1 - clamp01((xq - 0.85) / 0.15);
                    } else {
                        const pose = exitPose(options.exit, xq, exitContext(piece, t - piece.exitStart));
                        dx += pose.dx * piece.unit;
                        dy += pose.dy * piece.unit;
                        rot += pose.rotation * (perGlyph ? 1 : 0.4);
                        sx *= pose.scaleX;
                        sy *= pose.scaleY;
                        alpha *= pose.alpha;
                    }
                }
                if (b <= a || alpha <= 0.001) {
                    g.visible = false;
                    return;
                }
                g.visible = true;
                g.alpha = alpha * options.opacity;
                if (piece.redraw) {
                    const key = `${a.toFixed(4)}:${b.toFixed(4)}:${sy.toFixed(4)}`;
                    if (key !== piece.lastKey) {
                        piece.lastKey = key;
                        piece.redraw(g, a, b, sy);
                    }
                    g.position.set(piece.x + dx, piece.y + dy);
                    g.rotation = piece.angle + rot;
                    g.scale.set(sx, style === 'outline' ? sy : 1);
                    return;
                }
                let px = piece.x + dx + part.ox;
                let py = piece.y + dy + part.oy;
                if (piece.anchor === 'start') {
                    // 几何从 0 画到 length：可见区间 [a, b] → 平移 a、横向缩放 b − a。
                    px += tx * piece.length * a;
                    py += ty * piece.length * a;
                    sx *= b - a;
                }
                g.position.set(px, py);
                g.rotation = piece.angle + rot;
                g.scale.set(sx, sy);
            });
        });
    };

    return {
        view,
        update,
        colorOf: glyph => glyphColor.get(glyph) ?? null,
        destroy: () => {
            view.destroy({ children: true, context: true });
        },
    };
};
