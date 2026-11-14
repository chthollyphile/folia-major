// dev/htdemucs-wgsl/coexist.ts
// Does htdemucs on WebGPU cost the visualizer frames, and how long does a segment take, when both
// run in one renderer process - per slicing mode? The htdemucs counterpart of
// dev/beat-this-wgsl/coexist.ts, and the regression check for the paced slicing (gpuSlices.ts).
//
// The page draws a full-window WebGL2 fragment shader every animation frame - a stand-in for the
// visualizer, HTW_LOAD inner iterations per pixel setting how much GPU each frame takes - and
// records every frame interval. A dedicated worker (coexistWorker.ts) meanwhile runs the phases:
// idle, a submit round-trip probe, then each slicing mode for some segments. Prints, per phase:
// frames, intervals over 1.5 vsync (missed frames), p99 and max interval, the median segment time
// and slices, and segments whose drums differ from an unsliced run (must be 0).
//
// The window has to be visible and unoccluded: a hidden one gets throttled animation frames, and
// the numbers would measure the throttling. The idle phases are the check that they do not.

// Node's modules, read off the window so the bundler leaves them to the renderer at runtime.
const nodeRequire = (globalThis as unknown as { require: (id: string) => unknown }).require;
const { ipcRenderer } = nodeRequire('electron') as { ipcRenderer: { send(channel: string, ...args: unknown[]): void; invoke(channel: string): Promise<unknown> } };
const fs = nodeRequire('fs') as { readFileSync: ((file: string) => Uint8Array) & ((file: string, encoding: 'utf8') => string) };
const path = nodeRequire('path') as { join(...parts: string[]): string };

/** main.cjs' htw-config, as far as this page reads it. */
interface Config { weights: string; mix: string; out: string; load: number; segments: number; modes: string[]; phases: string }
interface Phase { name: string; slice: string; segments?: number; inFlight?: number; roundtrip?: boolean }
/** What the worker posts. */
interface WorkerMessage {
    log?: string; error?: string; done?: boolean;
    phase?: string; phaseEnd?: string; at?: number; wallMs?: number; slices?: number; mismatched?: number;
}

const log = (line: string) => ipcRenderer.send('htw-log', line);

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

/** Draws the stand-in visualizer every frame; `onFrame` gets each frame's time and, where measurable, the last draw's GPU ms. */
function startRenderer(iterations: number, onFrame: (at: number, gpuMs: number | null) => void) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
    document.body.style.margin = '0';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) throw new Error('no WebGL2');
    const shader = (type: number, source: string) => {
        const s = gl.createShader(type);
        if (!s) throw new Error('createShader');
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID&1,gl_VertexID>>1)*4.0-1.0;gl_Position=vec4(p,0,1);}'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT(iterations)));
    gl.linkProgram(program);
    gl.useProgram(program);
    const size = gl.getUniformLocation(program, 'size');
    const time = gl.getUniformLocation(program, 'time');
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { GPU_DISJOINT_EXT: number; TIME_ELAPSED_EXT: number } | null;
    let query: WebGLQuery | null = null;
    let lastGpuMs: number | null = null;
    const frame = (now: number) => {
        if (timer && query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) lastGpuMs = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
            gl.deleteQuery(query);
            query = null;
        }
        const timing = timer && !query ? (query = gl.createQuery()) : null;
        if (timer && timing) gl.beginQuery(timer.TIME_ELAPSED_EXT, timing);
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
        if (timer && timing) gl.endQuery(timer.TIME_ELAPSED_EXT);
        onFrame(performance.timeOrigin + now, lastGpuMs);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (!timer) log('no EXT_disjoint_timer_query_webgl2: render GPU time not measured');
}

/**
 * The default phases: an idle stretch, a round-trip probe, then each of `modes` (HTW_MODES: a
 * runtime's `slice` values, 'paced-q<k>' for 'paced' with k in flight) for n segments - all of it
 * twice, interleaved, so a drift in the machine's state shows.
 */
const defaultPhases = (n: number, modes: string[]): Phase[] => {
    const round = (k: number): Phase[] => [
        { name: `idle#${k}`, slice: 'none' },
        { name: `rt#${k}`, slice: 'none', roundtrip: true },
        ...modes.map((mode) => {
            const queued = /^paced-q(\d+)$/.exec(mode);
            return queued
                ? { name: `${mode}#${k}`, slice: 'paced', segments: n, inFlight: Number(queued[1]) }
                : { name: `${mode}#${k}`, slice: mode, segments: n };
        }),
    ];
    return [...round(0), ...round(1), { name: 'idle#end', slice: 'none' }];
};

