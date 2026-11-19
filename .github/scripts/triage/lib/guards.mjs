// .github/scripts/triage/lib/guards.mjs
// 关闭护栏：LLM 和规则只能「提议」关闭，这里用确定性条件决定能不能真的关。
// 宁可漏关，不可误关；每条拦截原因都写进 job summary，便于复核。

import { isMaintainerAssociation } from './config.mjs';

export const CLOSE_REASONS = ['duplicate', 'qr-aggregate', 'web-deployment', 'unofficial-build', 'invalid', 'out_of_scope', 'needs-info-timeout', 'rewrite-timeout', 'stale'];
const TRIAGE_REASONS = new Set(['duplicate', 'qr-aggregate', 'web-deployment', 'unofficial-build', 'invalid', 'out_of_scope']);

// 判断能否关闭。history 来自时间线与评论：{ reopened, botClosedBefore, maintainerCommented }。
// evidence 是各关闭理由的依据，结构见下方各分支。返回 { allowed, blockedBy }。
export function canClose({ reason, issue, history, evidence = {}, mode, closesSoFar, config }) {
    const blockedBy = [];
    const labels = issue.labels;
    const thresholds = config.thresholds;

    if (!CLOSE_REASONS.includes(reason)) blockedBy.push(`未知关闭理由 ${reason}`);
    if (mode !== 'live') blockedBy.push(`当前模式为 ${mode}`);
    if (issue.state !== 'open') blockedBy.push('issue 不是 open 状态');
    if (isMaintainerAssociation(config, issue.authorAssociation)) blockedBy.push('作者是维护者');
    if (labels.includes('announcement')) blockedBy.push('带 announcement 标签');
    if (labels.includes('bot: skip')) blockedBy.push('带 bot: skip 标签');
    if (issue.assignees > 0) blockedBy.push('已有 assignee');
    if (issue.hasMilestone) blockedBy.push('已设置 milestone');
    if (issue.locked) blockedBy.push('已锁定');
    if (history.reopened) blockedBy.push('曾被重开过');
    if (history.botClosedBefore) blockedBy.push('bot 之前关闭过它');
    if (TRIAGE_REASONS.has(reason) && history.maintainerCommented) blockedBy.push('维护者已参与讨论');
    if (closesSoFar >= thresholds.maxClosesPerRun) blockedBy.push(`本次运行已关闭 ${closesSoFar} 个，达到上限`);

    if (reason === 'duplicate') {
        const { target, confirmed, confirmConfidence, candidateNumbers } = evidence;
        if (!target || !target.open || target.isPullRequest || target.number === issue.number) blockedBy.push('重复目标不存在、已关闭或无效');
        if (!candidateNumbers?.includes(target?.number)) blockedBy.push('重复目标不在本次发出的候选集里');
        if (!confirmed || !(confirmConfidence >= thresholds.duplicateConfirmConfidence)) blockedBy.push('重复二次确认未通过');
    }
    if (reason === 'qr-aggregate') {
        const { target } = evidence;
        if (!target || !target.open || target.number === issue.number) blockedBy.push('汇总 issue 不存在或已关闭');
    }
    if (reason === 'web-deployment') {
        if (!evidence.causes?.length) blockedBy.push('诊断报告没有确定性命中网页版部署问题');
    }
    if (reason === 'unofficial-build') {
        if (evidence.build !== 'unofficial') blockedBy.push('诊断报告的 build 行不是 unofficial');
    }
    if (reason === 'invalid') {
        if (!evidence.effectivelyEmpty) blockedBy.push('正文并非空模板');
        if (evidence.llmSuggestion !== 'invalid' || !(evidence.llmConfidence >= thresholds.invalidConfidence)) blockedBy.push('LLM 未以足够置信度判为无效');
    }
    if (reason === 'out_of_scope') {
        if (!config.outOfScope.some(item => item.id === evidence.topic)) blockedBy.push('超范围主题不在配置列表中');
        if (!(evidence.llmConfidence >= thresholds.closeConfidence)) blockedBy.push('超范围置信度不足');
    }
    return { allowed: blockedBy.length === 0, blockedBy };
}
