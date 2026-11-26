/// <reference types="@webgpu/types" />
import { Full6Wgsl, type Full6Glyph } from '../../src/services/analysis/strokesWgsl/full6';
import { halfToFloat } from '../../src/services/analysis/strokesWgsl/packed';
import { REC } from '../../src/services/analysis/strokesWgsl/kernelsSeq';
import { runOwnChecks } from './ownChecks';
import { RefData, maxAbsDiff, percentile } from './refData';

// dev/strokes-wgsl/harness.ts
// Renderer side of the test shell (see main.cjs): opens a WebGPU device (shader-f16 / timestamp-query when
// the adapter has them, the adapter's buffer limits), loads full6 / own1 by path and runs SW_TASK against
// the torch reference data, printing the figures HANDOFF_FOLIA.md §4 and ~/bihua tools/mnn main.cpp report.

const nodeRequire = (globalThis as unknown as { require: (id: string) => any }).require;
const { ipcRenderer } = nodeRequire('electron');
const fs = nodeRequire('fs');
const path = nodeRequire('path');

const log = (line: string) => ipcRenderer.send('sw-log', line);
const fmt = (v: number) => v.toExponential(3);

export interface Config {
    out: string; task: string; f16: boolean; full6: string; own1: string; ref: string;
    batches: number[]; chars: number; paced: boolean; readEvery: number; modes: string[];
}

/** The reference's glyphs as runtime inputs. */
const glyphsOf = (ref: RefData, count: number): Full6Glyph[] => {
    const img = ref.u8('img_u8');
    const q = ref.f32('ref_q');
    const m = ref.u8('ref_m');
    return Array.from({ length: count }, (_, i) => ({
        img: Float32Array.from(img.subarray(i * 3 * 65536, (i + 1) * 3 * 65536), v => Math.fround(v / 255)),
        refQ: q.subarray(i * 40 * 32, (i + 1) * 40 * 32),
        refM: m.subarray(i * 40, (i + 1) * 40),
    }));
};

/** Ragged gen_{tag}_segs / _cont split per character. */
const generated = (ref: RefData, tag: string) => {
    const len = ref.i32(`gen_${tag}_len`);
    const segs = ref.f32(`gen_${tag}_segs`);
    const cont = ref.u8(`gen_${tag}_cont`);
    let at = 0;
    return Array.from(len, (n) => {
        const out = { segs: segs.subarray(at * 32, (at + n) * 32), cont: cont.subarray(at, at + n) };
        at += n;
        return out;
    });
};

async function stages(device: GPUDevice, config: Config, ref: RefData) {
    const full6 = await Full6Wgsl.create(device, new Uint8Array(fs.readFileSync(config.full6)), { f16: config.f16, capacity: 8, chunk: 8 });
    const glyphs = glyphsOf(ref, 1);
    const gen = generated(ref, 'ref');
    const half = config.f16;
    // Encoder + memory only (no steps), then one teacher-forced step at a time to read the intermediates.
    for (const steps of [1, 2, 3]) {
        const recs = await full6.teacherForce(glyphs, [gen[0]], [steps]);
        if (steps === 1) {
            const fmapBytes = 4096 * 128 * (half ? 2 : 4);
            const raw = await full6.read('fmap', fmapBytes);
            const fm = half ? Float32Array.from(new Uint16Array(raw), halfToFloat) : new Float32Array(raw);
            const refFm = ref.f32('fmap_sub').subarray(0, 128 * 4096);
            const chw = new Float32Array(128 * 4096);
            for (let p = 0; p < 4096; p += 1) for (let c = 0; c < 128; c += 1) chw[c * 4096 + p] = fm[p * 128 + c];
            log(`fmap: max diff ${fmt(maxAbsDiff(chw, refFm))} (ref max ${fmt(maxAbsDiff(refFm, new Float32Array(refFm.length)))})`);
            const mem = new Float32Array(await full6.read('mem', 296 * 192 * 4));
            const refMem = ref.f32('mem').subarray(0, 272 * 192);
            log(`mem: image tokens ${fmt(maxAbsDiff(mem.subarray(0, 256 * 192), refMem.subarray(0, 256 * 192)))}, reference tokens ${fmt(maxAbsDiff(mem.subarray(256 * 192, 272 * 192), refMem.subarray(256 * 192)))}`);
        }
        const t = steps - 1;
        const x = new Float32Array(await full6.read('X', 192 * 4));
        const qt = new Float32Array(await full6.read('QT', 16 * 192 * 4));
        const rec = recs[0].rec.subarray(t * REC, (t + 1) * REC);
        log(`t${t}: dec5 ${fmt(maxAbsDiff(x, ref.f32(`dbg_t${t}_dec5`)))}, coarse ${fmt(maxAbsDiff(rec.subarray(32, 64), ref.f32(`dbg_t${t}_coarse`)))}, `
            + `ref2 q ${fmt(maxAbsDiff(qt, ref.f32(`dbg_t${t}_ref2_q`)))}, pos ${fmt(maxAbsDiff(rec.subarray(0, 32), ref.f32(`dbg_t${t}_ref2_pos`)))}, `
            + `lc ${rec[64].toFixed(4)} (${ref.f32(`dbg_t${t}_lc`)[0].toFixed(4)}), le ${rec[65].toFixed(4)} (${ref.f32(`dbg_t${t}_le`)[0].toFixed(4)})`);
    }
    full6.destroy();
}

