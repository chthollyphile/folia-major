/// <reference types="@webgpu/types" />
import { SERIAL_PACING, type SlicePacing } from '../gpuSlices';
import { GpuGraph, OpRunner, profileOps, readBuffer, usableCosts, type Op } from './graph';
import { ownExtra, pointTimes, polylineLength, resamplePen } from './hostMath';
import { AVG_POOL, LIN_ACCUM, LIN_RELU, LIN_SILU, UP_CAT, flat, transposeKernel } from './kernels';
import { ATTN_FIELDS, OWN_LOGITS, OWN_MAX_PENS, OWN_QUERY, PROJECT, attentionKernel } from './kernelsSeq';
import { Layers, type ConvMeta } from './layers';
import { repack, unpackStrokes, type StrokesManifest } from './packed';

// src/services/analysis/strokesWgsl/own1.ts
// own1 (which pen owns each ink pixel; ~/bihua hf/code/ownnet.py, HANDOFF_FOLIA.md §2) on WGSL, a chunk of
// glyphs a forward: U-Net (Blocks with GroupNorm folded into the convs' gathers, a 2-layer pre-LN
// transformer at 16 x 16), the 64-channel pixel features Fm, one query per pen sampled from Fm, the
// per-pixel logits argmax - and then example.py's projection: every ink pixel takes its owner pen's
// nearest vertex, giving the pen index, the position along that pen (0..1) and the reveal time (0..1).
//
// Inputs are precomputed: x [4, 256, 256] = ink, clip(inside/12), the trajectory time map and trajectory
// mask (preprocess.own_input: cv2 line rasterisation of full6's pens, not done here) and the pens.

export interface Own1Glyph {
    /** [4, 256, 256] own1 input. */
    x: Float32Array;
    /** The joined pens (preprocess.join_segments of full6's output), flat [n, 2] each, canvas coordinates. */
    pens: Float32Array[];
    /** Resampled pens [P, 32, 2]; default resamplePen of `pens` (the reference passes its own). */
    resampled?: Float32Array;
}

export interface Own1Result {
    /** argmax pen per pixel [256 * 256] (meaningful on ink only). */
    owner: Uint8Array;
    /** top-1 minus top-2 logit per pixel (1e4 with a single pen). */
    gap: Float32Array;
    /** Per ink pixel: owner pen, position along it 0..1, reveal time 0..1; -1 off the ink. [256 * 256] each. */
    pen: Int16Array;
    along: Float32Array;
    reveal: Float32Array;
    /** Every pen's logits [P, 256 * 256] when asked for. */
    logits?: Float32Array;
}

export interface Own1RunOptions {
    pacing?: SlicePacing;
    /** Keep the per-pen logits (alignment checks). */
    logits?: boolean;
    /** Awaited after each chunk. */
    between?: () => Promise<void> | void;
}

const own1Spec = (manifest: StrokesManifest): Record<string, string | string[]> => {
    const spec: Record<string, string | string[]> = {};
    for (const name of Object.keys(manifest.tensors)) spec[name] = name;
    for (let i = 0; i < 2; i += 1) {
        const p = `b.att.layers.${i}.self_attn`;
        spec[`A${i}.qkv.w`] = ['q', 'k', 'v'].map(x => `${p}.${x}.w`);
        spec[`A${i}.qkv.b`] = ['q', 'k', 'v'].map(x => `${p}.${x}.b`);
    }
    return spec;
};

const CH = [32, 64, 128, 192, 256];
const PIX = 65536;

export class Own1Wgsl {
    private readonly ops: Op[] = [];
    private readonly buf: Record<string, GPUBuffer> = {};
    private readonly costs = new Map<string, number>();
    private profiled = false;
    private queryOps: { pens: number; ops: Op[] } | null = null;
    lastMs = 0;

    private constructor(private readonly device: GPUDevice, private readonly graph: GpuGraph, private readonly layers: Layers, readonly chunk: number) {
        this.build();
    }

    /** Per-dispatch GPU ms by op label, from the first paced run's timestamps (empty before one). */
    get costTable(): ReadonlyMap<string, number> {
        return this.costs;
    }

    get bytes(): number {
        return this.graph.owned.reduce((sum, buffer) => sum + buffer.size, 0);
    }

