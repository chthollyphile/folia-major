/// <reference types="@webgpu/types" />
import {
    ATTENTION, ATTENTION_F16, ATTENTION_F16_MATH, CONV_GELU, FLATTEN, MATMUL, MATMUL_F16, MATMUL_F16_MATH, MATMUL_F16W, MATMUL_GELU, MATMUL_NORM, MATMUL_RESIDUAL, MATMUL_ROPE, STEM_BN, SUM_HEAD,
} from './kernels';

// src/services/automix/beatThisWgsl/runtime.ts
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
    /** Time from submit to the GPU finishing, ms, summed over the slices. */
    gpuMs: number;
    /** The whole run, ms: gpuMs plus recording, and the waits between slices. */
    wallMs: number;
    /** Command buffers submitted. */
    slices: number;
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
interface Graph { steps: Step[]; owned: GPUBuffer[] }

/** How many 'auto' runs a learnt per-dispatch cut is kept for: about seven tracks of chunks. */
const RELEARN_RUNS = 50;

const product = (shape: number[]) => shape.reduce((a, b) => a * b, 1);

/** Short kernel names for profiling labels. */
const KERNEL_NAMES = new Map<string, string>([
    [STEM_BN, 'stem_bn'], [CONV_GELU, 'conv'], [MATMUL, 'matmul'], [MATMUL_F16W, 'matmul'], [MATMUL_F16, 'matmul'], [MATMUL_F16_MATH, 'matmul'],
    [ATTENTION, 'attention'], [ATTENTION_F16, 'attention'], [ATTENTION_F16_MATH, 'attention'], [FLATTEN, 'flatten'], [SUM_HEAD, 'sum_head'],
]);

export class BeatThisWgsl {
    private constructor(
        private readonly device: GPUDevice,
        private readonly build: (frames: number) => Graph,
        private readonly melBuffer: GPUBuffer,
        private readonly outBuffer: GPUBuffer,
        private readonly owned: GPUBuffer[],
    ) {}

    /** Stages (by position among the stage markers) that 'auto' slicing has learnt to cut per dispatch. */
    private readonly fineStages = new Set<number>();
    private autoRuns = 0;
    /** Graphs by chunk length: the full one, and the most recent shorter one. */
    private readonly graphs = new Map<number, Graph>();

