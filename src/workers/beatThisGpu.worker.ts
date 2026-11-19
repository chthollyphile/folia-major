/// <reference types="@webgpu/types" />
import { BeatThisWgsl, type BeatThisWgslManifest } from '../services/analysis/beatThisWgsl/runtime';
import { runPercussiveEnergy } from '../services/analysis/beatThisWgsl/percussive';
import { HtdemucsWgsl, type HtdemucsWgslManifest } from '../services/analysis/htdemucsWgsl/runtime';
import { createFrameClock, sliceMsForFrame, type PacedRunStats, type SlicePacing } from '../services/analysis/gpuSlices';

// src/workers/beatThisGpu.worker.ts
// Beat This! on the renderer's own GPU, beside the visualizer, from a thread that does not paint.
//
// The worker owns its WebGPU device and the models built on it - Beat This! final0 for automix and the
// beat FX, htdemucs for the beat FX's drum stem, each built the first time it is loaded - and answers
// these messages: 'separate' (one htdemucs segment, stereo in, the drum stem out), 'load' (a model's
// weights and manifest, transferred in once), 'run' (a model's mel chunks of up to 1500 frames, logits back;
// with `percussive`, the whole spectrogram as well, whose per-frame percussive energy - HPSS,
// beatThisWgsl/percussive.ts, for the beat accents - comes back with them), 'percussive' (that alone, for
// a track whose beats are already known) and 'dispose' (destroy the device before the page terminates
// this thread, so the GPU memory goes back at once rather than whenever the dead thread's objects are
// collected), and 'unload' (one model's GPU memory back, the device kept: phase 4's residency, decided
// in beatThisGpu.ts). Each
// chunk and segment is run 'paced' (services/analysis/gpuSlices.ts): cut into slices of a quarter
// of a display frame of GPU time, by each dispatch's measured cost, and let go when the last is done
// or the next frame comes - because the GPU only switches between command buffers, and one
// 45-80 ms submit is enough to cost a busy visualizer several frames (measured with
// dev/beat-this-wgsl/coexist.ts; the numbers are in beatThisGpu.ts).
//
// Any failure is reported back and the caller drops this worker: a lost device or a failed
// pipeline leaves nothing here worth keeping, and a fresh worker is the clean way to try again.

type ModelName = 'beat_this';

