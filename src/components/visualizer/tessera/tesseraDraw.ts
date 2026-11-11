import { rememberBounded } from '../textMeasureCache';
import type { TesseraFill } from './tesseraBackdrop';
import {
    rowPresence, TESSERA_CLEAR, TESSERA_FONT_RATIO,
    type TesseraBlock, type TesseraPiece, type TesseraPlan, type TesseraRow,
} from './tesseraPlan';

// src/components/visualizer/tessera/tesseraDraw.ts
// 方块字的一帧：按时间 t 把排布画到 canvas 上。所有状态都由 t 推出（倒退、跳转都对），
// 不留帧与帧之间的状态。字以纯文字顺着连续的曲线下落，落地后才长出方块的边框；行满即闪白、从中间向两边消掉。

export interface TesseraPalette {
    /** 边框、方块、消行闪光的颜色：深色背景用白，浅色背景用黑。 */
    ink: string;
    /** 字的颜色。 */
    text: string;
    /** 背景色：闪白时字反成这个颜色。 */
    background: string;
}

export interface TesseraFrameInput {
    plan: TesseraPlan;
    t: number;
    /** 画布的 CSS 像素尺寸。 */
    width: number;
    height: number;
    palette: TesseraPalette;
    fontStack: string;
    fontWeight: number;
    showGrid: boolean;
    /** 画布自己铺多大的背景色（tesseraBackdrop.ts）。 */
    fill: TesseraFill;
    /** 关掉时只画框（和铺的背景），不画字和方块。 */
    showText: boolean;
}

/** 棋盘占画布的比例。 */
const BOARD_FILL = 0.84;
/** 棋盘上下留的空（画布高的比例）：下面多留一些给底部字幕，免得它压在最下面那一行上。 */
const BOARD_TOP = 0.07;
const BOARD_BOTTOM = 0.17;
/** 方块占格子的比例（四周留缝）。 */
const BOX_RATIO = 0.86;
/** 闪白、塌缩、光束的时间都是消行进度（0–1）上的位置。 */
const FLASH_END = 0.18;
const COLLAPSE_START = 0.22;
const COLLAPSE_SPREAD = 0.38;
const COLLAPSE_SPAN = 0.3;
const BEAM_START = 0.15;
const PARTICLES_PER_CELL = 3;
/** 碎屑飞多久（秒）。 */
const PARTICLE_LIFE = 0.6;
/** 落地长出边框、下落文字淡入的时长（秒）。 */
const SOLIDIFY = 0.18;
const SPAWN_FADE = 0.15;
/** 下落进度上横移、转向占的区间。 */
const SHIFT_FROM = 0.05;
const SHIFT_SPAN = 0.5;
const ROTATE_FROM = 0.12;
const ROTATE_SPAN = 0.3;
/** 下落曲线：匀速和加速度各占多少（1 = 纯自由落体）。 */
const FALL_GRAVITY = 0.7;
/** 空中方块的底板：盖住后面东西的背景色有多实、上面铺的墨色有多淡、垫块那几格再加多少。 */
const FALLING_PLATE_COVER = 0.9;
const FALLING_PLATE_ALPHA = 0.1;
const FALLING_FILLER_ALPHA = 0.12;
/** 还没唱到的字的不透明度。 */
const UNSUNG_ALPHA = 0.38;

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeIn = (x: number) => x * x;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));

/** [0,1) 的确定性散列，给碎屑定方向和速度。 */
const hash01 = (a: number, b: number, c: number) => {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
};

/** 字被唱到多少（0–1）。 */
const sungAmount = (start: number, end: number, t: number) => clamp01((t - start) / Math.max(end - start, 0.06));

/** 消行时第 col 列那一格：闪白多少、缩到多大、还剩多少不透明度、从什么时候开始塌（消行进度）。 */
const clearCell = (col: number, columns: number, k: number) => {
    if (k < 0) return { flash: 0, scale: 1, alpha: 1, collapseAt: Infinity };
    const flash = k < FLASH_END ? easeOut(k / FLASH_END) : 1;
    const distance = Math.abs(col + 0.5 - columns / 2) / (columns / 2);
    const collapseAt = COLLAPSE_START + distance * COLLAPSE_SPREAD;
    const local = clamp01((k - collapseAt) / COLLAPSE_SPAN);
    return { flash, scale: 1 - easeIn(local), alpha: 1 - local, collapseAt };
};

