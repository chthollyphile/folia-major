import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, expect } from 'vitest';
import type { FoliumClientApi, FoliumClientModule, FoliumRpc } from '@/mods/folium/contract';
import type { FoliumSourceDef, FoliumSourcePageStore, FoliumText } from '@/mods/folium/sources/contract';
import type { ModRuntimeInfo } from '@/mods/types';
// test/unit/helpers/builtinSources.ts
// 单测里的内置音源（Folium 2.0 方案 §10 的 S4）。挂在 vitest.config.ts 的 setupFiles 上：写了 `// @builtin-sources` 的
// 测试文件开始前（它的 beforeAll），发现 sources/<id>/（带 mod.json 的目录）就经适配层（src/mods/folium/registries/sources.ts）
// 注册它，和桌面上模组的 client 注册的是同一条路；没写的文件、或者一个音源都没有时，什么都不做，也不载入任何宿主模块。
//
// 一个音源怎么注册：
//   - 有 core/index.ts 并导出 createSource(env)：用测试的 env（BuiltinSourceTestEnv）调它，把交回的定义
//     （一个或一组）注册上。这是网易云、酷狗、QQ（有 core 的三家，方案 §8）的路。
//   - 否则调 client/index.ts 的默认导出 activate(folium)，folium 是宿主给 client 的那一份，只把 rpc 换成测试的。
// 到 main 入口的调用（env.call、folium.rpc.call）由测试用 setBuiltinSourceRpc(模组 id, 处理器表) 接住；没接的调用失败。
// 模组自己的语言表（locales/）在注册前载入 i18n，zh-TW 和构建一样由 zh-CN 生成。
//
// 测试也可以拿别的目录调 registerBuiltinSources({ root })：构建夹具（test/fixtures/folium-sources/）就是这样测的。

export const BUILTIN_SOURCES_ROOT = path.resolve(__dirname, '../../../sources');

/** createSource(env) 拿到的测试环境；core 的 env 照这个形状写（桌面上 client 入口用 folium.rpc 与 folium.i18n 拼出同样的东西）。 */
export interface BuiltinSourceTestEnv {
    /** 模组 id。 */
    modId: string;
    /** 调 main 入口登记的处理器：测试里是 setBuiltinSourceRpc 给的。 */
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    /** 模组自己语言表里的一条文字（folium.i18n.key）。 */
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** 页面内的同步存储（folium.sources.pageStore），按宿主认的音源 id。 */
    pageStore(sourceId: string): FoliumSourcePageStore;
}

export type BuiltinSourceRpcHandlers = Record<string, (...args: unknown[]) => unknown>;

/** 注册了的一个音源模组。 */
export interface RegisteredBuiltinSource {
    dir: string;
    modId: string;
    /** 宿主认的音源 id：受信表里的模组是短 id，别的是 folium.<模组 id>.<名字>。 */
    sourceIds: string[];
    unregister(): void;
}

const rpcHandlers = new Map<string, BuiltinSourceRpcHandlers>();

/** 接住模组 `modId` 到 main 入口的调用；交回撤掉它的函数。 */
export const setBuiltinSourceRpc = (modId: string, handlers: BuiltinSourceRpcHandlers): (() => void) => {
    rpcHandlers.set(modId, handlers);
    return () => {
        if (rpcHandlers.get(modId) === handlers) rpcHandlers.delete(modId);
    };
};

const callRpc = async (modId: string, name: string, args: unknown[]): Promise<unknown> => {
    const handler = rpcHandlers.get(modId)?.[name];
    if (!handler) throw new Error(`[builtinSources] ${modId} 调了 main 入口的 ${name}，测试没有用 setBuiltinSourceRpc 接住它`);
    // 和真的 rpc 一样只过可以 JSON 化的东西。
    return JSON.parse(JSON.stringify(await handler(...args)) ?? 'null');
};

