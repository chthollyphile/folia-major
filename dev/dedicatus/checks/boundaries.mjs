import { edgeKey } from '../../mcp/ts-code-map/graph/modules.mjs';
import { BOUNDARY_RULES, UI_DIRS, computeUiModules, ruleMatches } from '../rules.mjs';
// dev/dedicatus/checks/boundaries.mjs
// 分层边界检查：拿 rules.mjs 的规则去比对模块图里的每条值导入边，命中的按规则的代码报；
// 指向 UI 目录、目标却不含 UI 的边报 D190（文件住错了目录，不是依赖方向错了）。

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 找出所有越界的值导入边。
 * @returns {{ violations: object[], misplaced: object[] }} 两组都按 from、to 排序；每项带 code、from、to、why、rule。
 */
export function findBoundaryEdges(graph) {
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
            if (nominal) misplaced.push({ code: 'D190', from, to, why: rule.why, rule: rule.code });
            else violations.push({ code: rule.code, from, to, why: rule.why, rule: rule.code });
        }
    }
    const byPath = (a, b) => byText(a.from, b.from) || byText(a.to, b.to);
    violations.sort(byPath);
    misplaced.sort(byPath);
    return { violations, misplaced };
}

/** 边界检查的结果，转成 Dedicatus 的统一格式。 */
export function checkBoundaries(graph) {
    const { violations, misplaced } = findBoundaryEdges(graph);
    return [
        ...violations.map(edge => ({
            code: edge.code,
            file: edge.from,
            to: edge.to,
            message: edge.why,
            key: `${edge.code}:${edge.from}->${edge.to}`,
        })),
        ...misplaced.map(edge => ({
            code: 'D190',
            file: edge.from,
            to: edge.to,
            message: `目标在运行时不含 UI，是文件住错了目录（命中 ${edge.rule}：${edge.why}）`,
            key: `D190:${edge.from}->${edge.to}`,
        })),
    ];
}
