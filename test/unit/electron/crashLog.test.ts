import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/electron/crashLog.test.ts
// The parts of crash reporting that decide something: where the file goes when the install
// directory refuses it, what the file says, how many are kept, and when the user is interrupted.
// Registering the process and app listeners is left to the app — it is four `on` calls.

const { createCrashLog, installCrashHandlers, orderedCrashFiles, resolveCrashLogDir } = require('../../../electron/debug/crashLog.cjs');

let workspace = '';

/** An `app` shaped like Electron's, with the two paths this module reads. */
const fakeApp = (paths: { exe: string; userData: string }, isReady = true) => ({
    getPath: (name: string) => (name === 'exe' ? paths.exe : paths.userData),
    getVersion: () => '9.9.9',
    isPackaged: true,
    isReady: () => isReady,
});

const locale = {
    crashTitle: 'title',
    crashMessage: 'message',
    crashOpenFolder: 'open',
    crashClose: 'close',
};

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-crash-'));
});

afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const build = (overrides: Record<string, unknown> = {}) => {
    const exeDir = path.join(workspace, 'install');
    fs.mkdirSync(exeDir, { recursive: true });
    const userData = path.join(workspace, 'userData');
    fs.mkdirSync(userData, { recursive: true });

    const dialog = {
        showMessageBoxSync: vi.fn(() => 1),
        showMessageBox: vi.fn(async () => ({ response: 1 })),
        showErrorBox: vi.fn(),
    };
    const shell = { showItemInFolder: vi.fn() };
    const crashLog = createCrashLog({
        app: fakeApp({ exe: path.join(exeDir, 'Folia'), userData }),
        dialog,
        shell,
        getLocale: () => locale,
        ...overrides,
    });
    return { crashLog, dialog, shell, exeDir, userData };
};

describe('where crash reports are written', () => {
    it('puts them beside the executable when that directory takes a write', () => {
        const { crashLog, exeDir } = build();
        expect(crashLog.dir).toBe(path.join(exeDir, 'logs'));
    });

    it('falls back to userData when the install directory refuses one', () => {
        const exeDir = path.join(workspace, 'readonly');
        fs.mkdirSync(exeDir, { recursive: true });
        const userData = path.join(workspace, 'userData');
        // A `.deb` under root-owned /opt and a read-only AppImage mount both land here, so this is
        // the ordinary case on Linux rather than an edge one.
        vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('EACCES'); });

        const dir = resolveCrashLogDir(fakeApp({ exe: path.join(exeDir, 'Folia'), userData }));

        expect(dir).toBe(path.join(userData, 'logs'));
    });

    it('never writes into a macOS bundle, because that would break its signature', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        try {
            const exeDir = path.join(workspace, 'Folia.app', 'Contents', 'MacOS');
            fs.mkdirSync(exeDir, { recursive: true });
            const userData = path.join(workspace, 'userData');

            const dir = resolveCrashLogDir(fakeApp({ exe: path.join(exeDir, 'Folia'), userData }));

            expect(dir).toBe(path.join(userData, 'logs'));
        } finally {
            Object.defineProperty(process, 'platform', platform);
        }
    });
});