/** `root` 下的音源目录（带 mod.json 的子目录），排好序；目录不存在时是空的。 */
export const listBuiltinSourceDirs = (root: string = BUILTIN_SOURCES_ROOT): string[] => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(root, entry.name, 'mod.json')))
        .map((entry) => path.join(root, entry.name))
        .sort();
};

const firstExisting = (base: string): string | null => (
    ['.ts', '.tsx', '.mts', '.js', '.mjs'].map((extension) => `${base}${extension}`).find((file) => fs.existsSync(file)) ?? null
);

interface SourceManifest {
    id: string;
    name: string;
    version: string;
    locales?: string;
    sources: { id: string; name: string | Record<string, string>; requires?: string[]; keepForMatching?: boolean }[];
}

/**
 * 注册 `root` 下的每个音源模组（缺省是仓库的 sources/）。一个都没有时交回空表，不载入宿主模块。
 * 一个模组注册失败就抛错（测试里看见的应当和桌面上一样）。
 */
export const registerBuiltinSources = async ({ root = BUILTIN_SOURCES_ROOT }: { root?: string } = {}): Promise<RegisteredBuiltinSource[]> => {
    const dirs = listBuiltinSourceDirs(root);
    if (dirs.length === 0) return [];

    const [sourcesRegistryModule, guard, api, i18nModule, sourceText, folium18n, locales] = await Promise.all([
        import('@/mods/folium/registries/sources'),
        import('@/mods/runtime/guard'),
        import('@/mods/folium/api'),
        import('@/i18n/config'),
        import('@/mods/folium/registries/sourceText'),
        import('@/mods/folium/sources/i18n'),
        import('../../../dev/sources/locales.mjs') as Promise<{ toTraditionalLocale: (value: unknown) => unknown }>,
    ]);
    const builtinTable = createRequire(import.meta.url)('../../../electron/modSystem/builtinSources.cjs') as { BUILTIN_SOURCE_TABLE: Record<string, { sources: string[] }> };
    const { registerFoliumSource, createFoliumPageStore, getFoliumSourceCapability, sourcesRegistry } = sourcesRegistryModule;
    const i18n = i18nModule.default;
    const table = builtinTable.BUILTIN_SOURCE_TABLE;

    const registered: RegisteredBuiltinSource[] = [];
    for (const dir of dirs) {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')) as SourceManifest;
        const modId = manifest.id;
        const row = Object.hasOwn(table, modId) ? table[modId] : null;
        const hostIdOf = (localId: string) => (row?.sources.includes(localId) ? localId : `folium.${modId}.${localId}`);
        const mod: ModRuntimeInfo = {
            id: modId, name: manifest.name, version: manifest.version, author: null, description: null, permissions: [],
            status: 'loaded', error: null, enabled: true, trustStale: false,
            signature: { status: 'builtin', reason: null, keyId: null, keyLabel: null, signedAt: null },
            devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: true, clientUrl: null,
            folium: 2, tier: 'builtin', kind: 'source', contexts: null, locales: manifest.locales ?? null,
            sources: manifest.sources.map((source) => ({
                id: hostIdOf(source.id), localId: source.id, name: source.name, state: 'enabled',
                keepForMatching: source.keepForMatching === true, takeover: false, requires: source.requires ?? [],
            })),
        };

        // 语言表：和运行时一样进 folium-mod/<模组 id> 命名空间，zh-TW 由 zh-CN 生成。
        const namespace = sourceText.foliumModTextNamespace(modId);
        const localeDir = path.join(dir, manifest.locales ?? 'locales');
        const languages: string[] = [];
        if (fs.existsSync(localeDir)) {
            for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
                const language = file.slice(0, -'.json'.length);
                const data = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')) as Record<string, unknown>;
                i18n.addResourceBundle(language, namespace, data, true, true);
                languages.push(language);
                if (language === 'zh-CN') {
                    i18n.addResourceBundle('zh-TW', namespace, locales.toTraditionalLocale(data) as Record<string, unknown>, true, true);
                    languages.push('zh-TW');
                }
            }
        }

        guard.markFoliumSourceMod(modId, true);
        const stopped = () => false;
        const register = (def: FoliumSourceDef) => registerFoliumSource({ mod, stopped }, def);
        const rpc: FoliumRpc = {
            call: <T>(name: string, ...args: unknown[]) => callRpc(modId, name, args) as Promise<T>,
            on: () => () => {},
        };
        const coreFile = firstExisting(path.join(dir, 'core', 'index'));
        const core = coreFile ? await import(/* @vite-ignore */ coreFile.split(path.sep).join('/')) as { createSource?: (env: BuiltinSourceTestEnv) => FoliumSourceDef | FoliumSourceDef[] } : null;
        if (core?.createSource) {
            const i18nService = folium18n.createFoliumI18n();
            const env: BuiltinSourceTestEnv = {
                modId,
                call: rpc.call,
                text: (key, params) => i18nService.key(key, params),
                pageStore: createFoliumPageStore,
            };
            const defs = core.createSource(env);
            (Array.isArray(defs) ? defs : [defs]).forEach(register);
        } else {
            const clientFile = firstExisting(path.join(dir, 'client', 'index'));
            if (!clientFile) throw new Error(`[builtinSources] ${dir} 既没有 core/index.ts 的 createSource，也没有 client/index.ts`);
            const client = await import(/* @vite-ignore */ clientFile.split(path.sep).join('/')) as FoliumClientModule;
            const folium: FoliumClientApi = {
                ...api.createFoliumClientApi(mod, {
                    context: 'main', experimental: {}, onRelease: () => {}, stopped,
                    sources: { register, capability: getFoliumSourceCapability, pageStore: createFoliumPageStore },
                }),
                rpc,
            };
            await client.default(folium);
        }

        registered.push({
            dir,
            modId,
            sourceIds: sourcesRegistryModule.listFoliumSourceIdsOf(modId).map(hostIdOf),
            unregister: () => {
                sourcesRegistry.unregisterAll(modId);
                guard.markFoliumSourceMod(modId, false);
                languages.forEach((language) => i18n.removeResourceBundle(language, namespace));
            },
        });
    }
    return registered;
};

