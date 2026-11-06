import type { CodeContext, CodeFrame, CodeRenderer, CodeScene } from './contract';

// Both functions are serialized into an opaque-origin iframe/worker. Keep them self-contained.
function workerRuntime() {
    const scope = self as unknown as Window & {
        FoliaStyle: { define: (factory: (context: CodeContext) => CodeRenderer | Promise<CodeRenderer>) => void };
    };
    let factory: ((context: CodeContext) => CodeRenderer | Promise<CodeRenderer>) | undefined;
    let renderer: CodeRenderer | undefined;
    let context: CodeContext;
    let send: (message: object) => void = () => {};
    let hostFonts: FontFace[] = [];
    scope.FoliaStyle = { define: value => {
        if (factory || typeof value !== 'function') throw new Error('Call FoliaStyle.define exactly once');
        factory = value;
    } };
    const fail = (error: unknown, id?: number) => send({ type: 'error', id, error: String(error instanceof Error ? error.stack : error).slice(0, 4000) });
    scope.addEventListener('unhandledrejection', event => { event.preventDefault(); fail(event.reason); });
    const dispatch = async (event: MessageEvent) => {
        const message = event.data;
        try {
            if (message.type === 'init') {
                // Take the private channel before running author code. Never expose it on self/context.
                const port = event.ports[0];
                send = port.postMessage.bind(port);
                port.onmessage = dispatch;
                (self as unknown as { importScripts: (url: string) => void }).importScripts(message.codeUrl);
                if (!factory) throw new Error('Renderer must call FoliaStyle.define');
                const assets: Record<string, string> = Object.create(null);
                for (const asset of message.pack.assets ?? []) assets[asset.id] = `data:${asset.mime};base64,${asset.data}`;
                context = { canvas: message.canvas, cover: null, settings: message.pack.settings ?? {}, palette: message.pack.palette, assets };
                renderer = await factory(context);
                if (!renderer || typeof renderer.render !== 'function') throw new Error('Renderer must return render(frame)');
                send({ type: 'ready' });
            } else if (message.type === 'frame' && renderer) {
                const start = performance.now();
                const frame = message.frame as CodeFrame;
                if (context.canvas.width !== frame.width) context.canvas.width = frame.width;
                if (context.canvas.height !== frame.height) context.canvas.height = frame.height;
                if (message.scene) await renderer.update?.(message.scene as CodeScene);
                await renderer.render(frame);
                send({ type: 'frame', id: message.id, milliseconds: performance.now() - start });
            } else if (message.type === 'cover') {
                context.cover?.close();
                context.cover = message.bitmap;
                send({ type: 'cover', id: message.id });
            } else if (message.type === 'fonts') {
                const fontSet = (self as unknown as { fonts: FontFaceSet }).fonts;
                for (const face of hostFonts) fontSet.delete(face);
                hostFonts = [];
                for (const font of message.fonts) {
                    const face = new FontFace(font.family, font.data);
                    await face.load(); fontSet.add(face); hostFonts.push(face);
                }
                send({ type: 'fonts', id: message.id });
            } else if (message.type === 'capture') {
                const blob = await context.canvas.convertToBlob({ type: 'image/png' });
                send({ type: 'capture', id: message.id, blob });
            } else if (message.type === 'dispose') {
                renderer?.dispose?.(); context?.cover?.close(); scope.close();
            }
        } catch (error) { fail(error, message.id); }
    };
    scope.addEventListener('message', dispatch, { once: true });
}

function frameRuntime() {
    let worker: Worker | undefined, workerUrl = '', codeUrl = '', token = '', channel: MessagePort | undefined;
    let expectedType = 'ready', expectedId: number | undefined;
    let deadline = 0;
    const reply = (data: object) => parent.postMessage({ ...data, token }, '*');
    const fail = (error: string) => { worker?.terminate(); clearTimeout(deadline); reply({ type: 'error', error }); };
    const arm = (ms: number) => { clearTimeout(deadline); deadline = window.setTimeout(() => fail('Renderer deadline exceeded; worker terminated'), ms); };
    window.addEventListener('message', event => {
        if (event.source !== parent || !event.data || (token && event.data.token !== token)) return;
        const message = event.data;
        try {
            if (message.type === 'init' && !worker) {
                token = message.token;
                const canvas = document.createElement('canvas');
                canvas.style.cssText = 'width:100%;height:100%;display:block';
                document.body.append(canvas);
                const offscreen = canvas.transferControlToOffscreen();
                workerUrl = URL.createObjectURL(new Blob([message.runtime], { type: 'text/javascript' }));
                codeUrl = URL.createObjectURL(new Blob([message.pack.renderer.code], { type: 'text/javascript' }));
                worker = new Worker(workerUrl);
                const pipe = new MessageChannel(); channel = pipe.port1;
                channel.onmessage = event => {
                    const data = event.data;
                    if (data.type === 'error') { fail(data.error); return; }
                    if (data.type !== expectedType || data.id !== expectedId) return;
                    clearTimeout(deadline); reply(data);
                };
                worker.onerror = event => { event.preventDefault(); fail(`${event.message} (${event.lineno}:${event.colno})`); };
                arm(10000);
                worker.postMessage({ type: 'init', canvas: offscreen, pack: message.pack, codeUrl }, [offscreen, pipe.port2]);
            } else if (message.type === 'dispose') {
                channel?.postMessage({ type: 'dispose' });
                clearTimeout(deadline);
                // A broken dispose hook cannot keep the worker alive.
                setTimeout(() => worker?.terminate(), 50);
                if (workerUrl) URL.revokeObjectURL(workerUrl);
                if (codeUrl) URL.revokeObjectURL(codeUrl);
            } else if (worker) {
                expectedType = message.type; expectedId = message.id;
                arm(message.type === 'fonts' ? 10000 : 2000);
                channel?.postMessage(message, message.bitmap ? [message.bitmap] : message.fonts?.map((font: { data: ArrayBuffer }) => font.data) ?? []);
            }
        } catch (error) { fail(String(error)); }
    });
    window.addEventListener('pagehide', () => { worker?.terminate(); channel?.close(); clearTimeout(deadline); if (workerUrl) URL.revokeObjectURL(workerUrl); if (codeUrl) URL.revokeObjectURL(codeUrl); });
}

export const workerSource = () => `(${workerRuntime.toString()})();`;
export const sandboxDocument = () => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><script>(${frameRuntime.toString().replace(/<\/script/gi, '<\\/script')})();</script></body></html>`;
