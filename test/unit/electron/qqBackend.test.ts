import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/qqBackend.test.ts
// QQ 后端：拉起步骤、打包缺包时的 unavailable、以及挂在包内部的诊断钩子（用假的包文件，不加载真包）。

const { createQqBackend, describeFailureError, installQqLoginHooks } = require('../../../electron/qq/qqBackend.cjs') as {
    describeFailureError: (error: unknown) => { stack?: string[] };
    createQqBackend: (options: Record<string, unknown>) => {
        start: () => Promise<void>;
        stop: () => Promise<void>;
        getStatus: () => any;
        getPort: () => number | null;
        getDiagnostics: () => any;
        selfCheckHosts: string[];
    };
    installQqLoginHooks: (options: Record<string, unknown>) => { installed: string[]; error: string | null };
};

const PACKAGE_ROOT = '/fake/qq-music-api';

/** 假的包内部文件：扫码服务实例与 logger，结构与 3.1.3 相同。 */
const createFakePackage = () => {
    const service = {
        failSession: vi.fn(function failSession(this: unknown, ...args: unknown[]) {
            (args[0] as { state: string }).state = 'failed';
            return 'original-session-result';
        }),
        failBootstrap: vi.fn((..._args: unknown[]) => new Error('Unable to start QR login')),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const files: Record<string, unknown> = {
        [path.join(PACKAGE_ROOT, 'dist/src/services/auth/qrLogin.node.js')]: { qrLoginService: service },
        [path.join(PACKAGE_ROOT, 'dist/src/util/logger.js')]: { logger },
        [path.join(PACKAGE_ROOT, 'package.json')]: { version: '3.1.3' },
    };
    const loadFile = (file: string) => {
        if (!(file in files)) throw Object.assign(new Error(`Cannot find module '${file}'`), { code: 'MODULE_NOT_FOUND' });
        return files[file];
    };
    return { service, logger, loadFile, originals: { failSession: service.failSession, failBootstrap: service.failBootstrap } };
};

describe('QQ login hooks', () => {
    it('records the original error behind a failed QR session and still runs the package code', () => {
        const fake = createFakePackage();
        const failures: any[] = [];
        const authEvents: any[] = [];
        const result = installQqLoginHooks({ packageRoot: PACKAGE_ROOT, loadFile: fake.loadFile, failures, authEvents, now: () => 42 });
        expect(result).toEqual({ installed: ['failSession', 'failBootstrap', 'logger'], error: null });

        const session = { channel: 'qq', state: 'exchanging' };
        const error = Object.assign(new Error('Electron safeStorage selected the unencrypted basic_text backend'), {
            response: { status: 500, headers: { cookie: 'never-copied' } },
            cause: new Error('keyring locked'),
        });
        const returned = fake.service.failSession(session, error, 'session-issue');

        // 透传：原方法照常执行、返回值不变、this 仍是服务实例。
        expect(returned).toBe('original-session-result');
        expect(fake.originals.failSession).toHaveBeenCalledWith(session, error, 'session-issue');
        expect(session.state).toBe('failed');
        expect(failures).toEqual([expect.objectContaining({
            at: 42,
            kind: 'session',
            stage: 'session-issue',
            channel: 'qq',
            sessionState: 'exchanging',
            error: expect.objectContaining({
                name: 'Error',
                message: 'Electron safeStorage selected the unencrypted basic_text backend',
                httpStatus: 500,
                cause: 'keyring locked',
            }),
        })]);
        // 只挑字段，不把 axios 错误整个序列化（请求头里有 Cookie）。
        expect(JSON.stringify(failures)).not.toContain('never-copied');
    });

    it('records bootstrap failures with the 3.1.2 and 3.1.3 call shapes', () => {
        const fake = createFakePackage();
        const failures: any[] = [];
        installQqLoginHooks({ packageRoot: PACKAGE_ROOT, loadFile: fake.loadFile, failures, authEvents: [] });

        fake.service.failBootstrap(Object.assign(new Error('getaddrinfo ENOTFOUND api.tencentmusic.com'), { code: 'ENOTFOUND' }));
        fake.service.failBootstrap(new Error('QIMEI rejected'), 'device-bootstrap');

        expect(failures.map(item => [item.kind, item.stage, item.error.code ?? null])).toEqual([
            ['bootstrap', null, 'ENOTFOUND'],
            ['bootstrap', 'device-bootstrap', null],
        ]);
    });

    it('collects qq-auth events from the package logger and keeps logging them', () => {
        const fake = createFakePackage();
        const authEvents: any[] = [];
        const originalWarn = fake.logger.warn;
        installQqLoginHooks({ packageRoot: PACKAGE_ROOT, loadFile: fake.loadFile, failures: [], authEvents, now: () => 7 });

        fake.logger.warn('qq-auth.session-failed', { failureStage: 'credential-exchange', name: 'QqProtocolError' });
        fake.logger.info('request.received', { route: '/login/qr/key' });

        expect(authEvents).toEqual([{
            at: 7,
            level: 'warn',
            event: 'qq-auth.session-failed',
            details: { failureStage: 'credential-exchange', name: 'QqProtocolError' },
        }]);
        expect(originalWarn).toHaveBeenCalledWith('qq-auth.session-failed', { failureStage: 'credential-exchange', name: 'QqProtocolError' });
    });

    it('reports hooks it could not install instead of throwing', () => {
        const result = installQqLoginHooks({
            packageRoot: PACKAGE_ROOT,
            loadFile: () => { throw new Error('layout changed'); },
            failures: [],
            authEvents: [],
        });
        expect(result.installed).toEqual([]);
        expect(result.error).toBe('qr service: layout changed; logger: layout changed');
    });
});

describe('QQ failure stack', () => {
    it('keeps only the part of each frame inside the package, so no user folder is stored', () => {
        const error = new Error('failed');
        error.stack = [
            'Error: failed',
            '    at QrLoginService.failSession (C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\folia\\resources\\app.asar\\node_modules\\@yakult-green-tea\\qq-music-api\\dist\\src\\qrLogin.node.js:185:23)',
            '    at C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\folia\\resources\\app.asar\\electron\\qq\\qqBackend.cjs:80:9',
            '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
        ].join('\n');
        expect(describeFailureError(error).stack).toEqual([
            'at QrLoginService.failSession (@yakult-green-tea/qq-music-api/dist/src/qrLogin.node.js:185:23)',
            'at electron/qq/qqBackend.cjs:80:9',
            'at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
        ]);
    });
});

describe('QQ backend lifecycle', () => {
    const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    it('starts in named steps, installs the hooks and publishes running only once the server listens', async () => {
        const fake = createFakePackage();
        const broadcast = vi.fn();
        const close = vi.fn().mockResolvedValue(undefined);
        const startServer = vi.fn().mockResolvedValue({ close });
        const backend = createQqBackend({
            broadcast,
            getStateFilePath: () => '/user-data/qq-auth-state/qq-device.json',
            authSessionRepository: { kind: 'electron-safe-storage' },
            logger: quietLogger,
            resolvePackageRoot: () => PACKAGE_ROOT,
            startServer,
            loadFile: fake.loadFile,
        });

        await backend.start();

        expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
            stateFilePath: '/user-data/qq-auth-state/qq-device.json',
            authSessionRepository: { kind: 'electron-safe-storage' },
        }));
        expect(backend.getStatus()).toMatchObject({ status: 'running', error: null });
        expect(backend.getPort()).toBe(backend.getStatus().port);
        expect(broadcast.mock.calls.map(([, status]) => status.status)).toEqual(['starting', 'running']);
        const diagnostics = backend.getDiagnostics();
        expect(diagnostics.version).toBe('3.1.3');
        expect(diagnostics.hooks).toEqual({ installed: ['failSession', 'failBootstrap', 'logger'], error: null });
        expect(diagnostics.startup[0].steps.map((step: any) => [step.id, step.outcome])).toEqual([
            ['port', 'ok'], ['listen', 'ok'], ['login-hooks', 'ok'],
        ]);

        await backend.stop();
        expect(close).toHaveBeenCalledOnce();
    });

    it('tells the renderer when the encrypted sign-in store could not be read at start', async () => {
        const fake = createFakePackage();
        const { createQqAuthSessionRepository } = require('../../../electron/qq/qqAuthSessionRepository.cjs');
        const authSessionRepository = createQqAuthSessionRepository({
            store: { get: () => 'ciphertext', set: vi.fn(), delete: vi.fn() },
            safeStorage: { isEncryptionAvailable: () => false },
        });
        // 包加载时就读仓库，读不出只记一行日志（sessionState.js restore），照常监听。
        const startServer = vi.fn(async ({ authSessionRepository: repository }: { authSessionRepository: { load: () => unknown } }) => {
            try { repository.load(); } catch { /* the package logs qq-auth.auth-session.load-failed */ }
            return { close: vi.fn() };
        });
        const backend = createQqBackend({
            broadcast: vi.fn(),
            authSessionRepository,
            logger: quietLogger,
            resolvePackageRoot: () => PACKAGE_ROOT,
            startServer,
            loadFile: fake.loadFile,
        });

        await backend.start();

        expect(backend.getStatus()).toMatchObject({ status: 'running', sessionStoreUnreadable: true });
        // 这次运行里扫码登录：仓库把读不出的那份删掉，之后问到的状态就是读得出。
        try { authSessionRepository.save([{ token: 'this-run' }]); } catch { /* the package logs qq-auth.auth-session.save-failed */ }
        expect(backend.getStatus()).toMatchObject({ status: 'running', sessionStoreUnreadable: false });
    });

    it('names the failed step in the status error', async () => {
        const backend = createQqBackend({
            broadcast: vi.fn(),
            logger: quietLogger,
            startServer: vi.fn().mockRejectedValue(Object.assign(new Error('listen EADDRINUSE: address already in use :::4000'), { code: 'EADDRINUSE' })),
        });

        await backend.start();

        expect(backend.getStatus()).toMatchObject({ status: 'error', port: null, error: 'listen: listen EADDRINUSE: address already in use :::4000' });
        expect(backend.getPort()).toBeNull();
        expect(backend.getDiagnostics().startup[0]).toMatchObject({ outcome: 'failed' });
    });

    it('reports a build without the package as unavailable', async () => {
        const backend = createQqBackend({
            broadcast: vi.fn(),
            logger: quietLogger,
            startServer: vi.fn().mockRejectedValue(Object.assign(new Error('QQ API package is not installed'), { code: 'MODULE_NOT_FOUND' })),
        });

        await backend.start();

        expect(backend.getStatus()).toMatchObject({ status: 'unavailable', port: null });
    });
});
