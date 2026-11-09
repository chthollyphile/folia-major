import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// 钉住 main.cjs 里 HiFi 跟着窗口走的几处：主页面一去不回（窗口关了、页面进程没了又不重载）时停下 mpv，
// 窗口重建时不停（新页面接手）；启动后清一次下载残留，只在拿到单实例锁的那个实例里清；PipeWire 探测器拿到的
// 自家进程号是主进程加 app.getAppMetrics() 列出的全部，并交给 HiFi 的 IPC。
//
// main.cjs 不能 require（会把整个应用拉起来）。两个窗口事件的处理函数从源码里原样取出来，把它用到的名字
// 当参数传进去执行，测的是产品代码本身的分支；处理函数新用了一个名字时这里会报 ReferenceError，照样补上。

const rootDir = path.resolve(__dirname, '../../../');
const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');

type Deps = Record<string, unknown>;

// 把一段处理函数的函数体按给定的名字包成可调用的函数。
const compileHandler = (body: string, names: string[], params: string) => (deps: Deps) => {
    for (const name of names) {
        if (!(name in deps)) throw new Error(`test is missing ${name}`);
    }
    const factory = new Function(...names, `return (${params}) => {\n${body}\n};`);
    return factory(...names.map(name => deps[name])) as (...args: unknown[]) => void;
};

const renderGoneBody = mainCjs.match(/win\.webContents\.on\('render-process-gone', \(_event, details\) => \{\n([\s\S]*?)\n {2}\}\);\n/)?.[1] ?? '';
const closedBody = mainCjs.match(/win\.on\('closed', \(\) => \{\n( {4}if \(mainWindow === win\) \{[\s\S]*?\n {4}\}\n) {2}\}\);/)?.[1] ?? '';

const RENDER_GONE_NAMES = [
    'win',
    'mainWindow',
    'noteWindowNotStuck',
    'modSystem',
    'wallpaperWatchdog',
    'shouldReloadMainRenderer',
    'useWindowsWallpaper',
    'process',
    'isMacWallpaperMode',
    'hifiSession',
];

const CLOSED_NAMES = [
    'win',
    'mainWindow',
    'process',
    'modSystem',
    'isMacWallpaperActive',
    'exitMacWallpaperMode',
    'displaySleepBlocker',
    'hifiSession',
    'mainWindowClickThroughUnlockHover',
    'stopMainWindowClickThroughUnlockHoverMonitor',
    'remoteControlWindow',
    'ytmSandbox',
    'refreshTrayMenu',
];

const createWin = () => ({
    __reopeningWithoutMods: false,
    __rendererCrashReloads: [] as number[],
    isDestroyed: () => false,
    webContents: { reload: vi.fn() },
});

describe('main.cjs: mpv stops when the page driving it is gone for good', () => {
    it('finds both handlers in main.cjs', () => {
        expect(renderGoneBody, 'render-process-gone handler').toContain('shouldReloadMainRenderer(win, details)');
        expect(closedBody, 'closed handler of the main window').toContain('mainWindow = null;');
    });

    const renderGone = (overrides: Deps = {}) => {
        const win = createWin();
        const hifiSession = { stop: vi.fn(async () => {}) };
        const deps: Deps = {
            win,
            mainWindow: win,
            noteWindowNotStuck: () => {},
            modSystem: null,
            wallpaperWatchdog: { handleRendererGone: () => false },
            shouldReloadMainRenderer: () => false,
            useWindowsWallpaper: false,
            process: { platform: 'linux' },
            isMacWallpaperMode: () => false,
            hifiSession,
            ...overrides,
        };
        const handler = compileHandler(renderGoneBody, RENDER_GONE_NAMES, '_event, details');
        return { run: (details: Deps) => handler(deps)(null, details), win: deps.win as ReturnType<typeof createWin>, hifiSession };
    };

    it('render-process-gone: stops mpv when the main page is not loaded again (killed, oom, crashed past the reload limit)', () => {
        for (const reason of ['killed', 'oom', 'crashed', 'launch-failed']) {
            const { run, hifiSession, win } = renderGone();
            run({ reason });
            expect(hifiSession.stop, reason).toHaveBeenCalledTimes(1);
            expect(win.webContents.reload, reason).not.toHaveBeenCalled();
        }
    });

    it('render-process-gone: leaves mpv alone when the page is reloaded (the new page adopts it) or is not the main one', () => {
        const reloaded = renderGone({ shouldReloadMainRenderer: () => true });
        reloaded.run({ reason: 'crashed' });
        expect(reloaded.win.webContents.reload).toHaveBeenCalledTimes(1);
        expect(reloaded.hifiSession.stop).not.toHaveBeenCalled();

        const windowsWallpaper = renderGone({ useWindowsWallpaper: true });
        windowsWallpaper.run({ reason: 'crashed' });
        expect(windowsWallpaper.win.webContents.reload).toHaveBeenCalledTimes(1);
        expect(windowsWallpaper.hifiSession.stop).not.toHaveBeenCalled();

        const reopening = renderGone();
        reopening.win.__reopeningWithoutMods = true;
        reopening.run({ reason: 'killed' });
        expect(reopening.hifiSession.stop).not.toHaveBeenCalled();

        const otherWindow = renderGone({ mainWindow: createWin() });
        otherWindow.run({ reason: 'killed' });
        expect(otherWindow.hifiSession.stop).not.toHaveBeenCalled();
    });

    const closed = (overrides: Deps = {}) => {
        const win = createWin();
        const hifiSession = { stop: vi.fn(async () => {}) };
        const deps: Deps = {
            win,
            mainWindow: win,
            process: { platform: 'darwin' },
            modSystem: null,
            isMacWallpaperActive: false,
            exitMacWallpaperMode: () => {},
            displaySleepBlocker: { stop: () => {} },
            hifiSession,
            mainWindowClickThroughUnlockHover: false,
            stopMainWindowClickThroughUnlockHoverMonitor: () => {},
            remoteControlWindow: null,
            ytmSandbox: { destroy: () => {} },
            refreshTrayMenu: () => {},
            ...overrides,
        };
        const handler = compileHandler(closedBody, CLOSED_NAMES, '');
        return { run: () => handler(deps)(), hifiSession };
    };

    it('closed: the main window closing for good stops mpv (macOS keeps the app running)', () => {
        const { run, hifiSession } = closed();
        run();
        expect(hifiSession.stop).toHaveBeenCalledTimes(1);
    });

    it('closed: the old window of a rebuild does not stop mpv, since mainWindow already points at the new one', () => {
        const { run, hifiSession } = closed({ mainWindow: createWin() });
        run();
        expect(hifiSession.stop).not.toHaveBeenCalled();

        // That holds because every rebuild replaces mainWindow before the old window is destroyed.
        const rebuild = mainCjs.match(/function recreateMainWindowWithTransparencyMode\([\s\S]*?\n\}\n/)?.[0] ?? '';
        expect(rebuild).not.toBe('');
        const cleared = rebuild.indexOf('mainWindow = null;');
        const destroys = [...rebuild.matchAll(/previousWindow\.destroy\(\)/g)].map(match => match.index ?? -1);
        expect(cleared).toBeGreaterThan(-1);
        expect(destroys.length).toBeGreaterThan(0);
        for (const at of destroys) expect(at).toBeGreaterThan(cleared);
    });
});

