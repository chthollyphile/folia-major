import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrationBranchOf, isIntegrationBranch, runLabel, scopeLabel, taskBranchOf, taskLabel, tempoLabel, titleWithCatalogue } from './catalogue.mjs';
import { ROOT, covenPath, gh, git, isDryRun, loadConfig, nowIso, parseArgs, readJson, requireSupervisor, runCli, saveState, writeText } from './common.mjs';
import { githubIo, keysOfTask, unheldItems, updateClaims } from './claim.mjs';
import { approvedFile, compareWithApproved, contractFile, contractFingerprint, failingCriteria, renderContract } from './contract.mjs';
import { transition } from './state.mjs';
// dev/coven/pr.mjs
// 开 PR 的唯一入口：只指向本次运行的集成分支（coven/op<n>），不碰 main。
// 开之前把关：契约批准过（D801）且没被改（D804）、验收项全过（D802）、verify 的结果对应分支当前的提交且全部通过、
// 最近一轮评审通过、评审记录在。正文带契约、验证结果、评审结论、轮数和花费。
// 标题末尾自动带上任务的代号（`refactor(lyrics): …… [Op. 3 No. 2]`），正文首行写全代号、范围和速度术语。
// 只有监控 session 能执行（要有 .coven/state.json）；干跑时只把正文写到 .coven/prs/<任务>.md。
//
//   npm run coven:pr -- --task <任务> --title "refactor(lyrics): ……" [--branch <工作分支>]
//   npm run coven:pr -- --merge --task <任务> --by <维护者>     维护者说合时执行（HD3），只合进集成分支

/**
 * 开 PR 前的检查（纯函数）。返回问题列表，空数组才能开。
 * 评审结论绑定提交和契约指纹：评审通过之后分支又有新提交、或者契约变了，都要重新评审，不能带着 evaluator 没看过的提交开 PR。
 */
export function prPreflight({ state, taskId, contract, approved, verify, branch, branchHead, reviewExists }) {
    const problems = [];
    const task = state.tasks[taskId];
    if (!task) return [`状态文件里没有任务 ${taskId}`];
    if (!isIntegrationBranch(state.integrationBranch) || state.integrationBranch !== integrationBranchOf(state.run)) problems.push(`集成分支 ${state.integrationBranch} 不是这次运行的 ${integrationBranchOf(state.run)}，Coven 的 PR 不直接进 main`);
    if (branch !== taskBranchOf(taskId)) problems.push(`工作分支 ${branch} 不是这个任务的 ${taskBranchOf(taskId)}`);
    if (!approved) problems.push('D801：契约还没批准');
    else problems.push(...compareWithApproved(approved.contract, contract).map(problem => `${problem.code}：${problem.message}`));
    const failing = failingCriteria(contract);
    if (failing.length > 0) problems.push(`D802：还有验收项没过：${failing.join('、')}`);
    if (!verify) problems.push('还没跑 coven:verify');
    else {
        if (verify.task !== taskId) problems.push(`verify 的结果是任务 ${verify.task} 的`);
        if (verify.head !== branchHead) problems.push(`verify 的结果是 ${verify.head.slice(0, 7)} 的，分支现在是 ${branchHead.slice(0, 7)}：重跑 coven:verify`);
        if (verify.base !== state.integrationBranch) problems.push(`verify 是和 ${verify.base} 比的，要和集成分支 ${state.integrationBranch} 比（不要用 --base）`);
        for (const check of verify.checks.filter(entry => !entry.ok)) problems.push(`${check.id}（${check.kind}）没过：${check.summary.split('\n')[0]}`);
    }
    if (task.phase !== 'evaluating') problems.push(`任务在 ${task.phase} 阶段，评审通过（evaluating）之后才能开 PR`);
    const verdict = task.lastVerdict;
    if (!verdict?.passes || verdict.round !== task.rounds) problems.push('最近一轮评审没有通过（coven:contract -- verdict）');
    else {
        if (verdict.head !== branchHead) problems.push(`评审看的是 ${String(verdict.head).slice(0, 7)}，分支现在是 ${branchHead.slice(0, 7)}：新提交要重新评审`);
        if (verdict.fingerprint !== contractFingerprint(contract)) problems.push('评审之后契约变了：要重新评审');
    }
    if (!reviewExists) problems.push(`缺评审记录 .coven/reviews/${taskId}-r${task.rounds}.md`);
    return problems;
}

