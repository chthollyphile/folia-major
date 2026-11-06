import type { CodeFrame, CodeMetrics, CodeScene, CodeStylePack } from './contract';
import { sandboxDocument, workerSource } from './sandbox';

// A sandboxed worker owns the canvas; host messages carry only visual data, never player capabilities.
export function mountCodePack(container: HTMLElement, pack: CodeStylePack,
    getInput: () => { frame: Omit<CodeFrame, 'width' | 'height' | 'dpr'>; scene: CodeScene; animate: boolean },
    onError: (error: Error) => void, manual = false) {
    const iframe = document.createElement('iframe');
    iframe.title = pack.name;
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'");
    iframe.referrerPolicy = 'no-referrer';
    // Match the sandbox's normal scheme so Chromium does not insert an opaque white canvas.
    iframe.style.cssText = 'width:100%;height:100%;display:block;border:0;pointer-events:none;color-scheme:normal';
    const token = crypto.randomUUID();
    const url = URL.createObjectURL(new Blob([sandboxDocument()], { type: 'text/html' }));
    let disposed = false, failed = false, initialized = false, dirty = true, inFlight = false;
    let raf = 0, last = -Infinity, sequence = 0, previousScene: CodeScene | null = null;
    let readyResolve: () => void, readyReject: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    void ready.catch(() => {});
    const pending = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void }>();
    const times: number[] = [];
    let frames = 0;
    let queue: Promise<unknown> = Promise.resolve(), queued = 0;
    const post = (data: object, transfer: Transferable[] = []) => iframe.contentWindow?.postMessage({ ...data, token }, '*', transfer);
    const stop = () => { cancelAnimationFrame(raf); observer.disconnect(); window.removeEventListener('message', receive); iframe.remove(); URL.revokeObjectURL(url); clearTimeout(startup); };
    const fail = (error: Error) => {
        if (disposed || failed) return;
        failed = true; stop(); readyReject(error);
        pending.forEach(item => item.reject(error)); pending.clear(); onError(error);
    };
    const receive = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.data?.token !== token || disposed || failed) return;
        const data = event.data;
        if (data.type === 'error') { fail(new Error(String(data.error))); return; }
        if (data.type === 'ready') { initialized = true; clearTimeout(startup); readyResolve(); return; }
        if (data.type === 'frame') {
            frames++; times.push(Number(data.milliseconds) || 0); if (times.length > 1800) times.shift();
        }
        pending.get(data.id)?.resolve(data); pending.delete(data.id);
    };
    window.addEventListener('message', receive);
    const request = (type: string, data: object = {}, transfer: Transferable[] = []) => {
        queued++;
        const run = async () => {
            try {
                await ready;
                if (disposed || failed) throw new Error('Renderer is unavailable');
                inFlight = true;
                const id = ++sequence;
                return await new Promise<any>((resolve, reject) => { pending.set(id, { resolve, reject }); post({ type, id, ...data }, transfer); });
            } finally { inFlight = false; queued--; }
        };
        const result = queue.then(run, run); queue = result.catch(() => {}); return result;
    };
    const viewport = () => {
        const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2, 1920 / w, 1920 / h);
        return { width: Math.round(w * dpr), height: Math.round(h * dpr), dpr };
    };
    const renderOnce = async (input = getInput(), size = viewport()) => {
        const scene = previousScene === input.scene ? undefined : input.scene;
        await request('frame', { frame: { ...input.frame, ...size }, scene });
        previousScene = input.scene;
    };
    const tick = (now: number) => {
        if (disposed || failed) return;
        if (initialized && !manual && !document.hidden && !inFlight && !queued && container.clientWidth && container.clientHeight) {
            const input = getInput(), interval = 1000 / 30, elapsed = now - last;
            if ((input.animate || dirty) && elapsed >= interval - 1) {
                dirty = false;
                last = Number.isFinite(last) ? last + Math.max(1, Math.floor((elapsed + 1) / interval)) * interval : now;
                void renderOnce(input).catch(error => fail(error));
            }
        }
        raf = requestAnimationFrame(tick);
    };
    const draw = () => { dirty = true; };
    const observer = new ResizeObserver(draw); observer.observe(container);
    const startup = window.setTimeout(() => fail(new Error('Renderer did not initialize')), 12000);
    iframe.onload = () => post({ type: 'init', pack, runtime: workerSource() });
    iframe.src = url; container.append(iframe);
    raf = requestAnimationFrame(tick);
    return {
        ready, draw, renderOnce,
        idle: async () => { await ready; await queue; },
        capture: async () => (await request('capture')).blob as Blob,
        setCover: async (bitmap: ImageBitmap | null) => { await request('cover', { bitmap }, bitmap ? [bitmap] : []); dirty = true; },
        setFonts: async (fonts: { family: string; data: ArrayBuffer }[]) => {
            await request('fonts', { fonts }, fonts.map(font => font.data)); previousScene = null; dirty = true;
        },
        metrics: (): CodeMetrics => ({ frames, lastMs: times.at(-1) ?? 0, p95Ms: [...times].sort((a, b) => a - b)[Math.floor(times.length * .95)] ?? 0 }),
        dispose: () => {
            if (disposed) return;
            post({ type: 'dispose' }); disposed = true; stop(); window.removeEventListener('message', receive);
            const error = new Error('Renderer disposed'); readyReject(error); pending.forEach(item => item.reject(error)); pending.clear();
        },
    };
}
