// .github/scripts/triage/lib/decide-stale.mjs
// 陈旧清理决策：needs-rewrite 到期关闭、needs-info 超期关闭、长期无活动标记 stale、stale 超期关闭。
// 起点时间取 bot 的 marker 或时间线里的打标签时间，而不是 updated_at——bot 自己的操作也会刷新它。

import { canClose } from './guards.mjs';
import { findBotComment, renderCloseComment, renderStaleComment } from './comments.mjs';
import { isBotLogin } from './model.mjs';
import { createPlan, finalizePlan } from './plan.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (iso, now) => (now - Date.parse(iso)) / DAY_MS;

function isExempt(issue, config, aggregateNumbers) {
    if (issue.labels.some(name => config.stale.exemptLabels.includes(name))) return '带豁免标签';
    if (aggregateNumbers.includes(issue.number)) return '汇总 issue';
    if (issue.assignees > 0) return '已有 assignee';
    if (issue.hasMilestone) return '已设置 milestone';
    if (issue.locked) return '已锁定';
    return null;
}

// 输入一条 open 的 issue/PR 及其评论、时间线摘要；输出 Plan。closesSoFar 用于每次运行的关闭上限。
export function decideStale({ issue, comments, timeline, config, mode, now, closesSoFar = 0 }) {
    const plan = createPlan(issue.number, issue.isPullRequest ? 'pr' : 'issue');
    const nowIso = new Date(now).toISOString();
    const botLogin = config.botLogin;
    const aggregateNumbers = config.aggregates.map(item => item.issue);
    const humanComments = comments.filter(comment => comment.author !== botLogin && !isBotLogin(comment.author));
    const history = { reopened: timeline.reopened, botClosedBefore: timeline.botClosedBefore, maintainerCommented: false };
    const close = (reason, details) => {
        const verdict = canClose({ reason, issue, history, mode, closesSoFar, config });
        if (!verdict.allowed) {
            plan.blocked.push({ reason, blockedBy: verdict.blockedBy });
            return false;
        }
        plan.labelsAdd.push('bot: auto-closed');
        plan.comments.push(renderCloseComment(reason, { at: nowIso, ...details }));
        plan.close = { reason, stateReason: 'not_planned' };
        return true;
    };

    // 0. needs-rewrite 到期：stale 的豁免标签对它不生效（#1298 被误打了 provider-request，按豁免就永远关不掉）；
    //    assignee、milestone、锁定、bot: skip、重开过这些护栏照常由 canClose 把关。作者改好后由 triage 撤掉标签，所以这里不看回复。
    if (!issue.isPullRequest && issue.labels.includes('needs-rewrite') && !aggregateNumbers.includes(issue.number)) {
        const askedAt = findBotComment(comments, botLogin, 'triage')?.state.rewrite?.askedAt ?? timeline.labeledAt('needs-rewrite');
        if (askedAt && daysSince(askedAt, now) > config.wishlist.graceDays) close('rewrite-timeout', { days: config.wishlist.graceDays });
        else plan.notes.push('needs-rewrite 未到期');
        return finalizePlan(plan, issue.labels, config);
    }

    const exempt = isExempt(issue, config, aggregateNumbers);
    if (exempt) {
        plan.notes.push(`豁免：${exempt}`);
        return finalizePlan(plan, issue.labels, config);
    }

    // 1. needs-info 超期：起点之后作者没有任何回复。作者编辑正文会触发重新追问并刷新起点。
    if (!issue.isPullRequest && issue.labels.includes('needs-info')) {
        const askedAt = findBotComment(comments, botLogin, 'triage')?.state.askedAt ?? timeline.labeledAt('needs-info');
        if (askedAt) {
            const authorReplied = humanComments.some(comment => comment.author === issue.author && Date.parse(comment.createdAt) > Date.parse(askedAt));
            if (!authorReplied && daysSince(askedAt, now) > config.stale.needsInfoDays) {
                close('needs-info-timeout', { days: config.stale.needsInfoDays });
                return finalizePlan(plan, issue.labels, config);
            }
        }
    }

    // 2. 已经是 stale：有新的人类活动就撤标签，否则到期后按类型决定是否关闭。
    if (issue.labels.includes('stale')) {
        const staleAt = findBotComment(comments, botLogin, 'stale')?.state.at ?? timeline.labeledAt('stale');
        if (!staleAt) return finalizePlan(plan, issue.labels, config);
        if (humanComments.some(comment => Date.parse(comment.createdAt) > Date.parse(staleAt))) {
            plan.labelsRemove.push('stale');
            return finalizePlan(plan, issue.labels, config);
        }
        const closable = !issue.isPullRequest && issue.labels.some(name => config.stale.closeLabels.includes(name)) && !issue.labels.includes('enhancement');
        if (closable && daysSince(staleAt, now) > config.stale.closeAfterStaleDays) {
            close('stale', { days: config.stale.closeAfterStaleDays });
        }
        return finalizePlan(plan, issue.labels, config);
    }

    // 3. 长期无活动：最后一次人类活动是创建或最后一条人类评论。
    const lastActivity = Math.max(Date.parse(issue.createdAt), ...humanComments.map(comment => Date.parse(comment.createdAt)));
    if ((now - lastActivity) / DAY_MS > config.stale.inactiveDays) {
        const willClose = !issue.isPullRequest && issue.labels.some(name => config.stale.closeLabels.includes(name)) && !issue.labels.includes('enhancement');
        plan.labelsAdd.push('stale');
        plan.comments.push(renderStaleComment({ at: nowIso, inactiveDays: config.stale.inactiveDays, closeAfterDays: config.stale.closeAfterStaleDays, willClose, isPullRequest: issue.isPullRequest }));
    }
    return finalizePlan(plan, issue.labels, config);
}