/** PR 正文。 */
export function renderPrBody({ state, taskId, contract, verify, reviewText }) {
    const task = state.tasks[taskId];
    const checks = verify.checks.map(check => `- ${check.ok ? '✅' : '❌'} ${check.id}（${check.kind}）：${check.summary.split('\n')[0]}`);
    return [
        `> Coven ${taskLabel(taskId, contract.title)} · ${scopeLabel(state.scope)} · ${tempoLabel(contract.risk)} · 评审 ${task.rounds} 轮 · 用量 ${task.tokens ?? 0} token`,
        `> 合进 ${runLabel(state.run)} 的集成分支 \`${state.integrationBranch}\`，整次运行结束后再由维护者开一个 PR 进 main。`,
        '',
        '## 契约',
        '',
        renderContract(contract),
        '',
        `## 确定性验证（${verify.head.slice(0, 7)}）`,
        '',
        ...checks,
        '',
        '<details><summary>改动的文件</summary>',
        '',
        ...verify.changed.map(entry => `- \`${entry}\``),
        '',
        '</details>',
        '',
        '## 评审结论',
        '',
        reviewText.replace(/^# .*\n/, '').trim(),
        '',
    ].join('\n');
}

function openPr({ state, config, task, taskId, options, dryRun, io }) {
    if (!options.title) throw new Error('--title 要写 PR 标题（中文 Conventional Commits，例如 refactor(lyrics): ……）');
    const branch = options.branch ?? task.branch ?? taskBranchOf(taskId);
    const contract = readJson(contractFile(ROOT, taskId));
    const approved = fs.existsSync(approvedFile(ROOT, taskId)) ? readJson(approvedFile(ROOT, taskId)) : null;
    const verifyFile = covenPath(ROOT, 'verify', `${taskId}-latest.json`);
    const verify = fs.existsSync(verifyFile) ? readJson(verifyFile) : null;
    const reviewFile = covenPath(ROOT, 'reviews', `${taskId}-r${task.rounds}.md`);
    const branchHead = git(ROOT, ['rev-parse', `refs/heads/${branch}`]).trim();
    const problems = prPreflight({ state, taskId, contract, approved, verify, branch, branchHead, reviewExists: fs.existsSync(reviewFile) });
    if (problems.length > 0) throw new Error(`不能开 PR：\n${problems.map(problem => `- ${problem}`).join('\n')}`);

    const title = titleWithCatalogue(options.title, taskId);
    const bodyFile = covenPath(ROOT, 'prs', `${taskId}.md`);
    writeText(bodyFile, renderPrBody({ state, taskId, contract, verify, reviewText: fs.readFileSync(reviewFile, 'utf8') }));
    const log = entry => {
        state.github.push({ at: nowIso(), dryRun, ...entry });
        saveState(ROOT, state);
    };
    if (dryRun) {
        if (!task.pr) {
            task.pr = `dry-${taskId}`;
            log({ action: 'pr.create', pr: task.pr, branch, base: state.integrationBranch });
        }
        console.log(`[干跑] 不推送、不开 PR。标题：${title}\n正文在 .coven/prs/${taskId}.md`);
    } else {
        const remote = git(ROOT, ['ls-remote', '--heads', 'origin', state.integrationBranch]).trim();
        if (!remote) throw new Error(`origin 上还没有集成分支 ${state.integrationBranch}：先推上去`);
        // 每次都推（幂等）：上次开了 PR 之后中断、又评审过新提交的，PR 要跟上评审看过的那个提交
        git(ROOT, ['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);
        log({ action: 'push', branch, head: branchHead });
        if (task.pr) {
            console.log(`上次已经开了 PR #${task.pr}，推了 ${branchHead.slice(0, 7)}，接着改阶段和认领。`);
        } else {
            // 上次 gh pr create 成功了、记录却没落盘：认回那个 PR，不重复开。只认本仓库的分支，不认 fork 上同名的
            const owner = config.repo.split('/')[0];
            const existing = JSON.parse(gh(['pr', 'list', '--repo', config.repo, '--head', branch, '--base', state.integrationBranch, '--state', 'open', '--json', 'number,url,headRepositoryOwner']))
                .filter(entry => entry.headRepositoryOwner?.login === owner);
            if (existing.length > 0) {
                task.pr = existing[0].number;
                log({ action: 'pr.create', pr: task.pr, url: existing[0].url, adopted: true });
                console.log(`分支上已经有 PR #${task.pr}（上次开的），认回来：${existing[0].url}`);
            } else {
                const labels = (config.prLabels ?? []).flatMap(label => ['--label', label]);
                const url = gh(['pr', 'create', '--repo', config.repo, '--base', state.integrationBranch, '--head', branch, '--title', title, '--body-file', bodyFile, ...labels]).trim().split('\n').at(-1);
                const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
                if (!number) throw new Error(`gh pr create 没返回 PR 地址：${url}`);
                task.pr = number;
                log({ action: 'pr.create', pr: number, url });
                console.log(`开了 PR #${number}：${url}`);
            }
        }
    }
    const problem = transition(task, 'pr');
    if (problem) throw new Error(problem);
    saveState(ROOT, state);
    const { lost } = updateClaims({ keys: keysOfTask(state, taskId), state, config, io, change: { state: 'working', pr: task.pr } });
    for (const entry of lost) console.log(`D830 ${entry.item} 已经不归这个监控 session：PR 开了，但要告诉维护者协调。`);
    saveState(ROOT, state);
}

/** 维护者说“合 #n”时由监控 session 执行：只合进本次的集成分支，只合评审看过的那个提交（HD3）。 */
function mergePr({ state, config, task, taskId, options, dryRun, io }) {
    if (task.phase !== 'pr' || !task.pr) throw new Error(`任务在 ${task.phase} 阶段，还没有开出的 PR`);
    if (!options.by) throw new Error('合并是 HD3：写明是哪位维护者说要合的，--by <账号>');
    if (!dryRun) {
        const view = JSON.parse(gh(['pr', 'view', String(task.pr), '--repo', config.repo, '--json', 'baseRefName,state,headRefOid']));
        if (view.baseRefName !== state.integrationBranch) throw new Error(`PR #${task.pr} 的目标是 ${view.baseRefName}，不是集成分支 ${state.integrationBranch}：不合`);
        if (view.state !== 'OPEN') throw new Error(`PR #${task.pr} 是 ${view.state}`);
        if (view.headRefOid !== task.lastVerdict?.head) throw new Error(`PR #${task.pr} 的提交 ${view.headRefOid.slice(0, 7)} 不是评审看过的那个：先重新验证和评审`);
        gh(['pr', 'merge', String(task.pr), '--repo', config.repo, '--merge', '--match-head-commit', view.headRefOid]);
    }
    state.github.push({ at: nowIso(), dryRun, action: 'pr.merge', pr: task.pr });
    state.interventions.push({ at: nowIso(), kind: 'HD3', note: `@${options.by} 说合 #${task.pr}` });
    const problem = transition(task, 'done');
    if (problem) throw new Error(problem);
    saveState(ROOT, state);
    updateClaims({ keys: keysOfTask(state, taskId), state, config, io, change: { state: 'done' } });
    saveState(ROOT, state);
    console.log(`${dryRun ? '[干跑] ' : ''}合了 PR #${task.pr}，${taskId} 完成。`);
}

function main() {
    const { options } = parseArgs(process.argv.slice(2), ['merge'], ['task', 'title', 'branch', 'by']);
    const state = requireSupervisor(ROOT);
    const config = loadConfig(ROOT);
    const taskId = options.task;
    const task = state.tasks[taskId];
    if (!task) throw new Error('--task 要是状态文件里登记过的任务');
    const dryRun = isDryRun(state, config);
    const io = githubIo(state, config, { dryRun, readRemote: Boolean(state.trackingIssue), persist: () => saveState(ROOT, state) });
    // 推送和开 PR 之前，条目要还归这个监控 session
    const unheld = unheldItems({ keys: keysOfTask(state, taskId), state, config, io });
    if (unheld.length > 0) {
        throw new Error(`D830：这些条目现在不归这个监控 session（租约过期、没人接手的，先 npm run coven:claim -- renew 再来；被别人持有的告诉维护者），不推送、不开 PR：\n${unheld.map(entry => `- ${entry.item}${entry.holder ? `（@${entry.holder.owner} 持有）` : ''}`).join('\n')}`);
    }
    if (options.merge) mergePr({ state, config, task, taskId, options, dryRun, io });
    else openPr({ state, config, task, taskId, options, dryRun, io });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
