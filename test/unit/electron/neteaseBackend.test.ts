import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { SHARE_ENV, Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseBackend.test.ts
// 网易后端的错误边界：上游包加载前的准备失败（#690：临时目录不可用）不能带崩主进程，要变成 load 步骤的失败与 error 状态。
// 用真的工作线程跑：加载在线程里进行，失败要经线程的回话变成主进程这边的状态和诊断。

const { createNeteaseBackend } = require('../../../electron/netease/neteaseBackend.cjs') as {
    createNeteaseBackend: (options: Record<string, unknown>) => {
        start: (reason?: string) => Promise<any>;
        getStatus: () => any;
        getPort: () => number | null;
        getDiagnostics: () => Promise<any>;
    };
};

const WORKER_PATH = path.resolve(__dirname, '../../../electron/netease/neteaseApiWorker.cjs');
const workers: Worker[] = [];
const createWorker = () => {
    const worker = new Worker(WORKER_PATH, { env: SHARE_ENV });
    workers.push(worker);
    return worker;
};

const TEMP_KEYS = ['TMPDIR', 'TEMP', 'TMP'] as const;
const savedTemp = Object.fromEntries(TEMP_KEYS.map(key => [key, process.env[key]]));

afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.terminate()));
    for (const key of TEMP_KEYS) {
        if (savedTemp[key] === undefined) delete process.env[key];
        else process.env[key] = savedTemp[key];
    }
});

/** 让 os.tmpdir() 指向一个不存在的目录，复现 TEMP=%USERPROFILE%\... 没展开时的情形。 */
const pointTempAtMissingDirectory = () => {
    const missing = path.join(os.tmpdir(), `folia-missing-${process.pid}-${Date.now()}`, '%USERPROFILE%', 'Temp');
    for (const key of TEMP_KEYS) process.env[key] = missing;
    return missing;
};

describe('NetEase backend load boundary', () => {
    it('turns a failed upstream preparation into an error status instead of throwing', async () => {
        const missing = pointTempAtMissingDirectory();
        const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const broadcast = vi.fn();

        const backend = createNeteaseBackend({ broadcast, logger, now: () => 1000, createWorker });
        const status = await backend.start();
        expect(logger.error).toHaveBeenCalledWith('[Netease API] failed to load upstream package', expect.any(Error));
        expect(status).toMatchObject({ status: 'error', port: null });
        expect(status.error).toMatch(/^load: ENOENT/);
        expect(status.error).toContain(missing);
        expect(backend.getPort()).toBeNull();
        expect(broadcast).toHaveBeenLastCalledWith('netease-api-status-changed', status);

        const diagnostics = await backend.getDiagnostics();
        expect(diagnostics.login).toBeNull();
        expect(diagnostics.identity).toBeNull();
        expect(diagnostics.startup).toEqual([expect.objectContaining({
            outcome: 'failed',
            steps: [expect.objectContaining({ id: 'load', outcome: 'failed', error: expect.stringContaining('ENOENT') })],
        })]);

        // 重启不重试加载，如实再报一次同样的失败。
        const again = await backend.start();
        expect(again.error).toBe(status.error);
        expect((await backend.getDiagnostics()).startup).toHaveLength(2);
    });
});

// 主进程这一侧的规则，线程用替身：只看它发了什么、回它什么。
class FakeWorker extends EventEmitter {
    posted: any[] = [];

    postMessage(message: any) {
        this.posted.push(message);
    }
}

describe('NetEase backend on the main thread', () => {
    const setup = () => {
        let clock = 1000;
        const fakes: FakeWorker[] = [];
        const broadcast = vi.fn();
        const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const backend = createNeteaseBackend({
            broadcast,
            logger,
            now: () => clock,
            createWorker: () => {
                const worker = new FakeWorker();
                fakes.push(worker);
                return worker;
            },
        });
        const answer = (value: Record<string, unknown>) => {
            const worker = fakes[fakes.length - 1];
            const message = worker.posted[worker.posted.length - 1];
            worker.emit('message', { type: 'result', id: message.id, ...value });
        };
        return { backend, fakes, answer, advance: (ms: number) => { clock += ms; } };
    };

    it('runs on the port the worker listened on, and goes down when the worker ends', async () => {
        const { backend, fakes, answer } = setup();
        const started = backend.start();
        expect(fakes[0].posted[0]).toMatchObject({ type: 'start', host: '127.0.0.1' });
        answer({ ok: true, value: { port: 4321 } });
        await expect(started).resolves.toMatchObject({ status: 'running', port: 4321 });
        expect(backend.getPort()).toBe(4321);

        fakes[0].emit('exit', 1);
        expect(backend.getStatus()).toMatchObject({ status: 'error', port: null, offline: false });
        expect(backend.getPort()).toBeNull();
    });

    it("starts again for a request that needs it only after an offline failure and the gap", async () => {
        const { backend, fakes, answer, advance } = setup();
        const started = backend.start();
        answer({ ok: false, error: new Error('xeapi-key: getaddrinfo ENOTFOUND interface3.music.163.com'), offline: true });
        await expect(started).resolves.toMatchObject({ status: 'error', offline: true, error: expect.stringMatching(/^xeapi-key: /) });

        await backend.start('needed');
        expect(fakes[0].posted).toHaveLength(1);

        advance(10_000);
        void backend.start('needed');
        expect(fakes[0].posted).toHaveLength(2);
    });
});
