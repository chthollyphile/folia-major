import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineGrowthWithTransfers, parseBaseline, suppressionGrowth } from '../dedicatus/baseline.mjs';
import { ROOT, covenPath, git, loadConfig, loadState, requireCurrentFormat, nowIso, parseArgs, readJson, runCli, withoutTokens, writeJson } from './common.mjs';
import { ALWAYS_IN_SCOPE, DETERMINISTIC_KINDS, approvedFile, checkScope, compareWithApproved, contractFile } from './contract.mjs';
import { riskRank, sensitiveRiskOf } from './risk.mjs';
// dev/coven/verify.mjs
// 在工作 session 的 worktree 里跑契约中确定性的验收项，结果写成 JSON 交给 evaluator（evaluator 再判读代码、预览、桌面版那几项）。
// 另外每次都查：契约有没有批准、批准后有没有被改（D801、D804），diff 有没有出范围（D803），基线和抑制有没有增长（D001）；
// 改到的路径不能超出契约的风险级（D807）；重构的 baseline 验收项再查条目是不是真的消掉了（D806）。前面几道关口没过就不跑工作区里的代码。
//
//   npm run coven:verify -- --task <任务> --worktree <工作 session 的 worktree> [--base <集成分支>]
//
// 结果：.coven/verify/<任务>-<提交前 7 位>.json，并复制一份为 <任务>-latest.json。worktree 里有没提交的改动时直接判不过。

const TIMEOUT_MS = 15 * 60_000;

/** 解析 `git diff --name-status -M`：改名记新旧两个路径。 */
export function parseNameStatus(text) {
    return text.split('\n').filter(Boolean).map(line => {
        const [status, first, second] = line.split('\t');
        return status.startsWith('R') || status.startsWith('C') ? { status: status[0], oldPath: first, path: second } : { status, path: first };
    });
}

/**
 * 重构有没有让基线变小（D806），以及契约里的条目是不是真的消掉了。
 * 基线条目：HEAD 的基线里没有它，Dedicatus 也查不出它（防止只删基线不修代码，D190 这种 warning 级的尤其要看）。
 * lint 条目（`lint:<规则>@<前缀>`）：前缀下这条规则的抑制计数要降到 0。
 * @param {{ items: string[], baseEntries: string[], headEntries: string[], baseSuppressions: object, headSuppressions: object, findingKeys: Set<string> }} input
 * @returns {{ ok: boolean, shrank: boolean, items: Record<string, { ok: boolean, detail: string }> }}
 */
export function baselineShrink({ items, baseEntries, headEntries, baseSuppressions, headSuppressions, findingKeys }) {
    const head = new Set(headEntries);
    const result = {};
    for (const item of items) {
        const lint = /^lint:(.+)@(.+)$/.exec(item);
        if (lint) {
            const [, rule, prefix] = lint;
            const count = suppressions => Object.entries(suppressions).filter(([file]) => file.startsWith(prefix)).reduce((sum, [, rules]) => sum + (rules[rule]?.count ?? 0), 0);
            const before = count(baseSuppressions);
            const after = count(headSuppressions);
            result[item] = { ok: after === 0 && before > 0, detail: `${rule} 在 ${prefix} 下的抑制 ${before} → ${after}` };
            continue;
        }
        const stillListed = head.has(item);
        const stillFound = findingKeys.has(item);
        result[item] = {
            ok: !stillListed && !stillFound,
            detail: stillFound ? 'Dedicatus 还能查出这条（只删了基线，没修代码？）' : stillListed ? '还在基线里（修好了的话跑 npm run dedicatus -- --prune）' : '已消掉',
        };
    }
    const baseCount = baseEntries.length + suppressionTotal(baseSuppressions);
    const headCount = headEntries.length + suppressionTotal(headSuppressions);
    const shrank = headCount < baseCount;
    return { ok: shrank && Object.values(result).every(entry => entry.ok), shrank, items: result };
}

const suppressionTotal = suppressions => Object.values(suppressions).reduce((sum, rules) => sum + Object.values(rules).reduce((inner, entry) => inner + (entry.count ?? 0), 0), 0);

/**
 * 基线和抑制只许变小（D001）：不看契约写没写 dedicatus 项，每次都查。
 * 修掉两条、顺手登记一条新违规，或者把抑制从一个文件挪到另一个文件，总数照样变小，只比总数是挡不住的。
 * 挪文件时条目跟着改名走不算增长；拆文件时搬进新文件的基线条目按 Dedicatus 的规则抵扣。
 * 抑制这边比 CI 严：CI 跑了 ESLint，能把搬进新文件的抑制按挪过来的行抵扣；这里不跑 ESLint，拆文件带走抑制的重构会被拦下，交给维护者。
 * @param {{ baseEntries: string[], headEntries: string[], baseSuppressions: object, headSuppressions: object, renameMap: Map<string, string>, newFiles: Set<string> }} input
 * @returns {string[]} 增长的条目，空数组表示没有
 */
