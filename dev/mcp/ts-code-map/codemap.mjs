#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaOf } from './format.mjs';
import { buildModuleGraph, edgeKey } from './graph/modules.mjs';
import { LIBRARY_CORE, libraryLayerOf } from './libraryLayers.mjs';
// dev/mcp/ts-code-map/codemap.mjs

/**
 * 从编译器推导出的代码地图生成器。
 *
 * 存在的理由：手维护的路径表必然过期（这个仓库的 skill 里曾同时存在 7 处死引用，
 * visualizer 模式清单也少了两个）。地图改成生成的之后，过期在结构上就不可能发生——
 * `codemap-sync` workflow 在 main 上重新生成，有 diff 就提交。
 *
 * 输出必须是确定性的：所有集合都排序，否则每次 push 都会产生一个假的同步提交。
 *
 * 光排序还不够——**精确计数本身就是噪声源**。近 60 个 main 提交里有 10 个是同步提交，
 * 因为任何一个新文件都会动「区域分布」的数字，任何一条 import 都会动「枢纽模块」的数字，
 * 而 15 名附近的计数密集到 28/28/28/27/26/26/26，随便一改就换位。这些提交没有一条
 * 传达了「结构变了」，它们只是把计数器往前拨了一格。
 *
 * 所以这份文件里所有的量都**向下取整到 2 的幂**（`magnitude`），排序也按量级而不是精确值，
 * 名次因此不会因为相邻两个数字互换而抖动。要精确数字的场合本来就不该读这份快照，
 * 该问 `cli.mjs`——它是按需查询的，没有被提交的问题。
 */

/**
 * 不超过 n 的最大 2 的幂。数量级是这份地图唯一需要表达的精度：知道 `types.ts` 在 512 这一档、
 * 而次高的枢纽在 64 这一档，才是"改它波及面最大"的意思；534 和 533 的区别不是。
 */
const magnitude = n => (n < 1 ? 0 : 2 ** Math.floor(Math.log2(n)));

/**
 * 文本排序，按 UTF-16 码元。**不能用 `localeCompare`**：它的结果取决于运行环境的 ICU
 * collation，中文区域名和英文区域名的相对顺序在开发机（zh_CN）和 CI（ubuntu 默认）上是
 * 反的——`其他` / `types` 同档时一台机器排前一台排后，于是每次 push 都被 CI 改回去，
 * 正好是这次要消掉的那种假同步提交。码元序难看但在哪儿都一样，这里要的就是这个。
 *
 * 精确计数时代这个坑碰不到：两个名字只要计数不同就轮不到比字符串。改成按量级分档之后
 * 平局变成常态，它才浮出来。
 */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 枢纽的门槛也取 2 的幂，和展示的档位同一套刻度；当前落在这条线以上的有 11 个模块。 */
const HUB_MIN_DEPS = 32;

/**
 * 分层边界。左边不该在运行时依赖右边。
 * 只看值导入——`import type` 在运行时不存在，把它算成违规会产生大量假警报
 * （比如 stores 只是 `import type { PanelTab }` 就会被误判成依赖了组件）。
 */
