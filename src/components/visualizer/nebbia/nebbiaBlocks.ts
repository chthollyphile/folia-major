import { clamp } from './nebbiaConstants';
import { isIconChar, type NebbiaChar } from './nebbiaChars';
import { getNebbiaStrokeMedians } from './nebbiaStrokes';

// src/components/visualizer/nebbia/nebbiaBlocks.ts
// 雾笺排版的前半段，照商籁的思路（sonnetTypographyRoles.ts）：按「字数 + 时长」给词打分，分最高的是主词（hero）
// 放大，次高的副主词（semi）略大，单字虚词缩小；词多的句子把相邻的词并成几块。块可以横排或竖排量尺寸
// （竖排时中日文逐字往下，拉丁词整个转 90°）。坐标单位都是基准字号 1。

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const PUNCT = /^[，。、！？!?,.・…]$/;
// 竖排时要转 90° 的字（长音、破折号、省略号）
const TURN_IN_VERTICAL = /^[ー—～〜…-]$/;
const PARTICLES = new Set([...'的了着过吗呢吧啊呀嘛之与和是也都就还又被把给のがをにはへとでやもねよなかしてたっ']);

export type Role = 'hero' | 'semi' | 'support' | 'particle';
export const ROLE_SCALE: Record<Role, number> = { hero: 2.0, semi: 1.35, support: 1, particle: 0.78 };
/** 快歌的主次差小一点，读起来更稳。 */
export const ROLE_SCALE_FAST: Record<Role, number> = { hero: 1.55, semi: 1.18, support: 1, particle: 0.85 };
/** 同一行（列）里词和词之间、行和行之间的空。 */
export const FLOW_GAP = 0.3;
export const STACK_GAP = 0.32;

export const isWideChar = (ch: string) => /[　-鿿＀-￯]/.test(ch);

