/// <reference types="@webgpu/types" />
import { SERIAL_PACING, type SlicePacing } from '../gpuSlices';
import type { Full6Taps } from './full6';
import { GpuGraph, OpRunner, profileOps, readBuffer, usableCosts, type Op } from './graph';
import { ownExtra, resamplePen } from './hostMath';
import { LIN_ACCUM, LIN_RELU, LIN_SILU, TOKENS_TO_MAP, UP_CAT, flat } from './kernels';
import { OWN2_ASSIGN, OWN2_LOGITS, OWN2_POOL, OWN2_QUERY, OWN2_TOKENS, OWN_MAX_PENS, catFmapKernel, upCatKernel } from './kernelsOwn2';
import { ATTN_FIELDS, attentionKernel } from './kernelsSeq';
import { Layers, type ConvMeta } from './layers';
import { own2Trajectory, pointTimes64, pushPenVertices } from './ownInput';
import { repack, unpackStrokes, type StrokesManifest } from './packed';

// src/services/analysis/strokesWgsl/own2.ts
// own2 (which pen owns each ink pixel, reusing full6's encoder; ~/bihua hf/code/ownhead.py) on WGSL. It reads
// full6's taps in place - enc.s0's output, fmap and the image tokens of the batch full6 last encoded - so it
// runs right after full6.generate on the same batch (slot i = glyph i there), `chunk` glyphs a forward: a
// small U-Net at 128 / 64 / 32 / 16 (two pre-LN transformer layers on the 16 x 16 tokens plus full6's image
// tokens), the 64-channel pixel features Fm at 128 x 128, one query per pen sampled from Fm, the logits at
// 128 x 128; then per ink pixel the logits bilinear x2, argmax and the nearest point on the owner's segments.
//
// Host input per glyph: the joined pens of full6's output (canvas coordinates); the trajectory raster
// (ownInput.own2Trajectory, cv2.line exact) and the resampled pens are made here unless given.

export interface Own2Glyph {
    /** The joined pens (preprocess.join_segments of full6's output), flat [n, 2] each, canvas coordinates. */
    pens: Float32Array[];
    /** Resampled pens [P, 32, 2]; default resamplePen of `pens` (the reference passes its own). */
    resampled?: Float32Array;
    /** The pooled trajectory [2, 128, 128]; default own2Trajectory(pens). */
    traj?: Float32Array;
}

export interface Own2Result {
    /** Per ink pixel (full6 img channel 0 > 0.1): owner pen, position along it 0..1, reveal time 0..1; -1 off the ink. [256 * 256] each. */
    pen: Int16Array;
    along: Float32Array;
    reveal: Float32Array;
    /** top-1 minus top-2 logit at ink pixels (1e4 with a single pen), 0 off the ink. */
    gap: Float32Array;
    /** Every pen's logits at 128 x 128 [P, 128 * 128] when asked for. */
    logits128?: Float32Array;
}

export interface Own2RunOptions {
    pacing?: SlicePacing;
    /** Keep the per-pen 128 x 128 logits (alignment checks; reads back after every chunk). */
    logits?: boolean;
    /** Awaited after each chunk. */
    between?: () => Promise<void> | void;
}

/** What own2 reads full6 through: Full6Wgsl (its `taps` getter is the live batch). */
export interface Own2Source {
    readonly taps: Full6Taps | null;
}

const own2Spec = (manifest: StrokesManifest): Record<string, string | string[]> => {
    const spec: Record<string, string | string[]> = {};
    for (const name of Object.keys(manifest.tensors)) spec[name] = name;
    for (let i = 0; i < 2; i += 1) {
        const p = `att.layers.${i}.self_attn`;
        spec[`A${i}.qkv.w`] = ['q', 'k', 'v'].map(x => `${p}.${x}.w`);
        spec[`A${i}.qkv.b`] = ['q', 'k', 'v'].map(x => `${p}.${x}.b`);
    }
    return spec;
};

