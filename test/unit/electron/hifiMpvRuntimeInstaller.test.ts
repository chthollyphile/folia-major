import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HifiErrorCode, HifiInstallProgress } from '../../../src/types/hifi';

// 钉住 mpv 运行时安装：用 fflate 现做的 zip 走一遍下载、校验、解压、改名、探测、清旧版本和遗留文件，以及校验失败、
// 取消、Windows 上改名重试、macOS 的 ditto。

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;
type ExecFileFn = (file: string, args: string[], options: Record<string, unknown>, callback: ExecFileCallback) => void;
type FetchFn = (url: string, init: { redirect: string; signal: AbortSignal }) => Promise<Response>;
type UnzipFn = (
    data: Uint8Array,
    options: { filter: (file: { name: string }) => boolean },
    callback: (error: Error | null, entries: Record<string, Uint8Array> | null) => void,
) => () => void;

interface InstallerOptions {
    manifest: unknown;
    platform: string;
    arch: string;
    getUserDataPath: () => string;
    fetchFn: FetchFn;
    fsp?: unknown;
    unzipFn?: UnzipFn;
    execFileFn?: ExecFileFn;
    onProgress?: (progress: HifiInstallProgress) => void;
    now?: () => number;
    setTimeoutFn?: (callback: () => void, ms: number) => unknown;
    systemVersion?: string | null;
    logInfo?: (...args: unknown[]) => void;
    logWarn?: (...args: unknown[]) => void;
}

interface InstallResult {
    ok: boolean;
    errorCode: HifiErrorCode | null;
    version: string | null;
    executablePath: string | null;
}

interface MpvRuntimeInstaller {
    install: () => Promise<InstallResult>;
    cancel: () => Promise<InstallResult | null>;
    isInstalling: () => boolean;
    listInstalled: () => Promise<string[]>;
    pruneLeftovers: () => Promise<void>;
}

const require = createRequire(import.meta.url);
const {
    createMpvRuntimeInstaller,
    safeEntrySegments,
    downloadSourcesFor,
    FAILOVER_STALL_TIMEOUT_MS,
    FAILOVER_SLOW_AFTER_MS,
} = require('../../../electron/hifi/mpvRuntimeInstaller.cjs') as {
    createMpvRuntimeInstaller: (options: InstallerOptions) => MpvRuntimeInstaller;
    safeEntrySegments: (name: unknown) => string[] | null | undefined;
    downloadSourcesFor: (manifest: unknown, build: { url: string }) => string[];
    FAILOVER_STALL_TIMEOUT_MS: number;
    FAILOVER_SLOW_AFTER_MS: number;
};

const ASSET_URL = 'https://github.example.test/mpv-player/mpv/releases/download/v0.41.0/mpv-test-win.zip';
// 随机字节压不小，zip 才会分成几十块下载。
const MPV_EXE = new Uint8Array(randomBytes(200_000));
const silent = { logInfo: () => { }, logWarn: () => { } };

const PROBE_OUTPUT = 'mpv v0.41.0-dev-g41f6a6450 Copyright © 2000-2025 mpv/MPlayer/mplayer2 projects\n';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** 等到 condition 成立（下载、写盘都是真的异步）。 */
const until = async (condition: () => boolean) => {
    for (let index = 0; index < 200 && !condition(); index += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
};

/** 重试的退避（≤ 1 s）立刻到；2 s 的检查超时和 45 s 的响应超时照旧。 */
const fastRetrySetTimeout = (callback: () => void, ms: number) => setTimeout(callback, ms <= 1000 ? 0 : ms);

/**
 * 假的 execFile：`--version` 时，文件真在磁盘上且 runs(file) 为真就印版本号，否则像起不来那样报错；
 * 别的命令（ditto、tar）交给 other。calls 记下每次调用。
 */
const createProbeExec = ({ runs = () => true, other }: { runs?: (file: string) => boolean; other?: ExecFileFn } = {}) => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const execFileFn: ExecFileFn = (file, args, options, callback) => {
        calls.push({ file, args });
        if (args[0] === '--version') {
            if (fs.existsSync(file) && runs(file)) callback(null, PROBE_OUTPUT, '');
            else callback(Object.assign(new Error(`spawn ${file} UNKNOWN`), { code: 'UNKNOWN' }), '', '');
            return;
        }
        if (other) other(file, args, options, callback);
        else callback(new Error(`unexpected ${file}`));
    };
    return { execFileFn, calls };
};

/** 真正的 mpv.exe 是解出来的那 200 000 字节；别的（手写的坏文件）一律起不来。 */
const runsOnlyRealExe = (file: string) => file.endsWith('mpv.exe') && fs.statSync(file).size === MPV_EXE.byteLength;

const windowsZip = (extra: Record<string, Uint8Array> = {}) => zipSync({
    'mpv.exe': MPV_EXE,
    'mpv.com': new TextEncoder().encode('console wrapper'),
    'mpv.pdb': new Uint8Array(4096).fill(7),
    'doc/readme.txt': new TextEncoder().encode('hello'),
    ...extra,
});

const manifestFor = (key: string, build: Record<string, unknown>) => ({
    schema: 1,
    recommended: '0.41.0',
    versions: [{ version: '0.41.0', builds: { [key]: build } }],
});

