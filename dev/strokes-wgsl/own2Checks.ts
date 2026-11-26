/// <reference types="@webgpu/types" />
import { Full6Wgsl, type Full6Glyph } from '../../src/services/analysis/strokesWgsl/full6';
import { joinSegments } from '../../src/services/analysis/strokesWgsl/hostMath';
import { Own1Wgsl, type Own1Glyph } from '../../src/services/analysis/strokesWgsl/own1';
import { Own2Wgsl, type Own2Glyph, type Own2Result } from '../../src/services/analysis/strokesWgsl/own2';
import { avgPool2, own2Trajectory, pointTimes64, renderTrajectory } from '../../src/services/analysis/strokesWgsl/ownInput';
import { halfToFloat } from '../../src/services/analysis/strokesWgsl/packed';
import { fs } from './node';
import { cpuProject, projectionDiff } from './ownChecks';
import { glyphsOf, maxAbsDiff, type RefData } from './refData';

// dev/strokes-wgsl/own2Checks.ts
// own2 in the test shell: alignment against the torch reference of the 126 glyphs (scratchpad own2_ref.py's
// index.json + ref.bin: own2_argmax / own2_gap / own2_logits_sub and char 0's intermediates dbg_*), batch
// size invariance, the host raster against own_x23, the projection against the CPU; and the own1 / own2
// benchmark (interleaved rounds, medians), alone and end to end after full6.generate.

const PIX = 65536;
const S128 = 16384;

export interface Own2Config {
    f16: boolean; full6: string; own1: string; own2: string; own2ref: string; chars: number; paced: boolean;
    batches: number[]; own2Chunk: number; rounds: number;
}

interface OwnInput { pens: Float32Array[]; resampled: Float32Array }

/** The reference's joined pens (gen_ref) and resampled pens (own_pens) per character. */
const ownInputs = (ref: RefData, n: number): OwnInput[] => {
    const len = ref.i32('gen_ref_len');
    const segs = ref.f32('gen_ref_segs');
    const cont = ref.u8('gen_ref_cont');
    const npen = ref.i32('own_npen');
    const pensAll = ref.f32('own_pens');
    let segAt = 0;
    let penAt = 0;
    return Array.from({ length: n }, (_, i) => {
        const pens = joinSegments(segs.subarray(segAt * 32, (segAt + len[i]) * 32), cont.subarray(segAt, segAt + len[i]));
        segAt += len[i];
        if (pens.length !== npen[i]) throw new Error(`char ${i}: ${pens.length} joined pens, reference has ${npen[i]}`);
        const resampled = pensAll.subarray(penAt * 64, (penAt + pens.length) * 64);
        penAt += pens.length;
        return { pens, resampled };
    });
};

/** ownhead.py's F.interpolate(logits, 2, bilinear) of one pen's 128 x 128 logits, on the CPU. */
const upsample = (lg: Float32Array, out: Float32Array, at: number) => {
    const index = (dst: number) => {
        const src = Math.max(0.5 * (dst + 0.5) - 0.5, 0);
        const i0 = Math.floor(src);
        return [i0, i0 < 127 ? i0 + 1 : i0, src - i0];
    };
    for (let y = 0; y < 256; y += 1) {
        const [y0, y1, h1] = index(y);
        for (let x = 0; x < 256; x += 1) {
            const [x0, x1, w1] = index(x);
            out[at + y * 256 + x] = (1 - h1) * ((1 - w1) * lg[y0 * 128 + x0] + w1 * lg[y0 * 128 + x1]) + h1 * ((1 - w1) * lg[y1 * 128 + x0] + w1 * lg[y1 * 128 + x1]);
        }
    }
};

const floats = (raw: ArrayBuffer, half: boolean) => (half ? Float32Array.from(new Uint16Array(raw), halfToFloat) : new Float32Array(raw));

