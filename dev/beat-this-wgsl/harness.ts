/// <reference types="@webgpu/types" />
import { BeatThisWgsl, BEAT_THIS_WGSL_FRAMES, type BeatThisWgslManifest } from '../../src/services/automix/beatThisWgsl/runtime';
import { readPackedWeights } from './packed';
import { BEAT_THIS_SAMPLE_RATE, melSpectrogram, splitForModel } from '../../src/services/automix/beatThis';
import { runBeatThisGpu } from '../../src/services/automix/beatThisGpu';

// dev/beat-this-wgsl/harness.ts
// Renderer side of the test shell (see main.cjs): loads the exported weights and the mel chunks,
// runs each chunk once for the logits (plus every stage of chunk 0 when asked), then times
// `repeat` further passes over all chunks. Output: logits.f32 as [2, chunks, 1500] (beat then
// downbeat, the layout bt/cmp.py reads) and stage_<name>.f32.
//
// With BTW_SONGS (comma-separated audio paths) it instead runs whole tracks through the app's own
// front end (melSpectrogram + splitForModel) and writes, per track, the chunks, their placement and
// the WGSL logits, so compare-songs.ts can run the same chunks through ORT and diff the beat lists.
// BTW_TRIM_SEC cuts each track to its first seconds (under 30 s is the one-short-chunk case).
// BTW_APP=1 runs the songs through the app's own path instead - beatThisGpu.ts and its worker
// (bundled separately as beatThisGpu-worker.js), with the weights handed over the way the main
// process hands them over.

// Node's require, read off the window so the bundler leaves these imports to the renderer at runtime.
const nodeRequire = (globalThis as unknown as { require: (id: string) => any }).require;
const { ipcRenderer } = nodeRequire('electron');
const fs = nodeRequire('fs');
const path = nodeRequire('path');

const log = (line: string) => ipcRenderer.send('btw-log', line);

async function main() {
    const config = await ipcRenderer.invoke('btw-config');
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    const info = adapter.info;
    log(`adapter: ${info.vendor} ${info.architecture} ${info.description} f16=${adapter.features.has('shader-f16')}`);
    const device = await adapter.requestDevice({
        requiredFeatures: [
            ...(config.profile && adapter.features.has('timestamp-query') ? ['timestamp-query' as const] : []),
            ...(config.f16 ? ['shader-f16' as const] : []),
        ],
    });
    device.addEventListener('uncapturederror', (event) => log(`GPU error: ${(event as GPUUncapturedErrorEvent).error.message}`));

    const { weights, manifest } = readPackedWeights(fs.readFileSync(config.weights));
    if (config.songs.length) {
        if (config.app) installAppBridge(weights, manifest, config.out);
        await runSongs(device, weights, manifest, config.songs, config.out, config.f16, config.trimSec, config.app);
        ipcRenderer.send('btw-done', 0);
        return;
    }
    const chunkBytes = fs.readFileSync(config.chunks);
    const chunks = new Float32Array(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength / 4);
    const perChunk = BEAT_THIS_WGSL_FRAMES * 128;
    const count = chunks.length / perChunk;

    let started = performance.now();
    const model = await BeatThisWgsl.create(device, weights, manifest, { f16: config.f16 });
    log(`create: ${(performance.now() - started).toFixed(0)} ms`);

    const T = BEAT_THIS_WGSL_FRAMES;
    const logits = new Float32Array(2 * count * T);
    for (let i = 0; i < count; i += 1) {
        started = performance.now();
        const result = await model.run(chunks.subarray(i * perChunk, (i + 1) * perChunk), { stages: config.stages && i === 0 });
        log(`chunk ${i}: ${(performance.now() - started).toFixed(1)} ms (gpu ${result.gpuMs.toFixed(1)} ms)`);
        logits.set(result.beat, i * T);
        logits.set(result.downbeat, (count + i) * T);
        for (const [name, data] of Object.entries(result.stages ?? {})) {
            fs.writeFileSync(path.join(config.out, `stage_${name}.f32`), Buffer.from(data.buffer));
        }
    }
    fs.writeFileSync(path.join(config.out, 'logits.f32'), Buffer.from(logits.buffer));

    const times: number[] = [];
    for (let r = 0; r < config.repeat; r += 1) {
        for (let i = 0; i < count; i += 1) {
            times.push((await model.run(chunks.subarray(i * perChunk, (i + 1) * perChunk))).gpuMs);
        }
    }
    if (config.profile) await profileRuns(model, chunks.subarray(perChunk, 2 * perChunk), Math.max(3, config.repeat), config.out);
    if (times.length) {
        times.sort((a, b) => a - b);
        log(`timed ${times.length} runs: median ${times[times.length >> 1].toFixed(1)} ms, min ${times[0].toFixed(1)} ms`);
    }
    model.destroy();
    ipcRenderer.send('btw-done', 0);
}

