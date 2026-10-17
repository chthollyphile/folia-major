/// <reference types="@webgpu/types" />
import { HtdemucsWgsl, HTDEMUCS_SEGMENT, type HtdemucsWgslManifest } from '../../src/services/analysis/htdemucsWgsl/runtime';

// dev/htdemucs-wgsl/harness.ts
// Renderer side of the test shell (see main.cjs): loads the exported weights and one segment, runs it
// HTW_MIX holds one or more segments ([n, 2, 172032]); each is run once (the first with every stage
// when asked) into out.f32 ([n, 2, 172032]), then the first is timed `repeat` more times.

// Node's require, read off the window so the bundler leaves these imports to the renderer at runtime.
const nodeRequire = (globalThis as unknown as { require: (id: string) => any }).require;
const { ipcRenderer } = nodeRequire('electron');
const fs = nodeRequire('fs');
const path = nodeRequire('path');

const log = (line: string) => ipcRenderer.send('htw-log', line);

const readPacked = (file: Uint8Array): { weights: Uint8Array; manifest: HtdemucsWgslManifest } => {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const tail = file.byteLength - 16;
    if (new TextDecoder().decode(file.subarray(tail, tail + 8)) !== 'FOLIABTW') throw new Error('not a packed export');
    const at = Number(view.getBigUint64(tail + 8, true));
    return { weights: file.subarray(0, at), manifest: JSON.parse(new TextDecoder().decode(file.subarray(at, tail))) };
};

async function main() {
    const config = await ipcRenderer.invoke('htw-config');
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    log(`adapter: ${adapter.info.vendor} ${adapter.info.architecture} maxBuffer ${adapter.limits.maxBufferSize} maxBinding ${adapter.limits.maxStorageBufferBindingSize}`);
    const f16 = Boolean(config.f16);
    if (f16 && !adapter.features.has('shader-f16')) throw new Error('HTW_F16 asked for, but this adapter has no shader-f16');
    const device = await adapter.requestDevice({
        requiredFeatures: f16 ? ['shader-f16'] : [],
        requiredLimits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize },
    });
    device.addEventListener('uncapturederror', (event) => log(`GPU error: ${(event as GPUUncapturedErrorEvent).error.message}`));

    const { weights, manifest } = readPacked(new Uint8Array(fs.readFileSync(config.weights)));
    let started = performance.now();
    const model = await HtdemucsWgsl.create(device, weights, manifest, { f16 });
    log(`create: ${(performance.now() - started).toFixed(0)} ms${f16 ? ' (f16 GEMMs)' : ''}`);

    const bytes = fs.readFileSync(config.mix);
    const mix = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const L = HTDEMUCS_SEGMENT;
    const count = mix.length / (2 * L);
    const out = new Float32Array(count * 2 * L);
    for (let i = 0; i < count; i += 1) {
        const at = i * 2 * L;
        started = performance.now();
        const result = await model.run(mix.subarray(at, at + L), mix.subarray(at + L, at + 2 * L), { stages: config.stages && i === 0 });
        log(`segment ${i}: ${(performance.now() - started).toFixed(0)} ms (gpu ${result.gpuMs.toFixed(1)} ms, ${result.slices} slices)`);
        out.set(result.left, at);
        out.set(result.right, at + L);
        for (const [name, data] of Object.entries(result.stages ?? {})) {
            fs.writeFileSync(path.join(config.out, `stage_${name}.f32`), Buffer.from(data.buffer));
        }
    }
    fs.writeFileSync(path.join(config.out, 'out.f32'), Buffer.from(out.buffer));
    if (config.timings) {
        // Per dispatch, median of five runs cut one dispatch per submit: what a busy frame waits behind.
        const runs: { label: string; ms: number }[][] = [];
        for (let r = 0; r < 5; r += 1) runs.push((await model.run(mix.subarray(0, L), mix.subarray(L, 2 * L), { slice: 'dispatch', timings: true })).timings ?? []);
        const rows = runs[0].map((row, index) => ({ label: row.label, ms: runs.map(run => run[index].ms).sort((a, b) => a - b)[2] }));
        fs.writeFileSync(path.join(config.out, 'timings.json'), JSON.stringify(rows, null, 1));
        const total = rows.reduce((sum, row) => sum + row.ms, 0);
        log(`per-dispatch: ${rows.length} dispatches, ${total.toFixed(1)} ms summed; longest ${rows.slice().sort((a, b) => b.ms - a.ms).slice(0, 12).map(row => `${row.label} ${row.ms.toFixed(2)}`).join(', ')}`);
    }
    for (let r = 0; r < config.repeat; r += 1) {
        started = performance.now();
        const timed = await model.run(mix.subarray(0, L), mix.subarray(L, 2 * L), { slice: config.slice });
        log(`repeat ${r}: ${(performance.now() - started).toFixed(0)} ms (gpu ${timed.gpuMs.toFixed(1)} ms, ${timed.slices} slices)`);
    }
    model.destroy();
    ipcRenderer.send('htw-done', 0);
}

main().catch((error) => {
    log(`failed: ${error?.stack ?? error}`);
    ipcRenderer.send('htw-done', 1);
});
