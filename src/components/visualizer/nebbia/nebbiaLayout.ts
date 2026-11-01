import { clamp } from './nebbiaConstants';
import type { NebbiaSourceLine } from './nebbiaChars';
import { assignRoles, makeBlocks, mergeWords, ROLE_SCALE, ROLE_SCALE_FAST, type PlacedItem } from './nebbiaBlocks';
import { COMPOSITION_BIAS, COMPOSITIONS, SIMPLE_COMPOSITIONS, type CompositionContext } from './nebbiaCompositions';
import { createVisualizerRng, hashVisualizerSeed } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaLayout.ts
// 雾笺的整首排版：每句挑一个构图，再在屏上几个候选位置、几档字号里找一个不和「这句出现时还没消失的句子」
// 重叠、字够大的地方。整首按时间顺序一次排完，结果只由歌词、时间和屏幕尺寸决定（seek、重建都一样）。

export interface NebbiaCharPos { x: number; y: number; s: number; rot: number }
export interface NebbiaLayoutOptions {
    W: number;
    H: number;
    jitter: number;
    /** 打开的构图；关掉的不参与挑选（实在放不下时的三行兜底不受限）。 */
    layouts: readonly string[];
    /** 字号倍数（用户的歌词字号）。 */
    fontScale: number;
    /** 第 i 句的擦痕完全被雾吞掉的时刻、开始起雾的时刻。 */
    visibleUntil: (i: number) => number;
    fogAt: (i: number) => number;
    /** 屏上还空着时第 i 句最多留到的时刻：多留的这段只算一点点占地方，后面的句子要用这块它就让位。 */
    lingerUntil?: (i: number) => number;
}
/** 多留着的句子占地方的权重：有空地就别压上去，但不为它缩小字号。 */
const LINGER_WEIGHT = 0.03;

type Box = { x0: number; x1: number; y0: number; y1: number };
interface Candidate { score: number; name: string; items: PlacedItem[]; bb: Box; S: number; cx: number; cy: number; box: Box }