const windowsManifest = (zip: Uint8Array, overrides: Record<string, unknown> = {}) => manifestFor('win32-x64', {
    url: ASSET_URL,
    bytes: zip.byteLength,
    sha256: sha256(zip),
    archive: 'zip',
    executable: 'mpv.exe',
    ...overrides,
});

type StreamOptions = { chunkSize?: number; stallAfter?: number; onCancel?: () => void };

/** 把 bytes 分成小块慢慢给；stallAfter 块之后就不再给，也不结束（模拟卡住的下载）。onCancel 在流被取消时调用。 */
const streamOf = (bytes: Uint8Array, { chunkSize = 8192, stallAfter = Infinity, onCancel }: StreamOptions = {}) => {
    let offset = 0;
    let served = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (served >= stallAfter) return new Promise<void>(() => { });
            if (offset >= bytes.byteLength) {
                controller.close();
                return undefined;
            }
            controller.enqueue(bytes.slice(offset, offset + chunkSize));
            offset += chunkSize;
            served += 1;
            return undefined;
        },
        cancel() {
            onCancel?.();
        },
    });
};

const createFakeFetch = (bytes: Uint8Array, options: StreamOptions & { status?: number } = {}) => {
    const calls: Array<{ url: string; init: { redirect: string; signal: AbortSignal } }> = [];
    const fetchFn: FetchFn = async (url, init) => {
        calls.push({ url, init });
        if (options.status && options.status !== 200) return new Response('nope', { status: options.status });
        return new Response(streamOf(bytes, options), {
            headers: { 'content-length': String(bytes.byteLength) },
        });
    };
    return { fetchFn, calls };
};

/** 按地址给不同响应的假 fetch：routes[url] 每次被请求时调用；没登记的地址当作连不上。 */
const createRoutedFetch = (routes: Record<string, () => Response>) => {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url, init) => {
        calls.push(url);
        if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
        const route = routes[url];
        if (!route) throw new TypeError(`fetch failed: ${url}`);
        return route();
    };
    return { fetchFn, calls };
};

const MIRROR_URL = `https://gh-proxy.example.test/${ASSET_URL}`;
const mirrored = (manifest: Record<string, unknown>) => ({ ...manifest, mirrors: ['https://gh-proxy.example.test/{url}'] });
const zipResponse = (bytes: Uint8Array, options: StreamOptions = {}) => () => new Response(streamOf(bytes, options));

const errnoError = (code: string, target: string) => Object.assign(new Error(`${code}: ${target}`), { code });

describe('safeEntrySegments', () => {
    it('splits plain names, skips directories and refuses traversal', () => {
        expect(safeEntrySegments('mpv.exe')).toEqual(['mpv.exe']);
        expect(safeEntrySegments('./doc//readme.txt')).toEqual(['doc', 'readme.txt']);
        expect(safeEntrySegments('doc/')).toBeNull();
        for (const unsafe of ['../evil.dll', 'doc/../../evil.dll', '/etc/passwd', 'C:/Windows/evil.dll', 'a\\..\\b', 'mpv.exe:stream', 42]) {
            expect(safeEntrySegments(unsafe)).toBeUndefined();
        }
    });
});

describe('downloadSourcesFor', () => {
    it('tries the original address first, then each https mirror template, without repeats', () => {
        const manifest = {
            mirrors: [
                'https://gh-proxy.example.test/{url}',
                'http://insecure.example.test/{url}',
                'https://no-placeholder.example.test/',
                'https://gh-proxy.example.test/{url}',
                '{url}',
                42,
            ],
        };
        expect(downloadSourcesFor(manifest, { url: ASSET_URL })).toEqual([ASSET_URL, MIRROR_URL]);
        expect(downloadSourcesFor({}, { url: ASSET_URL })).toEqual([ASSET_URL]);
    });
});