const S128 = 16384;
const PIX = 65536;
const MAXP = OWN_MAX_PENS;

export class Own2Wgsl {
    /** The forward's ops that bind no full6 slot (shared by every chunk), by stage. */
    private readonly stages: Op[][] = [];
    private readonly chunkOps = new Map<number, Op[]>();
    private readonly buf: Record<string, GPUBuffer> = {};
    private readonly costs = new Map<string, number>();
    private profiled = false;
    private vertsCapacity = 0;
    lastMs = 0;

    /** full6's tap buffers (fixed); `full6.taps` is read again for the batch count and epoch. */
    private readonly taps: Full6Taps;

    private constructor(private readonly device: GPUDevice, private readonly graph: GpuGraph, private readonly layers: Layers, private readonly full6: Own2Source, readonly chunk: number) {
        this.taps = Own2Wgsl.tapsOf(full6);
        this.build();
    }

    private static tapsOf(full6: Own2Source): Full6Taps {
        const taps = full6.taps;
        if (!taps) throw new Error('own2 needs full6 created with taps: true');
        return taps;
    }

    /** Per-dispatch GPU ms by op label, from the first paced run's timestamps (empty before one). */
    get costTable(): ReadonlyMap<string, number> {
        return this.costs;
    }

    get bytes(): number {
        return this.graph.owned.reduce((sum, buffer) => sum + buffer.size, 0);
    }

    /**
     * Uploads own2-folia.bin against a full6 created with `taps: true` (its weights must be the full6 own2 was
     * trained on). chunk: glyphs a forward (must divide full6's capacity); f16: own2's GEMMs in f16.
     */
    static async create(device: GPUDevice, file: Uint8Array, full6: Own2Source, options: { f16?: boolean; chunk?: number } = {}): Promise<Own2Wgsl> {
        if (options.f16 && !device.features.has('shader-f16')) throw new Error('own2 f16 needs a device opened with shader-f16');
        const taps = Own2Wgsl.tapsOf(full6);
        const { weights, manifest } = unpackStrokes(file);
        if (manifest.model !== 'strokenet-own2') throw new Error(`not own2 weights: ${manifest.model}`);
        const pair = manifest.hyper_parameters.full6_sha256;
        if (typeof pair === 'string' && taps.sha256 && pair !== taps.sha256) throw new Error(`own2 was trained on full6 ${pair.slice(0, 12)}, these taps are ${taps.sha256.slice(0, 12)}`);
        // Default 2 (fuse's 3 x 3 convs ~1.2 ms a dispatch; 4 is ~4% faster at ~2.3 ms and +96 MB), 1 when 2 does not divide.
        const chunk = Math.max(1, options.chunk ?? (taps.capacity % 2 ? 1 : 2));
        if (taps.capacity % chunk) throw new Error(`own2 chunk ${chunk} must divide full6's capacity ${taps.capacity}`);
        const packed = repack(weights, manifest, own2Spec(manifest));
        const graph = new GpuGraph(device);
        const w = graph.buffer(packed.data.byteLength);
        device.queue.writeBuffer(w, 0, packed.data);
        const convs: Record<string, ConvMeta> = {};
        for (const [name, tensor] of Object.entries(manifest.tensors)) if (tensor.conv) convs[name] = tensor.conv;
        const layers = new Layers(graph, w, packed.entries, convs, options.f16 ? 'f16' : 'f32');
        const own = new Own2Wgsl(device, graph, layers, full6, chunk);
        await device.queue.onSubmittedWorkDone();
        return own;
    }

    destroy(): void {
        this.graph.destroy();
    }

    /** An activation buffer's contents (stage checks): H128, H64, H32, H16, N1, M1, fm, qin, qv, lg, ... of the last chunk. */
    async read(name: string, bytes: number, offset = 0): Promise<ArrayBuffer> {
        const buffer = this.buf[name] as GPUBuffer | undefined;
        if (!buffer) throw new Error(`no buffer ${name}`);
        return readBuffer(this.device, buffer, bytes, offset);
    }

