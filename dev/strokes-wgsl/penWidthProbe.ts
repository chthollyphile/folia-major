/// <reference types="@webgpu/types" />
import { buildFontStrokesGlyph, EM_UNITS, type FontStrokesGlyph } from '../../src/services/fontStrokes/fontStrokesOutline';
import { decodeFontStrokesGlyph, encodeFontStrokesGlyph } from '../../src/services/fontStrokes/fontStrokesCodec';
import { glyphFeatures, renderCanon } from '../../src/services/fontStrokes/fontStrokesRaster';
import { SERIAL_PACING } from '../../src/services/analysis/gpuSlices';
import { StrokesJob, type StrokesGlyphResult } from '../../src/services/analysis/strokesWgsl/strokesJob';
import { buildFontStrokesNebbiaGlyph, modelPolys, penGlyph, strokesPolys, type FontCanon } from '../../src/components/visualizer/nebbia/nebbiaFontGlyph';
import { alongFromOutlines, fillRings } from '../../src/components/visualizer/nebbia/nebbiaFontAlong';
import { CANON } from '../../src/components/visualizer/nebbia/nebbiaFontField';
import type { Glyph } from '../../src/components/visualizer/nebbia/nebbiaGlyphShape';
import { fs, path } from './node';

// dev/strokes-wgsl/penWidthProbe.ts
// 阶段 2 验证（SW_TASK=penwidth）：雾笺改读笔画服务后「效果不变」的数。每个字体 × 字 × 字重 W：
//   旧路径  在 W 上跑 full6 + own2，模型笔迹 + own2 的书写位置 → penWidthProfile（雾笺原来的 buildPenGlyph）
//   新路径  同样在 W 上跑（笔画服务按显示字重推理，键带 |w<W>）→ buildFontStrokesGlyph（默认轮廓外扩）→ 编解码来回一趟
//           → 当前字重 W 的墨 + 从轮廓还原的归属和书写位置（nebbiaFontAlong）→ penWidthProfile
// 比：笔数是否相同；笔数相同的字，按每笔弧长比例对齐的点距（网格像素，256²）和笔宽倍数差；以及新路径的耗时（W 的光栅 + 还原 + 量）。
// 每个 W 两边笔迹都是同一次推理，差别只来自编解码和轮廓还原（W = 600 是雾笺默认字重）。

type Log = (line: string) => void;
export interface PenWidthConfig { out: string; full6: string; own2: string; f16: boolean }

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const FONTS: { family: string; label: string }[] = env.SW_FONTS ? JSON.parse(env.SW_FONTS) as { family: string; label: string }[] : [
    { family: 'PingFang SC', label: 'PingFang SC' },
    { family: 'Hiragino Sans', label: 'Hiragino Sans' },
    { family: 'Songti SC', label: 'Songti SC' },
    { family: 'STKaiti', label: 'STKaiti' },
];
/** 前 8 个是要逐字列出的（交叉多的字）；后面的只进汇总。 */
const FOCUS = Array.from('木龍鬱藏擊月永我');
const CHARS = [...FOCUS, ...Array.from(env.SW_CHARS_SET ?? '十口人一大山日心空国書愛夢風雪花海光歌響麟あをきさカキ')];
const WEIGHTS = (env.SW_WEIGHTS || '400,600').split(',').map(Number);

interface Run { canon: FontCanon; res: StrokesGlyphResult }

/** 一批字 → 各自的结果（画不出墨的 null）。 */
const infer = async (job: StrokesJob, family: string, weight: number, chars: string[]): Promise<(Run | null)[]> => {
    const out: (Run | null)[] = chars.map(() => null);
    const items = chars.map((ch, i) => ({ i, canon: renderCanon(ch, family, weight) })).filter((x): x is { i: number; canon: FontCanon } => !!x.canon);
    for (let at = 0; at < items.length; at += 8) {
        const batch = items.slice(at, at + 8);
        const res = await job.run(batch.map(b => glyphFeatures(b.canon.img)), SERIAL_PACING);
        batch.forEach((b, k) => { out[b.i] = { canon: b.canon, res: res[k] }; });
    }
    return out;
};

