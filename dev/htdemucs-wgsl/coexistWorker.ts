/// <reference types="@webgpu/types" />
import { HtdemucsWgsl, HTDEMUCS_SEGMENT, type HtdemucsWgslManifest } from '../../src/services/analysis/htdemucsWgsl/runtime';

// dev/htdemucs-wgsl/coexistWorker.ts
// The inference half of the htdemucs coexistence test (coexist.ts): a dedicated worker with its own
// WebGPU device, as the app's (src/workers/beatThisGpu.worker.ts), running one segment over and over
// per phase - a slicing mode, a number of segments - and reporting when each phase starts and ends so
// the page can file every frame it draws under it. A 'roundtrip' phase submits empty command buffers
// instead and measures submit to done: on Windows that is frames, not the GPU's time, while the
// visualizer presents (the reason for gpuSlices.ts).
//
// `slice` is passed through as written, and nothing but the runtime is imported, so the same file
// bundles against an older runtime too (a checkout before 'paced', whose 'auto' it then runs) for a
// before / after comparison. The frame clock and slice size below are gpuSlices.ts' own, written out.

interface Phase { name: string; slice: string; segments?: number; inFlight?: number; roundtrip?: boolean }
interface Start { weights: ArrayBuffer; manifest: HtdemucsWgslManifest; mix: ArrayBuffer; phases: Phase[] }

const post = (message: Record<string, unknown>) => (self as unknown as Worker).postMessage(message);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
/** gpuSlices.ts createFrameClock: one shared frame request, and the shortest interval seen. */
const frames = (() => {
    let waiting: Promise<void> | null = null;
    let lastAt = 0;
    const intervals: number[] = [];
    const raf = typeof self.requestAnimationFrame === 'function' ? (callback: (at: number) => void) => self.requestAnimationFrame(callback) : undefined;
    return {
        next: (): Promise<void> => {
            if (!raf) return new Promise<void>(() => undefined);
            waiting ??= new Promise<void>((resolve) => {
                raf((at) => {
                    if (lastAt && at > lastAt) intervals.push(at - lastAt);
                    if (intervals.length > 32) intervals.shift();
                    lastAt = at;
                    waiting = null;
                    resolve();
                });
            });
            return waiting;
        },
        get frameMs(): number | null { return intervals.length ? Math.min(...intervals) : null; },
    };
})();
/** gpuSlices.ts sliceMsForFrame: a quarter frame within 1-4 ms. */
const sliceMsForFrame = (frameMs: number | null) => Math.min(4, Math.max(1, (frameMs && frameMs > 0 ? frameMs : 1000 / 120) / 4));
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;

self.onmessage = async (event: MessageEvent<Start>) => {
    try {
        const { weights, manifest, mix, phases } = event.data;
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('no WebGPU adapter in the worker');
        const timestamps = adapter.features.has('timestamp-query');
        const device = await adapter.requestDevice({
            requiredFeatures: timestamps ? ['timestamp-query'] : [],
            requiredLimits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
        });
        device.addEventListener('uncapturederror', (e) => { post({ log: `GPU error: ${e.error.message}` }); });
        post({ log: `worker adapter: ${adapter.info.vendor} ${adapter.info.architecture}, timestamp-query ${timestamps}, worker rAF ${typeof self.requestAnimationFrame === 'function'}` });
        // f32 and all four sources, as the app builds it.
        const model = await HtdemucsWgsl.create(device, new Uint8Array(weights), manifest, { sources: [0, 1, 2, 3] });
        const L = HTDEMUCS_SEGMENT;
        const segment = new Float32Array(mix);
        const left = segment.subarray(0, L);
        const right = segment.subarray(L, 2 * L);
        type RunOptions = Parameters<HtdemucsWgsl['run']>[2];
        const run = (options: RunOptions) => model.run(left, right, options);
        const reference = (await run({ slice: 'none' })).left.slice();
        // The display frame, for the paced slice size: a second of frames asked for in a row.
        for (let i = 0; i < 30; i += 1) await Promise.race([frames.next(), sleep(100)]);
        post({ log: `worker frame ${frames.frameMs?.toFixed(2) ?? 'unknown'} ms -> paced slices of ${sliceMsForFrame(frames.frameMs).toFixed(2)} ms` });

        for (const phase of phases) {
            post({ phase: phase.name, at: performance.timeOrigin + performance.now() });
            const walls: number[] = [];
            const trips: number[] = [];
            let slices = 0;
            let mismatched = 0;
            const notes: string[] = [];
            if (phase.roundtrip) {
                for (let i = 0; i < 60; i += 1) {
                    const started = performance.now();
                    device.queue.submit([device.createCommandEncoder().finish()]);
                    await device.queue.onSubmittedWorkDone();
                    trips.push(performance.now() - started);
                }
            } else if (phase.segments) {
                for (let i = 0; i < phase.segments; i += 1) {
                    const started = performance.now();
                    const result = await run({
                        slice: phase.slice as NonNullable<RunOptions>['slice'],
                        pacing: { sliceMs: sliceMsForFrame(frames.frameMs), inFlight: phase.inFlight ?? 1, frame: frames.next },
                    });
                    walls.push(performance.now() - started);
                    slices = result.slices;
                    if (result.left.some((value, at) => value !== reference[at])) mismatched += 1;
                    const paced = (result as { paced?: { costs?: { dispatches: number; totalMs: number; longestMs: number }; noTimestamps?: boolean } }).paced;
                    if (paced?.costs) notes.push(`costs: ${paced.costs.dispatches} dispatches, ${paced.costs.totalMs.toFixed(1)} ms GPU, longest ${paced.costs.longestMs.toFixed(2)} ms`);
                    if (paced?.noTimestamps) notes.push('no timestamps: cut at stage boundaries');
                }
            } else {
                await sleep(3000);
            }
            const trip = trips.length ? ` | submit->done median ${median(trips).toFixed(1)} p90 ${percentile(trips, 0.9).toFixed(1)} ms` : '';
            post({ log: `  ${phase.name}: ${walls.map(ms => ms.toFixed(0)).join(' ')}${trip}${notes.length ? ` | ${notes.join('; ')}` : ''}` });
            post({ phaseEnd: phase.name, at: performance.timeOrigin + performance.now(), wallMs: median(walls), slices, mismatched });
        }
        model.destroy();
        device.destroy();
        post({ done: true });
    } catch (error) {
        post({ error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
};
