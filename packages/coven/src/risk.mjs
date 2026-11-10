// packages/coven/src/risk.mjs
// 风险分级：由条目本身（适配层的 baseRisk）和涉及的路径（配置里的 risk 表）确定性地算，LLM 只能往上调（往下调报 D807）。
//   R0–R2 的基础级别由适配层按条目定（Folia：只动空白和引号 R0、可自动修复的 lint R1、其余 R2）；
//   R3 碰到配置 risk.r3 的敏感路径；R4 碰到 risk.r4（项目规则、CI、检查规则、依赖），只写方案不实现。

export const RISKS = ['R0', 'R1', 'R2', 'R3', 'R4'];

export const riskRank = risk => RISKS.indexOf(risk);
export const maxRisk = (...risks) => risks.reduce((top, risk) => (riskRank(risk) > riskRank(top) ? risk : top), 'R0');

const matches = (rule, file) => (rule.prefix !== undefined ? file === rule.prefix || file.startsWith(rule.prefix) : new RegExp(rule.pattern).test(file));

/**
 * 一组路径命中的敏感规则。
 * @param {string[]} paths
 * @param {{ r3: Array<{prefix?: string, pattern?: string, why: string}>, r4: Array<{prefix?: string, pattern?: string, why: string}> }} rules
 * @returns {{ risk: string | null, reasons: string[] }}
 */
export function sensitiveRiskOf(paths, rules) {
    for (const level of ['r4', 'r3']) {
        const reasons = [];
        for (const file of paths) {
            for (const rule of rules[level] ?? []) {
                if (matches(rule, file)) reasons.push(`${file}：${rule.why}`);
            }
        }
        if (reasons.length > 0) return { risk: level.toUpperCase(), reasons };
    }
    return { risk: null, reasons: [] };
}

/**
 * 契约 scope.paths 的风险下限：能改到哪里，就至少是哪一级。目录要看它下面已有的文件，
 * 以及落在它下面的规则前缀（scope 写 `dev/`，`dev/coven/` 的规则也算）。
 * @param {string[]} paths
 * @param {object} rules
 * @param {(dir: string) => string[]} filesUnder
 */
export function scopeRiskOf(paths, rules, filesUnder = () => []) {
    const candidates = new Set();
    for (const entry of paths) {
        candidates.add(entry);
        if (!entry.endsWith('/')) continue;
        for (const file of filesUnder(entry)) candidates.add(file);
        for (const rule of [...(rules.r3 ?? []), ...(rules.r4 ?? [])]) {
            if (rule.prefix?.startsWith(entry)) candidates.add(rule.prefix);
        }
    }
    return sensitiveRiskOf([...candidates], rules);
}

/**
 * 条目的风险级：基础级别（适配层按条目给的）和路径命中的敏感级别取高的。
 * @param {string} base
 * @param {string[]} paths
 * @param {object} rules
 */
export function riskOf(base, paths, rules) {
    if (!RISKS.includes(base)) throw new Error(`适配层给的基础风险级 ${base} 不是 R0–R4`);
    const sensitive = sensitiveRiskOf(paths, rules);
    return { risk: sensitive.risk ? maxRisk(base, sensitive.risk) : base, reasons: sensitive.reasons };
}
