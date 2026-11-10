import crypto from 'node:crypto';
import { catalogueLabel } from './catalogue.mjs';
import { covenPath, gh, ghApiLines, isDryRun, nowIso, parseArgs, prLabel, readJson, requireSupervisor, saveState, splitList } from './common.mjs';
// packages/coven/src/claim.mjs
// `coven:` 认领协议（plan/coven-semi-auto-plan.md 第 4 节）：多位维护者各自跑监控 session 时，不处理同一条。
// 一条认领从头到尾只用同一条评论，状态变了就编辑它。判定只看维护者（OWNER、MEMBER、COLLABORATOR）发的评论，
// 按 claimId 而不是账号区分，所以同一位维护者开两个监控 session 也不会撞车。用法见 usage（coven claim --help）。
// 干跑（状态文件 dryRun，或配置 hd0Confirmed 为 false）时评论只记在 .coven/state.json 的 dryComments 里，GitHub 上什么都不发。

export const usage = () => [
    'coven claim status                          范围里每条现在归谁（读认领评论）',
    'coven claim claim [--items <条目,…>]         认领空闲的条目：发评论 → 再读一次 → 输了就让出（D830）',
    'coven claim renew                           续租自己的认领；一小时内续过的只核对、不改评论',
    'coven claim set (--task <任务> | --items <条目,…>) --state <状态> [--pr <号>] [--code Dxxx]',
    '                                            改认领状态（一般由 coven state、coven pr 代劳）',
    'coven claim release                         释放所有没完成的认领（一般由 coven state finish 代劳）',
    '',
    `状态：${SETTABLE_STATES.join('、')}；blocked 要带 --code，working 要带 --pr。`,
    '加 --dry-run 只记在本地，不写 GitHub。',
].join('\n');

export const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
export const CLAIM_STATES = ['claimed', 'working', 'blocked', 'handed-off', 'released', 'done'];
/** coven claim set 能改成的状态（转交 handed-off 要指定接手人，v1 不支持）。 */
export const SETTABLE_STATES = ['claimed', 'working', 'blocked', 'released', 'done'];
/** 占着条目的状态：租约内别人不能接。 */
export const ACTIVE_STATES = new Set(['claimed', 'working', 'blocked', 'handed-off']);

