import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { covenPath, git, loadState, nowIso, parseArgs, readJson, requireCurrentFormat, withoutTokens, writeJson } from './common.mjs';
import { checkOf } from './adapter.mjs';
import { approvedFile, checkScope, compareWithApproved, contractFile } from './contract.mjs';
import { riskRank, sensitiveRiskOf } from './risk.mjs';
// packages/coven/src/verify.mjs
// 在工作 session 的 worktree 里跑契约中确定性的验收项，结果写成 JSON 交给 evaluator（evaluator 再判读代码、预览那几项）。
// 关口的顺序由 harness 定，每次都查：
//   clean  worktree 里没有未提交的改动
//   D801/D804  契约批准过、批准后没被改
//   D803  diff 没出 scope.paths（适配层账本里的文件总在范围里）
//   D807  实际改到的路径没超出契约的风险级
//   D841  适配层账本（Folia：Dedicatus 基线和 ESLint 抑制）没有任何一条增长
// 前面几道关口（clean、D801、D804、D803、D807）没过就不跑工作区里的代码。确定性验收项怎么跑由适配层的 checks 定。
// 结果：.coven/verify/<任务>-<提交前 7 位>.json，并复制一份为 <任务>-latest.json。

export const usage = () => [
    'coven verify --task <任务> --worktree <工作 worktree 的路径> [--base <分支>]',
    '  在工作 worktree 里跑关口（clean、D801/D804、D803、D807、D841）和契约里确定性的验收项，',
    '  结果写进 .coven/verify/<任务>-<提交>.json 和 <任务>-latest.json，给 evaluator 和 coven pr 用。',
    '  --base 默认是本次运行的集成分支；开 PR 只认和集成分支比的结果，平时不要写。',
].join('\n');

const TIMEOUT_MS = 15 * 60_000;
const GATES = ['clean', 'D801', 'D804', 'D803', 'D807'];

/** 解析 `git diff --name-status -M`：改名记新旧两个路径。 */
export function parseNameStatus(text) {
    return text.split('\n').filter(Boolean).map(line => {
        const [status, first, second] = line.split('\t');
        return status.startsWith('R') || status.startsWith('C') ? { status: status[0], oldPath: first, path: second } : { status, path: first };
    });
}

/** 在 worktree 里跑一条命令；环境变量里不带 GitHub 令牌。 */
export function runCommand(cwd, command, args, env = {}) {
    const started = Date.now();
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS, env: { ...withoutTokens(), ...env } });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return { ok: result.status === 0, status: result.status, seconds: Math.round((Date.now() - started) / 1000), output, timedOut: result.error?.code === 'ETIMEDOUT' };
}

