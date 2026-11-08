'use strict';

const { createHash } = require('crypto');
const path = require('path');
const { createHifiError, toHifiErrorCode } = require('./hifiErrors.cjs');
const {
    compareMpvVersions,
    executablePathFor,
    isExecutableFile,
    listInstalledVersions,
    probeMpvVersion,
    resolveInstallTarget,
    runtimeRootFor,
} = require('./mpvRuntime.cjs');

// 替用户下载 mpv：边下边算 sha256，核对后解压到 userData/hifi-runtime/mpv/<version>/，只留最新两个版本。
// 下载源先是清单里的原址，再是清单 `mirrors` 套出来的镜像；一个源不行就换下一个，最后一个源一直等到用户取消。

/** 进度最多这么频繁地报一次；70 MB 的 zip 有上千个块。 */
const PROGRESS_INTERVAL_MS = 200;
/** 只管响应头多久内到；传输本身慢不算失败，用户可以取消。 */
const RESPOND_TIMEOUT_MS = 45_000;
/**
 * 后面还有下载源时，换源的三条线：响应头这么久没到、这么久没来一块数据、下了 FAILOVER_SLOW_AFTER_MS
 * 以后平均还不到 FAILOVER_MIN_BYTES_PER_SECOND。国内直连 GitHub 常常不是断开，而是几十 KB/s 地拖着。
 */
const FAILOVER_RESPOND_TIMEOUT_MS = 15_000;
const FAILOVER_STALL_TIMEOUT_MS = 20_000;
const FAILOVER_SLOW_AFTER_MS = 10_000;
const FAILOVER_MIN_BYTES_PER_SECOND = 256 * 1024;
const EXTRACT_TIMEOUT_MS = 5 * 60_000;
const KEEP_VERSIONS = 2;
/** 核对上次留下的 zip 时每次读这么多。 */
const VERIFY_CHUNK_BYTES = 1024 * 1024;
/** Windows 上刚写完的文件常被杀毒、索引占着，改名失败先退避重试（100 ms 起翻倍到 1 s），总共等约 8 s。 */
const RENAME_RETRY_BUDGET_MS = 8000;
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const INSTALL_ERROR_CODES = new Set(['INSTALL_FAILED', 'INSTALL_CHECKSUM_MISMATCH', 'INSTALL_CANCELLED']);
const VERSION_DIR_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// Windows 构建里两百多 MB 的调试符号，运行用不到。
const SKIPPED_ENTRY_PATTERN = /\.pdb$/i;
// 中途退出留下的：下到一半的 `.part`、核对过还没解开的 zip、解到一半的 `<version>.tmp/`。
const LEFTOVER_FILE_PATTERN = /\.(?:part|zip)$/i;
const LEFTOVER_DIR_PATTERN = /\.tmp$/i;

/**
 * zip 条目名拆成路径段。'..'、绝对路径、反斜杠和带冒号的段（盘符、NTFS 流）为 undefined，整包拒绝；
 * 目录条目为 null，跳过（目录随文件建出来）。
 */
const safeEntrySegments = name => {
    if (typeof name !== 'string' || name.startsWith('/')) return undefined;
    const segments = name.split('/').filter(segment => segment !== '' && segment !== '.');
    if (segments.some(segment => segment === '..' || segment.includes('\\') || segment.includes(':'))) return undefined;
    return name.endsWith('/') || segments.length === 0 ? null : segments;
};

/**
 * 一个构建依次试的下载地址：原址，再是清单 `mirrors` 里每个模板把 `{url}` 换成原址（如 gh-proxy 的前缀）。
 * 只认 https 模板；重复的去掉。镜像给的字节对不对由 sha256 把关。
 */
const downloadSourcesFor = (manifest, build) => {
    const templates = Array.isArray(manifest?.mirrors) ? manifest.mirrors : [];
    const mirrored = templates
        .filter(template => typeof template === 'string' && template.startsWith('https://') && template.includes('{url}'))
        .map(template => template.replace('{url}', build.url));
    return [...new Set([build.url, ...mirrored])];
};

const assetNameOf = url => {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(last);
    return /^[0-9A-Za-z._-]+$/.test(name) ? name : 'mpv-runtime.zip';
};

