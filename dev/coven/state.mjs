import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH_PREFIX, TAG_PREFIX, catalogueTagOf, integrationBranchOf, nextRunNumber, runIdOf, runLabel, scopeLabel, taskBranchOf, taskLabel, tempoLabel } from './catalogue.mjs';
import { ROOT, STATE_FILE, covenPath, gh, ghApiLines, git, isDryRun, loadConfig, loadState, localDate, nowIso, parseArgs, readJson, requireCurrentFormat, runCli, saveState, tryGit, writeJson, writeText } from './common.mjs';
import { contractFile, isApprovedCurrent } from './contract.mjs';
import { githubIo, keysOfTask, updateClaims } from './claim.mjs';
import { riskRank } from './risk.mjs';
// dev/coven/state.mjs
// 监控 session 的账本 .coven/state.json：范围、认领、任务（planner 分的组）和它们的阶段、人类介入、花费、所有 GitHub 写操作。
// 监控 session 中途被关掉，新开的 session 读它和认领评论对账，接着往下走。
//
//   npm run coven:state -- init --scope <名字> [--live] [--owner <账号>] [--base origin/main]
//                                取下一个作品号（真跑 Op. n，干跑 WoO n），从 base 切出集成分支 coven/op<n>，真跑时推上去占号
//   npm run coven:state -- show
//   npm run coven:state -- phase <任务> <阶段> [--code Dxxx] [--note …] [--session …] [--worktree …] [--branch …]
//   npm run coven:state -- cost <任务> --tokens 34000          记一次用量（预算按 token 算）
//   npm run coven:state -- hd <HD1–HD5> --note "…"         记一次人类介入
//   npm run coven:state -- finish [--force]                  释放没完成的认领，写运行记录 .coven/runs/
//   npm run coven:state -- audit                             对照 GitHub：运行期间这个账号的评论和 PR 是不是都由脚本发的

/**
 * @typedef {{ items: string[], title?: string, risk: string, phase: string, rounds: number, tokens: number,
 *   history: Array<{ at: string, phase: string, code?: string, note?: string }>, code?: string|null, pr?: number|string|null,
 *   session?: string, worktree?: string, branch?: string, reviewHead?: string,
 *   lastVerdict?: { round: number, verdict?: string, passes: boolean, escalation?: object|null } }} CovenTask
 * @typedef {{ version: number, run: string, date: string, scope: string, owner: string, integrationBranch: string,
 *   trackingIssue: number|null, dryRun: boolean, startedAt: string, finishedAt: string|null,
 *   items: Record<string, any>, tasks: Record<string, CovenTask>, order: string[],
 *   escalations: Array<{ items: string[], code: string, question?: string|null, options?: string[] }>,
 *   interventions: Array<{ at?: string, kind: string, note?: string|null }>,
 *   github: Array<Record<string, any>>, dryComments: Array<Record<string, any>> }} CovenState
 */

export const PHASES = ['planning', 'spec-review', 'building', 'evaluating', 'pr', 'done', 'blocked', 'released'];
const TERMINAL = new Set(['done', 'released']);
const BLOCKED_CODES = /^D8\d\d$/;

/**
 * run 是这次运行的作品号（catalogue.mjs：真跑 op<n>，干跑 woo<n>），集成分支是 coven/<run>。
 * @param {{ run: string, scope: string, owner: string, trackingIssue: number|null, dryRun: boolean, now?: string, timeZone?: string }} input
 * @returns {CovenState}
 */
export function createState({ run, scope, owner, trackingIssue, dryRun, now = nowIso(), timeZone = 'UTC' }) {
    const date = localDate(now, timeZone);
    return {
        version: 2,
        run,
        date, scope, owner, integrationBranch: integrationBranchOf(run), trackingIssue, dryRun,
        startedAt: now, finishedAt: null,
        items: {}, tasks: {}, order: [], escalations: [],
        interventions: [], github: [], dryComments: [],
    };
}