/** Teacher-forced and free generation against the reference, as tools/mnn main.cpp checkFull6. */
async function alignFull6(device: GPUDevice, config: Config, ref: RefData, report: Record<string, unknown>) {
    const n = Math.min(config.chars, 126);
    const full6 = await Full6Wgsl.create(device, new Uint8Array(fs.readFileSync(config.full6)), { f16: config.f16, capacity: n, chunk: 8 });
    const glyphs = glyphsOf(ref, n);
    for (const tag of config.modes) {
        const useReference = tag === 'ref';
        const gen = generated(ref, tag);
        const steps = Array.from(ref.i32(`tf_${tag}_steps`).subarray(0, n));
        const tpos = ref.f32(`tf_${tag}_pos`);
        const tco = ref.f32(`tf_${tag}_coarse`);
        const tlc = ref.f32(`tf_${tag}_lc`);
        const tle = ref.f32(`tf_${tag}_le`);
        const recs = await full6.teacherForce(glyphs, gen.slice(0, n), steps, { useReference, readEvery: config.readEvery });
        let k = 0;
        let dp = 0;
        let dc = 0;
        let dl = 0;
        let flipC = 0;
        let flipE = 0;
        let nC = 0;
        let nE = 0;
        let nonFinite = 0;
        const stepDp: number[] = [];
        recs.forEach((r) => {
            for (let t = 0; t < r.steps; t += 1, k += 1) {
                const rec = r.rec.subarray(t * REC, (t + 1) * REC);
                for (const v of rec) if (!Number.isFinite(v)) nonFinite += 1;
                const d = maxAbsDiff(rec.subarray(0, 32), tpos.subarray(k * 32, k * 32 + 32));
                dp = Math.max(dp, d);
                stepDp.push(d);
                dc = Math.max(dc, maxAbsDiff(rec.subarray(32, 64), tco.subarray(k * 32, k * 32 + 32)));
                dl = Math.max(dl, Math.abs(rec[64] - tlc[k]), Math.abs(rec[65] - tle[k]));
                if (t > 0) { nC += 1; if ((rec[64] > 0) !== (tlc[k] > 0)) flipC += 1; }
                nE += 1;
                if ((rec[65] > 0) !== (tle[k] > 0)) flipE += 1;
            }
        });
        const tf = {
            steps: k, posMax: dp, posMedian: percentile(stepDp, 0.5), posP99: percentile(stepDp, 0.99), coarseMax: dc, logitMax: dl,
            contFlips: `${flipC}/${nC}`, endFlips: `${flipE}/${nE}`, nonFinite, ms: full6.lastStats,
        };
        log(`[teacher-forced ${tag}] ${k} steps: pos max ${fmt(dp)} (per-step median ${fmt(tf.posMedian)}, p99 ${fmt(tf.posP99)}), coarse ${fmt(dc)}, logits ${fmt(dl)}; flips cont ${tf.contFlips} end ${tf.endFlips}; non-finite ${nonFinite}`);
        const out = await full6.generate(glyphs, { useReference, readEvery: config.readEvery });
        let sameN = 0;
        let sameC = 0;
        let dmax = 0;
        let segSum = 0;
        let genNonFinite = 0;
        out.forEach((g, i) => {
            for (const v of g.segs) if (!Number.isFinite(v)) genNonFinite += 1;
            const L = gen[i].cont.length;
            segSum += g.cont.length;
            if (g.cont.length !== L) return;
            sameN += 1;
            if (g.cont.every((c, t) => c === gen[i].cont[t])) sameC += 1;
            if (L) dmax = Math.max(dmax, maxAbsDiff(g.segs, gen[i].segs));
        });
        const free = { sameCount: `${sameN}/${n}`, sameCountAndCont: `${sameC}/${n}`, segMaxWhenSame: dmax, meanSegs: segSum / n, nonFinite: genNonFinite, ms: full6.lastStats };
        log(`[generate ${tag}] same count ${free.sameCount}, same count + cont ${free.sameCountAndCont}, seg max diff ${fmt(dmax)}, mean segs ${(segSum / n).toFixed(2)}; non-finite ${genNonFinite}; encode ${full6.lastStats?.encodeMs.toFixed(1)} ms decode ${full6.lastStats?.decodeMs.toFixed(1)} ms`);
        report[`full6_${tag}`] = { teacherForced: tf, generate: free };
    }
    full6.destroy();
}

