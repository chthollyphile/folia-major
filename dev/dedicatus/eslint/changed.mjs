import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// dev/dedicatus/eslint/changed.mjs
// 本机的 lint 命令（lint:fix-style、lint:prune）只处理“这次改过的文件”：相对目标分支的分叉点，含没提交的改动和新文件。
// 目标分支先找指向主仓库（chthollyphile/folia-major）的远程的 main（fork 里 origin 往往是自己的 fork），
// 再找 upstream/main、origin/main、main；命令行的 --base <ref> 可换。

const UPSTREAM_REPO = /[/:]chthollyphile\/folia-major(\.git)?\/?$/i;
const FALLBACK_BASES = ['upstream/main', 'origin/main', 'main'];

const git = (root, args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const refExists = (root, ref) => {
    try {
        git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
};

/** 目标分支：指向主仓库的远程的 main 优先。 */
const findBase = root => {
    const upstreamRemotes = git(root, ['remote', '-v']).split('\n')
        .map(line => line.split(/\s+/))
        .filter(([, url]) => url && UPSTREAM_REPO.test(url))
        .map(([name]) => `${name}/main`);
    return [...new Set([...upstreamRemotes, ...FALLBACK_BASES])].find(ref => refExists(root, ref)) ?? null;
};

/** `--base <ref>` 或 `--base=<ref>`；没给是 undefined，给了但没值是空字符串。 */
const baseArgument = args => {
    const joined = args.find(arg => arg.startsWith('--base='));
    if (joined !== undefined) return joined.slice('--base='.length);
    const index = args.indexOf('--base');
    return index >= 0 ? (args[index + 1] ?? '') : undefined;
};

/**
 * 目标分支和分叉点。出错时 error 是给人看的一句话（调用方打印后以退出码 2 结束）。
 * @returns {{ base: string, forkPoint: string } | { error: string }}
 */
export function resolveForkPoint(root, args) {
    const given = baseArgument(args);
    if (given === '' || given?.startsWith('-')) return { error: '[Dedicatus] --base 后面要跟一个分支或提交，例如 --base upstream/main。' };
    const base = given ?? findBase(root);
    if (!base || !refExists(root, base)) {
        return {
            error: base
                ? `[Dedicatus] 找不到 ${base}：先 git fetch。`
                : '[Dedicatus] 找不到主仓库的 main：先 git remote add upstream https://github.com/chthollyphile/folia-major.git && git fetch upstream，或者用 --base <ref> 指定。',
        };
    }
    try {
        return { base, forkPoint: git(root, ['merge-base', base, 'HEAD']).trim() };
    } catch {
        return { error: `[Dedicatus] 算不出这个分支和 ${base} 的分叉点（浅克隆的话先 git fetch --unshallow），或者用 --base <ref> 指定。` };
    }
}

/**
 * 这次改过、现在还在的文件：分叉点之后提交的、没提交的，加上还没 add 的新文件；改了名的记下改名前的路径。
 * @returns {{ file: string, from?: string }[]}
 */
export function changedFiles(root, forkPoint) {
    const changed = git(root, ['diff', '--name-status', '-M', '--diff-filter=ACMR', forkPoint]).split('\n')
        .map(line => line.split('\t'))
        .filter(parts => parts.length >= 2)
        .map(([status, first, second]) => (status.startsWith('R') ? { file: second, from: first } : { file: first }));
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').map(line => line.trim()).filter(Boolean).map(file => ({ file }));
    return [...changed, ...untracked].filter(({ file }) => fs.existsSync(path.join(root, file)));
}