const createMpvRuntimeInstaller = ({
    manifest = require('../../shared/mpvRuntimeManifest.json'),
    platform = process.platform,
    arch = process.arch,
    getUserDataPath,
    fetchFn = (...args) => fetch(...args),
    fsp = require('fs/promises'),
    // fflate 的异步 unzip：大条目在 worker_threads 里解压，主线程不卡。
    unzipFn = require('fflate').unzip,
    execFileFn = require('child_process').execFile,
    onProgress,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    // 和 mpvRuntime 一样：macOS 上传 process.getSystemVersion()，系统版本不够的构建当作不支持。
    systemVersion = null,
    logInfo = (...args) => console.info(...args),
    logWarn = (...args) => console.warn(...args),
} = {}) => {
    /** 进行中的那一次：{ controller, promise, layout }。 */
    let current = null;

    const runtimeRoot = () => runtimeRootFor(getUserDataPath(), path);

    /** 一次安装用到的路径；清理遗留文件时跳过进行中那次的这几个。 */
    const layoutFor = ({ version, build }) => {
        const root = runtimeRoot();
        const zipPath = path.join(root, assetNameOf(build.url));
        return {
            root,
            zipPath,
            partPath: `${zipPath}.part`,
            tmpDir: path.join(root, `${version}.tmp`),
            finalDir: path.join(root, version),
        };
    };

    const checkExecutable = candidate => isExecutableFile(fsp, platform, candidate, { setTimeoutFn, clearTimeoutFn });

    /** 装好的 mpv 真能跑 `--version`：文件在、能解析出版本号。 */
    const probeInstalled = async (executablePath) => {
        if (!(await checkExecutable(executablePath))) return null;
        return probeMpvVersion({ execFileFn, platform, candidate: executablePath, isExecutable: checkExecutable });
    };

    const sleep = ms => new Promise((resolve) => {
        setTimeoutFn(resolve, ms);
    });

    const report = progress => {
        try {
            onProgress?.(progress);
        } catch {
            // 窗口已关，不影响安装。
        }
    };

    const removeQuietly = async target => {
        try {
            await fsp.rm(target, { recursive: true, force: true });
            return true;
        } catch (error) {
            logWarn('[HiFi] install: could not remove', target, error);
            return false;
        }
    };

    const throwIfCancelled = signal => {
        if (signal.aborted) throw createHifiError('INSTALL_CANCELLED');
    };

    /** 改名；Windows 上碰到 EPERM / EACCES / EBUSY 就退避重试，graceful-fs 也是这么对付杀毒和索引的。 */
    const renameWithRetry = async (from, to, signal) => {
        let waited = 0;
        for (let delay = 100; ; delay = Math.min(delay * 2, 1000)) {
            try {
                await fsp.rename(from, to);
                return;
            } catch (error) {
                const retryable = platform === 'win32' && RENAME_RETRY_CODES.has(error?.code);
                if (!retryable || waited + delay > RENAME_RETRY_BUDGET_MS || signal.aborted) throw error;
                if (waited === 0) logInfo(`[HiFi] install: ${path.basename(from)} is busy (${error.code}), retrying the rename`);
                await sleep(delay);
                waited += delay;
            }
        }
    };

    const run = (command, args, signal) => new Promise((resolve, reject) => {
        execFileFn(command, args, { timeout: EXTRACT_TIMEOUT_MS, windowsHide: true, signal }, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });

    /**
     * 从 url 把 zip 流进 `.part`，边写边算 sha256；字节数超过清单就立刻停。取消时连读带写一起停：
     * 不指望 fetch 的实现会让正在读的流报错，直接取消 reader。failover 为真（后面还有源）时，没响应、
     * 卡住和太慢都放弃这个源，报 INSTALL_FAILED。
     */
    const downloadTo = async (url, build, partPath, signal, onBytes, { failover = false } = {}) => {
        const host = new URL(url).host;
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        const giveUp = reason => controller.abort(new Error(reason));
        let deadline = setTimeoutFn(() => giveUp('no response'), failover ? FAILOVER_RESPOND_TIMEOUT_MS : RESPOND_TIMEOUT_MS);
        // 只在 failover 时用：每来一块重新计时。
        const armStall = () => {
            if (!failover) return;
            if (deadline) clearTimeoutFn(deadline);
            deadline = setTimeoutFn(() => giveUp('transfer stalled'), FAILOVER_STALL_TIMEOUT_MS);
        };
        let handle = null;
        let response = null;
        let reader = null;
        const cancelReader = () => {
            reader?.cancel().catch(() => { });
        };
        // 这个源被放弃（不是用户取消）时报的错。
        const abandoned = () => createHifiError('INSTALL_FAILED', `${host}: ${controller.signal.reason?.message ?? 'aborted'}`);
        try {
            try {
                response = await fetchFn(url, { redirect: 'follow', signal: controller.signal });
            } catch (error) {
                if (controller.signal.aborted && !signal.aborted) throw abandoned();
                throw error;
            }
            clearTimeoutFn(deadline);
            deadline = null;
            if (!response.ok || !response.body) {
                response.body?.cancel().catch(() => { });
                throw createHifiError('INSTALL_FAILED', `${host}: HTTP ${response.status}`);
            }

            const hash = createHash('sha256');
            handle = await fsp.open(partPath, 'w');
            reader = response.body.getReader();
            controller.signal.addEventListener('abort', cancelReader, { once: true });
            let received = 0;
            const startedAt = failover ? now() : 0;
            armStall();
            for (;;) {
                if (controller.signal.aborted) break;
                const { done, value } = await reader.read();
                if (done || controller.signal.aborted) break;
                armStall();
                received += value.byteLength;
                if (received > build.bytes) {
                    throw createHifiError('INSTALL_CHECKSUM_MISMATCH', `${host}: more than ${build.bytes} bytes`);
                }
                hash.update(value);
                await handle.write(value);
                onBytes(received);
                const elapsed = failover ? now() - startedAt : 0;
                if (elapsed >= FAILOVER_SLOW_AFTER_MS && received * 1000 < FAILOVER_MIN_BYTES_PER_SECOND * elapsed) {
                    giveUp(`too slow (${Math.round(received / elapsed)} KB/s)`);
                }
            }
            throwIfCancelled(signal);
            if (controller.signal.aborted) throw abandoned();
            return { received, digest: hash.digest('hex') };
        } finally {
            if (deadline) clearTimeoutFn(deadline);
            signal.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', cancelReader);
            // 提前停下（字节超了、写盘失败）时别让连接挂着；读完的流取消也无妨。
            cancelReader();
            // 还没拿 reader 就失败了（比如 .part 打不开）：直接取消响应体，连接同样不留。
            if (!reader) response?.body?.cancel().catch(() => { });
            await handle?.close().catch(() => { });
        }
    };

    /** 上次核对过、还没解开的 zip 还在，字节数和 sha256 也都对，就不必重下。 */
    const verifiedZipOnDisk = async (zipPath, build, signal) => {
        let handle = null;
        try {
            const stat = await fsp.stat(zipPath);
            if (!stat.isFile() || stat.size !== build.bytes) return false;
            handle = await fsp.open(zipPath, 'r');
            const hash = createHash('sha256');
            const buffer = Buffer.allocUnsafe(VERIFY_CHUNK_BYTES);
            for (let offset = 0; offset < build.bytes;) {
                throwIfCancelled(signal);
                const length = Math.min(buffer.byteLength, build.bytes - offset);
                const { bytesRead } = await handle.read(buffer, 0, length, offset);
                if (bytesRead === 0) return false;
                hash.update(buffer.subarray(0, bytesRead));
                offset += bytesRead;
            }
            return hash.digest('hex') === build.sha256;
        } catch (error) {
            if (error?.code === 'INSTALL_CANCELLED') throw error;
            return false;
        } finally {
            await handle?.close().catch(() => { });
        }
    };

    /** 交给 fflate 的异步 unzip；取消时终止它的 worker。 */
    const inflateZip = (data, filter, signal) => new Promise((resolve, reject) => {
        let settled = false;
        let terminate = null;
        const finish = (error, entries) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve(entries);
        };
        const onAbort = () => {
            try {
                terminate?.();
            } catch {
                // worker 已经退出。
            }
            finish(createHifiError('INSTALL_CANCELLED'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        try {
            terminate = unzipFn(data, { filter }, finish);
        } catch (error) {
            finish(error);
            return;
        }
        if (signal.aborted) onAbort();
    });

    /** Windows：fflate 在 worker 里解，逐个写出；条目名先过一遍，路径不安全就整包拒绝。 */
    const unzipInto = async (zipPath, tmpDir, signal) => {
        const bytes = await fsp.readFile(zipPath);
        let unsafeName = null;
        const entries = await inflateZip(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), (file) => {
            const segments = safeEntrySegments(file.name);
            if (segments === undefined) {
                unsafeName ??= file.name;
                return false;
            }
            return segments !== null && !SKIPPED_ENTRY_PATTERN.test(file.name);
        }, signal);
        if (unsafeName !== null) throw createHifiError('INSTALL_FAILED', `unsafe zip entry ${unsafeName}`);
        const root = path.resolve(tmpDir);
        for (const [name, data] of Object.entries(entries)) {
            throwIfCancelled(signal);
            const destination = path.resolve(root, ...safeEntrySegments(name));
            if (!destination.startsWith(root + path.sep)) throw createHifiError('INSTALL_FAILED', `unsafe zip entry ${name}`);
            await fsp.mkdir(path.dirname(destination), { recursive: true });
            await fsp.writeFile(destination, data);
        }
    };

    // macOS 用系统的 ditto 解 zip；官方构建的 zip 里只有一个 mpv.tar.gz，再用系统 tar（bsdtar 默认拒绝 '..' 和绝对路径）解开。
    const extract = async (build, zipPath, tmpDir, signal) => {
        await fsp.mkdir(tmpDir, { recursive: true });
        if (platform === 'darwin' && (build.archive === 'zip' || build.archive === 'zip+tar.gz')) {
            await run('ditto', ['-x', '-k', zipPath, tmpDir], signal);
            if (build.archive === 'zip+tar.gz') {
                if (typeof build.tarball !== 'string' || !/^[0-9A-Za-z._-]+$/.test(build.tarball)) {
                    throw createHifiError('INSTALL_FAILED', 'manifest has no usable tarball name');
                }
                const tarball = path.join(tmpDir, build.tarball);
                await run('tar', ['-xzf', tarball, '-C', tmpDir], signal);
                await fsp.rm(tarball, { force: true });
            }
            return;
        }
        if (platform === 'win32' && build.archive === 'zip') {
            await unzipInto(zipPath, tmpDir, signal);
            return;
        }
        throw createHifiError('INSTALL_FAILED', `cannot extract ${build.archive} on ${platform}`);
    };

    /** 删掉中途退出留下的 `.part`、zip 和 `<version>.tmp/`；进行中那次安装正用着的不动。 */
    const pruneLeftovers = async () => {
        let root = null;
        try {
            root = runtimeRoot();
        } catch (error) {
            logWarn('[HiFi] install: no runtime directory to clean', error);
            return;
        }
        const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const target = path.join(root, entry.name);
            // 每条现查：清理途中可能刚好开始一次安装。
            const layout = current?.layout;
            if (layout && [layout.partPath, layout.zipPath, layout.tmpDir].includes(target)) continue;
            const leftover = entry.isDirectory()
                ? LEFTOVER_DIR_PATTERN.test(entry.name)
                : entry.isFile() && LEFTOVER_FILE_PATTERN.test(entry.name);
            if (leftover && await removeQuietly(target)) logInfo(`[HiFi] install: removed leftover ${entry.name}`);
        }
    };

    /** 只留最新两个版本目录；刚装的那个无论新旧都留着。删不掉（Windows 上正在跑）只记一笔。顺带清掉遗留的下载。 */
    const prune = async (root, installedVersion) => {
        const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
        const versions = entries
            .filter(entry => entry.isDirectory() && VERSION_DIR_PATTERN.test(entry.name) && !entry.name.endsWith('.tmp'))
            .map(entry => entry.name)
            .sort((a, b) => compareMpvVersions(b, a));
        const keep = new Set([installedVersion]);
        for (const version of versions) {
            if (keep.size >= KEEP_VERSIONS) break;
            keep.add(version);
        }
        for (const version of versions) {
            if (keep.has(version)) continue;
            try {
                await fsp.rm(path.join(root, version), { recursive: true, force: true });
                logInfo(`[HiFi] install: removed old mpv ${version}`);
            } catch (error) {
                logWarn(`[HiFi] install: could not remove old mpv ${version}`, error);
            }
        }
        await pruneLeftovers();
    };

    /**
     * 按顺序试每个下载源，下完一个就核对字节数和 sha256；不对（镜像给错了文件）也换下一个。最后一个源的错原样抛出。
     * onPhase('start') 在每个源开始时调用（进度从 0 重新算），之后是 'downloading' 和 'verifying'。
     */
    const downloadFromSources = async (version, build, partPath, signal, onPhase, onBytes) => {
        const sources = downloadSourcesFor(manifest, build);
        for (let index = 0; index < sources.length; index += 1) {
            const url = sources[index];
            const host = new URL(url).host;
            const failover = index < sources.length - 1;
            logInfo(`[HiFi] install: downloading mpv ${version} from ${host}`);
            onPhase('start');
            try {
                const downloaded = await downloadTo(url, build, partPath, signal, onBytes, { failover });
                onPhase('downloading');
                onPhase('verifying');
                if (downloaded.received !== build.bytes || downloaded.digest !== build.sha256) {
                    throw createHifiError(
                        'INSTALL_CHECKSUM_MISMATCH',
                        `${host}: ${downloaded.received} bytes, sha256 ${downloaded.digest.slice(0, 12)}`
                        + ` (wanted ${build.bytes}, ${build.sha256.slice(0, 12)})`,
                    );
                }
                return;
            } catch (error) {
                if (signal.aborted || !failover) throw error;
                logWarn(`[HiFi] install: ${host} did not work, trying ${new URL(sources[index + 1]).host}`, error);
                await removeQuietly(partPath);
            }
        }
    };

    /**
     * 一次完整安装：下载 → 校验 → 解压到 <version>.tmp → 核对可执行文件 → 改名到位 → 探测能跑 → 清旧版本。
     * 已装的版本只有探测得通才算数，起不来的（缺了 DLL、被杀毒隔离）重新装。
     */
    const runInstall = async ({ version, build }, layout, signal) => {
        const { root, zipPath, partPath, tmpDir, finalDir } = layout;
        const executablePath = executablePathFor(finalDir, build, path);
        let received = 0;
        let announced = 0;
        // 最后一步改名失败（Windows 上被杀毒、索引占着）时留着核对过的 zip，再点一次不必重下；取消时照样删。
        let keepZip = false;
        const emit = (phase, errorCode = null) => report({
            phase,
            version,
            receivedBytes: received,
            totalBytes: build.bytes,
            errorCode,
        });

        try {
            if (await probeInstalled(executablePath)) {
                received = build.bytes;
                emit('done');
                return { ok: true, errorCode: null, version, executablePath };
            }
            await fsp.mkdir(root, { recursive: true });
            await pruneLeftovers();
            await removeQuietly(partPath);
            await removeQuietly(tmpDir);

            if (await verifiedZipOnDisk(zipPath, build, signal)) {
                received = build.bytes;
                logInfo(`[HiFi] install: reusing the verified download of mpv ${version}`);
                emit('verifying');
            } else {
                await removeQuietly(zipPath);
                await downloadFromSources(version, build, partPath, signal, (phase) => {
                    if (phase === 'start') {
                        received = 0;
                        announced = now();
                        emit('downloading');
                        return;
                    }
                    emit(phase);
                }, (bytes) => {
                    received = bytes;
                    const at = now();
                    if (at - announced >= PROGRESS_INTERVAL_MS) {
                        announced = at;
                        emit('downloading');
                    }
                });
                await renameWithRetry(partPath, zipPath, signal);
            }
            throwIfCancelled(signal);

            emit('extracting');
            await extract(build, zipPath, tmpDir, signal);
            throwIfCancelled(signal);
            const stagedExecutable = executablePathFor(tmpDir, build, path);
            const stat = await fsp.stat(stagedExecutable).catch(() => null);
            if (!stat?.isFile()) throw createHifiError('INSTALL_FAILED', `archive has no ${build.executable}`);
            if (platform !== 'win32') await fsp.chmod(stagedExecutable, 0o755);

            // 旧的那份可能还被占着（Windows），rm 自己会对 EBUSY / EPERM 重试几次。
            keepZip = true;
            await fsp.rm(finalDir, { recursive: true, force: true, maxRetries: platform === 'win32' ? 5 : 0, retryDelay: 200 });
            await renameWithRetry(tmpDir, finalDir, signal);
            keepZip = false;
            await removeQuietly(zipPath);

            const probed = await probeInstalled(executablePath);
            await prune(root, version);
            // 起不来的这份留在原处：下次 install() 再探一次，还不行才删掉重下。
            if (!probed) throw createHifiError('INSTALL_FAILED', `${build.executable} does not run`);

            emit('done');
            logInfo(`[HiFi] install: mpv ${version} installed at ${finalDir}`);
            return { ok: true, errorCode: null, version, executablePath };
        } catch (error) {
            const code = signal.aborted ? 'INSTALL_CANCELLED' : toHifiErrorCode(error, 'INSTALL_FAILED');
            const errorCode = INSTALL_ERROR_CODES.has(code) ? code : 'INSTALL_FAILED';
            await removeQuietly(partPath);
            await removeQuietly(tmpDir);
            if (errorCode === 'INSTALL_CANCELLED' || !keepZip) await removeQuietly(zipPath);
            if (errorCode === 'INSTALL_CANCELLED') {
                logInfo(`[HiFi] install: mpv ${version} cancelled`);
                emit('cancelled', errorCode);
            } else {
                logWarn(`[HiFi] install: mpv ${version} failed (${errorCode})`, error);
                emit('error', errorCode);
            }
            return { ok: false, errorCode, version, executablePath: null };
        }
    };

    /** 装清单推荐的版本；已在装时返回同一次的结果。Linux 和清单里没有的平台不碰网络，直接 UNSUPPORTED_PLATFORM。 */
    const install = () => {
        if (current) return current.promise;
        const target = resolveInstallTarget({ manifest, platform, arch, systemVersion });
        if (!target) {
            logInfo(`[HiFi] install: no mpv build for ${platform}-${arch}`);
            return Promise.resolve({ ok: false, errorCode: 'UNSUPPORTED_PLATFORM', version: null, executablePath: null });
        }
        let layout = null;
        try {
            layout = layoutFor(target);
        } catch (error) {
            logWarn('[HiFi] install: no runtime directory', error);
            return Promise.resolve({ ok: false, errorCode: 'INSTALL_FAILED', version: target.version, executablePath: null });
        }
        const controller = new AbortController();
        // 先登记再开始，runInstall 里清遗留文件时才认得出自己这次的路径。
        const entry = { controller, layout, promise: null };
        current = entry;
        entry.promise = runInstall(target, layout, controller.signal).finally(() => {
            if (current === entry) current = null;
        });
        return entry.promise;
    };

    /** 取消进行中的安装；返回那次安装的结果（清理做完才落定），没在装时为 null。 */
    const cancel = () => {
        if (!current) return Promise.resolve(null);
        current.controller.abort(new Error('cancelled'));
        return current.promise;
    };

    const isInstalling = () => current !== null;

    /** 装好且探测得通的版本，新的在前。 */
    const listInstalled = async () => {
        try {
            const present = await listInstalledVersions({
                manifest,
                platform,
                arch,
                root: runtimeRoot(),
                pathModule: path,
                isExecutable: checkExecutable,
            });
            const runnable = [];
            for (const entry of present) {
                if (await probeInstalled(entry.executablePath)) runnable.push(entry.version);
            }
            return runnable;
        } catch (error) {
            logWarn('[HiFi] install: could not list installed mpv', error);
            return [];
        }
    };

    return { install, cancel, isInstalling, listInstalled, pruneLeftovers };
};

module.exports = {
    PROGRESS_INTERVAL_MS,
    FAILOVER_RESPOND_TIMEOUT_MS,
    FAILOVER_STALL_TIMEOUT_MS,
    FAILOVER_SLOW_AFTER_MS,
    FAILOVER_MIN_BYTES_PER_SECOND,
    downloadSourcesFor,
    KEEP_VERSIONS,
    safeEntrySegments,
    createMpvRuntimeInstaller,
};