/** 某个提交里某个文件的内容；没有这个文件返回 null。 */
export function readAt(cwd, ref, file) {
    const result = spawnSync('git', ['show', `${ref}:${file}`], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return result.status === 0 ? result.stdout : null;
}

/**
 * 跑完全部关口和确定性验收项（不写文件）。
 * @param {{ root: string, config: any, adapter: any }} host
 * @param {{ taskId: string, worktree: string, base: string, contract: any, approved: any|null }} input
 */
export function verifyTask(host, { taskId, worktree, base, contract, approved }) {
    const { root, config, adapter } = host;
    const head = git(worktree, ['rev-parse', 'HEAD']).trim();
    const checks = [];
    const add = (id, kind, ok, summary, extra = {}) => checks.push({ id, kind, ok, summary, ...extra });

    const dirty = git(worktree, ['status', '--porcelain']).trim();
    add('clean', 'worktree', !dirty, dirty ? `有没提交的改动：${dirty.split('\n').slice(0, 5).join('；')}` : '没有未提交的改动');

    if (!approved) add('D801', 'contract', false, '契约还没批准（HD2，R0/R1 用 approve --auto）');
    else {
        const problems = compareWithApproved(approved.contract, contract);
        add('D804', 'contract', problems.length === 0, problems[0]?.message ?? '和批准的版本一致');
    }

    const mergeBase = git(worktree, ['merge-base', base, 'HEAD']).trim();
    // core.quotePath=false：中文路径不加引号转义，否则会被误报出范围
    const changed = parseNameStatus(git(worktree, ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', mergeBase, 'HEAD']));
    const ledgerFiles = adapter.ledger.files;
    const outside = checkScope(changed, contract.scope.paths, ledgerFiles);
    add('D803', 'scope', outside.length === 0, outside.length === 0 ? `改了 ${changed.length} 个文件，都在范围内` : outside.map(problem => problem.message).join('；'));

    // 实际改到的路径也算一次风险：scope 是新目录时，契约批准时看不到将来新建的文件（比如新平台的 *Provider.ts）。
    // 账本文件由 D841 单独把关，不算进来（Folia 的基线文件在 dev/dedicatus/ 下，按路径会算成 R4）。
    const touchedPaths = [...new Set(changed.flatMap(entry => [entry.oldPath, entry.path]).filter(file => file && !ledgerFiles.includes(file)))];
    const touched = sensitiveRiskOf(touchedPaths, config.risk);
    const tooRisky = touched.risk && riskRank(touched.risk) > riskRank(contract.risk);
    add('D807', 'risk', !tooRisky, tooRisky ? `改到的路径是 ${touched.risk}，契约是 ${contract.risk}：${touched.reasons.slice(0, 3).join('；')}` : '改到的路径没超出契约的风险级');

    const renameMap = new Map(changed.filter(entry => entry.oldPath).map(entry => [entry.oldPath, entry.path]));
    const growth = adapter.ledger.growth({
        readBase: file => readAt(worktree, mergeBase, file),
        readHead: file => readAt(worktree, 'HEAD', file),
        renameMap,
        newFiles: new Set(changed.filter(entry => entry.status === 'A').map(entry => entry.path)),
    });
    add('D841', 'ledger', growth.length === 0, growth.length === 0 ? '账本没有增长' : `账本增长了：${growth.slice(0, 10).join('；')}`);

    // 准备 worktree 时的情况（Folia：云端装不上的包），只记下来，不判过不过
    for (const note of adapter.worktree.inspect?.(worktree) ?? []) add('setup', 'worktree', true, note);

    const gate = checks.filter(check => GATES.includes(check.id) && !check.ok).map(check => check.id);
    const criteria = {};
    const memoStore = new Map();
    const memo = (key, compute) => {
        if (!memoStore.has(key)) memoStore.set(key, compute());
        return memoStore.get(key);
    };
    const ordered = [...contract.criteria]
        .filter(criterion => checkOf(adapter.checks, criterion.verify.kind)?.deterministic)
        .sort((a, b) => (checkOf(adapter.checks, a.verify.kind).order ?? 0) - (checkOf(adapter.checks, b.verify.kind).order ?? 0));
    for (const criterion of ordered) {
        const { kind } = criterion.verify;
        if (gate.length > 0) {
            criteria[criterion.id] = false;
            add(criterion.id, kind, false, `没跑：先过 ${gate.join('、')}`);
            continue;
        }
        const result = checkOf(adapter.checks, kind).run({
            root, worktree, base, mergeBase, head, contract, criterion, changed, memo,
            run: (command, args, env) => runCommand(worktree, command, args, env),
            readAt: (ref, file) => readAt(worktree, ref, file),
        });
        // 适配层的检查返回格式不对就按没过算，不要让后面的打印和 PR 正文出错
        const wellFormed = typeof result?.ok === 'boolean' && typeof result.summary === 'string';
        const ok = wellFormed && result.ok;
        criteria[criterion.id] = ok;
        add(criterion.id, kind, ok, wellFormed ? result.summary : `适配层的 ${kind} 检查返回的格式不对（要 { ok: boolean, summary: string }）`, wellFormed && result.code ? { code: result.code } : {});
    }

    return {
        task: taskId, head, base, mergeBase, at: nowIso(),
        ok: checks.every(check => check.ok),
        criteria,
        changed: changed.map(entry => (entry.oldPath ? `${entry.oldPath} → ${entry.path}` : `${entry.status} ${entry.path}`)),
        checks,
    };
}

export async function run(host, argv) {
    const { root } = host;
    const { options } = parseArgs(argv, [], ['task', 'worktree', 'base']);
    const state = requireCurrentFormat(loadState(root));
    const taskId = options.task;
    if (!taskId || !state.tasks[taskId]) throw new Error('--task 要是状态文件里登记过的任务');
    if (!options.worktree) throw new Error('--worktree 要给工作 session 的 worktree 路径');
    const approvedPath = approvedFile(root, taskId);
    const result = verifyTask(host, {
        taskId,
        worktree: path.resolve(options.worktree),
        base: options.base ?? state.integrationBranch,
        contract: readJson(contractFile(root, taskId)),
        approved: fs.existsSync(approvedPath) ? readJson(approvedPath) : null,
    });
    writeJson(covenPath(root, 'verify', `${taskId}-${result.head.slice(0, 7)}.json`), result);
    writeJson(covenPath(root, 'verify', `${taskId}-latest.json`), result);
    for (const check of result.checks) console.log(`${check.ok ? '✓' : '✗'} ${check.id}（${check.kind}）${check.summary.split('\n')[0]}`);
    console.log(`\n${result.ok ? '确定性检查全部通过' : '有检查没过'}；结果在 .coven/verify/${taskId}-${result.head.slice(0, 7)}.json`);
}
