import type { Line } from '../../../../types';
import { buildLineGraphemeTimeline } from '../../../../utils/lyrics/graphemeTiming';

// src/components/visualizer/machi/engine/boardLayout.ts
// 屋顶广告塔字面的排版与逐字点亮：把一行歌词按字面宽高排成 1–3 行（取字最大的那种，行数多了略扣分），
// 记下每个字的 [x0, x1] 和它的唱起、唱完时间；每帧按时间求每一行亮到哪个 x。字的时间来自
// buildLineGraphemeTimeline（parser 的逐词时间拆到字），不靠字符串搜索猜。测量函数由调用方给（Canvas 或测试里的假测量）。

/** 按参考字号量一段字的宽度（像素）。 */
export type MachiMeasure = (text: string) => number;

export interface MachiBoardGlyph {
    text: string;
    /** 在 fullText 里的 UTF-16 起止下标（关键词着色按字符范围匹配）。 */
    offset: number;
    length: number;
    x0: number;
    x1: number;
    startTime: number;
    endTime: number;
}

export interface MachiBoardRow {
    glyphs: MachiBoardGlyph[];
    /** 这一行的字号（曲名卡的两行不一样大）。 */
    fontPx: number;
    /** 这一行的基线中心 y（像素，字面半张图里从上往下）。 */
    centerY: number;
    /** 行的上下界（像素），着色器按它判断一个像素属于哪一行。 */
    top: number;
    bottom: number;
}

export interface MachiBoardLayout {
    fontPx: number;
    rows: MachiBoardRow[];
    width: number;
    height: number;
}

export interface MachiBoardBox {
    width: number;
    height: number;
    /** 左右留白占宽度的比例。 */
    paddingX: number;
    /** 测量时用的参考字号。 */
    referencePx: number;
}

const MAX_ROWS = 3;
/** 一行字高占字面高的上限（单行时字也不会顶满）。 */
const SINGLE_ROW_FILL = 0.56;
const LINE_GAP = 1.22;
/** 行数多了略扣分：同样大的字，少一行更好读。 */
const ROW_PENALTY = [1, 0.94, 0.84];

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** 不该出现在行首的标点：并到前一个字上。 */
const STICKY_PUNCTUATION = /^[，。、！？；：,.!?;:」』）)\]】〉》…~～ー]+$/u;

interface Token {
    glyphs: { text: string; offset: number; startTime: number; endTime: number }[];
}

/** 一行歌词 → 断行单位：中日韩字一个字一个单位，拉丁词连同后面的空格一个单位，行首禁则标点并到前面。 */
const tokenize = (line: Line): Token[] => {
    const timeline = buildLineGraphemeTimeline(line);
    const tokens: Token[] = [];
    let current: Token | null = null;
    let offset = 0;
    timeline.forEach(entry => {
        const glyph = { text: entry.char, offset, startTime: entry.startTime, endTime: entry.endTime };
        offset += entry.char.length;
        const isSpace = /^\s+$/u.test(entry.char);
        const isCjk = CJK_PATTERN.test(entry.char);
        if (STICKY_PUNCTUATION.test(entry.char) && tokens.length > 0 && !current) {
            tokens[tokens.length - 1]!.glyphs.push(glyph);
            return;
        }
        if (isCjk) {
            if (current) tokens.push(current);
            current = null;
            tokens.push({ glyphs: [glyph] });
            return;
        }
        if (!current) current = { glyphs: [] };
        current.glyphs.push(glyph);
        if (isSpace) {
            tokens.push(current);
            current = null;
        }
    });
    if (current) tokens.push(current);
    return tokens.filter(token => token.glyphs.length > 0);
};

const tokenText = (token: Token) => token.glyphs.map(glyph => glyph.text).join('');

/** 去掉行尾空格后的宽度（行尾空格不占排版）。 */
const rowWidth = (tokens: Token[], measure: MachiMeasure) => measure(tokens.map(tokenText).join('').trimEnd());

/** 把单位分成 rows 行，尽量等宽（贪心：每行装到接近总宽 / 行数）。 */
const splitRows = (tokens: Token[], rows: number, measure: MachiMeasure): Token[][] => {
    if (rows <= 1 || tokens.length <= 1) return [tokens];
    const total = rowWidth(tokens, measure);
    const target = total / rows;
    const result: Token[][] = [];
    let current: Token[] = [];
    tokens.forEach((token, index) => {
        const remainingRows = rows - result.length;
        const remainingTokens = tokens.length - index;
        const next = [...current, token];
        if (current.length > 0 && remainingRows > 1 && rowWidth(next, measure) > target * 1.04 && remainingTokens >= remainingRows - 1) {
            // 放进去超了：看放不放这一个更接近目标。
            const without = rowWidth(current, measure);
            const withIt = rowWidth(next, measure);
            if (Math.abs(withIt - target) < Math.abs(without - target) && remainingTokens > remainingRows - 1) {
                result.push(next);
                current = [];
                return;
            }
            result.push(current);
            current = [token];
            return;
        }
        current = next;
    });
    if (current.length > 0) result.push(current);
    return result;
};

