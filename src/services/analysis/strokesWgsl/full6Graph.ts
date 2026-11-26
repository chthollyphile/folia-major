/// <reference types="@webgpu/types" />
import { GpuGraph, STORAGE, type Op } from './graph';
import { FPN_FUSE, LIN_ACCUM, LIN_CMAJOR, LIN_SILU, LIN_TAB, LIN_VEC, flat } from './kernels';
import {
    ADVANCE, ATT_DYNK, ATT_MASK, ATT_SLOT, ATTN_FIELDS, DECIDE, MEM_ROWS, REC, STATE_HEAD, TMAX,
    attentionKernel, embedKernel, refineSampleKernel,
} from './kernelsSeq';
import { Layers, type StepOp } from './layers';
import type { StrokesManifest } from './packed';

// src/services/analysis/strokesWgsl/full6Graph.ts
// full6's GPU graph (~/bihua hf/code/seqmodel.py + seqinfer.py; HANDOFF_FOLIA.md §2): the buffers of a
// batch of up to `capacity` characters and the ops over them -
//   encoder: per chunk of `chunk` glyphs, the conv encoder + FPN -> fmap (channel-last [char][64*64][128])
//            and the 256 image tokens of the memory; then the reference tokens and every layer's cross-
//            attention K / V of the whole batch (memory rows [char][296]: 256 image + 40 reference);
//   step:    one decode step for the active slots (embed, 6 decoder layers with the KV cache, coarse
//            head, 3 refine layers, decision; ~95 dispatches), rows read from the state buffer so one
//            recorded op list serves every batch size; workgroup counts per dispatch from `StepOp.count`.

export const D = 192;
export const LAYERS = 6;
export const REFINES = 3;
export const SEGS = 40;

/** Packed-buffer spec: every tensor under its own name, plus the concatenations one GEMM reads. */
export const full6Spec = (manifest: StrokesManifest): Record<string, string | string[]> => {
    const spec: Record<string, string | string[]> = {};
    for (const name of Object.keys(manifest.tensors)) spec[name] = name;
    const cat = (name: string, parts: string[]) => {
        spec[`${name}.w`] = parts.map(p => `${p}.w`);
        spec[`${name}.b`] = parts.map(p => `${p}.b`);
    };
    for (let i = 0; i < LAYERS; i += 1) {
        cat(`L${i}.qkv`, ['q', 'k', 'v'].map(x => `layers.${i}.sa.${x}`));
        cat(`L${i}.cakv`, ['k', 'v'].map(x => `layers.${i}.ca.${x}`));
    }
    for (let j = 0; j < REFINES; j += 1) {
        cat(`R${j}.qkv`, ['q', 'k', 'v'].map(x => `refs.${j}.sa.${x}`));
        cat(`R${j}.cakv`, ['k', 'v'].map(x => `refs.${j}.ca.${x}`));
        cat(`R${j}.offw`, [`refs.${j}.off`, `refs.${j}.w`]);
    }
    cat('head', ['coarse.0', 'pt_in']);
    cat('dec', ['cont', 'end']);
    return spec;
};

export interface Full6Buffers {
    /** Glyph features [capacity, 3, 256, 256] f32. */
    img: GPUBuffer;
    /** seg_feat of the reference segments [capacity * 40, 160] (host-computed). */
    refFeat: GPUBuffer;
    /** Additive memory mask [capacity, 296]: 0 visible, -1e30 hidden. */
    mask: GPUBuffer;
    fmap: GPUBuffer;
    mem: GPUBuffer;
    /** Cross-attention K | V of the memory, per layer (6 decoder, then 3 refine) [capacity * 296, 384]. */
    kvx: GPUBuffer[];
    /** Self-attention KV cache per decoder layer [capacity, 96, 384]. */
    kvc: GPUBuffer[];
    state: GPUBuffer;
    /** segs [capacity, 96, 32] (outputs, and the next step's input), cont [capacity, 96] u32. */
    segs: GPUBuffer;
    cont: GPUBuffer;
    /** Recorded per (char, step): REC floats. */
    rec: GPUBuffer;
}

export class Full6Graph {
    readonly buffers: Full6Buffers;
    /** Encoder ops, per chunk (the chunk's input range and output offsets differ). */
    private readonly chunkOps = new Map<number, Op[]>();
    private readonly fixedEncoder: Op[] = [];
    /** Encoder and step activations by name (read back by the dev shell's stage checks). */
    readonly scratch: Record<string, GPUBuffer> = {};
    /** One decode step's ops: t = 0 (no previous segment) and t > 0. */
    readonly step0: StepOp[];
    readonly step: StepOp[];
    private readonly half: boolean;
    private decideParams: number[] = [];
    private decideUniform: GPUBuffer | undefined;

