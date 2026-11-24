import { parentPort } from 'node:worker_threads';
import { catalog } from 'fixture-asar-dep';
import { label } from 'fixture-bundle-dep';
import type { WorkerAnswer, WorkerQuestion } from './protocol';
// test/fixtures/folium-sources/fixture-source/main/worker.ts
// 构建夹具音源的 worker（worker.cjs）：在线程里从 deps 归档取依赖（createRequire），答一段文字。

parentPort?.on('message', (question: WorkerQuestion) => {
    const answer: WorkerAnswer = { id: question.id, from: `worker:${label(question.query)}:${catalog().length}` };
    parentPort?.postMessage(answer);
});
