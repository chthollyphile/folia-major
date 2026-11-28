/// <reference types="@webgpu/types" />
import { buildFontStrokesGlyph, EM_UNITS, type FontStrokesGlyph, type OutlineGrid } from '../../src/services/fontStrokes/fontStrokesOutline';
import { encodeFontStrokesGlyph } from '../../src/services/fontStrokes/fontStrokesCodec';
import { glyphFeatures, renderCanon, renderInkAt } from '../../src/services/fontStrokes/fontStrokesRaster';
import { SERIAL_PACING } from '../../src/services/analysis/gpuSlices';
import { StrokesJob, type StrokesGlyphResult } from '../../src/services/analysis/strokesWgsl/strokesJob';
import { fs, path } from './node';

// dev/strokes-wgsl/outlineProbe.ts
// 阶段 0 验证（SW_TASK=outline）：按字重 400 算出的笔画轮廓，能不能盖住同一字体 200 / 800 字重（和 Chromium 合成粗体）的墨。
// 每个字体 × 字符：400 跑 full6 + own2 → buildFontStrokesGlyph（几种延伸半径）→ 把轮廓栅格化回 256² → 量：
//   未盖住的墨比例（各字重的墨按 400 的网格画）、该字重自己 own2 的归属和 400 轮廓区域不一致的墨比例（按最大重叠配对笔画）。
// 并在 SW_SHEET_R 的半径下出对比图（每字一行：400 / 200 / 800 的墨 + 轮廓分笔上色，未盖住的墨标红）。

type Log = (line: string) => void;
export interface ProbeConfig { out: string; full6: string; own2: string; f16: boolean }

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SIDE = 256;
const FONTS: { family: string; label: string; weights: number[] }[] = (env.SW_FONTS ? JSON.parse(env.SW_FONTS) as { family: string; label: string; weights: number[] }[] : [
    { family: 'PingFang SC', label: 'PingFang SC', weights: [200, 800] },
    { family: 'Hiragino Sans', label: 'Hiragino Sans', weights: [200, 800] },
    { family: 'Songti SC', label: 'Songti SC', weights: [200, 800] },
    { family: 'STKaiti', label: 'STKaiti(单字重,合成粗体)', weights: [200, 800] },
]);
const CHARS = Array.from(env.SW_CHARS_SET || '十口人永一大山日月木鬱藏擊鑿龍響麟愛夢風雪花海光歌心空国書あをヴきさそんカキ');
const RADII = (env.SW_RADII || '0,0.01,0.02,0.03,0.04,0.05,0.06').split(',').map(Number);
const SHEET_R = (env.SW_SHEET_R || '0.03').split(',').map(Number);
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#008080', '#9a6324', '#800000', '#808000', '#000075', '#e6beff'];

/** 一个字在 400 的结果 + 在别的字重自己的结果（own2 归属）。 */
interface Run { canon: NonNullable<ReturnType<typeof renderCanon>>; res: StrokesGlyphResult }

/** 一批字（≤8）→ 各自的笔画结果；画不出墨的字 null。 */
const infer = async (job: StrokesJob, family: string, weight: number, chars: string[]): Promise<(Run | null)[]> => {
    const out: (Run | null)[] = chars.map(() => null);
    const items = chars.map((ch, i) => ({ i, canon: renderCanon(ch, family, weight) })).filter((x): x is { i: number; canon: NonNullable<ReturnType<typeof renderCanon>> } => !!x.canon);
    for (let at = 0; at < items.length; at += 8) {
        const batch = items.slice(at, at + 8);
        const res = await job.run(batch.map(b => glyphFeatures(b.canon.img)), SERIAL_PACING);
        batch.forEach((b, k) => { out[b.i] = { canon: b.canon, res: res[k] }; });
    }
    return out;
};