/** 一段（可能横跨几格）在消行时的样子：横跨几格的取各格的平均。 */
const clearBlock = (block: TesseraBlock, columns: number, k: number) => {
    if (k < 0) return { flash: 0, scale: 1, alpha: 1 };
    let scale = 0;
    let alpha = 0;
    let flash = 0;
    for (let index = 0; index < block.cells; index += 1) {
        const cell = clearCell(block.col + index, columns, k);
        scale += cell.scale;
        alpha += cell.alpha;
        flash = cell.flash;
    }
    return { flash, scale: scale / block.cells, alpha: alpha / block.cells };
};

interface TextMetrics {
    width: number;
    /** 字形墨迹的上下：拿来把拉丁字母按看得见的部分上下居中。 */
    ascent: number;
    descent: number;
}

const metricsCache = new Map<string, TextMetrics>();
const METRICS_LIMIT = 1024;

interface Board {
    ctx: CanvasRenderingContext2D;
    x0: number;
    y0: number;
    cell: number;
    columns: number;
    palette: TesseraPalette;
    font: string;
}

const measureText = (board: Board, text: string): TextMetrics => {
    const key = `${board.font}|${text}`;
    const cached = metricsCache.get(key);
    if (cached) return cached;
    const metrics = board.ctx.measureText(text);
    return rememberBounded(metricsCache, key, {
        width: metrics.width,
        ascent: metrics.actualBoundingBoxAscent,
        descent: metrics.actualBoundingBoxDescent,
    }, METRICS_LIMIT);
};

/**
 * 一段的方框，中心在 (cx, cy)：带字的是空心框，垫块是实心一点的“垃圾行”方块，横跨几格的词是一个长框。
 * flash 让它被填满、发光。
 */
const drawBox = (board: Board, block: TesseraBlock, cx: number, cy: number, scale: number, alpha: number, flash: number) => {
    if (alpha <= 0 || scale <= 0) return;
    const { ctx, cell, palette } = board;
    const gap = cell * (1 - BOX_RATIO);
    const width = (block.cells * cell - gap) * scale;
    const height = (cell - gap) * scale;
    const filler = block.kind === 'filler';
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    if (flash > 0) {
        ctx.shadowColor = palette.ink;
        ctx.shadowBlur = cell * 0.55 * flash;
    }
    ctx.globalAlpha = alpha * ((filler ? 0.2 : 0.07) + 0.8 * flash);
    ctx.fillRect(cx - width / 2, cy - height / 2, width, height);
    ctx.globalAlpha = alpha * (filler ? 0.32 : 0.62);
    ctx.strokeRect(cx - width / 2, cy - height / 2, width, height);
    ctx.restore();
};

/**
 * 一段上的字，中心在 (cx, cy)。一格一字的按 middle 基线；横跨几格的词按字形墨迹上下居中，
 * 太宽时 fillText 的 maxWidth 把它压窄，唱过的部分用裁剪画亮。flash 时字反成背景色（方块被填满了）。
 */