    static async create(device: GPUDevice, file: Uint8Array, options: { f16?: boolean; chunk?: number } = {}): Promise<Own1Wgsl> {
        if (options.f16 && !device.features.has('shader-f16')) throw new Error('own1 f16 needs a device opened with shader-f16');
        const { weights, manifest } = unpackStrokes(file);
        if (manifest.model !== 'strokenet-own1') throw new Error(`not own1 weights: ${manifest.model}`);
        const packed = repack(weights, manifest, own1Spec(manifest));
        const graph = new GpuGraph(device);
        const w = graph.buffer(packed.data.byteLength);
        device.queue.writeBuffer(w, 0, packed.data);
        const convs: Record<string, ConvMeta> = {};
        for (const [name, tensor] of Object.entries(manifest.tensors)) if (tensor.conv) convs[name] = tensor.conv;
        const layers = new Layers(graph, w, packed.entries, convs, options.f16 ? 'f16' : 'f32');
        const own = new Own1Wgsl(device, graph, layers, Math.max(1, options.chunk ?? 1));
        await device.queue.onSubmittedWorkDone();
        return own;
    }

    destroy(): void {
        this.graph.destroy();
    }

    /** The fixed forward up to Fm, for a chunk of `chunk` glyphs. */
    private build(): void {
        const L = this.layers;
        const z = this.chunk;
        const f = (name: string, count: number) => { this.buf[name] = this.graph.buffer(count * 4); return this.buf[name]; };
        const x0 = f('x', z * 4 * PIX);
        const hs = CH.map((c, i) => f(`h${i}`, z * c * (PIX >> (2 * i))));
        const ta = f('ta', z * 64 * PIX);
        const tb = f('tb', z * 32 * PIX);
        const sk = f('sk', z * 32 * PIX);
        const pool = f('pool', z * 32 * (PIX >> 2));
        const cat = f('cat', z * 96 * PIX);
        const st = f('st', z * 16);
        const fm = f('fm', z * 64 * PIX);
        const ops = this.ops;
        const block = (name: string, x: GPUBuffer, out: GPUBuffer, co: number, side: number) => {
            ops.push(L.conv(`${name}.c1`, x, ta, z, side));
            ops.push(...L.gnStats(`${name}.n1`, ta, z, co, side * side, st));
            ops.push(L.conv(`${name}.c2`, ta, tb, z, side, { gn: { st, norm: `${name}.n1` } }));
            ops.push(...L.gnStats(`${name}.n2`, tb, z, co, side * side, st));
            ops.push(L.conv(`${name}.sk`, x, sk, z, side));
            ops.push(L.gnSiluSkip(`${name}.out`, tb, st, sk, out, z, co, side * side, `${name}.n2`));
        };
        block('b.inc', x0, hs[0], CH[0], 256);
        for (let i = 0; i < 4; i += 1) {
            const side = 256 >> (i + 1);
            const total = z * CH[i] * side * side;
            ops.push(this.graph.op(`b.pool${i}`, AVG_POOL, { x: hs[i], y: pool }, [total, side], flat(total)));
            block(`b.down.${i}`, pool, hs[i + 1], CH[i + 1], side);
        }
        // Bottleneck: 256 tokens of 256 (+ b.pos), two pre-LN encoder layers, back to channel-major in h4.
        const tok = f('tok', z * 256 * 256);
        const qkv = f('qkv', z * 256 * 768);
        const att = f('att', z * 256 * 256);
        const hf = f('hf', z * 256 * 768);
        const total = z * 256 * 256;
        ops.push(this.graph.op('b.att.in', transposeKernel(true), { W: L.weights, x: hs[4], y: tok }, [total, 256, 256, L.word('b.pos')], flat(total)));
        for (let i = 0; i < 2; i += 1) {
            const p = `b.att.layers.${i}`;
            const rows = z * 256;
            ops.push(L.linear(`${p}.qkv`, `A${i}.qkv`, { x: tok, y: qkv }, { m: rows, ln: `${p}.norm1` }).op);
            const params = ATTN_FIELDS.map(name => ({ nq: 256, ldq: 768, ldkv: 768, koff: 256, voff: 512, kvgs: 256, nk: 256, ldo: 256 } as Record<string, number>)[name] ?? 0);
            ops.push(this.graph.op(`${p}.sa`, attentionKernel(8, false), { q: qkv, kv: qkv, o: att, st: this.graph.none, mask: this.graph.none }, params, [32, 8, z]));
            ops.push(L.linear(`${p}.out`, `${p}.self_attn.out_proj`, { x: att, y: tok }, { m: rows, flags: LIN_ACCUM }).op);
            ops.push(L.linear(`${p}.linear1`, `${p}.linear1`, { x: tok, y: hf }, { m: rows, ln: `${p}.norm2`, flags: LIN_RELU }).op);
            ops.push(L.linear(`${p}.linear2`, `${p}.linear2`, { x: hf, y: tok }, { m: rows, flags: LIN_ACCUM }).op);
        }
        ops.push(this.graph.op('b.att.out', transposeKernel(false), { x: tok, y: hs[4] }, [total, 256, 256, 0], flat(total)));
        // Up path: cat[nearest x2(h), skip] -> Block, written over the skip's level (no longer needed).
        let h = hs[4];
        for (let j = 0; j < 4; j += 1) {
            const level = 3 - j;
            const side = 256 >> level;
            const ca = CH[level + 1];
            const cb = CH[level];
            const n = z * (ca + cb) * side * side;
            ops.push(this.graph.op(`b.up${j}.cat`, UP_CAT, { h, s: hs[level], y: cat }, [n, side, ca, cb], flat(n)));
            block(`b.up.${j}`, cat, hs[level], CH[level], side);
            h = hs[level];
        }
        ops.push(L.conv('feat.0', hs[0], ta, z, 256));
        ops.push(...L.gnStats('feat.1', ta, z, 64, PIX, st));
        ops.push(L.conv('feat.3', ta, fm, z, 256, { gn: { st, norm: 'feat.1' } }));
    }

