#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaOf } from './format.mjs';
import { findBoundaryEdges } from '../../dedicatus/checks/boundaries.mjs';
import { buildModuleGraph } from './graph/modules.mjs';
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

// 分层边界规则与检查在 dev/dedicatus（rules.mjs、checks/boundaries.mjs），这里只取结果写进地图。

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

    const { violations, misplaced } = findBoundaryEdges(graph);

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
    out.push('规则是人定的（见 `dev/dedicatus/rules.mjs`），拿真实的值导入图去比对；行首是 Dedicatus 的代码（`npm run dedicatus`）。');
    out.push('`import type` 不算——它在运行时不存在。');
    out.push('');
    if (violations.length === 0) {
        out.push('当前没有违规。');
    } else {
        out.push('下面这些边的依赖方向本身就是错的：');
        out.push('');
        for (const v of violations) out.push(`- ${v.code} \`${v.from}\` → \`${v.to}\`  —— ${v.why}`);
    }
    out.push('');

    if (misplaced.length > 0) {
        out.push('### 目录归属存疑');
        out.push('');
        out.push('这些边命中了规则，但目标模块在运行时根本不含 UI（不传递依赖 react）。');
        out.push('依赖方向没问题，是文件住在了 UI 目录（`src/components/`、`src/library/` 的 suites / app）下面。修法是移动文件，不是改依赖。');
        out.push('');
        for (const v of misplaced) out.push(`- D190 \`${v.from}\` → \`${v.to}\``);
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
