// dev/coven/risk.mjs
// 风险分级（plan/coven-plan.md 第 4 节）：由条目的代码和涉及的路径确定性地算，LLM 只能往上调（往下调报 D807）。
//   R0 只动空白和引号的风格修复；R1 可自动修复的 lint；R2 普通的边界、环、其余 lint；
//   R3 碰到 config.json 里 risk.r3 的敏感路径；R4 碰到 risk.r4（项目规则、CI、检查规则、依赖），只写方案不实现。

export const RISKS = ['R0', 'R1', 'R2', 'R3', 'R4'];

const STYLE_CODES = new Set(['D430', 'D431', 'D432']);
const AUTOFIX_CODES = new Set(['D405']);

export const riskRank = risk => RISKS.indexOf(risk);
export const maxRisk = (...risks) => risks.reduce((top, risk) => (riskRank(risk) > riskRank(top) ? risk : top), 'R0');

/** 只看代码的基础级别。 */
export function baseRiskOf(code) {
    if (STYLE_CODES.has(code)) return 'R0';
    if (AUTOFIX_CODES.has(code)) return 'R1';
    return 'R2';
}

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

/** 条目的风险级：代码的基础级别和路径命中的敏感级别取高的。 */
export function riskOf(code, paths, rules) {
    const base = baseRiskOf(code);
    const sensitive = sensitiveRiskOf(paths, rules);
    return { risk: sensitive.risk ? maxRisk(base, sensitive.risk) : base, reasons: sensitive.reasons };
}