/** Char 0's intermediates (after its B = 1 run) against dbg_*: the taps, then own2's stages. */
const stageChecks = async (full6: Full6Wgsl, own2: Own2Wgsl, r2: RefData, P: number, half: boolean, log: (line: string) => void) => {
    const line: string[] = [];
    const cmp = (name: string, got: ArrayLike<number>, refName: string) => {
        const want = r2.f32(refName);
        line.push(`${name} ${maxAbsDiff(got, want).toExponential(2)} (|ref| ${maxAbsDiff(want, new Float32Array(want.length)).toFixed(1)})`);
    };
    cmp('s0 tap', floats(await full6.read('s0', 48 * S128 * (half ? 2 : 4)), half), 'dbg_z');
    const fm = floats(await full6.read('fmap', 4096 * 128 * (half ? 2 : 4)), half);
    const chw = new Float32Array(128 * 4096);
    for (let p = 0; p < 4096; p += 1) for (let c = 0; c < 128; c += 1) chw[c * 4096 + p] = fm[p * 128 + c];
    cmp('fmap', chw, 'dbg_f');
    const mem = new Float32Array(await full6.read('mem', 256 * 192 * 4));
    const kind = full6.taps?.kind0 ?? new Float32Array(192);
    cmp('g', mem.map((v, i) => v - kind[i % 192]), 'dbg_g');
    const f32 = async (name: string, count: number) => new Float32Array(await own2.read(name, count * 4));
    cmp('h128', await f32('H128', 32 * S128), 'dbg_h128');
    cmp('h64', await f32('H64', 96 * 4096), 'dbg_h64');
    cmp('h32', await f32('H32', 128 * 1024), 'dbg_h32');
    cmp('t', await f32('H16', 192 * 256), 'dbg_t');
    cmp('u32', await f32('N1', 128 * 1024), 'dbg_u32');
    cmp('u64', await f32('M1', 96 * 4096), 'dbg_u64');
    cmp('Fm', await f32('fm', 64 * S128), 'dbg_fm');
    cmp('qin', await f32('qin', P * 328), 'dbg_qin');
    cmp('q', await f32('qv', P * 64), 'dbg_q');
    cmp('lg128', await f32('lg', P * S128), 'dbg_lg128');
    log(`[own2 stages char 0] ${line.join(', ')}`);
};

/** Pixels where two runs of a glyph differ in pen, reveal or gap (bitwise). */
const resultDiff = (a: Own2Result, b: Own2Result): number => {
    let n = 0;
    for (let p = 0; p < PIX; p += 1) if (a.pen[p] !== b.pen[p] || !Object.is(a.reveal[p], b.reveal[p]) || !Object.is(a.gap[p], b.gap[p])) n += 1;
    return n;
};

