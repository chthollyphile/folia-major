#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

// test/manual/folium2DepsAsarProbe.cjs
// Folium 2.0 方案 §6.2 / §13 的前提验证：模组目录里的 deps.asar 能不能在 Electron 主进程里被
// createRequire 和 worker_threads 读到。用法（仓库根目录）：
//
//   node test/manual/folium2DepsAsarProbe.cjs
//
// 脚本先用 @electron/asar 把一个小 CommonJS 包打成 deps.asar，再用仓库自己的 Electron 把本文件当主进程
// 跑一遍（隔离的 --user-data-dir，不开窗口，关硬件加速）。两个位置各验一遍：
//   in-app   模组目录在应用目录里面（test-results/ 下临时搭的一个应用目录，模拟随包的内置模组）
//   outside  模组目录在应用目录外面（系统临时目录里的 userData/mods/，模拟用户模组目录）
// 每个位置三项必验：createRequire 加载、从 asar 里的路径起 Worker、清 require.cache 后重新加载；
// outside 那一遍通过就是「应用目录之外同样可以」那一项。另有四项不在方案前提里的补充观察：
// Worker 入口在磁盘上、依赖在 asar 里；主进程的 fs 把 deps.asar 看成什么；deps.asar 在原路径被换成
// 新内容之后再加载；同样的新内容换一个文件名再加载。
// 退出码 0 表示必验的各项都通过；补充项不影响退出码。

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IS_ELECTRON_MAIN = Boolean(process.versions.electron) && process.type === 'browser';
const PACKAGE_NAME = 'folium-probe-dep';

// ---- 样例包：多个文件、带子目录、用 require 读自己目录下的别的文件 ----

const fixtureFiles = (version) => ({
    'node_modules/folium-probe-dep/package.json': JSON.stringify({ name: PACKAGE_NAME, version: `${version}.0.0`, main: 'index.js' }),
    // 入口：相对 require、按目录扫 module/（网易云的上游库就是这样加载接口的）、读数据文件、再往里一层的依赖。
    'node_modules/folium-probe-dep/index.js': [
        "'use strict';",
        "const fs = require('fs');",
        "const path = require('path');",
        "const { add } = require('./lib/math');",
        "const inner = require('folium-probe-inner');",
        "const moduleDir = path.join(__dirname, 'module');",
        'const modules = {};',
        "for (const file of fs.readdirSync(moduleDir).filter(name => name.endsWith('.js')).sort()) {",
        "    modules[path.basename(file, '.js')] = require(path.join(moduleDir, file));",
        '}',
        "const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'table.json'), 'utf8'));",
        'module.exports = {',
        `    version: ${version},`,
        '    // 每加载一次换一个值：用它分辨是缓存里的旧实例还是重新加载的。',
        '    instance: `${Date.now()}-${Math.random()}`,',
        '    sum: add(2, 3),',
        '    modules: Object.fromEntries(Object.entries(modules).map(([name, run]) => [name, run()])),',
        '    data,',
        '    inner: inner.name,',
        "    stat: fs.statSync(path.join(__dirname, 'lib', 'math.js')).isFile(),",
        "    exists: fs.existsSync(path.join(__dirname, 'data', 'table.json')),",
        '    filename: __filename,',
        '};',
        '',
    ].join('\n'),
    'node_modules/folium-probe-dep/lib/math.js': "'use strict';\nexports.add = (a, b) => a + b;\n",
    'node_modules/folium-probe-dep/module/alpha.js': "'use strict';\nmodule.exports = () => 'alpha';\n",
    'node_modules/folium-probe-dep/module/beta.js': "'use strict';\nconst { add } = require('../lib/math');\nmodule.exports = () => `beta:${add(20, 22)}`;\n",
    'node_modules/folium-probe-dep/data/table.json': JSON.stringify({ rows: [1, 2, 3], version }),
    // Worker 入口在 asar 里：同样 require 自己目录下的文件和里一层的依赖。
    'node_modules/folium-probe-dep/worker.js': [
        "'use strict';",
        "const { parentPort, workerData } = require('worker_threads');",
        "const dep = require('./index.js');",
        'parentPort.postMessage({ sum: dep.sum, modules: dep.modules, inner: dep.inner, version: dep.version, echo: workerData, filename: __filename });',
        '',
    ].join('\n'),
    'node_modules/folium-probe-inner/package.json': JSON.stringify({ name: 'folium-probe-inner', version: '1.0.0', main: 'index.js' }),
    'node_modules/folium-probe-inner/index.js': "'use strict';\nexports.name = 'inner-dep';\n",
    // 第二版多一个文件、一个文件变长：归档里各文件的位置都变了，读到旧的文件表就会出错或读到旧内容。
    ...(version >= 2 ? {
        'node_modules/folium-probe-dep/module/gamma.js': `'use strict';\n// ${'padding '.repeat(200)}\nmodule.exports = () => 'gamma';\n`,
        'node_modules/folium-probe-dep/lib/math.js': `'use strict';\n// ${'longer '.repeat(300)}\nexports.add = (a, b) => a + b;\n`,
    } : {}),
});