/**
 * 任务换阶段。不合规的返回原因（字符串），合规的直接改 task 并返回 null。
 * - 进 building：R4 不行；R2 以上要先过 HD2（契约已批准）；从 evaluating 回来算新一轮，轮数到上限报 D811；用量到上限报 D813。
 *   预算按 token 算（HD0：Max 订阅按次不花钱，真正的上限是订阅的用量窗口）。
 * - 进 evaluating：轮数加一。
 * - blocked 要带 D8xx 代码；从 blocked 回去干活（不是 released）要写明哪位维护者解封的（unblockedBy），
 *   否则监控 session 自己连跑 blocked → building 就绕过了 D811 的轮数上限。done、released 之后不再变。
 * - approved 指当前契约和批准的那一版指纹一致（isApprovedCurrent），不只是批准文件存在。
 * @param {CovenTask} task
 * @param {string} phase
 * @param {{ code?: string|null, note?: string|null, approved?: boolean, maxRounds?: number, unblockedBy?: string|null,
 *   budget?: { perTaskTokens?: number|null, perRunTokens?: number|null }, runTokens?: number, now?: string }} [options]
 * @returns {string|null}
 */
export function transition(task, phase, { code = null, note = null, approved = false, maxRounds = 2, unblockedBy = null, budget = {}, runTokens = 0, now = nowIso() } = {}) {
    if (!PHASES.includes(phase)) return `不认识的阶段 ${phase}（${PHASES.join('、')}）`;
    const from = task.phase;
    if (TERMINAL.has(from)) return `任务已经 ${from}，不能再改`;
    if (from === 'blocked' && !['blocked', 'released'].includes(phase) && !unblockedBy) {
        return `任务因 ${task.code} 停着：维护者决定继续后，用 --unblock-by <维护者账号> 解封`;
    }
    const allowed = {
        planning: ['blocked'],
        'spec-review': ['planning', 'blocked'],
        building: ['planning', 'spec-review', 'evaluating', 'blocked'],
        evaluating: ['building'],
        pr: ['evaluating'],
        done: ['pr'],
        blocked: PHASES.filter(entry => !TERMINAL.has(entry)),
        released: PHASES.filter(entry => !TERMINAL.has(entry)),
    }[phase];
    if (!allowed.includes(from)) return `不能从 ${from} 直接到 ${phase}`;
    if (phase === 'blocked' && !BLOCKED_CODES.test(code ?? '')) return 'blocked 要带原因代码（D805、D810–D813 等）';
    if (phase === 'building') {
        if (task.risk === 'R4') return 'R4 只写方案草稿，不进实现';
        if (!approved) return riskRank(task.risk) <= riskRank('R1') ? '契约还没批准：R0/R1 先跑 coven:contract -- approve <任务> --auto' : `${task.risk} 要先过 HD2（coven:contract -- approve <任务> --by <账号>）`;
        if (from === 'evaluating' && task.rounds >= maxRounds) return `D811：已经评审 ${task.rounds} 轮还没过，改成 blocked 交给维护者`;
        if (budget.perTaskTokens && task.tokens >= budget.perTaskTokens) return `D813：任务用了 ${task.tokens} token，到了上限 ${budget.perTaskTokens}`;
        if (budget.perRunTokens && runTokens >= budget.perRunTokens) return `D813：本次运行用了 ${runTokens} token，到了上限 ${budget.perRunTokens}`;
    }
    if (phase === 'pr' && !task.lastVerdict?.passes) return '最近一轮评审没有通过，不能开 PR';
    if (phase === 'evaluating') task.rounds += 1;
    task.phase = phase;
    task.code = phase === 'blocked' ? code : null;
    task.history.push({ at: now, phase, ...(code ? { code } : {}), ...(note ? { note } : {}), ...(from === 'blocked' && unblockedBy ? { unblockedBy } : {}) });
    return null;
}

/** 阶段对应的认领评论状态；没列的阶段不动评论。pr → working 由 coven:pr 带着 PR 编号改。 */
export function claimChangeFor(phase, { code, from } = {}) {
    if (phase === 'blocked') return { state: 'blocked', code };
    if (phase === 'done') return { state: 'done' };
    if (phase === 'released') return { state: 'released' };
    if (from === 'blocked') return { state: 'claimed' };
    return null;
}

export const runTokens = state => Object.values(state.tasks).reduce((sum, task) => sum + (task.tokens ?? 0), 0);

