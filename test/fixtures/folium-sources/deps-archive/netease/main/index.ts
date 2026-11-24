import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { FoliumSourceMainApi } from '@folia/folium';
import type { SmokeReport } from '../../shared/smoke';
// test/fixtures/folium-sources/deps-archive/netease/main/index.ts
// 网易云依赖归档样例的 main 入口：上游在 worker.cjs 里从 deps 归档加载（宿主也是把它放在工作线程里），这里只开线程、
// 收它的冒烟报告。rpc `smoke` 交回报告。

const SMOKE_TIMEOUT_MS = 120000;

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    let worker: Worker | null = null;
    api.onDispose(() => {
        worker?.postMessage({ type: 'close' });
        void worker?.terminate();
    });
    api.rpc.handle('smoke', () => new Promise<SmokeReport>((resolve, reject) => {
        const startedAt = performance.now();
        worker = new Worker(path.join(__dirname, 'worker.cjs'));
        const timer = setTimeout(() => { reject(new Error(`worker gave no report in ${String(SMOKE_TIMEOUT_MS)}ms`)); }, SMOKE_TIMEOUT_MS);
        worker.on('message', (message: { type: string; report?: SmokeReport }) => {
            if (message.type !== 'report' || !message.report) return;
            clearTimeout(timer);
            api.log.info(`worker report after ${String(Math.round(performance.now() - startedAt))}ms`);
            resolve(message.report);
        });
        worker.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        worker.postMessage({ type: 'smoke' });
    }));
}
