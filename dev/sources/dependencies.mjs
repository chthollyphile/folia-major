import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
// dev/sources/dependencies.mjs
// 一个音源模组的 npm 依赖怎么进构建产物（Folium 2.0 方案 §6.2 的依赖表）。每个依赖的做法由音源自己的
// package.json 声明，脚本里不写平台 id：
//
//   "dependencies": { "<包>": "<版本>" },                 // 版本照 UPSTREAMS 的规矩钉死；file: 指本地目录
//   "folia": { "dependencies": { "<包>": "asar" } }       // 不写的是 bundle
//
//   bundle  打进入口的 bundle（index.cjs、worker 或 client.mjs）
//   asar    生产依赖闭包装进模组目录里的 deps.<指纹>.asar，main / worker 入口用 createRequire 取；
//           给依赖真实文件布局的上游库（改 require.cache、扫 module/ 目录、按包内路径挂钩子）
//   vendor  ESM-only 的包，一起打成一个 vendor.<指纹>.mjs，main / worker 入口 require 它（Node 的 require(esm)）
//   native  原生件，不打包：留在应用里，经 api.native.load(name) / api.native.path(name) 引用；
//           源码 import 它就是构建错误
//
// 归档名带内容指纹：Electron 按路径把 .asar 的文件表缓存到进程结束，原地换内容会读到旧的表（方案 §13），
// 所以内容变了文件名就跟着变。

export const DEPENDENCY_MODES = Object.freeze(['bundle', 'asar', 'vendor', 'native']);

/** `@scope/name/sub` → `@scope/name`；`name/sub` → `name`。 */
export const packageNameOf = (specifier) => {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * 读音源目录的 package.json，得出每个依赖的做法。错误一律抛出，带上是哪个包、怎么改。
 * @returns {{ pkg: object, specs: Map<string, string>, modes: Map<string, string>, workers: Record<string, string> }}
 */
export const readSourcePackage = (sourceDir) => {
    const file = path.join(sourceDir, 'package.json');
    if (!fs.existsSync(file)) {
        return { pkg: {}, specs: new Map(), modes: new Map(), workers: {} };
    }
    const pkg = readJson(file);
    const specs = new Map(Object.entries(pkg.dependencies ?? {}));
    const folia = pkg.folia ?? {};
    const declared = folia.dependencies ?? {};
    const modes = new Map();
    for (const [name, mode] of Object.entries(declared)) {
        if (!specs.has(name)) {
            throw new Error(`${file}: folia.dependencies 写了 ${name}，dependencies 里却没有它`);
        }
        if (!DEPENDENCY_MODES.includes(mode)) {
            throw new Error(`${file}: ${name} 的做法 "${mode}" 不认识，只能是 ${DEPENDENCY_MODES.join(' / ')}`);
        }
        modes.set(name, mode);
    }
    for (const name of specs.keys()) {
        if (!modes.has(name)) modes.set(name, 'bundle');
    }
    const workers = folia.workers ?? {};
    for (const [name, entry] of Object.entries(workers)) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || name === 'index' || name === 'client' || name === 'vendor') {
            throw new Error(`${file}: worker 名 "${name}" 不行（小写字母开头，只用小写字母、数字和连字符，不能是 index、client、vendor）`);
        }
        if (typeof entry !== 'string' || !fs.existsSync(path.join(sourceDir, entry))) {
            throw new Error(`${file}: worker "${name}" 的入口 ${entry} 不存在`);
        }
        // worker 的入口是音源自己的代码：在音源目录里面（不能指到宿主或别的音源去）。
        const relative = path.relative(sourceDir, path.resolve(sourceDir, entry));
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`${file}: worker "${name}" 的入口 ${entry} 不在音源目录里`);
        }
    }
    return { pkg, specs, modes, workers };
};

