#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFiles, resolveForkPoint } from './changed.mjs';
import { ensureRuntime } from './fixStyle.mjs';
import { LINT_TARGETS, isLintTarget, spawnEslint } from './run.mjs';
// dev/dedicatus/eslint/prune.mjs
// npm run lint:prune：修好旧违规以后，把 eslint-suppressions.json 里记多了的条目删掉（只删不加），D002 让跑的就是它。
// 默认只看这次改过的文件（相对目标分支的分叉点，见 changed.mjs）：全仓跑一遍要 7 GB 内存，有的机器会 OOM。
// 已经不存在的文件的条目 ESLint 总会一并删掉。改了全仓都受影响的规则配置以后用 --all 全仓清一次。
//   npm run lint:prune                    只清这次改过的文件
//   npm run lint:prune -- --all           全仓（要 7 GB 左右的内存）
//   npm run lint:prune -- --base <ref>    换目标分支

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function main(args) {
    let targets = LINT_TARGETS;
    if (!args.includes('--all')) {
        const point = resolveForkPoint(root, args);
        if ('error' in point) {
            console.error(point.error);
            console.error('[Dedicatus] 也可以用 npm run lint:prune -- --all 全仓清（要 7 GB 左右的内存）。');
            return 2;
        }
        targets = [...new Set(changedFiles(root, point.forkPoint).map(({ file }) => file).filter(isLintTarget))].sort();
        console.log(`[Dedicatus] 相对 ${point.base}（分叉点 ${point.forkPoint.slice(0, 9)}）改过 ${targets.length} 个代码文件，只清它们的抑制条目。`);
    }
    if (!ensureRuntime()) {
        console.error('[Dedicatus] ESLint 的隔离环境没装上，先手动跑 npm run lint:install。');
        return 2;
    }
    const file = path.join(root, 'eslint-suppressions.json');
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    // 没有改过的代码文件也跑一次（只给 package.json）：已经删掉的文件的条目照样要清
    const result = spawnEslint(root, ['--prune-suppressions', ...(targets === LINT_TARGETS ? [] : ['--no-warn-ignored']), ...(targets.length > 0 ? targets : ['package.json'])], { capture: true });
    if (result.status === 2) {
        console.error(result.stderr || result.stdout || '[Dedicatus] ESLint 没跑起来。');
        return 2;
    }
    const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    console.log(after === before ? '[Dedicatus] 没有记多的条目。' : '[Dedicatus] 已删掉记多的抑制条目（eslint-suppressions.json），和代码一起提交。');
    return 0;
}

process.exitCode = main(process.argv.slice(2));