const MARKER = /<!--\s*coven:v1\s+(\{[\s\S]*?\})\s*-->/;
const FIRST_LINE = /^coven:\s*(claimed|working|blocked|handed-off|released|done)\b(.*)$/i;
/** 手写认领首行里的条目：适配层给了 key 的样子（itemKeyPattern）就按它认，否则认反引号包起来的第一个 token。 */
const BACKTICKED = /`([^`\s]+)`/;
const ACTION_LABELS = { refactor: '重构', 'issue-to-pr': 'issue → PR', sort: '分拣', fix: '就地修复', rewrite: '重写' };

/**
 * 一条有效的认领（从评论里读出来的）。
 * @typedef {{ commentId: number|string, author: string, createdAt: string, state: string, owner: string, claimId: string, item: string,
 *   action: string|null, scope: string|null, leaseUntil: string, pr: number|string|null, code: string|null,
 *   takeover: { owner: string, claimId: string } | null, manual: boolean }} Claim
 * @typedef {{ item: string, status: 'free'|'held'|'done', holder: Claim|null, conflicts: Claim[], expired: Claim[] }} ClaimResolution
 */

export const newClaimId = () => crypto.randomBytes(4).toString('hex').slice(0, 6);

const timeOf = value => Date.parse(value);

/**
 * 读一条评论。不是 `coven:` 开头的返回 null；是的话返回认领，格式不对的带 problem。
 * 没有隐藏标记的（维护者手写的 `coven: claimed @自己`）按首行解析，租约从最后编辑时间起算。
 * @param {{ id: number|string, author: string, association: string, createdAt: string, updatedAt?: string, body: string }} comment
 * @param {{ leaseHours: number, defaultItem?: string | null, itemPattern?: RegExp | null }} options
 */
export function parseClaimComment(comment, { leaseHours, defaultItem = null, itemPattern = null }) {
    const body = String(comment.body ?? '').replace(/\r\n/g, '\n');
    const firstLine = body.trimStart().split('\n')[0].trim();
    const line = FIRST_LINE.exec(firstLine);
    if (!/^coven:/i.test(firstLine)) return null;
    const base = { commentId: comment.id, author: comment.author, createdAt: comment.createdAt };
    const fallbackLease = new Date(timeOf(comment.updatedAt ?? comment.createdAt) + leaseHours * 3600_000).toISOString();
    const marker = MARKER.exec(body);
    if (marker) {
        let data;
        try {
            data = JSON.parse(marker[1]);
        } catch {
            return { ...base, problem: '隐藏标记不是合法的 JSON' };
        }
        if (!CLAIM_STATES.includes(data.state)) return { ...base, problem: `不认识的状态 ${data.state}` };
        const item = data.item ?? defaultItem;
        if (!item) return { ...base, problem: '标记里没有 item' };
        const leaseUntil = data.leaseUntil && !Number.isNaN(timeOf(data.leaseUntil)) ? data.leaseUntil : fallbackLease;
        return {
            ...base,
            state: data.state,
            owner: data.owner ?? comment.author,
            claimId: String(data.claimId ?? `comment-${comment.id}`),
            item,
            action: data.action ?? null,
            scope: data.scope ?? null,
            leaseUntil,
            pr: data.pr ?? null,
            code: data.code ?? null,
            takeover: data.takeover ?? null,
            manual: false,
        };
    }
    if (!line) return { ...base, problem: '首行不是 coven: <状态> @维护者' };
    const mentions = [...line[2].matchAll(/@([\w-]+)/g)].map(match => match[1]);
    const prMatch = /PR #(\d+)/.exec(line[2]);
    const state = line[1].toLowerCase();
    const item = defaultItem ?? (itemPattern ? itemPattern.exec(line[2])?.[0] : null) ?? BACKTICKED.exec(line[2])?.[1] ?? null;
    if (!item) return { ...base, problem: '手写的认领没写条目' };
    return {
        ...base,
        state,
        // handed-off 写成 @甲 → @乙，接手的是最后一个
        owner: (state === 'handed-off' ? mentions.at(-1) : mentions[0]) ?? comment.author,
        claimId: `comment-${comment.id}`,
        item,
        action: null,
        scope: null,
        leaseUntil: fallbackLease,
        pr: prMatch ? Number(prMatch[1]) : null,
        code: /\((D\d{3})\)/.exec(line[2])?.[1] ?? null,
        takeover: null,
        manual: true,
    };
}

/** 先按评论创建时间，同一秒的按评论 id（GitHub 的评论 id 递增；干跑的模拟评论排在真评论后面）。 */
function compareComments(a, b) {
    const byTime = timeOf(a.createdAt) - timeOf(b.createdAt);
    if (byTime !== 0) return byTime;
    const numberA = typeof a.id === 'number' ? a.id : Number.POSITIVE_INFINITY;
    const numberB = typeof b.id === 'number' ? b.id : Number.POSITIVE_INFINITY;
    return numberA !== numberB ? numberA - numberB : String(a.id).localeCompare(String(b.id));
}

/**
 * 认领判定（纯函数）：输入一个 issue 上的全部评论，输出每个条目归谁。
 * - 只认维护者的评论，别人发的 `coven:` 评论记进 ignored（D831）。
 * - 有 done 的条目算完成。
 * - 被别的认领在 takeover 里点名接手的，视为让出（过期后又续租也不算数）。
 * - 租约内的有效认领里，评论创建得最早的持有条目，其余记进 conflicts（D830）。
 * - 租约过期的记进 expired（D832），条目算空闲。
 * @param {Array<{ id: number|string, author: string, association: string, createdAt: string, updatedAt?: string, body: string }>} comments
 * @param {{ now: number|string, leaseHours: number, defaultItem?: string|null, itemPattern?: RegExp|null }} options
 * @returns {{ items: Map<string, ClaimResolution>, ignored: Array<{ code: string|null, commentId: number|string, author: string, reason: string }> }}
 */
export function resolveClaims(comments, { now, leaseHours, defaultItem = null, itemPattern = null }) {
    const nowMs = typeof now === 'number' ? now : timeOf(now);
    const ignored = [];
    /** @type {Claim[]} */
    const claims = [];
    for (const comment of [...comments].sort(compareComments)) {
        const claim = parseClaimComment(comment, { leaseHours, defaultItem, itemPattern });
        if (!claim) continue;
        if (!MAINTAINER_ASSOCIATIONS.has(String(comment.association).toUpperCase())) {
            ignored.push({ code: 'D831', commentId: comment.id, author: comment.author, reason: '不是维护者发的 coven: 评论' });
            continue;
        }
        if ('problem' in claim) {
            ignored.push({ code: null, commentId: comment.id, author: comment.author, reason: claim.problem });
            continue;
        }
        claims.push(claim);
    }
    const superseded = new Set(claims.filter(claim => claim.state !== 'released' && claim.takeover?.claimId).map(claim => `${claim.item}\u0000${claim.takeover.claimId}`));
    const byItem = new Map();
    for (const claim of claims) {
        if (!byItem.has(claim.item)) byItem.set(claim.item, []);
        byItem.get(claim.item).push(claim);
    }
    const items = new Map();
    for (const [item, list] of byItem) {
        const done = list.find(claim => claim.state === 'done');
        if (done) {
            items.set(item, { item, status: 'done', holder: done, conflicts: [], expired: [] });
            continue;
        }
        const active = list.filter(claim => ACTIVE_STATES.has(claim.state) && !superseded.has(`${item}\u0000${claim.claimId}`));
        const live = active.filter(claim => timeOf(claim.leaseUntil) > nowMs);
        const expired = active.filter(claim => timeOf(claim.leaseUntil) <= nowMs);
        const [holder = null, ...conflicts] = live;
        items.set(item, { item, status: holder ? 'held' : 'free', holder, conflicts, expired });
    }
    return { items, ignored };
}

export const resolutionOf = (resolved, item) => resolved.items.get(item) ?? { item, status: 'free', holder: null, conflicts: [], expired: [] };

function formatLease(iso, { timeZone, timeZoneLabel }) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(iso)).map(part => [part.type, part.value]));
    return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}（${timeZoneLabel}）`;
}

