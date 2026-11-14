#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VENDOR_ENTRY, VENDOR_PLACEHOLDER, bundleEntry } from './bundle.mjs';
import {
    checkPinnedVersion, closureFiles, closureFingerprint, closureShape, dependencyClosure, locatePackage, packArchive, readSourcePackage,
} from './dependencies.mjs';
import { toTraditionalLocale } from './locales.mjs';
// dev/sources/build.mjs
// 把仓库里的音源模组（sources/<id>/）构建成能加载的模组目录（dist-mods/<id>/），Folium 2.0 方案 §6.2。
// 开发版的模组系统把 dist-mods/ 当内置目录（builtin 层级）读，打包时 extraResources 把它放到
// resources/builtin-mods/。用法见 dev/sources/README.md：
//
//   npm run sources:build                      构建 sources/ 下的全部（或 FOLIA_BUNDLED_SOURCES 列的那些）
//   npm run sources:build -- --watch           先全量构建，再盯着源文件，改了哪个只重建哪个
//   npm run sources:build -- --extra <目录>    另外构建一个不在 sources/ 里的音源目录（测试夹具）
//   npm run sources:build -- --stamp <package.json>   把 foliaBundledSources 写进那份 package.json
//
// 每个模组目录的产物：mod.json、client.mjs、index.cjs、<worker>.cjs、vendor.<指纹>.mjs、deps.<指纹>.asar、
// locales/（zh-TW.json 由 zh-CN.json 生成）、assets/、README.md，最后写 build.json（产物的指纹与文件表）。
// 开发版的主进程盯着 build.json：它变了就差量重载（只重载这一个模组）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireHere = createRequire(import.meta.url);
const { validateManifest } = requireHere('../../electron/modSystem/manifest.cjs');
const { BUILTIN_SOURCE_TABLE, BUILTIN_SOURCE_IDS } = requireHere('../../electron/modSystem/builtinSources.cjs');

export const DEFAULT_SOURCES_ROOT = path.join(ROOT, 'sources');
export const DEFAULT_OUT_ROOT = path.join(ROOT, 'dist-mods');
export const BUILD_STAMP = 'build.json';

const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'];
const firstExisting = (base) => ENTRY_EXTENSIONS.map((extension) => `${base}${extension}`).find((file) => fs.existsSync(file)) ?? null;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const log = (message) => console.log(`[sources] ${message}`);

/** 一个目录是不是音源目录：有 mod.json。 */
const isSourceDir = (dir) => fs.existsSync(path.join(dir, 'mod.json'));

/** `root` 下的音源目录名（排好序）；目录不存在时是空的。 */
export const listSourceIds = (root = DEFAULT_SOURCES_ROOT) => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && isSourceDir(path.join(root, entry.name)))
        .map((entry) => entry.name)
        .sort();
};

/*
 * 这次带哪些：FOLIA_BUNDLED_SOURCES 没设是全部；设成空是一个都不带；否则是逗号隔开的目录名（就是音源的短 id），
 * 不在 sources/ 里的报错（拼错了不能悄悄少带一个）。
 */
export const selectSourceIds = (available, bundled = process.env.FOLIA_BUNDLED_SOURCES) => {
    if (bundled === undefined) return [...available];
    const wanted = bundled.split(',').map((id) => id.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !available.includes(id));
    if (unknown.length > 0) {
        throw new Error(`FOLIA_BUNDLED_SOURCES 里的 ${unknown.join('、')} 不在 sources/ 里（有的是：${available.join('、') || '无'}）`);
    }
    return available.filter((id) => wanted.includes(id));
};

/**
 * 安装包的 `foliaBundledSources`：构建了的那些模组在受信表（electron/modSystem/builtinSources.cjs）里那一行的短音源 id。
 * 不在受信表里的模组不算内置音源（它的音源是 folium.<模组 id>.<名字>）。
 */
export const bundledSourceIds = (modIds) => [...new Set(modIds.flatMap((modId) => (
    Object.hasOwn(BUILTIN_SOURCE_TABLE, modId) ? BUILTIN_SOURCE_TABLE[modId].sources : []
)))];

/**
 * `--stamp` 现在能不能写 `ids`：不能时交回原因。九家还没全迁成模组、S8 还没做打包形态之前，声明里少一家，就等于
 * 宣布这个安装「不带」它，第三方模组经确认就能接管它的短 id 和旧登录（方案 §5.1），而它其实还静态编在宿主里。所以
 * 只放行九家都在的声明（这时写不写都一样）；S8 定下不带内置音源的打包形态时去掉这道闸。
 */
