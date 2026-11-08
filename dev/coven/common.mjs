import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// dev/coven/common.mjs
// Coven 脚本共用的东西：仓库根目录、.coven/ 下的文件、配置、git 和 gh 的调用。
// .coven/ 是监控 session 所在检出的本地目录（git 忽略）。工作 session 在自己的 worktree 里，那里没有 .coven/state.json，
// 所以写 GitHub 的脚本（claim、pr）在那里一律拒绝执行（requireSupervisor）。

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const COVEN_DIR = '.coven';
export const STATE_FILE = `${COVEN_DIR}/state.json`;

export const covenPath = (root, ...parts) => path.join(root, COVEN_DIR, ...parts);

export function readJson(file, fallback) {
    if (!fs.existsSync(file)) {
        if (fallback !== undefined) return fallback;
        throw new Error(`找不到 ${file}`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 先写临时文件再改名，监控 session 中途被关掉也不会留下半个 JSON。 */
export function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 4)}\n`);
    fs.renameSync(temp, file);
}

export function writeText(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

export const loadConfig = (root = ROOT) => readJson(path.join(root, 'dev/coven/config.json'));

/** 只有监控 session 的检出里才有 .coven/state.json；写 GitHub 的脚本先过这一关。 */
export function requireSupervisor(root = ROOT) {
    const file = path.join(root, STATE_FILE);
    if (!fs.existsSync(file)) {
        throw new Error(`${STATE_FILE} 不存在：只有监控 session 能执行这个命令（先 npm run coven:state -- init）。工作 session 不做任何 GitHub 写操作。`);
    }
    return requireCurrentFormat(readJson(file));
}

export const loadState = (root = ROOT) => readJson(path.join(root, STATE_FILE));

/** 账本的格式版本：2 起运行和任务用乐谱编目的代号（catalogue.mjs）。 */
export const STATE_VERSION = 2;

/** 旧格式的运行（日期加范围名的运行、coven/run-* 集成分支、自由格式的任务名）不能接着跑：直接说清楚怎么办，不要走到 PR 才报错。 */
export function requireCurrentFormat(state) {
    if (state?.version !== STATE_VERSION) {
        throw new Error(`.coven/state.json 是旧格式的运行 ${state?.run}（代号改成乐谱编目之前开的），不能接着跑：先 npm run coven:state -- finish --force 收尾，再重新 init`);
    }
    return state;
}

export const saveState = (root, state) => writeJson(path.join(root, STATE_FILE), state);

/**
 * 这次是不是干跑：状态文件里记的 dryRun，或者 HD0 还没拍板（配置里 hd0Confirmed 为 false）。
 * 两者任一为真都只打印、不写 GitHub。
 */
export const isDryRun = (state, config) => Boolean(state?.dryRun) || !config.hd0Confirmed;

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
    if (result.error) throw new Error(`${command} 没跑起来：${result.error.message}`);
    if (result.status !== 0 && !options.allowFailure) {
        throw new Error(`${command} ${args.slice(0, 3).join(' ')} 失败（退出码 ${result.status}）：${(result.stderr || result.stdout).trim().slice(0, 2000)}`);
    }
    return result;
}

export const git = (cwd, args, options) => run('git', args, { cwd, ...options }).stdout;

/** 允许失败的 git：返回 { ok, output }，由调用方决定失败了怎么办（比如作品号被别人先占了就换下一个）。 */
export function tryGit(cwd, args) {
    const result = run('git', args, { cwd, allowFailure: true });
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

export const gh = (args, options) => run('gh', args, options).stdout;

/** gh api 的分页结果，配 --jq 输出一行一个 JSON。 */
export function ghApiLines(endpoint, jq) {
    const out = gh(['api', '--paginate', endpoint, '--jq', jq]);
    return out.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

/**
 * 命令行参数：`--key value`、`--flag`，其余按位置。不认识的选项直接报错：
 * 打错一个字（`--tasks`）不能被当成“没指定”，否则 `set --state done` 会改到整个范围。
 * @param {string[]} argv
 * @param {string[]} flags 不带值的开关
 * @param {string[]} values 带值的选项
 */
export function parseArgs(argv, flags = [], values = []) {
    const positional = [];
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const name = arg.slice(2);
        if (flags.includes(name)) options[name] = true;
        else if (!values.includes(name)) throw new Error(`不认识的选项 ${arg}（可用：${[...flags, ...values].map(entry => `--${entry}`).join(' ') || '无'}）`);
        else {
            const value = argv[++i];
            if (value === undefined) throw new Error(`${arg} 后面要跟一个值`);
            options[name] = value;
        }
    }
    return { positional, options };
}

export const splitList = value => (value ? String(value).split(',').map(part => part.trim()).filter(Boolean) : []);

/** 命令行入口的统一收尾：出错打印一行中文原因，退出码 2。 */
export function runCli(main) {
    Promise.resolve().then(main).catch(error => {
        console.error(`[Coven] ${error?.message ?? error}`);
        process.exitCode = 2;
    });
}

export const nowIso = () => new Date().toISOString();

/**
 * 跑工作区代码（单测、类型检查）时去掉环境变量里的 GitHub 令牌。这只是少给一样东西，不是隔离：
 * gh 的登录在系统钥匙串里，git 走 ssh，工作区代码照样能用。真正的防线是 D803（不跑越界的改动）和不跑外部代码（D820）。
 */
export function withoutTokens(env = process.env) {
    const copy = { ...env };
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete copy[name];
    return copy;
}

/** 仓库里某个目录下已跟踪的文件（算风险下限时，目录型的 scope 要看里面有什么）。 */
export const trackedFilesUnder = (root, dir) => git(root, ['ls-files', '-z', '--', dir]).split('\0').filter(Boolean);

/** 维护者所在时区的日期 YYYY-MM-DD（记在运行的账本里，北京时间晚上不会差一天）。 */
export const localDate = (iso, timeZone = 'UTC') => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