/** 运行记录：能算出人类介入次数、每个任务的时长与花费、评审轮数、升级原因（plan/coven-v1-plan.md 第 4 节的通过标准）。 */
export function runRecord(state, now = nowIso()) {
    const tasks = Object.entries(state.tasks).map(([id, task]) => {
        const first = task.history[0]?.at ?? state.startedAt;
        const last = task.history.at(-1)?.at ?? now;
        return {
            task: id, title: task.title ?? null, items: task.items, risk: task.risk, phase: task.phase, rounds: task.rounds,
            tokens: task.tokens ?? 0, pr: task.pr ?? null, code: task.code ?? null,
            minutes: Math.round((Date.parse(last) - Date.parse(first)) / 60_000),
        };
    });
    const interventions = {};
    for (const entry of state.interventions) interventions[entry.kind] = (interventions[entry.kind] ?? 0) + 1;
    return {
        run: state.run, scope: state.scope, owner: state.owner, dryRun: state.dryRun,
        startedAt: state.startedAt, finishedAt: now,
        interventions, interventionCount: state.interventions.length,
        tasks,
        escalations: [
            ...state.escalations.map(entry => ({ items: entry.items, code: entry.code, question: entry.question })),
            ...tasks.filter(task => task.phase === 'blocked').map(task => ({ items: task.items, code: task.code, question: null })),
        ],
        totals: {
            tasks: tasks.length,
            done: tasks.filter(task => task.phase === 'done').length,
            prs: tasks.filter(task => task.pr).length,
            blocked: tasks.filter(task => task.phase === 'blocked').length,
            tokens: runTokens(state),
            githubWrites: state.github.filter(entry => !entry.dryRun).length,
        },
    };
}

/**
 * 运行后审计：GitHub 上这段时间这个账号的评论和 PR，和脚本日志逐条对照。日志里没有的就是脚本以外发的（可能是维护者本人手发的，要报告）。
 * @param {Array<{ action: string, commentId?: number|string, pr?: number, dryRun?: boolean }>} logged
 * @param {{ comments: Array<{ id: number, url: string }>, prs: Array<{ number: number, url: string }> }} observed
 */
export function auditWrites(logged, observed) {
    const real = logged.filter(entry => !entry.dryRun);
    const commentIds = new Set(real.filter(entry => entry.commentId !== undefined).map(entry => String(entry.commentId)));
    const prNumbers = new Set(real.filter(entry => entry.pr !== undefined).map(entry => entry.pr));
    return {
        unexpectedComments: observed.comments.filter(comment => !commentIds.has(String(comment.id))),
        unexpectedPrs: observed.prs.filter(pr => !prNumbers.has(pr.number)),
    };
}

function renderSummary(record) {
    const lines = [
        `# Coven ${runLabel(record.run)}${record.dryRun ? '（干跑）' : ''}`,
        '',
        `- 范围：${scopeLabel(record.scope)}，维护者 @${record.owner}`,
        `- 时间：${record.startedAt} → ${record.finishedAt}`,
        `- 任务 ${record.totals.tasks} 个：完成 ${record.totals.done}，开 PR ${record.totals.prs}，blocked ${record.totals.blocked}`,
        `- 人类介入 ${record.interventionCount} 次：${Object.entries(record.interventions).map(([kind, count]) => `${kind} ×${count}`).join('、') || '无'}`,
        `- 用量：${record.totals.tokens} token；GitHub 写操作 ${record.totals.githubWrites} 次`,
        '',
        '| 任务 | 风险 | 阶段 | 轮数 | 分钟 | token | PR | 代码 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...record.tasks.map(task => `| ${taskLabel(task.task, task.title)} | ${tempoLabel(task.risk)} | ${task.phase} | ${task.rounds} | ${task.minutes} | ${task.tokens} | ${task.pr ? `#${task.pr}` : ''} | ${task.code ?? ''} |`),
    ];
    if (record.escalations.length > 0) {
        lines.push('', '## 升级', ...record.escalations.map(entry => `- ${entry.code}：${entry.items.join('、')}${entry.question ? ` —— ${entry.question}` : ''}`));
    }
    return `${lines.join('\n')}\n`;
}