/** full6 generate timings over batch sizes (wall, serial or paced), as ms total and ms a character. */
async function bench(device: GPUDevice, config: Config, ref: RefData, report: Record<string, unknown>) {
    const all = glyphsOf(ref, 126);
    const rows: unknown[] = [];
    for (const B of config.batches) {
        const full6 = await Full6Wgsl.create(device, new Uint8Array(fs.readFileSync(config.full6)), { f16: config.f16, capacity: B, chunk: Math.min(8, B) });
        const glyphs = Array.from({ length: B }, (_, i) => all[i % all.length]);
        const pacing = config.paced ? { sliceMs: 2, inFlight: 1 } : undefined;
        await full6.generate(glyphs.slice(0, Math.min(B, 4)), { useReference: false, pacing, readEvery: config.readEvery });
        const runs: number[] = [];
        let stats = full6.lastStats;
        for (let r = 0; r < 3; r += 1) {
            const started = performance.now();
            await full6.generate(glyphs, { useReference: false, pacing, readEvery: config.readEvery });
            runs.push(performance.now() - started);
            stats = full6.lastStats;
        }
        const best = Math.min(...runs);
        const row = { B, totalMs: best, perCharMs: best / B, encodeMs: stats?.encodeMs, decodeMs: stats?.decodeMs, steps: stats?.steps, perStepMs: (stats?.decodeMs ?? 0) / (stats?.steps ?? 1), submits: stats?.submits, longestMs: stats?.longestMs, gpuMB: full6.bytes / 2 ** 20 };
        rows.push(row);
        log(`[bench B=${B}] total ${best.toFixed(1)} ms, ${(best / B).toFixed(2)} ms/char; encode ${stats?.encodeMs.toFixed(1)} decode ${stats?.decodeMs.toFixed(1)} ms over ${stats?.steps} steps (${row.perStepMs.toFixed(2)} ms/step), submits ${stats?.submits}, longest dispatch ${stats?.longestMs?.toFixed(3) ?? '-'} ms, GPU ${row.gpuMB.toFixed(0)} MB`);
        full6.destroy();
    }
    report.bench = rows;
}

async function main() {
    const config: Config = await ipcRenderer.invoke('sw-config');
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    if (config.f16 && !adapter.features.has('shader-f16')) throw new Error('SW_F16 asked for, but this adapter has no shader-f16');
    const features: GPUFeatureName[] = [];
    if (config.f16) features.push('shader-f16');
    if (adapter.features.has('timestamp-query')) features.push('timestamp-query');
    const device = await adapter.requestDevice({
        requiredFeatures: features,
        requiredLimits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
    });
    device.addEventListener('uncapturederror', (event) => log(`GPU error: ${(event as GPUUncapturedErrorEvent).error.message}`));
    log(`adapter ${adapter.info.vendor} ${adapter.info.architecture}; ${config.f16 ? 'f16' : 'f32'}; features ${features.join(',')}`);
    const ref = new RefData(config.ref, fs, path);
    const report: Record<string, unknown> = { mode: config.f16 ? 'f16' : 'f32', task: config.task };
    if (config.task === 'stages') await stages(device, config, ref);
    if (config.task === 'align' || config.task === 'full6') await alignFull6(device, config, ref, report);
    if (config.task === 'align' || config.task === 'own') await runOwnChecks(device, config, ref, report, log);
    if (config.task === 'bench') await bench(device, config, ref, report);
    fs.writeFileSync(path.join(config.out, `report-${config.task}-${report.mode}.json`), JSON.stringify(report, null, 1));
    ipcRenderer.send('sw-done', 0);
}

main().catch((error) => {
    log(`FAILED: ${error?.stack ?? error}`);
    ipcRenderer.send('sw-done', 1);
});

