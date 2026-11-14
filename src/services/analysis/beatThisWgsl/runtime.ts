/// <reference types="@webgpu/types" />
import {
    ATTENTION, ATTENTION_F16, ATTENTION_F16_MATH, CONV_GELU, FLATTEN, MATMUL, MATMUL_F16, MATMUL_F16_MATH, MATMUL_F16W, MATMUL_GELU, MATMUL_NORM, MATMUL_RESIDUAL, MATMUL_ROPE, STEM_BN, SUM_HEAD,
} from './kernels';
import {
    DEFAULT_PACING, DispatchCosts, MAX_TIMESTAMP_QUERIES, costSummary, createSliceQueue, durationsFromTicks, median,
    type PacedRunStats, type SlicePacing,
} from '../gpuSlices';

// src/services/analysis/beatThisWgsl/runtime.ts
// Runs one Beat This! chunk (mel [T, 128] -> beat / downbeat logits [T], T up to 1500) on a WebGPU
// device with the kernels in ./kernels. The graph is fixed per chunk length, so every pipeline,
// buffer, uniform and bind group is built ahead (the full 1500-frame graph in `create`, a shorter one
// the first time that length is run); a run only uploads the mel, records the dispatches and reads
// the two logit tracks back. Weights come from build/beat_this_wgsl/export_weights.py.

export const BEAT_THIS_WGSL_FRAMES = 1500;
const MEL_BINS = 128;
const HEAD_DIM = 32;

export interface BeatThisWgslManifest {
    hyper_parameters: { transformer_dim: number; n_layers: number; stem_dim: number; ff_mult: number };
    /** `stride`: padded row length of a matmul weight; dtype 'f16' only for those, from the --f16 export. */
    tensors: Record<string, { byte_offset: number; shape: number[]; dtype: 'f32' | 'f16'; stride?: number }>;
    bytes: number;
}

export interface BeatThisWgslResult {
    beat: Float32Array;
    downbeat: Float32Array;
    /** Time spent waiting on the GPU between slices, ms (submit to done, summed, when one slice is in flight). */
    gpuMs: number;
    /** The whole run, ms: gpuMs plus recording, and the waits between slices. */
    wallMs: number;
    /** Command buffers submitted. */
    slices: number;
    /** With slice 'paced': how it was cut and paced, and the cost table once this run completed it. */
    paced?: PacedRunStats;
    /** Intermediate activations by stage name, only when asked for. Frontend stages are [F, T, C]. */
    stages?: Record<string, Float32Array>;
    /** GPU time of every dispatch in order, when profiling was asked for and the device has timestamp-query. */
    profile?: { label: string; ms: number }[];
}

interface Binding { buffer: GPUBuffer; offset?: number; size?: number }
type Step =
    | { kind: 'dispatch'; label: string; pipeline: GPUComputePipeline; group: GPUBindGroup; count: [number, number, number] }
    | { kind: 'stage'; name: string; buffer: GPUBuffer; floats: number };
/** One chunk length's dispatches, and the uniforms only they use. */
interface Built { steps: Step[]; owned: GPUBuffer[] }
/** A built graph with its GPU time per dispatch, measured on its first paced runs, that 'paced' cuts by. */
interface Graph extends Built { costs: DispatchCosts; dispatches: number }

const product = (shape: number[]) => shape.reduce((a, b) => a * b, 1);

/**
 * The full-chunk graph's cost table by device and variant (f32 or an f16 mode): kept past a model
 * released while idle and loaded again on the same device. A short chunk's graph, built for one
 * track's last chunk, gets a table of its own that goes with it.
 */
const costTables = new WeakMap<GPUDevice, Map<string, DispatchCosts>>();

/** Short kernel names for profiling labels. */
const KERNEL_NAMES = new Map<string, string>([
    [STEM_BN, 'stem_bn'], [CONV_GELU, 'conv'], [MATMUL, 'matmul'], [MATMUL_F16W, 'matmul'], [MATMUL_F16, 'matmul'], [MATMUL_F16_MATH, 'matmul'],
    [ATTENTION, 'attention'], [ATTENTION_F16, 'attention'], [ATTENTION_F16_MATH, 'attention'], [FLATTEN, 'flatten'], [SUM_HEAD, 'sum_head'],
]);