    constructor(readonly layers: Layers, readonly capacity: number, readonly chunk: number) {
        const graph = layers.graph;
        this.half = layers.mode === 'f16';
        const B = capacity;
        const f = (count: number) => graph.buffer(count * 4);
        const store = (count: number) => graph.buffer(count * (this.half ? 2 : 4));
        this.buffers = {
            img: f(B * 3 * 65536),
            refFeat: f(B * SEGS * 160),
            mask: f(B * MEM_ROWS),
            fmap: store(B * 4096 * 128),
            mem: f(B * MEM_ROWS * D),
            kvx: Array.from({ length: LAYERS + REFINES }, () => store(B * MEM_ROWS * 2 * D)),
            kvc: Array.from({ length: LAYERS }, () => store(B * TMAX * 2 * D)),
            state: graph.buffer((STATE_HEAD + 2 * B) * 4, STORAGE),
            segs: f(B * TMAX * 32),
            cont: f(B * TMAX),
            rec: f(B * TMAX * REC),
        };
        const z = chunk;
        for (const [name, count] of Object.entries({
            A0: z * 48 * 16384, S0: z * 48 * 16384, X1: z * 96 * 4096, T1: z * 96 * 4096, X2: z * 160 * 1024, T2: z * 160 * 1024,
            X3: z * 224 * 256, T3: z * 224 * 256, Pa: z * 128 * 4096, Pb: z * 128 * 1024, Pc: z * 128 * 256, Fp: z * 128 * 4096, O: z * 128 * 4096,
            gst: z * 16, refT: B * SEGS * D,
            X: B * D, Qd: B * D, ATT: B * D, H: B * 4 * D, FEAT: B * 160, LOCF: B * 256, SEGT: B * D, HH: B * 2 * D, COARSE: B * 32,
            QT: B * 16 * D, POS: B * 32, SF: B * 16 * 160, PM1: B * 16 * D, PM: B * 16 * D, QKV: B * 16 * 3 * D,
            ATT2: B * 16 * D, QQ: B * 16 * D, H2: B * 16 * 3 * D, T2b: B * 16 * D,
        })) this.scratch[name] = f(count);
        this.buildFixedEncoder();
        this.step0 = this.buildStep(true);
        this.step = this.buildStep(false);
    }

    /** The conv trunk of a chunk that does not depend on where the chunk sits in the batch. */
    private buildFixedEncoder(): void {
        const L = this.layers;
        const s = this.scratch;
        const z = this.chunk;
        const ops = this.fixedEncoder;
        const res = (name: string, x: GPUBuffer, t: GPUBuffer, c: number, side: number) => {
            ops.push(...L.gnStats(`${name}.n1`, x, z, c, side * side, s.gst));
            ops.push(L.conv(`${name}.a`, x, t, z, side, { gn: { st: s.gst, norm: `${name}.n1` } }));
            ops.push(...L.gnStats(`${name}.n2`, t, z, c, side * side, s.gst));
            ops.push(L.conv(`${name}.b`, t, x, z, side, { gn: { st: s.gst, norm: `${name}.n2` }, accum: true }));
        };
        // enc.s0.0 runs per chunk (its input range); the rest of the trunk is shared.
        ops.push(...L.gnStats('enc.s0.1', s.A0, z, 48, 16384, s.gst));
        ops.push(L.conv('enc.s0.3', s.A0, s.S0, z, 128, { gn: { st: s.gst, norm: 'enc.s0.1' } }));
        ops.push(L.conv('enc.s1.0', s.S0, s.X1, z, 128));
        res('enc.s1.1', s.X1, s.T1, 96, 64);
        res('enc.s1.2', s.X1, s.T1, 96, 64);
        ops.push(L.conv('enc.s2.0', s.X1, s.X2, z, 64));
        res('enc.s2.1', s.X2, s.T2, 160, 32);
        res('enc.s2.2', s.X2, s.T2, 160, 32);
        ops.push(L.conv('enc.s3.0', s.X2, s.X3, z, 32));
        res('enc.s3.1', s.X3, s.T3, 224, 16);
        res('enc.s3.2', s.X3, s.T3, 224, 16);
        ops.push(L.conv('enc.p1', s.X1, s.Pa, z, 64));
        ops.push(L.conv('enc.p2', s.X2, s.Pb, z, 32));
        ops.push(L.conv('enc.p3', s.X3, s.Pc, z, 16));
        const total = z * 128 * 4096;
        ops.push(L.graph.op('enc.fpn', FPN_FUSE, { a: s.Pa, b: s.Pb, c: s.Pc, y: s.Fp }, [total, 128], flat(total)));
        ops.push(L.conv('enc.out.0', s.Fp, s.O, z, 64));
        ops.push(...L.gnStats('enc.out.1', s.O, z, 128, 4096, s.gst));
    }