export const runOwn2Align = async (device: GPUDevice, config: Own2Config, ref: RefData, r2: RefData, report: Record<string, unknown>, log: (line: string) => void): Promise<void> => {
    const n = Math.min(config.chars, 126);
    const glyphs = glyphsOf(ref, n);
    const inputs = ownInputs(ref, n);
    const img = ref.u8('img_u8');
    const x23 = ref.f32('own_x23');
    // Host raster (cv2 port + pool) against avg_pool2d(own_x23).
    let rasterDiff = 0;
    let rasterMs = 0;
    inputs.forEach(({ pens }, i) => {
        if (!pens.length) return;
        const started = performance.now();
        const traj = own2Trajectory(pens);
        rasterMs += performance.now() - started;
        const want = new Float32Array(2 * S128);
        for (let c = 0; c < 2; c += 1) avgPool2(x23.subarray((i * 2 + c) * PIX, (i * 2 + c + 1) * PIX), 256, want, c * S128);
        for (let p = 0; p < want.length; p += 1) if (!Object.is(traj[p], want[p])) rasterDiff += 1;
    });
    log(`[own2 raster] own2Trajectory vs avg_pool2d(own_x23): ${rasterDiff} values differ; ${(rasterMs / n).toFixed(2)} ms/char`);
    const argmax = r2.u8('own2_argmax');
    const gapRef = r2.f16('own2_gap');
    const lgSub = r2.f32('own2_logits_sub');
    const sub = new Set(ref.i32('sub_idx'));
    let baseline: Own2Result[] | null = null;
    const batchRows: Record<string, unknown>[] = [];
    for (const B of config.batches) {
        const full6 = await Full6Wgsl.create(device, new Uint8Array(fs.readFileSync(config.full6)), { f16: config.f16, capacity: B, chunk: Math.min(4, B), taps: true });
        const chunk = B % config.own2Chunk ? 1 : Math.min(config.own2Chunk, B);
        const own2 = await Own2Wgsl.create(device, new Uint8Array(fs.readFileSync(config.own2)), full6, { f16: config.f16, chunk });
        const results: Own2Result[] = [];
        const first = baseline === null;
        let lgAt = 0;
        let dlg = 0;
        for (let at = 0; at < n; at += B) {
            const batch = glyphs.slice(at, at + B);
            await full6.encode(batch);
            const own: Own2Glyph[] = inputs.slice(at, at + B).map(x => ({ pens: x.pens, resampled: x.resampled }));
            const out = await own2.run(own, { logits: first });
            if (first && at === 0) await stageChecks(full6, own2, r2, inputs[0].pens.length, config.f16, log);
            out.forEach((r, k) => {
                const i = at + k;
                if (r.logits128 && sub.has(i)) {
                    const P = inputs[i].pens.length;
                    const up = new Float32Array(P * PIX);
                    for (let q = 0; q < P; q += 1) upsample(r.logits128.subarray(q * S128, (q + 1) * S128), up, q * PIX);
                    dlg = Math.max(dlg, maxAbsDiff(up, lgSub.subarray(lgAt * PIX, (lgAt + P) * PIX)));
                    lgAt += P;
                }
                delete r.logits128;
            });
            results.push(...out);
        }
        if (first) {
            let ink = 0;
            let diff = 0;
            let inkBig = 0;
            let diffBig = 0;
            let gapMaxAtDiff = 0;
            let nonFinite = 0;
            const proj = { chars: 0, revealOver1e4: 0, revealOver001: 0, alongOver1e4: 0, revealMax: 0, alongMax: 0 };
            results.forEach((r, i) => {
                for (let p = 0; p < PIX; p += 1) if (!Number.isFinite(r.gap[p]) || !Number.isFinite(r.reveal[p]) || !Number.isFinite(r.along[p])) nonFinite += 1;
                const P = inputs[i].pens.length;
                if (!P) return;
                const inkAt = (p: number) => img[i * 3 * PIX + p] / 255 > 0.1;
                for (let p = 0; p < PIX; p += 1) {
                    if (!inkAt(p)) continue;
                    ink += 1;
                    const g = halfToFloat(gapRef[i * PIX + p]);
                    if (g > 0.05) inkBig += 1;
                    if (r.pen[p] !== argmax[i * PIX + p]) {
                        diff += 1;
                        if (g > 0.05) diffBig += 1;
                        gapMaxAtDiff = Math.max(gapMaxAtDiff, g);
                    }
                }
                if (i % 9 === 0) {
                    const cpu = cpuProject(inputs[i].pens, pointTimes64(inputs[i].pens), r.pen, inkAt);
                    const dr = projectionDiff(cpu.reveal, r.reveal);
                    proj.chars += 1;
                    proj.revealOver1e4 += dr.over1e4;
                    proj.revealOver001 += dr.over001;
                    proj.revealMax = Math.max(proj.revealMax, dr.max);
                    const da = projectionDiff(cpu.along, r.along);
                    proj.alongOver1e4 += da.over1e4;
                    proj.alongMax = Math.max(proj.alongMax, da.max);
                }
            });
            const result = {
                B, chunk, logits256Max: dlg, inkDiff: `${diff}/${ink}`, inkDiffPct: (100 * diff) / Math.max(ink, 1), diffWithGapOver005: `${diffBig}/${inkBig}`, gapMaxAtDiff,
                nonFinite, rasterDiff, projection: proj,
            };
            log(`[own2 B=${B} chunk ${chunk}] 256^2 logits (sub chars) max diff ${dlg.toExponential(3)}; ink owners differ ${diff}/${ink} = ${result.inkDiffPct.toFixed(4)}%, of gap > 0.05 ${diffBig}/${inkBig}, max torch gap at a difference ${gapMaxAtDiff.toFixed(3)}; non-finite ${nonFinite}; `
                + `projection vs CPU over ${proj.chars} chars: reveal > 1e-4 ${proj.revealOver1e4} px (> 0.01 ${proj.revealOver001}, max ${proj.revealMax.toExponential(2)}), along > 1e-4 ${proj.alongOver1e4} px (max ${proj.alongMax.toExponential(2)})`);
            report.own2 = result;
            baseline = results;
        } else {
            const base: Own2Result[] = baseline ?? [];
            let px = 0;
            let chars = 0;
            results.forEach((r, i) => { const d = resultDiff(r, base[i]); px += d; if (d) chars += 1; });
            batchRows.push({ B, chunk, charsDifferent: chars, pixelsDifferent: px });
            log(`[own2 B=${B} chunk ${chunk}] vs the first batch size: ${chars} chars / ${px} pixels differ (pen, reveal or gap, bitwise)`);
        }
        own2.destroy();
        full6.destroy();
    }
    report.own2Batches = batchRows;
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

/** own1's input: img channels 0, 1 and the trajectory raster (host). */
const own1Glyph = (glyph: Full6Glyph, pens: Float32Array[]): Own1Glyph => {
    const x = new Float32Array(4 * PIX);
    x.set(glyph.img.subarray(0, 2 * PIX));
    if (pens.length) {
        const { time, presence } = renderTrajectory(pens);
        x.set(time, 2 * PIX);
        x.set(presence, 3 * PIX);
    }
    return { x, pens };
};

/**
 * own1 vs own2 ms/char per batch size, rounds alternating which goes first; each own run includes its host
 * raster, uploads and readbacks (own2's full6.encode of the batch is outside its time). Then end to end:
 * full6.generate (no reference) + join + own (own1 with its raster) per batch, the same alternation.
 */
export const runOwnBench = async (device: GPUDevice, config: Own2Config, ref: RefData, report: Record<string, unknown>, log: (line: string) => void): Promise<void> => {
    const count = 128;
    const all = glyphsOf(ref, 126);
    const inputsAll = ownInputs(ref, 126);
    const glyphs = Array.from({ length: count }, (_, i) => all[i % 126]);
    const inputs = Array.from({ length: count }, (_, i) => inputsAll[i % 126]);
    const pacing = config.paced ? { sliceMs: 2, inFlight: 1 } : undefined;
    const rows: unknown[] = [];
    for (const B of config.batches) {
        const full6 = await Full6Wgsl.create(device, new Uint8Array(fs.readFileSync(config.full6)), { f16: config.f16, capacity: B, chunk: Math.min(4, B), taps: true });
        const chunk = B % config.own2Chunk ? 1 : Math.min(config.own2Chunk, B);
        const own2 = await Own2Wgsl.create(device, new Uint8Array(fs.readFileSync(config.own2)), full6, { f16: config.f16, chunk });
        const own1 = await Own1Wgsl.create(device, new Uint8Array(fs.readFileSync(config.own1)), { f16: config.f16, chunk: 1 });
        const batches = Array.from({ length: Math.ceil(count / B) }, (_, k) => [k * B, Math.min(count, (k + 1) * B)]);
        const runOwn2 = async () => {
            let ms = 0;
            for (const [a, b] of batches) {
                await full6.encode(glyphs.slice(a, b));
                const started = performance.now();
                await own2.run(inputs.slice(a, b), { pacing });
                ms += performance.now() - started;
            }
            return ms / count;
        };
        const runOwn1 = async () => {
            let ms = 0;
            for (const [a, b] of batches) {
                const started = performance.now();
                await own1.run(glyphs.slice(a, b).map((g, k) => own1Glyph(g, inputs[a + k].pens)), { pacing });
                ms += performance.now() - started;
            }
            return ms / count;
        };
        const e2e = async (which: 1 | 2) => {
            let ms = 0;
            for (const [a, b] of batches) {
                const batch = glyphs.slice(a, b);
                const started = performance.now();
                const gen = await full6.generate(batch, { useReference: false, pacing });
                const pens = gen.map(r => joinSegments(r.segs, r.cont));
                if (which === 2) await own2.run(pens.map(p => ({ pens: p })), { pacing });
                else await own1.run(batch.map((g, k) => own1Glyph(g, pens[k])), { pacing });
                ms += performance.now() - started;
            }
            return ms / count;
        };
        // Warm serially (cold first dispatches stay out of the cost tables), then once paced (profiles).
        await full6.encode(glyphs.slice(0, B));
        await own2.run(inputs.slice(0, B));
        await own1.run([own1Glyph(glyphs[0], inputs[0].pens)]);
        await full6.generate(glyphs.slice(0, B), { useReference: false });
        if (pacing) {
            await full6.encode(glyphs.slice(0, B));
            await own2.run(inputs.slice(0, B), { pacing });
            await own1.run([own1Glyph(glyphs[0], inputs[0].pens)], { pacing });
            await full6.generate(glyphs.slice(0, B), { useReference: false, pacing });
        }
        const t1: number[] = [];
        const t2: number[] = [];
        for (let r = 0; r < config.rounds; r += 1) {
            if (r % 2) { t1.push(await runOwn1()); t2.push(await runOwn2()); } else { t2.push(await runOwn2()); t1.push(await runOwn1()); }
        }
        const e1: number[] = [];
        const e2: number[] = [];
        const e2eRounds = Math.max(3, Math.ceil(config.rounds / 2));
        for (let r = 0; r < e2eRounds; r += 1) {
            if (r % 2) { e1.push(await e2e(1)); e2.push(await e2e(2)); } else { e2.push(await e2e(2)); e1.push(await e2e(1)); }
        }
        const longest = (table: ReadonlyMap<string, number>) => {
            const top = [...table.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined;
            return top ? `${top[0]} ${top[1].toFixed(3)}` : '-';
        };
        const row = {
            B, own2Chunk: chunk, own1: median(t1), own2: median(t2), own1Rounds: t1, own2Rounds: t2, e2eOwn1: median(e1), e2eOwn2: median(e2), e2eOwn1Rounds: e1, e2eOwn2Rounds: e2,
            longestOwn2: longest(own2.costTable), longestOwn1: longest(own1.costTable), longestFull6: longest(full6.costTable), own2MB: own2.bytes / 2 ** 20, full6MB: full6.bytes / 2 ** 20,
        };
        rows.push(row);
        log(`[own bench B=${B}${pacing ? ' paced' : ''}] ms/char median of ${config.rounds}: own1 ${row.own1.toFixed(2)} own2 ${row.own2.toFixed(2)} (own2 chunk ${chunk}); `
            + `end to end (full6.generate + own, median of ${e2eRounds}): +own1 ${row.e2eOwn1.toFixed(2)} +own2 ${row.e2eOwn2.toFixed(2)}; `
            + `longest dispatch own2 ${row.longestOwn2}, own1 ${row.longestOwn1}, full6 ${row.longestFull6}; GPU own2 ${row.own2MB.toFixed(0)} MB, full6 ${row.full6MB.toFixed(0)} MB`);
        own1.destroy();
        own2.destroy();
        full6.destroy();
    }
    report.ownBench = rows;
};
