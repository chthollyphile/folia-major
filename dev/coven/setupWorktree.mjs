import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// dev/coven/setupWorktree.mjs
// Folia 的工作 worktree 怎么准备（Coven 适配层的 worktree.setup，generator 开工时跑 npm run coven:setup）。
// 先 npm ci --ignore-scripts；失败、而且失败的是下面登记过的“可能被挡的包”时，在 worktree 旁边的临时目录里
// 用去掉这些包的 package.json 和 lock 再装一次，把 node_modules 挪进 worktree。worktree 里跟踪的文件一个都不动，
// 少装了什么由 inspect 告诉 verify，写进结果。2026-11-09 云端干跑（WoO 1）时 KuGouMusicApi 的 tarball 返回 403，
// generator 自己想了这个办法；用户定把它写成固定的准备步骤，generator 不再各自想办法。

/** 可能在某些环境装不上、少了它也能做大部分验证的包。 */
export const BLOCKABLE_PACKAGES = [
    { name: 'kugoumusicapi', why: '酷狗的 API 包，从 GitHub 下载 tarball，部分云端环境会被挡（403）', affects: '涉及酷狗的单测和真跑' },
];

/**
 * 跑 npm。Windows 上 npm 是 .cmd，要经过 shell；参数都是这里写死的常量，拼成一条命令字符串交给 shell
 * （数组加 shell: true 会触发 Node 的 DEP0190 警告：参数不转义、直接拼接）。
 * @param {string} cwd
 * @param {string[]} args 只能是写死的常量
 */
const NPM_TIMEOUT_MS = 20 * 60_000;
const npm = (cwd, args) => (process.platform === 'win32'
    ? spawnSync(`npm ${args.join(' ')}`, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: NPM_TIMEOUT_MS, shell: true })
    : spawnSync('npm', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: NPM_TIMEOUT_MS }));

const outputOf = result => `${result.stdout ?? ''}${result.stderr ?? ''}`;

/** 下载失败的迹象。只有和登记过的包名或下载地址同时出现才算“被挡”：lock 对不上、文件被占用（EPERM）这类失败不能悄悄跳过包。 */
const DOWNLOAD_FAILURE = /\b(?:403|e403|e404|etarget|econnreset|etimedout|enotfound|eai_again|econnrefused)\b|forbidden|tarball|fetch failed|unable to (?:access|get)/i;

/** 失败输出里，哪些登记过的包下载失败了（包名或它在 lock 里的下载地址，加上下载失败的迹象）。 */
export function blockedPackagesIn(output, lock) {
    const text = output.toLowerCase();
    if (!DOWNLOAD_FAILURE.test(output)) return [];
    return BLOCKABLE_PACKAGES.filter(entry => {
        const resolved = lock?.packages?.[`node_modules/${entry.name}`]?.resolved;
        return text.includes(entry.name) || (resolved && text.includes(resolved.toLowerCase()));
    });
}

/**
 * 去掉一些包以后的 package.json 和 lock（纯函数，不改传进来的对象）。
 * lock 里删掉这个包和它自己 node_modules 下的全部条目，以及根条目里对它的依赖。
 */
export function withoutPackages(pkg, lock, names) {
    const nextPkg = structuredClone(pkg);
    const nextLock = structuredClone(lock);
    for (const name of names) {
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
            if (nextPkg[field]) delete nextPkg[field][name];
            if (nextLock.packages?.['']?.[field]) delete nextLock.packages[''][field][name];
        }
        for (const key of Object.keys(nextLock.packages ?? {})) {
            if (key === `node_modules/${name}` || key.startsWith(`node_modules/${name}/`)) delete nextLock.packages[key];
        }
    }
    return { pkg: nextPkg, lock: nextLock };
}

/**
 * 准备 worktree：装依赖（必要时跳过被挡的包），要跑 ESLint 时再装隔离环境。
 * @param {string} worktree
 * @param {{ lint?: boolean }} [options]
 */
export function setupWorktree(worktree, { lint = false } = {}) {
    console.log('npm ci --ignore-scripts …');
    const first = npm(worktree, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    if (first.status !== 0) {
        const lock = JSON.parse(fs.readFileSync(path.join(worktree, 'package-lock.json'), 'utf8'));
        const blocked = blockedPackagesIn(outputOf(first), lock);
        if (blocked.length === 0) throw new Error(`npm ci 失败，而且不是登记过的被挡的包：\n${outputOf(first).split('\n').slice(-30).join('\n')}`);
        console.log(`装不上 ${blocked.map(entry => entry.name).join('、')}（${blocked.map(entry => entry.why).join('；')}），去掉它们再装一次。`);
        const pkg = JSON.parse(fs.readFileSync(path.join(worktree, 'package.json'), 'utf8'));
        const stripped = withoutPackages(pkg, lock, blocked.map(entry => entry.name));
        // 放在 worktree 旁边（同一个盘，挪 node_modules 只是改名；也不会让 worktree 多出未跟踪的文件）
        const temp = fs.mkdtempSync(path.join(path.dirname(worktree), `.coven-setup-${path.basename(worktree)}-`));
        try {
            fs.writeFileSync(path.join(temp, 'package.json'), `${JSON.stringify(stripped.pkg, null, 2)}\n`);
            fs.writeFileSync(path.join(temp, 'package-lock.json'), `${JSON.stringify(stripped.lock, null, 2)}\n`);
            // 项目的 npm 设置（registry、allow-remote 之类）要跟过去，两次安装的行为才一致
            if (fs.existsSync(path.join(worktree, '.npmrc'))) fs.copyFileSync(path.join(worktree, '.npmrc'), path.join(temp, '.npmrc'));
            const second = npm(temp, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
            if (second.status !== 0) throw new Error(`去掉 ${blocked.map(entry => entry.name).join('、')} 以后 npm ci 还是失败：\n${outputOf(second).split('\n').slice(-30).join('\n')}`);
            // 旧的 node_modules 先挪进临时目录留着，新的挪进去成功了再删（worktree 和临时目录不在一个文件系统上时 rename 会失败）；
            // 备份在临时目录里，finally 一起清掉，worktree 里不会留下未跟踪的目录
            const target = path.join(worktree, 'node_modules');
            const backup = path.join(temp, 'node_modules.old');
            if (fs.existsSync(target)) fs.renameSync(target, backup);
            try {
                fs.renameSync(path.join(temp, 'node_modules'), target);
            } catch (error) {
                if (fs.existsSync(backup)) fs.renameSync(backup, target);
                throw new Error(`没能把装好的 node_modules 挪进 worktree：${error.message}`, { cause: error });
            }
            fs.rmSync(backup, { recursive: true, force: true });
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    }
    if (lint) {
        console.log('npm run lint:install …');
        const result = npm(worktree, ['run', 'lint:install']);
        if (result.status !== 0) throw new Error(`lint:install 失败：\n${outputOf(result).split('\n').slice(-30).join('\n')}`);
    }
    console.log('worktree 准备好了。');
}

/** 少装了哪些登记过的包（verify 写进结果，evaluator 据此判断某些失败是不是环境造成的）。 */
export function missingPackageNotes(worktree) {
    const pkgFile = path.join(worktree, 'package.json');
    if (!fs.existsSync(pkgFile) || !fs.existsSync(path.join(worktree, 'node_modules'))) return [];
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    return BLOCKABLE_PACKAGES
        .filter(entry => declared[entry.name] && !fs.existsSync(path.join(worktree, 'node_modules', entry.name)))
        .map(entry => `没装 ${entry.name}（${entry.why}）：${entry.affects}可能因此失败，这类失败不算这次改动的`);
}