/** 折线上弧长比例 f 处的点和值（values 和点一一对应，按弧长插值）。 */
const atFraction = (g: Glyph['strokes'][number], values: readonly number[] | undefined, f: number): [number, number, number] => {
    const s = f * g.len;
    let i = 1;
    while (i < g.pts.length - 1 && g.cum[i] < s) i += 1;
    const L = Math.max(1e-12, g.cum[i] - g.cum[i - 1]), k = Math.max(0, Math.min(1, (s - g.cum[i - 1]) / L));
    const a = g.pts[i - 1], b = g.pts[i];
    const v = values ? values[i - 1] + (values[i] - values[i - 1]) * k : NaN;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, v];
};

/** 两个字形逐点比（笔数相同时）：点距（网格像素）和笔宽倍数差。 */
const compare = (oldG: Glyph, newG: Glyph, pxPerEm: number, starved: readonly boolean[]) => {
    const dist: number[] = [], dw: number[] = [], dwEnd: number[] = [], dwMid: number[] = [], dwStarved: number[] = [], dwMatched: number[] = [];
    let matched = 0;
    oldG.strokes.forEach((st, k) => {
        const nt = newG.strokes[k];
        // 这一笔中线两边是否一致（每点都在 3 个网格像素内）：一致的笔，笔宽差只来自墨和归属
        const near = st.pts.every((p, j) => {
            const [x, y] = atFraction(nt, undefined, st.len > 0 ? st.cum[j] / st.len : 0);
            return Math.hypot(p[0] - x, p[1] - y) * pxPerEm < 3;
        });
        if (near) matched += 1;
        st.pts.forEach((p, j) => {
            const [x, y, w] = atFraction(nt, nt.pw, st.len > 0 ? st.cum[j] / st.len : 0);
            dist.push(Math.hypot(p[0] - x, p[1] - y) * pxPerEm);
            if (!st.pw || !nt.pw) return;
            const d = Math.abs(st.pw[j] - w);
            dw.push(d);
            if (near && !starved[k]) dwMatched.push(d);
            // 几乎没分到墨的笔（模型多出来的笔，几个像素定整笔的宽）、首尾两个点（半格、带笔锋、夹在中位数的 0.5..1.6 倍）单独看
            (starved[k] ? dwStarved : j <= 1 || j >= st.pts.length - 2 ? dwEnd : dwMid).push(d);
        });
    });
    return { dist, dw, dwEnd, dwMid, dwStarved, dwMatched, matched, penRel: Math.abs((oldG.penRel ?? NaN) - (newG.penRel ?? NaN)) };
};

const pct = (xs: number[], q: number) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};
/** 大数组的最大值（展开参数会爆栈）；空时 NaN。 */
const maxOf = (xs: readonly number[]) => (xs.length ? xs.reduce((m, v) => (v > m ? v : m), -Infinity) : NaN);
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '-');

const polyLen = (q: readonly (readonly number[])[]) => q.reduce((sum, v, i) => (i ? sum + Math.hypot(v[0] - q[i - 1][0], v[1] - q[i - 1][1]) : 0), 0);

/** 当前字重的墨里落在所有笔轮廓外面的像素（走「最近轮廓」兜底的那部分）和墨像素总数。 */
const uncoveredInk = (rec: FontStrokesGlyph, canon: FontCanon) => {
    const covered = new Uint8Array(CANON * CANON);
    for (const rings of rec.outlines) {
        fillRings(rings.map(r => Array.from(r, (v, i) => (v / EM_UNITS) * canon.a + (i % 2 ? canon.by : canon.bx))), CANON, i => { covered[i] = 1; });
    }
    let ink = 0, uncovered = 0;
    for (let i = 0; i < covered.length; i += 1) if (canon.img[i] > 0.1) { ink += 1; if (!covered[i]) uncovered += 1; }
    return { ink, uncovered };
};

