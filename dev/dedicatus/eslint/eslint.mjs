#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINT_TARGETS, spawnEslint } from './run.mjs';
// dev/dedicatus/eslint/eslint.mjs
// 直接调用隔离环境里的 ESLint，参数原样转交；没给路径时检查 LINT_TARGETS。
//   npm run lint:fix -- src/foo.ts   自动修复（必须给路径：全仓一修就是十几万处缩进和引号）
//   npm run lint:prune               删掉抑制文件里已经修好的条目（--prune-suppressions，只删不加）
//   node dev/dedicatus/eslint/eslint.mjs src/foo.ts   只看一个文件，原样的 ESLint 输出

/** 后面跟一个值的 ESLint 选项：这个值不是要检查的路径。 */
const OPTIONS_WITH_VALUE = new Set([
    '-c', '--config', '-f', '--format', '-o', '--output-file', '--rule', '--fix-type', '--max-warnings',
    '--cache-location', '--cache-strategy', '--suppressions-location', '--ignore-pattern', '--parser', '--parser-options',
    '--plugin', '--global', '--env', '--resolve-plugins-relative-to', '--rulesdir', '--ext', '--report-unused-disable-directives-severity',
    '--report-unused-inline-configs', '--stats', '--concurrency', '--flag', '--suppress-rule',
]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);

let hasPath = false;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (OPTIONS_WITH_VALUE.has(arg)) i += 1;
    else if (!arg.startsWith('-')) hasPath = true;
}

if (!hasPath && args.includes('--fix')) {
    console.error('[Dedicatus] --fix 要给路径（例如 npm run lint:fix -- src/foo.ts）：不给路径会把全仓十几万处旧风格一起改掉。');
    process.exitCode = 2;
} else {
    const result = spawnEslint(root, hasPath ? args : [...args, ...LINT_TARGETS]);
    process.exitCode = result.status ?? 1;
}