    /** Encoder ops of chunk `index` (characters index * chunk ..): its first conv, the shared trunk, fmap and image tokens. */
    encoderOps(index: number): Op[] {
        let ops = this.chunkOps.get(index);
        if (ops) return ops;
        const L = this.layers;
        const s = this.scratch;
        const z = this.chunk;
        const base = index * z;
        const bytes = z * 3 * 65536 * 4;
        ops = [
            L.conv('enc.s0.0', { buffer: this.buffers.img, offset: base * 3 * 65536 * 4, size: bytes }, s.A0, z, 256),
            ...this.fixedEncoder,
            L.gnChannelLast('enc.fmap', s.O, s.gst, this.buffers.fmap, z, 128, 4096, 'enc.out.1', base * 4096 * 128, this.half),
            L.linear('enc.g', 'enc.g', { x: s.X3, y: this.buffers.mem }, {
                m: z * 256, rpz: 256, ozs: MEM_ROWS, ooz: base * MEM_ROWS, tab: L.word('enc.gpos'), tabRows: 256, vec: L.word('kind'),
                flags: LIN_CMAJOR | LIN_TAB | LIN_VEC,
            }).op,
        ];
        this.chunkOps.set(index, ops);
        return ops;
    }

    /** After every chunk: the reference tokens of `count` characters and every layer's cross-attention K | V. */
    memoryOps(count: number): Op[] {
        const L = this.layers;
        const s = this.scratch;
        const b = this.buffers;
        const kvOut = this.half ? 'f16' as const : 'f32' as const;
        const ops = [
            L.linear('ref_in.0', 'ref_in.0', { x: b.refFeat, y: s.refT }, { m: count * SEGS, flags: LIN_SILU }).op,
            L.linear('ref_in.2', 'ref_in.2', { x: s.refT, y: b.mem }, {
                m: count * SEGS, rpz: SEGS, ozs: MEM_ROWS, ooz: 256, tab: L.word('ref_ord.table'), tabRows: SEGS, vec: L.word('kind') + D, flags: LIN_TAB | LIN_VEC,
            }).op,
        ];
        for (let i = 0; i < LAYERS + REFINES; i += 1) {
            const name = i < LAYERS ? `L${i}.cakv` : `R${i - LAYERS}.cakv`;
            ops.push(L.linear(name, name, { x: b.mem, y: b.kvx[i] }, { m: count * MEM_ROWS }, { output: kvOut }).op);
        }
        return ops;
    }

    /** Memory keys the cross-attention reads: 296, or the 256 image tokens when no character in the batch has a reference. */
    private keys = MEM_ROWS;
    private readonly keyFields: { buffer: GPUBuffer; params: number[] }[] = [];

    /** Sets the cross-attention key count (rewrites those ops' uniforms; call between runs). */
    setMemoryKeys(keys: number): void {
        if (keys === this.keys) return;
        this.keys = keys;
        const nk = ATTN_FIELDS.indexOf('nk');
        for (const { buffer, params } of this.keyFields) {
            params[nk] = keys;
            this.layers.graph.device.queue.writeBuffer(buffer, 0, new Uint32Array(params));
        }
    }

