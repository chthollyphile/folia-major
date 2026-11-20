import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { answerError, freePort, runSteps, untilListening, withTimeout } from '../../shared/smoke';
// test/fixtures/folium-sources/deps-archive/netease/main/worker.ts
// 网易云依赖归档样例的 worker（worker.cjs）：照 sources/netease/main/neteaseApiWorker.cjs（迁之前在宿主的 electron/netease/） 的形态，在工作线程里
// 从 deps 归档加载上游，先经 require.cache 换掉它的 util/request（网易云模组的 worker 就是这样挂请求管线的），再起本地服务，
// 发一次匿名搜索。替换赶在 main / server 首次 require util/request 之前，所以上游全用动态 import 按顺序取。

const NCM = '@neteasecloudmusicapienhanced/api';
const KEYWORD = '晴天';

interface ListeningServer {
    listening: boolean;
    once(event: string, listener: (...args: unknown[]) => void): unknown;
    address(): unknown;
    close(): unknown;
}

let server: ListeningServer | null = null;
// 上游 server 模块的 serveNcmApi：加载那一步取到，后端起来那一步用。
let serve: ((options: { port: number; host: string }) => Promise<{ server: ListeningServer }>) | null = null;
// 上游的请求函数被调用的次数：替换生效、server 拿到的是替换后的那个，请求过后它大于 0。
let requestCalls = 0;
let port = 0;

const load = async (): Promise<string> => {
    // util/request 在首次 require 时同步读 <tmp>/anonymous_token，文件不存在就抛 ENOENT（宿主同样先建好；有就不动）。
    const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
    if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');
    const { default: createRequest } = await import('@neteasecloudmusicapienhanced/api/util/request');
    const cache = createRequire(__filename).cache;
    const key = Object.keys(cache).find((file) => cache[file]?.exports === createRequest);
    const entry = key === undefined ? undefined : cache[key];
    if (!key || !entry) throw new Error('util/request is not in require.cache');
    entry.exports = (...args: unknown[]) => {
        requestCalls += 1;
        return createRequest(...args);
    };
    const util = await import('@neteasecloudmusicapienhanced/api/util/index');
    await import('@neteasecloudmusicapienhanced/api/main');
    const { serveNcmApi } = await import('@neteasecloudmusicapienhanced/api/server');
    const scope = globalThis as Record<string, unknown>;
    scope.cnIp = util.generateRandomChineseIP();
    scope.deviceId = util.generateDeviceId();
    serve = serveNcmApi;
    return `util/request replaced at ${path.basename(path.dirname(key))}/${path.basename(key)}`;
};

const ready = async (): Promise<string> => {
    if (!serve) throw new Error('server module did not load');
    // 先挑空闲端口：给 0 不行，上游按 `port || PORT || 3000` 取，0 会落到 3000（宿主也是先挑端口，findFreePort）。
    // serveNcmApi 先扫 module/ 目录（fs.promises.readdir，在归档里）再 listen。
    port = await freePort();
    const app = await serve({ port, host: '127.0.0.1' });
    server = app.server;
    await untilListening(server);
    const address = server.address();
    const bound = address && typeof address === 'object' ? (address as { port: number }).port : 0;
    if (bound !== port) throw new Error(`asked for port ${String(port)}, listening on ${String(bound)}`);
    return `listening on 127.0.0.1:${String(port)}`;
};

const request = async (): Promise<string> => {
    const url = `http://127.0.0.1:${String(port)}/cloudsearch?keywords=${encodeURIComponent(KEYWORD)}&limit=1`;
    const response = await withTimeout(fetch(url), 30000, 'cloudsearch');
    const body = await response.json() as { code?: number; result?: { songs?: Array<{ name?: string }>; songCount?: number } };
    if (body.code !== 200) throw answerError(`HTTP ${String(response.status)} code ${String(body.code)}`, body);
    // 答了但没经过替换后的 util/request：require.cache 的替换没生效（server 拿到的是原函数）。这不是网络问题。
    if (requestCalls === 0) throw Object.assign(new Error('the request did not go through the replaced util/request'), { network: false });
    const first = body.result?.songs?.[0]?.name ?? '(none)';
    return `code 200, songCount ${String(body.result?.songCount ?? 0)}, first "${first}", upstream request() called ${String(requestCalls)}x`;
};

parentPort?.on('message', (message: { type: string }) => {
    if (message.type === 'close') {
        server?.close();
        return;
    }
    if (message.type !== 'smoke') return;
    void runSteps('netease', NCM, [['load', load], ['ready', ready], ['request', request]]).then((report) => {
        parentPort?.postMessage({ type: 'report', report });
    });
});
