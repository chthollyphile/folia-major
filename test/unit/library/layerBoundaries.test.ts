import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { libraryLayerOf } from '../../../dev/mcp/ts-code-map/libraryLayers.mjs';

// test/unit/library/layerBoundaries.test.ts
// src/library 的分层约束，按源码文本检查（与 storeContract 同样的做法），和 codemap.mjs 的 BOUNDARY_RULES 同一套规则：
// - core 不依赖 React 动画、组件目录、suites、app 与 registry——换 suite 不该牵动它；
// - core 按功能分文件夹，层由文件名说（libraryLayers.mjs：*.contract、*.service、use*Store、use*，其余是 model）；
//   层之间按 contracts ← model ← services / state ← bindings 的方向：契约只引用契约与 src/types，
//   纯变换（model）是叶子，不读 store、不调 service、不碰 React；services / state 不碰绑定；
// - stores / services / utils / types 不依赖 suites 与 app；suites 之间互不依赖，也不直接用 core 的 service；
// - 列表 renderer（TUI）不拉进网格、hex 视口与打开转场；
// - suites 之外只有 registry 引用 suite（宿主、首页外壳都经 registry 解析）；registry 只认 core 的契约与纯规则；
// - 变更动作层只用注入的 omni 与缓存，默认装配集中在一处。

const ROOT = path.resolve(__dirname, '../../..');
const listSources = (dir: string): string[] => {
    if (!existsSync(path.join(ROOT, dir))) return [];
    return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return listSources(relative);
        return /\.tsx?$/.test(entry.name) ? [relative] : [];
    });
};
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** 值导入（运行时真的会加载的那些），不含 `import type`。 */
const importsOf = (file: string) => [...read(file).matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)]
    .filter(match => !/^import\s+type\s/.test(match[0]))
    .map(match => match[1]);

/** 全部模块说明符：值导入、`import type`、re-export 和动态 import()。用于「只能引用谁」这类规则。 */
const allSpecifiersOf = (file: string) => [
    ...[...read(file).matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)';/gms)].map(match => match[1]),
    ...[...read(file).matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map(match => match[1]),
];

/** 把相对说明符解析成仓库内的路径（不带扩展名）；裸包名原样返回。 */
const resolveSpecifier = (file: string, specifier: string) => {
    if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
    if (!specifier.startsWith('.')) return specifier;
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.tsx?$/, '');
};

const offendersOf = (
    files: string[],
    isForbidden: (target: string, file: string) => boolean,
    imports: (file: string) => string[] = importsOf,
) => files.flatMap(file => imports(file)
    .filter(specifier => isForbidden(resolveSpecifier(file, specifier), file))
    .map(specifier => `${file} -> ${specifier}`));

const CORE = 'src/library/core';
const CORE_FILES = listSources(CORE);
/** 一个仓库内路径（解析过的说明符）在 core 的哪一层；不在 core 里是 null。 */
const layerOf = (target: string) => libraryLayerOf(target);
const CONTRACTS = CORE_FILES.filter(file => layerOf(file) === 'contract');
const MODEL = CORE_FILES.filter(file => layerOf(file) === 'model');
const SERVICES = CORE_FILES.filter(file => layerOf(file) === 'service');
const STATE = CORE_FILES.filter(file => layerOf(file) === 'state');
const BINDINGS = CORE_FILES.filter(file => layerOf(file) === 'binding');
/** 不含 React 的 core 部分：契约、纯变换与资源 / 动作层（state 的 zustand 自带 React，单独看）。 */
const HEADLESS_FILES = [...CONTRACTS, ...MODEL, ...SERVICES];

const isUiTarget = (target: string) => /^src\/(components\/|library\/(suites\/|app\/|registry$))/.test(target);
const suiteOf = (file: string) => /^src\/library\/suites\/([^/]+)\//.exec(file)?.[1] ?? null;

