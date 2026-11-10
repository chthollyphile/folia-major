import { edgeKey } from '../../mcp/ts-code-map/graph/modules.mjs';
import { MOD_INTEGRATION_POINTS } from '../modIntegrationPoints.mjs';
// dev/dedicatus/checks/modIntegration.mjs
// D307：`src/mods/` 之外的应用代码在运行时引用 `src/mods/**`，必须是登记过的接入点（dev/dedicatus/modIntegrationPoints.mjs）。
// 只看值导入；测试、开发脚本不算应用代码。

const MODS = 'src/mods/';

/**
 * @param {{ forward: Map<string, Set<string>>, typeOnly: Set<string> }} graph
 * @param {Iterable<string>} registered
 */
export function checkModIntegration(graph, registered = MOD_INTEGRATION_POINTS) {
    const allowed = new Set(registered);
    const findings = [];
    for (const [from, targets] of graph.forward) {
        if (!from.startsWith('src/') || from.startsWith(MODS) || allowed.has(from)) continue;
        for (const to of targets) {
            if (!to.startsWith(MODS) || graph.typeOnly.has(edgeKey(from, to))) continue;
            findings.push({
                code: 'D307',
                file: from,
                to,
                message: '模组系统的接入点没登记：先写进 src/mods/README.md 的接入点表，再登记在 dev/dedicatus/modIntegrationPoints.mjs',
                key: `D307:${from}->${to}`,
            });
        }
    }
    return findings;
}