export const stampRefusal = (ids) => {
    const missing = BUILTIN_SOURCE_IDS.filter((id) => !ids.includes(id));
    return missing.length > 0
        ? `--stamp 会声明这个安装不带 ${missing.join('、')}；S8 之前不能这样打包（九家还没全迁成模组，见 dev/sources/README.md）`
        : null;
};

/** 把 `ids` 写进 `packageJsonPath` 的 foliaBundledSources（和 CI 写 foliaReleaseChannel 一样，在打包前写）。 */
export const stampBundledSources = (packageJsonPath, ids) => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    pkg.foliaBundledSources = ids;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

export { toTraditionalLocale };

const listFilesUnder = (dir) => {
    const found = [];
    const walk = (relative) => {
        for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(child);
            else if (entry.isFile()) found.push(child);
        }
    };
    walk('');
    return found.sort();
};

/*
 * 读并核对音源目录的 mod.json：Folium 2 的音源类模组；入口字段与源码目录对得上（有 client/ 就得写 "client.mjs"，
 * 有 main/ 就得写 "index.cjs"，有 locales/、assets/ 就得写同名目录），反过来写了的目录也得在。
 */
const readSourceManifest = (sourceDir, entries) => {
    const file = path.join(sourceDir, 'mod.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const problems = [];
    const validation = validateManifest(raw);
    if (!validation.ok) problems.push(...validation.errors);
    if (raw.folium !== 2) problems.push('mod.folium 必须是 2（音源模组只给 Folium 2）');
    if (!Array.isArray(raw.sources) || raw.sources.length === 0) problems.push('mod.sources 要列出这个模组提供的音源');
    const expect = (field, present, value) => {
        if (present && raw[field] !== value) problems.push(`有 ${field === 'main' ? 'main/' : `${field}/`} 目录，mod.${field} 要写成 "${value}"`);
        if (!present && raw[field] !== undefined && raw[field] !== null) problems.push(`mod.${field} 写了 "${raw[field]}"，源码目录里却没有对应的入口或目录`);
    };
    expect('client', Boolean(entries.client), 'client.mjs');
    expect('main', Boolean(entries.main), 'index.cjs');
    expect('locales', fs.existsSync(path.join(sourceDir, 'locales')), 'locales');
    expect('assets', fs.existsSync(path.join(sourceDir, 'assets')), 'assets');
    if (problems.length > 0) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
    return raw;
};

/** 语言表：原样带上，再由 zh-CN.json 生成 zh-TW.json；源码里手写 zh-TW.json 算错。 */
const localeOutputs = (sourceDir) => {
    const dir = path.join(sourceDir, 'locales');
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    if (names.includes('zh-TW.json')) {
        throw new Error(`${path.join(dir, 'zh-TW.json')}：繁体由构建从 zh-CN.json 生成，不手写`);
    }
    if (!names.includes('zh-CN.json')) throw new Error(`${dir} 里要有 zh-CN.json（zh-TW.json 由它生成）`);
    const outputs = names.map((name) => ({ name: `locales/${name}`, data: fs.readFileSync(path.join(dir, name)) }));
    const simplified = JSON.parse(fs.readFileSync(path.join(dir, 'zh-CN.json'), 'utf8'));
    outputs.push({ name: 'locales/zh-TW.json', data: Buffer.from(`${JSON.stringify(toTraditionalLocale(simplified), null, 2)}\n`) });
    return outputs;
};

/** 一个音源目录的源码入口：client/index.*、main/index.*、package.json 的 folia.workers。 */
const sourceEntries = (sourceDir, workers) => ({
    client: firstExisting(path.join(sourceDir, 'client', 'index')),
    main: firstExisting(path.join(sourceDir, 'main', 'index')),
    workers: Object.entries(workers).map(([name, entry]) => ({ name, input: path.join(sourceDir, entry) })),
});

/** 产物写出：内容没变的不重写（mtime 不动），返回这次实际改了的文件。 */
const writeIfChanged = (file, data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, file);
    return true;
};

const readStamp = (outDir) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(outDir, BUILD_STAMP), 'utf8'));
    } catch {
        return null;
    }
};

/*
 * 构建一个音源目录到 `outRoot/<目录名>/`。`cache`（watch 时跨次保留）记着依赖闭包的结构和归档名：
 * 结构没变就不重算内容指纹，也不重新打归档。
 * @returns {Promise<{ id: string, modId: string, outDir: string, fingerprint: string, changed: string[], warnings: string[] }>}
 */
