// .github/scripts/triage/lib/decide-issue.mjs
// issue 决策：把确定性事实、校验过的 LLM 分类、重复确认结果和上一次的 bot 状态合成一份 Plan。
// 纯函数；所有网络结果由调用方查好传入，便于单测和本地回放。

import { canClose } from './guards.mjs';
import { isMaintainerAssociation, moduleLabel } from './config.mjs';
import { renderCloseComment, renderDiagnosisComment, renderDiagnosisSection, renderRewriteComment, renderTriageComment } from './comments.mjs';
import { createPlan, finalizePlan } from './plan.mjs';
import { compareVersions } from './version.mjs';

const TYPE_LABELS = ['bug', 'enhancement', 'question', 'documentation'];
const CLOSE_TRIGGERS = new Set(['opened', 'manual', 'rerun']);
const FOLLOWUP_TRIGGERS = new Set(['edited', 'author-comment']);
// 已知原因表里属于「网页版部署没配好后端」的条目（login-playbook.json），命中就按部署问题关闭。
const WEB_DEPLOYMENT_CAUSES = new Set(['web-api-not-configured', 'web-api-loopback', 'web-api-unreachable']);

function typeLabelFor(type) {
    if (type === 'bug') return 'bug';
    if (type === 'feature' || type === 'provider_request') return 'enhancement';
    if (type === 'question' || type === 'support') return 'question';
    return null;
}

function providerRequestFor({ facts, llm, isBugLike, config, issue }) {
    if (isBugLike) return null;
    const llmType = llm?.type;
    const deterministic = facts.providerRequest.isRequest && (!llm || ['feature', 'other', 'question'].includes(llmType));
    if (llmType !== 'provider_request' && !deterministic) return null;
    const haystack = `${issue.title}\n${issue.body}`;
    return {
        appleMusic: facts.mentionsAppleMusic,
        inProgress: config.providerRequest.inProgress
            .filter(item => item.issue !== issue.number && new RegExp(item.pattern, 'i').test(haystack))
            .map(item => item.issue),
    };
}

const WISHLIST_TYPES = new Set(['feature', 'other']);

// 「愿望清单」：一个 issue 塞进一长串互不相关的需求（#1298）。LLM 判断加确定性的结构门槛，两道都过才请作者拆分或改写，
// 到期未改由 decide-stale 关闭。返回 marker 里的 rewrite 状态：null（没有）、{ askedAt }（等待修改）、{ cancelled: true }（维护者撤了标签）。
function rewriteFor({ facts, llm, previous, issue, isBugLike, providerRequest, config, nowIso }) {
    const before = previous?.rewrite ?? null;
    if (before?.cancelled) return before;
    // 标记过、标签却不在了：维护者手动撤掉，之后不再追究。
    if (before?.askedAt && !issue.labels.includes('needs-rewrite')) return { cancelled: true };
    if (isBugLike || providerRequest) return null;
    const { minListItems, minSections, confidence, exemptAssociations } = config.wishlist;
    // 合并过 PR 的贡献者常写结构完整的长提案（#403、#496、#1090），不按这条规则追究。
    if (exemptAssociations.includes(issue.authorAssociation)) return null;
    if (facts.structure.listItems < minListItems || facts.structure.sections < minSections) return null;
    // 这次没拿到 LLM 结论（熔断、作者回复不重跑分类）：维持上一次的判断，不凭结构单独起一次标记。
    if (!llm) return before;
    if (!WISHLIST_TYPES.has(llm.type) || !(llm.wishlistConfidence >= confidence)) return null;
    // 截止时间从第一次标记算起，作者反复编辑不会续期。
    return { askedAt: before?.askedAt ?? nowIso };
}

export const rewriteDeadline = (askedAt, config) => new Date(Date.parse(askedAt) + config.wishlist.graceDays * 24 * 60 * 60 * 1000).toISOString();

// 旧版本的扫码诊断要并入的汇总 issue；新版本的诊断更完整，可能是新问题，返回 null。
export function qrAggregateFor(facts, config, issueNumber) {
    if (!facts.qr?.hasDiagnostics) return null;
    const aggregate = config.aggregates.find(item => item.provider === facts.qr.provider);
    if (!aggregate || aggregate.issue === issueNumber) return null;
    const versionOk = aggregate.maxAppVersion === null || (facts.qr.appVersion && compareVersions(facts.qr.appVersion, aggregate.maxAppVersion) <= 0);
    return versionOk ? aggregate : null;
}

// 依次尝试各个关闭理由，第一条通过护栏的生效；被拦下的记进 plan.blocked。
function tryClose(plan, attempts, context) {
    for (const attempt of attempts) {
        const verdict = canClose({ ...context, reason: attempt.reason, evidence: attempt.evidence });
        if (verdict.allowed) return attempt;
        plan.blocked.push({ reason: attempt.reason, blockedBy: verdict.blockedBy });
    }
    return null;
}

