/// <reference types="@webgpu/types" />
import { SERIAL_PACING, type SlicePacing } from '../gpuSlices';
import { GpuGraph, OpRunner, profileOps, readBuffer, usableCosts, type Op } from './graph';
import { Full6Graph, SEGS, full6Spec } from './full6Graph';
import { segFeat } from './hostMath';
import { MEM_ROWS, REC, STATE_HEAD, TMAX } from './kernelsSeq';
import { Layers, sized, type ConvMeta, type StepOp } from './layers';
import { repack, unpackStrokes } from './packed';

// src/services/analysis/strokesWgsl/full6.ts
// full6 (glyph -> ordered stroke segments) on hand-written WGSL: a batch of characters decoded in lockstep,
// greedy as seqinfer.generate. Each step runs every active slot; the decision kernel marks a character
// done on the GPU (its continue / end decisions and the next step's input never leave the GPU), the host
// reads the done flags back only every `readEvery` steps and drops finished characters from the slot
// table. Work is submitted in slices of about `pacing.sliceMs` GPU time (per-dispatch costs measured
// with timestamps on the first run), and `between` is awaited after every readback group - where a
// scheduler can let other GPU work in.
//
// Inputs are the precomputed features (HANDOFF_FOLIA.md §2: img [3, 256, 256] = ink, clip(inside/12),
// clip(outside/24)); the kaishu reference (q [40, 16, 2], m [40]) is optional per glyph, and
// `useReference: false` drops it for the whole batch (drop=True).

export interface Full6Glyph {
    /** [3, 256, 256] features. */
    img: Float32Array;
    /** Reference segments [40, 16, 2] (canvas coordinates) and their valid flags [40]; omitted = no reference. */
    refQ?: Float32Array;
    refM?: Uint8Array;
}

export interface Full6Result {
    /** [n, 16, 2] segments in writing order. */
    segs: Float32Array;
    /** [n] 1 = continues the previous segment's pen. */
    cont: Uint8Array;
}

export interface Full6RunOptions {
    /** false: every glyph without its reference (seqinfer drop=True). Default true. */
    useReference?: boolean;
    pacing?: SlicePacing;
    /** Steps between done readbacks (default 8). */
    readEvery?: number;
    /** Awaited after each readback group: the scheduler's slot between groups of steps. */
    between?: () => Promise<void> | void;
}

export interface Full6RunStats {
    encodeMs: number;
    decodeMs: number;
    steps: number;
    /** Dispatches submitted over the decode. */
    dispatches: number;
    submits: number;
    /** Longest single dispatch in the cost table, ms (null without one). */
    longestMs: number | null;
}

/** Teacher-forced per-step outputs, per character [steps][REC]: pos 32, coarse 32, cont logit, end logit. */
export interface Full6Record {
    rec: Float32Array;
    steps: number;
}

export class Full6Wgsl {
    private readonly costs = new Map<string, number>();
    private profiled = { encoder: false, step: false };
    lastStats: Full6RunStats | null = null;

    private constructor(private readonly device: GPUDevice, private readonly graph: GpuGraph, readonly net: Full6Graph) {}

    /** Per-dispatch GPU ms by op label, from the first paced run's timestamps (empty before one). */
    get costTable(): ReadonlyMap<string, number> {
        return this.costs;
    }

    /** GPU memory held, bytes. */
    get bytes(): number {
        return this.graph.owned.reduce((sum, buffer) => sum + buffer.size, 0);
    }

    /** Byte offset of the done words in the state buffer. */
    private get doneAt(): number {
        return (STATE_HEAD + this.net.capacity) * 4;
    }

    get capacity(): number {
        return this.net.capacity;
    }

    /**
     * Uploads full6-folia.bin's weights and allocates a batch of `capacity` characters (encoded `chunk`
     * at a time; default 4: each big encoder conv stays near 2.5 ms, half chunk 8's, for ~4% throughput).
     * f16: GEMMs (and the KV / fmap storage) in f16; needs a device with shader-f16.
     */
    static async create(device: GPUDevice, file: Uint8Array, options: { f16?: boolean; capacity?: number; chunk?: number } = {}): Promise<Full6Wgsl> {
        if (options.f16 && !device.features.has('shader-f16')) throw new Error('full6 f16 needs a device opened with shader-f16');
        const { weights, manifest } = unpackStrokes(file);
        if (manifest.model !== 'strokenet-full6') throw new Error(`not full6 weights: ${manifest.model}`);
        const packed = repack(weights, manifest, full6Spec(manifest));
        const graph = new GpuGraph(device);
        const w = graph.buffer(packed.data.byteLength);
        device.queue.writeBuffer(w, 0, packed.data);
        const convs: Record<string, ConvMeta> = {};
        for (const [name, tensor] of Object.entries(manifest.tensors)) if (tensor.conv) convs[name] = tensor.conv;
        const chunk = Math.max(1, Math.min(options.chunk ?? 4, options.capacity ?? 64));
        const capacity = Math.ceil((options.capacity ?? 64) / chunk) * chunk;
        const layers = new Layers(graph, w, packed.entries, convs, options.f16 ? 'f16' : 'f32');
        const net = new Full6Graph(layers, capacity, chunk);
        await device.queue.onSubmittedWorkDone();
        return new Full6Wgsl(device, graph, net);
    }

