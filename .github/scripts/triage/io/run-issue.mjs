// .github/scripts/triage/io/run-issue.mjs
// 单条 issue 的完整 triage 流程：拉取评论与时间线 → 提取事实 → 熔断检查 → LLM 分类与重复确认 / 扫码登录诊断 → 决策。
// 只读；写入由调用方根据模式决定是否执行返回的 Plan。overrides 供本地回放注入「当时」的数据。

import { createHash } from 'node:crypto';
import { isMaintainerAssociation } from '../lib/config.mjs';
import { countRecent, evaluateBreaker } from '../lib/breaker.mjs';
import { findBotComment } from '../lib/comments.mjs';
import { decideIssue, qrAggregateFor } from '../lib/decide-issue.mjs';
import { extractQrReport, matchPlaybook, mergeDiagnosis, reportForLlm, stripQrReports } from '../lib/login-diagnosis.mjs';
import { isBotLogin, normalizeComment, normalizeIssue, summarizeTimeline } from '../lib/model.mjs';
import { extractFacts } from '../lib/parse-issue.mjs';
import { prepareBodyForLlm, truncateHeadTail } from '../lib/sanitize.mjs';
import { validateClassification, validateDiagnosis, validateDuplicateConfirm } from '../lib/schema.mjs';
import { LlmInsufficientBalance } from './deepseek.mjs';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CLOSE_TRIGGERS = new Set(['opened', 'manual', 'rerun']);