export class BeatThisWgsl {
    private constructor(
        private readonly device: GPUDevice,
        private readonly build: (frames: number) => Built,
        private readonly melBuffer: GPUBuffer,
        private readonly outBuffer: GPUBuffer,
        private readonly owned: GPUBuffer[],
        private readonly variant: string,
    ) {}

    /** Graphs by chunk length: the full one, and the most recent shorter one. */
    private readonly graphs = new Map<number, Graph>();
    /** Whether a paced run of this instance has reported the full graph's cost table (once a load: the page logs it). */
    private reported = false;

    /** GPU memory this model holds (weights and every graph built), bytes: for a residency budget. */
    get bytes(): number {
        let sum = this.owned.reduce((total, buffer) => total + buffer.size, 0);
        for (const graph of this.graphs.values()) sum += graph.owned.reduce((total, buffer) => total + buffer.size, 0);
        return sum;
    }

    private graph(frames: number): Graph {
        let found = this.graphs.get(frames);
        if (!found) {
            // A short chunk is the last of a track (or all of a short one), so the next short length
            // is almost never this one again; keep one, not one per track ever played.
            for (const [length, old] of this.graphs) {
                if (length === BEAT_THIS_WGSL_FRAMES) continue;
                old.owned.forEach(buffer => buffer.destroy());
                this.graphs.delete(length);
            }
            const built = this.build(frames);
            const dispatches = built.steps.filter(step => step.kind === 'dispatch').length;
            let costs = new DispatchCosts(dispatches);
            if (frames === BEAT_THIS_WGSL_FRAMES) {
                let tables = costTables.get(this.device);
                if (!tables) costTables.set(this.device, tables = new Map<string, DispatchCosts>());
                const kept = tables.get(this.variant);
                if (kept) costs = kept;
                else tables.set(this.variant, costs);
            }
            found = { ...built, dispatches, costs };
            this.graphs.set(frames, found);
        }
        return found;
    }