/**
 * 认领评论的正文：一行给人看的，加一个给脚本读的隐藏标记。只写账号、代号（作品号，分进任务后是任务号）、动作、条目、范围名、租约，
 * 不写本机路径、主机名、session id、花费。
 */
export function renderClaimComment(claim, config) {
    const action = ACTION_LABELS[claim.action] ?? claim.action ?? '';
    const catalogue = catalogueLabel(claim);
    const subject = `${catalogue ? `${catalogue} · ` : ''}${action} \`${claim.item}\``.trim();
    const lease = `租约至 ${formatLease(claim.leaseUntil, config)}`;
    const takeover = claim.takeover ? ` · 接手 @${claim.takeover.owner} 的过期认领` : '';
    const head = {
        claimed: `coven: claimed @${claim.owner} · ${subject} · ${lease}${takeover}`,
        working: `coven: working @${claim.owner} (${prLabel(claim.pr)}) · ${subject} · ${lease}`,
        blocked: `coven: blocked @${claim.owner} (${claim.code}) · ${subject} · ${lease}`,
        'handed-off': `coven: handed-off @${claim.from} → @${claim.owner} · ${subject} · ${lease}`,
        released: `coven: released @${claim.owner} · ${subject}`,
        done: `coven: done @${claim.owner} · ${subject}${claim.pr ? ` (${prLabel(claim.pr)})` : ''}`,
    }[claim.state];
    if (!head) throw new Error(`不认识的认领状态 ${claim.state}`);
    const marker = {
        state: claim.state, owner: claim.owner, claimId: claim.claimId, item: claim.item, action: claim.action ?? null,
        scope: claim.scope ?? null, ...(claim.run ? { run: claim.run } : {}), ...(claim.task ? { task: claim.task } : {}), leaseUntil: claim.leaseUntil,
        ...(claim.pr ? { pr: claim.pr } : {}), ...(claim.code ? { code: claim.code } : {}),
        ...(claim.from ? { from: claim.from } : {}), ...(claim.takeover ? { takeover: claim.takeover } : {}),
    };
    return `${head}\n<!-- coven:v1 ${JSON.stringify(marker)} -->`;
}

