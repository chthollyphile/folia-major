/// <reference types="@webgpu/types" />
import { BeatThisWgsl, type BeatThisWgslManifest } from '../services/analysis/beatThisWgsl/runtime';

// src/workers/beatThisGpu.worker.ts
// Beat This! on the renderer's own GPU, beside the visualizer, from a thread that does not paint.
//
// The worker owns its WebGPU device and the models built on it - final0 for automix, small0 for the
// beat FX, each built the first time it is loaded - and answers three messages: 'load' (a model's
// weights and manifest, transferred in once), 'run' (a model's mel chunks of up to 1500 frames, logits back) and
// 'dispose' (destroy the device before the page terminates this thread, so the GPU memory goes back
// at once rather than whenever the dead thread's objects are collected). Each
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
    | { id: number; kind: 'run'; model: ModelName; chunks: Float32Array<ArrayBuffer>[] }
    | { id: number; kind: 'dispose' };

const models = new Map<ModelName, BeatThisWgsl>();
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
        if (request.kind === 'dispose') {
            for (const model of models.values()) model.destroy();
            models.clear();
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
        self.postMessage({ id: request.id, result: { beat, downbeat } }, { transfer: [...beat, ...downbeat].map(track => track.buffer) });
    } catch (error) {
        self.postMessage({ id: request.id, error: String((error as Error)?.message ?? error) });
    }
};