describe('what a report contains and does', () => {
    it('writes the environment and the stack, and offers to open the folder', () => {
        const { crashLog, dialog, shell } = build();
        dialog.showMessageBoxSync.mockReturnValue(0);

        const file = crashLog.reportError('uncaughtException', new Error('boom'), { blocking: true });

        const body = fs.readFileSync(file, 'utf8');
        expect(body).toContain('Kind       uncaughtException');
        expect(body).toContain('Folia      9.9.9');
        expect(body).toContain('Error: boom');
        expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
        expect(shell.showItemInFolder).toHaveBeenCalledWith(file);
    });

    it('leaves the folder alone when the dialog is dismissed', () => {
        const { crashLog, dialog, shell } = build();
        dialog.showMessageBoxSync.mockReturnValue(1);

        crashLog.reportError('uncaughtException', new Error('boom'), { blocking: true });

        expect(shell.showItemInFolder).not.toHaveBeenCalled();
    });

    it('only blocks the process for the fatal path', async () => {
        const { crashLog, dialog } = build();

        // 渲染进程崩溃时主进程还活着，而 app 级监听器先于窗口级监听器触发（Electron 43 实测）。
        // 同步对话框会把壁纸恢复挡在模态框后面，所以这条路径必须是异步的、而且延后一拍。
        crashLog.report('render-process-gone', 'Reason     crashed');
        expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
        expect(dialog.showMessageBox).not.toHaveBeenCalled();

        await new Promise(resolve => setImmediate(resolve));
        expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    });

    it('writes the file before yielding, so a relaunch cannot lose it', () => {
        const { crashLog } = build();

        const file = crashLog.report('render-process-gone', 'Reason     crashed');

        expect(fs.existsSync(file)).toBe(true);
    });

    it('records a survivable failure without putting a modal over the app', () => {
        const { crashLog, dialog } = build();

        const file = crashLog.reportError('unhandledRejection', new Error('later'), { announceToUser: false });

        expect(fs.existsSync(file)).toBe(true);
        expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
    });

    it('uses the one dialog Electron has before ready', () => {
        const exeDir = path.join(workspace, 'install');
        fs.mkdirSync(exeDir, { recursive: true });
        const dialog = { showMessageBoxSync: vi.fn(), showMessageBox: vi.fn(), showErrorBox: vi.fn() };
        const crashLog = createCrashLog({
            app: fakeApp({ exe: path.join(exeDir, 'Folia'), userData: path.join(workspace, 'userData') }, false),
            dialog,
            shell: { showItemInFolder: vi.fn() },
            getLocale: () => locale,
        });

        crashLog.reportError('uncaughtException', new Error('during startup'), { blocking: true });

        expect(dialog.showErrorBox).toHaveBeenCalledTimes(1);
        expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
    });

    it('keeps the newest twenty files, so a crash loop cannot fill a disk', () => {
        const { crashLog } = build();
        for (let index = 0; index < 25; index += 1) {
            crashLog.report('render-process-gone', `run ${index}`, { announceToUser: false });
        }

        // 数量对不代表留对了。一个崩溃循环里的报告全落在同一毫秒，只靠数字后缀区分，
        // 而字典序里 `-10` 排在 `-2` 前面——照那个顺序删，被删掉的正好是最新的几份。
        const survivors = fs.readdirSync(crashLog.dir)
            .filter(name => name.startsWith('crash-'))
            .map(name => fs.readFileSync(path.join(crashLog.dir, name), 'utf8'));
        expect(survivors.length).toBe(20);
        for (let index = 5; index < 25; index += 1) {
            expect(survivors.some(body => body.includes(`run ${index}\n`))).toBe(true);
        }
        for (let index = 0; index < 5; index += 1) {
            expect(survivors.some(body => body.includes(`run ${index}\n`))).toBe(false);
        }
    });

    it('orders a same-millisecond burst by its numeric suffix, not as text', () => {
        const dir = path.join(workspace, 'ordering');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = '2026-09-08T11-47-53-237Z';
        for (const name of [`crash-${stamp}.log`, `crash-${stamp}-2.log`, `crash-${stamp}-10.log`, 'crash-legacy.log']) {
            fs.writeFileSync(path.join(dir, name), '');
        }

        // 无法解析的旧名字排最前，这样它会先被清掉，而不是永远留在上限之外。
        expect(orderedCrashFiles(dir)).toEqual([
            'crash-legacy.log',
            `crash-${stamp}.log`,
            `crash-${stamp}-2.log`,
            `crash-${stamp}-10.log`,
        ]);
    });

    it('reports nothing rather than throwing when there is nowhere to write', () => {
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('EROFS'); });
        const crashLog = createCrashLog({
            app: fakeApp({ exe: path.join(workspace, 'nope', 'Folia'), userData: path.join(workspace, 'nope2') }),
            dialog: { showMessageBoxSync: vi.fn(), showMessageBox: vi.fn(), showErrorBox: vi.fn() },
            shell: { showItemInFolder: vi.fn() },
            getLocale: () => locale,
        });

        expect(crashLog.dir).toBeNull();
        expect(crashLog.reportError('uncaughtException', new Error('boom'))).toBeNull();
    });
});