// ---- 读写 GitHub（真跑走 gh，干跑记在状态文件里） ----

const COMMENT_JQ = '.[] | {id, author: .user.login, association: .author_association, createdAt: .created_at, updatedAt: .updated_at, body}';

/** 评论的读写接口。干跑时写只进 state.dryComments，读是“真评论（如果有跟踪 issue）+ 模拟评论”。 */
export function githubIo(state, config, { dryRun, readRemote = true, persist = () => {} }) {
    // 每写一次 GitHub 就落盘：中途出错时，已经发出去的评论在状态文件里有记录，重跑能认回来
    const log = (entry) => {
        state.github.push({ at: nowIso(), dryRun, ...entry });
        persist();
    };
    return {
        dryRun,
        persist,
        list(issue) {
            const remote = readRemote && issue ? ghApiLines(`repos/${config.repo}/issues/${issue}/comments`, COMMENT_JQ) : [];
            return [...remote, ...state.dryComments.filter(comment => comment.issue === issue)];
        },
        create(issue, body) {
            if (dryRun) {
                const at = nowIso();
                const comment = { id: `dry-${state.dryComments.length + 1}`, issue, author: state.owner, association: 'OWNER', createdAt: at, updatedAt: at, body };
                state.dryComments.push(comment);
                log({ action: 'comment.create', issue, commentId: comment.id });
                return comment;
            }
            const created = JSON.parse(gh(['api', '-X', 'POST', `repos/${config.repo}/issues/${issue}/comments`, '-f', `body=${body}`]));
            log({ action: 'comment.create', issue, commentId: created.id, url: created.html_url });
            return { id: created.id, createdAt: created.created_at };
        },
        edit(issue, commentId, body) {
            if (dryRun) {
                const comment = state.dryComments.find(entry => entry.id === commentId);
                if (comment) Object.assign(comment, { body, updatedAt: nowIso() });
            } else {
                gh(['api', '-X', 'PATCH', `repos/${config.repo}/issues/comments/${commentId}`, '-f', `body=${body}`]);
            }
            log({ action: 'comment.edit', issue, commentId });
        },
    };
}

/** 条目的认领评论发在哪：issue / PR 条目发在它自己那里，基线和 lint 条目发在跟踪 issue 上。 */
export function claimTargetOf(item, state) {
    const own = /^(?:issue|pr):(\d+)$/.exec(item);
    return own ? Number(own[1]) : state.trackingIssue;
}

const leaseFrom = (nowMs, hours) => new Date(nowMs + hours * 3600_000).toISOString();

/**
 * 认领一批条目：读一次 → 空闲的逐条发认领 → 再读一次 → 输掉的（更早的有效认领出现了）编辑成 released。
 * 已经是自己（同一个 claimId）持有的跳过；别人持有的、已完成的记进 skipped。
 * @returns {{ won: string[], skipped: Array<{ item: string, reason: string, holder?: object }> }}
 */
