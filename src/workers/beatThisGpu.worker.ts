/// <reference types="@webgpu/types" />
import { BeatThisWgsl, type BeatThisWgslManifest } from '../services/analysis/beatThisWgsl/runtime';
import { runPercussiveEnergy } from '../services/analysis/beatThisWgsl/percussive';
import { HtdemucsWgsl, type HtdemucsWgslManifest } from '../services/analysis/htdemucsWgsl/runtime';

// src/workers/beatThisGpu.worker.ts
// Beat This! on the renderer's own GPU, beside the visualizer, from a thread that does not paint.
//
// The worker owns its WebGPU device and the models built on it - final0 for automix, small0 for the
// beat FX, htdemucs for the beat FX's drum stem, each built the first time it is loaded - and answers
// these messages: 'separate' (one htdemucs segment, stereo in, the drum stem out), 'load' (a model's
// weights and manifest, transferred in once), 'run' (a model's mel chunks of up to 1500 frames, logits back;
// with `percussive`, the whole spectrogram as well, whose per-frame percussive energy - HPSS,
// beatThisWgsl/percussive.ts, for the beat accents - comes back with them), 'percussive' (that alone, for
// a track whose beats are already known) and 'dispose' (destroy the device before the page terminates
// this thread, so the GPU memory goes back at once rather than whenever the dead thread's objects are
// collected). Each
// chunk is run with 'auto' slicing - one stage on the GPU at a time, cut finer wherever a stage
// outlasts a 120 Hz frame - because the GPU only switches between command buffers, and one
// 45-80 ms submit is enough to cost a busy visualizer several frames (measured with
// dev/beat-this-wgsl/coexist.ts; the numbers are in beatThisGpu.ts).
//
// Any failure is reported back and the caller drops this worker: a lost device or a failed
// pipeline leaves nothing here worth keeping, and a fresh worker is the clean way to try again.

type ModelName = 'beat_this' | 'beat_this_small';

type Request =
    | { id: number; kind: 'load'; model: ModelName; weights: Uint8Array<ArrayBuffer>; manifest: BeatThisWgslManifest }
    | { id: number; kind: 'load'; model: 'htdemucs'; weights: Uint8Array<ArrayBuffer>; manifest: HtdemucsWgslManifest }
    | { id: number; kind: 'separate'; left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
    | { id: number; kind: 'run'; model: ModelName; chunks: Float32Array<ArrayBuffer>[]; percussive?: { mel: Float32Array<ArrayBuffer>; frames: number } }
    | { id: number; kind: 'percussive'; mel: Float32Array<ArrayBuffer>; frames: number }
    | { id: number; kind: 'dispose' };

const models = new Map<ModelName, BeatThisWgsl>();
let htdemucs: HtdemucsWgsl | null = null;
let device: GPUDevice | null = null;
let deviceLabel = '';
let f16 = false;
/** Why the device went away, once it has; every later request is answered with it. */
let lost: string | null = null;

/** The device, made on the first load. A failure here is the machine's, not a model's. */
const openDevice = async (): Promise<GPUDevice> => {
    if (device) return device;
    if (!navigator.gpu) throw new Error('no WebGPU in this worker');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    // fp16 tiles where the device has shader-f16 ('storage': f32 arithmetic, 7/7 tracks identical to
    // the f32 run); everywhere else the same fp16 weights are unpacked and computed in f32.
    f16 = adapter.features.has('shader-f16');
    const opened = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] });
    opened.lost.then((info) => {
        lost = `device lost (${info.reason}): ${info.message}`;
        models.clear();
        htdemucs = null;
    });
    deviceLabel = `${adapter.info.vendor} ${adapter.info.architecture}${f16 ? ' f16' : ''}`;
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
                        htdemucs = await HtdemucsWgsl.create(opened, request.weights, request.manifest, { f16 });
                    } catch (error) {
                        self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error), scope: 'model' });
                        return;
                    }
                }
                self.postMessage({ id: request.id, result: deviceLabel });
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
            self.postMessage({ id: request.id, result: deviceLabel });
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
            const energy = await runPercussiveEnergy(opened, request.mel, request.frames);
            self.postMessage({ id: request.id, result: energy }, { transfer: [energy.percussive.buffer, energy.total.buffer] });
            return;
        }
        if (request.kind === 'separate') {
            if (lost) throw new Error(lost);
            if (!htdemucs) throw new Error('htdemucs not loaded');
            // 'auto' as for a beat_this chunk: one stage on the GPU at a time, finer where a stage
            // outlasts a 120 Hz frame, so a segment never holds the visualizer's frames.
            const result = await htdemucs.run(request.left, request.right, { slice: 'auto' });
            const left = result.left.slice();
            const right = result.right.slice();
            self.postMessage({ id: request.id, result: { left, right } }, { transfer: [left.buffer, right.buffer] });
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
        for (const chunk of request.chunks) {
            if (lost) throw new Error(lost);
            if (!model) throw new Error(`${request.model} not loaded`);
            const result = await model.run(chunk, { slice: 'auto' });
            // Copies: the two tracks are views of one readback, and each is transferred on its own.
            beat.push(result.beat.slice());
            downbeat.push(result.downbeat.slice());
        }
        // The percussive energy is an extra: a failure here leaves the beats as they are, without it.
        let percussive: Awaited<ReturnType<typeof runPercussiveEnergy>> | undefined;
        if (request.percussive && device && !lost) {
            try {
                percussive = await runPercussiveEnergy(device, request.percussive.mel, request.percussive.frames);
            } catch (error) {
                console.warn(`[beat-this-gpu] percussive energy failed: ${(error as Error)?.message ?? error}`);
            }
        }
        const tracks = [...beat, ...downbeat, ...(percussive ? [percussive.percussive, percussive.total] : [])];
        self.postMessage({ id: request.id, result: { beat, downbeat, percussive } }, { transfer: tracks.map(track => track.buffer) });
    } catch (error) {
        self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error) });
    }
};