export function growthProblems({ baseEntries, headEntries, baseSuppressions, headSuppressions, renameMap, newFiles }) {
    const { growth } = baselineGrowthWithTransfers(headEntries, baseEntries, renameMap, newFiles);
    return [
        ...growth.map(key => `基线多了 ${key}`),
        ...suppressionGrowth(headSuppressions, baseSuppressions, renameMap).map(entry => `${entry.file} 的 ${entry.rule} 抑制 ${entry.before} → ${entry.after}`),
    ];
}

function runCommand(cwd, command, args, env = {}) {
    const started = Date.now();
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS, env: { ...withoutTokens(), ...env } });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    return { ok: result.status === 0, status: result.status, seconds: Math.round((Date.now() - started) / 1000), output, timedOut: result.error?.code === 'ETIMEDOUT' };
}

const tail = (text, lines = 40) => text.split('\n').slice(-lines).join('\n');

/** Node 25 的 jsdom 没有 localStorage，本机跑单测要加这个参数。 */
function vitestEnv() {
    const major = Number(process.versions.node.split('.')[0]);
    const current = process.env.NODE_OPTIONS ?? '';
    return major >= 25 && !current.includes('--no-experimental-webstorage') ? { NODE_OPTIONS: `${current} --no-experimental-webstorage`.trim() } : {};
}

function runDedicatus(worktree, base, target) {
    const args = ['dev/dedicatus/cli.mjs', '--json', '--base', base, ...(target === 'all' ? ['--all'] : [])];
    if (target === 'all' && !fs.existsSync(path.join(worktree, 'dev/dedicatus/lint/node_modules'))) {
        return { ok: false, summary: 'worktree 里没装 ESLint 隔离环境：先在那里跑 npm run lint:install', findings: null };
    }
    const run = runCommand(worktree, process.execPath, args);
    let parsed;
    try {
        parsed = JSON.parse(run.output.slice(run.output.indexOf('{')));
    } catch {
        return { ok: false, summary: `Dedicatus 没有输出 JSON（退出码 ${run.status}）：${tail(run.output, 10)}`, findings: null };
    }
    const errors = parsed.fresh.filter(finding => finding.level === 'error');
    return {
        ok: errors.length === 0,
        summary: errors.length === 0 ? `没有新的 error（warning ${parsed.fresh.length} 条）` : `${errors.length} 条新的 error：${errors.slice(0, 10).map(finding => `${finding.code} ${finding.file}${finding.line ? `:${finding.line}` : ''}`).join('；')}`,
        findings: parsed,
    };
}

