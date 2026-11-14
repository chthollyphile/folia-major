import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { FoliumSourceMainApi } from '@folia/folium';
import { errorFields } from '@folia/folium-source-kit';
import { catalog, loadedFrom } from 'fixture-asar-dep';
import { label } from 'fixture-bundle-dep';
import esmDefault, { greet } from 'fixture-esm-only';
import type { WorkerAnswer, WorkerQuestion } from './protocol';
// test/fixtures/folium-sources/fixture-source/main/index.ts
// 构建夹具音源的 main 入口：搜索的答案由四条构建路径各出一段——打进 bundle 的包（label）、deps 归档里的包
// （catalog，它扫自己的 module/ 目录）、worker 线程（worker.cjs，它也从归档取依赖）、vendor.mjs 里的 ESM-only 包。
// 桌面实测从搜索结果就能看出每条路径都通了；`probe` 交回归档的实际位置。

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const worker = new Worker(path.join(__dirname, 'worker.cjs'));
    const waiting = new Map<number, (answer: WorkerAnswer) => void>();
    let next = 0;
    worker.on('message', (answer: WorkerAnswer) => {
        waiting.get(answer.id)?.(answer);
        waiting.delete(answer.id);
    });
    worker.on('error', (error) => { api.log.warn('worker failed', errorFields(error)); });
    const ask = (query: string) => new Promise<WorkerAnswer>((resolve) => {
        next += 1;
        waiting.set(next, resolve);
        const question: WorkerQuestion = { id: next, query };
        worker.postMessage(question);
    });
    api.onDispose(() => { void worker.terminate(); });

    const rows = async (query: string) => {
        const answer = await ask(query);
        const parts = [label(query), ...catalog(), answer.from, greet(esmDefault.kind)];
        return parts.map((part, index) => ({ id: `${query}-${index}`, title: `${query} · ${part}`, artist: 'probe' }));
    };
    api.rpc.handle('search', (query: unknown) => rows(typeof query === 'string' ? query : ''));
    api.rpc.handle('song', async (id: unknown) => {
        const [query, index] = typeof id === 'string' ? id.split('-') : [];
        return (await rows(query ?? '')).find((row) => row.id === `${query}-${index}`) ?? null;
    });
    api.rpc.handle('probe', () => ({ depsFrom: loadedFrom, catalog: catalog() }));
    api.log.info(`main ready, deps from ${loadedFrom}`);
}