type Request =
    | { id: number; kind: 'load'; model: ModelName; weights: Uint8Array<ArrayBuffer>; manifest: BeatThisWgslManifest }
    | { id: number; kind: 'load'; model: 'htdemucs'; weights: Uint8Array<ArrayBuffer>; manifest: HtdemucsWgslManifest }
    | { id: number; kind: 'separate'; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
    | { id: number; kind: 'run'; model: ModelName; chunks: Float32Array<ArrayBuffer>[]; percussive?: { mel: Float32Array<ArrayBuffer>; frames: number } }
    | { id: number; kind: 'percussive'; mel: Float32Array<ArrayBuffer>; frames: number }
    | { id: number; kind: 'unload'; model: ModelName | 'htdemucs' }
    | { id: number; kind: 'dispose' };

const models = new Map<ModelName, BeatThisWgsl>();
let htdemucs: HtdemucsWgsl | null = null;
let device: GPUDevice | null = null;
let deviceLabel = '';
/** The adapter's vendor and architecture alone, without deviceLabel's precision suffix. */
let deviceName = '';
let f16 = false;
/** Why the device went away, once it has; every later request is answered with it. */
let lost: string | null = null;

/** The display's frames, as this worker sees them: what a paced slice is let go at, and sized by. */
const frames = createFrameClock(
    typeof self.requestAnimationFrame === 'function' ? callback => self.requestAnimationFrame(callback) : undefined,
);
/**
 * Slices queued on the GPU at once. On macOS (Metal) a slice's completion comes back as soon as the
 * GPU is done, so one at a time, each waited for, costs next to nothing and keeps the picture's
 * share largest (the M4 numbers in beatThisGpu.ts). Elsewhere - Dawn on D3D12 measured, Vulkan
 * assumed alike - the completion can come back frames late while the visualizer presents, so up to
 * four are kept queued and the next goes at the next frame instead of waiting for it.
 */
const IN_FLIGHT = /Mac/.test(navigator.platform) ? 1 : 4;
/** The pacing for the next run, sized by the display frame seen so far. */
const pacing = (): SlicePacing => ({ sliceMs: sliceMsForFrame(frames.frameMs), inFlight: IN_FLIGHT, frame: frames.next });

/** The device, made on the first load. A failure here is the machine's, not a model's. */
const openDevice = async (): Promise<GPUDevice> => {
    if (device) return device;
    if (!navigator.gpu) throw new Error('no WebGPU in this worker');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    // fp16 tiles where the device has shader-f16 ('storage': f32 arithmetic, 7/7 tracks identical to
    // the f32 run); everywhere else the same fp16 weights are unpacked and computed in f32.
    f16 = adapter.features.has('shader-f16');
    // timestamp-query where offered: the paced slices are cut by each dispatch's measured GPU time.
    const requiredFeatures: GPUFeatureName[] = [];
    if (f16) requiredFeatures.push('shader-f16');
    if (adapter.features.has('timestamp-query')) requiredFeatures.push('timestamp-query');
    const opened = await adapter.requestDevice({ requiredFeatures });
    opened.lost.then((info) => {
        lost = `device lost (${info.reason}): ${info.message}`;
        models.clear();
        htdemucs = null;
    });
    deviceName = `${adapter.info.vendor} ${adapter.info.architecture}`;
    deviceLabel = `${deviceName}${f16 ? ' f16' : ''}`;
    device = opened;
    return opened;
};

self.onmessage = async (event: MessageEvent<Request>) => {
    const request = event.data;
    try {
        if (request.kind === 'load') {
            let opened: GPUDevice;
            try {
                opened = await openDevice();
            } catch (error) {
                self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error), scope: 'device' });
                return;
            }
            if (request.model === 'htdemucs') {
                if (!htdemucs) {
                    try {
                        // f16 GEMMs where the device has shader-f16: ~10% faster, the same drum hits (kernels.ts GemmMode).
                        // @note Since the analysis service's phase 3: f32, and all four sources. automix
                        // takes its stems from here too, and in f16 the bass missed the 0.01 dB red line
                        // on one reference segment (0.029 dB; f32: 0.0066 at worst over all four). The
                        // user chose f32 for both (2026-10-17), so the two share one set of segments:
                        // about 9% slower a segment on an M4, the same weights.
                        htdemucs = await HtdemucsWgsl.create(opened, request.weights, request.manifest, { sources: [0, 1, 2, 3] });
                    } catch (error) {
                        self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error), scope: 'model' });
                        return;
                    }
                }
                // deviceLabel's ' f16' is beat_this's 'storage' mode; htdemucs is built in f32 (above), so its load log says f32.
                // (From the PR #750 re-review, 2026-10-19: the log said f16 for the f32 htdemucs.)
                self.postMessage({ id: request.id, result: `${deviceName} f32`, bytes: htdemucs?.bytes });
                return;
            }
            if (!models.has(request.model)) {
                try {
                    models.set(request.model, await BeatThisWgsl.create(opened, request.weights, request.manifest, { f16: f16 ? 'storage' : undefined }));
                } catch (error) {
                    self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error), scope: 'model' });
                    return;
                }
            }
            self.postMessage({ id: request.id, result: deviceLabel, bytes: models.get(request.model)?.bytes });
            return;
        }
        if (request.kind === 'percussive') {
            let opened: GPUDevice;
            try {
                opened = await openDevice();
            } catch (error) {
                self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error), scope: 'device' });
                return;
            }
            if (lost) throw new Error(lost);
            const energy = await runPercussiveEnergy(opened, request.mel, request.frames, pacing());
            self.postMessage({ id: request.id, result: energy }, { transfer: [energy.percussive.buffer, energy.total.buffer] });
            return;
        }
        if (request.kind === 'separate') {
            if (lost) throw new Error(lost);
            if (!htdemucs) throw new Error('htdemucs not loaded');
            // Paced as a beat_this chunk is, so a segment never holds the visualizer's frames.
            const result = await htdemucs.run(request.left, request.right, { slice: 'paced', pacing: pacing() });
            // htdemucs' four sources in its order (drums, bass, other, vocals): views of the one readback,
            // which is transferred once, uncopied (review: eight copies were 5.5 MB more per segment).
            const { stems } = result;
            self.postMessage({ id: request.id, result: { stems, paced: result.paced } }, { transfer: [stems[0].left.buffer] });
            return;
        }
        if (request.kind === 'unload') {
            // Between runs only (the page never asks for one under a run of the model): its buffers go back now.
            if (request.model === 'htdemucs') {
                htdemucs?.destroy();
                htdemucs = null;
            } else {
                models.get(request.model)?.destroy();
                models.delete(request.model);
            }
            self.postMessage({ id: request.id, result: true });
            return;
        }
        if (request.kind === 'dispose') {
            for (const model of models.values()) model.destroy();
            models.clear();
            htdemucs?.destroy();
            htdemucs = null;
            device?.destroy();
            self.postMessage({ id: request.id, result: true });
            return;
        }
        const model = models.get(request.model);
        const beat: Float32Array[] = [];
        const downbeat: Float32Array[] = [];
        /** The first chunk's pacing, or the one whose run completed the cost table: for the page's log. */
        let paced: PacedRunStats | undefined;
        for (const chunk of request.chunks) {
            if (lost) throw new Error(lost);
            if (!model) throw new Error(`${request.model} not loaded`);
            const result = await model.run(chunk, { slice: 'paced', pacing: pacing() });
            if (!paced || result.paced?.costs) paced = result.paced;
            // Copies: the two tracks are views of one readback, and each is transferred on its own.
            beat.push(result.beat.slice());
            downbeat.push(result.downbeat.slice());
        }
        // The percussive energy is an extra: a failure here leaves the beats as they are, without it.
        let percussive: Awaited<ReturnType<typeof runPercussiveEnergy>> | undefined;
        if (request.percussive && device && !lost) {
            try {
                percussive = await runPercussiveEnergy(device, request.percussive.mel, request.percussive.frames, pacing());
            } catch (error) {
                console.warn(`[beat-this-gpu] percussive energy failed: ${(error as Error)?.message ?? error}`);
            }
        }
        const tracks = [...beat, ...downbeat, ...(percussive ? [percussive.percussive, percussive.total] : [])];
        self.postMessage({ id: request.id, result: { beat, downbeat, percussive, paced } }, { transfer: tracks.map(track => track.buffer) });
    } catch (error) {
        self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error) });
    }
};

