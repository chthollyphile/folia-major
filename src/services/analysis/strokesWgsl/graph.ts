/// <reference types="@webgpu/types" />
import { MAX_TIMESTAMP_QUERIES, createSliceQueue, durationsFromTicks, type SlicePacing, type SliceQueue } from '../gpuSlices';
import type { Kernel } from './kernels';

// src/services/analysis/strokesWgsl/graph.ts
// The little bit of WebGPU plumbing the stroke-order runtimes share: pipelines compiled once per kernel
// source, a bind group per dispatch from named buffers (binding order = Kernel.bindings, the uniform
// after them), dispatches recorded as plain `Op`s, and a runner that encodes a list of them into
// submits cut at about `sliceMs` of GPU time by per-dispatch costs (gpuSlices.ts' queue paces them),
// plus a timestamp profiler that measures those costs (one compute pass a dispatch).

export interface Op {
    label: string;
    pipeline: GPUComputePipeline;
    group: GPUBindGroup;
    count: [number, number, number];
}

/** Buffers by binding name: a whole buffer, or a range of one (offset a multiple of 256). */
export type Buffers = Record<string, GPUBuffer | GPUBufferBinding>;

/** STORAGE | COPY_DST | COPY_SRC as the spec's numbers: no GPUBufferUsage global at import (node, no-WebGPU renderers). */
export const STORAGE = 0x80 | 0x08 | 0x04;

export class GpuGraph {
    private readonly pipelines = new Map<string, GPUComputePipeline>();
    /** Buffers this graph made (uniforms, scratch): destroyed by `destroy`. */
    readonly owned: GPUBuffer[] = [];
    private dummy: GPUBuffer | null = null;

    constructor(readonly device: GPUDevice) {}

    pipeline(kernel: Kernel): GPUComputePipeline {
        let found = this.pipelines.get(kernel.code);
        if (!found) {
            found = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code: kernel.code }), entryPoint: 'main' } });
            this.pipelines.set(kernel.code, found);
        }
        return found;
    }

    /** All the graph's pipelines compiled asynchronously ahead of the first dispatch (avoids a stall mid-run). */
    async precompile(kernels: Kernel[]): Promise<void> {
        await Promise.all(kernels.filter(k => !this.pipelines.has(k.code)).map(async (kernel) => {
            const module = this.device.createShaderModule({ code: kernel.code });
            const pipeline = await this.device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
            this.pipelines.set(kernel.code, pipeline);
        }));
    }

    buffer(bytes: number, usage = STORAGE): GPUBuffer {
        const buffer = this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });
        this.owned.push(buffer);
        return buffer;
    }

    /** A 16-byte placeholder for a binding a variant does not read. */
    get none(): GPUBuffer {
        this.dummy ??= this.buffer(16);
        return this.dummy;
    }

    uniform(values: readonly number[]): GPUBuffer {
        const data = new Uint32Array(Math.max(4, Math.ceil(values.length / 4) * 4));
        values.forEach((value, index) => { data[index] = value >>> 0; });
        const buffer = this.buffer(data.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }

    /** One dispatch of `kernel` over `buffers` (by binding name) with its uniform `params`. */
    op(label: string, kernel: Kernel, buffers: Buffers, params: readonly number[] | GPUBuffer | null, count: [number, number, number]): Op {
        const pipeline = this.pipeline(kernel);
        const entries: GPUBindGroupEntry[] = kernel.bindings.map((name, binding) => {
            const buffer = buffers[name] as Buffers[string] | undefined;
            if (!buffer) throw new Error(`${label}: no buffer for binding ${name}`);
            return { binding, resource: 'buffer' in buffer ? buffer : { buffer } };
        });
        if (kernel.uniform) {
            if (!params) throw new Error(`${label}: uniform missing`);
            entries.push({ binding: kernel.bindings.length, resource: { buffer: params instanceof GPUBuffer ? params : this.uniform(params) } });
        }
        return { label, pipeline, group: this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }), count };
    }

    destroy(): void {
        for (const buffer of this.owned) buffer.destroy();
        this.owned.length = 0;
    }
}

/** Workgroups for a GEMM of M x N (64 x 64 tiles), z deep. */
export const gemmCount = (m: number, n: number, z = 1): [number, number, number] => [Math.ceil(n / 64), Math.ceil(m / 64), z];

