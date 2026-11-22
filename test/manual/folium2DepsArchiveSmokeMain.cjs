const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

// test/manual/folium2DepsArchiveSmokeMain.cjs
// 依赖归档冒烟的 Electron 主进程（folium2DepsArchiveSmoke.mjs 把它打进 resources/app.asar，像安装版的宿主代码一样
// 在 asar 里跑）。逐个加载 resources/builtin-mods/ 下的样例模组的 index.cjs，用一个只有样例用到的几个成员的
// 替身 api 调 activate，再调它的 rpc `smoke`：样例从自己目录里的 deps.<指纹>.asar 加载上游库、起后端、发一个不需要
// 登录的请求。结果写进 FOLIA_DEPS_SMOKE_REPORT 指的文件。不开窗口；userData 放在系统临时目录里一个新建的目录，
// 跑完删掉。

const SMOKE_TIMEOUT_MS = 150000;
const reportFile = process.env.FOLIA_DEPS_SMOKE_REPORT;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-deps-smoke-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();

const withTimeout = (work, ms, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(work).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
    );
});

/** 样例用到的 api 成员：log、onDispose、rpc.handle、cache.dir。其余成员不在，样例用到就会抛错、在报告里看得到。 */
const createApi = (modId) => {
    const handlers = new Map();
    const disposers = [];
    const cacheDir = path.join(userData, 'mods-cache', modId);
    const line = (level) => (...args) => console.log(`[${modId}] ${level}`, ...args);
    const api = {
        log: { info: line('info'), warn: line('warn'), error: line('error'), debug: line('debug') },
        onDispose: (disposer) => { disposers.push(disposer); },
        rpc: { handle: (name, handler) => { handlers.set(name, handler); } },
        cache: { dir: () => { fs.mkdirSync(cacheDir, { recursive: true }); return cacheDir; } },
    };
    const dispose = () => {
        for (const disposer of disposers.splice(0)) {
            try {
                disposer();
            } catch (error) {
                console.warn(`[${modId}] dispose failed`, error);
            }
        }
    };
    return { api, handlers, dispose };
};

const errorText = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

const smokeOne = async (dir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
    const archive = fs.readdirSync(dir).find((name) => /^deps\.[0-9a-f]+\.asar$/.test(name)) ?? null;
    const result = { dir: path.basename(dir), modId: manifest.id, archive, entryMs: null, totalMs: null, report: null, error: null };
    const startedAt = performance.now();
    const { api, handlers, dispose } = createApi(manifest.id);
    try {
        const entryStartedAt = performance.now();
        const loaded = require(path.join(dir, 'index.cjs'));
        const activate = loaded.default ?? loaded;
        activate(api);
        result.entryMs = Math.round(performance.now() - entryStartedAt);
        const smoke = handlers.get('smoke');
        if (!smoke) throw new Error('the sample did not register rpc "smoke"');
        result.report = await withTimeout(smoke(), SMOKE_TIMEOUT_MS, 'smoke');
    } catch (error) {
        result.error = errorText(error);
    } finally {
        result.totalMs = Math.round(performance.now() - startedAt);
        dispose();
    }
    return result;
};

const run = async () => {
    const modsDir = path.join(process.resourcesPath, 'builtin-mods');
    const dirs = fs.readdirSync(modsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(modsDir, entry.name, 'mod.json')))
        .map((entry) => path.join(modsDir, entry.name))
        .sort();
    const results = [];
    for (const dir of dirs) {
        console.log(`[smoke] ${path.basename(dir)}: start`);
        const result = await smokeOne(dir);
        console.log(`[smoke] ${path.basename(dir)}: ${JSON.stringify(result)}`);
        results.push(result);
    }
    return {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        node: process.versions.node,
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        results,
    };
};

// 不管哪一步抛错（包括写报告本身），最后都要 app.exit：没有窗口，进程不会自己退。
const finish = async () => {
    let code = 0;
    try {
        const report = await app.whenReady().then(run);
        if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        console.error('[smoke] failed', error);
        code = 2;
        try {
            if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify({ error: errorText(error) }, null, 2)}\n`);
        } catch (writeError) {
            console.error('[smoke] could not write the report', writeError);
        }
    } finally {
        try {
            fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        } catch {
            // 还有文件开着（Windows）：留给系统清理临时目录。
        }
        app.exit(code);
    }
};
void finish();

// 没有窗口：别让「所有窗口都关了」之类的默认行为提前退出。
app.on('window-all-closed', () => {});
