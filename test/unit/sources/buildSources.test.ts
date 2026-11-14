import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    BUILD_STAMP, buildSource, buildSources, bundledSourceIds, listSourceIds, selectSourceIds, stampBundledSources, stampRefusal,
} from '../../../dev/sources/build.mjs';

// test/unit/sources/buildSources.test.ts
// dev/sources/build.mjs（Folium 2.0 方案 §6.2）：用构建夹具 test/fixtures/folium-sources/fixture-source 走一遍每条路径——
// client 打成一个 ESM 文件、main 与 worker 打成 CommonJS、依赖的四种做法（bundle、deps 归档、vendor、native）、
// 语言表的繁体、产物指纹与差量、FOLIA_BUNDLED_SOURCES 的选择、foliaBundledSources 的写法；再把构建出的 main 入口
// 真的跑起来（Node 里把归档解成同名目录；装着 Electron 时再用它的 Node 模式直接读 .asar），最后是每种写错了会报的错。

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = path.join(ROOT, 'test/fixtures/folium-sources/fixture-source');
const requireHere = createRequire(import.meta.url);
const asar = requireHere('@electron/asar') as {
    listPackage: (archive: string, options?: { isPack: boolean }) => string[];
    extractAll: (archive: string, dest: string) => void;
};

let work: string;
let outRoot: string;
let outDir: string;
let asarName: string;
let vendorName: string;

const read = (name: string) => fs.readFileSync(path.join(outDir, name), 'utf8');
const temporary = (name: string) => fs.mkdtempSync(path.join(work, `${name}-`));

/** 夹具拷一份到临时目录，`edit` 改它；交回拷出来的音源目录（目录名仍是 fixture-source）。 */
const copyFixture = (edit: (dir: string) => void) => {
    const dir = path.join(temporary('copy'), 'fixture-source');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    edit(dir);
    return dir;
};
/*
 * A local package `name` beside the copy (outside the source folder, where a package from node_modules is too),
 * declared as a bundled dependency (file:): what it imports is a dependency's import, not the source's own.
 */
const addLocalPackage = (dir: string, name: string, code: string) => {
    const packageDir = path.join(path.dirname(dir), 'packages', name);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
    fs.writeFileSync(path.join(packageDir, 'index.js'), code);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    pkg.dependencies[name] = `file:../packages/${name}`;
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
};
const buildCopy = (edit: (dir: string) => void) => buildSource(copyFixture(edit), { outRoot: temporary('out') });

/** 跑构建出的 main 入口：给一个假的 api，调 search 和 probe，交回它们的答案。 */
const PROBE = `
const activate = require(require('path').join(process.argv[1], 'index.cjs'));
const handlers = new Map(); const disposers = [];
activate({ rpc: { handle: (name, fn) => handlers.set(name, fn) }, log: { info() {}, warn: console.warn }, onDispose: (fn) => disposers.push(fn) });
Promise.all([handlers.get('search')('晴天'), handlers.get('probe')()]).then(([rows, probe]) => {
    process.stdout.write(JSON.stringify({ titles: rows.map((row) => row.title), probe }));
    disposers.forEach((fn) => fn());
});
`;
const runMain = (executable: string, dir: string, env: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(executable, ['-e', PROBE, dir], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout) as { titles: string[]; probe: { depsFrom: string; catalog: string[] } };
};

beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-sources-build-'));
    outRoot = path.join(work, 'dist-mods');
    const result = await buildSource(FIXTURE, { outRoot });
    outDir = result.outDir;
    asarName = fs.readdirSync(outDir).find((name) => /^deps\.[0-9a-f]{16}\.asar$/.test(name)) ?? '';
    vendorName = fs.readdirSync(outDir).find((name) => /^vendor\.[0-9a-f]{16}\.mjs$/.test(name)) ?? '';
}, 60_000);

afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('dev/sources/build.mjs builds a source directory into a mod directory', () => {
    it('writes every output, the stamp last, and a manifest the loader accepts', () => {
        const stamp = JSON.parse(read(BUILD_STAMP)) as { fingerprint: string; modId: string; files: string[] };
        expect(stamp.modId).toBe('fixture-source');
        expect(stamp.fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(stamp.files).toEqual([
            'assets/mark.svg', 'client.mjs', asarName, 'index.cjs',
            'locales/en.json', 'locales/in.json', 'locales/vi.json', 'locales/zh-CN.json', 'locales/zh-TW.json',
            'mod.json', vendorName, 'worker.cjs',
        ].sort());
        const { validateManifest } = requireHere('../../../electron/modSystem/manifest.cjs') as { validateManifest: (raw: unknown) => { ok: boolean } };
        expect(validateManifest(JSON.parse(read('mod.json'))).ok).toBe(true);
    });

    it('bundles the client into one ESM file with the kit inside and nothing for Node', () => {
        const client = read('client.mjs');
        expect(client).toMatch(/export \{[^}]*as default/);
        expect(client).toContain('probe search failed');
        // The kit's errorMessage is bundled in, not imported.
        expect(client).toContain('const errorMessage');
        expect(client).not.toMatch(/\brequire\(|from ['"]node:|@folia\/folium-source-kit|fixture-asar-dep/);
    });

    it('bundles the main entry as CommonJS exporting activate, with each dependency by its declared way', () => {
        const main = read('index.cjs');
        expect(main).toMatch(/module\.exports = activate;?\s*$/);
        // bundle: the package's code is in the file.
        expect(main).toContain('bundle:${text}');
        // asar: taken from the archive by its fingerprinted name, never bundled.
        expect(main).toContain(`createRequire(join(__dirname, "${asarName}", "node_modules", "_"))("fixture-asar-dep")`);
        expect(main).not.toContain('readdirSync');
        // vendor: through vendor.<fingerprint>.mjs (a file required as ESM stays in Node's ESM cache, so a changed one gets a new name).
        expect(vendorName).toMatch(/^vendor\.[0-9a-f]{16}\.mjs$/);
        expect(main).toContain(`require("./${vendorName}")`);
        expect(main).not.toContain('__folia_vendor_file__');
        expect(read(vendorName)).toMatch(/export \{ \w+ as v_[0-9a-f]+ \}/);
        // native: nowhere.
        for (const name of ['index.cjs', 'worker.cjs', 'client.mjs', vendorName]) expect(read(name)).not.toContain('native-addon');
        // The worker is its own CommonJS file that reads the same archive.
        expect(read('worker.cjs')).toContain(`"${asarName}"`);
    });

    it('packs the asar dependency with its production closure, and only that', () => {
        const entries = asar.listPackage(path.join(outDir, asarName), { isPack: false }).map((entry) => entry.replace(/\\/g, '/')).sort();
        expect(entries).toEqual(expect.arrayContaining([
            '/node_modules/fixture-asar-dep/index.cjs',
            '/node_modules/fixture-asar-dep/module/alpha.cjs',
            '/node_modules/fixture-asar-dep/module/beta.cjs',
            '/node_modules/fixture-asar-dep/package.json',
            '/node_modules/fixture-asar-leaf/index.cjs',
        ]));
        expect(entries.filter((entry) => /bundle-dep|esm-only|native-addon/.test(entry))).toEqual([]);
    });

    it('generates zh-TW.json from zh-CN.json and copies the rest as they are', () => {
        expect(JSON.parse(read('locales/zh-TW.json'))).toEqual({ source: { name: '構建夾具音源', short: '構建夾具' } });
        expect(read('locales/en.json')).toBe(fs.readFileSync(path.join(FIXTURE, 'locales/en.json'), 'utf8'));
        expect(read('assets/mark.svg')).toBe(fs.readFileSync(path.join(FIXTURE, 'assets/mark.svg'), 'utf8'));
    });

    it('runs: the bundled package, the archive (directory scan and all), the worker and the vendor file each answer', () => {
        // Plain Node reads no .asar: the archive extracted to a directory of the same name stands in for it.
        const copy = path.join(temporary('run'), 'fixture-source');
        fs.cpSync(outDir, copy, { recursive: true });
        fs.rmSync(path.join(copy, asarName));
        asar.extractAll(path.join(outDir, asarName), path.join(copy, asarName));
        const { titles, probe } = runMain(process.execPath, copy);
        expect(titles).toEqual([
            '晴天 · bundle:晴天', '晴天 · alpha@1.0.0+leaf', '晴天 · beta@1.0.0+leaf', '晴天 · worker:bundle:晴天:2', '晴天 · vendor:esm-only',
        ]);
        expect(probe.depsFrom).toContain(path.join(asarName, 'node_modules', 'fixture-asar-dep', 'index.cjs'));
    });

    const electronBinary = (() => {
        try {
            const binary = requireHere('electron') as unknown;
            return typeof binary === 'string' && fs.existsSync(binary) ? binary : null;
        } catch {
            return null;
        }
    })();
    it.skipIf(!electronBinary)('runs under Electron\'s Node mode, reading the real .asar file (main and worker)', () => {
        // ELECTRON_RUN_AS_NODE: no window and no GPU process, only Node with Electron's asar support.
        const { titles, probe } = runMain(electronBinary as string, outDir, { ELECTRON_RUN_AS_NODE: '1' });
        expect(titles).toContain('晴天 · worker:bundle:晴天:2');
        expect(probe.depsFrom).toBe(path.join(outDir, asarName, 'node_modules', 'fixture-asar-dep', 'index.cjs'));
    });

    it('builds the same output again with nothing changed, and keeps the stamp as it was', async () => {
        const before = fs.statSync(path.join(outDir, BUILD_STAMP)).mtimeMs;
        const again = await buildSource(FIXTURE, { outRoot });
        expect(again.changed).toEqual([]);
        expect(fs.statSync(path.join(outDir, BUILD_STAMP)).mtimeMs).toBe(before);
        expect(again.fingerprint).toBe(JSON.parse(read(BUILD_STAMP)).fingerprint);
    }, 60_000);

    it('renames the archive when a dependency changes, and drops the old one (with the cache --watch keeps, too)', async () => {
        const dir = copyFixture(() => {});
        const out = temporary('out');
        // A local (file:) package changes its files without changing its version: the cache must not keep the old archive.
        const cache = new Map();
        const first = await buildSource(dir, { outRoot: out, cache });
        const firstArchive = fs.readdirSync(first.outDir).find((name) => name.startsWith('deps.'));
        fs.writeFileSync(path.join(dir, 'deps/asar-dep/module/gamma.cjs'), "'use strict';\nexports.name = 'gamma';\n");
        const second = await buildSource(dir, { outRoot: out, cache });
        const archives = fs.readdirSync(second.outDir).filter((name) => name.startsWith('deps.'));
        expect(archives).toHaveLength(1);
        expect(archives[0]).not.toBe(firstArchive);
        expect(second.fingerprint).not.toBe(first.fingerprint);
        expect(second.changed).toEqual(expect.arrayContaining(['index.cjs', 'worker.cjs']));
        expect(second.changed).not.toContain('client.mjs');
    }, 60_000);
});

describe('which sources a build carries', () => {
    it('takes every source without FOLIA_BUNDLED_SOURCES, none for an empty one, a subset for a list', () => {
        const available = ['bodian', 'kugou', 'netease'];
        expect(selectSourceIds(available, undefined)).toEqual(available);
        expect(selectSourceIds(available, '')).toEqual([]);
        expect(selectSourceIds(available, ' netease ,bodian')).toEqual(['bodian', 'netease']);
        expect(() => selectSourceIds(available, 'netease,qq')).toThrow(/qq/);
    });

    it('lists the directories with a mod.json, and nothing when sources/ is not there', () => {
        expect(listSourceIds(path.join(work, 'no-such-folder'))).toEqual([]);
        expect(listSourceIds(path.dirname(FIXTURE))).toEqual(['fixture-source']);
    });

    it('declares the short ids of the trusted table\'s rows as foliaBundledSources, and none for another mod', () => {
        expect(bundledSourceIds(['netease', 'apple-music'])).toEqual(['netease', 'appleMusic']);
        expect(bundledSourceIds(['fixture-source'])).toEqual([]);
        expect(bundledSourceIds([])).toEqual([]);
        const pkg = path.join(temporary('stamp'), 'package.json');
        fs.writeFileSync(pkg, JSON.stringify({ name: 'app', foliaReleaseChannel: 'limo' }));
        stampBundledSources(pkg, ['netease']);
        expect(JSON.parse(fs.readFileSync(pkg, 'utf8'))).toEqual({ name: 'app', foliaReleaseChannel: 'limo', foliaBundledSources: ['netease'] });
    });

    // Until S8, a declaration that leaves a source out would open its takeover while the host still carries it.
    it('refuses to --stamp a declaration that leaves out any of the nine', () => {
        const nine = ['netease', 'kugou', 'qq', 'bodian', 'qishui', 'ytm', 'spotify', 'appleMusic', 'fnmusic'];
        expect(stampRefusal(nine)).toBeNull();
        expect(stampRefusal(['bodian'])).toMatch(/不带 netease、kugou、qq、qishui、ytm、spotify、appleMusic、fnmusic/);
        expect(stampRefusal([])).not.toBeNull();
        const pkg = path.join(temporary('stamp-cli'), 'package.json');
        fs.writeFileSync(pkg, JSON.stringify({ name: 'app' }));
        const run = spawnSync(process.execPath, [path.join(ROOT, 'dev/sources/build.mjs'), '--root', path.join(work, 'no-such-folder'), '--out', temporary('stamp-out'), '--stamp', pkg], { encoding: 'utf8' });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(/S8 之前不能这样打包/);
        expect(JSON.parse(fs.readFileSync(pkg, 'utf8'))).toEqual({ name: 'app' });
    });

    it('builds the selection and removes only its own outputs of sources no longer carried', async () => {
        const out = temporary('out');
        fs.mkdirSync(path.join(out, 'old-source'), { recursive: true });
        fs.writeFileSync(path.join(out, 'old-source', BUILD_STAMP), '{}');
        fs.mkdirSync(path.join(out, 'not-ours'));
        const { results, bundledIds } = await buildSources({ root: path.join(work, 'no-such-folder'), outRoot: out, extra: [FIXTURE], bundled: undefined });
        expect(results.map((result) => result.id)).toEqual(['fixture-source']);
        expect(bundledIds).toEqual([]);
        expect(fs.readdirSync(out).sort()).toEqual(['fixture-source', 'not-ours']);
    }, 60_000);
});

describe('what a source may not do, each refused by the build', () => {
    const cases: [string, (dir: string) => void, RegExp][] = [
        ['imports a dependency declared native', (dir) => {
            fs.appendFileSync(path.join(dir, 'main/index.ts'), "\nimport 'fixture-native-addon';\n");
        }, /fixture-native-addon 声明成 native.*api\.native\.load/],
        ['imports a package it did not declare', (dir) => {
            fs.appendFileSync(path.join(dir, 'main/index.ts'), "\nimport 'left-pad';\n");
        }, /left-pad 没有写进 .*package\.json 的 dependencies/],
        ['imports electron', (dir) => {
            fs.appendFileSync(path.join(dir, 'main/index.ts'), "\nimport 'electron';\n");
        }, /不直接用 electron/],
        ['imports the host', (dir) => {
            fs.appendFileSync(path.join(dir, 'client/index.ts'), "\nimport '@/services/onlineMusic/omni';\n");
        }, /@\/services\/onlineMusic\/omni/],
        ['takes an asar dependency in the client', (dir) => {
            fs.appendFileSync(path.join(dir, 'client/index.ts'), "\nimport 'fixture-asar-dep';\n");
        }, /fixture-asar-dep 声明成 asar，那只给 main 入口/],
        ['takes a Node built-in in the client', (dir) => {
            fs.appendFileSync(path.join(dir, 'client/index.ts'), "\nimport 'node:fs';\n");
        }, /client 跑在窗口里/],
        ['brings its own React into the client', (dir) => {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            pkg.dependencies.react = 'file:deps/bundle-dep';
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
            fs.appendFileSync(path.join(dir, 'client/index.ts'), "\nimport 'react';\n");
        }, /react 由宿主注入/],
        ['writes zh-TW.json by hand', (dir) => {
            fs.writeFileSync(path.join(dir, 'locales/zh-TW.json'), '{}');
        }, /繁体由构建从 zh-CN\.json 生成/],
        ['names an entry its folders do not have', (dir) => {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
            manifest.main = 'main.cjs';
            fs.writeFileSync(path.join(dir, 'mod.json'), JSON.stringify(manifest));
        }, /mod\.main 要写成 "index\.cjs"/],
        ['declares a way the build does not know', (dir) => {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            pkg.folia.dependencies['fixture-bundle-dep'] = 'inline';
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        }, /"inline" 不认识/],
        ['packs a native file into the archive', (dir) => {
            fs.writeFileSync(path.join(dir, 'deps/asar-dep/addon.node'), 'not really');
        }, /addon\.node 是原生件/],
        // The rules hold for what the source's dependencies import too, not only for the source's own imports.
        ['brings React into the client through a bundled dependency', (dir) => {
            addLocalPackage(dir, 'react-user', "import 'react';\nexport const x = 1;\n");
            fs.appendFileSync(path.join(dir, 'client/index.ts'), "\nimport 'react-user';\n");
        }, /react 由宿主注入/],
        ['brings electron into main through a bundled dependency', (dir) => {
            addLocalPackage(dir, 'electron-user', "require('electron');\nmodule.exports = 1;\n");
            fs.appendFileSync(path.join(dir, 'main/index.ts'), "\nimport 'electron-user';\n");
        }, /不直接用 electron/],
        ['takes a Node built-in into the client through a bundled dependency', (dir) => {
            addLocalPackage(dir, 'fs-user', "import 'node:fs';\nexport const x = 1;\n");
            fs.appendFileSync(path.join(dir, 'client/index.ts'), "\nimport 'fs-user';\n");
        }, /client 跑在窗口里/],
        ['reaches the host through a file: dependency pointing into the repository', (dir) => {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            pkg.dependencies['folia-root'] = `file:${ROOT.replace(/\\/g, '/')}`;
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
            fs.appendFileSync(path.join(dir, 'main/index.ts'), "\nimport 'folia-root/shared/networkErrorText.cjs';\n");
        }, /不 import 宿主的代码：shared/],
        ['names a worker entry outside its folder', (dir) => {
            fs.writeFileSync(path.join(path.dirname(dir), 'outside.ts'), 'export {};\n');
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            pkg.folia.workers.escape = '../outside.ts';
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        }, /worker "escape" 的入口 \.\.\/outside\.ts 不在音源目录里/],
        // An import nothing resolves would stay a bare require in the output: it runs in the repository (node_modules
        // above dist-mods) and fails in the packaged app (no node_modules above resources/builtin-mods).
        ['leaves an import nothing resolves', (dir) => {
            addLocalPackage(dir, 'needs-missing', "require('folia-no-such-package');\nmodule.exports = 1;\n");
            fs.appendFileSync(path.join(dir, 'main/index.ts'), "\nimport 'needs-missing';\n");
        }, /解析不到的 import/],
    ];
    it.each(cases)('%s', async (_name, edit, message) => {
        await expect(buildCopy(edit)).rejects.toThrow(message);
    }, 60_000);
});

// The sources the app ships (sources/<id>/), built the way the release workflows build them, so a pull request that
// breaks one fails here instead of at the packaging step of a release (review: nothing on a pull request built them).
describe('the repository\'s own sources build as the installation carries them', () => {
    it('builds every source in sources/ into a complete mod directory whose main entry needs only Node', async () => {
        const ids = listSourceIds(path.join(ROOT, 'sources'));
        const out = temporary('repository-sources');
        const { results } = await buildSources({ outRoot: out, bundled: undefined });
        expect(results.map((result) => result.id).sort()).toEqual([...ids].sort());
        for (const result of results) {
            expect(result.warnings, result.id).toEqual([]);
            const dir = path.join(out, result.id);
            const files = fs.readdirSync(dir);
            expect(files, result.id).toEqual(expect.arrayContaining(['mod.json', BUILD_STAMP]));
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')) as { client?: string; main?: string; locales?: string };
            if (manifest.client) expect(fs.existsSync(path.join(dir, manifest.client)), result.id).toBe(true);
            if (manifest.locales) expect(fs.existsSync(path.join(dir, manifest.locales, 'zh-TW.json')), result.id).toBe(true);
            if (manifest.main) {
                const code = fs.readFileSync(path.join(dir, manifest.main), 'utf8');
                const required = [...code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map((match) => match[2]);
                const outside = required.filter((name) => !name.startsWith('.') && !name.startsWith('node:') && !builtinModules.includes(name.split('/')[0]));
                expect(outside, `${result.id}: bare requires left in ${manifest.main}`).toEqual([]);
            }
        }
    }, 120_000);
});

