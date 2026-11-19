#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { buildSource } from '../../dev/sources/build.mjs';
// test/manual/folium2DepsArchiveSmoke.mjs
// Folium 2.0 方案 §10「剩余阶段的顺序」第 2 步：三个真实上游库（网易云、酷狗、QQ）的依赖归档样例的冒烟。
//
//   node test/manual/folium2DepsArchiveSmoke.mjs [--out <目录>] [--report <文件>] [--strict-request]
//
// 1. 用 dev/sources/build.mjs 构建 test/fixtures/folium-sources/deps-archive/ 下的三个样例：上游库的生产依赖闭包
//    各打成 deps.<指纹>.asar，记下大小、包数、文件数和构建耗时（冷构建：输出目录是新的）。
// 2. 摆出一个安装版的布局：复制一份 Electron 的发行目录，冒烟的主进程打成 resources/app.asar（宿主代码在 asar 里），
//    样例放进 resources/builtin-mods/（和安装包的 extraResources 一样），Windows、Linux 上把可执行文件改名（app.isPackaged 为真）。
// 3. 启动它：主进程从 asar 里的入口逐个加载样例，样例从自己目录里的归档 require 上游库、起后端、发一个不需要登录的请求
//    （folium2DepsArchiveSmokeMain.cjs）。
// 4. 打印每家的「加载 / 后端起来 / 请求」结果和耗时，再把模组目录的大小和覆盖包上限对一下。
//
// 退出码：有一家加载或后端没起来是 1；请求失败默认不算（CI 上的网络连不到国内的服务），带 --strict-request 时，
// 不是网络造成的请求失败也算 1。不传 --ignore-gpu-blocklist；不登录、不读写任何账号。
// --out 不给时在系统临时目录里新建一个；脚本只删它自己建的这个目录（--keep 保留，方便看产物）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES = path.join(ROOT, 'test/fixtures/folium-sources/deps-archive');
const SAMPLE_IDS = ['kugou', 'netease', 'qq'];
const MAIN_FILE = path.join(ROOT, 'test/manual/folium2DepsArchiveSmokeMain.cjs');
const requireHere = createRequire(import.meta.url);
const MiB = 1024 * 1024;
const { INSTALL_LIMITS } = requireHere('../../electron/modSystem/zipInstall.cjs');
/** 覆盖包的上限：现在 electron/modSystem/zipInstall.cjs 的（直接读它），和方案 §6.2 要提到的。 */
const LIMITS = {
    current: { file: INSTALL_LIMITS.maxFileBytes, total: INSTALL_LIMITS.maxTotalBytes, zip: INSTALL_LIMITS.maxArchiveBytes, entries: INSTALL_LIMITS.maxEntries },
    plan: { file: 64 * MiB, total: 96 * MiB },
};
/** 冒烟进程每次写一份新的报告（不会读到上一次留下的），跑完由本脚本合进 --report。 */
const LAUNCH_TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const strictRequest = args.includes('--strict-request');
const keep = args.includes('--keep');
const outGiven = option('--out');
const out = outGiven ? path.resolve(outGiven) : fs.mkdtempSync(path.join(os.tmpdir(), 'folia-deps-archive-'));
const reportFile = path.resolve(option('--report') ?? path.join(out, 'report.json'));
const mb = (bytes) => `${(bytes / MiB).toFixed(1)} MiB`;
const log = (message) => console.log(`[deps-smoke] ${message}`);

if (outGiven && fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    console.error(`[deps-smoke] ${out} 不是空目录；换一个，或者不给 --out（脚本只往它自己建的目录里写）`);
    process.exit(2);
}
/*
 * 输出目录往上不能有 node_modules：归档里的 require 找不到的包会顺着上级目录找，闭包漏掉的包就会从那里悄悄取到，
 * 「从归档加载」的结论就不可信了（比如 --out 指到仓库里）。
 */
for (let dir = path.dirname(out); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules'))) {
        console.error(`[deps-smoke] ${out} 的上级 ${dir} 里有 node_modules：归档里漏掉的包会从那里取到。换一个不在项目里的目录`);
        process.exit(2);
    }
    if (path.dirname(dir) === dir) break;
}
const runReport = path.join(out, 'electron-report.json');