const drawBlockText = (board: Board, block: TesseraBlock, cx: number, cy: number, t: number, scale: number, alpha: number, flash: number) => {
    if (block.kind === 'filler' || alpha <= 0 || scale <= 0) return;
    const { ctx, cell, palette } = board;
    const colors: Array<[string, number]> = flash > 0
        ? [[palette.text, 1 - flash], [palette.background, flash]]
        : [[palette.text, 1]];
    ctx.save();
    ctx.translate(cx, cy);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.textAlign = 'center';

    if (block.kind === 'glyph') {
        const glyph = block.glyphs[0];
        const sung = flash > 0 ? 1 : UNSUNG_ALPHA + (1 - UNSUNG_ALPHA) * sungAmount(glyph.start, glyph.end, t);
        ctx.textBaseline = 'middle';
        for (const [color, weight] of colors) {
            if (weight <= 0) continue;
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha * weight * sung;
            ctx.fillText(block.text, 0, 0);
        }
        ctx.restore();
        return;
    }

    const metrics = measureText(board, block.text);
    const maxWidth = block.cells * cell - cell * 0.32;
    const textWidth = Math.min(maxWidth, metrics.width);
    const baseline = (metrics.ascent - metrics.descent) / 2;
    let sungGlyphs = 0;
    for (const glyph of block.glyphs) sungGlyphs += sungAmount(glyph.start, glyph.end, t);
    const sung = flash > 0 ? 1 : sungGlyphs / block.glyphs.length;
    ctx.textBaseline = 'alphabetic';
    for (const [color, weight] of colors) {
        if (weight <= 0) continue;
        ctx.fillStyle = color;
        if (sung < 1) {
            ctx.globalAlpha = alpha * weight * UNSUNG_ALPHA;
            ctx.fillText(block.text, 0, baseline, maxWidth);
        }
        if (sung > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(-textWidth / 2 - cell, -cell, cell + textWidth * sung, cell * 2);
            ctx.clip();
            ctx.globalAlpha = alpha * weight;
            ctx.fillText(block.text, 0, baseline, maxWidth);
            ctx.restore();
        }
    }
    ctx.restore();
};

/** 一段的中心相对它最左一格左边缘的横向偏移（格）。 */
const blockCenterX = (block: TesseraBlock) => block.col + block.cells / 2;

/**
 * 下落中的一块：只有字，没有边框；顺着加速的曲线落下，途中平滑地横移回落点、转正。
 * 底下画一道很淡的落点虚影。
 */
const drawFallingPiece = (board: Board, plan: TesseraPlan, piece: TesseraPiece, t: number) => {
    const { ctx, cell, x0, y0, palette } = board;
    const progress = clamp01((t - piece.spawn) / Math.max(piece.land - piece.spawn, 0.01));
    const targetBase = plan.boardRows - 1 - piece.landSlot;
    // 每段落地后的格子坐标（行从上往下数）。
    const finalRow = (block: TesseraBlock) => targetBase - (block.row - piece.baseRow);
    let lo = Infinity;
    let hi = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const block of piece.blocks) {
        lo = Math.min(lo, block.col);
        hi = Math.max(hi, block.col + block.cells);
        top = Math.min(top, finalRow(block));
        bottom = Math.max(bottom, finalRow(block) + 1);
    }
    const pivotX = (lo + hi) / 2;
    const pivotY = (top + bottom) / 2;
    // 出生在棋盘上方，整块（转着时按长边算）都在框外。
    const reach = Math.max(hi - lo, bottom - top) / 2;
    const startY = -reach - 0.5;
    const fall = progress * (1 - FALL_GRAVITY) + progress * progress * FALL_GRAVITY;
    const dy = (startY - pivotY) * (1 - fall);
    const dx = piece.spawnShift * (1 - easeInOut(clamp01((progress - SHIFT_FROM) / SHIFT_SPAN)));
    const angle = piece.rotate * (Math.PI / 2) * (1 - easeInOut(clamp01((progress - ROTATE_FROM) / ROTATE_SPAN)));
    const fadeIn = easeOut(clamp01((t - piece.spawn) / SPAWN_FADE));

    // 落点虚影：淡淡的框，随下落渐显。
    ctx.save();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = Math.max(1, cell * 0.025);
    ctx.setLineDash([cell * 0.12, cell * 0.1]);
    ctx.globalAlpha = 0.14 * easeOut(progress);
    const gap = cell * (1 - BOX_RATIO);
    for (const block of piece.blocks) {
        ctx.strokeRect(
            x0 + block.col * cell + gap / 2,
            y0 + finalRow(block) * cell + gap / 2,
            block.cells * cell - gap,
            cell - gap,
        );
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x0 + (pivotX + dx) * cell, y0 + (pivotY + dy) * cell);
    if (angle !== 0) ctx.rotate(angle);
    // 底板：整块的轮廓连成一片（格与格之间不留缝，和落地后一格一框的样子区分开），
    // 先用背景色盖住后面的东西，再薄薄铺一层墨色；垫块那几格再深一点。一次 fill 免得重叠处变深。
    const plate = new Path2D();
    const fillerPlate = new Path2D();
    for (const block of piece.blocks) {
        const left = (block.col - pivotX) * cell;
        const top = (finalRow(block) - pivotY) * cell;
        plate.rect(left, top, block.cells * cell, cell);
        if (block.kind === 'filler') fillerPlate.rect(left, top, block.cells * cell, cell);
    }
    ctx.fillStyle = palette.background;
    ctx.globalAlpha = FALLING_PLATE_COVER * fadeIn;
    ctx.fill(plate);
    ctx.fillStyle = palette.ink;
    ctx.globalAlpha = FALLING_PLATE_ALPHA * fadeIn;
    ctx.fill(plate);
    ctx.globalAlpha = FALLING_FILLER_ALPHA * fadeIn;
    ctx.fill(fillerPlate);
    ctx.globalAlpha = 1;

    for (const block of piece.blocks) {
        drawBlockText(
            board,
            block,
            (blockCenterX(block) - pivotX) * cell,
            (finalRow(block) + 0.5 - pivotY) * cell,
            t,
            1,
            fadeIn,
            0,
        );
    }
    ctx.restore();
};