export const buildSource = async (sourceDir, { outRoot = DEFAULT_OUT_ROOT, cache = new Map() } = {}) => {
    const id = path.basename(sourceDir);
    const outDir = path.join(outRoot, id);
    const { specs, modes, workers } = readSourcePackage(sourceDir);
    const entries = sourceEntries(sourceDir, workers);
    const manifest = readSourceManifest(sourceDir, entries);
    if (!entries.client) throw new Error(`${sourceDir}: 音源模组要有 client/index.ts（音源只由 client 注册）`);

    for (const [name, spec] of specs) {
        const dir = locatePackage(name, spec, sourceDir);
        if (dir) checkPinnedVersion(name, spec, dir);
        else if (modes.get(name) !== 'native') throw new Error(`${name}: 没有装（从 ${sourceDir} 往上找不到 node_modules/${name}）`);
    }

    const outputs = [];
    const asarRoots = [...modes].filter(([, mode]) => mode === 'asar').map(([name]) => name);
    let asarName = null;
    if (asarRoots.length > 0) {
        if (!entries.main && entries.workers.length === 0) throw new Error(`${sourceDir}: 声明了 asar 依赖（${asarRoots.join('、')}），却没有 main 入口或 worker`);
        const closure = dependencyClosure(asarRoots, specs, sourceDir);
        const shape = closureShape(closure);
        const known = cache.get(id);
        if (known?.shape === shape && fs.existsSync(path.join(outDir, known.asarName))) {
            asarName = known.asarName;
        } else {
            const files = closureFiles(closure);
            asarName = `deps.${closureFingerprint(files)}.asar`;
            if (!fs.existsSync(path.join(outDir, asarName))) {
                fs.mkdirSync(outDir, { recursive: true });
                const temporary = path.join(outDir, `.${asarName}.${process.pid}.tmp`);
                await packArchive(files, temporary);
                fs.renameSync(temporary, path.join(outDir, asarName));
                log(`${id}: ${asarName}（${closure.size} 个包、${files.length} 个文件）`);
            }
            cache.set(id, { shape, asarName });
        }
    }

    const warnings = [];
    const vendorSpecifiers = new Set();
    const context = { sourceDir, specs, modes, asarName, vendorSpecifiers };
    const bundle = async (input, kind, name) => {
        const result = await bundleEntry({ input, kind, context });
        warnings.push(...result.warnings.map((warning) => `${name}: ${warning}`));
        outputs.push({ name, data: Buffer.from(result.code) });
    };
    // main 与 worker 先打：它们用到的 vendor 说明符收齐了才打 vendor 文件。
    if (entries.main) await bundle(entries.main, 'main', 'index.cjs');
    for (const worker of entries.workers) await bundle(worker.input, 'worker', `${worker.name}.cjs`);
    if (vendorSpecifiers.size > 0) {
        // vendor 文件按内容指纹起名，再把 main 与 worker 里的占位换成它（bundle.mjs 的 VENDOR_PLACEHOLDER）。
        const result = await bundleEntry({ input: VENDOR_ENTRY, kind: 'vendor', context });
        warnings.push(...result.warnings.map((warning) => `vendor: ${warning}`));
        const vendorName = `vendor.${sha256(result.code).slice(0, 16)}.mjs`;
        const placeholder = JSON.stringify(VENDOR_PLACEHOLDER);
        for (const output of outputs) output.data = Buffer.from(output.data.toString('utf8').split(placeholder).join(JSON.stringify(`./${vendorName}`)));
        outputs.push({ name: vendorName, data: Buffer.from(result.code) });
    }
    await bundle(entries.client, 'client', 'client.mjs');

    outputs.push(...localeOutputs(sourceDir));
    const assets = path.join(sourceDir, 'assets');
    if (fs.existsSync(assets)) {
        outputs.push(...listFilesUnder(assets).map((name) => ({ name: `assets/${name}`, data: fs.readFileSync(path.join(assets, name)) })));
    }
    if (fs.existsSync(path.join(sourceDir, 'README.md'))) outputs.push({ name: 'README.md', data: fs.readFileSync(path.join(sourceDir, 'README.md')) });
    outputs.push({ name: 'mod.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });

    // 写出：先所有产物，再删上次有、这次没有的（删不掉的是开着的旧归档，下次再删），最后写 build.json。
    const changed = outputs.filter((output) => writeIfChanged(path.join(outDir, ...output.name.split('/')), output.data)).map((output) => output.name);
    const files = [...outputs.map((output) => output.name), ...(asarName ? [asarName] : [])].sort();
    const previous = readStamp(outDir);
    const stale = [...new Set([...(previous?.files ?? []), ...fs.readdirSync(outDir).filter((name) => /^(deps\.[0-9a-f]+\.asar|vendor\.[0-9a-f]+\.mjs)$/.test(name))])]
        .filter((name) => !files.includes(name));
    for (const name of stale) {
        try {
            fs.rmSync(path.join(outDir, ...name.split('/')), { force: true });
        } catch (error) {
            log(`${id}: 旧文件 ${name} 还删不掉（多半是开着的应用还读着它），下次构建再删：${error.code ?? error.message}`);
        }
    }
    const hash = crypto.createHash('sha256');
    for (const output of [...outputs].sort((a, b) => (a.name < b.name ? -1 : 1))) hash.update(`${output.name}\0${sha256(output.data)}\n`);
    if (asarName) hash.update(`${asarName}\n`);
    const fingerprint = hash.digest('hex').slice(0, 16);
    const stamp = { fingerprint, modId: manifest.id, source: path.relative(ROOT, sourceDir).split(path.sep).join('/'), files };
    if (previous?.fingerprint !== fingerprint || JSON.stringify(previous?.files) !== JSON.stringify(files)) {
        writeIfChanged(path.join(outDir, BUILD_STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
    }
    return { id, modId: manifest.id, outDir, fingerprint, changed: previous?.fingerprint === fingerprint ? [] : changed, warnings };
};

/** 构建脚本自己产出的模组目录：带 build.json。清理只碰这种。 */
const builtDirsIn = (outRoot) => (fs.existsSync(outRoot)
    ? fs.readdirSync(outRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(outRoot, entry.name, BUILD_STAMP)))
        .map((entry) => entry.name)
    : []);

/**
 * 全量构建：`root` 下选中的音源（selectSourceIds）加上 `extra` 里的目录。`prune` 时把 `outRoot` 里这次没构建、
 * 却是本脚本产出的模组目录删掉（带 build.json 的才算），产物目录就和这次的选择一致。
 * @param {{ root?: string, outRoot?: string, extra?: string[], bundled?: string, prune?: boolean, cache?: Map<string, { shape: string, asarName: string }> }} [options]
 */
export const buildSources = async ({
    root = DEFAULT_SOURCES_ROOT, outRoot = DEFAULT_OUT_ROOT, extra = [], bundled = process.env.FOLIA_BUNDLED_SOURCES, prune = true, cache = new Map(),
} = {}) => {
    const selected = selectSourceIds(listSourceIds(root), bundled);
    const dirs = [...selected.map((id) => path.join(root, id)), ...extra.map((dir) => path.resolve(dir))];
    const names = dirs.map((dir) => path.basename(dir));
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) throw new Error(`两个音源目录同名：${duplicate}`);
    fs.mkdirSync(outRoot, { recursive: true });
    const results = [];
    for (const dir of dirs) results.push(await buildSource(dir, { outRoot, cache }));
    if (prune) {
        // 先整个改名成点开头的目录（模组系统的发现跳过点目录）再删：要么整个挪开，要么原样不动，不留删了一半、
        // 没有 build.json 的目录。上次没删完的点目录这次再删。
        for (const name of builtDirsIn(outRoot).filter((name) => !names.includes(name))) {
            try {
                fs.renameSync(path.join(outRoot, name), path.join(outRoot, `.${name}.stale-${process.pid}`));
                log(`${name}: 这次不带，删掉旧产物`);
            } catch (error) {
                // 开着的应用还读着它的归档（Windows 上改不了有打开文件的目录）：这次原样留着，下次构建再删。
                log(`${name}: 这次不带，旧产物还挪不开（多半是开着的应用还读着它），下次构建再删：${error.code ?? error.message}`);
            }
        }
        for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^\..+\.stale-\d+$/.test(entry.name)) continue;
            try {
                fs.rmSync(path.join(outRoot, entry.name), { recursive: true, force: true });
            } catch {
                // 还有文件开着：下次再删。
            }
        }
    }
    return { results, bundledIds: bundledSourceIds(results.filter((result) => selected.includes(result.id)).map((result) => result.modId)) };
};