    /** The slot-independent forward of a chunk, as stages between the ops that read full6's slots. */
    private build(): void {
        const L = this.layers;
        const g = this.graph;
        const z = this.chunk;
        const cap = this.taps.capacity;
        const f = (name: string, count: number) => { this.buf[name] = g.buffer(count * 4); return this.buf[name]; };
        // Batch-wide: host inputs and the output; per chunk: activations.
        f('traj', cap * 2 * S128);
        f('pens', cap * MAXP * 64);
        f('extra', cap * MAXP * 8);
        f('info', cap);
        f('pmeta', cap * MAXP * 2);
        f('out', cap * PIX * 4);
        this.device.queue.writeBuffer(f('kind', 192), 0, new Float32Array(this.taps.kind0));
        const pz = f('pz', z * MAXP);
        this.device.queue.writeBuffer(pz, 0, Uint32Array.from({ length: z * MAXP }, (_, i) => Math.floor(i / MAXP)));
        const xp = f('xp', z * 4 * S128);
        const F1 = f('F1', z * 64 * S128);
        const F2 = f('F2', z * 64 * S128);
        const T128 = f('T128', z * 64 * S128);
        const H128 = f('H128', z * 32 * S128);
        const D64 = f('D64', z * 64 * 4096);
        f('cat64', z * 224 * 4096);
        const M1 = f('M1', z * 96 * 4096);
        const M2 = f('M2', z * 96 * 4096);
        const T64 = f('T64', z * 96 * 4096);
        const H64 = f('H64', z * 96 * 4096);
        const N1 = f('N1', z * 128 * 1024);
        const N2 = f('N2', z * 128 * 1024);
        const T32 = f('T32', z * 128 * 1024);
        const H32 = f('H32', z * 128 * 1024);
        const H16 = f('H16', z * 192 * 256);
        f('tok', z * 256 * 192);
        f('cat32', z * 320 * 1024);
        f('cat128', z * 176 * S128);
        f('fm', z * 64 * S128);
        f('qin', z * MAXP * 328);
        f('q1', z * MAXP * 256);
        f('q2', z * MAXP * 256);
        f('qv', z * MAXP * 64);
        f('lg', z * MAXP * S128);
        const st = f('st', z * 16);
        const b = this.buf;
        // x + silu(GN(conv3x3(x))) from x into y (ping-pong: a dispatch may not read and write one buffer).
        const blk = (ops: Op[], name: string, x: GPUBuffer, t: GPUBuffer, y: GPUBuffer, c: number, side: number) => {
            ops.push(L.conv(`${name}.a`, x, t, z, side));
            ops.push(...L.gnStats(`${name}.n`, t, z, c, side * side, st));
            ops.push(L.gnSiluSkip(`${name}.out`, t, st, x, y, z, c, side * side, `${name}.n`));
        };
        // conv (name.0, on a hin x hin input) -> GN -> SiLU into y [z, c, side, side], through t.
        const convGn = (ops: Op[], name: string, x: GPUBuffer, t: GPUBuffer, y: GPUBuffer, c: number, side: number, hin = side) => {
            ops.push(L.conv(`${name}.0`, x, t, z, hin));
            ops.push(...L.gnStats(`${name}.1`, t, z, c, side * side, st));
            ops.push(L.gnSilu(`${name}.act`, t, st, y, z, c, side * side, `${name}.1`));
        };
        // 0: after the pool - inp, d64 (then the fmap cat)
        const s0: Op[] = [L.conv('inp.0', xp, F1, z, 128, { silu: true })];
        blk(s0, 'inp.2', F1, T128, H128, 32, 128);
        s0.push(L.conv('d64.0', H128, D64, z, 128, { silu: true }));
        // 1: after the fmap cat - m64, d32, d16 (then the tokens)
        const s1: Op[] = [];
        convGn(s1, 'm64', b.cat64, M1, M2, 96, 64);
        blk(s1, 'm64.3', M2, T64, M1, 96, 64);
        blk(s1, 'm64.4', M1, T64, H64, 96, 64);
        convGn(s1, 'd32', H64, N1, N2, 128, 32, 64);
        blk(s1, 'd32.3', N2, T32, H32, 128, 32);
        s1.push(L.conv('d16', H32, H16, z, 32));
        // 2: after the tokens - attention, u32, u64 (then the fuse cat)
        const s2: Op[] = [];
        const qkv = f('qkv', z * 256 * 576);
        const att = f('att', z * 256 * 192);
        const hf = f('hf', z * 256 * 576);
        const rows = z * 256;
        for (let i = 0; i < 2; i += 1) {
            const p = `att.layers.${i}`;
            s2.push(L.linear(`${p}.qkv`, `A${i}.qkv`, { x: b.tok, y: qkv }, { m: rows, ln: `${p}.norm1` }).op);
            const params = ATTN_FIELDS.map(name => ({ nq: 256, ldq: 576, ldkv: 576, koff: 192, voff: 384, kvgs: 256, nk: 256, ldo: 192 } as Record<string, number>)[name] ?? 0);
            s2.push(g.op(`${p}.sa`, attentionKernel(8, false), { q: qkv, kv: qkv, o: att, st: g.none, mask: g.none }, params, [32, 6, z]));
            s2.push(L.linear(`${p}.out`, `${p}.self_attn.out_proj`, { x: att, y: b.tok }, { m: rows, flags: LIN_ACCUM }).op);
            s2.push(L.linear(`${p}.linear1`, `${p}.linear1`, { x: b.tok, y: hf }, { m: rows, ln: `${p}.norm2`, flags: LIN_RELU }).op);
            s2.push(L.linear(`${p}.linear2`, `${p}.linear2`, { x: hf, y: b.tok }, { m: rows, flags: LIN_ACCUM }).op);
        }
        const tt = z * 256 * 192;
        s2.push(g.op('att.out', TOKENS_TO_MAP, { x: b.tok, y: H16 }, [tt, 192, 256], flat(tt)));
        const n32 = z * 320 * 1024;
        s2.push(g.op('u32.cat', UP_CAT, { h: H16, s: H32, y: b.cat32 }, [n32, 32, 192, 128], flat(n32)));
        convGn(s2, 'u32', b.cat32, N1, N2, 128, 32);
        blk(s2, 'u32.3', N2, T32, N1, 128, 32);
        const n64 = z * 224 * 4096;
        s2.push(g.op('u64.cat', upCatKernel(false), { h: N1, s: H64, t: g.none, y: b.cat64 }, [n64, 64, 128, 96, 0], flat(n64)));
        convGn(s2, 'u64', b.cat64, M1, M2, 96, 64);
        blk(s2, 'u64.3', M2, T64, M1, 96, 64);
        // 3: after the fuse cat - fuse, Fm, queries, logits (then the assignment)
        const s3: Op[] = [];
        convGn(s3, 'fuse', b.cat128, T128, F1, 64, 128);
        blk(s3, 'fuse.3', F1, T128, F2, 64, 128);
        blk(s3, 'fuse.4', F2, T128, F1, 64, 128);
        s3.push(L.conv('fuse.5', F1, b.fm, z, 128));
        this.stages.push(s0, s1, s2, s3);
        this.ensureVerts(1);
    }