describe('createMpvRuntimeInstaller', () => {
    let userData = '';
    let root = '';

    beforeEach(async () => {
        userData = await fsp.mkdtemp(path.join(os.tmpdir(), 'folia-hifi-install-'));
        root = path.join(userData, 'hifi-runtime', 'mpv');
    });

    afterEach(async () => {
        await fsp.rm(userData, { recursive: true, force: true });
    });

    const windowsInstaller = (manifest: unknown, fetchFn: FetchFn, extra: Partial<InstallerOptions> = {}) => {
        const progress: HifiInstallProgress[] = [];
        const installer = createMpvRuntimeInstaller({
            manifest,
            platform: 'win32',
            arch: 'x64',
            getUserDataPath: () => userData,
            fetchFn,
            onProgress: event => progress.push(event),
            now: () => 0,
            execFileFn: createProbeExec().execFileFn,
            ...silent,
            ...extra,
        });
        return { installer, progress };
    };

    const leftovers = async () => (await fsp.readdir(root).catch(() => [] as string[])).sort();
    const zipName = 'mpv-test-win.zip';

    it('downloads, verifies, extracts and moves the runtime into place', async () => {
        const zip = windowsZip();
        const fetch = createFakeFetch(zip);
        const { installer, progress } = windowsInstaller(windowsManifest(zip), fetch.fetchFn);

        const pending = installer.install();
        expect(installer.isInstalling()).toBe(true);
        expect(installer.install()).toBe(pending);
        const result = await pending;

        const executablePath = path.join(root, '0.41.0', 'mpv.exe');
        expect(result).toEqual({ ok: true, errorCode: null, version: '0.41.0', executablePath });
        expect(new Uint8Array(await fsp.readFile(executablePath))).toEqual(MPV_EXE);
        expect(await fsp.readFile(path.join(root, '0.41.0', 'doc', 'readme.txt'), 'utf8')).toBe('hello');
        // 调试符号不解出来。
        expect(fs.existsSync(path.join(root, '0.41.0', 'mpv.pdb'))).toBe(false);
        // .part、zip 和 .tmp 都不留。
        expect(await leftovers()).toEqual(['0.41.0']);
        expect(installer.isInstalling()).toBe(false);
        expect(await installer.listInstalled()).toEqual(['0.41.0']);
        expect(fetch.calls).toHaveLength(1);
        expect(fetch.calls[0].url).toBe(ASSET_URL);
        expect(fetch.calls[0].init.redirect).toBe('follow');

        // 时钟不动时下载阶段只报开头和结尾两次，每个阶段都有收尾的一条。
        expect(progress.map(event => event.phase)).toEqual(['downloading', 'downloading', 'verifying', 'extracting', 'done']);
        expect(progress[0]).toEqual({ phase: 'downloading', version: '0.41.0', receivedBytes: 0, totalBytes: zip.byteLength, errorCode: null });
        expect(progress.at(-1)).toMatchObject({ receivedBytes: zip.byteLength, totalBytes: zip.byteLength });

        // 再装一次：已经装好、探测得通，不再下载。
        expect((await installer.install()).ok).toBe(true);
        expect(fetch.calls).toHaveLength(1);
    });

    it('inflates a large entry off the main thread and writes it intact', async () => {
        // 512 KB 以上、压得动的条目，fflate 交给 worker 解。
        const big = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
        const zip = windowsZip({ 'big.dll': big });
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn);
        expect((await installer.install()).ok).toBe(true);
        // 逐字节 toEqual 比 3 MB 太慢，比哈希。
        expect(sha256(await fsp.readFile(path.join(root, '0.41.0', 'big.dll')))).toBe(sha256(big));
    });

    it('reinstalls when the installed executable does not run, and counts only runnable versions', async () => {
        await fsp.mkdir(path.join(root, '0.41.0'), { recursive: true });
        await fsp.writeFile(path.join(root, '0.41.0', 'mpv.exe'), 'broken');
        const zip = windowsZip();
        const fetch = createFakeFetch(zip);
        const { installer } = windowsInstaller(windowsManifest(zip), fetch.fetchFn, {
            execFileFn: createProbeExec({ runs: runsOnlyRealExe }).execFileFn,
        });
        expect(await installer.listInstalled()).toEqual([]);
        const result = await installer.install();
        expect(result.ok).toBe(true);
        expect(fetch.calls).toHaveLength(1);
        expect(new Uint8Array(await fsp.readFile(path.join(root, '0.41.0', 'mpv.exe')))).toEqual(MPV_EXE);
        expect(await installer.listInstalled()).toEqual(['0.41.0']);
    });

    it('fails when the freshly installed mpv does not run, and keeps it for the next try', async () => {
        const zip = windowsZip();
        const exec = createProbeExec({ runs: () => false });
        const { installer, progress } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn, {
            execFileFn: exec.execFileFn,
        });
        const result = await installer.install();
        expect(result).toEqual({ ok: false, errorCode: 'INSTALL_FAILED', version: '0.41.0', executablePath: null });
        expect(progress.at(-1)).toMatchObject({ phase: 'error', errorCode: 'INSTALL_FAILED' });
        expect(await leftovers()).toEqual(['0.41.0']);
        // mpv.exe 读不到版本时也问过旁边的 mpv.com。
        expect(exec.calls.filter(call => call.args[0] === '--version').map(call => path.basename(call.file)))
            .toEqual(['mpv.exe', 'mpv.com']);

        // 这次能跑了（比如杀毒扫完了）：不必重下。
        const fetch = createFakeFetch(zip);
        const again = windowsInstaller(windowsManifest(zip), fetch.fetchFn);
        expect((await again.installer.install()).ok).toBe(true);
        expect(fetch.calls).toHaveLength(0);
    });

    it('reports download progress at most every 200 ms', async () => {
        const zip = windowsZip();
        let clock = 0;
        const { installer, progress } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn, {
            now: () => {
                clock += 50;
                return clock;
            },
        });
        await installer.install();
        const downloading = progress.filter(event => event.phase === 'downloading');
        const chunks = Math.ceil(zip.byteLength / 8192);
        // 每块推进 50 ms，四块才报一次，再加开头和结尾。
        expect(downloading.length).toBeLessThanOrEqual(Math.ceil(chunks / 4) + 2);
        expect(downloading.length).toBeGreaterThan(2);
        const received = downloading.map(event => event.receivedBytes);
        expect(received).toEqual([...received].sort((a, b) => a - b));
    });

    it('throws the download away on a checksum mismatch', async () => {
        const zip = windowsZip();
        const { installer, progress } = windowsInstaller(
            windowsManifest(zip, { sha256: 'f'.repeat(64) }),
            createFakeFetch(zip).fetchFn,
        );
        const result = await installer.install();
        expect(result).toEqual({ ok: false, errorCode: 'INSTALL_CHECKSUM_MISMATCH', version: '0.41.0', executablePath: null });
        expect(await leftovers()).toEqual([]);
        expect(progress.at(-1)).toMatchObject({ phase: 'error', errorCode: 'INSTALL_CHECKSUM_MISMATCH' });
        expect(await installer.listInstalled()).toEqual([]);
    });

    it('treats too few or too many bytes as a mismatch', async () => {
        const zip = windowsZip();
        for (const bytes of [zip.byteLength + 10, zip.byteLength - 10]) {
            const { installer } = windowsInstaller(windowsManifest(zip, { bytes }), createFakeFetch(zip).fetchFn);
            const result = await installer.install();
            expect(result.errorCode).toBe('INSTALL_CHECKSUM_MISMATCH');
            expect(await leftovers()).toEqual([]);
        }
    });

    it('fails on an HTTP error without leaving files', async () => {
        const zip = windowsZip();
        const { installer, progress } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip, { status: 404 }).fetchFn);
        const result = await installer.install();
        expect(result.errorCode).toBe('INSTALL_FAILED');
        expect(await leftovers()).toEqual([]);
        expect(progress.at(-1)?.phase).toBe('error');
    });

    it('moves on to the mirror when the original address fails, and restarts the progress', async () => {
        const zip = windowsZip();
        const fetch = createRoutedFetch({
            [ASSET_URL]: () => new Response('nope', { status: 502 }),
            [MIRROR_URL]: zipResponse(zip),
        });
        const { installer, progress } = windowsInstaller(mirrored(windowsManifest(zip)), fetch.fetchFn);
        const result = await installer.install();
        expect(result.ok).toBe(true);
        expect(fetch.calls).toEqual([ASSET_URL, MIRROR_URL]);
        expect(new Uint8Array(await fsp.readFile(path.join(root, '0.41.0', 'mpv.exe')))).toEqual(MPV_EXE);
        expect(await leftovers()).toEqual(['0.41.0']);
        // 每个源开始时都从 0 报起。
        expect(progress.filter(event => event.phase === 'downloading' && event.receivedBytes === 0)).toHaveLength(2);
    });

    it('moves on when a source serves the wrong bytes, and reports the last source\'s failure', async () => {
        const zip = windowsZip();
        const wrong = windowsZip({ 'extra.txt': new TextEncoder().encode('not the official build') });
        const recovered = createRoutedFetch({ [ASSET_URL]: zipResponse(wrong), [MIRROR_URL]: zipResponse(zip) });
        expect((await windowsInstaller(mirrored(windowsManifest(zip)), recovered.fetchFn).installer.install()).ok).toBe(true);
        expect(recovered.calls).toEqual([ASSET_URL, MIRROR_URL]);

        await fsp.rm(root, { recursive: true, force: true });
        const failing = createRoutedFetch({ [ASSET_URL]: zipResponse(wrong), [MIRROR_URL]: () => new Response('nope', { status: 404 }) });
        const result = await windowsInstaller(mirrored(windowsManifest(zip)), failing.fetchFn).installer.install();
        expect(result.errorCode).toBe('INSTALL_FAILED');
        expect(await leftovers()).toEqual([]);
    });

    it('gives up on a stalled source when a mirror is left, but waits on the last one', async () => {
        const zip = windowsZip();
        const fetch = createRoutedFetch({ [ASSET_URL]: zipResponse(zip, { stallAfter: 2 }), [MIRROR_URL]: zipResponse(zip) });
        const waits: number[] = [];
        const { installer } = windowsInstaller(mirrored(windowsManifest(zip)), fetch.fetchFn, {
            setTimeoutFn: (callback, ms) => {
                waits.push(ms);
                return setTimeout(callback, ms === FAILOVER_STALL_TIMEOUT_MS ? 20 : ms);
            },
        });
        expect((await installer.install()).ok).toBe(true);
        expect(fetch.calls).toEqual([ASSET_URL, MIRROR_URL]);
        // 没有镜像时同一个卡住的源不设卡住的时限，等用户取消。
        waits.length = 0;
        await fsp.rm(root, { recursive: true, force: true });
        const single = windowsInstaller(windowsManifest(zip), createFakeFetch(zip, { stallAfter: 2 }).fetchFn, {
            setTimeoutFn: (callback, ms) => {
                waits.push(ms);
                return setTimeout(callback, ms);
            },
        });
        const pending = single.installer.install();
        await until(() => fs.existsSync(path.join(root, `${zipName}.part`)) && fs.statSync(path.join(root, `${zipName}.part`)).size === 2 * 8192);
        expect(waits).not.toContain(FAILOVER_STALL_TIMEOUT_MS);
        void single.installer.cancel();
        expect((await pending).errorCode).toBe('INSTALL_CANCELLED');
    });

    it('gives up on a source that trickles when a mirror is left', async () => {
        const zip = windowsZip();
        const fetch = createRoutedFetch({ [ASSET_URL]: zipResponse(zip), [MIRROR_URL]: zipResponse(zip) });
        let clock = 0;
        const logged: unknown[][] = [];
        const { installer } = windowsInstaller(mirrored(windowsManifest(zip)), fetch.fetchFn, {
            // 第一个源每次看表都过去 1 s：8 KB/s，远低于换源的线。
            now: () => {
                if (fetch.calls.length === 1) clock += 1000;
                return clock;
            },
            logWarn: (...args) => logged.push(args),
        });
        expect((await installer.install()).ok).toBe(true);
        expect(fetch.calls).toEqual([ASSET_URL, MIRROR_URL]);
        expect(String(logged[0]?.[0])).toContain('trying gh-proxy.example.test');
        expect(String(logged[0]?.[1])).toContain('too slow');
        expect(clock).toBeGreaterThanOrEqual(FAILOVER_SLOW_AFTER_MS);
    });

    it('does not try the mirror once the listener cancels', async () => {
        const zip = windowsZip();
        const fetch = createRoutedFetch({ [ASSET_URL]: zipResponse(zip, { stallAfter: 2 }), [MIRROR_URL]: zipResponse(zip) });
        const { installer } = windowsInstaller(mirrored(windowsManifest(zip)), fetch.fetchFn);
        const pending = installer.install();
        const partPath = path.join(root, `${zipName}.part`);
        await until(() => fs.existsSync(partPath) && fs.statSync(partPath).size === 2 * 8192);
        void installer.cancel();
        expect((await pending).errorCode).toBe('INSTALL_CANCELLED');
        expect(fetch.calls).toEqual([ASSET_URL]);
        expect(await leftovers()).toEqual([]);
    });

    it('cancels while a read is stalled and releases the response body', async () => {
        const zip = windowsZip();
        let sourceCancelled = false;
        const fetch = createFakeFetch(zip, { stallAfter: 2, onCancel: () => { sourceCancelled = true; } });
        const { installer, progress } = windowsInstaller(windowsManifest(zip), fetch.fetchFn);
        const pending = installer.install();
        const partPath = path.join(root, `${zipName}.part`);
        // 两块都写进 .part 之后，下一次 read() 就挂在卡住的流上。
        await until(() => fs.existsSync(partPath) && fs.statSync(partPath).size === 2 * 8192);
        await new Promise(resolve => setTimeout(resolve, 5));
        void installer.cancel();
        const result = await Promise.race([
            pending,
            new Promise(resolve => setTimeout(() => resolve('still waiting'), 2000)),
        ]);
        expect(result).toEqual({ ok: false, errorCode: 'INSTALL_CANCELLED', version: '0.41.0', executablePath: null });
        expect(sourceCancelled).toBe(true);
        expect(await leftovers()).toEqual([]);
        expect(installer.isInstalling()).toBe(false);
        expect(progress.at(-1)).toMatchObject({ phase: 'cancelled' });
    });

    it('releases the response body when the .part file cannot be opened', async () => {
        const zip = windowsZip();
        let sourceCancelled = false;
        const fetch = createFakeFetch(zip, { onCancel: () => { sourceCancelled = true; } });
        const failingOpen = {
            ...fsp,
            open: async (target: string, flags?: string) => {
                if (String(target).endsWith('.part')) throw errnoError('EMFILE', target);
                return fsp.open(target, flags);
            },
        };
        const { installer } = windowsInstaller(windowsManifest(zip), fetch.fetchFn, { fsp: failingOpen });
        expect((await installer.install()).errorCode).toBe('INSTALL_FAILED');
        expect(fetch.calls).toHaveLength(1);
        expect(sourceCancelled).toBe(true);
        expect(await leftovers()).toEqual([]);
    });

    it('cancels during extraction and stops the unzip workers', async () => {
        const zip = windowsZip();
        let terminated = 0;
        let installer: MpvRuntimeInstaller | null = null;
        const unzipFn: UnzipFn = () => {
            setTimeout(() => void installer?.cancel(), 0);
            return () => {
                terminated += 1;
            };
        };
        const built = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn, { unzipFn });
        installer = built.installer;
        const result = await installer.install();
        expect(result.errorCode).toBe('INSTALL_CANCELLED');
        expect(terminated).toBe(1);
        expect(await leftovers()).toEqual([]);
    });

    it('cancels mid-download and removes the partial file', async () => {
        const zip = windowsZip();
        const fetch = createFakeFetch(zip, { stallAfter: 2 });
        let clock = 0;
        let cancelled = false;
        let partSeen = false;
        const { installer, progress } = windowsInstaller(windowsManifest(zip), fetch.fetchFn, {
            now: () => {
                clock += 1000;
                return clock;
            },
            onProgress: (event) => {
                progress.push(event);
                if (event.phase === 'downloading' && event.receivedBytes > 0 && !cancelled) {
                    cancelled = true;
                    partSeen = fs.existsSync(path.join(root, 'mpv-test-win.zip.part'));
                    installer.cancel();
                }
            },
        });
        const result = await installer.install();
        expect(partSeen).toBe(true);
        expect(result).toEqual({ ok: false, errorCode: 'INSTALL_CANCELLED', version: '0.41.0', executablePath: null });
        expect(await leftovers()).toEqual([]);
        expect(installer.isInstalling()).toBe(false);
        expect(progress.at(-1)).toMatchObject({ phase: 'cancelled', errorCode: 'INSTALL_CANCELLED' });
        expect(fetch.calls[0].init.signal.aborted).toBe(true);
    });

    it('retries a busy rename on Windows', async () => {
        const zip = windowsZip();
        const renames: string[] = [];
        let failures = 3;
        const busyRename = {
            ...fsp,
            rename: async (from: string, to: string) => {
                renames.push(path.basename(from));
                if (from.endsWith('.tmp') && failures > 0) {
                    failures -= 1;
                    throw errnoError('EPERM', from);
                }
                return fsp.rename(from, to);
            },
        };
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn, {
            fsp: busyRename,
            setTimeoutFn: fastRetrySetTimeout,
        });
        expect((await installer.install()).ok).toBe(true);
        expect(renames).toEqual([`${zipName}.part`, '0.41.0.tmp', '0.41.0.tmp', '0.41.0.tmp', '0.41.0.tmp']);
        expect(await leftovers()).toEqual(['0.41.0']);
    });

    it('keeps the verified zip when the final rename keeps failing, and reuses it next time', async () => {
        const zip = windowsZip();
        let attempts = 0;
        const stuckRename = {
            ...fsp,
            rename: async (from: string, to: string) => {
                if (from.endsWith('.tmp')) {
                    attempts += 1;
                    throw errnoError('EBUSY', from);
                }
                return fsp.rename(from, to);
            },
        };
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn, {
            fsp: stuckRename,
            setTimeoutFn: fastRetrySetTimeout,
        });
        expect((await installer.install()).errorCode).toBe('INSTALL_FAILED');
        // 100 + 200 + 400 + 800 + 1000 × 6 ≤ 8 s：一次加十次重试。
        expect(attempts).toBe(11);
        expect(await leftovers()).toEqual([zipName]);

        const fetch = createFakeFetch(zip);
        const again = windowsInstaller(windowsManifest(zip), fetch.fetchFn);
        expect((await again.installer.install()).ok).toBe(true);
        expect(fetch.calls).toHaveLength(0);
        expect(again.progress.map(event => event.phase)).toEqual(['verifying', 'extracting', 'done']);
        expect(await leftovers()).toEqual(['0.41.0']);
    });

    it('downloads again when the zip left on disk does not match the manifest', async () => {
        const zip = windowsZip();
        await fsp.mkdir(root, { recursive: true });
        const tampered = new Uint8Array(zip);
        tampered[100] ^= 0xff;
        await fsp.writeFile(path.join(root, zipName), tampered);
        const fetch = createFakeFetch(zip);
        const { installer } = windowsInstaller(windowsManifest(zip), fetch.fetchFn);
        expect((await installer.install()).ok).toBe(true);
        expect(fetch.calls).toHaveLength(1);
        expect(await leftovers()).toEqual(['0.41.0']);
    });

    it('does not retry a busy rename on other platforms', async () => {
        const zip = zipSync({ 'mpv.tar.gz': new Uint8Array([1]) });
        let attempts = 0;
        const installer = createMpvRuntimeInstaller({
            manifest: manifestFor('darwin-arm64', {
                url: 'https://github.example.test/mpv-v0.41.0-macos-14-arm.zip',
                bytes: zip.byteLength,
                sha256: sha256(zip),
                archive: 'zip',
                executable: 'mpv.app/Contents/MacOS/mpv',
            }),
            platform: 'darwin',
            arch: 'arm64',
            getUserDataPath: () => userData,
            fetchFn: createFakeFetch(zip).fetchFn,
            fsp: {
                ...fsp,
                rename: async (from: string) => {
                    attempts += 1;
                    throw errnoError('EPERM', from);
                },
            },
            setTimeoutFn: fastRetrySetTimeout,
            ...silent,
        });
        expect((await installer.install()).errorCode).toBe('INSTALL_FAILED');
        expect(attempts).toBe(1);
    });

    it('prunes leftover downloads but not version folders or what an install in progress uses', async () => {
        await fsp.mkdir(path.join(root, '0.40.0.tmp', 'doc'), { recursive: true });
        await fsp.mkdir(path.join(root, '0.41.0'), { recursive: true });
        await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
        await fsp.writeFile(path.join(root, '0.41.0', 'mpv.exe'), 'old');
        await fsp.writeFile(path.join(root, 'mpv-v0.40.0-x86_64-pc-windows-msvc.zip'), 'zip');
        await fsp.writeFile(path.join(root, 'mpv-v0.40.0-x86_64-pc-windows-msvc.zip.part'), 'part');
        await fsp.writeFile(path.join(root, 'notes.txt'), 'keep');
        const zip = windowsZip();
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip, { stallAfter: 1 }).fetchFn, {
            execFileFn: createProbeExec({ runs: runsOnlyRealExe }).execFileFn,
        });
        await installer.pruneLeftovers();
        expect(await leftovers()).toEqual(['0.41.0', 'notes', 'notes.txt']);

        // 正在下载时清理：这次安装的 .part 不动。
        const pending = installer.install();
        const partPath = path.join(root, `${zipName}.part`);
        await until(() => fs.existsSync(partPath) && fs.statSync(partPath).size > 0);
        await fsp.mkdir(path.join(root, '0.39.0.tmp'));
        await installer.pruneLeftovers();
        expect(await leftovers()).toEqual(['0.41.0', 'mpv-test-win.zip.part', 'notes', 'notes.txt']);
        await installer.cancel();
        expect((await pending).errorCode).toBe('INSTALL_CANCELLED');
        expect(await installer.cancel()).toBeNull();
    });

    it('clears leftovers of other versions after a successful install', async () => {
        await fsp.mkdir(path.join(root, '0.40.0.tmp'), { recursive: true });
        await fsp.writeFile(path.join(root, 'mpv-v0.40.0-x86_64-pc-windows-msvc.zip.part'), 'part');
        const zip = windowsZip();
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn);
        expect((await installer.install()).ok).toBe(true);
        expect(await leftovers()).toEqual(['0.41.0']);
    });

    it('keeps only the newest two versions, and always the one just installed', async () => {
        for (const version of ['0.38.5', '0.39.0', '0.40.0']) {
            await fsp.mkdir(path.join(root, version), { recursive: true });
            await fsp.writeFile(path.join(root, version, 'mpv.exe'), 'old');
        }
        await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
        const zip = windowsZip();
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn);
        expect((await installer.install()).ok).toBe(true);
        expect(await leftovers()).toEqual(['0.40.0', '0.41.0', 'notes']);

        // 已经有更新的两个版本时，刚装的旧版本也不删。
        await fsp.rm(path.join(root, '0.41.0'), { recursive: true });
        for (const version of ['0.42.0', '0.43.0']) {
            await fsp.mkdir(path.join(root, version), { recursive: true });
        }
        const again = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn);
        expect((await again.installer.install()).ok).toBe(true);
        expect(await leftovers()).toEqual(['0.41.0', '0.43.0', 'notes']);
    });

    it('refuses a zip with a path that escapes the install directory', async () => {
        const zip = windowsZip({ '../escape.dll': new TextEncoder().encode('evil') });
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn);
        const result = await installer.install();
        expect(result.errorCode).toBe('INSTALL_FAILED');
        expect(fs.existsSync(path.join(root, '..', 'escape.dll'))).toBe(false);
        expect(fs.existsSync(path.join(userData, 'escape.dll'))).toBe(false);
        expect(await leftovers()).toEqual([]);
    });

    it('fails when the archive has no executable', async () => {
        const zip = zipSync({ 'readme.txt': new TextEncoder().encode('no mpv here') });
        const { installer } = windowsInstaller(windowsManifest(zip), createFakeFetch(zip).fetchFn);
        expect((await installer.install()).errorCode).toBe('INSTALL_FAILED');
        expect(await leftovers()).toEqual([]);
    });

    it('answers UNSUPPORTED_PLATFORM on Linux without touching the network or disk', async () => {
        const fetch = createFakeFetch(new Uint8Array(1));
        const installer = createMpvRuntimeInstaller({
            manifest: require('../../../shared/mpvRuntimeManifest.json'),
            platform: 'linux',
            arch: 'x64',
            getUserDataPath: () => userData,
            fetchFn: fetch.fetchFn,
            ...silent,
        });
        expect(await installer.install()).toEqual({ ok: false, errorCode: 'UNSUPPORTED_PLATFORM', version: null, executablePath: null });
        expect(fetch.calls).toHaveLength(0);
        expect(fs.existsSync(root)).toBe(false);
        expect(installer.isInstalling()).toBe(false);
        expect(await installer.listInstalled()).toEqual([]);
    });

    it('treats a macOS older than the build needs as unsupported', async () => {
        const fetch = createFakeFetch(new Uint8Array(1));
        const installer = createMpvRuntimeInstaller({
            manifest: require('../../../shared/mpvRuntimeManifest.json'),
            platform: 'darwin',
            arch: 'x64',
            getUserDataPath: () => userData,
            fetchFn: fetch.fetchFn,
            systemVersion: '14.7.2',
            ...silent,
        });
        expect((await installer.install()).errorCode).toBe('UNSUPPORTED_PLATFORM');
        expect(fetch.calls).toHaveLength(0);
    });

    it('extracts on macOS with ditto, then tar, and makes the binary executable', async () => {
        const zip = zipSync({ 'mpv.tar.gz': new Uint8Array([1, 2, 3]) });
        const manifest = manifestFor('darwin-arm64', {
            url: 'https://github.example.test/mpv-v0.41.0-macos-14-arm.zip',
            bytes: zip.byteLength,
            sha256: sha256(zip),
            archive: 'zip+tar.gz',
            tarball: 'mpv.tar.gz',
            executable: 'mpv.app/Contents/MacOS/mpv',
            minOsVersion: '14.0',
        });
        const calls: Array<{ file: string; args: string[] }> = [];
        const execFileFn: ExecFileFn = (file, args, _options, callback) => {
            calls.push({ file, args });
            // 假的 ditto 解出 mpv.tar.gz，假的 tar 解出不带执行位的 mpv.app，装好后的 mpv 答得上版本号。
            if (args[0] === '--version') {
                callback(null, PROBE_OUTPUT, '');
                return;
            }
            if (file === 'ditto') {
                fs.writeFileSync(path.join(args[3], 'mpv.tar.gz'), 'tarball');
            } else if (file === 'tar') {
                const macos = path.join(args[3], 'mpv.app', 'Contents', 'MacOS');
                fs.mkdirSync(macos, { recursive: true });
                fs.writeFileSync(path.join(macos, 'mpv'), 'mach-o', { mode: 0o644 });
            }
            callback(null);
        };
        const installer = createMpvRuntimeInstaller({
            manifest,
            platform: 'darwin',
            arch: 'arm64',
            getUserDataPath: () => userData,
            fetchFn: createFakeFetch(zip).fetchFn,
            execFileFn,
            systemVersion: '14.5.0',
            ...silent,
        });
        const result = await installer.install();

        const zipPath = path.join(root, 'mpv-v0.41.0-macos-14-arm.zip');
        const tmpDir = path.join(root, '0.41.0.tmp');
        const executablePath = path.join(root, '0.41.0', 'mpv.app', 'Contents', 'MacOS', 'mpv');
        expect(calls).toEqual([
            { file: 'ditto', args: ['-x', '-k', zipPath, tmpDir] },
            { file: 'tar', args: ['-xzf', path.join(tmpDir, 'mpv.tar.gz'), '-C', tmpDir] },
            { file: executablePath, args: ['--version'] },
        ]);
        expect(result).toEqual({ ok: true, errorCode: null, version: '0.41.0', executablePath });
        // Windows 的文件系统没有 unix 权限位，chmod 只能动只读位，读回来总是 0o666；只在别的系统上核对。
        if (process.platform !== 'win32') expect(fs.statSync(executablePath).mode & 0o777).toBe(0o755);
        expect(fs.existsSync(path.join(root, '0.41.0', 'mpv.tar.gz'))).toBe(false);
        expect(await leftovers()).toEqual(['0.41.0']);
        expect(await installer.listInstalled()).toEqual(['0.41.0']);
    });

    it('fails cleanly when ditto fails', async () => {
        const zip = zipSync({ 'mpv.tar.gz': new Uint8Array([1]) });
        const manifest = manifestFor('darwin-x64', {
            url: 'https://github.example.test/mpv-v0.41.0-macos-15-intel.zip',
            bytes: zip.byteLength,
            sha256: sha256(zip),
            archive: 'zip+tar.gz',
            tarball: 'mpv.tar.gz',
            executable: 'mpv.app/Contents/MacOS/mpv',
        });
        const installer = createMpvRuntimeInstaller({
            manifest,
            platform: 'darwin',
            arch: 'x64',
            getUserDataPath: () => userData,
            fetchFn: createFakeFetch(zip).fetchFn,
            execFileFn: (_file, _args, _options, callback) => callback(new Error('ditto: Couldn\'t read PKZip signature')),
            ...silent,
        });
        expect((await installer.install()).errorCode).toBe('INSTALL_FAILED');
        expect(await leftovers()).toEqual([]);
    });
});