/*
 * watch：先全量构建，再盯着 `root`、`extra` 和 kit：改了哪个音源目录里的文件就只重建它，改了 kit 重建全部。
 * 构建出错只打出来，接着盯（开发时改到一半的代码不该让它停下）。返回停止函数。
 */
/** @param {{ root?: string, outRoot?: string, extra?: string[], bundled?: string }} [options] */
export const watchSources = async (options = {}) => {
    const { root = DEFAULT_SOURCES_ROOT, outRoot = DEFAULT_OUT_ROOT, extra = [], bundled = process.env.FOLIA_BUNDLED_SOURCES } = options;
    const cache = new Map();
    const report = (result) => {
        result.warnings.forEach((warning) => log(`${result.id}: ${warning}`));
        log(result.changed.length > 0 ? `${result.id}: 已构建（${result.fingerprint}，改了 ${result.changed.join('、')}）` : `${result.id}: 没有变化`);
    };
    try {
        const { results } = await buildSources({ root, outRoot, extra, bundled, cache });
        results.forEach(report);
    } catch (error) {
        log(`构建失败：${error.message}`);
    }
    const extraDirs = extra.map((dir) => path.resolve(dir));
    const dirOf = (id) => extraDirs.find((dir) => path.basename(dir) === id) ?? path.join(root, id);
    const pending = new Set();
    let timer = null;
    let running = Promise.resolve();
    const flush = () => {
        const ids = [...pending];
        pending.clear();
        running = running.then(async () => {
            for (const id of ids) {
                if (!isSourceDir(dirOf(id))) continue;
                if (!extraDirs.includes(dirOf(id)) && !selectSourceIds(listSourceIds(root), bundled).includes(id)) continue;
                try {
                    report(await buildSource(dirOf(id), { outRoot, cache }));
                } catch (error) {
                    log(`${id}: 构建失败：${error.message}`);
                }
            }
        });
    };
    const touch = (ids) => {
        ids.forEach((id) => pending.add(id));
        clearTimeout(timer);
        timer = setTimeout(flush, 150);
    };
    const everything = () => [...listSourceIds(root), ...extraDirs.map((dir) => path.basename(dir))];
    const watchers = [];
    const watchDir = (dir, idOf) => {
        if (!fs.existsSync(dir)) return;
        watchers.push(fs.watch(dir, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const ids = idOf(filename.split(/[\\/]/));
            if (ids.length > 0) touch(ids);
        }));
    };
    watchDir(root, (parts) => (parts.length > 1 ? [parts[0]] : []));
    extraDirs.forEach((dir) => watchDir(dir, () => [path.basename(dir)]));
    watchDir(path.join(ROOT, 'packages/folium-source-kit/src'), everything);
    log(`盯着 ${path.relative(ROOT, root) || '.'}${extraDirs.length > 0 ? ` 和 ${extraDirs.length} 个另加的目录` : ''}，改了文件只重建那一个`);
    return () => {
        clearTimeout(timer);
        watchers.forEach((watcher) => watcher.close());
        return running;
    };
};

