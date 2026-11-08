#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLINT_RULE_CODES } from '../codes.mjs';
import { changedFiles, resolveForkPoint } from './changed.mjs';
import { isLintTarget, readSuppressions, spawnEslint } from './run.mjs';
// dev/dedicatus/eslint/fixStyle.mjs
// npm run lint:fix-style：把这次改过的文件的排版（缩进、引号、换行……）自动修好，开 PR 前跑一次。
// - 改过的文件：相对目标分支的分叉点，含没提交的改动和新文件（目标分支怎么找见 changed.mjs）；--base <ref> 可换；
// - 文件本来就是旧风格的（抑制文件里记着某条风格规则）：只修没记旧账的那几条，记了的不动，和 CI 只追究没记旧账的规则一致；
//   不然整个文件会被重排，PR 的 diff 会很难看。改了名的文件按改名前的路径找旧账；
// - 只做排版类修复（--fix-type layout）：只动空白和标点，不改代码的意思。剩下的问题要自己改，跑 npm run lint 看；
// - ESLint 的隔离环境（dev/dedicatus/lint）没装时先装。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** 风格类规则（D430–D432）：能自动修的只有它们。 */
const STYLE_RULES = Object.keys(ESLINT_RULE_CODES).filter(rule => /^D43[0-2]$/.test(ESLINT_RULE_CODES[rule]));

/**
 * 要修的文件，按“哪些风格规则记着旧账、这次不修”分组。全部风格规则都记着旧账的文件跳过。
 * @param {{ file: string, from?: string }[]} changed 改过的文件（仓库相对路径，正斜杠）；from 是改名前的路径
 * @param {Record<string, Record<string, { count: number }>>} suppressions eslint-suppressions.json
 * @returns {{ groups: { files: string[], keep: string[] }[], skipped: string[] }} keep：这一组不修的规则
 */
export function pickStyleFixTargets(changed, suppressions) {
    const seen = new Set();
    const byKeep = new Map();
    const skipped = [];
    for (const { file, from } of [...changed].sort((a, b) => a.file.localeCompare(b.file))) {
        if (!isLintTarget(file) || seen.has(file)) continue;
        seen.add(file);
        const recorded = rule => Number(suppressions[file]?.[rule]?.count ?? 0) > 0 || (from !== undefined && Number(suppressions[from]?.[rule]?.count ?? 0) > 0);
        const keep = STYLE_RULES.filter(recorded);
        if (keep.length === STYLE_RULES.length) {
            skipped.push(file);
            continue;
        }
        const key = keep.join(',');
        if (!byKeep.has(key)) byKeep.set(key, { files: [], keep });
        byKeep.get(key).files.push(file);
    }
    return { groups: [...byKeep.values()], skipped };
}

/** ESLint 的隔离环境没装时先装。 */
export const ensureRuntime = () => {
    if (fs.existsSync(path.join(root, 'dev/dedicatus/lint/node_modules/eslint'))) return true;
    console.log('[Dedicatus] 先装 ESLint 的隔离环境（npm run lint:install，第一次要一会儿）…');
    const result = spawnSync('npm', ['run', 'lint:install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    return result.status === 0;
};

function main(args) {
    const point = resolveForkPoint(root, args);
    if ('error' in point) {
        console.error(point.error);
        return 2;
    }
    const { base, forkPoint } = point;
    const changed = changedFiles(root, forkPoint);
    const { groups, skipped } = pickStyleFixTargets(changed, readSuppressions(root));
    const targets = groups.flatMap(group => group.files);
    console.log(`[Dedicatus] 相对 ${base}（分叉点 ${forkPoint.slice(0, 9)}）改过 ${changed.length} 个文件，其中 ${targets.length} 个代码文件要看排版。`);
    if (skipped.length > 0) console.log(`[Dedicatus] 跳过 ${skipped.length} 个旧风格的文件（风格旧账都还记着，不追究；整文件重排会让 diff 很难看）：${skipped.join('、')}`);
    if (targets.length === 0) return 0;
    if (!ensureRuntime()) {
        console.error('[Dedicatus] ESLint 的隔离环境没装上，先手动跑 npm run lint:install。');
        return 2;
    }
    const before = new Map(targets.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
    const fixedSoFar = () => targets.filter(file => fs.readFileSync(path.join(root, file), 'utf8') !== before.get(file));
    let remaining = 0;
    for (const { files, keep } of groups) {
        // 记着旧账的风格规则这一组不修；结果用 JSON 收起来不打印：剩下的不是排版问题，混在这里看不清
        const off = keep.flatMap(rule => ['--rule', JSON.stringify({ [rule]: 'off' })]);
        const result = spawnEslint(root, [
            '--fix', '--fix-type', 'layout', '--no-warn-ignored', '--pass-on-unpruned-suppressions', ...off, '-f', 'json', ...files,
        ], { capture: true });
        if (result.status === 2 || !result.stdout) {
            console.error(result.stderr || '[Dedicatus] ESLint 没跑起来。');
            const fixed = fixedSoFar();
            if (fixed.length > 0) console.error(`[Dedicatus] 出错之前已经修好了这些文件的排版：${fixed.join('、')}`);
            return 2;
        }
        remaining += JSON.parse(result.stdout).reduce((sum, entry) => sum + entry.errorCount + entry.warningCount, 0);
    }
    const fixed = fixedSoFar();
    console.log(fixed.length > 0
        ? `[Dedicatus] 修好了 ${fixed.length} 个文件的排版（只动了空白和标点）：${fixed.join('、')}`
        : '[Dedicatus] 排版本来就没问题，什么都没改。');
    if (remaining > 0) console.log(`[Dedicatus] 这些文件还有 ${remaining} 个问题不是排版、不能自动修，跑 npm run lint 看。`);
    return 0;
}

const isEntry = () => {
    try {
        return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
};

if (isEntry()) process.exitCode = main(process.argv.slice(2));