const readAt = (worktree, ref, file) => {
    const result = spawnSync('git', ['show', `${ref}:${file}`], { cwd: worktree, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return result.status === 0 ? result.stdout : null;
};

function main() {
    const { options } = parseArgs(process.argv.slice(2), [], ['task', 'worktree', 'base']);
    const state = requireCurrentFormat(loadState(ROOT));
    const task = options.task;
    if (!task || !state.tasks[task]) throw new Error('--task 要是状态文件里登记过的任务');
    if (!options.worktree) throw new Error('--worktree 要给工作 session 的 worktree 路径');
    const worktree = path.resolve(options.worktree);
    const base = options.base ?? state.integrationBranch;
    const contract = readJson(contractFile(ROOT, task));
    const approvedPath = approvedFile(ROOT, task);
    const head = git(worktree, ['rev-parse', 'HEAD']).trim();
    const checks = [];
    const add = (id, kind, ok, summary, extra = {}) => checks.push({ id, kind, ok, summary, ...extra });

    const dirty = git(worktree, ['status', '--porcelain']).trim();
    add('clean', 'worktree', !dirty, dirty ? `有没提交的改动：${dirty.split('\n').slice(0, 5).join('；')}` : '没有未提交的改动');

    if (!fs.existsSync(approvedPath)) add('D801', 'contract', false, '契约还没批准（HD2，R0/R1 用 approve --auto）');
    else {
        const problems = compareWithApproved(readJson(approvedPath).contract, contract);
        add('D804', 'contract', problems.length === 0, problems[0]?.message ?? '和批准的版本一致');
    }

    const mergeBase = git(worktree, ['merge-base', base, 'HEAD']).trim();
    // core.quotePath=false：中文路径不加引号转义，否则会被误报出范围
    const changed = parseNameStatus(git(worktree, ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', mergeBase, 'HEAD']));
    const outside = checkScope(changed, contract.scope.paths);
    add('D803', 'scope', outside.length === 0, outside.length === 0 ? `改了 ${changed.length} 个文件，都在范围内` : outside.map(problem => problem.message).join('；'));

    // 实际改到的路径也算一次风险：scope 是新目录时，契约批准时看不到将来新建的文件（比如新平台的 *Provider.ts）
    // 基线和抑制文件在 dev/dedicatus/ 下（R4），但它们由 D001 单独把关，不算进来
    const touchedPaths = [...new Set(changed.flatMap(entry => [entry.oldPath, entry.path]).filter(file => file && !ALWAYS_IN_SCOPE.includes(file)))];
    const touched = sensitiveRiskOf(touchedPaths, loadConfig(ROOT).risk);
    const tooRisky = touched.risk && riskRank(touched.risk) > riskRank(contract.risk);
    add('D807', 'risk', !tooRisky, tooRisky ? `改到的路径是 ${touched.risk}，契约是 ${contract.risk}：${touched.reasons.slice(0, 3).join('；')}` : '改到的路径没超出契约的风险级');

    const readJsonAt = (ref, file, fallback) => {
        const text = readAt(worktree, ref, file);
        return text === null ? fallback : text;
    };
    const ledgers = {
        baseEntries: parseBaseline(readJsonAt(mergeBase, 'dev/dedicatus/baseline.json', '{"entries":[]}')),
        headEntries: parseBaseline(readJsonAt('HEAD', 'dev/dedicatus/baseline.json', '{"entries":[]}')),
        baseSuppressions: JSON.parse(readJsonAt(mergeBase, 'eslint-suppressions.json', '{}')),
        headSuppressions: JSON.parse(readJsonAt('HEAD', 'eslint-suppressions.json', '{}')),
    };
    const renameMap = new Map(changed.filter(entry => entry.oldPath).map(entry => [entry.oldPath, entry.path]));
    const growth = growthProblems({ ...ledgers, renameMap, newFiles: new Set(changed.filter(entry => entry.status === 'A').map(entry => entry.path)) });
    add('D001', 'growth', growth.length === 0, growth.length === 0 ? '基线和抑制没有增长' : `基线或抑制增长了：${growth.slice(0, 10).join('；')}`);

    // 前面的关口没过（有没提交的改动、契约没批准或被改、出了范围）就不跑工作区里的代码：结果对不上提交，也不该执行越界的改动
    const gate = checks.filter(check => ['clean', 'D801', 'D804', 'D803', 'D807'].includes(check.id) && !check.ok).map(check => check.id);

    const criteria = {};
    let dedicatus = null;
    const dedicatusOnce = target => {
        if (!dedicatus || (target === 'all' && dedicatus.target !== 'all')) dedicatus = { target, ...runDedicatus(worktree, mergeBase, target) };
        return dedicatus;
    };
    // baseline 依赖 Dedicatus 的结果，放到最后
    const ordered = [...contract.criteria].sort((a, b) => (a.verify.kind === 'baseline') - (b.verify.kind === 'baseline'));
    for (const criterion of ordered) {
        const { kind, target } = criterion.verify;
        if (gate.length > 0 && DETERMINISTIC_KINDS.includes(kind)) {
            criteria[criterion.id] = false;
            add(criterion.id, kind, false, `没跑：先过 ${gate.join('、')}`);
            continue;
        }
        if (kind === 'typecheck') {
            const run = runCommand(worktree, process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
            criteria[criterion.id] = run.ok;
            add(criterion.id, kind, run.ok, run.ok ? `通过（${run.seconds} 秒）` : `失败：${tail(run.output, 20)}`);
        } else if (kind === 'unit') {
            const run = runCommand(worktree, process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.config.ts', ...[].concat(target)], vitestEnv());
            criteria[criterion.id] = run.ok;
            add(criterion.id, kind, run.ok, run.ok ? `通过（${run.seconds} 秒）` : `失败：${tail(run.output, 30)}`);
        } else if (kind === 'dedicatus') {
            const result = dedicatusOnce(target ?? 'graph');
            criteria[criterion.id] = result.ok;
            add(criterion.id, kind, result.ok, result.summary);
        } else if (kind === 'baseline') {
            const result = dedicatusOnce(dedicatus?.target ?? 'graph');
            const findingKeys = new Set([...(result.findings?.fresh ?? []), ...(result.findings?.known ?? [])].map(finding => finding.key));
            const shrink = baselineShrink({ items: contract.items, ...ledgers, findingKeys });
            const ok = shrink.ok && result.findings !== null;
            criteria[criterion.id] = ok;
            const details = Object.entries(shrink.items).map(([item, entry]) => `${entry.ok ? '✓' : '✗'} ${item}：${entry.detail}`);
            add(criterion.id, kind, ok, `${shrink.shrank ? '基线变小了' : 'D806 基线没有变小'}；${details.join('；')}`, { code: shrink.shrank ? undefined : 'D806' });
        }
    }

    const result = {
        task, head, base, mergeBase, at: nowIso(),
        ok: checks.every(check => check.ok),
        criteria,
        changed: changed.map(entry => (entry.oldPath ? `${entry.oldPath} → ${entry.path}` : `${entry.status} ${entry.path}`)),
        checks,
    };
    writeJson(covenPath(ROOT, 'verify', `${task}-${head.slice(0, 7)}.json`), result);
    writeJson(covenPath(ROOT, 'verify', `${task}-latest.json`), result);
    for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.id}（${check.kind}）${check.summary.split('\n')[0]}`);
    console.log(`\n${result.ok ? '确定性检查全部通过' : '有检查没过'}；结果在 .coven/verify/${task}-${head.slice(0, 7)}.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