function printState(state) {
    console.log(`运行 ${runLabel(state.run)}${state.dryRun ? '（干跑）' : ''}：范围 ${scopeLabel(state.scope)}，集成分支 ${state.integrationBranch}，跟踪 issue ${state.trackingIssue ?? '无'}`);
    console.log(`认领 ${Object.values(state.items).filter(item => item.claim?.state && item.claim.state !== 'released').length}/${Object.keys(state.items).length} 条；人类介入 ${state.interventions.length} 次；用量 ${runTokens(state)} token`);
    for (const id of state.order.length > 0 ? state.order : Object.keys(state.tasks)) {
        const task = state.tasks[id];
        if (!task) continue;
        console.log(`  ${id.padEnd(12)} ${(task.title ?? '').padEnd(28)} ${task.risk} ${task.phase.padEnd(11)} 第 ${task.rounds} 轮${task.session ? ` session ${task.session}` : ''}${task.pr ? ` PR #${task.pr}` : ''}${task.code ? ` ${task.code}` : ''}`);
    }
    for (const entry of state.escalations) console.log(`  升级 ${entry.code}：${entry.items.join('、')}`);
    const escalated = new Set(state.escalations.flatMap(entry => entry.items));
    const unassigned = Object.keys(state.items).filter(key => !state.items[key].task && !escalated.has(key) && state.items[key].claim?.state === 'claimed');
    if (unassigned.length > 0) console.log(`  还没分进任务的认领：${unassigned.length} 条`);
}

/** 一次运行的文件按任务名存；新开一次运行前整批挪进 runs/<上次的运行>/，上次的批准、评审不会被同名任务带过来。 */
const PER_RUN_DIRS = ['contracts', 'verify', 'reviews', 'prs', 'plan', 'prompts'];

function archivePreviousRun(root, previousRun) {
    const target = covenPath(root, 'runs', previousRun ?? `unknown-${nowIso().replace(/[:.]/g, '-')}`);
    const stateFile = path.join(root, STATE_FILE);
    const moves = [...PER_RUN_DIRS.map(dir => [covenPath(root, dir), path.join(target, dir)]), [stateFile, path.join(target, 'state.json')]]
        .filter(([from]) => fs.existsSync(from));
    if (moves.length === 0) return;
    fs.mkdirSync(target, { recursive: true });
    for (const [from, to] of moves) fs.renameSync(from, to);
}

/** git push --porcelain 的输出里，这个 ref（完整名字）是不是新建的（标记 *）；= 是远端早就有了，! 是被拒。 */
export const pushCreatedRef = (output, ref) => output.split('\n').some(line => line.startsWith('*\t') && line.includes(`:${ref}\t`));

/** 用过的作品号：本地 coven/ 下的分支和 coven- 标签、.coven/runs/ 下的运行记录，真跑时再加远端的分支和标签。 */
function usedRunNames(root, live) {
    const names = git(root, ['for-each-ref', '--format=%(refname)', `refs/heads/${BRANCH_PREFIX}`, `refs/tags/${TAG_PREFIX}*`]).split('\n').filter(Boolean);
    const runsDir = covenPath(root, 'runs');
    if (fs.existsSync(runsDir)) names.push(...fs.readdirSync(runsDir));
    if (live) names.push(...git(root, ['ls-remote', 'origin', `refs/heads/${BRANCH_PREFIX}*`, `refs/tags/${TAG_PREFIX}*`]).split('\n').map(line => line.split('\t')[1]).filter(Boolean));
    return names;
}

/**
 * 取号并切出集成分支。真跑时立刻把集成分支和占号标签 coven-op<n> 一起推上去（--atomic，要么都成要么都不成）：
 * 推送只在远端还没有它们时成功（--force-with-lease 的期望值为空），两位维护者同时取到同一个号时后到的会失败，
 * 删掉本地分支和标签换下一个号，最多试三次。标签不随分支删除，之后在别的检出里取号也看得到这个号用过。
 * 远端已经有同名的 ref、而且正好指着同一个提交（两边都从同一个 origin/main 切出）时，git 只说“已是最新”、退出码也是 0，
 * 所以要看 --porcelain 的输出：两个 ref 都标着 *（新建）才算占到。
 * @returns {{ run: string, branch: string, tag: string|null, pushed: boolean }}
 */
function allocateRun(root, { live, base }) {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        const run = runIdOf({ dryRun: !live, number: nextRunNumber(usedRunNames(root, live), !live) });
        const branch = integrationBranchOf(run);
        git(root, ['branch', branch, base]);
        if (!live) return { run, branch, tag: null, pushed: false };
        const tag = catalogueTagOf(run);
        git(root, ['tag', tag, base]);
        const refs = [`refs/heads/${branch}`, `refs/tags/${tag}`];
        const push = tryGit(root, ['push', '--porcelain', '--atomic', ...refs.map(ref => `--force-with-lease=${ref}:`), 'origin', ...refs.map(ref => `${ref}:${ref}`)]);
        if (push.ok && refs.every(ref => pushCreatedRef(push.output, ref))) return { run, branch, tag, pushed: true };
        lastError = push.output;
        git(root, ['branch', '-D', branch]);
        git(root, ['tag', '-d', tag]);
        console.log(`${runLabel(run)} 推不上去（可能被别的监控 session 先占了），换下一个号。`);
    }
    throw new Error(`连续三次没能占到作品号：${lastError.slice(0, 500)}`);
}

function currentLogin() {
    return gh(['api', 'user', '--jq', '.login']).trim();
}