/** Electron 发行目录里的东西在哪：要复制的目录、复制后的可执行文件、resources 目录。 */
const electronLayout = (appDir) => {
    const executable = requireHere('electron');
    if (process.platform === 'darwin') {
        const bundle = path.resolve(path.dirname(executable), '../..');
        const copied = path.join(appDir, path.basename(bundle));
        return {
            from: bundle,
            to: copied,
            executable: path.join(copied, 'Contents', 'MacOS', path.basename(executable)),
            resources: path.join(copied, 'Contents', 'Resources'),
            rename: null,
        };
    }
    const exeName = process.platform === 'win32' ? 'folia-smoke.exe' : 'folia-smoke';
    return {
        from: path.dirname(executable),
        to: appDir,
        executable: path.join(appDir, exeName),
        resources: path.join(appDir, 'resources'),
        rename: { from: path.join(appDir, path.basename(executable)), to: path.join(appDir, exeName) },
    };
};

/** 一个目录下的文件（相对路径与大小）。 */
const filesUnder = (dir) => {
    const found = [];
    const walk = (relative) => {
        for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
            const child = relative ? path.join(relative, entry.name) : entry.name;
            if (entry.isDirectory()) walk(child);
            else found.push({ name: child, bytes: fs.statSync(path.join(dir, child)).size });
        }
    };
    walk('');
    return found;
};

/** 模组目录打成覆盖包（zip，deflate）大约多大：逐个文件压一遍再加上每项的头。 */
const zipEstimate = (dir, files) => files.reduce((sum, file) => (
    sum + zlib.deflateRawSync(fs.readFileSync(path.join(dir, file.name))).length + 2 * (46 + file.name.length)
), 22);

const build = async (modsDir) => {
    const rows = [];
    for (const id of SAMPLE_IDS) {
        const startedAt = performance.now();
        const result = await buildSource(path.join(SAMPLES, id), { outRoot: modsDir });
        const buildMs = Math.round(performance.now() - startedAt);
        const files = filesUnder(result.outDir);
        const total = files.reduce((sum, file) => sum + file.bytes, 0);
        const largest = files.reduce((max, file) => (file.bytes > max.bytes ? file : max), { name: '', bytes: 0 });
        rows.push({ id, buildMs, archive: result.archive, modDir: { files: files.length, bytes: total, largest }, zipBytes: zipEstimate(result.outDir, files) });
        log(`${id}: 构建 ${buildMs} ms；${result.archive.name} ${mb(result.archive.bytes)}（${result.archive.packages} 个包、${result.archive.files} 个文件；`
            + `闭包与指纹 ${result.archive.closureMs} ms、打包 ${result.archive.packMs} ms）`);
    }
    return rows;
};

const layout = async (appDir) => {
    const where = electronLayout(appDir);
    const startedAt = performance.now();
    fs.cpSync(where.from, where.to, { recursive: true, verbatimSymlinks: true });
    if (where.rename) fs.renameSync(where.rename.from, where.rename.to);
    // 冒烟的主进程打成 app.asar：先摆进一个新建的临时目录，打完删掉它。
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-deps-smoke-app-'));
    try {
        fs.writeFileSync(path.join(staging, 'package.json'), `${JSON.stringify({ name: 'folia-deps-archive-smoke', version: '1.0.0', main: 'main.cjs' }, null, 2)}\n`);
        fs.copyFileSync(MAIN_FILE, path.join(staging, 'main.cjs'));
        await requireHere('@electron/asar').createPackage(staging, path.join(where.resources, 'app.asar'));
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    log(`安装版布局：${where.to}（复制 Electron ${Math.round(performance.now() - startedAt)} ms）`);
    return where;
};

const launch = (where) => new Promise((resolve) => {
    const env = { ...process.env, FOLIA_DEPS_SMOKE_REPORT: runReport };
    delete env.ELECTRON_RUN_AS_NODE;
    // Linux：复制出来的 chrome-sandbox 没有 setuid，CI 的容器里也起不了沙箱。
    const launchArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];
    const startedAt = performance.now();
    // 工作目录放在输出目录：上游有按 cwd 读 .env、config/ 的（网易云的 dotenv、QQ 的 config/user-info），别读到仓库里的。
    const child = spawn(where.executable, launchArgs, { cwd: out, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    // 总时限：冒烟进程卡住时（比如一个后端一直不答）不等到 CI 的 job 超时。
    const timer = setTimeout(() => {
        console.error(`[deps-smoke] 冒烟进程 ${LAUNCH_TIMEOUT_MS} ms 没有退出，结束它`);
        child.kill();
    }, LAUNCH_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, ms: Math.round(performance.now() - startedAt) });
    });
    child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ code: null, signal: null, ms: 0, error: error.message });
    });
});