describe('library core layer boundaries', () => {
    it('finds every core sublayer where the rules expect it', () => {
        for (const layer of [CONTRACTS, MODEL, SERVICES, STATE, BINDINGS]) expect(layer.length).toBeGreaterThan(0);
        // 按层分的旧文件夹不再出现：新文件放进它所属功能的文件夹，层写在文件名里。
        expect(['contracts', 'model', 'services', 'state', 'bindings'].filter(dir => existsSync(path.join(ROOT, CORE, dir)))).toEqual([]);
        // 旧位置不留转发文件。
        expect([
            ...listSources('src/utils/libraryUi'),
            ...listSources('src/services/libraryUi'),
            ...listSources('src/hooks/libraryUi'),
        ]).toEqual([]);
        expect(existsSync(path.join(ROOT, 'src/types/libraryUi.ts'))).toBe(false);
        expect(existsSync(path.join(ROOT, 'src/types/libraryCollection.ts'))).toBe(false);
    });

    it('keeps contracts, transforms and resources free of React, animation and components', () => {
        const offenders = offendersOf(HEADLESS_FILES, target => (
            target === 'react' || target === 'framer-motion' || /^src\/components\//.test(target)
        ));
        expect(offenders).toEqual([]);
    });

    it('keeps all of core away from the UI: components, suites, app and the registry', () => {
        expect(offendersOf(CORE_FILES, isUiTarget, allSpecifiersOf)).toEqual([]);
    });

    it('lets contracts reference only other contracts and the plain data types in src/types', () => {
        const offenders = offendersOf(CONTRACTS, target => (
            !/^src\/(types$|types\/)/.test(target) && layerOf(target) !== 'contract'
        ), allSpecifiersOf);
        expect(offenders).toEqual([]);
    });

    it('keeps pure transforms a leaf: no stores, services, hooks, bindings or React', () => {
        const offenders = offendersOf(MODEL, target => (
            target === 'react'
            || /^src\/(stores|services|hooks|components)\//.test(target)
            || ['state', 'service', 'binding'].includes(layerOf(target) ?? '')
        ));
        expect(offenders).toEqual([]);
    });

    it('keeps services and state independent of the React bindings', () => {
        const offenders = offendersOf([...SERVICES, ...STATE], target => (
            /^src\/hooks\//.test(target) || layerOf(target) === 'binding'
        ));
        expect(offenders).toEqual([]);
    });

    it('keeps the library hooks free of components and animation', () => {
        const offenders = offendersOf(BINDINGS, target => target === 'framer-motion' || /^src\/components\//.test(target));
        expect(BINDINGS).toContain(`${CORE}/collection/mutations/useCollectionMutations.ts`);
        expect(offenders).toEqual([]);
    });

    it('keeps stores, services, utils and types away from suites and the app assembly', () => {
        const files = [
            ...listSources('src/stores'),
            ...listSources('src/services'),
            ...listSources('src/utils'),
            ...listSources('src/types'),
            'src/types.ts',
        ];
        const offenders = offendersOf(files, target => /^src\/library\/(suites|app)\//.test(target), allSpecifiersOf);
        expect(offenders).toEqual([]);
    });

    it('keeps suites independent of each other and off the core services', () => {
        // suites 目录在 R2 才出现；规则先就位，空目录时自然通过。
        const offenders = offendersOf(listSources('src/library/suites'), (target, file) => (
            (/^src\/library\/suites\//.test(target) && suiteOf(`${target}/`) !== suiteOf(file))
            || layerOf(target) === 'service'
        ), allSpecifiersOf);
        expect(offenders).toEqual([]);
    });

    it('keeps the list renderer independent of the grid, its hex viewport and the open transition', () => {
        // P3.4 起 TUI 也有首页：网格首页的外壳、滑条、地图、批量面板同样不能被拉进来。
        const FORBIDDEN = [
            /\/GridView$/, /\/Grid3D$/, /\/GridMap$/, /\/ArtistGridView$/,
            /\/(DesktopGrid3DSurface|Grid3DSlider|GridViewTabs|GridMapBatchPanel|GridMapBatchItemList|gridMapCardText|gridMapNavigation)$/,
            /(^|\/)grid\/(home|directory|collection|artist|account|shared|transitions)\//,
            /(folia-grid|grid\/shared)\/(PolaroidCard|polaroidCardParts|hex\w*|useFoliaHexViewport)$/,
            /(collectionOpenMorph|grid\/transitions)\//,
        ];
        const tui = listSources('src/library/suites/tui');
        const offenders = tui.flatMap(file => importsOf(file)
            .filter(source => FORBIDDEN.some(pattern => pattern.test(source)))
            .map(source => `${file} -> ${source}`));
        expect(tui.length).toBeGreaterThan(0);
        expect(offenders).toEqual([]);
    });

    it('lets nothing outside the suites reach into a suite except the registry', () => {
        const files = listSources('src').filter(file => !/^src\/library\/(suites\/|registry\.ts$)/.test(file));
        const offenders = offendersOf(files, target => /^src\/library\/suites\//.test(target), allSpecifiersOf);
        expect(files).toEqual(expect.arrayContaining(['src/components/app/Home.tsx', 'src/library/app/GridViewOverlayHost.tsx']));
        expect(offenders).toEqual([]);
    });

    it('keeps the account host suite-agnostic: it resolves the account surface through the registry (A5)', () => {
        // 登录弹窗、确认框与它们的展示组件属于渲染 account surface 的那套 suite；宿主只经 registry 解析，
        // 不 import 任何组件（包括通用对话框与 provider 图标）。
        const HOST = 'src/library/app/LibraryAccountHost.tsx';
        const specifiers = allSpecifiersOf(HOST).map(specifier => resolveSpecifier(HOST, specifier));
        expect(specifiers).toContain('src/library/registry');
        expect(specifiers.filter(target => /^src\/(components|assets)\//.test(target) || target === 'framer-motion')).toEqual([]);
    });

    it('keeps the registry to discovery: only core contracts, pure rules and React types', () => {
        const offenders = offendersOf(['src/library/registry.ts'], target => (
            !(target === 'react' || ['contract', 'model'].includes(layerOf(target) ?? ''))
        ), allSpecifiersOf);
        expect(offenders).toEqual([]);
    });

    it('keeps the directory rules in core: the grid holds no copy of search, batch or visibility', () => {
        expect(MODEL).toEqual(expect.arrayContaining([
            `${CORE}/directory/directoryBatch.ts`,
            `${CORE}/directory/directorySearch.ts`,
            `${CORE}/directory/directoryVisibility.ts`,
        ]));
        // 旧位置不留转发文件：网格直接用 core 的纯规则（契约旧名 GridMapItem / GridMapBatch* 在 GridMap.tsx 里是别名）。
        expect(listSources('src/library/suites/grid/directory').filter(file => (
            /\/(gridMapBatch|gridMapSearch|gridItemVisibility)\.ts$/.test(file)
        ))).toEqual([]);
        // 隐藏表只有一个持有者：core 的隐藏 store（网格滑条与 GridMap 都经它读写）。
        expect(listSources('src').filter(file => read(file).includes("'hidden_grid_playlists'")))
            .toEqual([`${CORE}/collection/useHiddenCollectionsStore.ts`]);
    });

    it('keeps the home orchestration in core: the grid home views call no library or Navidrome service', () => {
        // P3.3：来源 / 页签、在线首页数据、导入、Navidrome 概览、文件夹树都在 core（model / services / bindings），
        // 网格的首页视图只做展示（omni 只剩 Grid3D 的二维码登录与账户切换在用）。
        const HOME_VIEWS = ['Grid3D.tsx', 'LocalGrid3DView.tsx', 'NavidromeGrid3DView.tsx'].map(name => `src/library/suites/grid/home/${name}`);
        const offenders = offendersOf(HOME_VIEWS, target => (
            /^src\/services\/(localMusicService|localPlaylistFileService|localLibraryDirectoryTree|localLibraryAvailability|navidromeService)$/.test(target)
            || /^src\/hooks\/useLocalLibraryCatalog$/.test(target)
        ), allSpecifiersOf);
        expect(offenders).toEqual([]);
        expect(listSources('src/library/suites/grid/home').filter(file => /\/(localGrid3DModel|useNavidromeGridLibrary)\.ts$/.test(file))).toEqual([]);
        // Navidrome section 记忆只有一个持有者：core 的 store。
        expect(listSources('src').filter(file => read(file).includes("'folia_navidrome_last_section'")))
            .toEqual([`${CORE}/home/navidrome/useNavidromeHomeSectionStore.ts`]);
    });

    it('keeps the artist data in core: the grid artist page loads nothing itself', () => {
        // P4.1：歌手页的数据是宿主持有的歌手资源（core/artist/artistResource.service），本地歌手由宿主的 catalog 派生；
        // 网格歌手页不再自己调 omni / Navidrome，也不再自带第二个本地曲库 catalog。
        const ARTIST_VIEWS = listSources('src/library/suites/grid/artist');
        const offenders = offendersOf(ARTIST_VIEWS, target => (
            /^src\/services\/(onlineMusic\/omni|navidromeService|localCoverAssetUrl|playbackAdapters)$/.test(target)
            || /^src\/hooks\/useLocalLibraryCatalog$/.test(target)
        ), allSpecifiersOf);
        expect(ARTIST_VIEWS).toContain('src/library/suites/grid/artist/ArtistGridView.tsx');
        expect(offenders).toEqual([]);
        // 歌手资源同样只用注入的上游：默认装配集中在 artistResourceDeps。
        const ARTIST_RESOURCE = `${CORE}/artist/artistResource.service.ts`;
        expect(importsOf(ARTIST_RESOURCE).filter(source => (
            /onlineMusic\/omni$|navidromeService$|\/stores\//.test(source) || layerOf(resolveSpecifier(ARTIST_RESOURCE, source)) === 'state'
        ))).toEqual([]);
    });

    it('keeps the account services injectable: omni and the stores are wired in providerAccountDeps only', () => {
        // A3：扫码会话与账户 controller 只经注入的端口工作；omni、账户 store 与网易后端 store 的默认装配集中在
        // providerAccountDeps，单测不经过它。
        expect(CORE_FILES).toEqual(expect.arrayContaining([
            `${CORE}/account/providerLoginSession.service.ts`,
            `${CORE}/account/providerAccountController.service.ts`,
            `${CORE}/account/providerAccountDeps.service.ts`,
        ]));
        const offenders = [`${CORE}/account/providerLoginSession.service.ts`, `${CORE}/account/providerAccountController.service.ts`]
            .flatMap(file => allSpecifiersOf(file)
                .filter(source => /onlineMusic\/omni$|\/stores\/|^react$/.test(source) || layerOf(resolveSpecifier(file, source)) === 'state')
                .map(source => `${file} -> ${source}`));
        expect(offenders).toEqual([]);
    });

    it('keeps the mutation layer injectable: omni and the cache are wired in one place only', () => {
        expect(CORE_FILES).toEqual(expect.arrayContaining([
            `${CORE}/collection/mutations/collectionMutationCapabilities.ts`,
            `${CORE}/collection/mutations/collectionMutations.service.ts`,
            `${CORE}/collection/mutations/collectionMutationDeps.service.ts`,
        ]));
        // 控制器只拿注入的 omni 子集与缓存删除函数；默认装配在 collectionMutationDeps，单测不经过它。
        const MUTATIONS = `${CORE}/collection/mutations/collectionMutations.service.ts`;
        const offenders = importsOf(MUTATIONS)
            .filter(source => /onlineMusic\/omni$|\/db$|\/stores\//.test(source) || layerOf(resolveSpecifier(MUTATIONS, source)) === 'state');
        expect(offenders).toEqual([]);
    });
});