/** 一行歌词在字面上的排版：1–3 行里挑字最大的（行数多扣分）。 */
export const layoutMachiBoardLine = (line: Line, box: MachiBoardBox, measure: MachiMeasure): MachiBoardLayout => {
    const tokens = tokenize(line);
    const usableWidth = box.width * (1 - box.paddingX * 2);
    let best: { rows: Token[][]; fontPx: number; score: number } | null = null;
    for (let rows = 1; rows <= MAX_ROWS; rows += 1) {
        if (rows > tokens.length) break;
        const split = splitRows(tokens, rows, measure);
        const widest = Math.max(1, ...split.map(row => rowWidth(row, measure)));
        const byWidth = (usableWidth / widest) * box.referencePx;
        const byHeight = rows === 1 ? box.height * SINGLE_ROW_FILL : box.height * 0.86 / (split.length * LINE_GAP);
        const fontPx = Math.min(byWidth, byHeight);
        const score = fontPx * ROW_PENALTY[split.length - 1]!;
        if (!best || score > best.score) best = { rows: split, fontPx, score };
    }
    if (!best) return { fontPx: box.height * 0.4, rows: [], width: box.width, height: box.height };
    return placeRows(best.rows, best.fontPx, box, measure);
};

/** 按字号把各行居中摆好，量出每个字的 x 区间。 */
const placeRows = (rows: Token[][], fontPx: number, box: MachiBoardBox, measure: MachiMeasure): MachiBoardLayout => {
    const scale = fontPx / box.referencePx;
    const lineHeight = fontPx * LINE_GAP;
    const blockHeight = lineHeight * rows.length;
    const firstCenter = box.height / 2 - blockHeight / 2 + lineHeight / 2;
    return {
        fontPx,
        width: box.width,
        height: box.height,
        rows: rows.map((tokens, rowIndex) => {
            const glyphs = tokens.flatMap(token => token.glyphs);
            const text = glyphs.map(glyph => glyph.text).join('');
            const width = measure(text.trimEnd()) * scale;
            const left = (box.width - width) / 2;
            let prefix = '';
            const placed = glyphs.map(glyph => {
                const x0 = left + measure(prefix) * scale;
                prefix += glyph.text;
                const x1 = left + measure(prefix) * scale;
                return { ...glyph, length: glyph.text.length, x0, x1 };
            });
            const centerY = firstCenter + rowIndex * lineHeight;
            return { glyphs: placed, fontPx, centerY, top: centerY - lineHeight / 2, bottom: centerY + lineHeight / 2 };
        }),
    };
};

/** 曲名卡（间奏、纯音乐、没开显示歌词时）：主标题一行（放不下缩字），副标题小一号。 */
export const layoutMachiBoardCard = (
    title: string,
    subtitle: string,
    box: MachiBoardBox,
    measure: MachiMeasure,
): MachiBoardLayout => {
    const usableWidth = box.width * (1 - box.paddingX * 2);
    const titleFont = Math.min(box.height * (subtitle ? 0.4 : 0.5), (usableWidth / Math.max(1, measure(title))) * box.referencePx);
    const subtitleFont = subtitle ? Math.min(titleFont * 0.52, (usableWidth / Math.max(1, measure(subtitle))) * box.referencePx) : 0;
    const rows: MachiBoardRow[] = [];
    const totalHeight = titleFont * 1.15 + (subtitle ? subtitleFont * 1.4 : 0);
    let y = box.height / 2 - totalHeight / 2;
    const row = (text: string, fontPx: number) => {
        const scale = fontPx / box.referencePx;
        const width = measure(text) * scale;
        const left = (box.width - width) / 2;
        const height = fontPx * (rows.length === 0 ? 1.15 : 1.4);
        const centerY = y + height / 2;
        rows.push({
            glyphs: [{ text, offset: 0, length: text.length, x0: left, x1: left + width, startTime: -Infinity, endTime: -Infinity }],
            fontPx,
            centerY,
            top: y,
            bottom: y + height,
        });
        y += height;
    };
    row(title, titleFont);
    if (subtitle) row(subtitle, subtitleFont);
    return { fontPx: titleFont, rows, width: box.width, height: box.height };
};

/**
 * 时刻 time 每一行亮到的 x（像素）。字在 [startTime, endTime] 里从左往右扫亮，唱完的字全亮；
 * 一行里按字的顺序走，遇到还没开始的字就停。结果对时间单调不减。
 */
export const resolveMachiBoardReveal = (layout: MachiBoardLayout, time: number): number[] => layout.rows.map(row => {
    let lit = row.glyphs[0]?.x0 ?? 0;
    for (const glyph of row.glyphs) {
        if (time >= glyph.endTime) {
            lit = glyph.x1;
            continue;
        }
        if (time > glyph.startTime) {
            const span = Math.max(1e-3, glyph.endTime - glyph.startTime);
            lit = glyph.x0 + (glyph.x1 - glyph.x0) * Math.min(1, (time - glyph.startTime) / span);
        }
        break;
    }
    return lit;
});