function main() {
    const { positional, options } = parseArgs(process.argv.slice(2), ['live', 'force'], ['scope', 'base', 'branch', 'owner', 'note', 'tokens', 'code', 'session', 'worktree', 'unblock-by']);
    const [command, ...rest] = positional;
    const config = loadConfig(ROOT);
    if (command === 'init') {
        const file = path.join(ROOT, STATE_FILE);
        if (fs.existsSync(file)) {
            const previous = readJson(file);
            if (!previous.finishedAt) throw new Error(`上一次运行 ${previous.run} 还没收尾：接着跑就直接用它（coven:state -- show），放弃就先 coven:state -- finish --force`);
        }
        archivePreviousRun(ROOT, fs.existsSync(file) ? readJson(file).run : null);
        if (!options.scope || !fs.existsSync(covenPath(ROOT, 'scopes', `${options.scope}.json`))) throw new Error('--scope 要是 .coven/scopes/ 下已有的范围（先 npm run coven:scope）');
        if (options.branch) throw new Error('集成分支由 init 按作品号自己切（coven/op<n>），不用 --branch；要从别的提交切出就用 --base');
        const live = Boolean(options.live);
        if (live && !config.hd0Confirmed) throw new Error('HD0 还没拍板（dev/coven/config.json 的 hd0Confirmed），只能干跑');
        if (live && !config.trackingIssue) throw new Error('真跑要先开跟踪 issue，把编号填进 dev/coven/config.json 的 trackingIssue');
        const owner = options.owner ?? currentLogin();
        const base = options.base ?? 'origin/main';
        if (!options.base) git(ROOT, ['fetch', 'origin', 'main']);
        const { run, branch, tag, pushed } = allocateRun(ROOT, { live, base });
        const state = createState({ run, scope: options.scope, owner, trackingIssue: config.trackingIssue, dryRun: !live, timeZone: config.timeZone });
        if (pushed) state.github.push({ at: nowIso(), dryRun: false, action: 'push', branch, tag });
        saveState(ROOT, state);
        console.log(`已开始运行 ${runLabel(run)}，集成分支 ${branch}（从 ${base} 切出${pushed ? `，已推上去，占号标签 ${tag}` : ''}）${state.dryRun ? '。干跑：认领和 PR 只记在本地' : ''}。下一步：npm run coven:claim -- claim`);
        return;
    }
    const state = loadState(ROOT);
    // 旧格式（代号改成乐谱编目之前）的运行只能看、收尾、审计，不能接着跑
    if (!['show', 'finish', 'audit'].includes(command)) requireCurrentFormat(state);
    if (command === 'show') {
        printState(state);
        return;
    }
    if (command === 'hd') {
        const kind = rest[0];
        if (!/^HD[0-5]$/.test(kind ?? '')) throw new Error('hd 后面写 HD0–HD5');
        state.interventions.push({ at: nowIso(), kind, note: options.note ?? null });
        saveState(ROOT, state);
        console.log(`记下 ${kind}（第 ${state.interventions.length} 次人类介入）。`);
        return;
    }
    if (command === 'cost') {
        const task = state.tasks[rest[0]];
        if (!task) throw new Error(`没有任务 ${rest[0]}`);
        const added = Number(options.tokens);
        if (!Number.isInteger(added) || added < 0) throw new Error('--tokens 要写这次用掉的 token 数（子代理和工作 session 报出的 total tokens）');
        task.tokens = (task.tokens ?? 0) + added;
        saveState(ROOT, state);
        console.log(`${rest[0]} 累计 ${task.tokens} token；本次运行 ${runTokens(state)} token。`);
        return;
    }
    if (command === 'phase') {
        const [id, phase] = rest;
        const task = state.tasks[id];
        if (!task) throw new Error(`没有任务 ${id}`);
        if (phase === 'pr') throw new Error('开 PR 走 npm run coven:pr，它会自己改阶段');
        if (options.branch && options.branch !== taskBranchOf(id)) throw new Error(`--branch 要是这个任务的工作分支 ${taskBranchOf(id)}`);
        const from = task.phase;
        const unblockedBy = options['unblock-by'] ?? null;
        // 进评审时记下这一轮要审的提交（verify 跑的那个）；评审结论必须是这个提交的
        let reviewHead = null;
        if (phase === 'evaluating') {
            const latest = covenPath(ROOT, 'verify', `${id}-latest.json`);
            const verify = fs.existsSync(latest) ? readJson(latest) : null;
            if (verify?.task !== id) throw new Error(`先跑 npm run coven:verify -- --task ${id} --worktree …，再进评审`);
            reviewHead = verify.head;
        }
        const problem = transition(task, phase, {
            code: options.code, note: options.note, approved: isApprovedCurrent(ROOT, id, readJson(contractFile(ROOT, id))),
            maxRounds: config.maxReviewRounds, budget: config.budget, runTokens: runTokens(state), unblockedBy,
        });
        if (problem) throw new Error(problem);
        if (reviewHead) task.reviewHead = reviewHead;
        if (from === 'blocked' && unblockedBy) state.interventions.push({ at: nowIso(), kind: 'unblock', note: `@${unblockedBy} 解封 ${id}（${task.history.at(-2)?.code ?? ''}）` });
        if (options.session) task.session = options.session;
        if (options.worktree) task.worktree = options.worktree;
        if (options.branch) task.branch = options.branch;
        const change = claimChangeFor(phase, { code: options.code, from });
        if (change) {
            const io = githubIo(state, config, { dryRun: isDryRun(state, config), readRemote: Boolean(state.trackingIssue), persist: () => saveState(ROOT, state) });
            const { lost } = updateClaims({ keys: keysOfTask(state, id), state, config, io, change });
            for (const entry of lost) console.log(`D830 ${entry.item} 已经不归这个监控 session，停掉这条，告诉维护者。`);
        }
        saveState(ROOT, state);
        console.log(`${id}：${from} → ${phase}${phase === 'evaluating' ? `（第 ${task.rounds} 轮）` : ''}`);
        return;
    }
    if (command === 'finish') {
        // pr 阶段的认领还是 working，没人续租会过期，PR 开着却能被别人接手：也要先处理完
        const active = Object.entries(state.tasks).filter(([, task]) => ['building', 'evaluating', 'pr'].includes(task.phase));
        if (active.length > 0 && !options.force) throw new Error(`还有任务没走完：${active.map(([id, task]) => `${id}（${task.phase}）`).join('、')}（PR 合了就 phase done；确定要收尾就加 --force）`);
        const io = githubIo(state, config, { dryRun: isDryRun(state, config), readRemote: Boolean(state.trackingIssue), persist: () => saveState(ROOT, state) });
        const open = Object.keys(state.items).filter(key => {
            const item = state.items[key];
            return item.claim?.state && ['claimed', 'blocked'].includes(item.claim.state);
        });
        updateClaims({ keys: open, state, config, io, change: { state: 'released' } });
        const now = nowIso();
        const record = runRecord(state, now);
        state.finishedAt = now;
        const stem = state.run;
        writeJson(covenPath(ROOT, 'runs', `${stem}.json`), record);
        writeText(covenPath(ROOT, 'runs', `${stem}.md`), renderSummary(record));
        saveState(ROOT, state);
        console.log(renderSummary(record));
        console.log(`运行记录在 .coven/runs/${stem}.json；接下来跑 npm run coven:state -- audit。`);
        return;
    }
    if (command === 'audit') {
        if (isDryRun(state, config) && state.github.every(entry => entry.dryRun)) console.log('这次是干跑，脚本没有写过 GitHub；下面只看这段时间这个账号在仓库里的真实动作。');
        const since = state.startedAt;
        const comments = ghApiLines(`repos/${config.repo}/issues/comments?since=${since}`, `.[] | select(.user.login == "${state.owner}") | {id, url: .html_url}`);
        // 搜索只精确到天，再按创建时间筛掉运行开始之前的
        const prs = ghApiLines(`search/issues?q=${encodeURIComponent(`repo:${config.repo} is:pr author:${state.owner} created:>=${since.slice(0, 10)}`)}`, '.items[] | {number, url: .html_url, createdAt: .created_at}')
            .filter(pr => Date.parse(pr.createdAt) >= Date.parse(since));
        const { unexpectedComments, unexpectedPrs } = auditWrites(state.github, { comments, prs });
        if (unexpectedComments.length === 0 && unexpectedPrs.length === 0) console.log('审计通过：运行期间这个账号的评论和 PR 都在脚本日志里。');
        else {
            console.log('这些不在脚本日志里（可能是维护者本人手发的，逐条确认）：');
            for (const comment of unexpectedComments) console.log(`  评论 ${comment.url}`);
            for (const pr of unexpectedPrs) console.log(`  PR ${pr.url}`);
        }
        return;
    }
    throw new Error('用法：npm run coven:state -- init | show | phase | cost | hd | finish | audit（见文件开头）');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
