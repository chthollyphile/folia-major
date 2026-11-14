import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { locatePackage, packageEntry, packageNameOf } from './dependencies.mjs';
// dev/sources/bundle.mjs
// 一个音源模组的入口用 rolldown 打成一个文件：client 打成 ESM 的 client.mjs，main 与 worker 打成 CommonJS 的
// index.cjs、<name>.cjs，ESM-only 的依赖另打成 vendor.<指纹>.mjs。依赖按 package.json 声明的做法处理（dependencies.mjs），
// 由这里的插件在解析每个 import 时执行：没声明的包、宿主自己注入的库、Node 内置模块进 client、electron，都是构建错误。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const KIT_ENTRY = path.join(ROOT, 'packages/folium-source-kit/src/index.ts');
const KIT_DIR = path.dirname(KIT_ENTRY);
/** 宿主的代码：音源模组不能 import 它们（和 Dedicatus D130 同一张表）。 */
const HOST_DIRS = [path.join(ROOT, 'src'), path.join(ROOT, 'electron'), path.join(ROOT, 'shared')];

/** 宿主给 client 注入的库：模组的 bundle 里不能再带一份（方案 §12 第 7 条），用 folium 交给它的。 */
const HOST_PROVIDED = new Set(['react', 'react-dom', 'i18next', 'react-i18next', 'zustand']);
const NODE_BUILTINS = new Set(builtinModules);
const isNodeBuiltin = (specifier) => specifier.startsWith('node:') || NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(specifier.split('/')[0]);

const ASAR_PREFIX = '\0folia-asar:';
const VENDOR_PREFIX = '\0folia-vendor:';
/*
 * main 与 worker 里 vendor 文件的占位名：vendor 文件在它们之后才打，打完按内容指纹起名（vendor.<指纹>.mjs），
 * build.mjs 再把占位换成真名。文件名带指纹，因为 require(esm) 载入的模块记在 Node 的 ESM 缓存里，清 require.cache
 * 清不掉，原地覆盖的 vendor 文件重载后仍是旧的（和 deps 归档名带指纹同一个道理）。
 */
export const VENDOR_PLACEHOLDER = './__folia_vendor_file__.mjs';
/** vendor 文件里一个说明符的导出名：十六进制编码，确定、是合法的标识符。 */
export const vendorKey = (specifier) => `v_${Buffer.from(specifier, 'utf8').toString('hex')}`;

