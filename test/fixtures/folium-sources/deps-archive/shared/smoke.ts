import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
// test/fixtures/folium-sources/deps-archive/shared/smoke.ts
// 依赖归档样例（Folium 2.0 方案 §10「剩余阶段的顺序」第 2 步）三家共用的冒烟记录：一步一步量耗时，分清失败是网络
// 还是加载，数出 require.cache 里有多少模块来自 deps 归档。三个样例的 main / worker 经相对路径打进各自的 bundle。

/** 冒烟的三步：从归档加载上游库、后端起来、发一个不需要登录的真实请求。 */
export type SmokeStepName = 'load' | 'ready' | 'request';

export interface SmokeStep {
    step: SmokeStepName;
    ok: boolean;
    /** 这一步的耗时（毫秒）。 */
    ms: number;
    /** 成功时是结果的摘要，失败时是原因。 */
    detail: string;
    /** 失败像是网络造成的（连不上、超时、被重置），不是加载或代码的问题。 */
    network?: boolean;
    /** 前面的步骤失败了，这一步没有做。 */
    skipped?: boolean;
}

export interface SmokeReport {
    sample: string;
    upstream: string;
    /** 这个线程的 require.cache 里路径落在这个模组自己的 deps.<指纹>.asar 里的模块数。 */
    archiveModules: number;
    /** 第一个这样的模块所在的归档（证明是从归档、不是从别处的 node_modules 取的）。 */
    archive: string | null;
    steps: SmokeStep[];
}

const NETWORK_PATTERN = /ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|socket hang up|timed? ?out|TimeoutError|AbortError|UND_ERR_|fetch failed|getaddrinfo|certificate|TLS/i;

const describe = (value: unknown): string => {
    if (value instanceof Error) {
        const cause = value.cause === undefined ? '' : ` (cause: ${describe(value.cause)})`;
        const code = (value as { code?: unknown }).code;
        return `${value.name}: ${value.message}${typeof code === 'string' ? ` [${code}]` : ''}${cause}`;
    }
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value).slice(0, 400);
    } catch {
        return String(value);
    }
};

/** 一段失败的原因像不像网络问题（错本身、它的 cause、或者上游回在答复里的错误文字）。 */
export const looksLikeNetwork = (value: unknown): boolean => NETWORK_PATTERN.test(describe(value));

/** 把 Promise 限时，超时按网络问题报（上游的请求自己没有时限）。 */
export const withTimeout = <T>(work: Promise<T>, ms: number, label: string): Promise<T> => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`${label} timed out after ${String(ms)}ms`)); }, ms);
    work.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(describe(error))); },
    );
});

/** 本机一个空闲端口（监听 0 再关掉）。 */
export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => {
            if (address && typeof address === 'object') resolve(address.port);
            else reject(new Error('no port'));
        });
    });
});

/** 等一个 http.Server 监听上（已经在监听就直接回）。 */
export const untilListening = (server: { listening: boolean; once(event: string, listener: (...args: unknown[]) => void): unknown }): Promise<void> => (
    server.listening ? Promise.resolve() : new Promise<void>((resolve, reject) => {
        server.once('listening', () => { resolve(); });
        server.once('error', (error) => { reject(error instanceof Error ? error : new Error(describe(error))); });
    })
);

/**
 * 按顺序跑各步：一步失败，后面的记成 skipped。`work` 回这一步结果的摘要；`network` 由抛出的错推断，
 * 也可以由 work 抛一个带 `network: true` 的错指明。
 */
export const runSteps = async (
    sample: string,
    upstream: string,
    work: Array<[SmokeStepName, () => Promise<string>]>,
): Promise<SmokeReport> => {
    const steps: SmokeStep[] = [];
    let failed = false;
    for (const [step, run] of work) {
        if (failed) {
            steps.push({ step, ok: false, ms: 0, detail: 'skipped: an earlier step failed', skipped: true });
            continue;
        }
        const startedAt = performance.now();
        try {
            const detail = await run();
            steps.push({ step, ok: true, ms: Math.round(performance.now() - startedAt), detail });
        } catch (error) {
            failed = true;
            const flagged = (error as { network?: unknown } | null)?.network;
            steps.push({
                step,
                ok: false,
                ms: Math.round(performance.now() - startedAt),
                detail: describe(error),
                network: typeof flagged === 'boolean' ? flagged : looksLikeNetwork(error),
            });
        }
    }
    // 只数这个模组自己目录里的归档：主进程里几个模组共用一份 require.cache（入口打出来的 __dirname 就是模组目录）。
    const cache = createRequire(__filename).cache;
    const own = `${__dirname}${path.sep}deps.`;
    const fromArchive = Object.keys(cache).filter((file) => file.startsWith(own) && /deps\.[0-9a-f]+\.asar[\\/]/.test(file));
    const archive = fromArchive[0]?.replace(/(deps\.[0-9a-f]+\.asar)[\\/].*$/, '$1') ?? null;
    return { sample, upstream, archiveModules: fromArchive.length, archive, steps };
};

/** 请求答了，但答的不是成功：抛一个带上答复摘要的错，答复里的错误文字像网络问题时标成网络。 */
export const answerError = (summary: string, body: unknown): Error => Object.assign(
    new Error(`${summary}: ${describe(body)}`),
    { network: looksLikeNetwork(body) },
);