/** 测试文件里写了这一行注释，setup 才给它注册仓库里的音源模组（和 `// @vitest-environment jsdom` 一样写在文件里）。 */
export const BUILTIN_SOURCES_MARKER = '// @builtin-sources';

/** 这个测试文件要不要内置音源：文件里有一行正是 BUILTIN_SOURCES_MARKER。 */
export const wantsBuiltinSources = (testFile: string | undefined): boolean => {
    if (!testFile || !fs.existsSync(testFile)) return false;
    return fs.readFileSync(testFile, 'utf8').split(/\r?\n/).some((line) => line.trim() === BUILTIN_SOURCES_MARKER);
};

// setupFiles：给写了 `// @builtin-sources` 的测试文件注册仓库里的音源模组（还没有音源时什么都不做）。
//
// S5 迁波点时收窄成按文件选择（S4 交接 §4 的建议），实测两件事：
//   - 每个测试文件都注册时，全量单测从 90 秒涨到 249 秒（每个文件都要载入 omni、适配层、i18n），43 个文件失败：
//     它们 vi.mock 了 omni、providerRegistry、存储或计时器，注册撞在这些替身上。
//   - 注册放在 beforeAll 里，不在 setup 文件载入时做：setup 文件先于测试文件执行，它载入时 import 的宿主模块进了模块缓存，
//     测试文件里的 vi.mock 就盖不到它们了（lyricsSource 拿到的是真的 workerClient）。beforeAll 在测试文件载入、它的
//     vi.mock 生效之后才跑，注册用的就是测试文件看到的同一批模块。所以测试文件顶层（第一个用例之前）还拿不到内置音源：
//     要用的在用例或 beforeAll 里取（helpers/bodianSource.ts 的 lazyBodian）。
if (listBuiltinSourceDirs().length > 0 && wantsBuiltinSources(expect.getState().testPath)) {
    beforeAll(async () => { await registerBuiltinSources(); });
}
