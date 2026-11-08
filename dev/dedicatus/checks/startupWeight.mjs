import fs from 'node:fs';
import path from 'node:path';
import { edgeKey } from '../../mcp/ts-code-map/graph/modules.mjs';
import { scanModuleSpecifiers } from '../../mcp/ts-code-map/graph/specifiers.mjs';
// dev/dedicatus/checks/startupWeight.mjs
// D306：从应用入口出发、只走静态值导入能到的文件（首屏要加载的闭包）里，不出现登记的重型包。
// 歌词样式、背景、非默认 suite 的渲染组件要 React.lazy（codebase-navigation、docs/library-suites.md；#304：animejs 被静态导入、
// 落进启动包）。entry.tsx 静态引入了渲染器，也会经 registry 的 eager glob 把重型包带进这个闭包，所以一并挡住。

/** 首屏入口：index.tsx 立刻用 import('./bootstrap') 拉起应用，所以 bootstrap 的静态闭包就是首屏。 */
export const STARTUP_ENTRIES = ['src/index.tsx', 'src/bootstrap.tsx'];
/** 不该进首屏闭包的包（前缀匹配，`@react-three/` 认整个作用域）。 */
export const HEAVY_PACKAGES = ['three', '@react-three/', 'pixi.js', 'animejs', 'opencc-js', 'postprocessing'];

const isHeavy = specifier => HEAVY_PACKAGES.some(name => (name.endsWith('/') ? specifier.startsWith(name) : specifier === name || specifier.startsWith(`${name}/`)));

/** 入口的静态值导入闭包（不走 import type，不走只有动态 import() 的边）。 */
export function startupClosure(graph, entries = STARTUP_ENTRIES) {
    const seen = new Set(entries);
    const queue = [...entries];
    while (queue.length > 0) {
        const current = queue.pop();
        for (const target of graph.forward.get(current) ?? []) {
            const key = edgeKey(current, target);
            if (seen.has(target) || graph.typeOnly.has(key) || graph.dynamic.has(key)) continue;
            seen.add(target);
            queue.push(target);
        }
    }
    return seen;
}

export function checkStartupWeight(root, graph) {
    if (!STARTUP_ENTRIES.every(entry => graph.fileSet?.has(entry))) return [];
    const findings = [];
    for (const file of [...startupClosure(graph)].sort()) {
        let text;
        try {
            text = fs.readFileSync(path.join(root, file), 'utf8');
        } catch {
            continue;
        }
        const heavy = new Set(scanModuleSpecifiers(text, file)
            .filter(({ specifier, typeOnly, dynamic }) => !typeOnly && !dynamic && isHeavy(specifier))
            .map(({ specifier }) => specifier));
        for (const specifier of heavy) {
            findings.push({
                code: 'D306',
                file,
                message: `首屏闭包里静态引入了重型包 ${specifier}：改成 React.lazy / 动态 import()，或者别让首屏路径静态引用这个文件`,
                key: `D306:${file}:${specifier}`,
            });
        }
    }
    return findings;
}
