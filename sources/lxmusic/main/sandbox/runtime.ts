import { REQUEST_PATH, SANDBOX_ORIGIN } from './constants.ts';
import { lxUtils, LxBuffer, toLxBuffer } from './lxUtils.ts';

// sources/lxmusic/main/sandbox/runtime.ts
// 沙箱页面里的洛雪运行环境：给脚本一个 globalThis.lx（洛雪桌面版给自定义源的那套接口），记下脚本用
// send('inited') 声明的平台和用 on('request') 注册的回调，再让 main 入口（sandboxHost.ts）经 executeJavaScript
// 调它们。这里的代码和第三方脚本跑在同一个页面里，所以它不持有任何要瞒着脚本的东西：页面没有 Node、没有
// preload、连不上网，唯一的出路是向 REQUEST_URL 发的 fetch，由 main 入口的受控出口代发（egress.ts）。
// 回调的调用方式（回调式与返回式都认、async 包着的回调式先 resolve 成 undefined 不算结果）照 PR #1177
// （作者 baixiao0919）实测真实脚本得出的做法。

const EVENT_NAMES = { inited: 'inited', request: 'request', updateAlert: 'updateAlert' } as const;

/** 脚本头注释里的信息，交给 `lx.currentScriptInfo`。 */
export interface LxScriptInfo {
    name: string;
    description?: string;
    version?: string;
    author?: string;
    homepage?: string;
}

/** `lx.request` 的出口：一次请求发出去，回答整个读回来。测试里换成假的。 */
export type LxTransport = (request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    /** 请求正文，base64；没有正文是 null。 */
    body: string | null;
    timeoutMs: number;
}, signal: AbortSignal) => Promise<{ statusCode: number; statusMessage: string; headers: Record<string, string>; body: string }>;

interface LxRequestOptions {
    method?: string;
    headers?: Record<string, unknown>;
    body?: unknown;
    form?: Record<string, unknown>;
    formData?: Record<string, unknown>;
    timeout?: number;
}

const toBase64 = (bytes: Uint8Array): string => new LxBuffer(bytes).toString('base64');

/** 请求正文与它带出的 content-type：`form` 是表单编码，`formData` 是 multipart，对象是 JSON。 */
const encodeBody = async (options: LxRequestOptions): Promise<{ body: Uint8Array | null; contentType: string | null }> => {
    if (options.form && typeof options.form === 'object') {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.form)) params.set(key, String(value));
        return { body: toLxBuffer(params.toString()), contentType: 'application/x-www-form-urlencoded' };
    }
    if (options.formData && typeof options.formData === 'object') {
        const data = new FormData();
        for (const [key, value] of Object.entries(options.formData)) data.append(key, value instanceof Blob ? value : String(value));
        // 让浏览器编出带 boundary 的正文和 content-type。
        const encoded = new Response(data);
        return { body: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
    }
    const { body } = options;
    if (body === undefined || body === null) return { body: null, contentType: null };
    if (typeof body === 'string') return { body: toLxBuffer(body), contentType: null };
    if (body instanceof Uint8Array) return { body, contentType: null };
    if (body instanceof ArrayBuffer) return { body: new Uint8Array(body), contentType: null };
    return { body: toLxBuffer(JSON.stringify(body)), contentType: 'application/json' };
};

const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** 建一个 `lx.request`：回调收 `(err, resp, body)`，返回取消函数，和洛雪桌面版一样。 */
export const createLxRequest = (transport: LxTransport) => (
    url: unknown,
    optionsOrCallback?: LxRequestOptions | ((...args: unknown[]) => void),
    maybeCallback?: (...args: unknown[]) => void,
): (() => void) => {
    const options: LxRequestOptions = optionsOrCallback && typeof optionsOrCallback === 'object' ? optionsOrCallback : {};
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const controller = new AbortController();
    let settled = false;
    const finish = (...args: unknown[]) => {
        if (settled) return;
        settled = true;
        try {
            callback?.(...args);
        } catch (error) {
            console.warn('[lx] request callback threw', error);
        }
    };
    void (async () => {
        const { body, contentType } = await encodeBody(options);
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(options.headers ?? {})) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') headers[name] = String(value);
        }
        if (contentType && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['content-type'] = contentType;
        const answer = await transport({
            url: String(url),
            method: (typeof options.method === 'string' && options.method ? options.method : 'GET').toUpperCase(),
            headers,
            body: body ? toBase64(body) : null,
            timeoutMs: Number.isFinite(options.timeout) && Number(options.timeout) > 0 ? Number(options.timeout) : 15000,
        }, controller.signal);
        const bytes = toLxBuffer(answer.body, 'base64');
        const raw = textOf(bytes);
        // 洛雪把回答解析成对象放进 resp.body，同时作第三个参数传出去；脚本里到处是 resp.body.code。
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = raw;
        }
        finish(null, {
            statusCode: answer.statusCode,
            statusMessage: answer.statusMessage,
            headers: answer.headers,
            bytes: bytes.length,
            raw: bytes,
            body: parsed,
        }, parsed);
    })().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    return () => {
        controller.abort();
        finish(new Error('request aborted'));
    };
};

