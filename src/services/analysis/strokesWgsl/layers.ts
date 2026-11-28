/// <reference types="@webgpu/types" />
import { gemmCount, type Buffers, type GpuGraph, type Op } from './graph';
import {
    CONV_ACCUM, CONV_SILU, GN_FINAL, GN_PARTIAL, convKernel, flat, gnApplyKernel, linearKernel, linearParams, skinnyCount,
    type GemmMode, type LinearInput, type LinearOutput, type LinearParams,
} from './kernels';
import type { PackedEntry } from './packed';

// src/services/analysis/strokesWgsl/layers.ts
// Layer-level builders over kernels.ts for both models: a Conv2d (weights' conv metadata from the
// export), GroupNorm statistics, the GroupNorm apply passes and a Linear - each returns ready `Op`s
// whose uniforms point into the one packed weight buffer by entry name.
// A decode-time Linear reads its row count from the state buffer (rows = active * rowMul), so its op
// carries `rows` and the workgroup count is recomputed for the batch the host dispatches (`sized`).

export interface ConvMeta { cin: number; k: [number, number]; stride: [number, number]; pad: [number, number] }

/** A dispatch whose workgroup count depends on the active rows of a decode step. */
export interface StepOp {
    op: Op;
    count: (rows: number) => [number, number, number];
    /** A linear's skinny (GEMV) variant and the active rows up to which it is used instead. */
    skinny?: { op: Op; count: (rows: number) => [number, number, number]; upTo: number };
}

/** Active slots up to which a decode linear runs its skinny variant (times its rowMul: rows of the GEMM). */
export const SKINNY_UP_TO = 32;

/** An op's copy with the workgroups for `rows` active slots (the skinny variant for few rows). */
export const sized = (step: StepOp, rows: number): Op => (step.skinny && rows <= step.skinny.upTo
    ? { ...step.skinny.op, count: step.skinny.count(rows) }
    : { ...step.op, count: step.count(rows) });

/** Values a GroupNorm statistics pass parts its group into (keeps each workgroup's chunk near 8K values). */
const gnParts = (n: number) => Math.max(1, Math.min(64, Math.ceil(n / 8192)));

export class Layers {
    constructor(
        readonly graph: GpuGraph,
        readonly weights: GPUBuffer,
        readonly entries: Record<string, PackedEntry>,
        readonly convs: Record<string, ConvMeta>,
        readonly mode: GemmMode,
    ) {}

    word(name: string): number {
        const entry = this.entries[name] as PackedEntry | undefined;
        if (!entry) throw new Error(`no packed entry ${name}`);
        return entry.word;
    }

    /** Output side of `name`'s conv on a hin x win input. */
    convOut(name: string, hin: number): number {
        const meta = this.convs[`${name}.w`];
        return Math.floor((hin + 2 * meta.pad[0] - meta.k[0]) / meta.stride[0]) + 1;
    }

    /**
     * Conv2d `name` (weights name.w / name.b) over z images [cin, hin, hin] -> y [m, hout, hout]; `gn`: input
     * through GroupNorm (stats `st`, affine `gn.norm`.g / .b) + SiLU; `silu` on the output; `accum` adds into y.
     */
    conv(name: string, x: Buffers[string], y: Buffers[string], z: number, hin: number, options: { gn?: { st: GPUBuffer; norm: string }; accum?: boolean; silu?: boolean } = {}): Op {
        const meta = this.convs[`${name}.w`];
        const entry = this.entries[`${name}.w`];
        const m = entry.shape[0];
        const k = entry.shape[1];
        const hout = this.convOut(name, hin);
        const params = [m, k, meta.cin, meta.k[0], meta.k[1], meta.stride[0], meta.pad[0], hin, hin, hout, hout, entry.word, this.word(`${name}.b`),
            options.gn ? this.word(`${options.gn.norm}.g`) : 0, options.gn ? this.word(`${options.gn.norm}.b`) : 0, (options.accum ? CONV_ACCUM : 0) | (options.silu ? CONV_SILU : 0)];
        const buffers: Buffers = { W: this.weights, x, y };
        if (options.gn) buffers.st = options.gn.st;
        return this.graph.op(name, convKernel(this.mode, Boolean(options.gn)), buffers, params, gemmCount(m, hout * hout, z));
    }