// 主入口。参数说明见 run-issue.mjs 的调用处。
export function decideIssue(input) {
    const { issue, facts, config, mode, trigger, now, breaker, duplicate, candidateNumbers = [], previous, history, closesSoFar = 0, bodyHash, manualRuns = [], diagnosis = null } = input;
    const llm = input.llm?.status === 'ok' ? input.llm.value : null;
    const plan = createPlan(issue.number, 'issue');
    const nowIso = new Date(now).toISOString();

    if (issue.labels.includes('announcement')) {
        plan.notes.push('announcement issue，跳过');
        return finalizePlan(plan, issue.labels, config);
    }

    const isQr = Boolean(facts.qr);
    const isBugLike = isQr || facts.kind === 'bug' || (facts.kind === 'none' && llm?.type === 'bug');
    const providerRequest = providerRequestFor({ facts, llm, isBugLike, config, issue })
        ?? (FOLLOWUP_TRIGGERS.has(trigger) && previous?.providerRequest ? previous.providerRequest : null);

    const existingModule = issue.labels.find(name => name.startsWith('module: '))?.slice('module: '.length) ?? null;
    const module = existingModule ?? (isQr || providerRequest ? 'omni' : llm?.module ?? previous?.module ?? null);
    if (!existingModule && module) plan.labelsAdd.push(moduleLabel(module));

    if (isMaintainerAssociation(config, issue.authorAssociation)) {
        plan.notes.push('维护者开的 issue，只补模块标签');
        return finalizePlan(plan, issue.labels, config);
    }

    const diagnosisLlm = input.diagnosisLlm ?? null;
    const rateLimited = input.llm?.status === 'breaker' || diagnosisLlm?.status === 'breaker';
    if (rateLimited) plan.labelsAdd.push('bot: rate-limited');
    if (llm || diagnosisLlm?.status === 'ok') plan.labelsRemove.push('bot: rate-limited');
    if (input.llm?.status === 'invalid') plan.notes.push(`LLM 输出未通过校验：${input.llm.errors.join('；')}`);
    if (input.llm?.status === 'error') plan.notes.push(`LLM 调用失败：${input.llm.errors.join('；')}`);
    if (diagnosisLlm?.status === 'invalid') plan.notes.push(`登录诊断输出未通过校验：${diagnosisLlm.errors.join('；')}`);
    if (diagnosisLlm?.status === 'error') plan.notes.push(`登录诊断调用失败：${diagnosisLlm.errors.join('；')}`);

    if (!issue.labels.some(name => TYPE_LABELS.includes(name))) {
        const typeLabel = isQr ? 'bug' : providerRequest ? 'enhancement' : typeLabelFor(llm?.type ?? (facts.kind === 'feature' ? 'feature' : facts.kind));
        if (typeLabel) plan.labelsAdd.push(typeLabel);
    }
    if (providerRequest) plan.labelsAdd.push('provider-request');
    if (facts.unofficialBuild) plan.labelsAdd.push('unofficial build');
    else if (facts.selfHosted) plan.labelsAdd.push('self-hosted');

    // ---- 关闭 ----
    const related = [];
    const closeAttempts = [];
    if (isQr && facts.qr.hasDiagnostics) {
        // 部署问题与非官方构建都不在本仓库处理：只看诊断报告的确定性规则与 build 行，不看 LLM。
        const webCauses = (diagnosis?.ruleCauses ?? []).filter(id => WEB_DEPLOYMENT_CAUSES.has(id));
        if (webCauses.length) {
            closeAttempts.push({
                reason: 'web-deployment',
                stateReason: 'not_planned',
                label: 'deployment config',
                evidence: { causes: webCauses },
                causes: config.loginPlaybook.causes.filter(cause => webCauses.includes(cause.id)),
            });
        }
        if (facts.qr.build === 'unofficial') {
            closeAttempts.push({ reason: 'unofficial-build', stateReason: 'not_planned', label: 'unofficial build', evidence: { build: facts.qr.build } });
        }
        const aggregate = config.aggregates.find(item => item.provider === facts.qr.provider);
        if (aggregate && aggregate.issue !== issue.number) {
            // 新版本的诊断更完整，可能是新问题：不并入，但仍然链接汇总 issue 方便对照。
            if (qrAggregateFor(facts, config, issue.number)) closeAttempts.push({ reason: 'qr-aggregate', stateReason: 'duplicate', label: 'duplicate', evidence: { target: input.aggregateTarget }, target: aggregate.issue });
            related.push(aggregate.issue);
        }
    }
    if (llm?.duplicateOf && duplicate) {
        closeAttempts.push({
            reason: 'duplicate',
            stateReason: 'duplicate',
            label: 'duplicate',
            evidence: { target: duplicate.target, confirmed: duplicate.confirmed, confirmConfidence: duplicate.confidence, candidateNumbers },
            target: llm.duplicateOf,
        });
    }
    if (facts.effectivelyEmpty && !isQr && (facts.kind === 'bug' || facts.kind === 'none')) {
        closeAttempts.push({ reason: 'invalid', stateReason: 'not_planned', label: 'invalid', evidence: { effectivelyEmpty: true, llmSuggestion: llm?.closeSuggestion, llmConfidence: llm?.closeConfidence } });
    }
    if (llm?.closeSuggestion === 'out_of_scope' && !providerRequest) {
        closeAttempts.push({ reason: 'out_of_scope', stateReason: 'not_planned', label: 'out of scope', evidence: { topic: llm.outOfScopeTopic, llmConfidence: llm.closeConfidence } });
    }

    if (CLOSE_TRIGGERS.has(trigger) && closeAttempts.length > 0) {
        const chosen = tryClose(plan, closeAttempts, { issue, history, mode, closesSoFar, config });
        if (chosen) {
            const topic = config.outOfScope.find(item => item.id === llm?.outOfScopeTopic);
            plan.labelsAdd.push(chosen.label, 'bot: auto-closed');
            plan.comments.push(renderCloseComment(chosen.reason, { at: nowIso, target: chosen.target, topicDescription: topic?.description, causes: chosen.causes }));
            plan.close = { reason: chosen.reason, stateReason: chosen.stateReason };
            return finalizePlan(plan, issue.labels, config);
        }
    }

    if (llm?.duplicateOf && candidateNumbers.includes(llm.duplicateOf) && llm.duplicateConfidence >= config.thresholds.relatedConfidence) {
        related.push(llm.duplicateOf);
    }

    // ---- 需求过散：请作者拆分或改写 ----
    const rewrite = rewriteFor({ facts, llm, previous, issue, isBugLike, providerRequest, config, nowIso });
    const rewritePending = Boolean(rewrite?.askedAt);
    const rewriteReceived = !rewrite && Boolean(previous?.rewrite?.askedAt);
    if (rewritePending) plan.labelsAdd.push('needs-rewrite');
    else plan.labelsRemove.push('needs-rewrite');
    const rewriteSection = rewritePending ? { deadline: rewriteDeadline(rewrite.askedAt, config), days: config.wishlist.graceDays } : null;

    // ---- 追问 ----
    const needsErrorLog = llm ? llm.needsErrorLog : previous?.needsErrorLog ?? null;
    const missing = [];
    if (isQr) {
        if (!facts.qr.hasDiagnostics) missing.push('qrDiagnostics');
    } else if (isBugLike && !providerRequest) {
        if (facts.effectivelyEmpty) missing.push('description');
        if (!facts.version) missing.push('version');
        if (!facts.deployment) missing.push('deployment');
        if (needsErrorLog === true && !facts.hasErrorLog) missing.push('errorLog');
    }
    if (missing.length) plan.labelsAdd.push('needs-info');
    else plan.labelsRemove.push('needs-info');
    const infoReceived = !missing.length && Boolean(previous?.missing?.length);
    const askedAt = missing.length
        ? (FOLLOWUP_TRIGGERS.has(trigger) || !previous?.askedAt ? nowIso : previous.askedAt)
        : null;

    // ---- TL;DR ----
    let tldr = null;
    if (facts.proseLength >= config.llm.tldrMinChars) {
        tldr = llm?.tldr ?? (previous?.bodyHash === bodyHash ? previous?.tldr ?? null : null);
    }

    const reason = llm?.reason ?? previous?.reason ?? null;
    const relatedUnique = [...new Set(related)].filter(number => number !== issue.number);
    const state = {
        kind: 'triage',
        module,
        askedAt,
        missing,
        needsErrorLog,
        providerRequest,
        bodyHash,
        tldr,
        diagnosis,
        reason,
        rewrite,
        manualRuns,
        updatedAt: nowIso,
    };

    const hasContent = module || tldr || diagnosis || providerRequest || missing.length || infoReceived || relatedUnique.length || rewritePending || rewriteReceived;
    if (hasContent) {
        plan.upsert = {
            kind: 'triage',
            body: renderTriageComment({
                state,
                module,
                moduleDescription: config.modules[module] ?? '',
                tldr,
                diagnosis,
                playbook: config.loginPlaybook,
                providerRequest,
                missing,
                infoReceived,
                related: relatedUnique,
                reason,
                rateLimited,
                rewrite: rewriteSection,
                rewriteReceived,
            }),
        };
    }
    // 已有 triage 评论时（例如熔断后补跑才判出来）原地更新不会通知作者：第一次标记单独回一条，好让作者知道有期限。
    if (rewritePending && !previous?.rewrite?.askedAt && previous) {
        plan.comments.push(renderRewriteComment({ at: nowIso, ...rewriteSection }));
    }
    // 作者后来补了新的诊断报告：triage 评论是原地更新的，不会通知，单独回一条诊断。
    if (diagnosis && previous && FOLLOWUP_TRIGGERS.has(trigger) && diagnosis.reportHash !== previous.diagnosis?.reportHash) {
        const section = renderDiagnosisSection(diagnosis, config.loginPlaybook);
        if (section) plan.comments.push(renderDiagnosisComment({ at: nowIso, reportHash: diagnosis.reportHash, section }));
    }
    if (breaker?.tripped) plan.notes.push(`熔断：${breaker.reasons.join('；')}`);
    return finalizePlan(plan, issue.labels, config);
}