/** 轮廓栅格化回 256²：每像素 -1 或盖住它的笔下标（后画的覆盖前面的；覆盖与否只看有没有）。 */
const rasterRegions = (glyph: FontStrokesGlyph, grid: OutlineGrid, ctxOf: CanvasRenderingContext2D): Int8Array => {
    const region = new Int8Array(SIDE * SIDE).fill(-1);
    glyph.outlines.forEach((rings, k) => {
        ctxOf.setTransform(1, 0, 0, 1, 0, 0);
        ctxOf.clearRect(0, 0, SIDE, SIDE);
        ctxOf.fillStyle = '#000';
        const p = new Path2D();
        for (const r of rings) {
            for (let i = 0; i < r.length; i += 2) {
                const x = (r[i] / EM_UNITS) * grid.a + grid.bx, y = (r[i + 1] / EM_UNITS) * grid.a + grid.by;
                if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
            }
            p.closePath();
        }
        ctxOf.fill(p, 'nonzero');
        const d = ctxOf.getImageData(0, 0, SIDE, SIDE).data;
        for (let i = 0; i < region.length; i += 1) if (d[i * 4 + 3] >= 128) region[i] = k;
    });
    return region;
};

/** 别的字重 own2 的归属换到 400 的网格：像素 → em → 那个字重的网格。 */
const ownerIn400Frame = (c400: Run['canon'], cW: Run['canon'], ownerW: Int8Array): Int8Array => {
    const out = new Int8Array(SIDE * SIDE).fill(-1);
    for (let y = 0; y < SIDE; y += 1) for (let x = 0; x < SIDE; x += 1) {
        const ex = (x + 0.5 - c400.bx) / c400.a, ey = (y + 0.5 - c400.by) / c400.a;
        const px = Math.floor(ex * cW.a + cW.bx), py = Math.floor(ey * cW.a + cW.by);
        if (px >= 0 && py >= 0 && px < SIDE && py < SIDE) out[y * SIDE + x] = ownerW[py * SIDE + px];
    }
    return out;
};

interface Stat { ink: number; uncovered: number; checked: number; mismatchBest: number; mismatchIndex: number; countEq: number; glyphs: number; checkedEq: number; mismatchEq: number }
const newStat = (): Stat => ({ ink: 0, uncovered: 0, checked: 0, mismatchBest: 0, mismatchIndex: 0, countEq: 0, glyphs: 0, checkedEq: 0, mismatchEq: 0 });

