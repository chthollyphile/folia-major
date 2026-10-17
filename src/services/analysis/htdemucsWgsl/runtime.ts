/// <reference types="@webgpu/types" />
import {
    ADD, ATTN_SOFTMAX, GEMM_GELU, GEMM_RESIDUAL, GLU, GN_GLU_RESIDUAL, GN_INPLACE, ISTFT_A, ISTFT_B, LAYER_NORM, NORMALIZE, OVERLAP_ADD,
    STATS_FINAL, STATS_PARTIAL, STFT_A, STFT_B, TWIDDLE_N, attnOutSource, attnScoresSource, gemmSource, gemmTrSource, type GemmMode,
} from './kernels';

// src/services/analysis/htdemucsWgsl/runtime.ts
// Runs one htdemucs segment (stereo mix [2, 172032] at 44.1 kHz -> one source's stereo stem, drums by
// default) on a WebGPU device with the kernels in ./kernels, the graph of the published htdemucs.onnx
// (build/htdemucs_wgsl/export_weights.py) step for step: STFT and the graph's normalisations, four
// encoder layers per branch (conv, DConv, rewrite + GLU), the five-layer cross-transformer, four
// decoder layers per branch, iSTFT, and the two branches summed. The graph is fixed, so every
// pipeline, buffer, uniform and bind group is built in `create`; a run only uploads the mix, records
// the dispatches and reads the stem back.
//
// Of the decoders' four sources only `source` is turned back into audio (the iSTFT and the
// overlap-add are per source); the network itself has to run whole either way.
//
// `f16` (a device opened with shader-f16) runs every GEMM in kernels.ts' 'f16' mode: f16 tiles and
// f16 multiplies over each 16-deep K step, f32 accumulation and f32 activations in memory - about a
// tenth faster on an M4, and the drum hits read off the stem the same (see GemmMode).

export const HTDEMUCS_SEGMENT = 172032;
/** htdemucs' sources, in the graph's order. */
export const HTDEMUCS_SOURCES = ['drums', 'bass', 'other', 'vocals'] as const;
const FRAMES = 168;
const FREQ_TOKENS = 8;
const BINS = 2048;
const DIM = 512;
const HEADS = 8;
/**
 * Heads per attention dispatch, whose scores ([heads, tokens, tokens]) go through one buffer: four
 * heads of the frequency branch's 1344 tokens is 29 MB, and a run of dispatches short enough to cut.
 */
const HEADS_PER_DISPATCH = 4;

export interface HtdemucsWgslManifest {
    segment: number;
    /** dtype 'f16' only for the tensors the graph itself stores as fp16, from the --f16 export. */
    tensors: Record<string, { byte_offset: number; shape: number[]; dtype: 'f32' | 'f16' }>;
    bytes: number;
}

export interface HtdemucsWgslResult {
    left: Float32Array;
    right: Float32Array;
    /** Time from submit to the GPU finishing, ms, summed over the slices. */
    gpuMs: number;
    /** The whole run, ms. */
    wallMs: number;
    /** Command buffers submitted. */
    slices: number;
    /** Intermediate activations by stage name, only when asked for (channel-major, as computed). */
    stages?: Record<string, Float32Array>;
    /** With slice 'dispatch' and `timings`: each dispatch's submit-to-done time, in order. */
    timings?: { label: string; ms: number }[];
}

interface Binding { buffer: GPUBuffer; offset?: number; size?: number }
type Step =
    | { kind: 'dispatch'; label: string; pipeline: GPUComputePipeline; group: GPUBindGroup; count: [number, number, number] }
    | { kind: 'copy'; from: GPUBuffer; to: GPUBuffer; bytes: number }
    | { kind: 'stage'; name: string; buffer: GPUBuffer; floats: number };

/** How many 'auto' runs a learnt per-dispatch cut is kept for. */
const RELEARN_RUNS = 50;

const product = (shape: number[]) => shape.reduce((a, b) => a * b, 1);