const isInside = (file, dir) => {
    const relative = path.relative(dir, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * 依赖规则的插件。
 * kind：'client' | 'main'（main 与 worker 一样）。
 * context：{ sourceDir, specs, modes, asarName（main 用到 asar 依赖时有）, vendorSpecifiers（收集 vendor 依赖的说明符）}
 */
const dependencyPolicy = (kind, context) => {
    const { sourceDir, specs, modes, vendorSpecifiers } = context;
    const fail = (message) => { throw new Error(message); };
    return {
        name: 'folia-source-dependencies',
        async resolveId(specifier, importer) {
            if (specifier.startsWith('\0')) return null;
            if (importer?.startsWith(VENDOR_PREFIX) && specifier === VENDOR_PLACEHOLDER) return { id: VENDOR_PLACEHOLDER, external: true };
            if (importer?.startsWith(ASAR_PREFIX) || importer?.startsWith(VENDOR_PREFIX)) return { id: specifier, external: true };
            /*
             * 不管是谁 import 的都不行的：electron、client 里的 Node 内置模块和宿主注入的库。打进 bundle 的依赖自己
             * import 它们也一样（审查：只看音源自己的 import 时，一个依赖 react 的 UI 库会把第二份 React 打进
             * client.mjs，一个 require('electron') 的包会把 npm 的 electron 桩打进 index.cjs）。
             */
            const bare = !specifier.startsWith('.') && !path.isAbsolute(specifier);
            if (bare && (specifier === 'electron' || specifier.startsWith('electron/'))) {
                fail(`音源模组不直接用 electron：main 入口用宿主给的 api.*（${importer}）`);
            }
            if (bare && kind === 'client' && isNodeBuiltin(specifier)) {
                fail(`client 跑在窗口里，没有 Node 内置模块 ${specifier}（${importer}）`);
            }
            if (bare && kind === 'client' && HOST_PROVIDED.has(packageNameOf(specifier))) {
                fail(`${packageNameOf(specifier)} 由宿主注入，模组的 bundle 里不能再带一份：用 folium 交给 client 的那份（${importer}）`);
            }
            // 依赖自己的其余 import：它的事（打进 bundle 的包照 Node 的规矩找它的依赖）。宿主的文件在 load 里挡。
            const fromSource = !importer || isInside(importer, sourceDir) || isInside(importer, KIT_DIR);
            if (!fromSource) return bare && isNodeBuiltin(specifier) ? { id: specifier, external: true } : null;
            if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
                // 相对路径也不能走出去拿宿主的代码（方案 §6.1；Dedicatus 的边界规则在仓库里另查一遍）。
                const resolved = await this.resolve(specifier, importer, { skipSelf: true });
                const file = resolved?.id;
                if (file && HOST_DIRS.some((dir) => isInside(file, dir))) fail(`音源模组不 import 宿主的代码：${specifier}（${importer}）`);
                return resolved;
            }
            if (specifier.startsWith('@/')) fail(`音源模组不 import 宿主的代码：${specifier} 是 src/ 的别名（${importer}）`);

            if (specifier === '@folia/folium-source-kit') return KIT_ENTRY;
            if (specifier === '@folia/folium' || specifier.startsWith('@folia/folium/')) {
                fail(`${specifier} 只有类型：写成 import type（${importer}）`);
            }
            if (specifier === 'electron' || specifier.startsWith('electron/')) {
                fail(`音源模组不直接用 electron：main 入口用宿主给的 api.*（${importer}）`);
            }
            if (isNodeBuiltin(specifier)) {
                if (kind === 'client') fail(`client 跑在窗口里，没有 Node 内置模块 ${specifier}（${importer}）`);
                return { id: specifier, external: true };
            }
            const name = packageNameOf(specifier);
            if (HOST_PROVIDED.has(name) && kind === 'client') {
                fail(`${name} 由宿主注入，模组的 bundle 里不能再带一份：用 folium 交给 client 的那份（${importer}）`);
            }
            if (!specs.has(name)) {
                fail(`${name} 没有写进 ${path.join(sourceDir, 'package.json')} 的 dependencies（${importer}）`);
            }
            const mode = modes.get(name);
            if (mode === 'native') {
                fail(`${name} 声明成 native：原生件不打包，经 api.native.load(name) / api.native.path(name) 引用，不要 import（${importer}）`);
            }
            if (mode !== 'bundle' && kind === 'client') {
                fail(`${name} 声明成 ${mode}，那只给 main 入口：client 用到的依赖只能打进 bundle（${importer}）`);
            }
            if (mode === 'asar') return `${ASAR_PREFIX}${specifier}`;
            if (mode === 'vendor') {
                vendorSpecifiers.add(specifier);
                return `${VENDOR_PREFIX}${specifier}`;
            }
            // bundle：file: 的本地包自己定位，其余交给 rolldown 按 Node 的规矩找。
            const spec = specs.get(name);
            if (typeof spec === 'string' && spec.startsWith('file:')) {
                const dir = locatePackage(name, spec, sourceDir);
                return packageEntry(dir, specifier.slice(name.length + 1), kind === 'client' ? ['browser', 'import', 'module'] : ['node', 'require']);
            }
            return null;
        },
        load(id) {
            // 不管经哪条路解析到的（依赖的相对路径、file: 指到仓库里、worker 入口），宿主的文件都不进音源的 bundle。
            if (!id.startsWith('\0') && HOST_DIRS.some((dir) => isInside(id.replace(/\?.*$/, ''), dir))) {
                fail(`音源模组不 import 宿主的代码：${path.relative(ROOT, id)}`);
            }
            if (id.startsWith(ASAR_PREFIX)) {
                const specifier = id.slice(ASAR_PREFIX.length);
                if (!context.asarName) fail(`内部错误：${specifier} 要从 deps 归档取，但没有归档`);
                // 模组目录里的归档：入口文件就在模组目录下，__dirname 就是模组目录。
                return [
                    "const { createRequire } = require('node:module');",
                    "const { join } = require('node:path');",
                    `module.exports = createRequire(join(__dirname, ${JSON.stringify(context.asarName)}, 'node_modules', '_'))(${JSON.stringify(specifier)});`,
                ].join('\n');
            }
            if (id.startsWith(VENDOR_PREFIX)) {
                const specifier = id.slice(VENDOR_PREFIX.length);
                // require(esm) 交回模块命名空间；带上 __esModule，默认导入和具名导入都按 ESM 的意思取。
                return `module.exports = { __esModule: true, ...require(${JSON.stringify(VENDOR_PLACEHOLDER)})[${JSON.stringify(vendorKey(specifier))}] };`;
            }
            return null;
        },
    };
};

/**
 * 打一个入口，交回代码文本。只允许出一个文件：动态 import 也内联进来，引出资源文件的写法算错。
 * kind：'client'（ESM，浏览器）| 'main'（CommonJS，Node，导出只能是 default）| 'worker'（CommonJS，Node，不导出）
 * | 'vendor'（ESM，Node）。
 */
export const bundleEntry = async ({ input, kind, context }) => {
    const warnings = [];
    const unresolved = [];
    const build = await rolldown({
        input,
        cwd: ROOT,
        platform: kind === 'client' ? 'browser' : 'node',
        tsconfig: false,
        resolve: {
            alias: { '@folia/folium-source-kit': KIT_ENTRY },
            conditionNames: kind === 'client' ? ['browser', 'import', 'module', 'default'] : ['node', kind === 'vendor' ? 'import' : 'require', 'default'],
        },
        plugins: [kind === 'vendor' ? vendorEntry(context) : dependencyPolicy(kind === 'client' ? 'client' : 'main', context)],
        logLevel: 'warn',
        onLog: (level, log) => {
            if (level !== 'warn') return;
            if (log.code === 'UNRESOLVED_IMPORT') unresolved.push(log.message);
            else warnings.push(log.message);
        },
    });
    try {
        const { output } = await build.generate({
            format: kind === 'main' || kind === 'worker' ? 'cjs' : 'esm',
            exports: kind === 'main' ? 'default' : 'auto',
            codeSplitting: false,
            sourcemap: false,
        });
        /*
         * 解析不到的 import，rolldown 只警告并当成外部模块留一个裸 require / import。开发版的 dist-mods/<id>/ 往上
         * 找得到仓库根的 node_modules，照样能跑；安装包里的 resources/builtin-mods/<id>/ 往上没有 node_modules，
         * 同一行就失败了。所以算构建错误。rolldown 在 generate 里才解析，所以在它之后看。
         */
        if (unresolved.length > 0) {
            throw new Error(`${input} 有解析不到的 import（安装包里没有 node_modules 可找）：\n${unresolved.join('\n')}`);
        }
        if (output.length !== 1 || output[0].type !== 'chunk') {
            throw new Error(`${input} 打出了 ${output.length} 个文件（${output.map((item) => item.fileName).join('、')}）：一个入口只能打成一个文件`);
        }
        return { code: output[0].code, warnings };
    } finally {
        await build.close();
    }
};

export const VENDOR_ENTRY = '\0folia-vendor-entry';

/** vendor 文件的入口源码：每个说明符一个命名空间导出。 */
export const vendorEntrySource = (specifiers) => [...specifiers].sort()
    .map((specifier) => `export * as ${vendorKey(specifier)} from ${JSON.stringify(specifier)};`)
    .join('\n');

/*
 * vendor 文件的入口（虚拟模块，列出 main 与 worker 用到的 vendor 说明符）。file: 的本地包自己定位，
 * 其余从音源目录按 Node 的规矩找。
 */
function vendorEntry({ sourceDir, specs, vendorSpecifiers }) {
    return {
        name: 'folia-source-vendor',
        resolveId(specifier, importer) {
            if (specifier === VENDOR_ENTRY) return VENDOR_ENTRY;
            if (importer !== VENDOR_ENTRY) return null;
            const name = packageNameOf(specifier);
            const spec = specs.get(name);
            const dir = locatePackage(name, spec, sourceDir);
            if (!dir) throw new Error(`${name}: 没有装（从 ${sourceDir} 往上找不到 node_modules/${name}）`);
            return packageEntry(dir, specifier.slice(name.length + 1), ['node', 'import', 'module']);
        },
        load(id) {
            return id === VENDOR_ENTRY ? vendorEntrySource(vendorSpecifiers) : null;
        },
    };
}