const BOUNDARY_RULES = [
    { from: /^src\/stores\//, to: /^src\/(components|library\/(suites|app))\//, why: 'store 不应依赖组件' },
    {
        from: /^src\/utils\//,
        to: /^src\/(components|hooks|stores|library\/(suites|app|core\/(state|bindings)))\//,
        why: '纯变换不应依赖 UI 或状态',
    },
    {
        from: /^src\/types/,
        to: /^src\/(components|hooks|stores|services|library\/(suites|app|core\/(services|state|bindings)))\//,
        why: '契约层不应依赖实现',
    },
    { from: /^src\/services\//, to: /^src\/(components|library\/(suites|app))\//, why: 'service 不应依赖组件' },
    // 共享 wall 引擎与内容无关：Lattice 与资料库 suite 都用它（test/unit/wall/wallBoundaries.test.ts 同一条）。
    {
        from: /^src\/components\/wall\//,
        to: /^src\/(components\/app|library)\//,
        why: 'wall 引擎不应依赖 Lattice（components/app）或资料库',
    },
    {
        from: /^src\/(components|hooks|stores|library\/(core|suites|app))\//,
        to: /^src\/services\/onlineMusic\/.*(Provider|Transport)\.ts$/,
        when: from => !from.startsWith(LIBRARY_CORE) || ['state', 'binding'].includes(libraryLayerOf(from)),
        why: '普通调用应经过 omni，不应直连 provider adapter/transport',
    },
    // src/library：headless core 与 UI suites 分开。core 按功能分文件夹，层由文件名说（libraryLayers.mjs），
    // 与老目录一一对应——contract≈types、model≈utils、service≈services、state≈stores、binding≈hooks；
    // suites/*、app 与 registry 是 UI，地位等同 components（见 UI_DIRS）。
    {
        from: /^src\/library\/core\//,
        to: /^src\/(components\/|library\/(suites\/|app\/|registry\.))/,
        why: 'library core 不应依赖 UI（suites、app、registry、components）',
    },
    {
        from: /^src\/library\/core\//,
        to: /^src\/(?!types)/,
        when: (from, to) => libraryLayerOf(from) === 'contract' && libraryLayerOf(to) !== 'contract',
        why: 'core 的契约（*.contract）只引用别的契约与 src/types 的数据类型',
    },
    {
        from: /^src\/library\/core\//,
        to: /^src\/(components|hooks|stores|services|library\/core)\//,
        when: (from, to) => libraryLayerOf(from) === 'model'
            && (!to.startsWith(LIBRARY_CORE) || ['service', 'state', 'binding'].includes(libraryLayerOf(to))),
        why: 'core 的纯变换（model）是叶子：不读状态、不调 service、不碰绑定',
    },
    {
        from: /^src\/library\/core\//,
        to: /^src\/(hooks|library\/core)\//,
        when: (from, to) => ['service', 'state'].includes(libraryLayerOf(from)) && (to.startsWith('src/hooks/') || libraryLayerOf(to) === 'binding'),
        why: 'core 的 service 与 state 不应依赖 React 绑定',
    },
    {
        from: /^src\/library\/suites\//,
        to: /^src\/library\/suites\//,
        when: (from, to) => suiteOf(from) !== suiteOf(to),
        why: 'suite 之间互不依赖',
    },
    {
        from: /^src\/library\/suites\//,
        to: /^src\/library\/core\//,
        when: (_from, to) => libraryLayerOf(to) === 'service',
        why: 'suite 不直接用 core 的 service：资源与控制器由宿主（app）创建后传入',
    },
    {
        from: /^src\/(?!library\/(suites\/|registry\.))/,
        to: /^src\/library\/suites\//,
        why: 'suite 只经 registry 使用：宿主与外壳按 surface 解析，不直接 import 某套 suite',
    },
];

/** `src/library/suites/<id>/...` 的 suite id。 */
const suiteOf = file => /^src\/library\/suites\/([^/]+)\//.exec(file)?.[1] ?? null;

/**
 * 按目录算作 UI 的地方。命中规则、目标却不含 UI 的边记为「目录归属存疑」：依赖方向没问题，
 * 是纯模块住进了 UI 目录（修法是把它挪进 core 对应的功能文件夹或 utils，不是改依赖）。
 */
const UI_DIRS = /^src\/(components\/|library\/(suites\/|app\/|registry\.))/;

const ruleMatches = (rule, from, to) => rule.from.test(from) && rule.to.test(to) && (!rule.when || rule.when(from, to));

/**
 * 哪些模块在运行时真的会把 React 拉进来。
 *
 * 规则只能看路径，而路径会撒谎：`components/visualizer/colorMix.ts` 是零依赖的纯色彩数学，
 * 只是住在 components 目录下。反过来 `components/visualizer/registry.tsx` 看着人畜无害，
 * 实际用 eager glob 拉进 13 个 renderer。所以「是不是 UI」要从依赖图推，不能从目录猜。
 *
 * 种子是值导入 react 的文件，沿值导入边向依赖方传染（`import type` 不传染，运行时不存在）。
 */
function computeUiModules(graph) {
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

function collect(root) {
    const graph = buildModuleGraph(root);

    const areas = new Map();
    for (const file of graph.files) areas.set(areaOf(file), (areas.get(areaOf(file)) ?? 0) + 1);

    // 按量级排序、量级内按路径：精确计数只用来选人和分档，不参与排序，否则 37 和 36 互换
    // 就会重排整张表。也不再切前 N 名——名次在密集区抖得最厉害，门槛是稳定的，名次不是。
    const hubs = [...graph.reverse]
        .map(([file, deps]) => ({ file, tier: magnitude(deps.size), count: deps.size }))
        .filter(h => h.count >= HUB_MIN_DEPS)
        .sort((a, b) => b.tier - a.tier || byText(a.file, b.file));

    const SEP = String.fromCharCode(0);
    const registries = new Map();
    for (const key of graph.globEdges) {
        const [from, to] = key.split(SEP);
        if (!registries.has(from)) registries.set(from, []);
        registries.get(from).push(to);
    }

    const uiModules = computeUiModules(graph);
    const violations = [];
    const misplaced = [];
    for (const [from, targets] of graph.forward) {
        for (const to of targets) {
            if (graph.typeOnly.has(edgeKey(from, to))) continue;
            const rule = BOUNDARY_RULES.find(r => ruleMatches(r, from, to));
            if (!rule) continue;
            // 指向 UI 目录（components、library 的 suites / app / registry）但目标其实不含 UI：
            // 依赖方向没问题，是文件住错了目录。
            const nominal = UI_DIRS.test(to) && !uiModules.has(to);
            (nominal ? misplaced : violations).push({ from, to, why: rule.why });
        }
    }
    const byPath = (a, b) => byText(a.from, b.from) || byText(a.to, b.to);
    violations.sort(byPath);
    misplaced.sort(byPath);

    return { areas, hubs, registries, violations, misplaced };
}

function render({ areas, hubs, registries, violations, misplaced }) {
    const out = [];
    out.push('# 代码地图');
    out.push('');
    out.push('<!-- 这份文件由 `npm run codemap` 生成，不要手改。CI 会重新生成并比对。 -->');
    out.push('');
    out.push('全部内容由 TypeScript 编译器和模块图推导，不是人工维护的清单。');
    out.push('想知道某个具体符号在哪，用 `node dev/mcp/ts-code-map/cli.mjs search \'{"query":"..."}\'`。');
    out.push('');
    out.push('文件里所有的量都只给**数量级**（向下取整到 2 的幂，写作 `512+`），排序也按量级。');
    out.push('这是有意的：精确计数会让每个新文件、每条 import 都产生一次同步提交，而那些提交');
    out.push('没有一条说明结构变了。要精确数字就问 `cli.mjs`，它是按需查询、不进版本库的。');
    out.push('');

    out.push('## 区域分布');
    out.push('');
    out.push('| 区域 | 文件数量级 |');
    out.push('| --- | --- |');
    const areaTiers = [...areas].map(([area, count]) => [area, magnitude(count)]);
    for (const [area, tier] of areaTiers.sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))) {
        out.push(`| ${area} | ${tier}+ |`);
    }
    out.push('');

    out.push('## 枢纽模块');
    out.push('');
    out.push(`被 ${HUB_MIN_DEPS} 个以上模块依赖的文件。改动它们波及面最大，读代码时也最值得先看。`);
    out.push('');
    out.push('| 被依赖量级 | 模块 |');
    out.push('| --- | --- |');
    for (const hub of hubs) out.push(`| ${hub.tier}+ | \`${hub.file}\` |`);
    out.push('');

    out.push('## 动态注册点');
    out.push('');
    out.push('这些地方用 `import.meta.glob` 自动发现成员，**清单随目录变化，不要手写**。');
    out.push('以下是当前的完整展开：');
    out.push('');
    for (const [registry, members] of [...registries].sort((a, b) => byText(a[0], b[0]))) {
        // 不写成员数：清单就在下面，数一下就有，而写出来等于每加一个成员都多改一行。
        out.push(`### \`${registry}\``);
        out.push('');
        for (const member of [...members].sort(byText)) out.push(`- \`${member}\``);
        out.push('');
    }

    out.push('## 分层边界违规');
    out.push('');
    out.push('规则是人定的（见 `codemap.mjs` 的 `BOUNDARY_RULES`），拿真实的值导入图去比对。');
    out.push('`import type` 不算——它在运行时不存在。');
    out.push('');
    if (violations.length === 0) {
        out.push('当前没有违规。');
    } else {
        out.push('下面这些边的依赖方向本身就是错的：');
        out.push('');
        for (const v of violations) out.push(`- \`${v.from}\` → \`${v.to}\`  —— ${v.why}`);
    }
    out.push('');

    if (misplaced.length > 0) {
        out.push('### 目录归属存疑');
        out.push('');
        out.push('这些边命中了规则，但目标模块在运行时根本不含 UI（不传递依赖 react）。');
        out.push('依赖方向没问题，是文件住在了 UI 目录（`src/components/`、`src/library/` 的 suites / app）下面。修法是移动文件，不是改依赖。');
        out.push('');
        for (const v of misplaced) out.push(`- \`${v.from}\` → \`${v.to}\``);
        out.push('');
    }

    return `${out.join('\n')}\n`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const outputPath = path.join(root, 'docs/CODEMAP.md');
const rendered = render(collect(root));

if (process.argv.includes('--check')) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (existing === rendered) {
        console.log('docs/CODEMAP.md 是最新的。');
        process.exit(0);
    }
    console.error('docs/CODEMAP.md 与代码不一致。跑 `npm run codemap` 重新生成并提交。');
    process.exit(1);
}

fs.writeFileSync(outputPath, rendered);
console.log(`已写入 docs/CODEMAP.md (${Buffer.byteLength(rendered)} 字节)`);