/**
 * Encodes ops into submits: a new submit starts before the op that would take the current one past
 * `sliceMs` by `costs` (ms an op; none: one submit), each handed to `queue`. Returns when the last is
 * submitted (and, with `last`, done).
 */
export class OpRunner {
    private encoder: GPUCommandEncoder;
    private pass: GPUComputePassEncoder | null = null;
    private sum = 0;
    private recorded = false;
    readonly queue: SliceQueue;

    constructor(private readonly device: GPUDevice, private readonly pacing: SlicePacing) {
        this.queue = createSliceQueue(device.queue, pacing);
        this.encoder = device.createCommandEncoder();
    }

    /** Records `ops`, cutting submits by `costs` (same length; omitted: no cuts here). */
    async add(ops: readonly Op[], costs?: ArrayLike<number>): Promise<void> {
        for (let index = 0; index < ops.length; index += 1) {
            const cost = costs ? costs[index] : 0;
            if (this.recorded && this.sum > 0 && this.sum + cost > this.pacing.sliceMs) await this.flush();
            const op = ops[index];
            this.pass ??= this.encoder.beginComputePass();
            this.pass.setPipeline(op.pipeline);
            this.pass.setBindGroup(0, op.group);
            this.pass.dispatchWorkgroups(...op.count);
            this.sum += cost;
            this.recorded = true;
        }
    }

    /** A copy between dispatches (ends the pass). */
    copy(from: GPUBuffer, to: GPUBuffer, bytes: number, fromOffset = 0, toOffset = 0): void {
        this.pass?.end();
        this.pass = null;
        this.encoder.copyBufferToBuffer(from, fromOffset, to, toOffset, bytes);
        this.recorded = true;
    }

    /** Submits what is recorded; `last` waits for every submit to finish. */
    async flush(last = false): Promise<void> {
        this.pass?.end();
        this.pass = null;
        const commands = this.encoder.finish();
        this.encoder = this.device.createCommandEncoder();
        this.sum = 0;
        this.recorded = false;
        await this.queue.submit(commands, last);
    }
}

/**
 * Runs the ops once, each in its own timestamped pass, `perSubmit` a submit (each waited for, so a
 * profiled first run is still cut small), and returns GPU ms per op (check `usableCosts`) - or null
 * without timestamp-query, the ops then not run: the caller runs them its usual way.
 */
export const profileOps = async (device: GPUDevice, ops: readonly Op[], perSubmit = 16): Promise<Float64Array | null> => {
    if (!device.features.has('timestamp-query')) return null;
    const result = new Float64Array(ops.length);
    const chunk = Math.min(MAX_TIMESTAMP_QUERIES / 2, perSubmit);
    for (let start = 0; start < ops.length; start += chunk) {
        const part = ops.slice(start, start + chunk);
        const querySet = device.createQuerySet({ type: 'timestamp', count: part.length * 2 });
        const encoder = device.createCommandEncoder();
        part.forEach((op, index) => {
            const pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 } });
            pass.setPipeline(op.pipeline);
            pass.setBindGroup(0, op.group);
            pass.dispatchWorkgroups(...op.count);
            pass.end();
        });
        const bytes = part.length * 16;
        const resolved = device.createBuffer({ size: bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        encoder.resolveQuerySet(querySet, 0, part.length * 2, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, read, 0, bytes);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        result.set(durationsFromTicks(new BigInt64Array(read.getMappedRange()), part.length), start);
        read.destroy();
        resolved.destroy();
        querySet.destroy();
    }
    return result;
};

/** Whether a profile came back sane (a driver may answer zeros). */
export const usableCosts = (costs: Float64Array): boolean => costs.every(ms => Number.isFinite(ms) && ms >= 0) && costs.some(ms => ms > 0);

/** Reads `bytes` of a GPU buffer back (after the queue's work so far). */
export const readBuffer = async (device: GPUDevice, buffer: GPUBuffer, bytes: number, offset = 0): Promise<ArrayBuffer> => {
    const read = device.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, offset, read, 0, read.size);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const out = read.getMappedRange().slice(0, bytes);
    read.destroy();
    return out;
};