/** 从 `fromDir` 往上找 node_modules/<name>（Node 的查找顺序），找不到回 null。 */
const findInNodeModules = (name, fromDir) => {
    let dir = fromDir;
    for (;;) {
        const candidate = path.join(dir, 'node_modules', name);
        if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
};

/**
 * 包 `name` 在磁盘上的目录：版本写成 `file:<路径>` 的是相对 `ownerDir`（写这一行的 package.json 所在目录）的
 * 本地目录；其余按 Node 的规矩从 `ownerDir` 往上找。
 */
export const locatePackage = (name, spec, ownerDir) => {
    if (typeof spec === 'string' && spec.startsWith('file:')) {
        const dir = path.resolve(ownerDir, spec.slice('file:'.length));
        if (!fs.existsSync(path.join(dir, 'package.json'))) {
            throw new Error(`${name}: ${spec} 指向的目录里没有 package.json`);
        }
        return fs.realpathSync(dir);
    }
    return findInNodeModules(name, ownerDir);
};

/**
 * 钉死的版本要和装着的一致（UPSTREAMS.md：平台用的库钉死版本）。`file:` 和写成范围的不核对。
 */
export const checkPinnedVersion = (name, spec, dir) => {
    if (typeof spec !== 'string' || !/^\d+\.\d+\.\d+([-+].*)?$/.test(spec)) return;
    const installed = readJson(path.join(dir, 'package.json')).version;
    if (installed !== spec) {
        throw new Error(`${name}: package.json 钉的是 ${spec}，装着的是 ${installed}（npm install 之后再构建）`);
    }
};

/*
 * 包目录在归档里的位置：npm 装的包保留它在 node_modules 里的相对路径（嵌套的 node_modules/a/node_modules/b 原样留着，
 * 这样同名不同版本各在各的位置）；本地目录（file:）的包放在 node_modules/<名字>。
 */
const stagePathOf = (name, dir) => {
    const segments = dir.split(path.sep);
    const first = segments.indexOf('node_modules');
    if (first >= 0) return segments.slice(first).join('/');
    return `node_modules/${name}`;
};

/**
 * `roots`（asar 做法的包名）的生产依赖闭包：dependencies、optionalDependencies（装着的才算）、
 * peerDependencies（装着的才算）。
 * @returns {Map<string, { name: string, dir: string, version: string }>} 归档里的位置 → 包
 */
export const dependencyClosure = (roots, specs, sourceDir) => {
    const closure = new Map();
    const visit = (name, spec, ownerDir, required) => {
        const dir = locatePackage(name, spec, ownerDir);
        if (!dir) {
            if (required) throw new Error(`${name}: 没有装（从 ${ownerDir} 往上找不到 node_modules/${name}）`);
            return;
        }
        const stagePath = stagePathOf(name, dir);
        const known = closure.get(stagePath);
        if (known) {
            if (known.dir !== dir) throw new Error(`${name}: 归档里的 ${stagePath} 对应两个目录（${known.dir}、${dir}）`);
            return;
        }
        const pkg = readJson(path.join(dir, 'package.json'));
        closure.set(stagePath, { name, dir, version: pkg.version ?? '0.0.0' });
        for (const [child, childSpec] of Object.entries(pkg.dependencies ?? {})) visit(child, childSpec, dir, true);
        for (const [child, childSpec] of Object.entries(pkg.optionalDependencies ?? {})) visit(child, childSpec, dir, false);
        for (const [child, childSpec] of Object.entries(pkg.peerDependencies ?? {})) {
            if (!pkg.peerDependenciesMeta?.[child]?.optional || locatePackage(child, childSpec, dir)) visit(child, childSpec, dir, false);
        }
    };
    for (const name of roots) visit(name, specs.get(name), sourceDir, true);
    return closure;
};

/** 包目录里要进归档的文件（相对路径，排好序）：嵌套的 node_modules 另算，.git 不要。 */
const packageFiles = (dir) => {
    const found = [];
    const walk = (relative) => {
        for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            const stat = fs.statSync(path.join(dir, child));
            if (stat.isDirectory()) walk(child);
            else if (stat.isFile()) found.push(child);
        }
    };
    walk('');
    return found.sort();
};

/**
 * 闭包里每个文件：归档里的路径与源文件。原生件（.node）进不了归档（Electron 加载不了 asar 里的 .node），
 * 遇到就报错，让音源把那个包声明成 native。
 */
export const closureFiles = (closure) => {
    const files = [];
    for (const [stagePath, entry] of [...closure.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        for (const relative of packageFiles(entry.dir)) {
            if (relative.endsWith('.node')) {
                throw new Error(`${entry.name}: ${relative} 是原生件，asar 里加载不了；把带原生件的包声明成 native`);
            }
            files.push({ archivePath: `${stagePath}/${relative}`, from: path.join(entry.dir, relative) });
        }
    }
    return files;
};

/** 闭包内容的指纹：每个文件的归档路径和内容。前 16 位十六进制进文件名。 */
export const closureFingerprint = (files) => {
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        hash.update(file.archivePath);
        hash.update('\0');
        hash.update(crypto.createHash('sha256').update(fs.readFileSync(file.from)).digest());
    }
    return hash.digest('hex').slice(0, 16);
};

/*
 * 闭包的结构：每个包的位置、版本、目录；不在 node_modules 里的本地包（file:）再加上每个文件的大小与修改时间，
 * 它们常常改内容不改版本。watch 时结构没变就不重算内容指纹、不重打归档。
 */
export const closureShape = (closure) => JSON.stringify([...closure.entries()].map(([stagePath, entry]) => [
    stagePath, entry.version, entry.dir,
    entry.dir.split(path.sep).includes('node_modules') ? null : packageFiles(entry.dir).map((relative) => {
        const stat = fs.statSync(path.join(entry.dir, relative));
        return `${relative}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    }),
]).sort());

const requireHere = createRequire(import.meta.url);

/**
 * 把 `files` 打成 `archive`（@electron/asar）。先摆进系统临时目录里的一个新目录，打完删掉它（只删自己建的这个）。
 */
export const packArchive = async (files, archive) => {
    const asar = requireHere('@electron/asar');
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-source-deps-'));
    try {
        for (const file of files) {
            const target = path.join(staging, ...file.archivePath.split('/'));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(file.from, target);
        }
        await asar.createPackage(staging, archive);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
};

/** 读一个包的入口：子路径直接拼；否则 exports 的 `.`（按 `conditions` 挑）、main、index.js。给 file: 包用。 */
export const packageEntry = (dir, subpath, conditions) => {
    if (subpath) return path.join(dir, subpath);
    const pkg = readJson(path.join(dir, 'package.json'));
    const pick = (target) => {
        if (typeof target === 'string') return target;
        if (target && typeof target === 'object') {
            for (const condition of [...conditions, 'default']) {
                if (condition in target) {
                    const picked = pick(target[condition]);
                    if (picked) return picked;
                }
            }
        }
        return null;
    };
    const exported = pkg.exports === undefined ? null : pick(typeof pkg.exports === 'object' && '.' in pkg.exports ? pkg.exports['.'] : pkg.exports);
    return path.join(dir, exported ?? pkg.main ?? 'index.js');
};