/** 页面里经固定地址把请求交给 main 入口的出口。 */
export const pageTransport: LxTransport = async (request, signal) => {
    const response = await fetch(`${SANDBOX_ORIGIN}${REQUEST_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
    });
    const answer = await response.json() as { ok?: boolean; error?: string; statusCode: number; statusMessage: string; headers: Record<string, string>; body: string };
    if (!response.ok || answer.ok === false) throw new Error(answer.error || `request failed (${response.status})`);
    return answer;
};

/** main 入口能调的东西（`globalThis.__lxHost`）。 */
export interface LxSandboxHost {
    /** 运行脚本，等它声明平台；回它声明的 `sources`（原样，main 入口再校验）。 */
    load(script: string, info: LxScriptInfo, timeoutMs: number): Promise<{ sources: unknown }>;
    /** 调脚本的 request 回调，回它给的结果（地址、歌词对象）。 */
    call(payload: { source: string; action: string; info: unknown }, timeoutMs: number): Promise<unknown>;
}

type LxHandler = (payload: unknown, callback: (error: unknown, result?: unknown) => void) => unknown;

const MAX_URL_CHARS = 4096;
const MAX_LYRIC_CHARS = 1_000_000;

/**
 * 交回 main 入口之前把结果裁成它认的样子：一个地址，或歌词的三个字符串。main 入口照样自己校验；这里裁是为了
 * 不让一个巨大的返回值整个搬进主进程。
 */
const clipResult = (result: unknown): unknown => {
    if (typeof result === 'string') return result.slice(0, MAX_URL_CHARS);
    if (typeof result !== 'object' || result === null) return null;
    const out: Record<string, string> = {};
    const source = result as Record<string, unknown>;
    if (typeof source.url === 'string') out.url = source.url.slice(0, MAX_URL_CHARS);
    for (const key of ['lyric', 'tlyric', 'rlyric', 'lxlyric']) {
        const value = source[key];
        if (typeof value === 'string') out[key] = value.slice(0, MAX_LYRIC_CHARS);
    }
    return out;
};

/** 在 `scope`（页面的 globalThis）上装好运行环境。 */
export const installLxRuntime = (scope: Record<string, unknown>, transport: LxTransport = pageTransport): LxSandboxHost => {
    const handlers = new Map<string, LxHandler[]>();
    let declared: unknown = null;
    let inited = false;
    let failure: string | null = null;
    let wake: () => void = () => undefined;

    const callHandler = (handler: LxHandler, payload: unknown, timeoutMs: number): Promise<unknown> => new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => settle(() => reject(new Error('the script did not answer in time'))), timeoutMs);
        const settle = (act: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            act();
        };
        const fail = (error: unknown) => settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        let returned: unknown;
        try {
            returned = handler(payload, (error, result) => (error ? fail(error) : settle(() => resolve(result))));
        } catch (error) {
            fail(error);
            return;
        }
        if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
            // async 包着的回调式写法：Promise 先 resolve 成 undefined，那不是结果，接着等回调。
            (returned as PromiseLike<unknown>).then(
                value => { if (value !== undefined && value !== null) settle(() => resolve(value)); },
                fail,
            );
        } else if (returned !== undefined) {
            settle(() => resolve(returned));
        }
    });

    const host: LxSandboxHost = {
        async load(script, info, timeoutMs) {
            const lx = {
                version: '2.0.0',
                env: 'desktop',
                currentScriptInfo: { ...info, rawScript: script },
                EVENT_NAMES,
                request: createLxRequest(transport),
                on: (event: unknown, handler: unknown) => {
                    if (typeof handler === 'function') {
                        const list = handlers.get(String(event)) ?? [];
                        list.push(handler as LxHandler);
                        handlers.set(String(event), list);
                    }
                    return Promise.resolve();
                },
                send: (event: unknown, data: unknown) => {
                    if (event === EVENT_NAMES.inited) {
                        declared = (data as { sources?: unknown } | null)?.sources ?? null;
                        inited = true;
                        wake();
                    }
                    // updateAlert 是脚本要弹的「有新版本」提示，带一个它自己给的链接：不弹、不开。
                    return Promise.resolve();
                },
                utils: lxUtils,
            };
            // 混淆过的脚本在初始化之后、回调里面还会再读 globalThis.lx，所以它留到页面关掉为止。
            scope.lx = lx;
            const ready = new Promise<void>(resolve => { wake = resolve; });
            try {
                // 间接调用的 Function 让脚本跑在全局作用域、严格模式里；顶层 return 的 Promise 是异步初始化。
                // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- 这里就是要运行用户导入的脚本，页面本身是隔离的（sandboxHost.ts）
                const returned = new Function(`"use strict";\n${script}\n`)() as unknown;
                if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
                    (returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
                        failure ??= error instanceof Error ? error.message : String(error);
                        wake();
                    });
                }
            } catch (error) {
                throw new Error(`the script threw: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
            await Promise.race([ready, new Promise<void>(resolve => { setTimeout(resolve, timeoutMs); })]);
            if (!inited) throw new Error(failure ? `the script failed: ${failure}` : 'the script did not send "inited"');
            if (!handlers.get(EVENT_NAMES.request)?.length) throw new Error('the script registered no "request" handler');
            return { sources: declared };
        },
        async call(payload, timeoutMs) {
            const list = handlers.get(EVENT_NAMES.request) ?? [];
            if (list.length === 0) throw new Error('no script is loaded');
            let lastError: unknown = new Error('the script returned nothing');
            for (const handler of list) {
                try {
                    const result = await callHandler(handler, payload, timeoutMs);
                    if (result !== undefined && result !== null) return clipResult(result);
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError;
        },
    };
    return host;
};