    destroy(): void {
        this.graph.destroy();
    }

    /** Runs `ops` through the runner, profiling them first if their graph has no cost table yet. */
    private async runOps(runner: OpRunner, ops: Op[], profile: 'encoder' | 'step' | null, paced: boolean): Promise<void> {
        if (paced && profile && !this.profiled[profile]) {
            this.profiled[profile] = true;
            await runner.flush();
            const measured = await profileOps(this.device, ops);
            if (measured) {
                if (usableCosts(measured)) ops.forEach((op, index) => this.costs.set(op.label, Math.max(this.costs.get(op.label) ?? 0, measured[index])));
                return;
            }
        }
        const costs = paced && this.costs.size ? ops.map(op => this.costs.get(op.label) ?? 0.05) : undefined;
        // Without a table a paced run is cut a dispatch per slice: slow but never one long submit.
        await runner.add(ops, costs ?? (paced ? ops.map(() => Infinity) : undefined));
    }

    /** Uploads a batch's inputs, encodes it (fmap, memory, cross K / V). */
    private async encode(runner: OpRunner, glyphs: Full6Glyph[], useReference: boolean, paced: boolean): Promise<void> {
        const n = glyphs.length;
        const { device } = this;
        const b = this.net.buffers;
        const mask = new Float32Array(n * MEM_ROWS);
        const feat = new Float32Array(n * SEGS * 160);
        let anyReference = false;
        glyphs.forEach((glyph, i) => {
            if (glyph.img.length !== 3 * 65536) throw new Error(`glyph ${i}: img must be [3, 256, 256]`);
            device.queue.writeBuffer(b.img, i * 3 * 65536 * 4, glyph.img.buffer, glyph.img.byteOffset, glyph.img.byteLength);
            for (let s = 0; s < SEGS; s += 1) {
                const valid = useReference && glyph.refQ && glyph.refM && glyph.refM[s];
                mask[i * MEM_ROWS + 256 + s] = valid ? 0 : -1e30;
                if (valid) anyReference = true;
                if (glyph.refQ) feat.set(segFeat(glyph.refQ.subarray(s * 32, s * 32 + 32)), (i * SEGS + s) * 160);
            }
        });
        device.queue.writeBuffer(b.mask, 0, mask);
        device.queue.writeBuffer(b.refFeat, 0, feat);
        this.net.setMemoryKeys(anyReference ? MEM_ROWS : 256);
        for (let chunk = 0; chunk * this.net.chunk < n; chunk += 1) await this.runOps(runner, this.net.encoderOps(chunk), 'encoder', paced);
        await this.runOps(runner, this.net.memoryOps(n), null, paced);
    }

    /** Writes the slot table: st[1] = slots, st[16..] = their characters (st[0], the step, is the GPU's). */
    private writeSlots(chars: number[]): void {
        const data = new Uint32Array(STATE_HEAD - 1 + chars.length);
        data[0] = chars.length;
        data.set(chars, STATE_HEAD - 1);
        this.device.queue.writeBuffer(this.net.buffers.state, 4, data);
    }

    /** Decodes until every character is done (or `limit` steps); `active(t, doneFlags)` is the slot list for the next group. */
    private async decode(
        runner: OpRunner, n: number, paced: boolean, options: Full6RunOptions, limitSteps: number,
        nextActive: (t: number, done: Uint32Array | null) => number[],
    ): Promise<{ steps: number; dispatches: number }> {
        const readEvery = Math.max(1, options.readEvery ?? 8);
        const { device } = this;
        const b = this.net.buffers;
        device.queue.writeBuffer(b.state, 0, new Uint32Array([0]));
        let active = nextActive(0, null);
        this.writeSlots(active);
        let t = 0;
        let dispatches = 0;
        while (t < limitSteps && active.length) {
            const group = Math.min(readEvery, limitSteps - t);
            for (let s = 0; s < group; s += 1, t += 1) {
                const steps: StepOp[] = t === 0 ? this.net.step0 : this.net.step;
                const ops = steps.map(step => sized(step, active.length));
                dispatches += ops.length;
                await this.runOps(runner, ops, t === 0 ? null : 'step', paced);
            }
            await runner.flush(true);
            const done = new Uint32Array(await readBuffer(device, b.state, n * 4, this.doneAt));
            active = nextActive(t, done);
            if (active.length) this.writeSlots(active);
            await options.between?.();
        }
        return { steps: t, dispatches };
    }

    private beginRun(options: Full6RunOptions): { runner: OpRunner; paced: boolean } {
        const pacing = options.pacing ?? SERIAL_PACING;
        return { runner: new OpRunner(this.device, pacing), paced: Number.isFinite(pacing.sliceMs) };
    }