    /** GroupNorm (8 groups) statistics of x [z, c, hw] into st [z * 8][mean, rstd]: two dispatches. */
    gnStats(label: string, x: GPUBuffer, z: number, c: number, hw: number, st: GPUBuffer): Op[] {
        const n = (c / 8) * hw;
        const parts = gnParts(n);
        const partial = this.graph.buffer(z * 8 * parts * 3 * 4);
        return [
            this.graph.op(`${label}.gn1`, GN_PARTIAL, { x, pt: partial }, [n, parts], [parts, z * 8, 1]),
            this.graph.op(`${label}.gn2`, GN_FINAL, { pt: partial, st }, [z * 8, parts], [Math.ceil((z * 8) / 64), 1, 1]),
        ];
    }

    /** own2's residual Blk output: y = silu(GN(x)) + skip, all [z, c, hw]. */
    gnSiluSkip(label: string, x: GPUBuffer, st: GPUBuffer, skip: GPUBuffer, y: GPUBuffer, z: number, c: number, hw: number, norm: string): Op {
        const total = z * c * hw;
        return this.graph.op(label, gnApplyKernel('siluSkip', false), { W: this.weights, x, st, s: skip, y }, [c, hw, total, this.word(`${norm}.g`), this.word(`${norm}.b`), 0], flat(total));
    }

    /** own2's conv -> GN -> SiLU: y = silu(GN(x)), all [z, c, hw]. */
    gnSilu(label: string, x: GPUBuffer, st: GPUBuffer, y: GPUBuffer, z: number, c: number, hw: number, norm: string): Op {
        const total = z * c * hw;
        return this.graph.op(label, gnApplyKernel('silu', false), { W: this.weights, x, st, y }, [c, hw, total, this.word(`${norm}.g`), this.word(`${norm}.b`), 0], flat(total));
    }

    /** full6's fmap: GN(x) written channel-last [z, hw, c] at element offset `off` of y (f16 storage when `half`). */
    gnChannelLast(label: string, x: GPUBuffer, st: GPUBuffer, y: GPUBuffer, z: number, c: number, hw: number, norm: string, off: number, half: boolean): Op {
        const total = z * c * hw;
        return this.graph.op(label, gnApplyKernel('channelLast', half), { W: this.weights, x, st, y }, [c, hw, total, this.word(`${norm}.g`), this.word(`${norm}.b`), off], flat(total));
    }

    /**
     * Linear `name` (name.w [n, k], name.b unless `bias: false`) as linearKernel; `rows` fixed (count known)
     * or, with `rowMul`, dynamic (state rows x rowMul). `ln`: the LayerNorm `ln`.g / .b on the input.
     */
    linear(label: string, name: string, buffers: Buffers, fields: LinearParams & { ln?: string; bias?: string | false }, io: { input?: LinearInput; output?: LinearOutput; dyn?: boolean } = {}): StepOp {
        const entry = this.entries[`${name}.w`] ?? this.entries[name];
        const [n, k] = entry.shape;
        const { ln, bias, ...rest } = fields;
        const given: LinearParams = { n, k, w: entry.word, ...rest };
        if (bias !== false) given.b = this.word(bias ?? `${name}.b`);
        if (ln) { given.lg = this.word(`${ln}.g`); given.lb = this.word(`${ln}.b`); }
        const input = io.input ?? (ln ? 'ln' : 'plain');
        const output = io.output ?? 'f32';
        const dyn = io.dyn ?? false;
        if (dyn) given.rowMul ??= 1;
        const kernel = linearKernel(this.mode, input, output, dyn);
        const params = linearParams(given);
        const rowMul = given.rowMul ?? 1;
        const count = (rows: number) => gemmCount(dyn ? rows * rowMul : (given.m ?? 0), n);
        const op = this.graph.op(label, kernel, { W: this.weights, ...buffers }, params, count(dyn ? 1 : 0));
        if (!dyn) return { op, count };
        const skinny = this.graph.op(`${label}.skinny`, linearKernel(this.mode, input, output, dyn, true), { W: this.weights, ...buffers }, params, [1, 1, 1]);
        return { op, count, skinny: { op: skinny, count: rows => skinnyCount(rows * rowMul, n), upTo: Math.floor(SKINNY_UP_TO / rowMul) } };
    }
}
