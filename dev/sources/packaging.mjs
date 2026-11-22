import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dependencyClosure, packageNameOf, readSourcePackage } from './dependencies.mjs';
import { listSourceIds } from './selection.mjs';
// dev/sources/packaging.mjs
// 安装包里怎么带内置音源（Folium 2.0 方案 §6.2「打包」）：各音源自己带着上游库（deps 归档、打进 bundle、vendor），
// app.asar 里不该再有一份。根 package.json 的 dependencies 仍然留着这些包（sources:build 从仓库根的 node_modules 取它们，
// Vercel 与 Cloudflare 的 QQ 入口也在用），所以由这里算出要从 app.asar 排除的包，交给 electron-builder 的上层配置
// （build/bundledSources.mjs）写成 `files` 的排除规则。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 宿主自己在主进程里用的代码：electron-builder 照 package.json 的 files 放进 app.asar 的目录。
const HOST_CODE_DIRS = ['electron', 'shared'];
const HOST_CODE_FILE = /\.(c|m)?js$/;
// require('x')、import('x')、import … from 'x'、export … from 'x'。
const SPECIFIER = /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s+)(['"])([^'"\r\n]+)\1/g;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const NODE_BUILTINS = new Set(builtinModules);

const isInstalled = (root, name) => fs.existsSync(path.join(root, 'node_modules', name, 'package.json'));

const walkFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkFiles(child);
        return entry.isFile() && HOST_CODE_FILE.test(entry.name) ? [child] : [];
    });
};

/**
 * 宿主主进程代码（electron/、shared/）里 require / import 的、装在仓库根 node_modules 里的包名。Node 内置模块、electron、
 * 相对路径不算。根 dependencies 没写、靠提升才拿得到的包也会被找出来，排除时不会误伤。
 */
export const hostRequiredPackages = (root = ROOT) => {
    const names = new Set();
    for (const dir of HOST_CODE_DIRS) {
        for (const file of walkFiles(path.join(root, dir))) {
            for (const match of fs.readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
                const specifier = match[2];
                if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
                const name = packageNameOf(specifier);
                if (name === 'electron' || name === 'original-fs' || NODE_BUILTINS.has(name)) continue;
                if (isInstalled(root, name)) names.add(name);
            }
        }
    }
    return [...names].sort();
};

/** `sources/` 下每个音源目录声明的依赖：包名 → [{ sourceId, mode }]。 */
export const sourceDeclaredPackages = (root = ROOT) => {
    const declared = new Map();
    for (const sourceId of listSourceIds(path.join(root, 'sources'))) {
        const { modes } = readSourcePackage(path.join(root, 'sources', sourceId));
        for (const [name, mode] of modes) declared.set(name, [...(declared.get(name) ?? []), { sourceId, mode }]);
    }
    return declared;
};

/**
 * app.asar 里不放的包名（排好序）：音源自己带着的上游库（`sources/<id>/package.json` 声明的依赖），连同只有它们才用到的
 * 那部分依赖闭包。留下的是宿主要的：根 dependencies 与 optionalDependencies 里音源没声明的、宿主主进程代码 require 的
 * （例如 Spotify 声明了 ws，宿主的 stageApi 也用它），和 `keepNative` 列的原生件（native 做法的包随应用带，经
 * api.native.load 由宿主加载）。按包名比：宿主的闭包里出现过的名字一律不排除，不管哪个版本。
 * @param {{ root?: string, keepNative?: (name: string, owners: { sourceId: string, mode: string }[]) => boolean }} [options]
 */
export const upstreamPackageExclusions = ({ root = ROOT, keepNative = () => true } = {}) => {
    const rootPkg = readJson(path.join(root, 'package.json'));
    const rootSpecs = { ...rootPkg.dependencies, ...rootPkg.optionalDependencies };
    const declared = sourceDeclaredPackages(root);
    const hostRequired = new Set(hostRequiredPackages(root));
    const isHostPackage = (name) => {
        const owners = declared.get(name);
        if (!owners) return true;
        if (hostRequired.has(name)) return true;
        return owners.some((owner) => owner.mode === 'native') && keepNative(name, owners);
    };
    const hostRoots = [...new Set([...Object.keys(rootSpecs), ...hostRequired])]
        .filter((name) => isHostPackage(name) && isInstalled(root, name));
    const sourceRoots = [...declared.keys()].filter((name) => !isHostPackage(name) && isInstalled(root, name));
    const specs = new Map(Object.entries(rootSpecs));
    const namesOf = (closure) => new Set([...closure.values()].map((entry) => entry.name));
    const hostNames = namesOf(dependencyClosure(hostRoots, specs, root));
    return [...namesOf(dependencyClosure(sourceRoots, specs, root))].filter((name) => !hostNames.has(name)).sort();
};

/** electron-builder `files` 里排除一个包（装在 app.asar 的任何一层 node_modules 里都算）的规则。 */
export const packageExclusionPattern = (name) => `!**/node_modules/${name}{,/**/*}`;