describe('which failures reach the user', () => {
    /** Removes the process-level handlers again; leaving them installed would swallow real errors. */
    const withHandlers = (run: (app: EventEmitter & { exit: ReturnType<typeof vi.fn> }, report: ReturnType<typeof vi.fn>) => void, options = {}) => {
        const before = {
            uncaughtException: process.listeners('uncaughtException').slice(),
            unhandledRejection: process.listeners('unhandledRejection').slice(),
        };
        const app = Object.assign(new EventEmitter(), { exit: vi.fn() });
        const report = vi.fn(() => '/tmp/crash.log');
        installCrashHandlers({ app, crashLog: { report, reportError: report }, ...options });
        try {
            run(app as EventEmitter & { exit: ReturnType<typeof vi.fn> }, report);
        } finally {
            for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
                for (const listener of process.listeners(event)) {
                    if (!before[event].includes(listener)) process.removeListener(event, listener);
                }
            }
        }
    };

    const gone = (reason: string) => ({ reason, exitCode: 1 });

    it('asks for the pages\' storage to be written before it exits after an uncaught exception, and exits when that fails', () => {
        for (const flushed of [() => {}, () => { throw new Error('not ready'); }]) {
            const order: string[] = [];
            const flushStorage = vi.fn(() => { order.push('flush'); flushed(); });
            withHandlers(app => {
                app.exit.mockImplementation(() => { order.push('exit'); });
                const ours = process.listeners('uncaughtException').at(-1)!;
                ours(new Error('boom'), 'uncaughtException');
                expect(order).toEqual(['flush', 'exit']);
                expect(app.exit).toHaveBeenCalledWith(1);
            }, { flushStorage });
        }
    });

    it('runs beforeExit right before the exit after an uncaught exception, and exits when it throws', () => {
        // app.exit() 跳过 before-quit / will-quit：HiFi 的 mpv 子进程在这里杀。
        for (const beforeExitResult of [() => {}, () => { throw new Error('already gone'); }]) {
            const order: string[] = [];
            const flushStorage = vi.fn(() => { order.push('flush'); });
            const beforeExit = vi.fn(() => { order.push('beforeExit'); beforeExitResult(); });
            withHandlers(app => {
                app.exit.mockImplementation(() => { order.push('exit'); });
                const ours = process.listeners('uncaughtException').at(-1)!;
                ours(new Error('boom'), 'uncaughtException');
                expect(order).toEqual(['flush', 'beforeExit', 'exit']);
                expect(app.exit).toHaveBeenCalledWith(1);
            }, { flushStorage, beforeExit });
        }
    });

    it('ignores a renderer that exited cleanly', () => {
        withHandlers((app, report) => {
            app.emit('render-process-gone', {}, { getURL: () => 'x' }, gone('clean-exit'));
            expect(report).not.toHaveBeenCalled();
        });
    });

    it('records but does not announce a crash the app recovers from itself', () => {
        // 壁纸模式下渲染进程崩溃会自动恢复（Linux 重启进程，Win/mac 就地 reload）。
        const contents = { getURL: () => 'x' };
        const isRendererCrashRecovered = vi.fn(() => true);
        withHandlers((_app, report) => {
            _app.emit('render-process-gone', {}, contents, gone('crashed'));
            expect(report).toHaveBeenCalledTimes(1);
            expect(report.mock.calls[0][2]).toEqual({ announceToUser: false });
            expect(report.mock.calls[0][1]).toContain('Recovered  true');
            expect(isRendererCrashRecovered).toHaveBeenCalledWith(gone('crashed'), contents);
        }, { isRendererCrashRecovered });
    });

    it('announces a renderer crash nothing is handling', () => {
        withHandlers((app, report) => {
            app.emit('render-process-gone', {}, { getURL: () => 'x' }, gone('killed'));
            expect(report.mock.calls[0][2]).toEqual({ announceToUser: true });
        });
    });

    it('stays quiet once a shutdown has started', () => {
        withHandlers((app, report) => {
            app.emit('before-quit');
            app.emit('render-process-gone', {}, { getURL: () => 'x' }, gone('killed'));
            expect(report.mock.calls[0][2]).toEqual({ announceToUser: false });
        });
    });

    it('never interrupts for a GPU or utility process Chromium will restart', () => {
        withHandlers((app, report) => {
            app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
            expect(report.mock.calls[0][2]).toEqual({ announceToUser: false });
        });
    });
});