    /** The pen-query, logits and projection ops for a chunk with `pens` pens in all (rebuilt when that grows). */
    private headOps(pens: number): Op[] {
        if (this.queryOps && this.queryOps.pens >= pens) return this.queryOps.ops;
        const L = this.layers;
        const z = this.chunk;
        const P = Math.max(pens, 16);
        const f = (name: string, count: number) => { (this.buf[name] as GPUBuffer | undefined)?.destroy(); this.buf[name] = this.graph.buffer(count * 4); return this.buf[name]; };
        const pensB = f('pens', P * 64);
        const extra = f('extra', P * 8);
        const pz = f('pz', P);
        const qin = f('qin', P * 328);
        const q1 = f('q1', P * 256);
        const q2 = f('q2', P * 256);
        const qv = f('qv', P * 64);
        f('meta', z * 2);
        f('owner', z * PIX);
        f('gap', z * PIX);
        f('logits', P * PIX);
        f('out', z * PIX * 4);
        const b = this.buf;
        const ops = [
            this.graph.op('query', OWN_QUERY, { fm: b.fm, pens: pensB, extra, pz, qin }, null, [P, 1, 1]),
            L.linear('q.0', 'q.0', { x: qin, y: q1 }, { m: P, flags: LIN_SILU }).op,
            L.linear('q.2', 'q.2', { x: q1, y: q2 }, { m: P, flags: LIN_SILU }).op,
            L.linear('q.4', 'q.4', { x: q2, y: qv }, { m: P }).op,
        ];
        this.queryOps = { pens: P, ops };
        return ops;
    }

    private logitOps(keep: boolean, verts: GPUBuffer, pmeta: GPUBuffer): Op[] {
        const b = this.buf;
        const z = this.chunk;
        return [
            this.graph.op('logits', OWN_LOGITS, { fm: b.fm, qv: b.qv, info: b.meta, owner: b.owner, gap: b.gap, logits: b.logits }, [z, keep ? 1 : 0], [PIX / 256, z, 1]),
            this.graph.op('project', PROJECT, { ink: b.x, owner: b.owner, verts, pmeta, out: b.out }, [z], [PIX / 256, z, 1]),
        ];
    }

    private async runOps(runner: OpRunner, ops: Op[], paced: boolean): Promise<void> {
        if (paced && !this.profiled) {
            this.profiled = true;
            await runner.flush();
            const measured = await profileOps(this.device, ops, 1); // one op a submit: the profiling run stays sliced too
            if (measured) {
                if (usableCosts(measured)) ops.forEach((op, i) => this.costs.set(op.label, measured[i]));
                return;
            }
        }
        const costs = paced ? ops.map(op => this.costs.get(op.label) ?? Infinity) : undefined;
        await runner.add(ops, costs);
    }

    /** Owners and the reveal map for each glyph (a chunk at a time). */
    async run(glyphs: Own1Glyph[], options: Own1RunOptions = {}): Promise<Own1Result[]> {
        const pacing = options.pacing ?? SERIAL_PACING;
        const paced = Number.isFinite(pacing.sliceMs);
        const runner = new OpRunner(this.device, pacing);
        const results: Own1Result[] = [];
        const started = performance.now();
        for (let start = 0; start < glyphs.length; start += this.chunk) {
            const part = glyphs.slice(start, start + this.chunk);
            results.push(...await this.runChunk(runner, part, options, paced));
            await options.between?.();
        }
        this.lastMs = performance.now() - started;
        return results;
    }