export function claimItems({ keys, state, config, io, now = Date.now(), itemPattern = null }) {
    const won = [];
    const skipped = [];
    const posted = [];
    const byIssue = groupByTarget(keys, state, io.dryRun);
    for (const [issue, itemKeys] of byIssue) {
        const before = resolveClaims(io.list(issue), { now, leaseHours: config.leaseHours, defaultItem: defaultItemOf(issue, itemKeys), itemPattern });
        for (const key of itemKeys) {
            const mine = state.items[key];
            const resolution = resolutionOf(before, key);
            if (resolution.status === 'done') {
                skipped.push({ item: key, reason: '已完成', holder: resolution.holder });
                continue;
            }
            if (resolution.status === 'held') {
                if (mine?.claimId && resolution.holder.claimId === mine.claimId) {
                    // 上次发出评论后没来得及记下评论 id（中途出错）：按 claimId 认回来
                    if (!mine.commentId) Object.assign(mine, { commentId: resolution.holder.commentId, issue, claim: { state: resolution.holder.state } });
                    won.push(key);
                } else skipped.push({ item: key, reason: `@${resolution.holder.owner} 持有到 ${resolution.holder.leaseUntil}`, holder: resolution.holder });
                continue;
            }
            const expired = resolution.expired[0];
            const claim = {
                state: 'claimed', owner: state.owner, claimId: newClaimId(), item: key, action: mine?.action ?? 'refactor', scope: state.scope, run: state.run, task: mine?.task ?? null,
                leaseUntil: leaseFrom(now, config.leaseHours),
                ...(expired ? { takeover: { owner: expired.owner, claimId: expired.claimId } } : {}),
            };
            // 先把 claimId 落盘再发评论：发出去之后出错，重跑时能按 claimId 认回这条评论，不会留下占 12 小时的孤儿认领
            // 发出去之前记成 pending：评论真没发出去的话，规划、导入、续租都不会把它当成已认领
            state.items[key] = { ...mine, claimId: claim.claimId, commentId: null, issue, claim: { state: 'pending' }, takeover: claim.takeover ?? null };
            io.persist?.();
            const comment = io.create(issue, renderClaimComment(claim, config));
            state.items[key].commentId = comment.id;
            state.items[key].claim = { state: 'claimed' };
            posted.push({ issue, key, claim });
        }
    }
    // 再读一次：两边同时认领时，评论创建得早的赢
    for (const [issue, entries] of groupPosted(posted)) {
        const after = resolveClaims(io.list(issue), { now, leaseHours: config.leaseHours, defaultItem: defaultItemOf(issue, entries.map(entry => entry.key)), itemPattern });
        for (const { key, claim } of entries) {
            const holder = resolutionOf(after, key).holder;
            if (holder?.claimId === claim.claimId) {
                won.push(key);
                continue;
            }
            io.edit(issue, state.items[key].commentId, renderClaimComment({ ...claim, state: 'released' }, config));
            state.items[key].claim = { state: 'released' };
            skipped.push({ item: key, reason: holder ? `D830：@${holder.owner} 的认领更早，已让出` : 'D830：再读时没看到自己的认领，已让出', holder });
        }
    }
    return { won, skipped };
}

function groupByTarget(keys, state, dryRun) {
    const groups = new Map();
    for (const key of keys) {
        const issue = claimTargetOf(key, state);
        if (!issue && !dryRun) throw new Error('配置里没有 trackingIssue：不属于某个 issue 或 PR 的条目，认领要发在跟踪 issue 上');
        if (!groups.has(issue)) groups.set(issue, []);
        groups.get(issue).push(key);
    }
    return groups;
}

function groupPosted(posted) {
    const groups = new Map();
    for (const entry of posted) {
        if (!groups.has(entry.issue)) groups.set(entry.issue, []);
        groups.get(entry.issue).push(entry);
    }
    return groups;
}

/** issue / PR 条目上手写的认领不用写条目；跟踪 issue 上的要写。 */
const defaultItemOf = (issue, keys) => (keys.length === 1 && /^(?:issue|pr):/.test(keys[0]) ? keys[0] : null);

/**
 * 改自己的认领：续租（state 不变、租约往后推）或换状态（working / blocked / done / released）。
 * 改之前先判定一次：条目已经不归自己（被接手、被更早的认领占了）就不改，记进 lost。
 * 只续租、不换状态时，一小时内续过（或改过状态）的不再改评论，记进 fresh：监控 session 每次被唤醒都续租，
 * 每次都编辑的话，评论的编辑历史和审计日志全是噪音（Op. 1：33 分钟编辑了 9 次，5 次只是续租，最近两次只隔 16 秒）。
 * 只跳过刚续过的，续租之后租约总还剩 leaseHours 减一小时以上：监控 session 等维护者一晚上，认领也不会提前过期。
 * @returns {{ updated: string[], lost: Array<{ item: string, holder: Claim|null }>, fresh: string[] }}
 */