describe('shared/mpvRuntimeManifest.json', () => {
    it('lists only versions our launch arguments work with', () => {
        const manifest = require('../../../shared/mpvRuntimeManifest.json') as { versions: Array<{ version: string }> };
        const { isSupportedMpvVersion } = require('../../../electron/hifi/mpvRuntime.cjs') as {
            isSupportedMpvVersion: (version: string) => boolean;
        };
        for (const entry of manifest.versions) expect(isSupportedMpvVersion(entry.version)).toBe(true);
    });

    it('lists official v0.41.0 builds with a hash, a size and an executable for each platform', () => {
        const manifest = require('../../../shared/mpvRuntimeManifest.json') as {
            schema: number;
            recommended: string;
            versions: Array<{ version: string; builds: Record<string, Record<string, unknown>> }>;
        };
        expect(manifest.schema).toBe(1);
        const recommended = manifest.versions.find(entry => entry.version === manifest.recommended);
        expect(Object.keys(recommended?.builds ?? {}).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64']);
        for (const [key, build] of Object.entries(recommended?.builds ?? {})) {
            expect(build.url).toMatch(/^https:\/\/github\.com\/mpv-player\/mpv\/releases\/download\/v0\.41\.0\//);
            expect(build.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(Number.isSafeInteger(build.bytes)).toBe(true);
            expect(build.executable).toBe(key.startsWith('win32') ? 'mpv.exe' : 'mpv.app/Contents/MacOS/mpv');
        }
    });

    it('falls back from GitHub to gh-proxy', () => {
        const manifest = require('../../../shared/mpvRuntimeManifest.json') as {
            recommended: string;
            versions: Array<{ version: string; builds: Record<string, { url: string }> }>;
        };
        const recommended = manifest.versions.find(entry => entry.version === manifest.recommended);
        for (const build of Object.values(recommended?.builds ?? {})) {
            expect(downloadSourcesFor(manifest, build)).toEqual([build.url, `https://gh-proxy.com/${build.url}`]);
        }
    });
});