export async function runOutlineProbe(device: GPUDevice, config: ProbeConfig, log: Log, report: Record<string, unknown>) {
    const job = await StrokesJob.create(device, new Uint8Array(fs.readFileSync(config.full6)), new Uint8Array(fs.readFileSync(config.own2)), config.f16);
    const work = document.createElement('canvas');
    work.width = work.height = SIDE;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    if (!wctx) throw new Error('no 2d context');
    const sheetDir = path.join(config.out, 'sheets');
    try { (fs as unknown as { mkdirSync(p: string, o: unknown): void }).mkdirSync(sheetDir, { recursive: true }); } catch { /* 已存在 */ }
    const table: Record<string, Record<string, Stat>> = {};
    const sizes: { font: string; glyphs: number; pensRaw: number; outlineRaw: number; brushRaw: number }[] = [];
    const outlinesForSize: { font: string; ch: string; glyph: FontStrokesGlyph }[] = [];

    for (const font of FONTS) {
        const t0 = performance.now();
        const base: (Run | null)[] = [];
        for (let at = 0; at < CHARS.length; at += 8) base.push(...await infer(job, font.family, 400, CHARS.slice(at, at + 8)));
        const byWeight = new Map<number, (Run | null)[]>();
        for (const w of font.weights) {
            const rs: (Run | null)[] = [];
            for (let at = 0; at < CHARS.length; at += 8) rs.push(...await infer(job, font.family, w, CHARS.slice(at, at + 8)));
            byWeight.set(w, rs);
        }
        // 这个字体的字重真的有变化吗（墨面积）
        const area = (img: Float32Array) => { let s = 0; for (let i = 0; i < img.length; i += 1) if (img[i] > 0.5) s += 1; return s; };
        const ratio = (w: number) => {
            let sum = 0, n = 0;
            CHARS.forEach((ch, i) => {
                const b = base[i];
                if (!b) return;
                const img = renderInkAt(ch, font.family, w, b.canon);
                if (img) { sum += area(img) / Math.max(1, area(b.canon.img)); n += 1; }
            });
            return n ? sum / n : 0;
        };
        log(`[font ${font.label}] inked ${base.filter(Boolean).length}/${CHARS.length}; mean ink area vs 400: ${font.weights.map(w => `${w}=${ratio(w).toFixed(2)}`).join(' ')} (${Math.round(performance.now() - t0)} ms)`);

        for (const R of RADII) {
            const stats: Record<string, Stat> = { 400: newStat() };
            for (const w of font.weights) stats[w] = newStat();
            for (let ci = 0; ci < CHARS.length; ci += 1) {
                const b = base[ci];
                if (!b) continue;
                const grid = { a: b.canon.a, bx: b.canon.bx, by: b.canon.by };
                const glyph = buildFontStrokesGlyph(b.res.owner, b.res.pens, grid, { extendEm: R });
                const regions = rasterRegions(glyph, grid, wctx);
                if (R === SHEET_R[0]) outlinesForSize.push({ font: font.label, ch: CHARS[ci], glyph });
                const weights = [400, ...font.weights];
                for (const w of weights) {
                    const st = stats[w];
                    const ink = w === 400 ? b.canon.img : renderInkAt(CHARS[ci], font.family, w, b.canon);
                    if (!ink) continue;
                    const other = w === 400 ? b : byWeight.get(w)?.[ci];
                    const ownerW = other ? ownerIn400Frame(b.canon, other.canon, other.res.owner) : null;
                    const confusion = new Map<number, Map<number, number>>();
                    st.glyphs += 1;
                    let uncovered = 0, inkN = 0, checked = 0, byIndex = 0;
                    for (let i = 0; i < ink.length; i += 1) {
                        if (ink[i] <= 0.5) continue;
                        inkN += 1;
                        if (regions[i] < 0) { uncovered += 1; continue; }
                        const j = ownerW ? ownerW[i] : -1;
                        if (j < 0) continue;
                        checked += 1;
                        if (regions[i] !== j) byIndex += 1;
                        const row = confusion.get(j) ?? new Map<number, number>();
                        row.set(regions[i], (row.get(regions[i]) ?? 0) + 1);
                        confusion.set(j, row);
                    }
                    let bestMis = 0;
                    for (const row of confusion.values()) { let tot = 0, mx = 0; for (const v of row.values()) { tot += v; mx = Math.max(mx, v); } bestMis += tot - mx; }
                    st.ink += inkN; st.uncovered += uncovered; st.checked += checked; st.mismatchBest += bestMis; st.mismatchIndex += byIndex;
                    if (other && other.res.pens.length === b.res.pens.length) { st.countEq += 1; st.checkedEq += checked; st.mismatchEq += byIndex; }
                }
            }
            table[`${font.label} R=${R}`] = stats;
            const pct = (a: number, b2: number) => (b2 ? (100 * a / b2).toFixed(3) : '-');
            log(`[outline ${font.label} R=${R}] ` + Object.entries(stats).map(([w, s]) => `w${w}: uncovered ${pct(s.uncovered, s.ink)}%, region mismatch(best) ${pct(s.mismatchBest, s.checked)}% (index ${pct(s.mismatchIndex, s.checked)}%; index among same-count glyphs ${pct(s.mismatchEq, s.checkedEq)}%), same stroke count ${s.countEq}/${s.glyphs}`).join(' | '));
        }

        // 对比图：SHEET_R 每个半径一组，每张 10 个字，一行 = 400 / 各字重
        for (const R of SHEET_R) {
            const perSheet = 8;
            for (let from = 0; from < CHARS.length; from += perSheet) {
                const weights = [400, ...font.weights];
                const cell = SIDE;
                const sheet = document.createElement('canvas');
                sheet.width = cell * weights.length;
                sheet.height = cell * Math.min(perSheet, CHARS.length - from);
                const sc = sheet.getContext('2d');
                if (!sc) continue;
                sc.fillStyle = '#fff';
                sc.fillRect(0, 0, sheet.width, sheet.height);
                for (let ci = from; ci < Math.min(CHARS.length, from + perSheet); ci += 1) {
                    const b = base[ci];
                    if (!b) continue;
                    const grid = { a: b.canon.a, bx: b.canon.bx, by: b.canon.by };
                    const glyph = buildFontStrokesGlyph(b.res.owner, b.res.pens, grid, { extendEm: R });
                    const regions = rasterRegions(glyph, grid, wctx);
                    weights.forEach((w, wi) => {
                        const ink = w === 400 ? b.canon.img : renderInkAt(CHARS[ci], font.family, w, b.canon);
                        if (!ink) return;
                        const ox = wi * cell, oy = (ci - from) * cell;
                        const id = sc.getImageData(ox, oy, cell, cell);
                        for (let i = 0; i < ink.length; i += 1) {
                            let r = 255, g = 255, bl = 255;
                            const k = regions[i];
                            if (k >= 0) { const c = PALETTE[k % PALETTE.length]; r = 0.35 * parseInt(c.slice(1, 3), 16) + 0.65 * 255; g = 0.35 * parseInt(c.slice(3, 5), 16) + 0.65 * 255; bl = 0.35 * parseInt(c.slice(5, 7), 16) + 0.65 * 255; }
                            if (ink[i] > 0.5) { if (k >= 0) { r *= 0.45; g *= 0.45; bl *= 0.45; } else { r = 255; g = 0; bl = 0; } }
                            id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = bl; id.data[i * 4 + 3] = 255;
                        }
                        sc.putImageData(id, ox, oy);
                        sc.strokeStyle = '#000';
                        sc.lineWidth = 0.6;
                        sc.setTransform(1, 0, 0, 1, ox, oy);
                        glyph.outlines.forEach(rings => rings.forEach(r => {
                            sc.beginPath();
                            for (let i = 0; i < r.length; i += 2) { const x = (r[i] / EM_UNITS) * grid.a + grid.bx, y = (r[i + 1] / EM_UNITS) * grid.a + grid.by; if (i === 0) sc.moveTo(x, y); else sc.lineTo(x, y); }
                            sc.closePath();
                            sc.stroke();
                        }));
                        sc.setTransform(1, 0, 0, 1, 0, 0);
                        sc.fillStyle = '#000';
                        sc.font = '12px sans-serif';
                        sc.fillText(`${CHARS[ci]} w${w}`, ox + 4, oy + 14);
                    });
                }
                const name = `${font.family.replace(/\W+/g, '_')}_R${R}_${from / perSheet}.png`;
                const data = sheet.toDataURL('image/png').split(',')[1];
                (fs as unknown as { writeFileSync(p: string, d: string, e: string): void }).writeFileSync(path.join(sheetDir, name), data, 'base64');
            }
        }
    }

    // 存储大小：SHEET_R[0] 的轮廓，原始字节（Int16 / Uint8 数组）
    const perFont = new Map<string, { coded: number; glyphs: number; pens: number; outline: number; brush: number; rings: number; points: number }>();
    for (const e of outlinesForSize) {
        const s = perFont.get(e.font) ?? { coded: 0, glyphs: 0, pens: 0, outline: 0, brush: 0, rings: 0, points: 0 };
        s.glyphs += 1;
        s.coded += encodeFontStrokesGlyph(e.glyph).length;
        s.pens += e.glyph.pens.reduce((x, p) => x + p.byteLength, 0);
        s.outline += e.glyph.outlines.reduce((x, rs) => x + rs.reduce((y, r) => y + r.byteLength, 0), 0);
        s.brush += e.glyph.brush.byteLength;
        s.rings += e.glyph.outlines.reduce((x, rs) => x + rs.length, 0);
        s.points += e.glyph.outlines.reduce((x, rs) => x + rs.reduce((y, r) => y + r.length / 2, 0), 0);
        perFont.set(e.font, s);
    }
    for (const [font, s] of perFont) {
        log(`[size ${font}] per glyph raw: pens ${(s.pens / s.glyphs).toFixed(0)} B, outlines ${(s.outline / s.glyphs).toFixed(0)} B (${(s.rings / s.glyphs).toFixed(1)} rings, ${(s.points / s.glyphs).toFixed(0)} pts), brush ${(s.brush / s.glyphs).toFixed(0)} B; after codec ${(s.coded / s.glyphs).toFixed(0)} B`);
        sizes.push({ font, glyphs: s.glyphs, pensRaw: s.pens / s.glyphs, outlineRaw: s.outline / s.glyphs, brushRaw: s.brush / s.glyphs });
    }
    // 存下每个字的记录，codec 做完后量压缩后的大小
    (fs as unknown as { writeFileSync(p: string, d: string): void }).writeFileSync(path.join(config.out, 'glyph-records.json'), JSON.stringify(outlinesForSize.map(e => ({
        font: e.font, ch: e.ch, pens: e.glyph.pens.map(p => Array.from(p)), outlines: e.glyph.outlines.map(rs => rs.map(r => Array.from(r))), brush: Array.from(e.glyph.brush),
    }))));
    report.outline = { table, sizes };
    job.destroy();
}
