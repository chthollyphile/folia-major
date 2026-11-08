#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLINT_RULE_CODES } from '../codes.mjs';
import { readSuppressions, spawnEslint } from './run.mjs';
// dev/dedicatus/eslint/fixStyle.mjs
// npm run lint:fix-style：把这次改过的文件的排版（缩进、引号、换行……）自动修好，开 PR 前跑一次。
// - 改过的文件：相对目标分支的分叉点，含没提交的改动和新文件。目标分支先找指向主仓库（chthollyphile/folia-major）
//   的远程的 main，再找 upstream/main、origin/main、main；--base <ref> 可换；
// - 文件本来就是旧风格的（抑制文件里记着某条风格规则）：只修没记旧账的那几条，记了的不动，和 CI 只追究没记旧账的规则一致；
//   不然整个文件会被重排，PR 的 diff 会很难看。改了名的文件按改名前的路径找旧账；
// - 只做排版类修复（--fix-type layout）：只动空白和标点，不改代码的意思。剩下的问题要自己改，跑 npm run lint 看；
// - ESLint 的隔离环境（dev/dedicatus/lint）没装时先装。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const UPSTREAM_REPO = /[/:]chthollyphile\/folia-major(\.git)?\/?$/i;
const FALLBACK_BASES = ['upstream/main', 'origin/main', 'main'];
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
        if (!SOURCE.test(file) || seen.has(file)) continue;
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

const git = args => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const refExists = ref => {
    try {
        git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
};

/** 目标分支：指向主仓库的远程的 main 优先（fork 里 origin 往往是自己的 fork）。 */
const findBase = () => {
    const upstreamRemotes = git(['remote', '-v']).split('\n')
        .map(line => line.split(/\s+/))
        .filter(([, url]) => url && UPSTREAM_REPO.test(url))
        .map(([name]) => `${name}/main`);
    return [...new Set([...upstreamRemotes, ...FALLBACK_BASES])].find(refExists) ?? null;
};

/** 这次改过、现在还在的文件：分叉点之后提交的、没提交的，加上还没 add 的新文件；改了名的记下改名前的路径。 */
const changedFiles = forkPoint => {
    const changed = git(['diff', '--name-status', '-M', '--diff-filter=ACMR', forkPoint]).split('\n')
        .map(line => line.split('\t'))
        .filter(parts => parts.length >= 2)
        .map(([status, first, second]) => (status.startsWith('R') ? { file: second, from: first } : { file: first }));
    const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').map(line => line.trim()).filter(Boolean).map(file => ({ file }));
    return [...changed, ...untracked].filter(({ file }) => fs.existsSync(path.join(root, file)));
};

const ensureRuntime = () => {
    if (fs.existsSync(path.join(root, 'dev/dedicatus/lint/node_modules/eslint'))) return true;
    console.log('[Dedicatus] 先装 ESLint 的隔离环境（npm run lint:install，第一次要一会儿）…');
    const result = spawnSync('npm', ['run', 'lint:install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    return result.status === 0;
};

/** `--base <ref>` 或 `--base=<ref>`；没给是 undefined，给了但没值是空字符串。 */
const baseArgument = args => {
    const joined = args.find(arg => arg.startsWith('--base='));
    if (joined !== undefined) return joined.slice('--base='.length);
    const index = args.indexOf('--base');
    return index >= 0 ? (args[index + 1] ?? '') : undefined;
};

function main(args) {
    const given = baseArgument(args);
    if (given === '' || given?.startsWith('-')) {
        console.error('[Dedicatus] --base 后面要跟一个分支或提交，例如 --base upstream/main。');
        return 2;
    }
    const base = given ?? findBase();
    if (!base || !refExists(base)) {
        console.error(base
            ? `[Dedicatus] 找不到 ${base}：先 git fetch。`
            : '[Dedicatus] 找不到主仓库的 main：先 git remote add upstream https://github.com/chthollyphile/folia-major.git && git fetch upstream，或者用 --base <ref> 指定。');
        return 2;
    }
    let forkPoint;
    try {
        forkPoint = git(['merge-base', base, 'HEAD']).trim();
    } catch {
        console.error(`[Dedicatus] 算不出这个分支和 ${base} 的分叉点（浅克隆的话先 git fetch --unshallow），或者用 --base <ref> 指定。`);
        return 2;
    }
    const changed = changedFiles(forkPoint);
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