const writeFixture = (directory, version) => {
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [relative, content] of Object.entries(fixtureFiles(version))) {
        const file = path.join(directory, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
};

// 模组目录的布局：<modDir>/deps.asar（依赖闭包）、<modDir>/worker.cjs（磁盘上的 Worker 入口）。
const packMod = async (modDir, stagingDir, version) => {
    const asar = require('@electron/asar');
    writeFixture(stagingDir, version);
    fs.mkdirSync(modDir, { recursive: true });
    await asar.createPackage(stagingDir, path.join(modDir, 'deps.asar'));
    fs.writeFileSync(path.join(modDir, 'worker.cjs'), [
        "'use strict';",
        "const path = require('node:path');",
        "const { createRequire } = require('node:module');",
        "const { parentPort, workerData } = require('node:worker_threads');",
        "const requireDep = createRequire(path.join(__dirname, 'deps.asar', 'node_modules', '_'));",
        `const dep = requireDep('${PACKAGE_NAME}');`,
        'parentPort.postMessage({ sum: dep.sum, modules: dep.modules, inner: dep.inner, version: dep.version, echo: workerData });',
        '',
    ].join('\n'));
};

// ---- 外层：普通 Node 里准备目录、打包、拉起 Electron ----

const runOuter = async () => {
    const electronPath = require('electron');
    if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
        console.error('找不到 Electron 二进制；先跑 `node node_modules/electron/install.js`。');
        process.exit(2);
    }
    // 应用目录：只有一个转到本文件的入口，内置模组放在它下面。
    const inAppRoot = path.join(REPO_ROOT, 'test-results', 'folium2-deps-asar');
    const appDir = path.join(inAppRoot, 'app');
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folium2-deps-asar-'));
    const userData = path.join(outsideRoot, 'userData');
    const locations = {
        'in-app': path.join(appDir, 'builtin-mods', 'probe'),
        outside: path.join(userData, 'mods', 'probe'),
    };
    try {
        fs.rmSync(inAppRoot, { recursive: true, force: true });
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'folium2-deps-asar-probe', main: 'main.cjs' }));
        fs.writeFileSync(path.join(appDir, 'main.cjs'), `require(${JSON.stringify(__filename)});
`);
        for (const [name, modDir] of Object.entries(locations)) {
            await packMod(modDir, path.join(outsideRoot, `staging-${name}`), 1);
        }
        // 「换成新内容」那一项用的第二版，先打好放在旁边，Electron 里只做替换。
        const nextAsar = path.join(outsideRoot, 'next', 'deps.asar');
        await packMod(path.dirname(nextAsar), path.join(outsideRoot, 'staging-next'), 2);

        const env = { ...process.env, FOLIUM2_PROBE_LOCATIONS: JSON.stringify(locations), FOLIUM2_PROBE_NEXT_ASAR: nextAsar };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawnSync(electronPath, [`--user-data-dir=${userData}`, appDir], {
            cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 120000,
        });
        process.stdout.write(child.stdout || '');
        if (child.stderr) process.stderr.write(child.stderr);
        if (child.error) console.error('Electron 没有跑起来：', child.error);
        process.exitCode = child.status === null ? 2 : child.status;
    } finally {
        fs.rmSync(inAppRoot, { recursive: true, force: true });
        try {
            fs.rmSync(outsideRoot, { recursive: true, force: true });
        } catch (error) {
            console.warn(`临时目录没有删干净：${outsideRoot}`, error.message);
        }
    }
};

// ---- 里层：Electron 主进程里的检查 ----