export function updateClaims({ keys, state, config, io, change = {}, now = Date.now(), itemPattern = null }) {
    const updated = [];
    const lost = [];
    const fresh = [];
    const renewOnly = Object.keys(change).length === 0;
    const leaseMs = config.leaseHours * 3600_000;
    const freshAbove = leaseMs - Math.min(3600_000, leaseMs / 2);
    const relevant = keys.filter(key => state.items[key]?.commentId && ACTIVE_STATES.has(state.items[key].claim?.state));
    for (const [issue, itemKeys] of groupByTarget(relevant, state, io.dryRun)) {
        const resolved = resolveClaims(io.list(issue), { now, leaseHours: config.leaseHours, defaultItem: defaultItemOf(issue, itemKeys), itemPattern });
        const revived = [];
        for (const key of itemKeys) {
            const mine = state.items[key];
            const resolution = resolutionOf(resolved, key);
            const holder = resolution.holder;
            // 自己的租约过期了、也没人接手（监控 session 停了一晚）：原地续上，不另发一条评论
            const ownExpired = !holder && resolution.expired.some(claim => claim.claimId === mine.claimId);
            if (holder?.claimId !== mine.claimId && !ownExpired) {
                lost.push({ item: key, holder });
                continue;
            }
            if (renewOnly && holder && timeOf(holder.leaseUntil) - now > freshAbove) {
                fresh.push(key);
                continue;
            }
            const next = { ...mine.claim, ...change };
            if (ownExpired && ACTIVE_STATES.has(next.state)) revived.push(key);
            const claim = {
                state: next.state, owner: state.owner, claimId: mine.claimId, item: key, action: mine.action ?? 'refactor', scope: state.scope, run: state.run, task: mine.task ?? null,
                leaseUntil: leaseFrom(now, config.leaseHours), pr: next.pr ?? null, code: next.state === 'blocked' ? next.code : null,
                ...(mine.takeover ? { takeover: mine.takeover } : {}),
            };
            io.edit(issue, mine.commentId, renderClaimComment(claim, config));
            mine.claim = { state: claim.state, ...(claim.pr ? { pr: claim.pr } : {}), ...(claim.code ? { code: claim.code } : {}) };
            updated.push(key);
        }
        if (revived.length === 0) continue;
        // 续上之后再读一次：同一时间有人点名接手了它，就让出
        const after = resolveClaims(io.list(issue), { now, leaseHours: config.leaseHours, defaultItem: defaultItemOf(issue, itemKeys), itemPattern });
        for (const key of revived) {
            const mine = state.items[key];
            const holder = resolutionOf(after, key).holder;
            if (holder?.claimId === mine.claimId) continue;
            const claim = { state: 'released', owner: state.owner, claimId: mine.claimId, item: key, action: mine.action ?? 'refactor', scope: state.scope, run: state.run, task: mine.task ?? null, leaseUntil: leaseFrom(now, config.leaseHours) };
            io.edit(issue, mine.commentId, renderClaimComment(claim, config));
            mine.claim = { state: 'released' };
            updated.splice(updated.indexOf(key), 1);
            lost.push({ item: key, holder });
        }
    }
    return { updated, lost, fresh };
}

/**
 * 这些条目里，现在不归这个监控 session（claimId）持有的。开 PR、推送之前先查。
 * @returns {Array<{ item: string, holder: Claim|null }>}
 */
export function unheldItems({ keys, state, config, io, now = Date.now(), itemPattern = null }) {
    const result = [];
    for (const [issue, itemKeys] of groupByTarget(keys, state, io.dryRun)) {
        const resolved = resolveClaims(io.list(issue), { now, leaseHours: config.leaseHours, defaultItem: defaultItemOf(issue, itemKeys), itemPattern });
        for (const key of itemKeys) {
            const holder = resolutionOf(resolved, key).holder;
            if (!state.items[key]?.claimId || holder?.claimId !== state.items[key].claimId) result.push({ item: key, holder });
        }
    }
    return result;
}

/** 一个任务（planner 分的组）包含的条目。 */
export const keysOfTask = (state, task) => Object.keys(state.items).filter(key => state.items[key].task === task);

// ---- 命令行 ----

