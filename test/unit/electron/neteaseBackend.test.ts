import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHARE_ENV, Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/neteaseBackend.test.ts
// 网易后端的错误边界：上游包加载前的准备失败（#690：临时目录不可用）不能带崩主进程，要变成 load 步骤的失败与 error 状态。
// 用真的工作线程跑：加载在线程里进行，失败要经线程的回话变成主进程这边的状态和诊断。

const { createNeteaseBackend } = require('../../../electron/netease/neteaseBackend.cjs') as {
    createNeteaseBackend: (options: Record<string, unknown>) => {
        preload: () => void;
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
// 测试里建出来给线程用的临时目录，线程结束后删掉（要在 terminate 之后，见 afterEach 的顺序）。
const tempDirsCreated: string[] = [];

afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.terminate()));
    tempDirsCreated.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
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

// 上游包的临时文件（anonymous_token、xeapi_public_key 等）按用户隔离（#1304：/tmp 全机共有，别的用户的
// 文件读不出也盖不掉）。用真的线程跑：workerData 里的目录要传到线程，os.tmpdir() 要指过去，退回也要看得见。
describe('NetEase backend per-user tmp dir', () => {
    const createRealWorkerBackend = ({ workerData, logger }: { workerData: Record<string, unknown>; logger: object }) => createNeteaseBackend({
        broadcast: vi.fn(),
        logger,
        now: () => 1000,
        workerData,
        createWorker: (data: Record<string, unknown>) => {
            const worker = new Worker(WORKER_PATH, { env: SHARE_ENV, workerData: data });
            workers.push(worker);
            return worker;
        },
    });

    it('points the worker and the upstream package at the per-user dir from workerData', async () => {
        const perUserDir = path.join(os.tmpdir(), `folia-netease-tmp-${process.pid}-${Date.now()}`);
        mkdirSync(perUserDir, { recursive: true });
        tempDirsCreated.push(perUserDir);
        const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const backend = createRealWorkerBackend({ workerData: { upstreamTmpDir: perUserDir }, logger });

        // 先 preload 把线程开出来；diagnostics 线程回话前要加载完上游包，正好一并验到。
        backend.preload();
        const diagnostics = await backend.getDiagnostics();

        expect(diagnostics.upstreamTmpDir).toBe(perUserDir);
        // anonymous_token 是加载上游包时建的第一个临时文件：建在按用户的目录里，不再落在共享的 /tmp。
        expect(existsSync(path.join(perUserDir, 'anonymous_token'))).toBe(true);
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('upstream tmp dir falls back'));
    });

    it('falls back to the system tmp dir with a warning when the per-user dir cannot be created', async () => {
        // 想建目录的位置上放一个同名文件，mkdirSync 必失败。退回的系统临时目录经 TMPDIR 指到测试自己的
        // 目录里，上游的临时文件不落进真的 /tmp。
        const blocked = path.join(os.tmpdir(), `folia-netease-blocked-${process.pid}-${Date.now()}`);
        writeFileSync(blocked, '', 'utf-8');
        tempDirsCreated.push(blocked);
        const systemTmp = path.join(os.tmpdir(), `folia-netease-fallback-${process.pid}-${Date.now()}`);
        mkdirSync(systemTmp, { recursive: true });
        tempDirsCreated.push(systemTmp);
        for (const key of TEMP_KEYS) process.env[key] = systemTmp;
        const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const backend = createRealWorkerBackend({ workerData: { upstreamTmpDir: blocked }, logger });

        backend.preload();
        const diagnostics = await backend.getDiagnostics();

        expect(diagnostics.upstreamTmpDir).toBe(systemTmp);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('upstream tmp dir falls back'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(blocked));
        expect(existsSync(path.join(systemTmp, 'anonymous_token'))).toBe(true);
    });
});