const isoAgo = (now, ms) => new Date(now - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// 拉取候选 issue：最近 candidateWindowDays 天内创建、仍然 open 的 issue，只送编号、标题、标签。
async function fetchCandidates(gh, issue, config, now) {
    const raw = await gh.paginate('/issues?state=open&sort=created&direction=desc', config.llm.candidateLimit + 40);
    return raw
        .filter(item => !item.pull_request && item.number !== issue.number)
        .filter(item => now - Date.parse(item.created_at) < config.llm.candidateWindowDays * DAY_MS)
        .slice(0, config.llm.candidateLimit)
        .map(item => ({ n: item.number, t: item.title, l: item.labels.map(label => label.name) }));
}

async function checkBreaker(gh, issue, config, now, { trigger, manualRunsLastDay }) {
    const [globalHour, globalDay, authorDay] = await Promise.all([
        gh.searchCount(`is:issue created:>=${isoAgo(now, HOUR_MS)}`),
        gh.searchCount(`is:issue created:>=${isoAgo(now, DAY_MS)}`),
        gh.searchCount(`is:issue author:${issue.author} created:>=${isoAgo(now, DAY_MS)}`),
    ]);
    const authorCreatedAt = await gh.getUser(issue.author).then(user => user.created_at).catch(() => null);
    return evaluateBreaker({ counts: { globalHour, globalDay, authorDay }, authorCreatedAt, manualRunsLastDay, isManual: trigger === 'manual', now }, config);
}

async function confirmDuplicate({ gh, llmClient, prompts, config, issue, targetNumber }) {
    const raw = await gh.getIssue(targetNumber);
    const target = { number: raw.number, open: raw.state === 'open', isPullRequest: Boolean(raw.pull_request) };
    const chars = config.llm.duplicateBodyChars;
    const payload = {
        new_issue: { title: issue.title, body: prepareBodyForLlm(issue.body, { headChars: chars, tailChars: 0, codeBlockMaxLines: 10 }) },
        existing_issue: { title: raw.title, body: truncateHeadTail(prepareBodyForLlm(raw.body ?? '', { headChars: chars, tailChars: 0, codeBlockMaxLines: 10 }), chars, 0) },
    };
    try {
        const verdict = validateDuplicateConfirm(await llmClient.completeJson([
            { role: 'system', content: prompts.duplicateConfirm },
            { role: 'user', content: JSON.stringify(payload) },
        ]));
        return verdict.ok ? { target, confirmed: verdict.value.same, confidence: verdict.value.confidence } : { target, confirmed: false, confidence: 0 };
    } catch (error) {
        if (error instanceof LlmInsufficientBalance) throw error;
        return { target, confirmed: false, confidence: 0 };
    }
}

// 让 LLM 读诊断报告，从已知原因表里挑原因并给出分析。返回 { status, value?, errors? }，余额不足照常抛出。
async function diagnoseLogin({ llmClient, prompts, playbook, provider, report, description }) {
    const payload = {
        provider,
        report: reportForLlm(report, playbook.reportChars),
        description: prepareBodyForLlm(description, { headChars: playbook.descriptionChars, tailChars: 0, codeBlockMaxLines: 10 }),
    };
    try {
        const verdict = validateDiagnosis(await llmClient.completeJson([
            { role: 'system', content: prompts.loginDiagnose },
            { role: 'user', content: JSON.stringify(payload) },
        ]), playbook, provider);
        return verdict.ok ? { status: 'ok', value: verdict.value } : { status: 'invalid', errors: verdict.errors };
    } catch (error) {
        if (error instanceof LlmInsufficientBalance) throw error;
        return { status: 'error', errors: [error.message] };
    }
}

// 主入口。返回 { plan, breaker, balanceExhausted, llmUsage }。
export async function runIssueTriage({ gh, llmClient, config, prompts, templateLines, mode, issueRaw, trigger, now = Date.now(), overrides = {} }) {
    const issue = normalizeIssue(issueRaw);
    const botLogin = config.botLogin;
    const comments = overrides.comments ?? (await gh.listComments(issue.number)).map(normalizeComment);
    const timeline = summarizeTimeline(overrides.timeline ?? await gh.listTimeline(issue.number), { botLogin, labels: issue.labels });
    const history = {
        reopened: timeline.reopened || trigger === 'reopened',
        botClosedBefore: timeline.botClosedBefore,
        maintainerCommented: comments.some(comment => !isBotLogin(comment.author) && comment.author !== issue.author && isMaintainerAssociation(config, comment.authorAssociation)),
    };
    const previous = findBotComment(comments, botLogin, 'triage')?.state ?? null;
    const authorComments = comments.filter(comment => comment.author === issue.author).map(comment => comment.body);
    const extraText = authorComments.join('\n');
    const facts = extractFacts({ title: issue.title, body: issue.body, labels: issue.labels, extraText }, { templateLines, config });
    const bodyHash = createHash('sha256').update(issue.body).digest('hex').slice(0, 16);
    const manualRuns = [...(previous?.manualRuns ?? []).filter(at => now - Date.parse(at) < DAY_MS), ...(trigger === 'manual' ? [new Date(now).toISOString()] : [])];
    const needsTldr = facts.proseLength >= config.llm.tldrMinChars;

    const hasModuleLabel = issue.labels.some(name => name.startsWith('module: '));
    const isMaintainer = isMaintainerAssociation(config, issue.authorAssociation);
    let wantLlm = !facts.qr && !issue.labels.includes('announcement') && !(isMaintainer && hasModuleLabel);
    if (trigger === 'author-comment') wantLlm = false;
    // 编辑后正文变了：要更新 TL;DR，或者之前请作者拆分改写过（看改完还算不算「愿望清单」），才重新分类。
    if (trigger === 'edited') wantLlm = wantLlm && (needsTldr || Boolean(previous?.rewrite?.askedAt)) && previous?.bodyHash !== bodyHash;

    let llm = { status: 'skipped' };
    let breaker = null;
    let duplicate = null;
    let balanceExhausted = false;
    let candidateNumbers = [];
    // 分类和登录诊断共用一次熔断检查。
    let breakerChecked = false;
    const ensureBreaker = async () => {
        if (!breakerChecked && !overrides.skipBreaker) {
            breaker = await checkBreaker(gh, issue, config, now, { trigger, manualRunsLastDay: countRecent(previous?.manualRuns ?? [], now) });
        }
        breakerChecked = true;
        return breaker;
    };

    if (wantLlm && !llmClient) llm = { status: 'unavailable' };
    if (wantLlm && llmClient) {
        await ensureBreaker();
        if (breaker?.tripped) {
            llm = { status: 'breaker' };
        } else {
            const candidates = overrides.candidates ?? await fetchCandidates(gh, issue, config, now);
            candidateNumbers = candidates.map(item => item.n);
            const headChars = needsTldr ? config.llm.longBodyChars - config.llm.bodyTailChars : config.llm.bodyHeadChars;
            const payload = {
                issue: {
                    title: issue.title,
                    body: prepareBodyForLlm(issue.body, { headChars, tailChars: config.llm.bodyTailChars, codeBlockMaxLines: config.llm.codeBlockMaxLines }),
                    template: facts.kind,
                },
                facts: { version: facts.version, deployment: facts.deployment, hasErrorLog: facts.hasErrorLog, effectivelyEmpty: facts.effectivelyEmpty },
                needs_tldr: needsTldr,
                candidates,
            };
            try {
                const raw = await llmClient.completeJson([
                    { role: 'system', content: prompts.classify },
                    { role: 'user', content: JSON.stringify(payload) },
                ]);
                const verdict = validateClassification(raw, config);
                llm = verdict.ok ? { status: 'ok', value: verdict.value } : { status: 'invalid', errors: verdict.errors };
                const value = verdict.value;
                if (verdict.ok && CLOSE_TRIGGERS.has(trigger) && value.duplicateOf && candidateNumbers.includes(value.duplicateOf)
                    && value.duplicateConfidence >= config.thresholds.duplicateConfirmConfidence) {
                    duplicate = await confirmDuplicate({ gh, llmClient, prompts, config, issue, targetNumber: value.duplicateOf });
                }
            } catch (error) {
                if (error instanceof LlmInsufficientBalance) balanceExhausted = true;
                llm = { status: 'error', errors: [error.message] };
            }
        }
    }

    // ---- 扫码登录诊断 ----
    // 规则匹配每次都跑；LLM 只在报告是新的（或维护者手动重跑）时调用，报告没变就沿用上一次的结论。
    // 会被并入汇总 issue 的旧版本报告信息太少，不值得一次调用。
    let diagnosis = null;
    let diagnosisLlm = null;
    const report = facts.qr && !issue.labels.includes('announcement') && !isMaintainer ? extractQrReport([issue.body, ...authorComments]) : null;
    if (report) {
        const playbook = config.loginPlaybook;
        const provider = facts.qr.provider;
        const reportHash = createHash('sha256').update(report).digest('hex').slice(0, 16);
        const previousDiagnosis = previous?.diagnosis ?? null;
        const fresh = previousDiagnosis?.reportHash !== reportHash || previousDiagnosis.source !== 'llm' || trigger === 'manual';
        if (fresh && !qrAggregateFor(facts, config, issue.number) && llmClient && !balanceExhausted) {
            if ((await ensureBreaker())?.tripped) {
                diagnosisLlm = { status: 'breaker' };
            } else {
                const description = stripQrReports([issue.body, ...authorComments].join('\n'));
                try {
                    diagnosisLlm = await diagnoseLogin({ llmClient, prompts, playbook, provider, report, description });
                } catch (error) {
                    if (!(error instanceof LlmInsufficientBalance)) throw error;
                    balanceExhausted = true;
                    diagnosisLlm = { status: 'error', errors: [error.message] };
                }
            }
        }
        diagnosis = mergeDiagnosis({ reportHash, ruleCauses: matchPlaybook(report, provider, playbook), llm: diagnosisLlm, previous: previousDiagnosis, playbook });
    }

    let aggregateTarget = null;
    const aggregate = facts.qr && config.aggregates.find(item => item.provider === facts.qr.provider);
    if (aggregate) {
        aggregateTarget = overrides.aggregateTargets?.[aggregate.issue]
            ?? await gh.getIssue(aggregate.issue).then(raw => ({ number: raw.number, open: raw.state === 'open' })).catch(() => null);
    }

    const plan = decideIssue({
        issue, facts, config, mode, trigger, now, llm, breaker, duplicate, candidateNumbers, previous, history,
        aggregateTarget, bodyHash, manualRuns, closesSoFar: overrides.closesSoFar ?? 0, diagnosis, diagnosisLlm,
    });
    return { plan, breaker, balanceExhausted, llmUsage: llmClient?.usage ?? null, facts, llm, diagnosis, diagnosisLlm };
}