    private async runChunk(runner: OpRunner, part: Own1Glyph[], options: Own1RunOptions, paced: boolean): Promise<Own1Result[]> {
        const { device } = this;
        const z = this.chunk;
        // Host side: resampled pens + extras, vertex table (x, y, along, time) and the per-image / per-pen index.
        const resampled: Float32Array[] = [];
        const extras: Float32Array[] = [];
        const owners: number[] = [];
        const meta = new Uint32Array(z * 2);
        const vertices: number[] = [];
        const penRanges: number[] = [];
        part.forEach((glyph, i) => {
            if (glyph.x.length !== 4 * PIX) throw new Error('own1 input must be [4, 256, 256]');
            const n = glyph.pens.length;
            if (n > OWN_MAX_PENS) throw new Error(`own1 takes up to ${OWN_MAX_PENS} pens a glyph, got ${n}`);
            meta[i * 2] = owners.length;
            meta[i * 2 + 1] = n;
            const { times } = pointTimes(glyph.pens);
            glyph.pens.forEach((pen, k) => {
                const sampled = glyph.resampled ? glyph.resampled.subarray(k * 64, k * 64 + 64) : resamplePen(pen);
                resampled.push(sampled);
                const extra = new Float32Array(8);
                ownExtra(sampled, k, n, extra);
                extras.push(extra);
                owners.push(i);
                const length = polylineLength(pen);
                penRanges.push(vertices.length / 4);
                let s = 0;
                for (let v = 0; v < pen.length / 2; v += 1) {
                    if (v > 0) s += Math.hypot(pen[2 * v] - pen[2 * v - 2], pen[2 * v + 1] - pen[2 * v - 1]);
                    vertices.push(pen[2 * v], pen[2 * v + 1], length > 0 ? s / length : 0, times[k][v]);
                }
                penRanges.push(vertices.length / 4);
            });
            device.queue.writeBuffer(this.buf.x, i * 4 * PIX * 4, glyph.x.buffer, glyph.x.byteOffset, glyph.x.byteLength);
        });
        const P = owners.length;
        const headOps = this.headOps(P);
        const b = this.buf;
        const pens = new Float32Array(Math.max(P, 1) * 64);
        resampled.forEach((r, k) => pens.set(r, k * 64));
        const extra = new Float32Array(Math.max(P, 1) * 8);
        extras.forEach((e, k) => extra.set(e, k * 8));
        device.queue.writeBuffer(b.pens, 0, pens);
        device.queue.writeBuffer(b.extra, 0, extra);
        device.queue.writeBuffer(b.pz, 0, new Uint32Array(owners.length ? owners : [0]));
        device.queue.writeBuffer(b.meta, 0, meta);
        const pmeta = this.graph.buffer((z * 2 + penRanges.length) * 4);
        const pm = new Uint32Array(z * 2 + penRanges.length);
        pm.set(meta);
        pm.set(penRanges, z * 2);
        device.queue.writeBuffer(pmeta, 0, pm);
        const verts = this.graph.buffer(Math.max(vertices.length, 4) * 4);
        device.queue.writeBuffer(verts, 0, new Float32Array(vertices));
        const head = headOps.map((op, k) => (k === 0 ? { ...op, count: [Math.max(P, 1), 1, 1] as [number, number, number] } : op));
        const ops = [...this.ops, ...(P ? head : []), ...(P ? this.logitOps(Boolean(options.logits), verts, pmeta) : [])];
        await this.runOps(runner, ops, paced);
        await runner.flush(true);
        const [owner, gap, out, logits] = await Promise.all([
            readBuffer(device, b.owner, part.length * PIX * 4).then(x => new Uint32Array(x)),
            readBuffer(device, b.gap, part.length * PIX * 4).then(x => new Float32Array(x)),
            readBuffer(device, b.out, part.length * PIX * 16).then(x => new Float32Array(x)),
            options.logits && P ? readBuffer(device, b.logits, P * PIX * 4).then(x => new Float32Array(x)) : Promise.resolve(null),
        ]);
        verts.destroy();
        pmeta.destroy();
        return part.map((glyph, i) => {
            const pen = new Int16Array(PIX);
            const along = new Float32Array(PIX);
            const reveal = new Float32Array(PIX);
            for (let p = 0; p < PIX; p += 1) {
                const o = (i * PIX + p) * 4;
                pen[p] = glyph.pens.length ? out[o] : -1;
                along[p] = glyph.pens.length ? out[o + 1] : -1;
                reveal[p] = glyph.pens.length ? out[o + 2] : -1;
            }
            const result: Own1Result = { owner: Uint8Array.from(owner.subarray(i * PIX, (i + 1) * PIX)), gap: gap.slice(i * PIX, (i + 1) * PIX), pen, along, reveal };
            if (logits) result.logits = logits.slice(meta[i * 2] * PIX, (meta[i * 2] + meta[i * 2 + 1]) * PIX);
            return result;
        });
    }
}
