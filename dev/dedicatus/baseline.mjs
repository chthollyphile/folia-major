import fs from 'node:fs';
import path from 'node:path';
import { codeInfo } from './codes.mjs';
// dev/dedicatus/baseline.mjs
// 基线：已知的旧违规，以“代码:位置”为 key。检查结果减去基线就是新违规；基线里有、但已经不再违规的条目必须删掉（D002）。
// 程序只删不加（--prune）；往基线里加条目只能手改文件，CI 拿它和目标分支的基线比，多出来的报 D001。
// ESLint 的抑制文件（eslint-suppressions.json）是另一份基线，同样只减不增，见 compareSuppressions。

export const BASELINE_FILE = 'dev/dedicatus/baseline.json';
export const ESLINT_SUPPRESSIONS_FILE = 'eslint-suppressions.json';

const NOTE = '已知的旧违规，只减不增：修好一条就跑 `npm run dedicatus -- --prune` 删掉；不要手动往里加（CI 会报 D001）。';

/**
 * 解析基线文件的内容；格式不对抛错（由调用方报 D004）。
 * @param {string} text
 * @returns {string[]}
 */
export function parseBaseline(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries) || data.entries.some(entry => typeof entry !== 'string')) {
        throw new Error(`${BASELINE_FILE} 格式不对：需要 { "entries": string[] }`);
    }
    return data.entries;
}

export function loadBaseline(root) {
    const file = path.join(root, BASELINE_FILE);
    if (!fs.existsSync(file)) return [];
    return parseBaseline(fs.readFileSync(file, 'utf8'));
}

export function serializeBaseline(entries) {
    const sorted = [...new Set(entries)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `${JSON.stringify({ note: NOTE, entries: sorted }, null, 4)}\n`;
}

export function saveBaseline(root, entries) {
    fs.writeFileSync(path.join(root, BASELINE_FILE), serializeBaseline(entries));
}

/**
 * Dedicatus 的一条检查结果。key 用来和基线对账：边是 `代码:from->to`，文件是 `代码:文件`。
 * @typedef {{ code: string, file: string, message: string, key: string, to?: string, line?: number, column?: number, rule?: string }} Finding
 */

/**
 * 检查结果和基线对账。
 * @param {Finding[]} findings
 * @param {string[]} entries
 * @returns {{ fresh: Finding[], known: Finding[], stale: string[], unknown: string[] }}
 *   fresh：基线里没有的（新违规）；known：基线里有的；stale：基线里有但已经不再违规的 key；unknown：基线里代码不存在或已废弃的 key。
 */
export function compareWithBaseline(findings, entries) {
    const baseline = new Set(entries);
    const present = new Set(findings.map(finding => finding.key));
    return {
        fresh: findings.filter(finding => !baseline.has(finding.key)),
        known: findings.filter(finding => baseline.has(finding.key)),
        stale: entries.filter(key => !present.has(key) && codeInfo(key.split(':')[0])),
        unknown: entries.filter(key => !codeInfo(key.split(':')[0])),
    };
}

/**
 * 按改名把基线 key 里的路径换成新路径。key 是 `代码:路径` 或 `代码:from->to`。
 * @param {string} key
 * @param {Map<string, string>} renameMap 旧路径 → 新路径
 */
export function renameKey(key, renameMap) {
    const colon = key.indexOf(':');
    if (colon < 0 || renameMap.size === 0) return key;
    const rest = key.slice(colon + 1).split('->').map(part => renameMap.get(part) ?? part).join('->');
    return `${key.slice(0, colon)}:${rest}`;
}

/** 挪了文件以后的基线：只换路径，不增不减。 */
export const migrateBaseline = (entries, renameMap) => entries.map(key => renameKey(key, renameMap));

/** 挪了文件以后的 ESLint 抑制：条目跟着文件走（新旧两边都有时计数相加）。 */
export function migrateSuppressions(suppressions, renameMap) {
    const out = {};
    for (const [file, rules] of Object.entries(suppressions ?? {})) {
        const target = renameMap.get(file) ?? file;
        out[target] ??= {};
        for (const [rule, entry] of Object.entries(rules ?? {})) {
            const count = Number(entry?.count ?? 0) + Number(out[target][rule]?.count ?? 0);
            out[target][rule] = { count };
        }
    }
    return Object.fromEntries(Object.keys(out).sort().map(file => [file, Object.fromEntries(Object.keys(out[file]).sort().map(rule => [rule, out[file][rule]]))]));
}

/**
 * 目标分支上没有、现在多出来的基线条目（D001）。目标分支还没有基线文件时（第一次引入）不报。
 * 目标分支的条目先按这次的改名换成新路径：挪文件时把条目跟着挪过去不算增长。
 */
export function baselineGrowth(currentEntries, baseEntries, renameMap = new Map()) {
    if (baseEntries === null) return [];
    const before = new Set(migrateBaseline(baseEntries, renameMap));
    return currentEntries.filter(key => !before.has(key));
}

/**
 * ESLint 抑制文件的增长（D001）：任何“文件 × 规则”的计数比目标分支大（目标分支的条目先按改名换到新路径）。
 * 抑制文件的格式是 `{ "<文件>": { "<规则>": { "count": n } } }`。目标分支还没有这个文件时不报。
 * @returns {{ file: string, rule: string, before: number, after: number }[]}
 */
export function suppressionGrowth(current, base, renameMap = new Map()) {
    if (base === null) return [];
    const migrated = migrateSuppressions(base, renameMap);
    const growth = [];
    for (const [file, rules] of Object.entries(current ?? {})) {
        for (const [rule, entry] of Object.entries(rules ?? {})) {
            const after = Number(entry?.count ?? 0);
            const before = Number(migrated[file]?.[rule]?.count ?? 0);
            if (after > before) growth.push({ file, rule, before, after });
        }
    }
    return growth.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.rule < b.rule ? -1 : 1));
}

