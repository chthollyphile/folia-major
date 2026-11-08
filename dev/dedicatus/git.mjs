import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// dev/dedicatus/git.mjs
// Dedicatus 用到的几个 git 读操作：取某个版本的文件、算比较基点、取 diff。只读，不改仓库。

const git = (root, args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
});

/** `ref:path` 的内容；那个版本里没有这个文件返回 null。ref 本身必须存在（由 resolveBase 保证）。 */
export function showAt(root, ref, file) {
    try {
        return git(root, ['show', `${ref}:${file}`]);
    } catch {
        return null;
    }
}

/**
 * 比较基点。ref 不存在直接抛错（报 D004），免得浅克隆缺了基点时 D001 悄悄跳过。
 * 本机有完整历史时取和 HEAD 的 merge-base，只看这条分支自己的改动；
 * CI 里是浅克隆、算不出 merge-base，就直接用给的 ref（CI 传的是 PR 合并提交的第一个父提交，本来就是基点）。
 */
export function resolveBase(root, ref) {
    try {
        git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch {
        throw new Error(`找不到比较基点 ${ref}（浅克隆的话要多取一层历史，本机先 git fetch）`);
    }
    try {
        return git(root, ['merge-base', ref, 'HEAD']).trim();
    } catch {
        return ref;
    }
}

/** 这个 ref 在本机存不存在（不抛错）。 */
export function hasRef(root, ref) {
    try {
        git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

/**
 * 把某个版本的几个目录解到临时目录里（git archive + tar），给“目标分支上本来就有哪些问题”用。
 * 只取代码目录，约 50MB；用完调用返回的 cleanup。
 * @returns {{ dir: string, cleanup: () => void }}
 */
export function extractTree(root, ref, pathspecs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedicatus-base-'));
    const archive = path.join(dir, '..', `${path.basename(dir)}.tar`);
    const cleanup = () => {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(archive, { force: true });
    };
    try {
        const present = pathspecs.filter(spec => {
            try {
                git(root, ['cat-file', '-e', `${ref}:${spec}`]);
                return true;
            } catch {
                return false;
            }
        });
        git(root, ['archive', '--format=tar', '-o', archive, ref, '--', ...present]);
        // 用相对路径：Windows 上的 GNU tar 会把 `C:\...` 当成远程主机名。
        execFileSync('tar', ['-xf', `../${path.basename(archive)}`], { cwd: dir, stdio: 'ignore' });
        return { dir, cleanup };
    } catch (error) {
        cleanup();
        throw new Error(`解不开比较基点 ${ref} 的代码：${error?.message ?? error}`, { cause: error });
    }
}

/**
 * 基点到工作区（含未提交的改动）的 diff：零上下文、识别改名、固定 a/ b/ 前缀（不受用户 diff 配置影响）。
 * 不含还没 `git add` 的新文件，它们由 untrackedFiles + diff.mjs 的 addedFileDiff 补上。
 */
export function diffFrom(root, base) {
    return git(root, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', base]);
}

/** 文本文件最大读多少：再大的多半是生成的数据，不当成这次写的代码。 */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

/**
 * 还没 `git add` 的新文件（遵守 .gitignore），连同内容。代理和人常在 add 之前就跑检查，
 * 漏了它们的话新文件里的问题一条都不报（2026-11-08 云端实测）。目录（嵌套的仓库）、二进制和太大的文件跳过。
 * @returns {{ file: string, text: string }[]}
 */
export function untrackedFiles(root) {
    const listed = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    const files = [];
    for (const file of listed) {
        if (file.endsWith('/')) continue;
        const full = path.join(root, file);
        let stat;
        try {
            stat = fs.statSync(full);
        } catch {
            continue;
        }
        if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) continue;
        const bytes = fs.readFileSync(full);
        if (bytes.subarray(0, 8000).includes(0)) continue;
        files.push({ file, text: bytes.toString('utf8') });
    }
    return files;
}