/** 横排时一个字占的宽度（× 字号）。 */
export const advanceOf = (ch: string) => {
    if (isIconChar(ch)) return 1.1;
    if (ch === ' ') return 0.32;
    if (/[，。、・．]/.test(ch)) return 0.5;
    if (isWideChar(ch)) return 1;
    if (/[il.,'!|:;]/.test(ch)) return 0.3;
    if (/[mwMW]/.test(ch)) return 0.72;
    return 0.5;
};

/** 标点粘到前一个词上；分词器把一串片假名切开的（パ｜ラジクロロ）再并回去。 */
export const mergeWords = (chars: NebbiaChar[], words: number[][]): number[][] => {
    const out: number[][] = [];
    const kata = (w: number[]) => w.every(k => /^[゠-ヿ]$/.test(chars[k].ch));
    for (const w of words) {
        const last = out[out.length - 1];
        if (last && (w.every(k => PUNCT.test(chars[k].ch)) || (kata(w) && kata(last) && w[0] === last[last.length - 1] + 1))) last.push(...w);
        else out.push([...w]);
    }
    return out;
};

// 商籁同款打分：字数（最多 8）× 14 + 时长（最多 2.5 秒）× 18
const scoreWord = (chars: NebbiaChar[], w: number[]) => {
    const len = w.filter(k => chars[k].ch.trim()).length;
    const t0 = chars[w[0]].t, last = chars[w[w.length - 1]];
    return Math.min(len, 8) * 14 + clamp(last.t + last.d - t0, 0, 2.5) * 18;
};

/** 每个词的角色：主词一个；词数 ≥ 4 时挑一个离主词至少隔一个词、分数 ≥ 主词 35% 的副主词；单字虚词缩小。 */
export const assignRoles = (chars: NebbiaChar[], words: number[][]): Role[] => {
    const scores = words.map(w => scoreWord(chars, w));
    let hero = 0;
    scores.forEach((s, i) => { if (s > scores[hero]) hero = i; });
    let semi = -1;
    if (words.length >= 4) {
        words.forEach((w, i) => {
            if (i === hero || Math.abs(i - hero) < 2 || w.length < 2 || scores[i] < scores[hero] * 0.35) return;
            if (semi < 0 || scores[i] > scores[semi]) semi = i;
        });
    }
    return words.map((w, i) => {
        if (i === hero && words.length > 1) return 'hero';
        if (i === semi) return 'semi';
        if (w.length === 1 && PARTICLES.has(chars[w[0]].ch)) return 'particle';
        return 'support';
    });
};

export interface BlockWord { idx: number[]; scale: number; cjk: boolean }
export interface Block { role: Role; words: BlockWord[] }

const isCjkWord = (chars: NebbiaChar[], w: number[]) => w.every(k => CJK.test(chars[k].ch) || PUNCT.test(chars[k].ch));

/** 把词并成至多 maxBlocks 块：虚词先并到前一块；还多就把相邻、都不是主次词、合起来最短的两块并起来。 */
export const makeBlocks = (chars: NebbiaChar[], words: number[][], roles: Role[], scales: Record<Role, number>, maxBlocks: number): Block[] => {
    const blocks: Block[] = [];
    words.forEach((w, i) => {
        const role = roles[i], word = { idx: w, scale: scales[role], cjk: isCjkWord(chars, w) };
        const last = blocks[blocks.length - 1];
        if (role === 'particle' && last && last.role !== 'hero' && last.role !== 'semi') last.words.push(word);
        else blocks.push({ role, words: [word] });
    });
    const len = (b: Block) => b.words.reduce((s, w) => s + w.idx.length, 0);
    const strong = (b: Block) => b.role === 'hero' || b.role === 'semi';
    while (blocks.length > maxBlocks) {
        let bi = -1, bl = Infinity;
        for (let i = 0; i < blocks.length - 1; i += 1) {
            if (strong(blocks[i]) || strong(blocks[i + 1])) continue;
            if (len(blocks[i]) + len(blocks[i + 1]) < bl) { bl = len(blocks[i]) + len(blocks[i + 1]); bi = i; }
        }
        if (bi < 0) break;
        blocks[bi] = { role: 'support', words: [...blocks[bi].words, ...blocks[bi + 1].words] };
        blocks.splice(bi + 1, 1);
    }
    return blocks;
};

export interface MeasureItem { k: number; off: number; s: number; rot: number; punct: boolean }
export interface Measured { dir: 'h' | 'v'; items: MeasureItem[]; w: number; h: number }
export interface PlacedItem { k: number; x: number; y: number; s: number; rot: number }

const gapOf = (a: BlockWord, b: BlockWord) => (a.cjk && b.cjk ? 0.04 : 0.24);

/**
 * 笔画多的字单独放大（10 笔起，19 笔以上到 1.25 倍），字号小也看得清；本来就大的词（主词）放大得少。
 * 只看笔顺数据里的笔数：没有数据的字（拉丁字母、数据还没加载）不放大。
 */
const complexScale = (ch: string, scale: number) => {
    const n = getNebbiaStrokeMedians(ch)?.length ?? 0;
    return 1 + 0.25 * clamp((n - 9) / 10) / Math.max(1, scale);
};

/** 量一块：'h' 横排，'v' 竖排。items 是沿排列方向各字的偏移。 */
export const measureBlock = (block: Block, chars: NebbiaChar[], dir: 'h' | 'v'): Measured => {
    const items: MeasureItem[] = [];
    let pen = 0, thick = 0;
    block.words.forEach((w, wi) => {
        if (wi > 0) pen += gapOf(block.words[wi - 1], w) * (dir === 'v' && w.cjk ? 0 : 1);
        for (const k of w.idx) {
            const ch = chars[k].ch;
            const vertCjk = dir === 'v' && w.cjk;
            const a = vertCjk ? (PUNCT.test(ch) ? 0.55 : 1.02) : advanceOf(ch);
            const rot = dir === 'v' && (!w.cjk || TURN_IN_VERTICAL.test(ch)) ? Math.PI / 2 : 0;
            const s = w.scale * (w.cjk ? complexScale(ch, w.scale) : 1);
            items.push({ k, off: pen + a * s / 2, s, rot, punct: vertCjk && PUNCT.test(ch) });
            pen += a * s;
            thick = Math.max(thick, s);
        }
    });
    return dir === 'h' ? { dir, items, w: pen, h: thick } : { dir, items, w: thick, h: pen };
};

/** 量好的块放到中心 (cx, cy)：横排底边对齐，竖排中线对齐，竖排的句读点放在格子右上。 */
export const emitBlock = (m: Measured, cx: number, cy: number, out: PlacedItem[]) => {
    for (const it of m.items) {
        if (m.dir === 'h') out.push({ k: it.k, x: cx - m.w / 2 + it.off, y: cy + m.h / 2 - it.s / 2, s: it.s, rot: 0 });
        else out.push({ k: it.k, x: cx + (it.punct ? it.s * 0.3 : 0), y: cy - m.h / 2 + it.off - (it.punct ? it.s * 0.2 : 0), s: it.s, rot: it.rot });
    }
};

export const hasTurned = (m: Measured) => (m.items.some(it => it.rot) ? 1 : 0);