/** 一行：落了地的方块和字；行满以后闪白、塌缩、光束、碎屑。 */
const drawRow = (board: Board, plan: TesseraPlan, row: TesseraRow, slot: number, t: number) => {
    const { ctx, cell, x0, y0, columns, palette } = board;
    const rowTop = plan.boardRows - 1 - slot;
    const cy = y0 + (rowTop + 0.5) * cell;
    const k = t >= row.end ? (t - row.end) / TESSERA_CLEAR : -1;

    for (const { piece, block } of row.blocks) {
        if (t < piece.land) continue;
        const age = t - piece.land;
        const solid = easeOut(clamp01(age / SOLIDIFY));
        const clear = clearBlock(block, columns, k);
        const cx = x0 + blockCenterX(block) * cell;
        drawBox(board, block, cx, cy, (1.22 - 0.22 * solid) * clear.scale, solid * clear.alpha, clear.flash);
        // 刚落地：底边一道亮线（只画方块最下面那一行）。
        if (age < SOLIDIFY && k < 0 && block.row === piece.baseRow) {
            ctx.save();
            ctx.fillStyle = palette.ink;
            ctx.globalAlpha = 0.6 * (1 - solid);
            ctx.fillRect(x0 + block.col * cell, cy + cell * 0.46, block.cells * cell, Math.max(1, cell * 0.04));
            ctx.restore();
        }
        drawBlockText(board, block, cx, cy, t, clear.scale, clear.alpha, clear.flash);
    }

    if (k < 0) return;

    // 横贯整行的光束：从一格高收成一条线，渐隐。
    if (k >= BEAM_START && k < 1) {
        const beam = clamp01((k - BEAM_START) / (1 - BEAM_START));
        const height = cell * 0.95 * (1 - easeOut(beam)) + 1;
        const width = columns * cell;
        const gradient = ctx.createLinearGradient(x0, 0, x0 + width, 0);
        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(0.5, palette.ink);
        gradient.addColorStop(1, 'transparent');
        ctx.save();
        ctx.fillStyle = gradient;
        ctx.shadowColor = palette.ink;
        ctx.shadowBlur = cell * 0.8;
        ctx.globalAlpha = 0.85 * (1 - beam) ** 1.5;
        ctx.fillRect(x0 - cell, cy - height / 2, width + cell * 2, height);
        ctx.restore();
    }

    // 每格塌掉时迸出几粒小方块碎屑。
    ctx.save();
    ctx.fillStyle = palette.ink;
    for (let col = 0; col < columns; col += 1) {
        const { collapseAt } = clearCell(col, columns, k);
        const age = (k - collapseAt) * TESSERA_CLEAR;
        if (age <= 0 || age >= PARTICLE_LIFE) continue;
        const life = age / PARTICLE_LIFE;
        for (let index = 0; index < PARTICLES_PER_CELL; index += 1) {
            const angle = -Math.PI / 2 + (hash01(col, index, 1) - 0.5) * Math.PI * 1.4;
            const speed = cell * (2.5 + hash01(col, index, 2) * 4);
            const x = x0 + (col + 0.5) * cell + Math.cos(angle) * speed * age;
            const y = cy + Math.sin(angle) * speed * age + 0.5 * cell * 14 * age * age;
            const size = cell * (0.08 + hash01(col, index, 3) * 0.1) * (1 - life);
            ctx.globalAlpha = 0.9 * (1 - life);
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
    }
    ctx.restore();
};

/** 棋盘的边框：简单的直角长方形，描两遍做出发光。fill 为 board 时框里先铺背景色。 */
const drawFrame = (board: Board, boardRows: number, showGrid: boolean, fill: TesseraFill) => {
    const { ctx, cell, x0, y0, columns, palette } = board;
    const width = columns * cell;
    const height = boardRows * cell;
    const pad = Math.max(4, cell * 0.16);
    if (fill === 'board') {
        ctx.fillStyle = palette.background;
        ctx.fillRect(x0 - pad, y0 - pad, width + pad * 2, height + pad * 2);
    }
    ctx.save();
    ctx.strokeStyle = palette.ink;
    ctx.shadowColor = palette.ink;
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    ctx.shadowBlur = cell * 0.9;
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(x0 - pad, y0 - pad, width + pad * 2, height + pad * 2);
    ctx.shadowBlur = cell * 0.25;
    ctx.globalAlpha = 1;
    ctx.strokeRect(x0 - pad, y0 - pad, width + pad * 2, height + pad * 2);
    ctx.restore();

    if (!showGrid) return;
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.globalAlpha = 0.09;
    const dot = Math.max(1, cell * 0.04);
    for (let col = 1; col < columns; col += 1) {
        for (let row = 1; row < boardRows; row += 1) {
            ctx.fillRect(x0 + col * cell - dot / 2, y0 + row * cell - dot / 2, dot, dot);
        }
    }
    ctx.restore();
};

/**
 * 这一刻棋盘上有没有东西在变：有一行出现着（下落、落地、唱到的字变亮、消行、碎屑、往下掉都在这段里）。
 * 没有时整幅画面只剩框，和上一帧一样，画布循环可以跳过不画。
 */
export const tesseraFrameMoving = (plan: TesseraPlan, t: number) => plan.rows.some(row => (
    t >= row.presenceStart && t < Math.max(row.clearEnd + PARTICLE_LIFE, row.dropEnd)
));

/** 画一帧。ctx 的变换应已按 devicePixelRatio 设好，单位是 CSS 像素。 */
export const drawTesseraFrame = (ctx: CanvasRenderingContext2D, input: TesseraFrameInput) => {
    const { plan, t, width, height, palette, fontStack, fontWeight, showGrid, fill, showText } = input;
    ctx.clearRect(0, 0, width, height);
    if (fill === 'all') {
        ctx.fillStyle = palette.background;
        ctx.fillRect(0, 0, width, height);
    }
    const areaTop = height * BOARD_TOP;
    const areaHeight = height * (1 - BOARD_TOP - BOARD_BOTTOM);
    const cell = Math.floor(Math.min((width * BOARD_FILL) / plan.columns, areaHeight / plan.boardRows));
    if (cell <= 2) return;
    const board: Board = {
        ctx,
        cell,
        x0: Math.round((width - cell * plan.columns) / 2),
        y0: Math.round(areaTop + (areaHeight - cell * plan.boardRows) / 2),
        columns: plan.columns,
        palette,
        font: `${fontWeight} ${(cell * TESSERA_FONT_RATIO).toFixed(1)}px ${fontStack}`,
    };

    drawFrame(board, plan.boardRows, showGrid, fill);
    if (!showText) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(board.x0, board.y0, plan.columns * cell, plan.boardRows * cell);
    ctx.clip();
    ctx.font = board.font;

    // 先画垫着的行（自下而上），再画还在空中的方块，让下落的字压在最上面。
    let slot = 0;
    for (const row of plan.rows) {
        const presence = rowPresence(row, t);
        // 消完以后再画一小会儿，让碎屑飞完（方块此时都已塌没了）。
        if (t >= row.presenceStart && t < row.clearEnd + PARTICLE_LIFE) drawRow(board, plan, row, slot, t);
        slot += presence;
    }
    for (const piece of plan.pieces) {
        if (t >= piece.spawn && t < piece.land) drawFallingPiece(board, plan, piece, t);
    }
    ctx.restore();
};