const summarize = (built, run, report) => {
    let failed = false;
    console.log('');
    console.log(`=== 依赖归档冒烟：${report.platform}-${report.arch}，Electron ${report.electron}（Node ${report.node}），`
        + `isPackaged=${report.isPackaged}，宿主入口 ${report.appPath}，进程跑了 ${run.ms} ms ===`);
    for (const row of built) {
        const result = report.results.find((entry) => entry.dir === row.id);
        console.log('');
        console.log(`[${row.id}] 归档 ${row.archive.name}：${mb(row.archive.bytes)}，${row.archive.packages} 个包，${row.archive.files} 个文件；冷构建 ${row.buildMs} ms`);
        console.log(`  模组目录 ${row.modDir.files} 个文件 ${mb(row.modDir.bytes)}，最大的 ${row.modDir.largest.name} ${mb(row.modDir.largest.bytes)}；`
            + `估计覆盖包 zip ${mb(row.zipBytes)}`);
        const fits = (limits) => row.modDir.largest.bytes <= limits.file && row.modDir.bytes <= limits.total
            && (limits.zip === undefined || row.zipBytes <= limits.zip) && (limits.entries === undefined || row.modDir.files <= limits.entries);
        const { current, plan } = LIMITS;
        console.log(`  覆盖包上限：现在（单文件 ${mb(current.file)}、总量 ${mb(current.total)}、zip ${mb(current.zip)}）${fits(current) ? '放得下' : '放不下'}；`
            + `方案 §6.2（单文件 ${mb(plan.file)}、总量 ${mb(plan.total)}）${fits(plan) ? '放得下' : '放不下'}`);
        if (!result) {
            console.log('  没有结果（进程没跑到这一家）');
            failed = true;
            continue;
        }
        if (result.error) {
            console.log(`  失败：${result.error}`);
            failed = true;
            continue;
        }
        console.log(`  入口 index.cjs 加载 + activate ${result.entryMs} ms；require.cache 里来自归档的模块 ${result.report.archiveModules} 个（${result.report.archive ?? '无'}）`);
        for (const step of result.report.steps) {
            const tag = step.skipped ? '跳过' : step.ok ? '通过' : step.network ? '失败（网络）' : '失败';
            console.log(`  ${step.step.padEnd(7)} ${tag.padEnd(6)} ${String(step.ms).padStart(6)} ms  ${step.detail}`);
            if (!step.ok && (step.step !== 'request' || (strictRequest && !step.network))) failed = true;
        }
        if (result.report.archiveModules === 0) {
            console.log('  失败：require.cache 里没有来自归档的模块');
            failed = true;
        }
    }
    return failed;
};

const main = async () => {
    const appDir = path.join(out, 'app');
    fs.mkdirSync(appDir, { recursive: true });
    const where = await layout(appDir);
    const built = await build(path.join(where.resources, 'builtin-mods'));
    const run = await launch(where);
    if (run.error || !fs.existsSync(runReport)) {
        console.error(`[deps-smoke] 冒烟进程没有写出报告（退出码 ${run.code}，信号 ${run.signal}${run.error ? `，${run.error}` : ''}）`);
        return 1;
    }
    const report = JSON.parse(fs.readFileSync(runReport, 'utf8'));
    if (report.error) {
        console.error(`[deps-smoke] 冒烟进程出错：${report.error}`);
        return 1;
    }
    fs.writeFileSync(reportFile, `${JSON.stringify({ ...report, built, run }, null, 2)}\n`);
    const failed = summarize(built, run, report);
    console.log('');
    log(`报告：${reportFile}`);
    return failed || run.code !== 0 ? 1 : 0;
};

main().then(
    (code) => {
        if (!outGiven && !keep) {
            // 只删脚本自己在系统临时目录里建的目录；报告留着的话先挪出去。
            if (reportFile.startsWith(out + path.sep) && fs.existsSync(reportFile)) {
                const kept = path.join(os.tmpdir(), `folia-deps-archive-report-${process.pid}.json`);
                fs.copyFileSync(reportFile, kept);
                log(`报告挪到 ${kept}`);
            }
            try {
                fs.rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
            } catch (error) {
                // Electron 刚退出时它的子进程可能还占着可执行文件（Windows）：删不掉只记一行，结果不变。
                log(`临时目录 ${out} 没删掉（${error.code ?? error.message}），留给系统清理`);
            }
        }
        process.exit(code);
    },
    (error) => {
        console.error('[deps-smoke] 失败', error);
        process.exit(1);
    },
);