    private finishStats(encodeMs: number, decodeMs: number, run: { steps: number; dispatches: number }, runner: OpRunner): void {
        const longest = this.costs.size ? Math.max(...this.costs.values()) : null;
        this.lastStats = { encodeMs, decodeMs, steps: run.steps, dispatches: run.dispatches, submits: runner.queue.slices, longestMs: longest };
    }

    /** Greedy generation for up to `capacity` glyphs at once (more are run capacity at a time). */
    async generate(glyphs: Full6Glyph[], options: Full6RunOptions = {}): Promise<Full6Result[]> {
        const results: Full6Result[] = [];
        for (let start = 0; start < glyphs.length; start += this.capacity) results.push(...await this.generateBatch(glyphs.slice(start, start + this.capacity), options));
        return results;
    }

    private async generateBatch(glyphs: Full6Glyph[], options: Full6RunOptions): Promise<Full6Result[]> {
        const n = glyphs.length;
        const { device } = this;
        const b = this.net.buffers;
        const { runner, paced } = this.beginRun(options);
        this.net.setGenerating(true);
        device.queue.writeBuffer(b.state, this.doneAt, new Uint32Array(n));
        device.queue.writeBuffer(b.segs, 0, new Float32Array(n * TMAX * 32));
        device.queue.writeBuffer(b.cont, 0, new Uint32Array(n * TMAX));
        const started = performance.now();
        await this.encode(runner, glyphs, options.useReference ?? true, paced);
        await runner.flush(true);
        const encoded = performance.now();
        const run = await this.decode(runner, n, paced, options, TMAX, (_t, done) => {
            const chars: number[] = [];
            for (let i = 0; i < n; i += 1) if (!done || !(done[i] & 1)) chars.push(i);
            return chars;
        });
        const decodeMs = performance.now() - encoded;
        this.finishStats(encoded - started, decodeMs, run, runner);
        const [segs, cont, done] = await Promise.all([
            readBuffer(device, b.segs, n * TMAX * 32 * 4).then(x => new Float32Array(x)),
            readBuffer(device, b.cont, n * TMAX * 4).then(x => new Uint32Array(x)),
            readBuffer(device, b.state, n * 4, this.doneAt).then(x => new Uint32Array(x)),
        ]);
        return glyphs.map((_, i) => {
            const length = done[i] & 1 ? done[i] >>> 8 : TMAX;
            return {
                segs: segs.slice(i * TMAX * 32, i * TMAX * 32 + length * 32),
                cont: Uint8Array.from(cont.subarray(i * TMAX, i * TMAX + length)),
            };
        });
    }

    /**
     * Teacher forcing (the alignment check): step t of glyph i is fed segment t - 1 of `inputs[i]` (and its
     * cont flag) and runs until `steps[i]`; returns every step's recorded outputs.
     */
    async teacherForce(glyphs: Full6Glyph[], inputs: { segs: Float32Array; cont: Uint8Array }[], steps: number[], options: Full6RunOptions = {}): Promise<Full6Record[]> {
        const n = glyphs.length;
        if (n > this.capacity) throw new Error(`teacherForce takes up to ${this.capacity} glyphs`);
        const { device } = this;
        const b = this.net.buffers;
        const { runner, paced } = this.beginRun(options);
        this.net.setGenerating(false);
        const segs = new Float32Array(n * TMAX * 32);
        const cont = new Uint32Array(n * TMAX);
        inputs.forEach((input, i) => {
            const count = Math.min(input.cont.length, TMAX);
            segs.set(input.segs.subarray(0, count * 32), i * TMAX * 32);
            for (let s = 0; s < count; s += 1) cont[i * TMAX + s] = input.cont[s];
        });
        device.queue.writeBuffer(b.segs, 0, segs);
        device.queue.writeBuffer(b.cont, 0, cont);
        device.queue.writeBuffer(b.state, this.doneAt, new Uint32Array(n));
        const started = performance.now();
        await this.encode(runner, glyphs, options.useReference ?? true, paced);
        await runner.flush(true);
        const encoded = performance.now();
        const limit = Math.min(TMAX, Math.max(...steps));
        const run = await this.decode(runner, n, paced, options, limit, (t) => {
            const chars: number[] = [];
            for (let i = 0; i < n; i += 1) if (steps[i] > t) chars.push(i);
            return chars;
        });
        this.finishStats(encoded - started, performance.now() - encoded, run, runner);
        this.net.setGenerating(true);
        const rec = new Float32Array(await readBuffer(device, b.rec, n * TMAX * REC * 4));
        return steps.map((count, i) => ({ rec: rec.slice(i * TMAX * REC, (i * TMAX + count) * REC), steps: count }));
    }

    /** A GPU buffer's contents (debugging and stage checks): fmap, mem, ... */
    async read(name: string, bytes: number, offset = 0): Promise<ArrayBuffer> {
        const buffer = (this.net.buffers as unknown as Record<string, GPUBuffer>)[name] ?? this.net.scratch[name];
        if (!buffer) throw new Error(`no buffer ${name}`);
        return readBuffer(this.device, buffer, bytes, offset);
    }
}
