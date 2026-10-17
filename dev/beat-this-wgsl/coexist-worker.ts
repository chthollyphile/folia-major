/// <reference types="@webgpu/types" />
import { BeatThisWgsl, BEAT_THIS_WGSL_FRAMES, type BeatThisWgslManifest } from '../../src/services/automix/beatThisWgsl/runtime';

// dev/beat-this-wgsl/coexist-worker.ts
// The inference half of the coexistence test (coexist.ts): a dedicated worker, the place the app
// will run beat_this from, with its own WebGPU device. It runs the phases it is sent - a slicing
// mode and a number of chunks each - and reports when each starts and ends, so the page can file
// every frame it draws under the phase that was running.

interface Phase { name: string; slice: 'none' | 'stage' | 'dispatch' | 'auto'; gapMs: number; chunks: number; inFlight?: number }
interface Start { weights: ArrayBuffer; manifest: BeatThisWgslManifest; chunks: ArrayBuffer; f16?: 'storage' | 'math'; phases: Phase[] }

const post = (message: Record<string, unknown>) => (self as unknown as Worker).postMessage(message);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

self.onmessage = async (event: MessageEvent<Start>) => {
    try {
        const { weights, manifest, chunks, f16, phases } = event.data;
        if (!navigator.gpu) throw new Error('no navigator.gpu in a dedicated worker');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('no WebGPU adapter in the worker');
        const device = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] });
        device.addEventListener('uncapturederror', e => post({ log: `GPU error: ${(e as GPUUncapturedErrorEvent).error.message}` }));
        post({ log: `worker adapter: ${adapter.info.vendor} ${adapter.info.architecture} f16=${f16 ?? 'off'}` });

        const model = await BeatThisWgsl.create(device, new Uint8Array(weights), manifest, { f16 });
        const perChunk = BEAT_THIS_WGSL_FRAMES * 128;
        const mel = new Float32Array(chunks);
        const count = mel.length / perChunk;
        const reference: Float32Array[] = [];
        for (let i = 0; i < count; i += 1) reference.push((await model.run(mel.subarray(i * perChunk, (i + 1) * perChunk))).beat.slice());

        for (const phase of phases) {
            post({ phase: phase.name, at: performance.timeOrigin + performance.now() });
            const gpu: number[] = [];
            const wall: number[] = [];
            let slices = 0;
            let mismatched = 0;
            const between = phase.gapMs > 0 ? () => sleep(phase.gapMs) : undefined;
            for (let i = 0; i < phase.chunks; i += 1) {
                const index = i % Math.max(1, count);
                const result = phase.chunks && count
                    ? await model.run(mel.subarray(index * perChunk, (index + 1) * perChunk), { slice: phase.slice, inFlight: phase.inFlight, between })
                    : null;
                if (!result) continue;
                gpu.push(result.gpuMs);
                wall.push(result.wallMs);
                slices = result.slices;
                if (result.beat.some((value, at) => value !== reference[index][at])) mismatched += 1;
            }
            if (!phase.chunks) await sleep(3000);
            const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
            post({
                phaseEnd: phase.name,
                at: performance.timeOrigin + performance.now(),
                gpuMs: median(gpu),
                wallMs: median(wall),
                slices,
                mismatched,
            });
        }
        model.destroy();
        device.destroy();
        post({ done: true });
    } catch (error) {
        post({ error: String((error as Error)?.stack ?? error) });
    }
};