/** 基线 key 落在哪个文件上（`代码:from->to` 取 from）。 */
const keyFile = key => key.slice(key.indexOf(':') + 1).split('->')[0];

/**
 * 拆文件时旧账跟着代码搬家：新建文件里登记的基线条目，只要同一个代码在别处减少了同样多，就不算增长。
 * @param {string[]} currentEntries
 * @param {string[] | null} baseEntries
 * @param {Map<string, string>} renameMap
 * @param {Set<string>} newFiles 这次新建的文件
 * @returns {{ growth: string[], transferred: string[] }}
 */
export function baselineGrowthWithTransfers(currentEntries, baseEntries, renameMap, newFiles) {
    const growth = baselineGrowth(currentEntries, baseEntries, renameMap);
    if (baseEntries === null || growth.length === 0) return { growth, transferred: [] };
    const current = new Set(currentEntries);
    const removedByCode = new Map();
    for (const key of migrateBaseline(baseEntries, renameMap)) {
        if (current.has(key)) continue;
        const code = key.split(':')[0];
        removedByCode.set(code, (removedByCode.get(code) ?? 0) + 1);
    }
    const remaining = [];
    const transferred = [];
    for (const key of growth) {
        const code = key.split(':')[0];
        const budget = removedByCode.get(code) ?? 0;
        if (newFiles.has(keyFile(key)) && budget > 0) {
            removedByCode.set(code, budget - 1);
            transferred.push(key);
        } else {
            remaining.push(key);
        }
    }
    return { growth: remaining, transferred };
}

/**
 * ESLint 抑制的同一种搬家：新建文件里登记的计数，不超过“这个文件里落在挪过来的行上的该规则违规数”，
 * 并且同一条规则在别处减少的总数够抵，就不算增长。
 * @param {object} current 当前的抑制文件
 * @param {object | null} base 目标分支的抑制文件
 * @param {Map<string, string>} renameMap
 * @param {Set<string>} newFiles 这次新建的文件
 * @param {Map<string, number>} movedCounts `文件\u0000规则` → 落在挪过来的行上的违规数
 * @returns {{ growth: { file: string, rule: string, before: number, after: number }[], transferred: { file: string, rule: string, count: number }[] }}
 */
export function suppressionGrowthWithTransfers(current, base, renameMap, newFiles, movedCounts) {
    const growth = suppressionGrowth(current, base, renameMap);
    if (base === null || growth.length === 0) return { growth, transferred: [] };
    const migrated = migrateSuppressions(base, renameMap);
    const decreaseByRule = new Map();
    for (const [file, rules] of Object.entries(migrated)) {
        for (const [rule, entry] of Object.entries(rules)) {
            const drop = Number(entry.count ?? 0) - Number(current?.[file]?.[rule]?.count ?? 0);
            if (drop > 0) decreaseByRule.set(rule, (decreaseByRule.get(rule) ?? 0) + drop);
        }
    }
    const remaining = [];
    const transferred = [];
    for (const entry of growth) {
        const extra = entry.after - entry.before;
        const movable = newFiles.has(entry.file) ? Math.min(extra, movedCounts.get(`${entry.file}\u0000${entry.rule}`) ?? 0, decreaseByRule.get(entry.rule) ?? 0) : 0;
        if (movable > 0) {
            decreaseByRule.set(entry.rule, (decreaseByRule.get(entry.rule) ?? 0) - movable);
            transferred.push({ file: entry.file, rule: entry.rule, count: movable });
        }
        if (extra > movable) remaining.push({ ...entry, before: entry.before + movable });
    }
    return { growth: remaining, transferred };
}
