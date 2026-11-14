import { edgeKey } from '../mcp/ts-code-map/graph/modules.mjs';
import { LIBRARY_CORE, libraryLayerOf } from '../mcp/ts-code-map/libraryLayers.mjs';
// dev/dedicatus/rules.mjs
// 分层边界规则的唯一来源：左边不该在运行时依赖右边，每条带一个 Dedicatus 代码。
// 代码地图（dev/mcp/ts-code-map/codemap.mjs）和 Dedicatus 的边界检查都从这里读。
// 只看值导入——`import type` 在运行时不存在，把它算成违规会产生大量假警报
// （比如 stores 只是 `import type { PanelTab }` 就会被误判成依赖了组件）。带 `types: true` 的规则例外：
// 它管的是编译边界（音源模组只对着公开类型编译），`import type` 也算。

export const BOUNDARY_RULES = [
    { code: 'D101', from: /^src\/stores\//, to: /^src\/(components|library\/(suites|app))\//, why: 'store 不应依赖组件' },
    {
        code: 'D102',
        from: /^src\/utils\//,
        to: /^src\/(components|hooks|stores|library\/(suites|app|core\/(state|bindings)))\//,
        why: '纯变换不应依赖 UI 或状态',
    },
    {
        code: 'D103',
        from: /^src\/types/,
        to: /^src\/(components|hooks|stores|services|library\/(suites|app|core\/(services|state|bindings)))\//,
        why: '契约层不应依赖实现',
    },
    { code: 'D104', from: /^src\/services\//, to: /^src\/(components|library\/(suites|app))\//, why: 'service 不应依赖组件' },
    // 共享 wall 引擎与内容无关：Lattice 与资料库 suite 都用它（test/unit/wall/wallBoundaries.test.ts 同一条）。
    {
        code: 'D105',
        from: /^src\/components\/wall\//,
        to: /^src\/(components\/app|library)\//,
        why: 'wall 引擎不应依赖 Lattice（components/app）或资料库',
    },
    {
        code: 'D110',
        from: /^src\/(components|hooks|stores|library\/(core|suites|app))\//,
        // Folium 2.0：平台的代码从 src/services/onlineMusic/<id>/ 逐家搬进 sources/<id>/（S5），搬的过程中两边都查。
        to: /^(src\/services\/onlineMusic\/.*(Provider|Transport)\.ts|sources\/.*)$/,
        when: from => !from.startsWith(LIBRARY_CORE) || ['state', 'binding'].includes(libraryLayerOf(from)),
        why: '普通调用应经过 omni，不应直连 provider adapter/transport',
    },
    // Folium 2.0 方案 §6.1：仓库里的音源模组（sources/<id>/）只用公开接口。`types: true`：连 `import type` 也算，
    // 它们只对着 mods/folium.d.ts 和 kit 编译（sources/tsconfig.json 没有 @/ 别名，相对路径的 import type 在这里拦）。
    {
        code: 'D130',
        from: /^sources\//,
        to: /^(src|electron|shared)\//,
        types: true,
        why: '音源模组只用公开接口（mods/folium.d.ts、@folia/folium-source-kit），不 import 宿主',
    },
    {
        code: 'D131',
        from: /^(src|electron|shared)\//,
        to: /^sources\//,
        when: (from, to) => !(from.startsWith('src/services/onlineMusic/web/') && /^sources\/[^/]+\/core\//.test(to)),
        why: '宿主只经 src/services/onlineMusic/web/* 用 sources/*/core（网页版的 adapter），别处经模组运行时和 omni',
    },
    {
        code: 'D132',
        from: /^sources\/[^/]+\//,
        to: /^sources\/[^/]+\//,
        types: true,
        when: (from, to) => sourceOf(from) !== sourceOf(to),
        why: '音源模组之间不互相 import：各自打成自己的 bundle，共用的放 packages/folium-source-kit',
    },
    // src/library：headless core 与 UI suites 分开。core 按功能分文件夹，层由文件名说（libraryLayers.mjs），
    // 与老目录一一对应——contract≈types、model≈utils、service≈services、state≈stores、binding≈hooks；
    // suites/*、app 与 registry 是 UI，地位等同 components（见 UI_DIRS）。
    {
        code: 'D201',
        from: /^src\/library\/core\//,
        to: /^src\/(components\/|library\/(suites\/|app\/|registry\.))/,
        why: 'library core 不应依赖 UI（suites、app、registry、components）',
    },
    {
        code: 'D202',
        from: /^src\/library\/core\//,
        to: /^src\/(?!types)/,
        when: (from, to) => libraryLayerOf(from) === 'contract' && libraryLayerOf(to) !== 'contract',
        why: 'core 的契约（*.contract）只引用别的契约与 src/types 的数据类型',
    },
    {
        code: 'D203',
        from: /^src\/library\/core\//,
        to: /^src\/(components|hooks|stores|services|library\/core)\//,
        when: (from, to) => libraryLayerOf(from) === 'model'
            && (!to.startsWith(LIBRARY_CORE) || ['service', 'state', 'binding'].includes(libraryLayerOf(to))),
        why: 'core 的纯变换（model）是叶子：不读状态、不调 service、不碰绑定',
    },
    {
        code: 'D204',
        from: /^src\/library\/core\//,
        to: /^src\/(hooks|library\/core)\//,
        when: (from, to) => ['service', 'state'].includes(libraryLayerOf(from)) && (to.startsWith('src/hooks/') || libraryLayerOf(to) === 'binding'),
        why: 'core 的 service 与 state 不应依赖 React 绑定',
    },
    {
        code: 'D205',
        from: /^src\/library\/suites\//,
        to: /^src\/library\/suites\//,
        when: (from, to) => suiteOf(from) !== suiteOf(to),
        why: 'suite 之间互不依赖',
    },
    {
        code: 'D206',
        from: /^src\/library\/suites\//,
        to: /^src\/library\/core\//,
        when: (_from, to) => libraryLayerOf(to) === 'service',
        why: 'suite 不直接用 core 的 service：资源与控制器由宿主（app）创建后传入',
    },
    {
        code: 'D207',
        from: /^src\/(?!library\/(suites\/|registry\.))/,
        to: /^src\/library\/suites\//,
        why: 'suite 只经 registry 使用：宿主与外壳按 surface 解析，不直接 import 某套 suite',
    },
];

/** `sources/<id>/...` 的音源目录名。 */
const sourceOf = file => /^sources\/([^/]+)\//.exec(file)?.[1] ?? null;

/** `src/library/suites/<id>/...` 的 suite id。 */
const suiteOf = file => /^src\/library\/suites\/([^/]+)\//.exec(file)?.[1] ?? null;

/**
 * 按目录算作 UI 的地方。命中规则、目标却不含 UI 的边记为「目录归属存疑」（D190）：依赖方向没问题，
 * 是纯模块住进了 UI 目录（修法是把它挪进 core 对应的功能文件夹或 utils，不是改依赖）。
 */
export const UI_DIRS = /^src\/(components\/|library\/(suites\/|app\/|registry\.))/;

export const ruleMatches = (rule, from, to) => rule.from.test(from) && rule.to.test(to) && (!rule.when || rule.when(from, to));

/**
 * 哪些模块在运行时真的会把 React 拉进来。
 *
 * 规则只能看路径，而路径会撒谎：`components/visualizer/colorMix.ts` 是零依赖的纯色彩数学，
 * 只是住在 components 目录下。反过来 `components/visualizer/registry.tsx` 看着人畜无害，
 * 实际用 eager glob 拉进 13 个 renderer。所以「是不是 UI」要从依赖图推，不能从目录猜。
 *
 * 种子是值导入 react 的文件，沿值导入边向依赖方传染（`import type` 不传染，运行时不存在）。
 */
export function computeUiModules(graph) {
    const tainted = new Set(graph.uiSeeds);
    const queue = [...graph.uiSeeds];
    while (queue.length > 0) {
        const current = queue.pop();
        for (const dependent of graph.reverse.get(current) ?? []) {
            if (tainted.has(dependent)) continue;
            if (graph.typeOnly.has(edgeKey(dependent, current))) continue;
            tainted.add(dependent);
            queue.push(dependent);
        }
    }
    return tainted;
}