/** Times every dispatch over `repeats` runs of one chunk and prints where the GPU time goes. */
async function profileRuns(model: BeatThisWgsl, chunk: Float32Array, repeats: number, out: string) {
    const runs: { label: string; ms: number }[][] = [];
    for (let r = 0; r < repeats; r += 1) {
        const result = await model.run(chunk, { profile: true });
        if (!result.profile) {
            log('profile: device has no timestamp-query');
            return;
        }
        runs.push(result.profile);
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
    const rows = runs[0].map((step, index) => ({ label: step.label, ms: median(runs.map(run => run[index].ms)) }));
    fs.writeFileSync(path.join(out, 'profile.json'), JSON.stringify(rows, null, 1));
    const total = rows.reduce((sum, row) => sum + row.ms, 0);
    const summarize = (title: string, key: (label: string) => string) => {
        const groups = new Map<string, { ms: number; count: number }>();
        for (const row of rows) {
            const group = groups.get(key(row.label)) ?? { ms: 0, count: 0 };
            group.ms += row.ms;
            group.count += 1;
            groups.set(key(row.label), group);
        }
        log(`-- ${title}`);
        [...groups.entries()].sort((a, b) => b[1].ms - a[1].ms).forEach(([name, group]) =>
            log(`${name.padEnd(34)} ${group.ms.toFixed(2).padStart(8)} ms ${((100 * group.ms) / total).toFixed(1).padStart(5)}%  x${group.count}`));
    };
    log(`profile: ${rows.length} dispatches, ${total.toFixed(1)} ms GPU (median of ${repeats})`);
    // "block0.time.attn matmul qkvg.w" -> kernel "matmul qkvg.w"; stage "block0.time".
    summarize('by kernel', label => label.split(' ').slice(1).join(' ').replace(/^(\w+) (\w+)\..*$/, '$1 $2'));
    summarize('by stage', label => label.split(' ')[0].replace(/\.(attn|ff)$/, ''));
    summarize('by stage + kernel', label => `${label.split(' ')[0].replace(/\.(attn|ff)$/, '')} ${label.split(' ')[1]}`);
}

/** Mid (L+R)/2 at the Beat This! rate; decodeAudioData does the resampling, as in the app. */
async function decodeMono(file: string): Promise<Float32Array> {
    const bytes = fs.readFileSync(file);
    const buffer = await new OfflineAudioContext(1, 1, BEAT_THIS_SAMPLE_RATE)
        .decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const left = buffer.getChannelData(0);
    if (buffer.numberOfChannels < 2) return Float32Array.from(left);
    const right = buffer.getChannelData(1);
    return left.map((value, index) => (value + right[index]) / 2);
}

/**
 * Stands in for what the app's page has: window.electron.getBeatThisGpuWeights (the main process
 * reading the export) and a Worker constructor that resolves Vite's worker URL - here the worker
 * bundled on its own next to harness.js, since this bundle is not built by Vite.
 */
function installAppBridge(weights: Uint8Array, manifest: BeatThisWgslManifest, out: string) {
    (window as unknown as { electron: object }).electron = {
        getBeatThisGpuWeights: async () => ({ weights: weights.slice(), manifest }),
    };
    const source = fs.readFileSync(path.join(out, 'beatThisGpu-worker.js'), 'utf8');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const NativeWorker = Worker;
    (globalThis as unknown as { Worker: unknown }).Worker = class extends NativeWorker {
        constructor() { super(url); }
    };
}

async function runSongs(device: GPUDevice, weights: Uint8Array, manifest: BeatThisWgslManifest, songs: string[], out: string,
    f16?: 'storage' | 'math', trimSec = 0, app = false) {
    const model = app ? null : await BeatThisWgsl.create(device, weights, manifest, { f16 });
    const T = BEAT_THIS_WGSL_FRAMES;
    for (const song of songs) {
        const name = path.basename(song).replace(/\.[^.]+$/, '');
        const mono = await decodeMono(song);
        const mel = await melSpectrogram(trimSec ? mono.subarray(0, Math.round(trimSec * BEAT_THIS_SAMPLE_RATE)) : mono);
        const chunks = splitForModel(mel);
        // Files keep the [chunks, 1500, ...] layout; a short chunk fills the front of its slot.
        const input = new Float32Array(chunks.length * T * 128);
        const logits = new Float32Array(chunks.length * 2 * T);
        const started = performance.now();
        let gpuMs = 0;
        chunks.forEach((chunk, index) => input.set(chunk.data, index * T * 128));
        if (app) {
            const result = await runBeatThisGpu(chunks);
            if (!result) throw new Error(`${name}: the app path answered null`);
            result.beat.forEach((track, index) => logits.set(track, index * 2 * T));
            result.downbeat.forEach((track, index) => logits.set(track, (index * 2 + 1) * T));
        } else {
            for (const [index, chunk] of chunks.entries()) {
                const result = await model!.run(chunk.data);
                logits.set(result.beat, index * 2 * T);
                logits.set(result.downbeat, (index * 2 + 1) * T);
                gpuMs += result.gpuMs;
            }
        }
        fs.writeFileSync(path.join(out, `${name}.chunks.f32`), Buffer.from(input.buffer));
        fs.writeFileSync(path.join(out, `${name}.wgsl.f32`), Buffer.from(logits.buffer));
        fs.writeFileSync(path.join(out, `${name}.meta.json`), JSON.stringify({
            frames: mel.frames, starts: chunks.map(chunk => chunk.start), chunkFrames: chunks.map(chunk => chunk.frames),
        }));
        log(`${name}: ${mel.frames} frames, ${chunks.length} chunks (${chunks.map(chunk => chunk.frames).join(',')}), `
            + `${app ? `app path ${(performance.now() - started).toFixed(0)} ms wall` : `gpu ${gpuMs.toFixed(0)} ms total`}`);
    }
    model?.destroy();
}

main().catch((error) => {
    log(`FAILED: ${error?.stack ?? error}`);
    ipcRenderer.send('btw-done', 1);
});
