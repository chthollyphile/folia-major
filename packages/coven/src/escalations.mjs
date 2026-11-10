// packages/coven/src/escalations.mjs
// 升级（D8xx）：planner 不能自己定的条目，带着问题和选项交给维护者（HD4）。
// 每条升级导入时编号 e1、e2……，之后不删：维护者的决定记在 decision 里，条目分进任务、被释放、被新的升级取代时
// resolution 记下怎么了结的。运行记录里保留全部升级和决定（Op. 1：升级在导入任务时被删掉，记录里看不出任务曾经停过）。
//
//   decision：{ at, by, outcome, note }，outcome 是 DECISIONS 里的一种
//   movedTo：{ <条目>: <新升级的编号> }，planner 后来把这条升级里的部分条目又升级了一次
//   resolution：{ at, how: 'tasks' | 'superseded' | 'released' | 'finished', tasks?, supersededBy? }

/** 维护者对一条升级的决定。replan 之后条目回到 claimed，下一次 coven prompt planner 会带着这条决定重新规划。 */
export const DECISIONS = {
    replan: '做成任务：让 planner 按维护者的决定重新出契约',
    release: '不做：释放这些条目的认领',
    hold: '先放着：条目保持 blocked',
};

export const openEscalations = state => (state.escalations ?? []).filter(entry => !entry.resolution);

/** 一条没了结的升级里，还没分进任务、也没被新的升级接走的条目。 */
export const openItemsOf = (state, entry) => entry.items.filter(item => !state.items[item]?.task && !entry.movedTo?.[item]);

/** 还在升级里的条目（等决定、先放着，或者等重新规划）。 */
export const escalatedItems = state => new Set(openEscalations(state).flatMap(entry => openItemsOf(state, entry)));

/** 还在等维护者的条目：升级了、维护者还没决定或者决定先放着。这些不交给 planner，也不能直接分进任务。 */
export const waitingItems = state => new Map(openEscalations(state)
    .filter(entry => entry.decision?.outcome !== 'replan')
    .flatMap(entry => openItemsOf(state, entry).map(item => [item, entry.id])));

function nextEscalationId(state) {
    const used = (state.escalations ?? []).map(entry => Number(/^e(\d+)$/.exec(entry.id ?? '')?.[1] ?? 0));
    return `e${Math.max(0, ...used) + 1}`;
}

/**
 * planner 输出导入之后（任务已经登记）：新的升级编号登记，它们点到的、还在旧升级里的条目记成被新升级接走（movedTo），
 * 旧升级里剩下的条目和维护者的决定照样留着。然后旧升级里没有剩下条目的（都分进了任务，或者都被接走），记下怎么了结的。
 * @returns {string[]} 新登记的升级编号
 */
export function recordEscalations(state, escalations, now) {
    const ids = [];
    for (const escalation of escalations) {
        const id = nextEscalationId(state);
        for (const entry of openEscalations(state)) {
            for (const item of openItemsOf(state, entry).filter(candidate => escalation.items.includes(candidate))) entry.movedTo = { ...entry.movedTo, [item]: id };
        }
        state.escalations.push({
            id, items: escalation.items, code: escalation.code, question: escalation.question ?? null,
            options: escalation.options ?? [], lean: escalation.lean ?? null, at: now, decision: null, resolution: null,
        });
        ids.push(id);
    }
    for (const entry of openEscalations(state)) {
        if (openItemsOf(state, entry).length > 0) continue;
        const tasks = [...new Set(entry.items.map(item => state.items[item]?.task).filter(Boolean))];
        const supersededBy = [...new Set(Object.values(entry.movedTo ?? {}))];
        entry.resolution = { at: now, how: tasks.length > 0 ? 'tasks' : 'superseded', ...(tasks.length > 0 ? { tasks } : {}), ...(supersededBy.length > 0 ? { supersededBy } : {}) };
    }
    return ids;
}

/** 收尾时还没了结的升级：认领已经由 finish 释放，记成收尾时了结，运行记录里看得出它没等到结果。 */
export function closeOpenEscalations(state, now) {
    for (const entry of openEscalations(state)) entry.resolution = { at: now, how: 'finished' };
}

/**
 * 维护者对一条升级的决定能不能记。认领评论由调用方先改（replan 把 blocked 改回 claimed，release 改成 released），
 * 改成了再 applyDecision：中途写 GitHub 出错时什么都没记，原样重跑就行。
 * @returns {string[]}
 */
export function decisionProblems(state, { id, outcome, by, note }) {
    const entry = (state.escalations ?? []).find(candidate => candidate.id === id);
    if (!entry) return [`没有升级 ${id}（有：${(state.escalations ?? []).map(candidate => candidate.id).join('、') || '无'}）`];
    const problems = [];
    if (entry.resolution) problems.push(`升级 ${id} 已经了结（${resolutionLabel(entry)}）`);
    if (!Object.hasOwn(DECISIONS, outcome ?? '')) problems.push(`--decision 只能是 ${Object.keys(DECISIONS).join('、')}`);
    if (!by) problems.push('写明是哪位维护者的决定：--by <账号>（只能写维护者在对话里明确说过的）');
    if (!note?.trim()) problems.push('--note 写维护者选了什么、补充了什么要求：replan 时 planner 会按它重新出契约');
    return problems;
}

/** 记下决定；release 同时了结这条升级。 */
export function applyDecision(state, { id, outcome, by, note, now }) {
    const entry = state.escalations.find(candidate => candidate.id === id);
    entry.decision = { at: now, by, outcome, note };
    if (outcome === 'release') entry.resolution = { at: now, how: 'released' };
    return entry;
}

/** 给人看的一行：升级的结果。 */
export function resolutionLabel(entry) {
    const resolution = entry.resolution;
    if (!resolution) return entry.decision ? `等${entry.decision.outcome === 'hold' ? '维护者再看' : '重新规划'}` : '等维护者决定';
    if (resolution.how === 'released') return '不做，已释放';
    if (resolution.how === 'finished') return '收尾时还没了结，认领已释放';
    const parts = [];
    if (resolution.tasks?.length) parts.push(`分进了 ${resolution.tasks.join('、')}`);
    if (resolution.supersededBy?.length) parts.push(`由 ${resolution.supersededBy.join('、')} 接着升级`);
    return parts.join('；') || resolution.how;
}