const runWorker = (file, workerData) => new Promise((resolve, reject) => {
    const { Worker } = require('node:worker_threads');
    const worker = new Worker(file, { workerData });
    const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('worker 10 秒没有回答'));
    }, 10000);
    worker.once('message', (message) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve(message);
    });
    worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
    });
});

// 和 modSystem 的 purgeModuleCache 同一个做法：按目录前缀删 require.cache。
const purgeModuleCache = (directory) => {
    const prefix = directory.endsWith(path.sep) ? directory : directory + path.sep;
    let removed = 0;
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(prefix)) {
            delete require.cache[key];
            removed += 1;
        }
    }
    return removed;
};

const expectDep = (dep, version) => {
    const problems = [];
    if (dep.sum !== 5) problems.push(`sum=${dep.sum}`);
    if (dep.modules?.alpha !== 'alpha' || dep.modules?.beta !== 'beta:42') problems.push(`modules=${JSON.stringify(dep.modules)}`);
    if ((dep.modules?.gamma === 'gamma') !== (version >= 2)) problems.push(`gamma=${dep.modules?.gamma}`);
    if (dep.inner !== 'inner-dep') problems.push(`inner=${dep.inner}`);
    if (dep.version !== version) problems.push(`version=${dep.version}, 应为 ${version}`);
    if (dep.data && (dep.data.rows?.length !== 3 || dep.data.version !== version)) problems.push(`data=${JSON.stringify(dep.data)}`);
    if (dep.stat === false || dep.exists === false) problems.push(`stat=${dep.stat} exists=${dep.exists}`);
    if (problems.length) throw new Error(`加载到的内容不对：${problems.join('; ')}`);
};

const probeLocation = async (name, modDir, nextAsar) => {
    const results = [];
    const step = async (id, required, run) => {
        try {
            results.push({ location: name, id, required, ok: true, detail: await run() });
        } catch (error) {
            results.push({ location: name, id, required, ok: false, detail: `${error?.code ? `${error.code}: ` : ''}${error?.message ?? error}` });
        }
    };
    const depsRoot = path.join(modDir, 'deps.asar', 'node_modules');
    const requireDep = () => createRequire(path.join(depsRoot, '_'))(PACKAGE_NAME);
    let first = null;

    await step('createRequire', true, () => {
        first = requireDep();
        expectDep(first, 1);
        const cached = Object.keys(require.cache).filter(key => key.startsWith(modDir + path.sep)).length;
        return `加载自 ${path.relative(modDir, first.filename)}；require.cache 里这个目录下 ${cached} 条`;
    });
    await step('worker-in-asar', true, async () => {
        const message = await runWorker(path.join(depsRoot, PACKAGE_NAME, 'worker.js'), { ping: name });
        expectDep(message, 1);
        if (message.echo?.ping !== name) throw new Error(`workerData 没有传到：${JSON.stringify(message.echo)}`);
        return `Worker 入口 ${path.relative(modDir, message.filename)}，回答 sum=${message.sum} modules=${JSON.stringify(message.modules)}`;
    });
    await step('worker-on-disk', false, async () => {
        const message = await runWorker(path.join(modDir, 'worker.cjs'), { ping: name });
        expectDep(message, 1);
        return `磁盘上的 worker.cjs 经 createRequire 读到 asar 里的依赖，sum=${message.sum}`;
    });
    await step('purge-reload', true, () => {
        if (!first) throw new Error('第一次加载没有成功，无从比较');
        const again = requireDep();
        if (again.instance !== first.instance) throw new Error('没清缓存就拿到了新实例');
        const removed = purgeModuleCache(modDir);
        const fresh = requireDep();
        expectDep(fresh, 1);
        if (fresh.instance === first.instance) throw new Error('清了缓存，拿到的还是旧实例');
        return `清掉 ${removed} 条后重新加载，得到新实例`;
    });
    await step('asar-seen-by-fs', false, () => {
        // 主进程里打过补丁的 fs 把 .asar 当目录：扫模组目录的代码（摘要、占用、安装）会走进去。
        const patched = fs.statSync(path.join(modDir, 'deps.asar'));
        const original = require('original-fs').statSync(path.join(modDir, 'deps.asar'));
        const inside = fs.readdirSync(path.join(modDir, 'deps.asar', 'node_modules')).sort().join(',');
        // 模组系统算摘要、装 zip 时的两步：列模组目录，再把每个文件整个读进来。
        const listed = fs.readdirSync(modDir, { withFileTypes: true }).find(entry => entry.name === 'deps.asar');
        let whole;
        try {
            whole = `读到 ${fs.readFileSync(path.join(modDir, 'deps.asar')).length} 字节`;
        } catch (error) {
            whole = `抛错 ${error.code ?? ''} ${String(error.message).split(' in ')[0].trim()}`;
        }
        const wholeOriginal = require('original-fs').readFileSync(path.join(modDir, 'deps.asar')).length;
        return `fs.statSync: isDirectory=${patched.isDirectory()} isFile=${patched.isFile()}；original-fs.statSync: isFile=${original.isFile()} size=${original.size}；`
            + `fs.readdirSync(deps.asar/node_modules)=${inside}；fs.readdirSync(模组目录) 里它 isDirectory=${listed?.isDirectory()} isFile=${listed?.isFile()}；`
            + `fs.readFileSync(deps.asar) ${whole}；original-fs.readFileSync 读到 ${wholeOriginal} 字节`;
    });
    await step('replace-reload', false, () => {
        // 覆盖副本、开发时重建都会把 deps.asar 换成新内容。这里原地替换文件，再清缓存、重新加载。
        // 复制 .asar 文件本身要用 original-fs：打过补丁的 fs 会把源路径当成归档里的路径。
        require('original-fs').copyFileSync(nextAsar, path.join(modDir, 'deps.asar'));
        const removed = purgeModuleCache(modDir);
        const replaced = requireDep();
        expectDep(replaced, 2);
        return `替换文件、清掉 ${removed} 条后读到新内容（version ${replaced.version}，module/ 下 ${Object.keys(replaced.modules).join(',')}）`;
    });
    await step('new-name-reload', false, () => {
        // 同一份新内容换一个文件名：Electron 没读过这个路径，不会用到旧归档的文件表。
        require('original-fs').copyFileSync(nextAsar, path.join(modDir, 'deps.v2.asar'));
        const renamed = createRequire(path.join(modDir, 'deps.v2.asar', 'node_modules', '_'))(PACKAGE_NAME);
        expectDep(renamed, 2);
        return `新内容放在 deps.v2.asar 里能读到（version ${renamed.version}，module/ 下 ${Object.keys(renamed.modules).join(',')}）`;
    });
    return results;
};