    /**
     * Uploads the weights (the .bin as written, f32 or --f16) and builds the whole fixed graph for one
     * 1500-frame chunk; shorter chunks get theirs on first use. `f16` (device created with 'shader-f16'): 'storage' keeps matmul and attention
     * tiles in f16 with f32 arithmetic, 'math' multiplies in f16 too (see kernels.ts for what each
     * costs). Without it the fp16 weights are unpacked and everything is computed in f32.
     */
    static async create(device: GPUDevice, weights: Uint8Array, manifest: BeatThisWgslManifest,
        options: { f16?: 'storage' | 'math' } = {}): Promise<BeatThisWgsl> {
        if (options.f16 && !device.features.has('shader-f16')) throw new Error('beat_this f16: device lacks shader-f16');
        const T = BEAT_THIS_WGSL_FRAMES;
        const owned: GPUBuffer[] = [];
        const storage = (floats: number, extra = 0) => {
            const buffer = device.createBuffer({
                size: Math.max(16, floats * 4),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extra,
            });
            owned.push(buffer);
            return buffer;
        };

        const weightBuffer = storage(Math.ceil(weights.byteLength / 4));
        device.queue.writeBuffer(weightBuffer, 0, weights.buffer, weights.byteOffset, weights.byteLength);
        const entry = (name: string) => {
            const found = manifest.tensors[name];
            if (!found) throw new Error(`beat_this weights: missing tensor ${name}`);
            return found;
        };
        const tensor = (name: string): Binding => {
            const { byte_offset: offset, shape, dtype, stride } = entry(name);
            const elements = stride ? shape[0] * stride : product(shape);
            return { buffer: weightBuffer, offset, size: elements * (dtype === 'f16' ? 2 : 4) };
        };
        const shape = (name: string) => manifest.tensors[name].shape;

        // Activations, sized for the largest stage that uses each (block 0 for most, see kernels.ts).
        const dim = manifest.hyper_parameters.transformer_dim;
        const stem = manifest.hyper_parameters.stem_dim;
        const ffMult = manifest.hyper_parameters.ff_mult;
        const tokens0 = (MEL_BINS / 4) * T; // block 0: 32 freqs x T frames
        const maxWidth = (c: number) => 3 * c + c / HEAD_DIM;
        const melBuffer = storage(T * MEL_BINS);
        const stemIn = storage(T * MEL_BINS);
        const x = [storage(tokens0 * stem), storage(tokens0 * stem)];
        const qkv = storage(Math.max(tokens0 * maxWidth(stem), T * maxWidth(dim)));
        const o = storage(tokens0 * stem);
        const u = storage(Math.max(tokens0 * stem * ffMult, T * dim * ffMult));
        const flat = storage(T * 4 * stem * 8);
        const logits = storage(T * 2);
        const outBuffer = storage(T * 2);
        const zeros = storage(4096);

        // RoPE cos/sin per (position, pair), with the f32 angle torch uses (position * freq, rounded).
        const freqsAt = weights.byteOffset + entry('rope.freqs').byte_offset;
        const freqs = new Float32Array(weights.buffer.slice(freqsAt, freqsAt + (HEAD_DIM / 2) * 4));
        const table = new Float32Array(T * 16 * 2);
        for (let pos = 0; pos < T; pos += 1) {
            for (let i = 0; i < 16; i += 1) {
                const angle = Math.fround(Math.fround(pos) * freqs[i]);
                table[(pos * 16 + i) * 2] = Math.cos(angle);
                table[(pos * 16 + i) * 2 + 1] = Math.sin(angle);
            }
        }
        const ropeTable = storage(table.length);
        device.queue.writeBuffer(ropeTable, 0, table);

        const pipelines = new Map<string, GPUComputePipeline>();
        const pipeline = (code: string) => {
            let found = pipelines.get(code);
            if (!found) {
                found = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
                pipelines.set(code, found);
            }
            return found;
        };
        /**
         * The graph for one chunk length. Every kernel takes its sizes from uniforms and the
         * activations above are sized for the longest chunk, so a shorter one (a whole track under
         * 30 s) only needs its own uniforms, bind groups and dispatch counts.
         */
        const build = (T: number): Built => {
            const graphOwned: GPUBuffer[] = [];
            const uniform = (values: number[]) => {
                const data = new Uint32Array(Math.ceil(values.length / 4) * 4);
                data.set(values);
                const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                device.queue.writeBuffer(buffer, 0, data);
                graphOwned.push(buffer);
                return buffer;
            };

            const steps: Step[] = [];
            // Where in the network the next dispatches belong, for profiling labels ("block0.time", "layer3"...).
            let scope = 'stem';
            const dispatch = (code: string, bindings: Binding[], params: number[], count: [number, number, number], detail = '') => {
                const compute = pipeline(code);
                const entries = [...bindings, { buffer: uniform(params) }].map((resource, binding) => ({ binding, resource }));
                const label = `${scope} ${KERNEL_NAMES.get(code)}${detail ? ` ${detail}` : ''}`;
                steps.push({ kind: 'dispatch', label, pipeline: compute, group: device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries }), count });
            };
            const groups = (invocations: number): [number, number, number] => [Math.ceil(invocations / 64), 1, 1];
            const stage = (name: string, buffer: GPUBuffer, floats: number) => steps.push({ kind: 'stage', name, buffer, floats });

            /** `flags`: MATMUL_* from kernels.ts; `rope` only matters with MATMUL_ROPE. */
            const matmul = (input: GPUBuffer, weight: string, bias: string | null, output: GPUBuffer, m: number, flags: number,
                rope = { posDiv: 1, posMod: 1, dmodel: 0 }) => {
                const [k, n] = shape(weight);
                const { dtype, stride } = entry(weight);
                if (!stride) throw new Error(`beat_this weights: ${weight} has no row stride (re-export the weights)`);
                const f16Kernel = options.f16 === 'math' ? MATMUL_F16_MATH : MATMUL_F16;
                dispatch(dtype !== 'f16' ? MATMUL : options.f16 ? f16Kernel : MATMUL_F16W, [{ buffer: input }, tensor(weight), bias ? tensor(bias) : { buffer: zeros }, { buffer: output }, { buffer: ropeTable }],
                    [m, n, k, flags, rope.posDiv, rope.posMod, rope.dmodel, stride], [Math.ceil(n / 64), Math.ceil(m / 64), 1],
                    weight.split('.').slice(-2).join('.'));
            };

