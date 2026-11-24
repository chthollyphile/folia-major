import type { FoliumSourceNetSession } from '@folia/folium';
import { EgressBlockedError } from './egress.ts';
import type { Egress } from './egress.ts';
import { RateLimitedError } from './rateLimit.ts';
import type { createConcurrencyGate } from './rateLimit.ts';
import { REQUEST_PATH, SANDBOX_ORIGIN } from './sandbox/constants.ts';
import type { LxScriptInfo } from './sandbox/runtime.ts';

// sources/lxmusic/main/sandboxHost.ts
// 跑洛雪脚本的隐藏沙箱窗口（和另一家音源跑播放器脚本的沙箱窗口同一个做法）：
//   - 窗口是 api.windows.hidden 给的：沙箱渲染进程、上下文隔离、没有 preload、没有 Node；分区是受信表认领的
//     内存分区 folia-lxmusic-sandbox，不落盘，和宿主的会话、别家音源的分区都不相干；
//   - 分区的 http(s) 全部由这里本地应答（intercept）：页面地址回一张带 CSP 的空页，REQUEST_PATH 的 POST 交给
//     受控出口，其余一律 403；别的协议（WebSocket、WebRTC）走一个不存在的代理；权限一律拒绝；不许开窗、不许跳转；
//   - 一个窗口只跑一个脚本：换脚本、脚本超时不答、主窗口走了，窗口都销毁，下次用到再开、再加载脚本。
// 页面里的运行环境是 sandbox/entry.ts 构建出的 sandbox.cjs，读成文本注入。

/** 受信表那一行认领的内存分区。 */
export const SANDBOX_PARTITION = 'folia-lxmusic-sandbox';