describe('main.cjs: leftover mpv downloads', () => {
    // 应用启动的那个 ready 处理函数：先等单实例锁的结果，重复启动的实例在这里 quit。
    const readyHandler = mainCjs.match(/app\.whenReady\(\)\.then\(async \(\) => \{\n([\s\S]*?)\n\}\);\n/)?.[1] ?? '';

    it('sweeps them once after app ready, and logs a failure instead of throwing', () => {
        expect(readyHandler, 'the startup ready handler').toContain('const startupResult = await mainProcessStartupPromise;');
        const site = readyHandler.match(/hifiInstaller\.pruneLeftovers\(\)\n\s*\.catch\(error => console\.warn\('\[HiFi\] [^']*', error\)\);/);
        expect(site, 'no startup sweep of leftover mpv downloads').not.toBeNull();
        expect(mainCjs.match(/pruneLeftovers\(/g), 'the sweep runs from one place only').toHaveLength(1);
    });

    it('only the instance holding the single-instance lock sweeps: a second launch on its way out must not delete a running download', () => {
        const sweepAt = readyHandler.indexOf('hifiInstaller.pruneLeftovers()');
        const duplicateAt = readyHandler.search(/if \(startupResult === 'duplicate'\) \{\n\s*app\.quit\(\);\n\s*return;\n\s*\}/);
        const spawnedAt = readyHandler.search(/if \(startupResult === 'spawned'\) \{\n\s*return;\n\s*\}/);
        expect(duplicateAt).toBeGreaterThan(-1);
        expect(spawnedAt).toBeGreaterThan(-1);
        expect(sweepAt).toBeGreaterThan(duplicateAt);
        expect(sweepAt).toBeGreaterThan(spawnedAt);
        // 不在 ready 之外另挂一次（那一次重复启动的实例也会跑）。
        expect(mainCjs).not.toMatch(/app\.whenReady\(\)\s*\.then\(\(\) => hifiInstaller\.pruneLeftovers/);
    });
});

describe('main.cjs: the PipeWire output probe', () => {
    const require = createRequire(import.meta.url);
    const { collectOwnPids } = require(path.join(rootDir, 'electron/hifi/pipewireProbe.cjs')) as {
        collectOwnPids: (mainPid: unknown, appMetrics: unknown) => number[];
    };
    const site = mainCjs.match(/const hifiOutputProbe = (createPipewireProbe\(\{\n[\s\S]*?\n\}\));\n/)?.[1] ?? '';

    it('marks streams of main and every Electron child process as Folia\'s own', () => {
        expect(site, 'no createPipewireProbe call').not.toBe('');
        expect(mainCjs).toContain("const { createPipewireProbe, collectOwnPids } = require('./hifi/pipewireProbe.cjs');");
        let options: { getOwnPids?: () => number[] } = {};
        const createPipewireProbe = (received: typeof options) => {
            options = received;
            return { probe: async () => null };
        };
        const appMetrics = [{ pid: 4000, type: 'Browser' }, { pid: 4001, type: 'GPU' }, { pid: 4002, type: 'Utility', serviceName: 'audio.mojom.AudioService' }];
        const app = { getAppMetrics: vi.fn(() => appMetrics) };
        new Function('createPipewireProbe', 'collectOwnPids', 'process', 'app', `return ${site};`)(
            createPipewireProbe,
            collectOwnPids,
            { pid: 4000 },
            app,
        );
        // 进程会来会走：每次探测时再列，不在启动时拍一张。
        expect(app.getAppMetrics).not.toHaveBeenCalled();
        expect(options.getOwnPids?.()).toEqual([4000, 4001, 4002]);
        expect(app.getAppMetrics).toHaveBeenCalledTimes(1);
    });

    it('hands the probe to the HiFi IPC', () => {
        const register = mainCjs.match(/registerHifiIpc\(\{[\s\S]*?\n\}\);/)?.[0] ?? '';
        expect(register).toContain('outputProbe: hifiOutputProbe,');
        expect(mainCjs.indexOf('const hifiOutputProbe = createPipewireProbe(')).toBeLessThan(mainCjs.indexOf('hifiIpc = registerHifiIpc({'));
    });
});
