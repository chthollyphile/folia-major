import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import type { HifiRuntimeStatus } from '../../../src/types/hifi';

// 钉住 mpv 版本解析和排序、最低版本和 DoP 判断，以及检测顺序：手动路径 → 下载的运行时 → FOLIA_MPV_PATH → PATH → 常见位置。

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecFileFn = (file: string, args: string[], options: Record<string, unknown>, callback: ExecFileCallback) => void;

interface FakeFsp {
    constants: { X_OK: number };
    stat: (target: string) => Promise<{ isFile: () => boolean }>;
    access: (target: string, mode?: number) => Promise<void>;
}

type TimerFn = (callback: () => void, ms: number) => unknown;

interface RuntimeOptions {
    platform: string;
    arch: string;
    env?: Record<string, string>;
    fsp: FakeFsp;
    execFileFn: ExecFileFn;
    getUserDataPath: () => string;
    manifest?: unknown;
    homedir?: () => string;
    isInstalling?: () => boolean;
    systemVersion?: string | null;
    setTimeoutFn?: TimerFn;
    clearTimeoutFn?: (handle: unknown) => void;
    logInfo?: (...args: unknown[]) => void;
    logWarn?: (...args: unknown[]) => void;
}

interface MpvRuntime {
    detect: (options?: { manualPath?: string | null }) => Promise<HifiRuntimeStatus>;
    getCachedStatus: () => HifiRuntimeStatus | null;
    downloadedRuntimeDir: () => string;
}

const require = createRequire(import.meta.url);
const {
    CHECK_TIMEOUT_MS,
    MIN_MPV_VERSION,
    parseMpvVersion,
    compareMpvVersions,
    isSupportedMpvVersion,
    isDopCapable,
    createMpvRuntime,
} = require('../../../electron/hifi/mpvRuntime.cjs') as {
    CHECK_TIMEOUT_MS: number;
    MIN_MPV_VERSION: string;
    parseMpvVersion: (stdout: unknown) => { version: string; raw: string } | null;
    compareMpvVersions: (a: unknown, b: unknown) => number;
    isSupportedMpvVersion: (version: unknown) => boolean;
    isDopCapable: (platform: string, version: unknown) => boolean;
    createMpvRuntime: (options: RuntimeOptions) => MpvRuntime;
};

const VERSION_OUTPUT = 'mpv v0.41.0 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects\n built on Dec 21 2025\n';

type FileSpec = { executable?: boolean; directory?: boolean; hang?: boolean };

/** 只认 files 里列出的路径；executable 决定 X_OK，hang 的 stat 永远不回（断开的网络盘）。stats 记下每次 stat。 */
const createFakeFsp = (files: Record<string, FileSpec>): FakeFsp & { stats: string[] } => {
    const stats: string[] = [];
    return {
        stats,
        constants: { X_OK: 1 },
        stat: async (target) => {
            stats.push(target);
            const spec = files[target];
            if (spec?.hang) return new Promise(() => { });
            if (!spec) throw Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });
            return { isFile: () => !spec.directory };
        },
        access: async (target) => {
            if (!files[target]?.executable) throw Object.assign(new Error(`EACCES: ${target}`), { code: 'EACCES' });
        },
    };
};