    private graph(frames: number): Step[] {
        let found = this.graphs.get(frames);
        if (!found) {
            // A short chunk is the last of a track (or all of a short one), so the next short length
            // is almost never this one again; keep one, not one per track ever played.
            for (const [length, old] of this.graphs) {
                if (length === BEAT_THIS_WGSL_FRAMES) continue;
                old.owned.forEach(buffer => buffer.destroy());
                this.graphs.delete(length);
            }
            found = this.build(frames);
            this.graphs.set(frames, found);
        }
        return found.steps;
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
        const build = (T: number): Graph => {
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

        const model = new BeatThisWgsl(device, build, melBuffer, outBuffer, owned);
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
     * 'auto' is 'stage' that learns: one slice in flight, and any stage whose slice took longer than
     * `budgetMs` (submit to done, so it counts time the GPU spent on other work too; default one
     * 120 Hz frame) is cut per dispatch from the next run on. What it learnt is forgotten every
     * RELEARN_RUNS runs, so a burst of heavy rendering does not keep every later track at the
     * slower cut. A fast GPU next to a light visualizer stays at ~18 submits a chunk; a slow or busy
     * one ends up near one per dispatch. A single dispatch longer than the budget is still one
     * unbroken piece of GPU work - only splitting the kernel itself would get under that.
     */
    async run(mel: Float32Array, options: {
        stages?: boolean; profile?: boolean; slice?: 'none' | 'stage' | 'dispatch' | 'auto'; inFlight?: number;
        budgetMs?: number; between?: () => Promise<void>;
    } = {}): Promise<BeatThisWgslResult> {
        const T = mel.length / MEL_BINS;
        if (!Number.isInteger(T) || T < 1 || T > BEAT_THIS_WGSL_FRAMES) {
            throw new Error(`beat_this chunk must be 1..${BEAT_THIS_WGSL_FRAMES} frames x ${MEL_BINS}, got ${mel.length} values`);
        }
        const steps = this.graph(T);
        const { device } = this;
        device.queue.writeBuffer(this.melBuffer, 0, mel.buffer, mel.byteOffset, mel.byteLength);

        let encoder = device.createCommandEncoder();
        const readbacks: { name: string; buffer: GPUBuffer }[] = [];
        const profiled = options.profile && device.features.has('timestamp-query')
            ? steps.filter(step => step.kind === 'dispatch') : [];
        const querySet = profiled.length ? device.createQuerySet({ type: 'timestamp', count: profiled.length * 2 }) : null;
        let query = 0;
        let pass: GPUComputePassEncoder | null = null;
        let gpuMs = 0;
        let slices = 0;
        const slice = options.slice ?? 'none';
        const inFlight = slice === 'auto' ? 1 : Math.max(1, options.inFlight ?? 1);
        const outstanding: Promise<void>[] = [];
        /** Submits what is recorded; resolves when no more than inFlight - 1 slices are left, with how long that took. */
        const submit = async (last = false) => {
            pass?.end();
            pass = null;
            const started = performance.now();
            device.queue.submit([encoder.finish()]);
            outstanding.push(device.queue.onSubmittedWorkDone());
            while (outstanding.length > (last ? 0 : inFlight - 1)) await outstanding.shift();
            const took = performance.now() - started;
            gpuMs += took;
            slices += 1;
            encoder = device.createCommandEncoder();
            return took;
        };
        const budgetMs = options.budgetMs ?? 8;
        if (slice === 'auto' && ++this.autoRuns % RELEARN_RUNS === 0) this.fineStages.clear();
        let stageIndex = 0;
        const wallStarted = performance.now();
        for (const step of steps) {
            const perDispatch = slice === 'dispatch' || (slice === 'auto' && this.fineStages.has(stageIndex));
            if (perDispatch && pass) {
                await submit();
                await options.between?.();
            }
            if (step.kind === 'dispatch') {
                if (querySet) {
                    pass?.end();
                    pass = encoder.beginComputePass({ timestampWrites: { querySet, beginningOfPassWriteIndex: query, endOfPassWriteIndex: query + 1 } });
                    query += 2;
                }
                pass ??= encoder.beginComputePass();
                pass.setPipeline(step.pipeline);
                pass.setBindGroup(0, step.group);
                pass.dispatchWorkgroups(...step.count);
                continue;
            }
            // A stage already cut per dispatch was submitted by the check above.
            const coarse = slice === 'stage' || (slice === 'auto' && !this.fineStages.has(stageIndex));
            if (coarse && step.name !== 'logits') {
                const took = await submit();
                if (slice === 'auto' && took > budgetMs) this.fineStages.add(stageIndex);
                await options.between?.();
            }
            stageIndex += 1;
            if (!options.stages && step.name !== 'logits') continue;
            pass?.end();
            pass = null;
            const readback = device.createBuffer({ size: step.floats * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            encoder.copyBufferToBuffer(step.buffer, 0, readback, 0, step.floats * 4);
            readbacks.push({ name: step.name, buffer: readback });
        }
        pass?.end();
        let timestamps: GPUBuffer | null = null;
        if (querySet) {
            const resolved = device.createBuffer({ size: query * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
            timestamps = device.createBuffer({ size: query * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            encoder.resolveQuerySet(querySet, 0, query, resolved, 0);
            encoder.copyBufferToBuffer(resolved, 0, timestamps, 0, query * 8);
        }

        await submit(true);
        const wallMs = performance.now() - wallStarted;

        const stages: Record<string, Float32Array> = {};
        for (const { name, buffer } of readbacks) {
            await buffer.mapAsync(GPUMapMode.READ);
            stages[name] = new Float32Array(buffer.getMappedRange().slice(0));
            buffer.destroy();
        }
        let profile: BeatThisWgslResult['profile'];
        if (timestamps) {
            await timestamps.mapAsync(GPUMapMode.READ);
            const ticks = new BigInt64Array(timestamps.getMappedRange());
            profile = profiled.map((step, index) => ({
                label: step.kind === 'dispatch' ? step.label : '',
                ms: Number(ticks[index * 2 + 1] - ticks[index * 2]) / 1e6,
            }));
            timestamps.destroy();
            querySet?.destroy();
        }
        const out = stages.logits;
        return {
            beat: out.subarray(0, T),
            downbeat: out.subarray(T, 2 * T),
            gpuMs,
            wallMs,
            slices,
            ...(options.stages ? { stages } : {}),
            ...(profile ? { profile } : {}),
        };
    }

    destroy(): void {
        this.owned.forEach(buffer => buffer.destroy());
        this.graphs.forEach(graph => graph.owned.forEach(buffer => buffer.destroy()));
    }
}
