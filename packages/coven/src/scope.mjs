import { parseScopeName, scopeLabel, scopeNameHelp } from './catalogue.mjs';
import { covenPath, nowIso, parseArgs, readJson, splitList, writeJson } from './common.mjs';
import { riskOf } from './risk.mjs';
// packages/coven/src/scope.mjs
// 范围（HD1）：从适配层的来源取一批条目，逐条算出风险级，存成 .coven/scopes/<名字>.json。
// 范围名用音乐体裁：<体裁> 或 <体裁>-<标题>，体裁按这次清理的性质挑（catalogue.mjs 的 GENRES）。
// 来源和它们的选项由适配层定（Folia：baseline 收 --codes，lint 收 --rules、--paths）。用法见 usage（coven scope --help）。

/**
 * 从适配层的来源生成范围条目，补上风险级和敏感原因。
 * @param {any} adapter
 * @param {{ root: string, sources: string[], options: Record<string, string[]>, riskRules: object }} input
 */
export function scopeItems(adapter, { root, sources, options, riskRules }) {
    const items = [];
    const seen = new Set();
    for (const name of sources) {
        const source = Object.hasOwn(adapter.sources, name) ? adapter.sources[name] : undefined;
        if (!source) throw new Error(`适配层 ${adapter.id} 没有来源 ${name}（有：${Object.keys(adapter.sources).join('、')}）`);
        for (const item of source.list({ root, options })) {
            if (typeof item?.key !== 'string' || !item.key) throw new Error(`来源 ${name} 给出的条目没有 key`);
            if (seen.has(item.key)) continue;
            seen.add(item.key);
            const { risk, reasons } = riskOf(adapter.baseRisk(item), item.riskPaths ?? item.paths ?? [], riskRules);
            items.push({ action: 'refactor', ...item, kind: item.kind ?? name, risk, reasons });
        }
    }
    return items;
}

function printScope(scope) {
    console.log(`范围 ${scopeLabel(scope.name)}（${scope.name}，${scope.items.length} 条，${scope.createdAt}）`);
    scope.items.forEach((item, index) => {
        console.log(`${String(index + 1).padStart(3)}  ${item.risk}  ${item.code ?? item.kind}  ${item.key}${item.note ? `（${item.note}）` : ''}`);
        for (const reason of item.reasons) console.log(`            ${reason}`);
    });
}

const sourceHelp = adapter => Object.entries(adapter.sources)
    .map(([name, source]) => `  ${name.padEnd(10)} ${source.describe}${source.options?.length ? `；选项：${source.options.map(option => `--${option}`).join(' ')}` : ''}`)
    .join('\n');

export const usage = ({ adapter }) => [
    'coven scope --name <范围名> --from <来源>[,<来源>] [来源的选项]   从来源生成范围，存成 .coven/scopes/<范围名>.json（HD1）',
    'coven scope --show <范围名>                                     再看一次已有的范围',
    '',
    `来源（适配层 ${adapter.id}）：`,
    sourceHelp(adapter),
    scopeNameHelp(),
].join('\n');

export async function run(host, argv) {
    const { root, config, adapter } = host;
    const sourceOptions = [...new Set(Object.values(adapter.sources).flatMap(source => source.options ?? []))];
    const { options } = parseArgs(argv, [], ['name', 'from', 'show', ...sourceOptions]);
    if (options.show) {
        printScope(readJson(covenPath(root, 'scopes', `${options.show}.json`)));
        return;
    }
    if (!parseScopeName(options.name)) throw new Error(`--name 不合格。${scopeNameHelp()}`);
    const sources = splitList(options.from);
    if (sources.length === 0) throw new Error(`要写 --from <来源>，可用的来源：\n${sourceHelp(adapter)}`);
    const sourceValues = Object.fromEntries(sourceOptions.map(option => [option, splitList(options[option])]));
    const items = scopeItems(adapter, { root, sources, options: sourceValues, riskRules: config.risk });
    if (items.length === 0) throw new Error('没有符合条件的条目');
    const scope = { name: options.name, createdAt: nowIso(), source: { from: sources, ...sourceValues }, items };
    writeJson(covenPath(root, 'scopes', `${scope.name}.json`), scope);
    printScope(scope);
    console.log(`\n已写入 .coven/scopes/${scope.name}.json。把上面的清单给维护者确认（HD1），确认后 coven state hd HD1 --note "范围 ${scope.name}"。`);
}
