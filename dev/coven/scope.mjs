import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBaseline } from '../dedicatus/baseline.mjs';
import { ESLINT_RULE_CODES, codeInfo } from '../dedicatus/codes.mjs';
import { parseScopeName, scopeLabel, scopeNameHelp } from './catalogue.mjs';
import { ROOT, covenPath, loadConfig, nowIso, parseArgs, readJson, runCli, splitList, writeJson } from './common.mjs';
import { riskOf } from './risk.mjs';
// dev/coven/scope.mjs
// 范围（HD1）：从 Dedicatus 的基线或 ESLint 抑制生成一批条目，逐条算出风险级，存成 .coven/scopes/<名字>.json。
// 范围名用音乐体裁：<体裁> 或 <体裁>-<标题>，体裁按这次清理的性质挑（catalogue.mjs 的 GENRES）。
//
//   npm run coven:scope -- --name fugue-boundaries --from-baseline [--codes D1,D190,D301]
//   npm run coven:scope -- --name etude-stores --from-suppressions --rules @stylistic/indent,@stylistic/quotes --paths src/stores/
//   npm run coven:scope -- --show fugue-boundaries
//
// 基线条目一条一项；抑制按“规则 × 路径前缀”合成一项（一个目录几十个文件，逐个认领会刷屏）。

/** 基线 key 里涉及的路径：`D102:a->b` 是 a、b，`D301:a` 是 a。 */
export function pathsOfKey(key) {
    const colon = key.indexOf(':');
    return key.slice(colon + 1).split('->');
}

/**
 * 从基线条目生成范围条目。
 * @param {string[]} entries 基线 key
 * @param {{ codes?: string[], rules: object }} options codes 按前缀匹配（D1 匹配 D101–D190）
 */
export function scopeFromBaseline(entries, { codes = [], rules }) {
    return entries
        .filter(key => {
            const code = key.split(':')[0];
            return codeInfo(code) && (codes.length === 0 || codes.some(prefix => code.startsWith(prefix)));
        })
        .map(key => {
            const code = key.split(':')[0];
            const paths = pathsOfKey(key);
            const { risk, reasons } = riskOf(code, paths, rules);
            return { key, kind: 'baseline', code, action: 'refactor', paths, risk, reasons };
        });
}

/** 抑制条目的 key：`lint:<规则>@<路径前缀>`。 */
export const lintKey = (rule, prefix) => `lint:${rule}@${prefix}`;

/**
 * 从 eslint-suppressions.json 生成范围条目，每个“规则 × 路径前缀”一项。
 * @param {Record<string, Record<string, { count: number }>>} suppressions
 * @param {{ rules: string[], prefixes: string[], riskRules: object }} options
 */
export function scopeFromSuppressions(suppressions, { rules, prefixes, riskRules }) {
    const items = [];
    for (const rule of rules) {
        for (const prefix of prefixes) {
            const files = Object.keys(suppressions).filter(file => file.startsWith(prefix) && suppressions[file][rule]).sort();
            if (files.length === 0) continue;
            const count = files.reduce((sum, file) => sum + suppressions[file][rule].count, 0);
            const code = ESLINT_RULE_CODES[rule] ?? 'D490';
            const { risk, reasons } = riskOf(code, files, riskRules);
            items.push({ key: lintKey(rule, prefix), kind: 'lint', code, rule, action: 'refactor', paths: [prefix], files, count, risk, reasons });
        }
    }
    return items;
}

function printScope(scope) {
    console.log(`范围 ${scopeLabel(scope.name)}（${scope.name}，${scope.items.length} 条，${scope.createdAt}）`);
    scope.items.forEach((item, index) => {
        const extra = item.kind === 'lint' ? `（${item.files.length} 个文件，${item.count} 处）` : '';
        console.log(`${String(index + 1).padStart(3)}  ${item.risk}  ${item.code}  ${item.key}${extra}`);
        for (const reason of item.reasons) console.log(`            ${reason}`);
    });
}

function main() {
    const { options } = parseArgs(process.argv.slice(2), ['from-baseline', 'from-suppressions'], ['name', 'codes', 'rules', 'paths', 'show']);
    if (options.show) {
        printScope(readJson(covenPath(ROOT, 'scopes', `${options.show}.json`)));
        return;
    }
    if (!parseScopeName(options.name)) throw new Error(`--name 不合格。${scopeNameHelp()}`);
    if (!options['from-baseline'] && !options['from-suppressions']) throw new Error('至少要有 --from-baseline 或 --from-suppressions');
    const config = loadConfig(ROOT);
    const items = [];
    if (options['from-baseline']) {
        items.push(...scopeFromBaseline(loadBaseline(ROOT), { codes: splitList(options.codes), rules: config.risk }));
    }
    if (options['from-suppressions']) {
        const rules = splitList(options.rules);
        const prefixes = splitList(options.paths);
        if (rules.length === 0 || prefixes.length === 0) throw new Error('--from-suppressions 要配 --rules 和 --paths');
        const suppressions = readJson(path.join(ROOT, 'eslint-suppressions.json'));
        items.push(...scopeFromSuppressions(suppressions, { rules, prefixes, riskRules: config.risk }));
    }
    if (items.length === 0) throw new Error('没有符合条件的条目');
    const scope = {
        name: options.name,
        createdAt: nowIso(),
        source: { baseline: Boolean(options['from-baseline']), codes: splitList(options.codes), rules: splitList(options.rules), paths: splitList(options.paths) },
        items,
    };
    writeJson(covenPath(ROOT, 'scopes', `${scope.name}.json`), scope);
    printScope(scope);
    console.log(`\n已写入 .coven/scopes/${scope.name}.json。把上面的清单给维护者确认（HD1），确认后 npm run coven:state -- hd HD1 --note "范围 ${scope.name}"。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