function printStatus(state, config, io, itemPattern) {
    const keys = Object.keys(state.items);
    for (const [issue, itemKeys] of groupByTarget(keys, state, io.dryRun)) {
        const resolved = resolveClaims(io.list(issue), { now: Date.now(), leaseHours: config.leaseHours, defaultItem: defaultItemOf(issue, itemKeys), itemPattern });
        for (const note of resolved.ignored) console.log(`  忽略评论 ${note.commentId}（@${note.author}）：${note.code ? `${note.code} ` : ''}${note.reason}`);
        for (const key of itemKeys) {
            const resolution = resolutionOf(resolved, key);
            const holder = resolution.holder;
            const mine = holder && holder.claimId === state.items[key].claimId ? '（我）' : '';
            const who = holder ? `@${holder.owner}${mine} ${holder.state}${holder.pr ? ` ${prLabel(holder.pr)}` : ''}，租约至 ${formatLease(holder.leaseUntil, config)}` : '';
            console.log(`${resolution.status.padEnd(5)} ${key} ${who}`);
            for (const conflict of resolution.conflicts) console.log(`      D830 冲突：@${conflict.owner}（${conflict.claimId}）`);
            for (const expired of resolution.expired) console.log(`      D832 过期：@${expired.owner}（${expired.claimId}）`);
        }
    }
}

export async function run(host, argv) {
    const { root, config, adapter } = host;
    const itemPattern = adapter.itemKeyPattern ?? null;
    const { positional, options } = parseArgs(argv, ['dry-run'], ['items', 'task', 'state', 'pr', 'code']);
    const command = positional[0];
    const state = requireSupervisor(root);
    const dryRun = Boolean(options['dry-run']) || isDryRun(state, config);
    const io = githubIo(state, config, { dryRun, readRemote: Boolean(state.trackingIssue), persist: () => saveState(root, state) });
    const scope = readJson(covenPath(root, 'scopes', `${state.scope}.json`));
    const scopeKeys = scope.items.map(item => item.key);
    if (command === 'status') {
        printStatus(state, config, io, itemPattern);
        return;
    }
    if (command === 'claim') {
        const keys = options.items ? splitList(options.items) : scopeKeys;
        const unknown = keys.filter(key => !scopeKeys.includes(key));
        if (unknown.length > 0) throw new Error(`这些条目不在范围 ${state.scope} 里：${unknown.join('，')}`);
        for (const key of keys) state.items[key] ??= { action: scope.items.find(item => item.key === key).action, risk: scope.items.find(item => item.key === key).risk };
        const { won, skipped } = claimItems({ keys, state, config, io, itemPattern });
        saveState(root, state);
        console.log(`${dryRun ? '[干跑] ' : ''}认领到 ${won.length} 条，跳过 ${skipped.length} 条。`);
        for (const entry of skipped) console.log(`  跳过 ${entry.item}：${entry.reason}`);
        return;
    }
    const pick = () => (options.task ? keysOfTask(state, options.task) : options.items ? splitList(options.items) : Object.keys(state.items));
    if (command === 'set' && !options.task && !options.items) throw new Error('set 要写明改哪些：--task <任务> 或 --items <条目,…>');
    if (command === 'renew' || command === 'release' || command === 'set') {
        const change = command === 'release' ? { state: 'released' }
            : command === 'set' ? { state: options.state, ...(options.pr ? { pr: Number(options.pr) } : {}), ...(options.code ? { code: options.code } : {}) }
                : {};
        if (command === 'set' && !SETTABLE_STATES.includes(change.state)) throw new Error(`--state 只能是 ${SETTABLE_STATES.join('、')}`);
        if (change.state === 'blocked' && !change.code) throw new Error('blocked 要带 --code（D810–D813 等）');
        if (change.state === 'working' && !change.pr) throw new Error('working 要带 --pr');
        const { updated, lost, fresh } = updateClaims({ keys: pick(), state, config, io, change, itemPattern });
        saveState(root, state);
        console.log(`${dryRun ? '[干跑] ' : ''}改了 ${updated.length} 条认领${fresh.length > 0 ? `；${fresh.length} 条一小时内续过，没动评论` : ''}。`);
        for (const entry of lost) console.log(`  D830 ${entry.item} 已经不归这个监控 session：${entry.holder ? `@${entry.holder.owner} 持有` : '没有有效认领'}。停掉这条的工作，告诉维护者。`);
        return;
    }
    throw new Error(`用法：\n${usage()}`);
}
