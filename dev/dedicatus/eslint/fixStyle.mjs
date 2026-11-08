#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSuppressions, spawnEslint } from './run.mjs';
// dev/dedicatus/eslint/fixStyle.mjs
// npm run lint:fix-style：把这次改过的文件的排版（缩进、引号、换行……）自动修好，开 PR 前跑一次。
// - 改过的文件：相对目标分支（依次找 upstream/main、origin/main、main，--base 可换）的分叉点，含没提交的改动和新文件；
// - 跳过本来就是旧风格的文件（抑制文件里记着风格规则的）：修它们会把整个文件重排，PR 的 diff 会很难看；
//   这些文件的风格问题本来就不追究；
// - 只做排版类修复（--fix-type layout）：只动空白和标点，不改代码的意思。剩下的问题要自己改，跑 npm run lint 看；
// - ESLint 的隔离环境（dev/dedicatus/lint）没装时先装。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const BASE_CANDIDATES = ['upstream/main', 'origin/main', 'main'];

/**
 * 要修的文件：改过的代码文件里，去掉本来就是旧风格的（抑制文件里这个文件记着风格规则）。
 * @param {string[]} changed 改过的文件（仓库相对路径，正斜杠）
 * @param {Record<string, Record<string, { count: number }>>} suppressions eslint-suppressions.json
 * @returns {{ targets: string[], legacy: string[] }}
 */
export function pickStyleFixTargets(changed, suppressions) {
    const code = [...new Set(changed)].filter(file => SOURCE.test(file)).sort();
    const isLegacy = file => Object.keys(suppressions[file] ?? {}).some(rule => rule.startsWith('@stylistic/'));
    return { targets: code.filter(file => !isLegacy(file)), legacy: code.filter(isLegacy) };
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

/** 这次改过、现在还在的文件：分叉点之后提交的、没提交的，加上还没 add 的新文件。 */
const changedFiles = base => {
    const forkPoint = git(['merge-base', base, 'HEAD']).trim();
    const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
    return [
        ...lines(git(['diff', '--name-only', '--diff-filter=ACMR', forkPoint])),
        ...lines(git(['ls-files', '--others', '--exclude-standard'])),
    ].filter(file => fs.existsSync(path.join(root, file)));
};

const ensureRuntime = () => {
    if (fs.existsSync(path.join(root, 'dev/dedicatus/lint/node_modules/eslint'))) return true;
    console.log('[Dedicatus] 先装 ESLint 的隔离环境（npm run lint:install，第一次要一会儿）…');
    const result = spawnSync('npm', ['run', 'lint:install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    return result.status === 0;
};

function main(args) {
    const baseIndex = args.indexOf('--base');
    const base = baseIndex >= 0 ? args[baseIndex + 1] : BASE_CANDIDATES.find(refExists);
    if (!base || !refExists(base)) {
        console.error(`[Dedicatus] 找不到目标分支（试过 ${BASE_CANDIDATES.join('、')}）：先 git fetch，或者用 --base <ref> 指定。`);
        return 2;
    }
    const { targets, legacy } = pickStyleFixTargets(changedFiles(base), readSuppressions(root));
    if (legacy.length > 0) console.log(`[Dedicatus] 跳过 ${legacy.length} 个旧风格的文件（它们的风格不追究，整文件重排会让 diff 很难看）：${legacy.join('、')}`);
    if (targets.length === 0) {
        console.log(`[Dedicatus] 相对 ${base} 没有要修排版的代码文件。`);
        return 0;
    }
    if (!ensureRuntime()) {
        console.error('[Dedicatus] ESLint 的隔离环境没装上，先手动跑 npm run lint:install。');
        return 2;
    }
    const before = new Map(targets.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
    // 结果用 JSON 收起来不打印：剩下的不是排版问题，混在这里看不清；--no-warn-ignored：配置里忽略的文件不提示
    const result = spawnEslint(root, [
        '--fix', '--fix-type', 'layout', '--no-warn-ignored', '--pass-on-unpruned-suppressions', '-f', 'json', ...targets,
    ], { capture: true });
    if (result.status === 2 || !result.stdout) {
        console.error(result.stderr || '[Dedicatus] ESLint 没跑起来。');
        return 2;
    }
    const fixed = targets.filter(file => fs.readFileSync(path.join(root, file), 'utf8') !== before.get(file));
    const remaining = JSON.parse(result.stdout).reduce((sum, entry) => sum + entry.errorCount + entry.warningCount, 0);
    console.log(fixed.length > 0
        ? `[Dedicatus] 修好了 ${fixed.length} 个文件的排版（只动了空白和标点）：${fixed.join('、')}`
        : '[Dedicatus] 排版本来就没问题，什么都没改。');
    if (remaining > 0) console.log(`[Dedicatus] 这些文件还有 ${remaining} 个问题不是排版、不能自动修，跑 npm run lint 看。`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