    /** All ops of chunk `index` (glyphs index * chunk ..): the shared stages and the ones bound at its slots. */
    private opsOf(index: number): Op[] {
        let ops = this.chunkOps.get(index);
        if (ops) return ops;
        const L = this.layers;
        const g = this.graph;
        const b = this.buf;
        const t = this.taps;
        const z = this.chunk;
        const base = index * z;
        const at = (buffer: GPUBuffer, perGlyph: number, bytes = 4) => ({ buffer, offset: base * perGlyph * bytes, size: z * perGlyph * bytes });
        const tb = t.half ? 2 : 4;
        const n0 = z * 4 * S128;
        const n64 = z * 192 * 4096;
        const nt = z * 256 * 192;
        const n128 = z * 176 * S128;
        const P = z * MAXP;
        ops = [
            g.op('pool', OWN2_POOL, { img: at(t.img, 3 * PIX), traj: at(b.traj, 2 * S128), y: b.xp }, [n0], flat(n0)),
            ...this.stages[0],
            g.op('m64.cat', catFmapKernel(t.half), { a: b.D64, fm: at(t.fmap, 4096 * 128, tb), y: b.cat64 }, [n64], flat(n64)),
            ...this.stages[1],
            g.op('att.in', OWN2_TOKENS, { x: b.H16, mem: at(t.mem, 296 * 192), kind: b.kind, y: b.tok }, [nt, 296], flat(nt)),
            ...this.stages[2],
            g.op('fuse.cat', upCatKernel(t.half), { h: b.M1, s: at(t.s0, 48 * S128, tb), t: b.H128, y: b.cat128 }, [n128, 128, 96, 48, 32], flat(n128)),
            ...this.stages[3],
            g.op('query', OWN2_QUERY, { fm: b.fm, pens: at(b.pens, MAXP * 64), extra: at(b.extra, MAXP * 8), pz: b.pz, qin: b.qin }, null, [P, 1, 1]),
            L.linear('q.0', 'q.0', { x: b.qin, y: b.q1 }, { m: P, flags: LIN_SILU }).op,
            L.linear('q.2', 'q.2', { x: b.q1, y: b.q2 }, { m: P, flags: LIN_SILU }).op,
            L.linear('q.4', 'q.4', { x: b.q2, y: b.qv }, { m: P }).op,
            g.op('logits', OWN2_LOGITS, { fm: b.fm, qv: b.qv, info: b.info, lg: b.lg }, [base], [S128 / 256, z, 1]),
            g.op('assign', OWN2_ASSIGN, { img: t.img, lg: b.lg, info: b.info, verts: b.verts, pmeta: b.pmeta, out: b.out }, [base], [PIX / 256, z, 1]),
        ];
        this.chunkOps.set(index, ops);
        return ops;
    }