export class HtdemucsWgsl {
    private constructor(
        private readonly device: GPUDevice,
        private readonly steps: Step[],
        private readonly mixBuffer: GPUBuffer,
        private readonly outBuffer: GPUBuffer,
        private readonly owned: GPUBuffer[],
    ) {}

    private readonly fineStages = new Set<number>();
    private autoRuns = 0;

    /**
     * Uploads the weights (the .bin as written, f32 or --f16) and builds the whole graph. `source` is
     * which stem a run returns (an index into HTDEMUCS_SOURCES).
     */
    static async create(
        device: GPUDevice,
        weights: Uint8Array,
        manifest: HtdemucsWgslManifest,
        options: { source?: number; f16?: boolean } = {},
    ): Promise<HtdemucsWgsl> {
        if (manifest.segment !== HTDEMUCS_SEGMENT) throw new Error(`htdemucs weights are for a ${manifest.segment}-sample segment, not ${HTDEMUCS_SEGMENT}`);
        if (options.f16 && !device.features.has('shader-f16')) throw new Error('htdemucs f16 needs a device opened with shader-f16');
        const source = options.source ?? 0;
        const mode: GemmMode = options.f16 ? 'f16' : 'f32';
        const ATTN_SCORES = attnScoresSource(mode);
        const ATTN_OUT = attnOutSource(mode);
        // A shader or binding this device rejects fails `create`, not the first run.
        device.pushErrorScope('validation');
        const L = HTDEMUCS_SEGMENT;
        const owned: GPUBuffer[] = [];
        const storage = (floats: number) => {
            const buffer = device.createBuffer({
                size: Math.max(16, Math.ceil(floats) * 4),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            });
            owned.push(buffer);
            return buffer;
        };

        const weightBuffer = storage(Math.ceil(weights.byteLength / 4));
        device.queue.writeBuffer(weightBuffer, 0, weights.buffer, weights.byteOffset, weights.byteLength);
        const entry = (name: string) => {
            const found = manifest.tensors[name];
            if (!found) throw new Error(`htdemucs weights: missing tensor ${name}`);
            return found;
        };
        const tensor = (name: string): Binding => {
            const { byte_offset: offset, shape, dtype } = entry(name);
            const bytes = product(shape) * (dtype === 'f16' ? 2 : 4);
            return { buffer: weightBuffer, offset, size: Math.ceil(bytes / 4) * 4 };
        };
        const isHalf = (name: string) => entry(name).dtype === 'f16';
        const rows = (name: string) => entry(name).shape[0];

        const twiddles = new Float32Array(TWIDDLE_N * 2);
        for (let j = 0; j < TWIDDLE_N; j += 1) {
            twiddles[j * 2] = Math.cos((2 * Math.PI * j) / TWIDDLE_N);
            twiddles[j * 2 + 1] = Math.sin((2 * Math.PI * j) / TWIDDLE_N);
        }
        const tw = storage(twiddles.length);
        device.queue.writeBuffer(tw, 0, twiddles);

        // Activations. The frequency branch at encoder i is [48 * 2^i, 2048 / 4^(i+1), 168]; the time
        // branch [48 * 2^i, 1, 172032 / 4^(i+1)]. The scratch buffers are sized for the widest layer.
        const top = 48 * (BINS / 4) * FRAMES;                  // [48, 512, 168]
        const mixBuffer = storage(2 * L);
        const outBuffer = storage(2 * L);
        const mixStats = storage(4);
        const specStats = storage(4);
        const scratchStats = storage(4 * BINS);
        const partial = storage(4096);
        const zeros = storage(64);
        const dft = storage(2 * FRAMES * 4096 * 2);
        const xin = storage(4 * BINS * FRAMES);
        const stream = storage(top);
        const hidden = storage(top / 8);
        const wide = storage(2 * top);
        const ping = [storage(16 * BINS * FRAMES), storage(16 * BINS * FRAMES)];
        const freqOut = storage(16 * BINS * FRAMES);
        const timeOut = storage(8 * L);
        const frames = storage(2 * FRAMES * 4096);
        const skips: GPUBuffer[] = [];
        const tskips: GPUBuffer[] = [];
        for (let i = 0; i < 4; i += 1) {
            skips.push(storage(48 * 2 ** i * (BINS / 4 ** (i + 1)) * FRAMES));
            tskips.push(storage(48 * 2 ** i * (L / 4 ** (i + 1))));
        }
        const nf = FREQ_TOKENS * FRAMES;
        const nt = L / 256;
        const xf = storage(DIM * nf);
        const xt = storage(DIM * nt);
        const normF = storage(DIM * nf);
        const normT = storage(DIM * nt);
        const otherF = storage(DIM * nf);
        const otherT = storage(DIM * nt);
        const qkvF = storage(3 * DIM * nf);
        const qkvT = storage(3 * DIM * nt);
        const kvF = storage(2 * DIM * nt);   // the frequency branch's keys and values, from time tokens
        const kvT = storage(2 * DIM * nf);
        const attF = storage(DIM * nf);
        const attT = storage(DIM * nt);
        const ff = storage(4 * DIM * nf);
        const scores = storage(HEADS_PER_DISPATCH * nf * nf);

        const pipelines = new Map<string, GPUComputePipeline>();
        const pipeline = (code: string) => {
            let found = pipelines.get(code);
            if (!found) {
                found = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
                pipelines.set(code, found);
            }
            return found;
        };
        const uniform = (values: number[]) => {
            const data = new Uint32Array(Math.ceil(values.length / 4) * 4);
            data.set(values);
            const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(buffer, 0, data);
            owned.push(buffer);
            return buffer;
        };

        const steps: Step[] = [];
        /** Where in the network the next dispatches belong, for timing labels ("enc2", "tf3"...). */
        let scope = 'input';
        const kernelNames = new Map<string, string>([
            [ADD, 'add'], [ATTN_OUT, 'attn_out'], [ATTN_SCORES, 'attn_scores'], [ATTN_SOFTMAX, 'softmax'], [GLU, 'glu'], [GN_GLU_RESIDUAL, 'gn_glu'], [GN_INPLACE, 'gn'], [ISTFT_A, 'istft_a'],
            [ISTFT_B, 'istft_b'], [LAYER_NORM, 'layer_norm'], [NORMALIZE, 'normalize'], [OVERLAP_ADD, 'overlap_add'],
            [STATS_FINAL, 'stats_final'], [STATS_PARTIAL, 'stats'], [STFT_A, 'stft_a'], [STFT_B, 'stft_b'],
        ]);
        const dispatch = (code: string, bindings: Array<Binding | GPUBuffer>, params: number[], count: [number, number, number], detail = '') => {
            const compute = pipeline(code);
            const entries = [...bindings, uniform(params)].map((resource, binding) => ({
                binding, resource: resource instanceof GPUBuffer ? { buffer: resource } : resource,
            }));
            const label = `${scope} ${kernelNames.get(code) ?? 'gemm'}${detail ? ` ${detail}` : ''}`;
            steps.push({ kind: 'dispatch', label, pipeline: compute, group: device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries }), count });
        };
        /** Workgroups of 256 for n elements, folded into two dimensions past the per-dimension limit. */
        const flat = (n: number): [number, number, number] => {
            const groups = Math.ceil(n / 256);
            const x = Math.min(groups, 32768);
            return [x, Math.ceil(groups / x), 1];
        };
        const stage = (name: string, buffer: GPUBuffer, floats: number) => steps.push({ kind: 'stage', name, buffer, floats });

        /** Mean and spread of `groups` groups of c x inner values (element (ch, i) of group g at ch*cs + g*gs + i) into `target`. */
        const statsOf = (input: GPUBuffer, target: GPUBuffer, groups: number, c: number, inner: number, cs: number, gs: number, final: 1 | 2) => {
            const n = c * inner;
            const parts = Math.max(1, Math.min(256, Math.floor(4096 / groups), Math.ceil(n / 16384)));
            dispatch(STATS_PARTIAL, [input, target, partial], [parts, c, inner, cs, gs, 0], [parts, groups, 1]);
            dispatch(STATS_FINAL, [partial, target], [parts, n, 0], [groups, 1, 1]);
            dispatch(STATS_PARTIAL, [input, target, partial], [parts, c, inner, cs, gs, 1], [parts, groups, 1]);
            dispatch(STATS_FINAL, [partial, target], [parts, n, final], [groups, 1, 1]);
        };
        /** GroupNorm statistics of [c, h, w]: per h row (`perH`) or of the whole tensor. */
        const groupStats = (input: GPUBuffer, c: number, h: number, w: number, perH: boolean) => {
            if (perH) statsOf(input, scratchStats, h, c, w, h * w, w, 1);
            else statsOf(input, scratchStats, 1, 1, c * h * w, 0, 0, 1);
        };

        interface Geometry { hin: number; win: number; kh: number; kw: number; sh?: number; sw?: number; ph?: number; pw?: number; dh?: number; dw?: number }
        /** Conv2d `name` ([cout, cin*kh*kw]) over [cin, hin, win]; returns the output's [h, w]. */
        const conv = (input: GPUBuffer, name: string, output: GPUBuffer, g: Geometry, flags = 0, side: Binding | GPUBuffer = zeros) => {
            const { sh = 1, sw = 1, ph = 0, pw = 0, dh = 1, dw = 1 } = g;
            const m = rows(`${name}.w`);
            const k = entry(`${name}.w`).shape[1];
            const cin = k / (g.kh * g.kw);
            const hout = Math.floor((g.hin + 2 * ph - dh * (g.kh - 1) - 1) / sh) + 1;
            const wout = Math.floor((g.win + 2 * pw - dw * (g.kw - 1) - 1) / sw) + 1;
            dispatch(gemmSource(isHalf(`${name}.w`), mode), [input, tensor(`${name}.w`), tensor(`${name}.b`), side, output],
                [m, k, cin, g.kh, g.kw, sh, sw, ph, pw, dh, dw, g.hin, g.win, hout, wout, flags],
                [Math.ceil((hout * wout) / 64), Math.ceil(m / 64), 1], name.split('.').slice(1).join('.'));
            return [hout, wout] as const;
        };
        /** ConvTranspose `name` along H (axis 0) or W (axis 1) of [cin, hin, win], cropped as the graph does. */
        const convTr = (input: GPUBuffer, name: string, output: GPUBuffer, hin: number, win: number, axis: 0 | 1, flags: number) => {
            const m = rows(`${name}.w`);
            const k = entry(`${name}.w`).shape[1];
            const n = axis === 0 ? (hin + 1) * win : hin * (win + 1);
            dispatch(gemmTrSource(isHalf(`${name}.w`), mode), [input, tensor(`${name}.w`), tensor(`${name}.b`), output],
                [m, k, k / 2, hin, win, axis, flags], [Math.ceil(n / 64), Math.ceil(m / 64), 1], 'tr');
        };

        /** DConv's two residual layers on `stream` [c, h, w]; per-h GroupNorm for the frequency branch. */
        const dconv = (prefix: string, c: number, h: number, w: number, perH: boolean) => {
            for (let j = 0; j < 2; j += 1) {
                const p = `${prefix}.dc${j}`;
                const d = 2 ** j;
                const hid = rows(`${p}.c1.w`);
                conv(stream, `${p}.c1`, hidden, { hin: h, win: w, kh: 1, kw: 3, pw: d, dw: d });
                groupStats(hidden, hid, h, w, perH);
                dispatch(GN_INPLACE, [hidden, scratchStats, tensor(`${p}.n1.g`), tensor(`${p}.n1.b`)], [hid, h, w, perH ? 1 : 0, 1], flat(hid * h * w));
                conv(hidden, `${p}.c2`, wide, { hin: h, win: w, kh: 1, kw: 1 });
                groupStats(wide, 2 * c, h, w, perH);
                dispatch(GN_GLU_RESIDUAL, [wide, scratchStats, tensor(`${p}.n2.g`), tensor(`${p}.n2.b`), tensor(`${p}.ls`), stream],
                    [c, h, w, perH ? 1 : 0], flat(c * h * w));
            }
        };

        // Time branch input: the mix normalised by its own mean and (unbiased) std.
        // timeOut is free until the last decoder, so it holds the normalised mix meanwhile.
        const tIn = timeOut;
        statsOf(mixBuffer, mixStats, 1, 1, 2 * L, 0, 0, 2);
        steps.push({ kind: 'copy', from: mixBuffer, to: tIn, bytes: 2 * L * 4 });
        dispatch(NORMALIZE, [tIn, mixStats], [2 * L], flat(2 * L));

        // Frequency branch input: the STFT, as complex-as-channels, normalised.
        dispatch(STFT_A, [mixBuffer, tensor('stft.window'), tw, dft], [FRAMES, L], [1, 64, 2 * FRAMES]);
        dispatch(STFT_B, [dft, tw, xin], [FRAMES], [1, 64, 2 * FRAMES]);
        statsOf(xin, specStats, 1, 1, 4 * BINS * FRAMES, 0, 0, 2);
        dispatch(NORMALIZE, [xin, specStats], [4 * BINS * FRAMES], flat(4 * BINS * FRAMES));
        stage('norm_spec', xin, 4 * BINS * FRAMES);

        let tCur = tIn;
        let fCur = xin;
        let tLen = L;
        let fBins = BINS;
        for (let i = 0; i < 4; i += 1) {
            const c = 48 * 2 ** i;
            scope = `tenc${i}`;
            // Time: conv k8 s4 + GELU, DConv, 1x1 rewrite + GLU.
            const [, tl] = conv(tCur, `tenc${i}.conv`, stream, { hin: 1, win: tLen, kh: 1, kw: 8, sw: 4, pw: 2 }, GEMM_GELU);
            tLen = tl;
            dconv(`tenc${i}`, c, 1, tLen, false);
            conv(stream, `tenc${i}.rw`, wide, { hin: 1, win: tLen, kh: 1, kw: 1 });
            dispatch(GLU, [wide, zeros, tskips[i]], [c, 1, tLen, 0], flat(c * tLen));
            stage(`tenc${i}`, tskips[i], c * tLen);
            tCur = tskips[i];
            scope = `enc${i}`;
            // Frequency: conv (8, 1) s (4, 1) + GELU, DConv per frequency, rewrite + GLU (+ embedding after the first).
            const [fb] = conv(fCur, `enc${i}.conv`, stream, { hin: fBins, win: FRAMES, kh: 8, kw: 1, sh: 4, ph: 2 }, GEMM_GELU);
            fBins = fb;
            dconv(`enc${i}`, c, fBins, FRAMES, true);
            conv(stream, `enc${i}.rw`, wide, { hin: fBins, win: FRAMES, kh: 1, kw: 1 });
            dispatch(GLU, [wide, i === 0 ? tensor('freq_emb') : zeros, skips[i]], [c, fBins, FRAMES, i === 0 ? 1 : 0], flat(c * fBins * FRAMES));
            stage(`enc${i}`, skips[i], c * fBins * FRAMES);
            fCur = skips[i];
        }

        // Cross-transformer on [512, tokens]: frequency tokens (f t), time tokens t.
        scope = 'tf_in';
        conv(skips[3], 'up', normF, { hin: 1, win: nf, kh: 1, kw: 1 });
        conv(tskips[3], 'up_t', normT, { hin: 1, win: nt, kh: 1, kw: 1 });
        dispatch(LAYER_NORM, [normF, tensor('norm_in.g'), tensor('norm_in.b'), tensor('pos'), xf], [DIM, nf, 1], [Math.ceil(nf / 64), 1, 1]);
        dispatch(LAYER_NORM, [normT, tensor('norm_in_t.g'), tensor('norm_in_t.b'), tensor('pos_t'), xt], [DIM, nt, 1], [Math.ceil(nt / 64), 1, 1]);
        stage('tf_in', xf, DIM * nf);
        stage('tf_in_t', xt, DIM * nt);
        const layerNorm = (input: GPUBuffer, name: string, output: GPUBuffer, n: number) =>
            dispatch(LAYER_NORM, [input, tensor(`${name}.g`), tensor(`${name}.b`), zeros, output], [DIM, n, 0], [Math.ceil(n / 64), 1, 1]);
        const linear = (input: GPUBuffer, name: string, output: GPUBuffer, n: number, flags = 0, side: Binding | GPUBuffer = zeros) =>
            conv(input, name, output, { hin: 1, win: n, kh: 1, kw: 1 }, flags, side);
        /** Scores, softmax and weighted sum, HEADS_PER_DISPATCH heads at a time through `scores`. */
        const attention = (q: GPUBuffer, kv: GPUBuffer, out: GPUBuffer, nq: number, nk: number, rowsQ: number, rowsK: number, rowsV: number) => {
            for (let head = 0; head < HEADS; head += HEADS_PER_DISPATCH) {
                const heads = `heads ${head}-${head + HEADS_PER_DISPATCH - 1}`;
                dispatch(ATTN_SCORES, [q, kv, scores], [nq, nk, rowsQ, rowsK, head], [Math.ceil(nk / 64), Math.ceil(nq / 64), HEADS_PER_DISPATCH], heads);
                const rowCount = HEADS_PER_DISPATCH * nq;
                const x = Math.min(rowCount, 32768);
                dispatch(ATTN_SOFTMAX, [scores], [nk], [x, Math.ceil(rowCount / x), 1], heads);
                dispatch(ATTN_OUT, [scores, kv, out], [nq, nk, rowsV, head], [1, Math.ceil(nq / 64), HEADS_PER_DISPATCH], heads);
            }
        };
        /** The feed-forward half and norm_out of layer `p` on stream x. */
        const feedForward = (x: GPUBuffer, p: string, n: number, norm: GPUBuffer) => {
            layerNorm(x, `${p}.nf`, norm, n);
            linear(norm, `${p}.ff1`, ff, n, GEMM_GELU);
            linear(ff, `${p}.ff2`, x, n, GEMM_RESIDUAL, tensor(`${p}.g2`));
            statsOf(x, scratchStats, 1, 1, DIM * n, 0, 0, 1);
            dispatch(GN_INPLACE, [x, scratchStats, tensor(`${p}.no.g`), tensor(`${p}.no.b`)], [DIM, 1, n, 0, 0], flat(DIM * n));
        };
        for (let layer = 0; layer < 5; layer += 1) {
            const pf = `tf${layer}`;
            const pt = `tft${layer}`;
            scope = pf;
            if (layer % 2 === 0) {
                for (const [x, p, n, norm, qkv, att] of [[xf, pf, nf, normF, qkvF, attF], [xt, pt, nt, normT, qkvT, attT]] as const) {
                    layerNorm(x, `${p}.n1`, norm, n);
                    linear(norm, `${p}.qkv`, qkv, n);
                    attention(qkv, qkv, att, n, n, 0, DIM, 2 * DIM);
                    linear(att, `${p}.out`, x, n, GEMM_RESIDUAL, tensor(`${p}.g1`));
                    feedForward(x, p, n, norm);
                }
            } else {
                // Both branches' queries, keys and values from the streams as they were, then both updates.
                layerNorm(xf, `${pf}.n1`, normF, nf);
                linear(normF, `${pf}.q`, qkvF, nf);
                layerNorm(xt, `${pf}.nkv`, otherT, nt);
                linear(otherT, `${pf}.kv`, kvF, nt);
                layerNorm(xt, `${pt}.n1`, normT, nt);
                linear(normT, `${pt}.q`, qkvT, nt);
                layerNorm(xf, `${pt}.nkv`, otherF, nf);
                linear(otherF, `${pt}.kv`, kvT, nf);
                attention(qkvF, kvF, attF, nf, nt, 0, 0, DIM);
                attention(qkvT, kvT, attT, nt, nf, 0, 0, DIM);
                linear(attF, `${pf}.out`, xf, nf, GEMM_RESIDUAL, tensor(`${pf}.g1`));
                linear(attT, `${pt}.out`, xt, nt, GEMM_RESIDUAL, tensor(`${pt}.g1`));
                feedForward(xf, pf, nf, normF);
                feedForward(xt, pt, nt, normT);
            }
            stage(`tf${layer}`, xf, DIM * nf);
            stage(`tft${layer}`, xt, DIM * nt);
        }

        // Decoders: skip add, 3x3 (time: 3) rewrite + GLU, DConv, ConvTranspose (+ GELU but the last).
        let cur = ping[0];
        scope = 'dec0';
        linear(xf, 'down', cur, nf);
        for (let i = 0; i < 4; i += 1) {
            const c = 48 * 2 ** (3 - i);
            scope = `dec${i}`;
            const plane = fBins * FRAMES;
            dispatch(ADD, [cur, skips[3 - i]], [c * plane], flat(c * plane));
            conv(cur, `dec${i}.rw`, wide, { hin: fBins, win: FRAMES, kh: 3, kw: 3, ph: 1, pw: 1 });
            dispatch(GLU, [wide, zeros, stream], [c, fBins, FRAMES, 0], flat(c * plane));
            dconv(`dec${i}`, c, fBins, FRAMES, true);
            const next = i === 3 ? freqOut : ping[(i + 1) % 2];
            convTr(stream, `dec${i}.tr`, next, fBins, FRAMES, 0, i === 3 ? 0 : GEMM_GELU);
            fBins *= 4;
            stage(`dec${i}`, next, (rows(`dec${i}.tr.w`) / 4) * fBins * FRAMES);
            cur = next;
        }
        cur = ping[0];
        scope = 'tdec0';
        linear(xt, 'down_t', cur, nt);
        for (let i = 0; i < 4; i += 1) {
            const c = 48 * 2 ** (3 - i);
            scope = `tdec${i}`;
            dispatch(ADD, [cur, tskips[3 - i]], [c * tLen], flat(c * tLen));
            conv(cur, `tdec${i}.rw`, wide, { hin: 1, win: tLen, kh: 1, kw: 3, pw: 1 });
            dispatch(GLU, [wide, zeros, stream], [c, 1, tLen, 0], flat(c * tLen));
            dconv(`tdec${i}`, c, 1, tLen, false);
            const next = i === 3 ? timeOut : ping[(i + 1) % 2];
            convTr(stream, `tdec${i}.tr`, next, 1, tLen, 1, i === 3 ? 0 : GEMM_GELU);
            tLen *= 4;
            stage(`tdec${i}`, next, (rows(`tdec${i}.tr.w`) / 4) * tLen);
            cur = next;
        }

        // The chosen source back to audio: iSTFT of its four spectral channels, plus its time-branch half.
        scope = 'output';
        dispatch(ISTFT_A, [freqOut, specStats, tw, dft], [FRAMES, source], [1, 64, 2 * FRAMES]);
        dispatch(ISTFT_B, [dft, tw, tensor('istft.window'), frames], [FRAMES], [1, 64, 2 * FRAMES]);
        dispatch(OVERLAP_ADD, [frames, tensor('istft.env'), timeOut, mixStats, outBuffer], [FRAMES, L, source], flat(2 * L));
        stage('out', outBuffer, 2 * L);

        const invalid = await device.popErrorScope();
        if (invalid) {
            owned.forEach(buffer => buffer.destroy());
            throw new Error(`htdemucs graph rejected: ${invalid.message}`);
        }
        const model = new HtdemucsWgsl(device, steps, mixBuffer, outBuffer, owned);
        await device.queue.onSubmittedWorkDone();
        return model;
    }

    /**
     * One segment: `left` and `right` of exactly HTDEMUCS_SEGMENT samples at 44.1 kHz. `slice` as in
     * BeatThisWgsl.run: 'stage' submits at every stage boundary, 'dispatch' after every dispatch,
     * 'auto' at stage boundaries but per dispatch inside any stage that outlasted `budgetMs` (one
     * 120 Hz frame by default), relearnt every RELEARN_RUNS runs. Results are identical whatever the
     * slicing.
     */
    async run(left: Float32Array, right: Float32Array, options: {
        stages?: boolean; slice?: 'none' | 'stage' | 'dispatch' | 'auto'; budgetMs?: number; timings?: boolean;
    } = {}): Promise<HtdemucsWgslResult> {
        const L = HTDEMUCS_SEGMENT;
        if (left.length !== L || right.length !== L) throw new Error(`htdemucs segment must be ${L} samples per channel, got ${left.length} and ${right.length}`);
        const { device } = this;
        device.queue.writeBuffer(this.mixBuffer, 0, left.buffer, left.byteOffset, left.byteLength);
        device.queue.writeBuffer(this.mixBuffer, L * 4, right.buffer, right.byteOffset, right.byteLength);

        let encoder = device.createCommandEncoder();
        let pass: GPUComputePassEncoder | null = null;
        const readbacks: { name: string; buffer: GPUBuffer }[] = [];
        let gpuMs = 0;
        let slices = 0;
        const slice = options.slice ?? 'none';
        const submit = async () => {
            pass?.end();
            pass = null;
            const started = performance.now();
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            const took = performance.now() - started;
            gpuMs += took;
            slices += 1;
            encoder = device.createCommandEncoder();
            return took;
        };
        const budgetMs = options.budgetMs ?? 8;
        const timings: { label: string; ms: number }[] = [];
        let lastLabel = '';
        if (slice === 'auto' && ++this.autoRuns % RELEARN_RUNS === 0) this.fineStages.clear();
        let stageIndex = 0;
        const wallStarted = performance.now();
        for (const step of this.steps) {
            const perDispatch = slice === 'dispatch' || (slice === 'auto' && this.fineStages.has(stageIndex));
            if (perDispatch && pass) {
                const took = await submit();
                if (options.timings) timings.push({ label: lastLabel, ms: took });
            }
            if (step.kind === 'dispatch') {
                lastLabel = step.label;
                pass ??= encoder.beginComputePass();
                pass.setPipeline(step.pipeline);
                pass.setBindGroup(0, step.group);
                pass.dispatchWorkgroups(...step.count);
                continue;
            }
            if (step.kind === 'copy') {
                pass?.end();
                pass = null;
                encoder.copyBufferToBuffer(step.from, 0, step.to, 0, step.bytes);
                continue;
            }
            const coarse = slice === 'stage' || (slice === 'auto' && !this.fineStages.has(stageIndex));
            if (coarse && step.name !== 'out') {
                const took = await submit();
                if (slice === 'auto' && took > budgetMs) this.fineStages.add(stageIndex);
            }
            stageIndex += 1;
            if (!options.stages && step.name !== 'out') continue;
            pass?.end();
            pass = null;
            const readback = device.createBuffer({ size: step.floats * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
            encoder.copyBufferToBuffer(step.buffer, 0, readback, 0, step.floats * 4);
            readbacks.push({ name: step.name, buffer: readback });
        }
        await submit();
        const wallMs = performance.now() - wallStarted;

        const stages: Record<string, Float32Array> = {};
        for (const { name, buffer } of readbacks) {
            await buffer.mapAsync(GPUMapMode.READ);
            stages[name] = new Float32Array(buffer.getMappedRange().slice(0));
            buffer.destroy();
        }
        const out = stages.out;
        if (!options.stages) delete stages.out;
        return {
            left: out.subarray(0, L),
            right: out.subarray(L, 2 * L),
            gpuMs,
            wallMs,
            slices,
            ...(options.stages ? { stages } : {}),
            ...(options.timings ? { timings } : {}),
        };
    }

    destroy(): void {
        this.owned.forEach(buffer => buffer.destroy());
    }
}