    private buildStep(first: boolean): StepOp[] {
        const L = this.layers;
        const g = L.graph;
        const s = this.scratch;
        const b = this.buffers;
        const half = this.half;
        const steps: StepOp[] = [];
        const dyn = { dyn: true };
        const perSlot = (op: Op, x: (rows: number) => [number, number, number]): StepOp => ({ op, count: x });
        const attention = (label: string, nqb: 1 | 8, kv: GPUBuffer, kvHalf: boolean, fields: Record<string, number>, q: GPUBuffer, o: GPUBuffer, mask: boolean, nq: number): StepOp => {
            const params = ATTN_FIELDS.map(name => fields[name] ?? 0);
            const kernel = attentionKernel(nqb, kvHalf);
            const uniform = g.uniform(params);
            const pipeline = g.pipeline(kernel);
            const group = g.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [q, kv, o, b.state, mask ? b.mask : g.none, uniform].map((buffer, binding) => ({ binding, resource: { buffer } })),
            });
            if (mask) this.keyFields.push({ buffer: uniform, params });
            const blocks = Math.ceil(nq / nqb);
            return { op: { label, pipeline, group, count: [blocks, 6, 1] }, count: rows => [blocks, 6, rows] };
        };
        const kvStore = half ? 'kv16' as const : 'kv32' as const;

        steps.push(perSlot(g.op(first ? 'embed0' : 'embed', embedKernel(half), {
            W: L.weights, fm: b.fmap, segs: b.segs, cont: b.cont, st: b.state, feat: s.FEAT, loc: s.LOCF, x: s.X,
        }, [L.word('bos'), L.word('tpos'), L.word('cont_in.table')], [1, 1, 1]), rows => [rows, 1, 1]));
        if (!first) {
            steps.push(L.linear('seg_in.0', 'seg_in.0', { x: s.FEAT, y: s.SEGT, st: b.state }, { flags: LIN_SILU }, dyn));
            steps.push(L.linear('seg_in.2', 'seg_in.2', { x: s.SEGT, y: s.X, st: b.state }, { flags: LIN_ACCUM }, dyn));
            steps.push(L.linear('loc_in', 'loc_in', { x: s.LOCF, y: s.X, st: b.state }, { flags: LIN_ACCUM }, dyn));
        }
        for (let i = 0; i < LAYERS; i += 1) {
            const p = `layers.${i}`;
            steps.push(L.linear(`${p}.qkv`, `L${i}.qkv`, { x: s.X, y: s.Qd, st: b.state, kv: b.kvc[i] }, { ln: `${p}.n0`, ldy: D, d: D, tmax: TMAX, kvld: 2 * D }, { output: kvStore, dyn: true }));
            steps.push(attention(`${p}.sa`, 1, b.kvc[i], half, { nq: 1, ldq: D, ldkv: 2 * D, voff: D, kvgs: TMAX, ldo: D, flags: ATT_SLOT | ATT_DYNK }, s.Qd, s.ATT, false, 1));
            steps.push(L.linear(`${p}.sa.out`, `${p}.sa.out_proj`, { x: s.ATT, y: s.X, st: b.state }, { flags: LIN_ACCUM }, dyn));
            steps.push(L.linear(`${p}.ca.q`, `${p}.ca.q`, { x: s.X, y: s.Qd, st: b.state }, { ln: `${p}.n1` }, dyn));
            steps.push(attention(`${p}.ca`, 1, b.kvx[i], half, { nq: 1, ldq: D, ldkv: 2 * D, voff: D, kvgs: MEM_ROWS, nk: MEM_ROWS, ldo: D, mgs: MEM_ROWS, flags: ATT_SLOT | ATT_MASK }, s.Qd, s.ATT, true, 1));
            steps.push(L.linear(`${p}.ca.out`, `${p}.ca.out_proj`, { x: s.ATT, y: s.X, st: b.state }, { flags: LIN_ACCUM }, dyn));
            steps.push(L.linear(`${p}.ff.0`, `${p}.ff.0`, { x: s.X, y: s.H, st: b.state }, { ln: `${p}.n2`, flags: LIN_SILU }, dyn));
            steps.push(L.linear(`${p}.ff.2`, `${p}.ff.2`, { x: s.H, y: s.X, st: b.state }, { flags: LIN_ACCUM }, dyn));
        }
        steps.push(L.linear('head', 'head', { x: s.X, y: s.HH, st: b.state }, { ln: 'nf', flags: LIN_SILU, actN: D }, dyn));
        steps.push(L.linear('coarse.2', 'coarse.2', { x: s.HH, y: s.COARSE, st: b.state }, { ldx: 2 * D }, dyn));
        const tok = { dyn: true };
        for (let j = 0; j < REFINES; j += 1) {
            const p = `refs.${j}`;
            const r16 = { rowMul: 16 };
            steps.push(perSlot(g.op(`${p}.sample`, refineSampleKernel(half), {
                W: L.weights, fm: b.fmap, st: b.state, q: s.QT, pos: s.POS, hh: s.HH, coarse: s.COARSE, sf: s.SF,
            }, [L.word(`R${j}.offw.w`), L.word(`R${j}.offw.b`), L.word('point.table'), j === 0 ? 1 : 0], [16, 1, 1]), rows => [rows * 16, 1, 1]));
            steps.push(L.linear(`${p}.loc`, `${p}.loc`, { x: s.SF, y: s.QT, st: b.state }, { ...r16, ldx: 160, flags: LIN_ACCUM }, tok));
            steps.push(L.linear(`${p}.pos.0`, `${p}.pos.0`, { x: s.SF, y: s.PM1, st: b.state }, { ...r16, ldx: 160, xoff: 128, flags: LIN_SILU }, tok));
            steps.push(L.linear(`${p}.pos.2`, `${p}.pos.2`, { x: s.PM1, y: s.PM, st: b.state }, r16, tok));
            steps.push(L.linear(`${p}.qkv`, `R${j}.qkv`, { x: s.QT, y: s.QKV, st: b.state, a2: s.PM }, { ...r16, ln: `${p}.n0`, ld2: D }, { input: 'lnAdd', dyn: true }));
            steps.push(attention(`${p}.sa`, 8, s.QKV, false, { nq: 16, ldq: 3 * D, ldkv: 3 * D, koff: D, voff: 2 * D, kvgs: 16, nk: 16, ldo: D }, s.QKV, s.ATT2, false, 16));
            steps.push(L.linear(`${p}.sa.out`, `${p}.sa.out_proj`, { x: s.ATT2, y: s.QT, st: b.state }, { ...r16, flags: LIN_ACCUM }, tok));
            steps.push(L.linear(`${p}.ca.q`, `${p}.ca.q`, { x: s.QT, y: s.QQ, st: b.state }, { ...r16, ln: `${p}.n1` }, tok));
            steps.push(attention(`${p}.ca`, 8, b.kvx[LAYERS + j], half, { nq: 16, ldq: D, ldkv: 2 * D, voff: D, kvgs: MEM_ROWS, nk: MEM_ROWS, ldo: D, mgs: MEM_ROWS, flags: ATT_SLOT | ATT_MASK }, s.QQ, s.ATT2, true, 16));
            steps.push(L.linear(`${p}.ca.out`, `${p}.ca.out_proj`, { x: s.ATT2, y: s.QT, st: b.state }, { ...r16, flags: LIN_ACCUM }, tok));
            steps.push(L.linear(`${p}.ff.0`, `${p}.ff.0`, { x: s.QT, y: s.H2, st: b.state }, { ...r16, ln: `${p}.n2`, flags: LIN_SILU }, tok));
            steps.push(L.linear(`${p}.ff.2`, `${p}.ff.2`, { x: s.H2, y: s.QT, st: b.state }, { ...r16, flags: LIN_ACCUM }, tok));
            steps.push(L.linear(`${p}.head.0`, `${p}.head.0`, { x: s.QT, y: s.T2b, st: b.state }, { ...r16, ln: `${p}.n3`, flags: LIN_SILU }, tok));
            steps.push(L.linear(`${p}.head.2`, `${p}.head.2`, { x: s.T2b, y: s.POS, st: b.state }, { ...r16, flags: LIN_ACCUM }, tok));
        }
        this.decideParams = [L.word('nf.g'), L.word('nf.b'), L.word('dec.w'), L.word('dec.b'), 1, STATE_HEAD + this.capacity];
        this.decideUniform ??= g.uniform(this.decideParams);
        steps.push(perSlot(g.op('decide', DECIDE, {
            W: L.weights, st: b.state, x: s.X, pos: s.POS, coarse: s.COARSE, segs: b.segs, cont: b.cont, rec: b.rec,
        }, this.decideUniform, [1, 1, 1]), rows => [rows, 1, 1]));
        steps.push(perSlot(g.op('advance', ADVANCE, { st: b.state }, null, [1, 1, 1]), () => [1, 1, 1]));
        return steps;
    }

    /** Switches the decision between generating (writes segs / cont / done) and teacher forcing (records only). */
    setGenerating(gen: boolean): void {
        if (!this.decideUniform) return;
        this.decideParams[4] = gen ? 1 : 0;
        this.layers.graph.device.queue.writeBuffer(this.decideUniform, 0, new Uint32Array(this.decideParams));
    }
}
