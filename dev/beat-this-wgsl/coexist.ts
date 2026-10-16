import { readPackedWeights } from './packed';

// dev/beat-this-wgsl/coexist.ts
// Does beat_this on WebGPU cost the visualizer frames when both run in the one renderer process?
//
// The page draws a full-window WebGL2 fragment shader every animation frame - a stand-in for the
// visualizer, with BTW_LOAD inner iterations per pixel setting how much GPU each frame takes - and
// records every frame interval. A dedicated worker (coexist-worker.ts) meanwhile runs inference in
// phases: idle, then one submit per chunk, then the slicing modes of BeatThisWgsl.run. Each frame is
// filed under the phase running when it was presented. Prints, per phase: frames, intervals over
// 1.5 vsync (missed frames), p99 and max interval, and inference GPU / wall time per chunk.
//
// The window has to be visible: a hidden or occluded one gets throttled animation frames, and the
// numbers would measure the throttling. The "idle" phase is the check that they do not.

const nodeRequire = (globalThis as unknown as { require: (id: string) => any }).require;
const { ipcRenderer } = nodeRequire('electron');
const fs = nodeRequire('fs');
const path = nodeRequire('path');

const log = (line: string) => ipcRenderer.send('btw-log', line);

const FRAGMENT = (iterations: number) => `#version 300 es
precision highp float;
uniform vec2 size;
uniform float time;
out vec4 color;
void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - size) / size.y;
    vec3 c = vec3(0.0);
    for (int i = 0; i < ${iterations}; i++) {
        float fi = float(i);
        p = abs(p) / dot(p, p) - vec2(0.9 + 0.05 * sin(time * 0.7 + fi * 0.1), 0.6);
        c += vec3(0.02 * length(p), 0.015 * abs(p.x), 0.03 * abs(p.y)) / (1.0 + fi * 0.01);
    }
    color = vec4(c / float(${iterations}) * 4.0, 1.0);
}`;

function startRenderer(iterations: number, onFrame: (at: number, gpuMs: number | null) => void) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
    document.body.style.margin = '0';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    const shader = (type: number, source: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID&1,gl_VertexID>>1)*4.0-1.0;gl_Position=vec4(p,0,1);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT(iterations)));
    gl.linkProgram(program);
    gl.useProgram(program);
    const size = gl.getUniformLocation(program, 'size');
    const time = gl.getUniformLocation(program, 'time');
    // GPU time of each frame's draw, where the driver offers timer queries; one query in flight.
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    let query: WebGLQuery | null = null;
    let lastGpuMs: number | null = null;
    const frame = (now: number) => {
        if (timer && query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) lastGpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
            gl.deleteQuery(query);
            query = null;
        }
        const timing = timer && !query ? (query = gl.createQuery()) : null;
        if (timing) gl.beginQuery(timer.TIME_ELAPSED_EXT, timing);
        const w = Math.round(innerWidth * devicePixelRatio);
        const h = Math.round(innerHeight * devicePixelRatio);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        gl.uniform2f(size, w, h);
        gl.uniform1f(time, now / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (timing) gl.endQuery(timer.TIME_ELAPSED_EXT);
        onFrame(performance.timeOrigin + now, lastGpuMs);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (!timer) log('no EXT_disjoint_timer_query_webgl2: render GPU time not measured');
    return `${canvas.width || Math.round(innerWidth * devicePixelRatio)}x${canvas.height || Math.round(innerHeight * devicePixelRatio)}`;
}