const runInner = async () => {
    const { app } = require('electron');
    app.disableHardwareAcceleration();
    await app.whenReady();
    const locations = JSON.parse(process.env.FOLIUM2_PROBE_LOCATIONS || '{}');
    const nextAsar = process.env.FOLIUM2_PROBE_NEXT_ASAR;
    const appPath = app.getAppPath();
    console.log(`Electron ${process.versions.electron} / Node ${process.versions.node} / ${process.platform}-${process.arch}`);
    console.log(`应用目录 ${appPath}`);
    console.log(`userData ${app.getPath('userData')}`);
    const all = [];
    for (const [name, modDir] of Object.entries(locations)) {
        const insideApp = !path.relative(appPath, modDir).startsWith('..') && !path.isAbsolute(path.relative(appPath, modDir));
        console.log(`\n[${name}] 模组目录 ${modDir}（${insideApp ? '在应用目录里面' : '在应用目录外面'}）`);
        if ((name === 'outside') === insideApp) {
            all.push({ location: name, id: 'location', required: true, ok: false, detail: '目录位置和这一遍要验的不符' });
            console.log('  FAIL location: 目录位置和这一遍要验的不符');
        }
        for (const result of await probeLocation(name, modDir, nextAsar)) {
            all.push(result);
            console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${result.id}${result.required ? '' : '（补充）'}: ${result.detail}`);
        }
    }
    const failedRequired = all.filter(result => result.required && !result.ok);
    console.log(`\n必验项 ${all.filter(result => result.required).length} 条，未通过 ${failedRequired.length} 条；补充项未通过 ${all.filter(result => !result.required && !result.ok).length} 条`);
    console.log(`RESULT_JSON ${JSON.stringify(all)}`);
    app.exit(failedRequired.length ? 1 : 0);
};

(IS_ELECTRON_MAIN ? runInner() : runOuter()).catch((error) => {
    console.error(error);
    if (IS_ELECTRON_MAIN) require('electron').app.exit(2);
    else process.exitCode = 2;
});