async function main() {
    const config = await ipcRenderer.invoke('htw-config') as Config;
    // The shell's page loads this script from <head>, before there is a body to draw into.
    if ((document.body as HTMLElement | null) === null) await new Promise(resolve => { addEventListener('DOMContentLoaded', resolve, { once: true }); });
    const packed: Uint8Array = fs.readFileSync(config.weights);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    const tail = packed.byteLength - 16;
    const at = Number(view.getBigUint64(tail + 8, true));
    const manifest = JSON.parse(new TextDecoder().decode(packed.subarray(at, tail))) as unknown;
    const weights = packed.buffer.slice(packed.byteOffset, packed.byteOffset + at);
    const mixFile: Uint8Array = fs.readFileSync(config.mix);
    // The first segment of HTW_MIX ([n, 2, 172032] f32).
    const mix = mixFile.buffer.slice(mixFile.byteOffset, mixFile.byteOffset + 2 * 172032 * 4);
    // Phases from HTW_PHASES (a JSON file of { name, slice, segments?, inFlight?, roundtrip? }), else the
    // default over HTW_MODES - only modes the runtime under test has: a slice it does not know runs unsliced.
    const phases = config.phases ? JSON.parse(fs.readFileSync(config.phases, 'utf8')) as Phase[] : defaultPhases(config.segments, config.modes);

    const frames: number[] = [];
    const renderGpu: { at: number; ms: number }[] = [];
    startRenderer(config.load, (at, gpuMs) => {
        frames.push(at);
        if (gpuMs !== null) renderGpu.push({ at, ms: gpuMs });
    });
    log(`load=${config.load}, ${phases.length} phases`);

    const spans: { name: string; from: number; to: number; wallMs?: number; slices?: number; mismatched?: number }[] = [];
    const source = fs.readFileSync(path.join(config.out, 'coexistWorker.js'), 'utf8');
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onerror = (event) => { log(`FAILED: worker ${event.message}`); ipcRenderer.send('htw-done', 1); };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const m = event.data;
        if (m.log) log(m.log);
        if (m.error) { log(`FAILED: ${m.error}`); ipcRenderer.send('htw-done', 1); }
        if (m.phase) spans.push({ name: m.phase, from: m.at ?? 0, to: Infinity });
        if (m.phaseEnd) Object.assign(spans[spans.length - 1], { to: m.at ?? Infinity, wallMs: m.wallMs, slices: m.slices, mismatched: m.mismatched });
        if (!m.done) return;

        const intervals = frames.slice(1).map((time, i) => ({ at: time, ms: time - frames[i] }));
        const vsync = [...intervals.map(x => x.ms)].sort((a, b) => a - b)[intervals.length >> 1];
        log(`vsync ~${vsync.toFixed(2)} ms (median interval over the whole run)`);
        const idle = spans.find(span => span.name.startsWith('idle'));
        const idleGpu = renderGpu.filter(x => idle && x.at > idle.from && x.at <= idle.to).map(x => x.ms).sort((a, b) => a - b);
        if (idleGpu.length) log(`render GPU per frame while idle: median ${idleGpu[idleGpu.length >> 1].toFixed(2)} ms`);
        log('phase           frames  missed  miss%  p99 ms  max ms   segment ms  slices  mismatched');
        for (const span of spans) {
            const mine = intervals.filter(x => x.at > span.from && x.at <= span.to).map(x => x.ms).sort((a, b) => a - b);
            if (!mine.length) continue;
            const missed = mine.filter(ms => ms > 1.5 * vsync).length;
            const p99 = mine[Math.min(mine.length - 1, Math.floor(mine.length * 0.99))];
            log(`${span.name.padEnd(15)} ${String(mine.length).padStart(6)} ${String(missed).padStart(7)} ${(100 * missed / mine.length).toFixed(0).padStart(5)}% ${p99.toFixed(1).padStart(7)} ${mine[mine.length - 1].toFixed(1).padStart(7)}`
                + `   ${(span.wallMs ?? 0).toFixed(0).padStart(10)}  ${String(span.slices ?? 0).padStart(6)}  ${String(span.mismatched ?? 0).padStart(10)}`);
        }
        ipcRenderer.send('htw-done', 0);
    };
    // Let the renderer settle into its rhythm before the first phase.
    setTimeout(() => worker.postMessage({ weights, manifest, mix, phases }, [weights, mix]), 1000);
}

main().catch((error: unknown) => {
    log(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    ipcRenderer.send('htw-done', 1);
});