            /**
             * One pre-norm attention + feed-forward pair on the residual stream `stream` ([rows, c]).
             * `n`/`seqStride`/`batchStride`/`batches` say which axis is attended; RoPE positions follow it.
             */
            const transformerPair = (stream: GPUBuffer, prefix: string, rows: number, c: number,
                axis: { n: number; seqStride: number; batchStride: number; batches: number; posDiv: number }) => {
                const heads = c / HEAD_DIM;
                const width = 3 * c + heads;
                scope = prefix;
                matmul(stream, `${prefix}.attn.qkvg.w`, `${prefix}.attn.qkvg.b`, qkv, rows, MATMUL_NORM | MATMUL_ROPE,
                    { posDiv: axis.posDiv, posMod: axis.n, dmodel: c });
                dispatch(!options.f16 ? ATTENTION : options.f16 === 'math' ? ATTENTION_F16_MATH : ATTENTION_F16, [{ buffer: qkv }, { buffer: o }], [axis.n, heads, width, c, axis.seqStride, axis.batchStride],
                    [Math.ceil(axis.n / 64), heads, axis.batches]);
                matmul(o, `${prefix}.attn.out.w`, null, stream, rows, MATMUL_RESIDUAL);
                matmul(stream, `${prefix}.ff.w1`, `${prefix}.ff.b1`, u, rows, MATMUL_NORM | MATMUL_GELU);
                matmul(u, `${prefix}.ff.w2`, `${prefix}.ff.b2`, stream, rows, MATMUL_RESIDUAL);
            };

            // Stem: BatchNorm1d over mel bins, then conv (4, 3) / stride 4 on frequency.
            dispatch(STEM_BN, [{ buffer: melBuffer }, tensor('stem.bn.scale'), tensor('stem.bn.shift'), { buffer: stemIn }], [T, MEL_BINS], groups(T * MEL_BINS));
            let freqs_ = MEL_BINS / 4;
            let channels = stem;
            dispatch(CONV_GELU, [{ buffer: stemIn }, tensor('stem.conv.w'), tensor('stem.conv.b'), { buffer: x[0] }],
                [freqs_, T, 1, channels, 4], [Math.ceil(channels / 64), Math.ceil((freqs_ * T) / 64), 1]);
            let cur = 0;
            stage('stem', x[cur], freqs_ * T * channels);

            for (let block = 0; block < 3; block += 1) {
                const rows = freqs_ * T;
                transformerPair(x[cur], `block${block}.freq`, rows, channels,
                    { n: freqs_, seqStride: T, batchStride: 1, batches: T, posDiv: T });
                stage(`block${block}_freq`, x[cur], rows * channels);
                transformerPair(x[cur], `block${block}.time`, rows, channels,
                    { n: T, seqStride: 1, batchStride: T, batches: freqs_, posDiv: 1 });
                stage(`block${block}_time`, x[cur], rows * channels);
                const next = 1 - cur;
                scope = `block${block}`;
                dispatch(CONV_GELU, [{ buffer: x[cur] }, tensor(`block${block}.conv.w`), tensor(`block${block}.conv.b`), { buffer: x[next] }],
                    [freqs_ / 2, T, channels, channels * 2, 2], [Math.ceil((channels * 2) / 64), Math.ceil(((freqs_ / 2) * T) / 64), 1]);
                cur = next;
                freqs_ /= 2;
                channels *= 2;
                stage(`block${block}_conv`, x[cur], freqs_ * T * channels);
            }

            scope = 'frontend';
            dispatch(FLATTEN, [{ buffer: x[cur] }, { buffer: flat }], [freqs_, T, channels], groups(freqs_ * T * channels));
            cur = 1 - cur;
            matmul(flat, 'frontend.linear.w', 'frontend.linear.b', x[cur], T, 0);
            stage('frontend', x[cur], T * dim);