// default-src 'none'：不许加载任何子资源、框架、worker；脚本只能是注入的（'unsafe-eval' 给脚本自己的 eval /
// new Function，混淆过的脚本离不开它）；联网只许回到本页的源，也就是只到得了 intercept。
// sandbox 指令只留脚本和同源（同源是为了 fetch 回本页的源）：alert / confirm / print 这些以应用名义弹出的原生窗口、
// 下载、弹窗、表单、指针锁都随它关掉。
const PAGE_CSP = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src ${SANDBOX_ORIGIN}; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin`;
const BLANK_PAGE = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title></title></head><body></body></html>';
const DEAD_PROXY = { proxyRules: 'socks5://127.0.0.1:1', proxyBypassRules: '<-loopback>' };

const LOAD_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 20_000;
/** `lx.request` 一个回答的上限。 */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;
/** `lx.request` 一个请求正文的上限。 */
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
/** `/__lx/request` 整个 POST 的上限（正文是 base64，再加地址和头）：超了不读进来。 */
const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
/** 在排队或在途的 `/__lx/request` 最多这么多个（闸自己的队列之外的一道硬上限：再多的连正文都不读）。 */
const MAX_PENDING_REQUESTS = 24;

/** 这里用到的隐藏窗口的成员（Electron 的 BrowserWindow）。 */
interface HiddenWindow {
    isDestroyed(): boolean;
    destroy(): void;
    loadURL(url: string): Promise<void>;
    webContents: {
        setWindowOpenHandler(handler: () => { action: 'deny' }): void;
        on(event: string, listener: (event: { preventDefault(): void }) => void): void;
        setWebRTCIPHandlingPolicy(policy: string): void;
        executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
        setAudioMuted(muted: boolean): void;
        session: { on(event: 'will-download', listener: (event: { preventDefault(): void }) => void): void };
    };
}

export interface LxSandboxScript {
    /** 脚本的 id（脚本库里的）；窗口里跑的是不是它由这个判断。 */
    id: string;
    code: string;
    info: LxScriptInfo;
}

export interface LxSandbox {
    /** 开一个新窗口跑 `script`，回它声明的 `sources`（原样）。已有的窗口先销毁。 */
    load(script: LxSandboxScript): Promise<unknown>;
    /** 调当前脚本的 request 回调；窗口不在了就先用 `script` 重新加载。 */
    call(script: LxSandboxScript, payload: { source: string; action: string; info: unknown }): Promise<unknown>;
    /** 销毁窗口；下次用到再开。 */
    destroy(): void;
}

const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/** `lx.request` 交来的一个请求：校验形状后经出口发出去，回答整个读回来。 */
export const answerLxRequest = async (
    egress: Egress, raw: unknown, concurrency?: ReturnType<typeof createConcurrencyGate>, signal?: AbortSignal,
): Promise<Response> => {
    const request = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    if (typeof request.url !== 'string' || request.url.length > 8192) return json(400, { ok: false, error: 'bad request' });
    const headers: Record<string, string> = {};
    if (request.headers && typeof request.headers === 'object') {
        for (const [name, value] of Object.entries(request.headers as Record<string, unknown>)) {
            if (typeof value === 'string') headers[name] = value;
        }
    }
    const body = typeof request.body === 'string' ? Buffer.from(request.body, 'base64') : null;
    if (body && body.byteLength > MAX_REQUEST_BYTES) return json(413, { ok: false, error: 'request body too large' });
    // 同时在途数按目标主机算；地址不成样子的归到一个名下，让出口去报错。
    const url = request.url;
    const host = URL.canParse(url) ? new URL(url).hostname : '';
    const send = () => egress.fetchBytes({
        url,
        method: typeof request.method === 'string' ? request.method : 'GET',
        headers,
        body,
        timeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : undefined,
        signal,
    }, MAX_ANSWER_BYTES);
    try {
        const answer = await (concurrency ? concurrency.run(host, send, signal) : send());
        return json(200, {
            ok: true,
            statusCode: answer.statusCode,
            statusMessage: answer.statusMessage,
            headers: answer.headers,
            body: answer.body.toString('base64'),
        });
    } catch (error) {
        // 给脚本的只是一句原因；被拦的去处不回任何内容，连解析出的地址也不说（不然脚本能拿它查内网的域名解析）。
        if (error instanceof EgressBlockedError) return json(200, { ok: false, error: `egress blocked (${error.reason})` });
        if (error instanceof RateLimitedError) return json(200, { ok: false, error: error.message });
        return json(200, { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'request failed' });
    }
};

/** 带上限地读 POST 的正文；超了回 null（不把它读进主进程）。 */
const readBounded = async (request: Request, maxBytes: number): Promise<string | null> => {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const reader = request.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
};

/** 建沙箱。`runtimeCode` 是 sandbox.cjs 的文本；`isAllowed` 说主窗口还在不在（隐藏窗口不能比它活得久）。 */
export const createLxSandbox = ({ session, hidden, egress, concurrency, runtimeCode, isAllowed, log }: {
    session: FoliumSourceNetSession;
    hidden: (options: Record<string, unknown>) => unknown;
    egress: Egress;
    /** 同时在途的 `lx.request` 的闸（rateLimit.ts）；没给就不限。 */
    concurrency?: ReturnType<typeof createConcurrencyGate>;
    runtimeCode: () => string;
    isAllowed: () => boolean;
    log: (message: string, error?: unknown) => void;
}): LxSandbox => {
    let configured: Promise<void> | null = null;
    let current: { scriptId: string; window: Promise<HiddenWindow> } | null = null;
    let inFlight = 0;
    let downloadsRefused = false;
    // 窗口的一辈子：窗口销毁时中止它还在途、还在排队的请求，免得旧脚本的尾巴占着新脚本的名额，或在窗口没了之后才发出去。
    let lifetime = new AbortController();

    const serve = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        if (url.origin !== SANDBOX_ORIGIN) return new Response(null, { status: 403 });
        if (request.method === 'GET' && url.pathname === '/') {
            return new Response(BLANK_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP } });
        }
        if (request.method === 'POST' && url.pathname === REQUEST_PATH) {
            if (inFlight >= MAX_PENDING_REQUESTS) return json(429, { ok: false, error: 'too many requests at once' });
            inFlight += 1;
            try {
                const text = await readBounded(request, MAX_ENVELOPE_BYTES);
                if (text === null) return json(413, { ok: false, error: 'request too large' });
                return await answerLxRequest(egress, JSON.parse(text), concurrency, lifetime.signal);
            } catch {
                return json(400, { ok: false, error: 'bad request' });
            } finally {
                inFlight -= 1;
            }
        }
        return new Response(null, { status: 403 });
    };

    const configure = async () => {
        session.intercept('https', serve);
        session.intercept('http', serve);
        session.refusePermissions();
        await session.setProxy(DEAD_PROXY);
    };

    const evaluate = async (window: HiddenWindow, code: string, timeoutMs: number): Promise<unknown> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                window.webContents.executeJavaScript(code, false),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('the script sandbox did not answer')), timeoutMs);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };

    const open = async (script: LxSandboxScript): Promise<{ window: HiddenWindow; sources: unknown }> => {
        configured ??= configure();
        await configured;
        const window = hidden({ session: SANDBOX_PARTITION, backgroundThrottling: false }) as HiddenWindow;
        try {
            window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            window.webContents.on('will-navigate', event => event.preventDefault());
            window.webContents.on('will-redirect', event => event.preventDefault());
            window.webContents.on('will-attach-webview', event => event.preventDefault());
            window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
            window.webContents.setAudioMuted(true);
            // 下载不归 CSP 管（blob 链接加 download 属性）：分区上一律不许，免得弹「另存为」。分区只有这一个，登记一次。
            if (!downloadsRefused) {
                downloadsRefused = true;
                window.webContents.session.on('will-download', event => event.preventDefault());
            }
            await window.loadURL(`${SANDBOX_ORIGIN}/`);
            // sandbox.cjs 是 CommonJS 包：给它一对 module / exports 垫着，它只往 globalThis 上挂 __lxHost。
            await evaluate(window, `(() => { const module = { exports: {} }; const exports = module.exports;\n${runtimeCode()}\n})(); undefined;`, LOAD_TIMEOUT_MS);
            const loaded = await evaluate(
                window,
                `globalThis.__lxHost.load(${JSON.stringify(script.code)}, ${JSON.stringify(script.info)}, ${LOAD_TIMEOUT_MS})`,
                LOAD_TIMEOUT_MS + 5_000,
            ) as { sources?: unknown } | null;
            return { window, sources: loaded?.sources ?? null };
        } catch (error) {
            if (!window.isDestroyed()) window.destroy();
            throw error;
        }
    };

    const destroy = () => {
        const closing = current;
        current = null;
        lifetime.abort(new Error('the script sandbox is closed'));
        lifetime = new AbortController();
        closing?.window.then((window) => { if (!window.isDestroyed()) window.destroy(); }, () => undefined);
    };

    const start = (script: LxSandboxScript): Promise<{ window: HiddenWindow; sources: unknown }> => {
        destroy();
        const opening = open(script);
        const entry = { scriptId: script.id, window: opening.then(opened => opened.window) };
        current = entry;
        // 没开成的不留着：下次用到重新开。
        entry.window.catch(() => { if (current === entry) current = null; });
        return opening;
    };

    return {
        async load(script) {
            if (!isAllowed()) throw new Error('the script sandbox is closed');
            return (await start(script)).sources;
        },
        async call(script, payload) {
            if (!isAllowed()) throw new Error('the script sandbox is closed');
            let entry = current;
            let window = entry && entry.scriptId === script.id ? await entry.window.catch(() => null) : null;
            if (!window || window.isDestroyed()) {
                window = (await start(script)).window;
                entry = current;
            }
            try {
                return await evaluate(window, `globalThis.__lxHost.call(${JSON.stringify(payload)}, ${CALL_TIMEOUT_MS})`, CALL_TIMEOUT_MS + 5_000);
            } catch (error) {
                // 页面不答（死循环、崩了）：窗口换掉。脚本自己报的错（这一次取不到）不动窗口。
                if (error instanceof Error && error.message === 'the script sandbox did not answer') {
                    log('script sandbox did not answer; closing its window', error);
                    if (current === entry) destroy();
                }
                throw error;
            }
        },
        destroy,
    };
};