    /** Grows the vertex table to `count` vertices (the ops binding it are rebuilt). */
    private ensureVerts(count: number): void {
        if (count <= this.vertsCapacity) return;
        this.vertsCapacity = Math.max(1024, 2 ** Math.ceil(Math.log2(count)));
        (this.buf.verts as GPUBuffer | undefined)?.destroy();
        this.buf.verts = this.graph.buffer(this.vertsCapacity * 16);
        this.chunkOps.clear();
    }

    private async runOps(runner: OpRunner, ops: Op[], paced: boolean): Promise<void> {
        if (paced && !this.profiled) {
            this.profiled = true;
            await runner.flush();
            const measured = await profileOps(this.device, ops, 1); // one op a submit: the profiling run stays sliced too
            if (measured) {
                if (usableCosts(measured)) ops.forEach((op, i) => this.costs.set(op.label, Math.max(this.costs.get(op.label) ?? 0, measured[i])));
                return;
            }
        }
        const costs = paced ? ops.map(op => this.costs.get(op.label) ?? Infinity) : undefined;
        await runner.add(ops, costs);
    }

    /** Uploads the batch's host inputs: trajectories, resampled pens + extras, pen counts, the vertex table. */
    private upload(glyphs: Own2Glyph[]): void {
        const { device } = this;
        const b = this.buf;
        const n = glyphs.length;
        const traj = new Float32Array(n * 2 * S128);
        const pens = new Float32Array(n * MAXP * 64);
        const extra = new Float32Array(n * MAXP * 8);
        const info = new Uint32Array(n);
        const pmeta = new Uint32Array(n * MAXP * 2);
        const vertices: number[] = [];
        glyphs.forEach((glyph, i) => {
            const count = glyph.pens.length;
            if (count > MAXP) throw new Error(`own2 takes up to ${MAXP} pens a glyph, got ${count}`);
            info[i] = count;
            if (glyph.traj) {
                if (glyph.traj.length !== 2 * S128) throw new Error('own2 trajectory must be [2, 128, 128]');
                traj.set(glyph.traj, i * 2 * S128);
            } else if (count) own2Trajectory(glyph.pens, traj, i * 2 * S128);
            const times = pointTimes64(glyph.pens);
            glyph.pens.forEach((pen, k) => {
                const row = i * MAXP + k;
                const sampled = glyph.resampled ? glyph.resampled.subarray(k * 64, k * 64 + 64) : resamplePen(pen);
                pens.set(sampled, row * 64);
                ownExtra(sampled, k, count, extra.subarray(row * 8, row * 8 + 8));
                pmeta.set(pushPenVertices(vertices, pen, times[k]), row * 2);
            });
        });
        this.ensureVerts(vertices.length / 4);
        device.queue.writeBuffer(b.traj, 0, traj);
        device.queue.writeBuffer(b.pens, 0, pens);
        device.queue.writeBuffer(b.extra, 0, extra);
        device.queue.writeBuffer(b.info, 0, info);
        device.queue.writeBuffer(b.pmeta, 0, pmeta);
        device.queue.writeBuffer(b.verts, 0, new Float32Array(vertices));
    }