            for (let layer = 0; layer < manifest.hyper_parameters.n_layers; layer += 1) {
                transformerPair(x[cur], `layer${layer}`, T, dim, { n: T, seqStride: 1, batchStride: T, batches: 1, posDiv: 1 });
                stage(`layer${layer}`, x[cur], T * dim);
            }
            scope = 'head';
            matmul(x[cur], 'head.w', 'head.b', logits, T, MATMUL_NORM);
            dispatch(SUM_HEAD, [{ buffer: logits }, { buffer: outBuffer }], [T], groups(T));
            stage('logits', outBuffer, T * 2);
            return { steps, owned: graphOwned };
        };

        const model = new BeatThisWgsl(device, build, melBuffer, outBuffer, owned, options.f16 ?? 'f32');
        model.graph(T);
        await device.queue.onSubmittedWorkDone();
        return model;
    }

    /**
     * One chunk. `mel` is [T, 128] frame-major, T from 1 to 1500, the layout beatThis.ts produces. `profile` puts every
     * dispatch in its own pass with timestamps (needs a device created with 'timestamp-query'); the
     * extra passes cost a little, so profiled totals run slightly above unprofiled ones.
     *
     * `slice` cuts the chunk into several submits so another user of the GPU (the visualizer) can get
     * frames in between: 'stage' submits at every stage boundary (stem, each frontend half-block and
     * conv, frontend, each transformer layer), 'dispatch' after every dispatch. Each slice waits for
     * the GPU to finish and then for `between`, if given, before the next is submitted - unless
     * `inFlight` allows more than one slice queued at once, in which case the run only waits when
     * that many are outstanding. The GPU only switches work between command buffers, so a slice is
     * the smallest unit anything else can wait behind. Results are identical whatever the slicing:
     * same dispatches, same order.
     *
     * 'paced' cuts into slices of about `pacing.sliceMs` of GPU time by the measured cost of each
     * dispatch, and lets them go as gpuSlices.ts' createSliceQueue does (`inFlight` and `between`
     * are then ignored). Each chunk length's graph is profiled on its first paced runs and cut at
     * its stage boundaries until then - for good on a device without timestamp-query, and for the
     * short last chunk of a track, whose graph is built anew for each length.
     */
    async run(mel: Float32Array, options: {
        stages?: boolean; profile?: boolean; slice?: 'none' | 'stage' | 'dispatch' | 'paced'; inFlight?: number;
        pacing?: SlicePacing; between?: () => Promise<void>;
    } = {}): Promise<BeatThisWgslResult> {
        const T = mel.length / MEL_BINS;
        if (!Number.isInteger(T) || T < 1 || T > BEAT_THIS_WGSL_FRAMES) {
            throw new Error(`beat_this chunk must be 1..${BEAT_THIS_WGSL_FRAMES} frames x ${MEL_BINS}, got ${mel.length} values`);
        }
        const graph = this.graph(T);
        const { steps } = graph;
        const { device } = this;
        device.queue.writeBuffer(this.melBuffer, 0, mel.buffer, mel.byteOffset, mel.byteLength);

        const slice = options.slice ?? 'none';
        const paced = slice === 'paced';
        const pacing = paced ? options.pacing ?? DEFAULT_PACING : { sliceMs: Infinity, inFlight: Math.max(1, options.inFlight ?? 1) };
        const timestampable = device.features.has('timestamp-query') && graph.dispatches * 2 <= MAX_TIMESTAMP_QUERIES;
        let noTimestamps = false;
        if (paced && graph.costs.wanted && !timestampable) {
            graph.costs.giveUp();
            noTimestamps = true;
        }
        const profiling = timestampable && (Boolean(options.profile) || (paced && graph.costs.wanted));
        const querySet = profiling ? device.createQuerySet({ type: 'timestamp', count: graph.dispatches * 2 }) : null;
        const cuts = paced ? graph.costs.cutsFor(pacing.sliceMs) : null;
        // Cut at the stage boundaries (no table yet, or none to be had), a slice can be a whole
        // transformer layer: one at a time then, as the old one-stage-at-a-time cut, never queued.
        const queue = createSliceQueue(device.queue, paced && !cuts ? { ...pacing, inFlight: 1 } : pacing);
        const between = paced ? undefined : options.between;

        let encoder = device.createCommandEncoder();
        const readbacks: { name: string; buffer: GPUBuffer }[] = [];
        let pass: GPUComputePassEncoder | null = null;
        /** Whether the encoder holds anything since the last submit. */
        let recorded = false;
        const submit = async (last = false) => {
            pass?.end();
            pass = null;
            const commands = encoder.finish();
            encoder = device.createCommandEncoder();
            recorded = false;
            await queue.submit(commands, last);
        };
        let index = 0;
        const wallStarted = performance.now();
        for (const step of steps) {
            if (slice === 'dispatch' && pass) {
                await submit();
                await between?.();
            }
            if (step.kind === 'dispatch') {
                if (cuts?.has(index) && recorded) await submit();
                if (querySet) {
                    pass?.end();
                    pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 } });
                }
                pass ??= encoder.beginComputePass();
                pass.setPipeline(step.pipeline);
                pass.setBindGroup(0, step.group);
                pass.dispatchWorkgroups(...step.count);
                index += 1;
                recorded = true;
                continue;
            }
            // A run cut per dispatch was submitted by the check above.
            const atStages = slice === 'stage' || (paced && !cuts);
            if (atStages && step.name !== 'logits' && recorded) {
                await submit();
                await between?.();
            }
            if (!options.stages && step.name !== 'logits') continue;
            pass?.end();
            pass = null;
            const readback = device.createBuffer({ size: step.floats * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            encoder.copyBufferToBuffer(step.buffer, 0, readback, 0, step.floats * 4);
            readbacks.push({ name: step.name, buffer: readback });
        }
        pass?.end();
        pass = null;
        let timestamps: GPUBuffer | null = null;
        let resolved: GPUBuffer | null = null;
        if (querySet) {
            const bytes = graph.dispatches * 16;
            resolved = device.createBuffer({ size: bytes, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
            timestamps = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            encoder.resolveQuerySet(querySet, 0, graph.dispatches * 2, resolved, 0);
            encoder.copyBufferToBuffer(resolved, 0, timestamps, 0, bytes);
        }

        await submit(true);
        const wallMs = performance.now() - wallStarted;
        resolved?.destroy();
        querySet?.destroy();

        const stages: Record<string, Float32Array> = {};
        for (const { name, buffer } of readbacks) {
            await buffer.mapAsync(GPUMapMode.READ);
            stages[name] = new Float32Array(buffer.getMappedRange().slice(0));
            buffer.destroy();
        }
        let profile: BeatThisWgslResult['profile'];
        let costs: PacedRunStats['costs'];
        if (timestamps) {
            await timestamps.mapAsync(GPUMapMode.READ);
            const durations = durationsFromTicks(new BigInt64Array(timestamps.getMappedRange()), graph.dispatches);
            timestamps.destroy();
            if (options.profile) {
                const dispatched = steps.filter(step => step.kind === 'dispatch');
                profile = dispatched.map((step, at) => ({ label: step.label, ms: durations[at] }));
            }
            graph.costs.record(durations);
        }
        // The full graph's table once per instance: the run that completed it, or this load's first
        // on a table kept from an earlier load on the device.
        const table = paced && T === BEAT_THIS_WGSL_FRAMES ? graph.costs.costs : null;
        if (table && !this.reported) {
            costs = costSummary(table, pacing.sliceMs);
            this.reported = true;
        }
        if (paced && graph.costs.unusable) noTimestamps = true;
        const out = stages.logits;
        return {
            beat: out.subarray(0, T),
            downbeat: out.subarray(T, 2 * T),
            gpuMs: queue.waitedMs,
            wallMs,
            slices: queue.slices,
            ...(paced ? {
                paced: {
                    slices: queue.slices,
                    sliceMs: pacing.sliceMs,
                    byCosts: cuts !== null,
                    inFlight: cuts ? pacing.inFlight : 1,
                    pacedInFlight: pacing.inFlight,
                    roundTripMs: median(queue.roundTrips),
                    ...(costs ? { costs } : {}),
                    ...(noTimestamps ? { noTimestamps } : {}),
                },
            } : {}),
            ...(options.stages ? { stages } : {}),
            ...(profile ? { profile } : {}),
        };
    }

    destroy(): void {
        this.owned.forEach(buffer => buffer.destroy());
        this.graphs.forEach(graph => graph.owned.forEach(buffer => buffer.destroy()));
    }
}
