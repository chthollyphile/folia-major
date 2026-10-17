/// <reference types="@webgpu/types" />
import { BeatThisWgsl, type BeatThisWgslManifest } from '../services/automix/beatThisWgsl/runtime';

// src/workers/beatThisGpu.worker.ts
// Beat This! on the renderer's own GPU, beside the visualizer, from a thread that does not paint.
//
// The worker owns its WebGPU device and the model built on it, and answers three messages: 'load'
// (weights and manifest, transferred in once), 'run' (mel chunks of up to 1500 frames, logits back) and
// 'dispose' (destroy the device before the page terminates this thread, so the GPU memory goes back
// at once rather than whenever the dead thread's objects are collected). Each
// chunk is run with 'auto' slicing - one stage on the GPU at a time, cut finer wherever a stage
// outlasts a 120 Hz frame - because the GPU only switches between command buffers, and one
// 45-80 ms submit is enough to cost a busy visualizer several frames (measured with
// dev/beat-this-wgsl/coexist.ts; the numbers are in beatThisGpu.ts).
//
// Any failure is reported back and the caller drops this worker: a lost device or a failed
// pipeline leaves nothing here worth keeping, and a fresh worker is the clean way to try again.

type Request =
    | { id: number; kind: 'load'; weights: Uint8Array<ArrayBuffer>; manifest: BeatThisWgslManifest }
    | { id: number; kind: 'run'; chunks: Float32Array<ArrayBuffer>[] }
    | { id: number; kind: 'dispose' };

let model: BeatThisWgsl | null = null;
let device: GPUDevice | null = null;
/** Why the device went away, once it has; every later request is answered with it. */
let lost: string | null = null;

const load = async (weights: Uint8Array<ArrayBuffer>, manifest: BeatThisWgslManifest) => {
    if (!navigator.gpu) throw new Error('no WebGPU in this worker');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    // fp16 tiles where the device has shader-f16 ('storage': f32 arithmetic, 7/7 tracks identical to
    // the f32 run); everywhere else the same fp16 weights are unpacked and computed in f32.
    const f16 = adapter.features.has('shader-f16');
    device = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] });
    device.lost.then((info) => {
        lost = `device lost (${info.reason}): ${info.message}`;
        model = null;
    });
    model = await BeatThisWgsl.create(device, weights, manifest, { f16: f16 ? 'storage' : undefined });
    return `${adapter.info.vendor} ${adapter.info.architecture}${f16 ? ' f16' : ''}`;
};

self.onmessage = async (event: MessageEvent<Request>) => {
    const request = event.data;
    try {
        if (request.kind === 'load') {
            const adapter = await load(request.weights, request.manifest);
            self.postMessage({ id: request.id, result: adapter });
            return;
        }
        if (request.kind === 'dispose') {
            model?.destroy();
            device?.destroy();
            model = null;
            self.postMessage({ id: request.id, result: true });
            return;
        }
        const beat: Float32Array[] = [];
        const downbeat: Float32Array[] = [];
        for (const chunk of request.chunks) {
            if (lost) throw new Error(lost);
            if (!model) throw new Error('model not loaded');
            const result = await model.run(chunk, { slice: 'auto' });
            // Copies: the two tracks are views of one readback, and each is transferred on its own.
            beat.push(result.beat.slice());
            downbeat.push(result.downbeat.slice());
        }
        self.postMessage({ id: request.id, result: { beat, downbeat } }, { transfer: [...beat, ...downbeat].map(track => track.buffer) });
    } catch (error) {
        self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error) });
    }
};