/** outputs 里有的路径照着回 stdout，其余像找不到文件那样报错；calls 记下每次探测。 */
const createFakeExecFile = (outputs: Record<string, string>) => {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const execFileFn: ExecFileFn = (file, args, options, callback) => {
        calls.push({ file, args, options });
        if (file in outputs) callback(null, outputs[file], '');
        else callback(Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' }), '', '');
    };
    return { execFileFn, calls };
};

const silent = { logInfo: () => { }, logWarn: () => { } };

/** 等到 condition 成立；检测里每一步都是异步的，假的 execFile 回调要等它真被调到再触发。 */
const until = async (condition: () => boolean) => {
    for (let index = 0; index < 100 && !condition(); index += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(condition()).toBe(true);
};

const twoVersionManifest = {
    schema: 1,
    recommended: '0.41.0',
    versions: ['0.41.0', '0.40.0'].map(version => ({
        version,
        builds: {
            'darwin-arm64': {
                url: `https://example.test/mpv-${version}.zip`,
                bytes: 10,
                sha256: 'a'.repeat(64),
                archive: 'zip+tar.gz',
                tarball: 'mpv.tar.gz',
                executable: 'mpv.app/Contents/MacOS/mpv',
                minOsVersion: '14.0',
            },
            'win32-x64': {
                url: `https://example.test/mpv-${version}-win.zip`,
                bytes: 10,
                sha256: 'b'.repeat(64),
                archive: 'zip',
                executable: 'mpv.exe',
            },
        },
    })),
};

describe('parseMpvVersion', () => {
    it('reads release, git describe, dirty and official CI version lines', () => {
        expect(parseMpvVersion(VERSION_OUTPUT)).toEqual({
            version: '0.41.0',
            raw: 'mpv v0.41.0 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects',
        });
        expect(parseMpvVersion('mpv 0.41.0-123-gabcdef0 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects')?.version)
            .toBe('0.41.0-123-gabcdef0');
        expect(parseMpvVersion('mpv v0.40.0-dirty')?.version).toBe('0.40.0-dirty');
        // 官方 0.41.0 的 Windows / macOS 构建就是这样印的。
        expect(parseMpvVersion('mpv v0.41.0-dev-g41f6a6450 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects')?.version)
            .toBe('0.41.0-dev-g41f6a6450');
        expect(parseMpvVersion('\r\nmpv v0.39.0 Copyright\r\n')?.version).toBe('0.39.0');
    });

    it('returns null for anything that is not mpv', () => {
        for (const garbage of ['', 'ffmpeg version 8.1', 'mplayer 1.5', 'mpv', 'mpv vNext', 'hello\nmpv v0.41.0', null, undefined]) {
            expect(parseMpvVersion(garbage)).toBeNull();
        }
    });
});

describe('compareMpvVersions', () => {
    it('orders numerically and puts a git describe suffix after its base', () => {
        expect(compareMpvVersions('0.41.0', '0.40.0')).toBe(1);
        expect(compareMpvVersions('0.10.0', '0.9.9')).toBe(1);
        expect(compareMpvVersions('0.41.0-123-gabcdef0', '0.41.0')).toBe(1);
        expect(compareMpvVersions('0.41.0-123-gabcdef0', '0.41.0-124-g1234567')).toBe(-1);
        expect(compareMpvVersions('0.42.0', '0.41.0-500-gabcdef0')).toBe(1);
        expect(compareMpvVersions('v0.41.0', '0.41.0')).toBe(0);
    });

    it('treats -dev-g<hash> and -dirty as the base version', () => {
        // 官方 CI 构建 git describe 找不到标签时印 x.y.z-dev-g<hash>，说明不了比 x.y.z 新。
        expect(compareMpvVersions('0.41.0-dev-g41f6a6450', '0.41.0')).toBe(0);
        expect(compareMpvVersions('0.40.0-dirty', '0.40.0')).toBe(0);
    });

    it('sorts unreadable versions first', () => {
        expect(['0.41.0', 'garbage', '0.40.0-3-gabc1234', '0.40.0'].sort(compareMpvVersions))
            .toEqual(['garbage', '0.40.0', '0.40.0-3-gabc1234', '0.41.0']);
    });
});

describe('isDopCapable', () => {
    it('needs Windows and a build newer than 0.41.0', () => {
        expect(isDopCapable('win32', '0.41.0')).toBe(false);
        expect(isDopCapable('win32', '0.41.0-dev-g41f6a6450')).toBe(false);
        expect(isDopCapable('win32', '0.41.0-12-gabcdef0')).toBe(true);
        expect(isDopCapable('win32', '0.42.0')).toBe(true);
        expect(isDopCapable('darwin', '0.42.0')).toBe(false);
        expect(isDopCapable('linux', '0.42.0')).toBe(false);
        expect(isDopCapable('win32', 'garbage')).toBe(false);
    });
});

describe('isSupportedMpvVersion', () => {
    it('needs 0.39.0 or newer, counting the official -dev-g form as its base', () => {
        expect(MIN_MPV_VERSION).toBe('0.39.0');
        // Ubuntu 24.04 带 0.37.0：没有 --media-controls，也不认带位置的五元素 loadfile。
        expect(isSupportedMpvVersion(parseMpvVersion('mpv v0.37.0 Copyright © 2000-2023 mpv/MPlayer/mplayer2 projects')?.version)).toBe(false);
        // 0.38.0 认五元素 loadfile，但还没有 --media-controls。
        expect(isSupportedMpvVersion(parseMpvVersion('mpv v0.38.0 Copyright')?.version)).toBe(false);
        expect(isSupportedMpvVersion('0.38.0-512-gabcdef0')).toBe(false);
        expect(isSupportedMpvVersion(parseMpvVersion('mpv v0.39.0 Copyright')?.version)).toBe(true);
        expect(isSupportedMpvVersion('0.39.0-dirty')).toBe(true);
        expect(isSupportedMpvVersion(parseMpvVersion(VERSION_OUTPUT)?.version)).toBe(true);
        expect(isSupportedMpvVersion(parseMpvVersion('mpv v0.41.0-dev-g41f6a6450 Copyright')?.version)).toBe(true);
        expect(isSupportedMpvVersion('0.41.0-58-g1a2b3c4d5')).toBe(true);
        for (const garbage of ['garbage', '', null, undefined]) {
            expect(isSupportedMpvVersion(garbage)).toBe(false);
        }
    });
});

describe('createMpvRuntime detect', () => {
    const userData = '/Users/lia/Library/Application Support/Folia';
    const downloaded = `${userData}/hifi-runtime/mpv/0.41.0/mpv.app/Contents/MacOS/mpv`;
    const sources = {
        manual: '/opt/manual/mpv',
        downloaded,
        env: '/env/bin/mpv',
        path: '/path/bin/mpv',
        common: '/opt/homebrew/bin/mpv',
    };

    const darwinRuntime = (present: Array<keyof typeof sources>, extra: Partial<RuntimeOptions> = {}) => {
        const files: Record<string, FileSpec> = {};
        const outputs: Record<string, string> = {};
        for (const key of present) {
            files[sources[key]] = { executable: true };
            outputs[sources[key]] = VERSION_OUTPUT;
        }
        const exec = createFakeExecFile(outputs);
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: { FOLIA_MPV_PATH: sources.env, PATH: '/path/bin:/usr/bin' },
            fsp: createFakeFsp(files),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => userData,
            homedir: () => '/Users/lia',
            ...silent,
            ...extra,
        });
        return { runtime, calls: exec.calls };
    };

    it('takes manual over downloaded over env over PATH over common locations', async () => {
        const order: Array<[keyof typeof sources, string]> = [
            ['manual', 'manual'],
            ['downloaded', 'downloaded'],
            ['env', 'system'],
            ['path', 'system'],
            ['common', 'system'],
        ];
        for (let index = 0; index < order.length; index += 1) {
            const present = order.slice(index).map(([key]) => key);
            const { runtime } = darwinRuntime(present);
            const status = await runtime.detect({ manualPath: sources.manual });
            expect(status.path).toBe(sources[order[index][0]]);
            expect(status.source).toBe(order[index][1]);
            expect(status.available).toBe(true);
            expect(status.version).toBe('0.41.0');
        }
    });

    it('probes with --version, an 8 s timeout and a hidden window', async () => {
        const { runtime, calls } = darwinRuntime(['common']);
        await runtime.detect();
        expect(calls.at(-1)).toEqual({
            file: sources.common,
            args: ['--version'],
            options: { timeout: 8000, windowsHide: true },
        });
    });

    it('rejects an unusable manual path and keeps detecting', async () => {
        const { runtime: garbageRuntime } = darwinRuntime(['downloaded'], {});
        const cases = [
            'mpv', // 不是绝对路径
            '/missing/mpv', // 不存在
        ];
        for (const manualPath of cases) {
            const status = await garbageRuntime.detect({ manualPath });
            expect(status).toMatchObject({
                available: true,
                source: 'downloaded',
                path: sources.downloaded,
                manualPathRejected: true,
                errorCode: 'MPV_NOT_FOUND',
            });
        }

        // 存在、可执行，但 --version 印的不是 mpv。
        const exec = createFakeExecFile({ '/opt/not-mpv': 'ffmpeg version 8.1', [sources.downloaded]: VERSION_OUTPUT });
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp({ '/opt/not-mpv': { executable: true }, [sources.downloaded]: { executable: true } }),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => userData,
            ...silent,
        });
        const status = await runtime.detect({ manualPath: '/opt/not-mpv' });
        expect(status.manualPathRejected).toBe(true);
        expect(status.source).toBe('downloaded');

        // 一个目录也不行。
        const directoryRuntime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp({ '/Applications/mpv.app': { directory: true } }),
            execFileFn: createFakeExecFile({}).execFileFn,
            getUserDataPath: () => userData,
            ...silent,
        });
        const directoryStatus = await directoryRuntime.detect({ manualPath: '/Applications/mpv.app' });
        expect(directoryStatus.manualPathRejected).toBe(true);
        expect(directoryStatus.available).toBe(false);
    });

    it('accepts a good manual path without a rejection code', async () => {
        const { runtime } = darwinRuntime(['manual']);
        const status = await runtime.detect({ manualPath: `  ${sources.manual}  ` });
        expect(status).toMatchObject({ source: 'manual', manualPathRejected: false, errorCode: null });
    });

    it('skips a file without the execute bit on POSIX', async () => {
        const exec = createFakeExecFile({ [sources.common]: VERSION_OUTPUT });
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp({ [sources.common]: { executable: false } }),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => userData,
            ...silent,
        });
        expect((await runtime.detect()).available).toBe(false);
        expect(exec.calls).toHaveLength(0);
    });

    it('reports MPV_NOT_FOUND when nothing is there and caches the status', async () => {
        const { runtime } = darwinRuntime([]);
        expect(runtime.getCachedStatus()).toBeNull();
        const status = await runtime.detect();
        expect(status).toEqual({
            available: false,
            path: null,
            version: null,
            source: null,
            errorCode: 'MPV_NOT_FOUND',
            manualPathRejected: false,
            platform: 'darwin',
            arch: 'arm64',
            download: {
                supported: true,
                version: '0.41.0',
                installedVersion: null,
                updateAvailable: false,
                installing: false,
            },
            dopCapable: false,
        });
        expect(runtime.getCachedStatus()).toEqual(status);
        expect(runtime.downloadedRuntimeDir()).toBe(`${userData}/hifi-runtime/mpv`);
    });

    it('fills download info from the manifest, installed versions and the installer', async () => {
        const older = `${userData}/hifi-runtime/mpv/0.40.0/mpv.app/Contents/MacOS/mpv`;
        const exec = createFakeExecFile({ [older]: 'mpv v0.40.0 Copyright' });
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp({ [older]: { executable: true } }),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => userData,
            manifest: twoVersionManifest,
            isInstalling: () => true,
            ...silent,
        });
        const status = await runtime.detect();
        expect(status.source).toBe('downloaded');
        expect(status.version).toBe('0.40.0');
        expect(status.download).toEqual({
            supported: true,
            version: '0.41.0',
            installedVersion: '0.40.0',
            updateAvailable: true,
            installing: true,
        });
    });

    it('prefers the newest installed runtime and falls back when it does not run', async () => {
        const newer = `${userData}/hifi-runtime/mpv/0.41.0/mpv.app/Contents/MacOS/mpv`;
        const older = `${userData}/hifi-runtime/mpv/0.40.0/mpv.app/Contents/MacOS/mpv`;
        const files = { [newer]: { executable: true }, [older]: { executable: true } };
        const both = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp(files),
            execFileFn: createFakeExecFile({ [newer]: VERSION_OUTPUT, [older]: 'mpv v0.40.0' }).execFileFn,
            getUserDataPath: () => userData,
            manifest: twoVersionManifest,
            ...silent,
        });
        expect((await both.detect()).path).toBe(newer);

        const brokenNewest = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp(files),
            execFileFn: createFakeExecFile({ [older]: 'mpv v0.40.0' }).execFileFn,
            getUserDataPath: () => userData,
            manifest: twoVersionManifest,
            ...silent,
        });
        const status = await brokenNewest.detect();
        expect(status.path).toBe(older);
        // 0.41.0 的文件在，但起不来：不算装好，界面才会提供重新下载。
        expect(status.download.installedVersion).toBe('0.40.0');
        expect(status.download.updateAvailable).toBe(true);
    });

    it('reports no installed version when the only download does not run', async () => {
        const broken = `${userData}/hifi-runtime/mpv/0.41.0/mpv.app/Contents/MacOS/mpv`;
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp({ [broken]: { executable: true }, [sources.common]: { executable: true } }),
            execFileFn: createFakeExecFile({ [sources.common]: VERSION_OUTPUT }).execFileFn,
            getUserDataPath: () => userData,
            ...silent,
        });
        const status = await runtime.detect();
        expect(status).toMatchObject({ available: true, source: 'system', path: sources.common });
        expect(status.download).toMatchObject({ installedVersion: null, updateAvailable: false, supported: true });
    });

    it('probes a download once per detect, and still probes it when a manual path wins', async () => {
        const installedPath = `${userData}/hifi-runtime/mpv/0.41.0/mpv.app/Contents/MacOS/mpv`;
        const files = { [installedPath]: { executable: true }, [sources.manual]: { executable: true } };
        const exec = createFakeExecFile({ [installedPath]: VERSION_OUTPUT, [sources.manual]: VERSION_OUTPUT });
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp(files),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => userData,
            ...silent,
        });
        const plain = await runtime.detect();
        expect(plain).toMatchObject({ source: 'downloaded', download: { installedVersion: '0.41.0' } });
        expect(exec.calls.map(call => call.file)).toEqual([installedPath]);

        exec.calls.length = 0;
        const manual = await runtime.detect({ manualPath: sources.manual });
        expect(manual).toMatchObject({ source: 'manual', download: { installedVersion: '0.41.0' } });
        expect(exec.calls.map(call => call.file)).toEqual([sources.manual, installedPath]);
    });

    it('skips an mpv older than 0.39.0 and keeps looking', async () => {
        const exec = createFakeExecFile({
            '/path/bin/mpv': 'mpv v0.38.0 Copyright',
            '/usr/bin/mpv': 'mpv v0.41.0-dev-g41f6a6450 Copyright',
        });
        const runtime = createMpvRuntime({
            platform: 'linux',
            arch: 'x64',
            env: { PATH: '/path/bin' },
            fsp: createFakeFsp({ '/path/bin/mpv': { executable: true }, '/usr/bin/mpv': { executable: true } }),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => '/home/lia/.config/Folia',
            ...silent,
        });
        const status = await runtime.detect();
        expect(status).toMatchObject({
            available: true,
            path: '/usr/bin/mpv',
            version: '0.41.0-dev-g41f6a6450',
            source: 'system',
            errorCode: null,
        });
    });

    it('names the too-old mpv when it is the only one', async () => {
        for (const version of ['0.37.0', '0.38.0']) {
            const runtime = createMpvRuntime({
                platform: 'linux',
                arch: 'x64',
                env: { PATH: '/usr/bin' },
                fsp: createFakeFsp({ '/usr/bin/mpv': { executable: true } }),
                execFileFn: createFakeExecFile({ '/usr/bin/mpv': `mpv v${version} Copyright` }).execFileFn,
                getUserDataPath: () => '/home/lia/.config/Folia',
                ...silent,
            });
            const status = await runtime.detect();
            expect(status).toMatchObject({
                available: false,
                path: '/usr/bin/mpv',
                version,
                source: 'system',
                errorCode: 'MPV_TOO_OLD',
                manualPathRejected: false,
                dopCapable: false,
            });
        }

        const current = createMpvRuntime({
            platform: 'linux',
            arch: 'x64',
            env: { PATH: '/usr/bin' },
            fsp: createFakeFsp({ '/usr/bin/mpv': { executable: true } }),
            execFileFn: createFakeExecFile({ '/usr/bin/mpv': 'mpv v0.39.0 Copyright' }).execFileFn,
            getUserDataPath: () => '/home/lia/.config/Folia',
            ...silent,
        });
        expect(await current.detect()).toMatchObject({ available: true, version: '0.39.0', errorCode: null });
    });

    it('rejects a too-old manual mpv with MPV_TOO_OLD, with or without a fallback', async () => {
        const oldManual = '/opt/old/mpv';
        const withFallback = createMpvRuntime({
            platform: 'linux',
            arch: 'x64',
            env: {},
            fsp: createFakeFsp({ [oldManual]: { executable: true }, '/usr/bin/mpv': { executable: true } }),
            execFileFn: createFakeExecFile({ [oldManual]: 'mpv v0.37.0', '/usr/bin/mpv': VERSION_OUTPUT }).execFileFn,
            getUserDataPath: () => '/home/lia/.config/Folia',
            ...silent,
        });
        expect(await withFallback.detect({ manualPath: oldManual })).toMatchObject({
            available: true,
            path: '/usr/bin/mpv',
            version: '0.41.0',
            manualPathRejected: true,
            errorCode: 'MPV_TOO_OLD',
        });

        const alone = createMpvRuntime({
            platform: 'linux',
            arch: 'x64',
            env: {},
            fsp: createFakeFsp({ [oldManual]: { executable: true } }),
            execFileFn: createFakeExecFile({ [oldManual]: 'mpv v0.37.0' }).execFileFn,
            getUserDataPath: () => '/home/lia/.config/Folia',
            ...silent,
        });
        expect(await alone.detect({ manualPath: oldManual })).toMatchObject({
            available: false,
            path: oldManual,
            version: '0.37.0',
            source: 'manual',
            manualPathRejected: true,
            errorCode: 'MPV_TOO_OLD',
        });
    });

    it('gives up on a path whose stat hangs and does not pile up more stats on it', async () => {
        const hung = '/net/bin/mpv';
        const fsp = createFakeFsp({ [hung]: { hang: true }, '/usr/bin/mpv': { executable: true } });
        const delays: number[] = [];
        // 只把 2 s 的检查超时换成立刻到；其余计时照旧。
        const setTimeoutFn: TimerFn = (callback, ms) => {
            delays.push(ms);
            return setTimeout(callback, ms === CHECK_TIMEOUT_MS ? 0 : ms);
        };
        const runtime = createMpvRuntime({
            platform: 'linux',
            arch: 'x64',
            env: { PATH: '/net/bin' },
            fsp,
            execFileFn: createFakeExecFile({ '/usr/bin/mpv': VERSION_OUTPUT }).execFileFn,
            getUserDataPath: () => '/home/lia/.config/Folia',
            setTimeoutFn,
            clearTimeoutFn: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
            ...silent,
        });
        expect(await runtime.detect()).toMatchObject({ available: true, path: '/usr/bin/mpv' });
        expect(delays).toContain(CHECK_TIMEOUT_MS);
        await runtime.detect();
        expect(fsp.stats.filter(target => target === hung)).toHaveLength(1);
    });

    it('serves the live installing flag from the cached status', async () => {
        let installing = false;
        const { runtime } = darwinRuntime([], { isInstalling: () => installing });
        await runtime.detect();
        expect(runtime.getCachedStatus()?.download.installing).toBe(false);
        installing = true;
        expect(runtime.getCachedStatus()?.download.installing).toBe(true);
        expect(runtime.getCachedStatus()?.errorCode).toBe('MPV_NOT_FOUND');
    });

    it('says Linux has no download and an old macOS cannot take the build', async () => {
        const linux = createMpvRuntime({
            platform: 'linux',
            arch: 'x64',
            env: { PATH: '/usr/bin' },
            fsp: createFakeFsp({ '/usr/bin/mpv': { executable: true } }),
            execFileFn: createFakeExecFile({ '/usr/bin/mpv': VERSION_OUTPUT }).execFileFn,
            getUserDataPath: () => '/home/lia/.config/Folia',
            ...silent,
        });
        const linuxStatus = await linux.detect();
        expect(linuxStatus).toMatchObject({ available: true, path: '/usr/bin/mpv', source: 'system', dopCapable: false });
        expect(linuxStatus.download).toMatchObject({ supported: false, version: null, updateAvailable: false });

        const oldIntel = createMpvRuntime({
            platform: 'darwin',
            arch: 'x64',
            env: {},
            fsp: createFakeFsp({}),
            execFileFn: createFakeExecFile({}).execFileFn,
            getUserDataPath: () => userData,
            systemVersion: '13.6.1',
            ...silent,
        });
        expect((await oldIntel.detect()).download.supported).toBe(false);
    });

    it('scans Path case-insensitively on Windows and knows scoop and the DoP threshold', async () => {
        const shim = 'C:\\Users\\lia\\scoop\\shims\\mpv.exe';
        const fromPath = 'D:\\tools\\mpv\\mpv.exe';
        const exec = createFakeExecFile({ [fromPath]: 'mpv v0.41.0-58-g1a2b3c4d5 Copyright', [shim]: VERSION_OUTPUT });
        const runtime = createMpvRuntime({
            platform: 'win32',
            arch: 'x64',
            env: { Path: 'C:\\Windows\\System32;"D:\\tools\\mpv"' },
            fsp: createFakeFsp({ [fromPath]: {}, [shim]: {} }),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => 'C:\\Users\\lia\\AppData\\Roaming\\Folia',
            homedir: () => 'C:\\Users\\lia',
            ...silent,
        });
        const status = await runtime.detect();
        expect(status).toMatchObject({ path: fromPath, version: '0.41.0-58-g1a2b3c4d5', dopCapable: true });

        const shimOnly = createMpvRuntime({
            platform: 'win32',
            arch: 'x64',
            env: {},
            fsp: createFakeFsp({ [shim]: {} }),
            execFileFn: exec.execFileFn,
            getUserDataPath: () => 'C:\\Users\\lia\\AppData\\Roaming\\Folia',
            homedir: () => 'C:\\Users\\lia',
            ...silent,
        });
        const shimStatus = await shimOnly.detect({ manualPath: 'C:\\missing\\mpv.exe' });
        expect(shimStatus).toMatchObject({ path: shim, dopCapable: false, manualPathRejected: true });
        expect(shimStatus.download).toMatchObject({ supported: true, version: '0.41.0' });
    });

    it('asks mpv.com for the version when mpv.exe prints nothing, and keeps mpv.exe as the path', async () => {
        const exe = 'D:\\tools\\mpv\\mpv.exe';
        const com = 'D:\\tools\\mpv\\mpv.com';
        const windows = (files: Record<string, FileSpec>, outputs: Record<string, string>) => {
            const exec = createFakeExecFile(outputs);
            const runtime = createMpvRuntime({
                platform: 'win32',
                arch: 'x64',
                env: { Path: 'D:\\tools\\mpv' },
                fsp: createFakeFsp(files),
                execFileFn: exec.execFileFn,
                getUserDataPath: () => 'C:\\Users\\lia\\AppData\\Roaming\\Folia',
                homedir: () => 'C:\\Users\\lia',
                ...silent,
            });
            return { runtime, calls: exec.calls };
        };

        // GUI 子系统的 mpv.exe 往管道里什么都没写。
        const silentExe = windows({ [exe]: {}, [com]: {} }, { [exe]: '', [com]: 'mpv v0.41.0-dev-g41f6a6450 Copyright' });
        expect(await silentExe.runtime.detect()).toMatchObject({
            available: true,
            path: exe,
            version: '0.41.0-dev-g41f6a6450',
        });
        expect(silentExe.calls.map(call => call.file)).toEqual([exe, com]);
        expect(silentExe.calls[1]).toMatchObject({ args: ['--version'], options: { timeout: 8000, windowsHide: true } });

        // 能直接读到版本时不再问 mpv.com。
        const talkingExe = windows({ [exe]: {}, [com]: {} }, { [exe]: VERSION_OUTPUT, [com]: VERSION_OUTPUT });
        await talkingExe.runtime.detect();
        expect(talkingExe.calls.map(call => call.file)).toEqual([exe]);

        // 旁边没有 mpv.com：这个 mpv.exe 不算。
        const noWrapper = windows({ [exe]: {} }, { [exe]: '', [com]: VERSION_OUTPUT });
        expect(await noWrapper.runtime.detect()).toMatchObject({ available: false, errorCode: 'MPV_NOT_FOUND' });
        expect(noWrapper.calls.map(call => call.file)).toEqual([exe]);
    });

    it('keeps the status of the detect that started last', async () => {
        const pending: Array<() => void> = [];
        const execFileFn: ExecFileFn = (_file, _args, _options, callback) => {
            pending.push(() => callback(null, VERSION_OUTPUT, ''));
        };
        const runtime = createMpvRuntime({
            platform: 'darwin',
            arch: 'arm64',
            env: {},
            fsp: createFakeFsp({ '/first/mpv': { executable: true }, '/second/mpv': { executable: true } }),
            execFileFn,
            getUserDataPath: () => userData,
            ...silent,
        });
        const first = runtime.detect({ manualPath: '/first/mpv' });
        const second = runtime.detect({ manualPath: '/second/mpv' });
        await until(() => pending.length === 2);
        pending[1]();
        await second;
        pending[0]();
        await first;
        expect(runtime.getCachedStatus()?.path).toBe('/second/mpv');
    });
});