    /**
     * Owners and the reveal map of full6's last encoded batch: glyphs[i] is slot i there (at most its count;
     * call right after full6.generate / encode of the same glyphs, before full6 encodes another batch).
     */
    async run(glyphs: Own2Glyph[], options: Own2RunOptions = {}): Promise<Own2Result[]> {
        const taps = Own2Wgsl.tapsOf(this.full6);
        if (glyphs.length > taps.count) throw new Error(`own2: ${glyphs.length} glyphs, full6's last batch has ${taps.count}`);
        const epoch = taps.epoch;
        const pacing = options.pacing ?? SERIAL_PACING;
        const paced = Number.isFinite(pacing.sliceMs);
        const runner = new OpRunner(this.device, pacing);
        const started = performance.now();
        this.upload(glyphs);
        const logits: Float32Array[] = [];
        for (let index = 0; index * this.chunk < glyphs.length; index += 1) {
            await this.runOps(runner, this.opsOf(index), paced);
            if (options.logits) {
                await runner.flush(true);
                logits.push(new Float32Array(await readBuffer(this.device, this.buf.lg, this.chunk * MAXP * S128 * 4)));
            }
            await options.between?.();
        }
        await runner.flush(true);
        const out = new Float32Array(await readBuffer(this.device, this.buf.out, glyphs.length * PIX * 16));
        this.lastMs = performance.now() - started;
        if (Own2Wgsl.tapsOf(this.full6).epoch !== epoch) throw new Error('own2: full6 encoded another batch during the run');
        return glyphs.map((glyph, i) => {
            const pen = new Int16Array(PIX);
            const along = new Float32Array(PIX);
            const reveal = new Float32Array(PIX);
            const gap = new Float32Array(PIX);
            for (let p = 0; p < PIX; p += 1) {
                const o = (i * PIX + p) * 4;
                pen[p] = out[o];
                along[p] = out[o + 1];
                reveal[p] = out[o + 2];
                gap[p] = out[o + 3];
            }
            const result: Own2Result = { pen, along, reveal, gap };
            if (options.logits) {
                const rows = logits[Math.floor(i / this.chunk)];
                const first = (i % this.chunk) * MAXP;
                result.logits128 = rows.slice(first * S128, (first + glyph.pens.length) * S128);
            }
            return result;
        });
    }
}