async function main() {
    const config = await ipcRenderer.invoke('btw-config');
    // The shell's page loads this script from <head>, before there is a body to draw into.
    if (!document.body) await new Promise(resolve => addEventListener('DOMContentLoaded', resolve, { once: true }));
    const { weights: weightsFile, manifest } = readPackedWeights(fs.readFileSync(config.weights));
    const chunkFile: Buffer = fs.readFileSync(config.chunks);
    const copy = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

    const frames: number[] = [];
    const renderGpu: { at: number; ms: number }[] = [];
    log(`canvas ${startRenderer(config.load, (at, gpuMs) => {
        frames.push(at);
        if (gpuMs !== null) renderGpu.push({ at, ms: gpuMs });
    })} load=${config.load}`);

    const n = config.coexistChunks;
    // `inFlight`: slices queued on the GPU at once; 99 = submit them all without waiting.
    const phases = [
        { name: 'idle', slice: 'none', gapMs: 0, chunks: 0 },
        { name: 'once', slice: 'none', gapMs: 0, chunks: n },
        { name: 'stage', slice: 'stage', gapMs: 0, chunks: n },
        { name: 'stage-q2', slice: 'stage', gapMs: 0, chunks: n, inFlight: 2 },
        { name: 'stage-q4', slice: 'stage', gapMs: 0, chunks: n, inFlight: 4 },
        { name: 'stage-all', slice: 'stage', gapMs: 0, chunks: n, inFlight: 99 },
        { name: 'dispatch', slice: 'dispatch', gapMs: 0, chunks: n },
        { name: 'auto', slice: 'auto', gapMs: 0, chunks: n },
        { name: 'idle-after', slice: 'none', gapMs: 0, chunks: 0 },
    ];
    const spans: { name: string; from: number; to: number; gpuMs?: number; wallMs?: number; slices?: number; mismatched?: number }[] = [];

    const source = fs.readFileSync(path.join(config.out, 'coexist-worker.js'), 'utf8');
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onerror = (event) => { log(`FAILED: worker ${event.message}`); ipcRenderer.send('btw-done', 1); };
    worker.onmessage = (event) => {
        const m = event.data;
        if (m.log) log(m.log);
        if (m.error) { log(`FAILED: ${m.error}`); ipcRenderer.send('btw-done', 1); }
        if (m.phase) spans.push({ name: m.phase, from: m.at, to: Infinity });
        if (m.phaseEnd) Object.assign(spans[spans.length - 1], { to: m.at, gpuMs: m.gpuMs, wallMs: m.wallMs, slices: m.slices, mismatched: m.mismatched });
        if (!m.done) return;

        const intervals = frames.slice(1).map((at, i) => ({ at, ms: at - frames[i] }));
        const vsync = [...intervals.map(x => x.ms)].sort((a, b) => a - b)[intervals.length >> 1];
        log(`vsync ~${vsync.toFixed(2)} ms (median interval over the whole run)`);
        const idle = spans.find(span => span.name === 'idle');
        const idleGpu = renderGpu.filter(x => idle && x.at > idle.from && x.at <= idle.to).map(x => x.ms).sort((a, b) => a - b);
        if (idleGpu.length) log(`render GPU per frame while idle: median ${idleGpu[idleGpu.length >> 1].toFixed(2)} ms`);
        log('phase        frames  missed  p99 ms  max ms   chunk gpu  chunk wall  slices  mismatched');
        for (const span of spans) {
            const mine = intervals.filter(x => x.at > span.from && x.at <= span.to).map(x => x.ms).sort((a, b) => a - b);
            if (!mine.length) continue;
            const missed = mine.filter(ms => ms > 1.5 * vsync).length;
            const p99 = mine[Math.min(mine.length - 1, Math.floor(mine.length * 0.99))];
            log(`${span.name.padEnd(12)} ${String(mine.length).padStart(6)} ${String(missed).padStart(7)} ${p99.toFixed(1).padStart(7)} ${mine[mine.length - 1].toFixed(1).padStart(7)}`
                + `   ${(span.gpuMs ?? 0).toFixed(1).padStart(8)}  ${(span.wallMs ?? 0).toFixed(1).padStart(10)}  ${String(span.slices ?? 0).padStart(6)}  ${String(span.mismatched ?? 0).padStart(10)}`);
        }
        ipcRenderer.send('btw-done', 0);
    };
    // Let the renderer settle into its rhythm before the first phase.
    setTimeout(() => {
        const weights = copy(weightsFile);
        const chunks = copy(chunkFile);
        worker.postMessage({ weights, manifest, chunks, f16: config.f16, phases }, [weights, chunks]);
    }, 1000);
}

main().catch((error) => {
    log(`FAILED: ${error?.stack ?? error}`);
    ipcRenderer.send('btw-done', 1);
});