export async function runPenWidthProbe(device: GPUDevice, config: PenWidthConfig, log: Log, report: Record<string, unknown>) {
    const job = await StrokesJob.create(device, new Uint8Array(fs.readFileSync(config.full6)), new Uint8Array(fs.readFileSync(config.own2)), config.f16);
    const rows: Record<string, string | number>[] = [];
    const summary: Record<string, string | number>[] = [];
    const lines: string[] = [];
    const buildMs: number[] = [], rasterMs: number[] = [];
    for (const font of FONTS) {
        for (const W of WEIGHTS) {
            const runs = await infer(job, font.family, W, CHARS);
            const records = runs.map(b => (b ? decodeFontStrokesGlyph(encodeFontStrokesGlyph(buildFontStrokesGlyph(b.res.owner, b.res.pens, { a: b.canon.a, bx: b.canon.bx, by: b.canon.by }))) : null));
            const all = { dist: [] as number[], dw: [] as number[], dwEnd: [] as number[], dwMid: [] as number[], dwStarved: [] as number[], dwMatched: [] as number[], matched: 0, starvedStrokes: 0, strokes: 0, uncovered: 0, ink: 0, buildMs: [] as number[], penRel: [] as number[], ownerMiss: 0, ownerInk: 0, alongPx: [] as number[], glyphs: 0, countDiff: 0, countDiffChars: [] as string[] };
            CHARS.forEach((ch, ci) => {
                const run = runs[ci], rec = records[ci];
                if (!run || !rec) return;
                const oldG = penGlyph(modelPolys(run.canon, run.res.pens), run.res.along, run.canon.img, run.canon.a);
                const t0 = performance.now();
                const canonW = renderCanon(ch, font.family, W);
                const t1 = performance.now();
                const newG = canonW ? buildFontStrokesNebbiaGlyph(rec, canonW) : null;
                const t2 = performance.now();
                rasterMs.push(t1 - t0);
                buildMs.push(t2 - t0);
                all.buildMs.push(t2 - t0);
                if (canonW) { const u = uncoveredInk(rec, canonW); all.uncovered += u.uncovered; all.ink += u.ink; }
                if (!oldG || !newG) return;
                all.glyphs += 1;
                // 像素级：同一次推理，还原的归属、书写位置和 own2 的比
                {
                    const polys = strokesPolys(rec);
                    const along = alongFromOutlines(polys, rec.outlines, EM_UNITS, run.canon.img, run.canon);
                    const lens = polys.map(polyLen);
                    const total = lens.reduce((x, y) => x + y, 0);
                    const oldPolys = modelPolys(run.canon, run.res.pens);
                    const oldLens = oldPolys.map(polyLen), oldTotal = oldLens.reduce((x, y) => x + y, 0);
                    // 书写位置落在哪一笔：同 penWidthProfile 的分法（笔首尾相接，正好落在下一笔起点的算下一笔），两边各按自己的笔长分
                    const strokeOf = (v: number, ls: number[], tot: number) => {
                        const u = (v / 65534) * tot;
                        let k = 0, acc = 0;
                        while (k < ls.length - 1 && acc + ls[k] <= u) { acc += ls[k]; k += 1; }
                        return { k, s: u - acc };
                    };
                    for (let i = 0; i < along.length; i += 1) {
                        if (along[i] === 65535 || run.res.along[i] === 65535) continue;
                        const o = strokeOf(run.res.along[i], oldLens, oldTotal), q = strokeOf(along[i], lens, total);
                        all.ownerInk += 1;
                        if (o.k !== q.k) all.ownerMiss += 1;
                        else all.alongPx.push(Math.abs(o.s - q.s) * run.canon.a);
                    }
                }
                const row: Record<string, string | number> = { font: font.label, W, ch, oldStrokes: oldG.strokes.length, newStrokes: newG.strokes.length };
                if (oldG.strokes.length !== newG.strokes.length) {
                    all.countDiff += 1;
                    all.countDiffChars.push(ch);
                    row.penRelDiff = Math.abs((oldG.penRel ?? NaN) - (newG.penRel ?? NaN));
                } else {
                    // 旧路径里每笔分到的墨（按 own2 的书写位置分笔）：平均不到 2 个像素宽的笔算「没分到墨」
                    const oldPolys = modelPolys(run.canon, run.res.pens);
                    const oldLens = oldPolys.map(polyLen);
                    const oldTotal = oldLens.reduce((x, y) => x + y, 0);
                    const inkOf = new Array<number>(oldPolys.length).fill(0);
                    for (let i = 0; i < run.res.along.length; i += 1) {
                        if (run.res.along[i] === 65535) continue;
                        const u = (run.res.along[i] / 65534) * oldTotal;
                        let k = 0, acc = 0;
                        while (k < oldLens.length - 1 && acc + oldLens[k] <= u) { acc += oldLens[k]; k += 1; }
                        inkOf[k] += run.canon.img[i];
                    }
                    const starved = oldPolys.map((q, k) => ({ k, keep: q.length > 1 && oldLens[k] > 0.005 })).filter(x => x.keep).map(({ k }) => inkOf[k] < 2 * oldLens[k] * run.canon.a);
                    all.strokes += starved.length;
                    all.starvedStrokes += starved.filter(Boolean).length;
                    const c = compare(oldG, newG, run.canon.a, starved);
                    for (const [to, from] of [[all.dist, c.dist], [all.dw, c.dw], [all.dwEnd, c.dwEnd], [all.dwMid, c.dwMid], [all.dwStarved, c.dwStarved], [all.dwMatched, c.dwMatched]] as const) for (const v of from) to.push(v);
                    all.penRel.push(c.penRel);
                    all.matched += c.matched;
                    Object.assign(row, { distMedian: pct(c.dist, 0.5), distMax: maxOf(c.dist), dwMedian: pct(c.dw, 0.5), dwMax: maxOf(c.dw), penRelDiff: c.penRel });
                }
                rows.push(row);
                if (FOCUS.includes(ch)) {
                    lines.push(`| ${font.label} | ${W} | ${ch} | ${row.oldStrokes}/${row.newStrokes} | ${f3(row.distMedian as number)} | ${f3(row.distMax as number)} | ${f3(row.dwMedian as number)} | ${f3(row.dwMax as number)} | ${f3(row.penRelDiff as number)} |`);
                }
            });
            const s = {
                font: font.label, W, glyphs: all.glyphs, strokeCountDiffers: all.countDiff, countDiffChars: all.countDiffChars.join(''),
                distMedian: pct(all.dist, 0.5), distP95: pct(all.dist, 0.95), distMax: maxOf(all.dist),
                dwMedian: pct(all.dw, 0.5), dwP95: pct(all.dw, 0.95), dwMax: maxOf(all.dw),
                dwMidP95: pct(all.dwMid, 0.95), dwMidMax: maxOf(all.dwMid), dwEndP95: pct(all.dwEnd, 0.95), dwEndMax: maxOf(all.dwEnd),
                matched: `${all.matched}/${all.strokes}`, dwMatchedMedian: pct(all.dwMatched, 0.5), dwMatchedP95: pct(all.dwMatched, 0.95), dwMatchedMax: maxOf(all.dwMatched),
                uncoveredPct: all.ink ? (100 * all.uncovered) / all.ink : NaN, buildMedian: pct(all.buildMs, 0.5), buildP95: pct(all.buildMs, 0.95),
                starved: `${all.starvedStrokes}/${all.strokes}`, dwStarvedMedian: pct(all.dwStarved, 0.5), dwStarvedMax: maxOf(all.dwStarved),
                ownerMissPct: all.ownerInk ? (100 * all.ownerMiss) / all.ownerInk : NaN, alongPxMedian: pct(all.alongPx, 0.5), alongPxP95: pct(all.alongPx, 0.95), alongPxMax: maxOf(all.alongPx),
                penRelMedian: pct(all.penRel, 0.5), penRelMax: maxOf(all.penRel),
            };
            summary.push(s);
            log(`[penwidth ${font.label} W=${W}] glyphs ${s.glyphs}, stroke count differs ${s.strokeCountDiffers} (${s.countDiffChars}); point px median ${f3(s.distMedian)} p95 ${f3(s.distP95)} max ${f3(s.distMax)}; width x median ${f3(s.dwMedian)} p95 ${f3(s.dwP95)} max ${f3(s.dwMax)}; interior width x p95 ${f3(s.dwMidP95)} max ${f3(s.dwMidMax)}, end points p95 ${f3(s.dwEndP95)} max ${f3(s.dwEndMax)}; starved strokes ${s.starved} width x median ${f3(s.dwStarvedMedian)} max ${f3(s.dwStarvedMax)}; centreline-matched strokes ${s.matched} width x median ${f3(s.dwMatchedMedian)} p95 ${f3(s.dwMatchedP95)} max ${f3(s.dwMatchedMax)}; ink outside every outline ${f3(s.uncoveredPct)}%; build median ${f3(s.buildMedian)} p95 ${f3(s.buildP95)} ms; penRel max ${f3(s.penRelMax)}`
                + `; pixel stroke (by along) differs from own2 ${f3(s.ownerMissPct)}% of ink, along |d| px median ${f3(s.alongPxMedian)} p95 ${f3(s.alongPxP95)} max ${f3(s.alongPxMax)}`);
        }
    }
    log(`[penwidth cost] new build per glyph (raster at W + outline along + profile): median ${f3(pct(buildMs, 0.5))} ms, p95 ${f3(pct(buildMs, 0.95))} ms, max ${f3(maxOf(buildMs))} ms; raster alone median ${f3(pct(rasterMs, 0.5))} ms`);
    const head = '| font | W | ch | strokes old/new | point px median | point px max | width x median | width x max | penRel diff |\n|---|---|---|---|---|---|---|---|---|';
    const text = [
        '## Summary', '', '| font | W | glyphs | stroke count differs | point px median | p95 | max | width x median | p95 | max | interior p95 / max | ends p95 / max | starved strokes, width x median / max | matched strokes, width x median / p95 / max | ink outside outlines % | build ms median / p95 | penRel max | stroke-by-along differs % | along px median / p95 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        ...summary.map(s => `| ${s.font} | ${s.W} | ${s.glyphs} | ${s.strokeCountDiffers} ${s.countDiffChars} | ${f3(s.distMedian as number)} | ${f3(s.distP95 as number)} | ${f3(s.distMax as number)} | ${f3(s.dwMedian as number)} | ${f3(s.dwP95 as number)} | ${f3(s.dwMax as number)} | ${f3(s.dwMidP95 as number)} / ${f3(s.dwMidMax as number)} | ${f3(s.dwEndP95 as number)} / ${f3(s.dwEndMax as number)} | ${s.starved}, ${f3(s.dwStarvedMedian as number)} / ${f3(s.dwStarvedMax as number)} | ${s.matched}, ${f3(s.dwMatchedMedian as number)} / ${f3(s.dwMatchedP95 as number)} / ${f3(s.dwMatchedMax as number)} | ${f3(s.uncoveredPct as number)} | ${f3(s.buildMedian as number)} / ${f3(s.buildP95 as number)} | ${f3(s.penRelMax as number)} | ${f3(s.ownerMissPct as number)} | ${f3(s.alongPxMedian as number)} / ${f3(s.alongPxP95 as number)} |`),
        '', `build median ${f3(pct(buildMs, 0.5))} ms p95 ${f3(pct(buildMs, 0.95))} ms (raster ${f3(pct(rasterMs, 0.5))} ms)`,
        '', '## Focus chars', '', head, ...lines,
    ].join('\n');
    (fs as unknown as { writeFileSync(p: string, d: string): void }).writeFileSync(path.join(config.out, 'penwidth.md'), text);
    report.penwidth = { summary, rows, buildMs: { median: pct(buildMs, 0.5), p95: pct(buildMs, 0.95) } };
    job.destroy();
}