const parseArgs = (argv) => {
    const options = { watch: false, extra: [], stamp: null, root: DEFAULT_SOURCES_ROOT, outRoot: DEFAULT_OUT_ROOT };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const value = () => {
            const next = argv[index + 1];
            if (next === undefined) throw new Error(`${arg} 后面要跟一个路径`);
            index += 1;
            return next;
        };
        if (arg === '--watch') options.watch = true;
        else if (arg === '--extra') options.extra.push(value());
        else if (arg === '--stamp') options.stamp = value();
        else if (arg === '--root') options.root = path.resolve(value());
        else if (arg === '--out') options.outRoot = path.resolve(value());
        else throw new Error(`不认识的参数 ${arg}`);
    }
    return options;
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.watch) {
        await watchSources(options);
        return;
    }
    const { results, bundledIds } = await buildSources(options);
    for (const result of results) {
        result.warnings.forEach((warning) => log(`${result.id}: ${warning}`));
        log(`${result.id}: ${result.changed.length > 0 ? `已构建（${result.fingerprint}）` : '没有变化'}`);
    }
    if (results.length === 0) log(`${path.relative(ROOT, options.root)} 里没有要构建的音源`);
    if (options.stamp) {
        const refusal = stampRefusal(bundledIds);
        if (refusal) throw new Error(refusal);
        stampBundledSources(options.stamp, bundledIds);
        log(`foliaBundledSources = ${JSON.stringify(bundledIds)} → ${options.stamp}`);
    }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        console.error(`[sources] ${error.message}`);
        process.exitCode = 1;
    });
}
