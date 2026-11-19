// .github/scripts/triage/bin/triage-stale.mjs
// triage-stale workflow 的入口（每天一次）：needs-info 超期、长期无活动、stale 超期，
// 以及熔断解除后补跑带 `bot: rate-limited` 的 issue。

import { loadConfig, loadPrompts, loadTemplateLines, modeFromEnv } from '../io/context.mjs';
import { createDeepSeek } from '../io/deepseek.mjs';
import { executePlan, writeSummary } from '../io/execute.mjs';
import { createGitHub } from '../io/github.mjs';
import { runIssueTriage } from '../io/run-issue.mjs';
import { decideStale } from '../lib/decide-stale.mjs';
import { normalizeComment, normalizeIssue, summarizeTimeline } from '../lib/model.mjs';
import { isEmptyPlan, renderPlanSummary } from '../lib/plan.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const env = process.env;
const config = loadConfig();
const mode = modeFromEnv(config);
if (mode === 'off') {
    console.log('TRIAGE_MODE=off，跳过。');
    process.exit(0);
}

const gh = createGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, readOnly: mode !== 'live', apiUrl: env.GITHUB_API_URL });
const now = Date.now();
const day = offset => new Date(now - offset * DAY_MS).toISOString().slice(0, 10);
const plans = [];
const notices = [];

// search 只做粗筛：updated_at 只会比最后一次人类活动更晚，所以 `updated:<` 不会漏掉真正陈旧的条目。
const queries = [
    'is:open label:needs-info',
    'is:open label:needs-rewrite',
    'is:open label:stale',
    `is:open -label:stale updated:<${day(config.stale.inactiveDays)}`,
];
const seen = new Map();
for (const query of queries) {
    for (const raw of await gh.searchIssues(query, 200)) seen.set(raw.number, raw);
}

let closesSoFar = 0;
for (const raw of [...seen.values()].sort((a, b) => a.number - b.number)) {
    const issue = normalizeIssue(raw);
    const comments = (await gh.listComments(issue.number)).map(normalizeComment);
    const timeline = summarizeTimeline(await gh.listTimeline(issue.number), { botLogin: config.botLogin, labels: issue.labels });
    const plan = decideStale({ issue, comments, timeline, config, mode, now, closesSoFar });
    if (plan.close) closesSoFar += 1;
    if (!isEmptyPlan(plan) || plan.blocked.length) plans.push(plan);
    if (mode === 'live' && !isEmptyPlan(plan)) await executePlan(gh, plan, config, { comments });
}

// 补跑熔断期间延后的 LLM 分类；仍处于熔断时 runIssueTriage 会再次跳过 LLM。
if (env.DEEPSEEK_API_KEY) {
    const rateLimited = await gh.searchIssues('is:issue is:open label:"bot: rate-limited"', config.stale.rateLimitedRerunsPerRun);
    const prompts = loadPrompts(config);
    const templateLines = loadTemplateLines();
    for (const issueRaw of rateLimited) {
        if (normalizeIssue(issueRaw).labels.includes('bot: skip')) continue;
        const llmClient = createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY, config });
        const result = await runIssueTriage({ gh, llmClient, config, prompts, templateLines, mode, issueRaw, trigger: 'rerun', now, overrides: { closesSoFar } });
        if (result.plan.close) closesSoFar += 1;
        plans.push(result.plan);
        if (mode === 'live') await executePlan(gh, result.plan, config);
        if (result.breaker?.tripped && result.breaker.scope === 'global') {
            notices.push('仍处于全局熔断，停止补跑');
            break;
        }
    }
} else {
    notices.push('未配置 DEEPSEEK_API_KEY，跳过熔断补跑');
}

writeSummary(renderPlanSummary(plans, { mode, title: 'Stale triage' }) + (notices.length ? `\n\n${notices.map(note => `- ${note}`).join('\n')}` : ''));
