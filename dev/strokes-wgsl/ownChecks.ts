/// <reference types="@webgpu/types" />
import { joinSegments, pointTimes, resamplePen } from '../../src/services/analysis/strokesWgsl/hostMath';
import { Own1Wgsl, type Own1Glyph } from '../../src/services/analysis/strokesWgsl/own1';
import { halfToFloat } from '../../src/services/analysis/strokesWgsl/packed';
import { fs } from './node';
import { maxAbsDiff, type RefData } from './refData';

// dev/strokes-wgsl/ownChecks.ts
// own1 checks of the test shell against the reference (as tools/mnn main.cpp checkOwn1): logits on the
// sub characters, owners on ink pixels (with torch's top1 - top2 gap where they differ), non-finite
// values - and the projection (pen / along / reveal) against a CPU port of example.py's nearest vertex.

const PIX = 65536;

/** example.py's reveal for one glyph, given owners: nearest vertex of the owner pen (first of equals), in f64. */
const cpuProject = (pens: Float32Array[], times: Float32Array[], owner: Uint8Array, ink: (p: number) => boolean) => {
    const reveal = new Float32Array(PIX).fill(-1);
    for (let p = 0; p < PIX; p += 1) {
        if (!ink(p)) continue;
        const u = ((p % 256) + 0.5) / 256 * 2 - 1;
        const v = (Math.floor(p / 256) + 0.5) / 256 * 2 - 1;
        const pen = pens[owner[p]];
        let best = Infinity;
        let arg = 0;
        for (let i = 0; i < pen.length / 2; i += 1) {
            const d = (u - pen[2 * i]) ** 2 + (v - pen[2 * i + 1]) ** 2;
            if (d < best) { best = d; arg = i; }
        }
        reveal[p] = times[owner[p]][arg];
    }
    return reveal;
};

export const runOwnChecks = async (device: GPUDevice, config: { f16: boolean; own1: string; chars: number; paced: boolean }, ref: RefData, report: Record<string, unknown>, log: (line: string) => void): Promise<void> => {
    const own = await Own1Wgsl.create(device, new Uint8Array(fs.readFileSync(config.own1)), { f16: config.f16, chunk: 1 });
    const npen = ref.i32('own_npen');
    const img = ref.u8('img_u8');
    const x23 = ref.f32('own_x23');
    const pensAll = ref.f32('own_pens');
    const argmax = ref.u8('own_argmax');
    const gapRef = ref.f16('own_gap');
    const lgSub = ref.f32('own_logits_sub');
    const sub = new Set(ref.i32('sub_idx'));
    const len = ref.i32('gen_ref_len');
    const segs = ref.f32('gen_ref_segs');
    const cont = ref.u8('gen_ref_cont');
    let segAt = 0;
    let penAt = 0;
    let lgAt = 0;
    let ink = 0;
    let diff = 0;
    let diffBig = 0;
    let inkBig = 0;
    let gapMaxAtDiff = 0;
    let dlg = 0;
    let nonFinite = 0;
    let projDiff = 0;
    let projChecked = 0;
    let resampleDiff = 0;
    const times: number[] = [];
    const n = Math.min(config.chars, 126);
    for (let i = 0; i < n; i += 1) {
        const L = len[i];
        const charSegs = segs.subarray(segAt * 32, (segAt + L) * 32);
        const charCont = cont.subarray(segAt, segAt + L);
        segAt += L;
        const P = npen[i];
        if (!P) continue;
        const x = new Float32Array(4 * PIX);
        for (let c = 0; c < 2; c += 1) for (let p = 0; p < PIX; p += 1) x[c * PIX + p] = Math.fround(img[(i * 3 + c) * PIX + p] / 255);
        x.set(x23.subarray(i * 2 * PIX, (i + 1) * 2 * PIX), 2 * PIX);
        const pens = joinSegments(charSegs, charCont);
        if (pens.length !== P) throw new Error(`char ${i}: ${pens.length} joined pens, reference has ${P}`);
        const resampledRef = pensAll.subarray(penAt * 64, (penAt + P) * 64);
        pens.forEach((pen, k) => { resampleDiff = Math.max(resampleDiff, maxAbsDiff(resamplePen(pen), resampledRef.subarray(k * 64, k * 64 + 64))); });
        const glyph: Own1Glyph = { x, pens, resampled: resampledRef };
        penAt += P;
        // Paced: the first glyph warms serially so its cold first dispatches stay out of the cost table.
        if (config.paced && !times.length) await own.run([glyph]);
        const pacing = config.paced ? { sliceMs: 2, inFlight: 1 } : undefined;
        const started = performance.now();
        const [r] = await own.run([glyph], { logits: sub.has(i), pacing });
        times.push(performance.now() - started);
        if (r.logits) {
            dlg = Math.max(dlg, maxAbsDiff(r.logits, lgSub.subarray(lgAt * PIX, (lgAt + P) * PIX)));
            lgAt += P;
        }
        const inkAt = (p: number) => img[i * 3 * PIX + p] / 255 > 0.1;
        for (let p = 0; p < PIX; p += 1) {
            if (!Number.isFinite(r.gap[p]) || !Number.isFinite(r.reveal[p])) nonFinite += 1;
            if (!inkAt(p)) continue;
            ink += 1;
            const g = halfToFloat(gapRef[i * PIX + p]);
            const big = g > 0.05;
            if (big) inkBig += 1;
            if (r.owner[p] !== argmax[i * PIX + p]) {
                diff += 1;
                if (big) diffBig += 1;
                gapMaxAtDiff = Math.max(gapMaxAtDiff, g);
            }
        }
        if (i % 9 === 0) {
            const cpu = cpuProject(pens, pointTimes(pens).times, r.owner, inkAt);
            for (let p = 0; p < PIX; p += 1) if (Math.abs(cpu[p] - r.reveal[p]) > 1e-6) projDiff += 1;
            projChecked += 1;
        }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const result = {
        logitsMax: dlg, inkDiff: `${diff}/${ink}`, inkDiffPct: (100 * diff) / Math.max(ink, 1), diffWithGapOver005: `${diffBig}/${inkBig}`, gapMaxAtDiff,
        nonFinite, hostResampleMaxDiff: resampleDiff, projection: { chars: projChecked, pixelsDifferent: projDiff }, msPerCharMedian: sorted[sorted.length >> 1], msPerCharMin: sorted[0],
    };
    log(`[own1] logits max diff ${dlg.toExponential(3)}; ink owners differ ${diff}/${ink} = ${result.inkDiffPct.toFixed(4)}%, of gap > 0.05 ${diffBig}/${inkBig}, max torch gap at a difference ${gapMaxAtDiff.toFixed(3)}; non-finite ${nonFinite}; host resamplePen vs reference ${resampleDiff.toExponential(2)}; projection vs CPU: ${projDiff} pixels differ over ${projChecked} chars; ${result.msPerCharMedian.toFixed(2)} ms/char median (min ${result.msPerCharMin.toFixed(2)})`);
    if (config.paced) {
        const top = [...own.costTable.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        log(`[own1 paced] longest dispatches: ${top.map(([label, ms]) => `${label} ${ms.toFixed(3)}`).join(', ')}; GPU ${(own.bytes / 2 ** 20).toFixed(0)} MB`);
        Object.assign(result, { longestMs: top[0]?.[1] ?? null });
    }
    report.own1 = result;
    own.destroy();
};