const bboxOf = (items: PlacedItem[]): Box & { w: number; h: number } => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const it of items) {
        x0 = Math.min(x0, it.x - it.s / 2); x1 = Math.max(x1, it.x + it.s / 2);
        y0 = Math.min(y0, it.y - it.s / 2); y1 = Math.max(y1, it.y + it.s / 2);
    }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
};
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** 排整首歌：每句一个数组，和 chars 一一对应（空格也有位置，但不画）。 */
export const layoutNebbiaSong = (lines: NebbiaSourceLine[], opts: NebbiaLayoutOptions): NebbiaCharPos[][] => {
    const { W, H, jitter, layouts, fontScale, visibleUntil, fogAt, lingerUntil } = opts;
    const mx = W * 0.05, my = H * 0.07;
    const Smin = Math.max(26, H * 0.065) * fontScale, Smax = H * 0.14 * fontScale;
    const placed: { box: Box; until: number; fogAt: number; linger: number }[] = [];
    const recent: string[] = [];
    let prev: Candidate | null = null;
    // 片尾：曲名横着写在正中偏上，放不下就分两行；歌手小一半写在曲名下面
    let titleBox: Box | null = null;
    const creditsCandidate = (ctx: CompositionContext, kind: 'title' | 'artist'): Candidate => {
        const res = (kind === 'title' ? null : COMPOSITIONS.ribbon(ctx)) ?? pickWide(ctx);
        const bb = bboxOf(res.items);
        const cap = kind === 'title' ? Smax * 1.15 : Smax * 0.55;
        const S = Math.min(cap, (W - mx * 2) * 0.8 / bb.w, H * 0.32 / bb.h);
        const bw = bb.w * S, bh = bb.h * S;
        const cy = kind === 'title' || !titleBox ? H * 0.42 : titleBox.y1 + bh / 2 + S * 0.6;
        const box = { x0: W / 2 - bw / 2, x1: W / 2 + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2 };
        if (kind === 'title') titleBox = box;
        return { score: 0, name: 'ribbon', items: res.items, bb, S, cx: W / 2, cy, box };
    };
    // 曲名：一行写得下（字不小于最小字号）就一行，否则两行
    const pickWide = (ctx: CompositionContext) => {
        const one = COMPOSITIONS.ribbon(ctx)!, bb = bboxOf(one.items);
        const fits = Math.min(Smax * 1.15, (W - mx * 2) * 0.8 / bb.w) >= Smin;
        return (fits ? null : COMPOSITIONS.lines2(ctx)) ?? one;
    };
    return lines.map((line, li) => {
        const { chars } = line;
        const rnd = createVisualizerRng((hashVisualizerSeed(chars.map(c => c.ch).join('')) + li * 7919) >>> 0);
        const visible = chars.filter(c => c.ch.trim());
        // 快歌：每个字平均唱不到 0.22 秒
        const fast = visible.length > 0 && (line.end - line.t) / visible.length < 0.22;
        const words = mergeWords(chars, line.words);
        if (!words.length) return chars.map(() => ({ x: W / 2, y: H / 2, s: Smin, rot: 0 }));
        const roles = assignRoles(chars, words);
        const RS = fast ? ROLE_SCALE_FAST : ROLE_SCALE;
        // 这句出现时还在屏上的句子；已经开始起雾的按剩下的清晰度打折
        const busy = placed.filter(p => p.linger > line.t - 0.3).map(p => ({
            box: p.box,
            w: p.until <= line.t - 0.3 ? LINGER_WEIGHT
                : line.t <= p.fogAt ? 1 : 0.6 + 0.4 * clamp((p.until - line.t) / Math.max(1e-3, p.until - p.fogAt)),
        }));

        let best: Candidate | null = line.credits
            ? creditsCandidate({ blocks: makeBlocks(chars, words, words.map(() => 'support' as const), ROLE_SCALE, 9), h: 0, chars }, line.credits)
            : null;
        if (!best) for (const maxBlocks of [5, 7]) {
            const blocks = makeBlocks(chars, words, roles, RS, maxBlocks);
            const ctx: CompositionContext = { blocks, h: Math.max(0, blocks.findIndex(b => b.role === 'hero')), chars };
            for (const name of Object.keys(COMPOSITIONS)) {
                if (!layouts.includes(name)) continue;
                const res = COMPOSITIONS[name](ctx);
                if (!res || !res.items.length) continue;
                const bb = bboxOf(res.items);
                // 构图最多占半屏左右，给下一句留出地方
                const maxH = H * (name === 'ribbon' ? 0.28 : 0.5), maxW = (W - mx * 2) * (SIMPLE_COMPOSITIONS.has(name) ? 0.94 : 0.68);
                const Sfit = Math.min(maxW / bb.w, maxH / bb.h, Smax);
                if (Sfit < Smin * 0.75) continue;
                // 字号也是候选：屏上挤的时候缩小一点换位置，不低于最小字号的 3/4
                for (const S of [Sfit, Sfit * 0.8, Sfit * 0.64, Sfit * 0.5].filter((v, i) => i === 0 || v >= Smin * 0.75)) {
                    const bw = bb.w * S, bh = bb.h * S;
                    for (const fx of [0.5, 0.3, 0.7]) for (const fy of [0.25, 0.42, 0.58, 0.75]) {
                        const cx = clamp(fx * W, mx + bw / 2, W - mx - bw / 2), cy = clamp(fy * H, my + bh / 2, H - my - bh / 2);
                        const box = { x0: cx - bw / 2, x1: cx + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2 };
                        const pad = S * 0.3, padBox = { x0: box.x0 - pad, x1: box.x1 + pad, y0: box.y0 - pad, y1: box.y1 + pad };
                        let score = 0;
                        for (const b of busy) score += overlapArea(padBox, b.box) / (bw * bh) * 1000 * b.w;
                        score -= S / H * 100;
                        if (S < Smin) score += 40 + (Smin - S) / Smin * 200;
                        score += COMPOSITION_BIAS[name];
                        // 转 90° 的拉丁词难读一点，少用；快的句子更少用竖的
                        score += res.vRot * (fast ? 10 : 4);
                        if (fast && !SIMPLE_COMPOSITIONS.has(name)) score += 6;
                        if (maxBlocks === 7 && blocks.length <= 5) score += 100;
                        // 别老是同一个构图、同一个位置；大致在视线中间
                        const rep = recent.lastIndexOf(name);
                        if (rep >= 0) score += [18, 9, 4][recent.length - 1 - rep];
                        if (prev && Math.abs(prev.cx - cx) < W * 0.08 && Math.abs(prev.cy - cy) < H * 0.08) score += 8;
                        score += Math.abs(cy - H * 0.5) / H * 8;
                        score += rnd() * 8;
                        if (!best || score < best.score) best = { score, name, items: res.items, bb, S, cx, cy, box };
                    }
                }
            }
        }
        // 实在放不下（极长的一句）：三行，按屏幕能放下的字号居中
        if (!best) {
            const blocks = makeBlocks(chars, words, roles, ROLE_SCALE_FAST, 9);
            const ctx: CompositionContext = { blocks, h: 0, chars };
            const res = COMPOSITIONS.lines3(ctx) ?? COMPOSITIONS.lines2(ctx) ?? COMPOSITIONS.ribbon(ctx)!;
            const bb = bboxOf(res.items);
            const S = Math.min(Smax, (W - mx * 2) / bb.w, (H - my * 2) / bb.h);
            best = { score: 0, name: 'lines3', items: res.items, bb, S, cx: W / 2, cy: H / 2, box: { x0: W / 2 - bb.w * S / 2, x1: W / 2 + bb.w * S / 2, y0: H / 2 - bb.h * S / 2, y1: H / 2 + bb.h * S / 2 } };
        }
        const chosen: Candidate = best;
        placed.push({ box: chosen.box, until: visibleUntil(li), fogAt: fogAt(li), linger: Math.max(visibleUntil(li), lingerUntil?.(li) ?? 0) });
        recent.push(chosen.name);
        if (recent.length > 3) recent.shift();
        prev = chosen;

        // 落到屏幕坐标，再加一点手写歪斜（幅度小，不至于撞到别的字）
        const { bb, S, cx, cy } = chosen;
        const tilt = (rnd() - 0.5) * 0.04 * jitter;
        const byK = new Map(chosen.items.map(it => [it.k, it]));
        let lastPos: NebbiaCharPos = { x: cx, y: cy, s: S, rot: 0 };
        return chars.map((_, k) => {
            const it = byK.get(k);
            if (!it) return { ...lastPos, rot: 0 };
            const x = cx + (it.x - (bb.x0 + bb.x1) / 2) * S, y0 = cy + (it.y - (bb.y0 + bb.y1) / 2) * S;
            const s = it.s * S * (1 + (rnd() - 0.5) * 0.08 * jitter);
            lastPos = {
                x: x + (rnd() - 0.5) * S * 0.04 * jitter,
                y: y0 + (x - cx) * tilt + (rnd() - 0.5) * S * 0.05 * jitter,
                s,
                rot: it.rot + (rnd() - 0.5) * 0.08 * jitter + tilt,
            };
            return lastPos;
        });
    });
};
