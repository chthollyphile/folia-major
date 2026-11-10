import { describe, expect, it } from 'vitest';
import { claimItems, parseClaimComment, renderClaimComment, resolveClaims, unheldItems, updateClaims } from '../src/claim.mjs';
import { HelpRequested, parseArgs } from '../src/common.mjs';

// packages/coven/test/claim.test.mjs
// coven: 认领协议的判定（plan/coven-semi-auto-plan.md 第 4 节）：只认维护者、先到先得、租约过期可接手、
// 按 claimId 区分（同一位维护者的两个监控 session 也不撞车）、接手之后原认领续租也不算数。

const config = { leaseHours: 12, timeZone: 'Asia/Shanghai', timeZoneLabel: 'UTC+8', repo: 'o/r' };
const NOW = Date.parse('2026-11-09T04:00:00Z');
const ITEM = 'D102:src/utils/lyrics/lyricMatchSources.ts->src/stores/useOnlineProviderAccountStore.ts';

let nextId = 100;
function comment(claim, { at = '2026-11-09T03:00:00Z', author = String(claim.owner ?? 'alice'), association = 'OWNER', id = nextId++ } = {}) {
    const body = renderClaimComment({ state: 'claimed', action: 'refactor', scope: 'arch', item: ITEM, leaseUntil: '2026-11-09T15:00:00Z', ...claim }, config);
    return { id, author, association, createdAt: at, updatedAt: at, body };
}
const resolve = comments => resolveClaims(comments, { now: NOW, leaseHours: 12 }).items.get(ITEM);

describe('coven claim resolution', () => {
    it('gives the item to the earliest live claim and reports the later one as a conflict (D830)', () => {
        const late = comment({ owner: 'bob', claimId: 'b1' }, { at: '2026-11-09T03:00:05Z' });
        const early = comment({ owner: 'alice', claimId: 'a1' }, { at: '2026-11-09T03:00:01Z' });
        const resolution = resolve([late, early]);
        expect(resolution?.status).toBe('held');
        expect(resolution?.holder?.claimId).toBe('a1');
        expect(resolution?.conflicts.map(claim => claim.claimId)).toEqual(['b1']);
    });

    it('breaks a same-second tie by comment id', () => {
        const first = comment({ owner: 'bob', claimId: 'b1' }, { id: 7 });
        const second = comment({ owner: 'alice', claimId: 'a1' }, { id: 8 });
        expect(resolve([second, first])?.holder?.claimId).toBe('b1');
    });

    it('keeps two supervisor sessions of the same maintainer apart by claimId', () => {
        const one = comment({ owner: 'alice', claimId: 'session-1' }, { at: '2026-11-09T03:00:01Z' });
        const two = comment({ owner: 'alice', claimId: 'session-2' }, { at: '2026-11-09T03:00:02Z' });
        const resolution = resolve([one, two]);
        expect(resolution?.holder?.claimId).toBe('session-1');
        expect(resolution?.conflicts.map(claim => claim.claimId)).toEqual(['session-2']);
    });

    it('ignores coven: comments from people who are not maintainers (D831)', () => {
        const forged = comment({ owner: 'mallory', claimId: 'm1' }, { association: 'NONE', at: '2026-11-09T02:00:00Z' });
        const real = comment({ owner: 'alice', claimId: 'a1' });
        const resolved = resolveClaims([forged, real], { now: NOW, leaseHours: 12 });
        expect(resolved.items.get(ITEM)?.holder?.claimId).toBe('a1');
        expect(resolved.ignored).toEqual([expect.objectContaining({ code: 'D831', author: 'mallory' })]);
    });

    it('frees an item whose lease ran out (D832), and a later renewal does not beat the takeover', () => {
        const stale = comment({ owner: 'bob', claimId: 'b1', leaseUntil: '2026-11-09T01:00:00Z' }, { at: '2026-11-08T13:00:00Z' });
        expect(resolve([stale])?.status).toBe('free');
        expect(resolve([stale])?.expired.map(claim => claim.claimId)).toEqual(['b1']);

        const takeover = comment({ owner: 'alice', claimId: 'a1', takeover: { owner: 'bob', claimId: 'b1' } }, { at: '2026-11-09T02:00:00Z' });
        // bob 的监控 session 醒来续了租：评论更早，但已经被点名接手，不算数
        const renewed = { ...stale, body: renderClaimComment({ state: 'claimed', owner: 'bob', claimId: 'b1', item: ITEM, leaseUntil: '2026-11-09T20:00:00Z' }, config) };
        const resolution = resolve([renewed, takeover]);
        expect(resolution?.holder?.claimId).toBe('a1');
        expect(resolution?.conflicts).toEqual([]);
    });

    it('treats done as final and released as nothing', () => {
        expect(resolve([comment({ claimId: 'a1', state: 'done' }), comment({ owner: 'bob', claimId: 'b1' }, { at: '2026-11-09T03:30:00Z' })])?.status).toBe('done');
        expect(resolve([comment({ claimId: 'a1', state: 'released' })])?.status).toBe('free');
    });

    it('reads a hand-written claim and leases it from its last edit', () => {
        const manual = { id: 5, author: 'carol', association: 'MEMBER', createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T01:00:00Z', body: `coven: claimed @carol · 我手动修 \`${ITEM}\`` };
        const claim = parseClaimComment(manual, { leaseHours: 12 });
        expect(claim).toMatchObject({ state: 'claimed', owner: 'carol', item: ITEM, manual: true, leaseUntil: '2026-11-09T13:00:00.000Z' });
        expect(resolve([manual])?.holder?.owner).toBe('carol');
        // 跟踪 issue 上手写的认领没写条目：忽略，不能挡住所有条目
        const bare = { ...manual, id: 7, body: `coven: claimed @carol · ${ITEM}` };
        expect(parseClaimComment(bare, { leaseHours: 12 })).toMatchObject({ problem: '手写的认领没写条目' });
        expect(parseClaimComment(bare, { leaseHours: 12, itemPattern: /D\d{3}:[^\s`·]+/ })).toMatchObject({ item: ITEM });
        const vague = { ...manual, id: 6, body: 'coven: claimed @carol' };
        expect(resolveClaims([vague], { now: NOW, leaseHours: 12 }).ignored).toEqual([expect.objectContaining({ reason: '手写的认领没写条目' })]);
    });

    it('renders a short first line and a marker the parser reads back', () => {
        const body = renderClaimComment({ state: 'working', owner: 'alice', claimId: 'a1', item: ITEM, action: 'refactor', scope: 'arch', leaseUntil: '2026-11-09T14:00:00Z', pr: 1200 }, config);
        expect(body.split('\n')[0]).toBe(`coven: working @alice (PR #1200) · 重构 \`${ITEM}\` · 租约至 11-09 22:00（UTC+8）`);
        expect(parseClaimComment({ id: 1, author: 'alice', association: 'OWNER', createdAt: '2026-11-09T03:00:00Z', body }, { leaseHours: 12 })).toMatchObject({ state: 'working', pr: 1200, claimId: 'a1' });
        // 带上代号：认领时是作品号，分进任务后是任务号
        const claimed = renderClaimComment({ state: 'claimed', owner: 'alice', claimId: 'a1', item: ITEM, action: 'refactor', run: 'op3', leaseUntil: '2026-11-09T14:00:00Z' }, config);
        expect(claimed.split('\n')[0]).toBe(`coven: claimed @alice · Op. 3 · 重构 \`${ITEM}\` · 租约至 11-09 22:00（UTC+8）`);
        const assigned = renderClaimComment({ state: 'working', owner: 'alice', claimId: 'a1', item: ITEM, action: 'refactor', run: 'op3', task: 'op3-no2', pr: 1200, leaseUntil: '2026-11-09T14:00:00Z' }, config);
        expect(assigned.split('\n')[0]).toBe(`coven: working @alice (PR #1200) · Op. 3 No. 2 · 重构 \`${ITEM}\` · 租约至 11-09 22:00（UTC+8）`);
        expect(parseClaimComment({ id: 2, author: 'alice', association: 'OWNER', createdAt: '2026-11-09T03:00:00Z', body: assigned }, { leaseHours: 12 })).toMatchObject({ item: ITEM, state: 'working' });
        // 干跑的 PR 没有号：首行写“干跑 PR”，不写成像真 PR 的 #dry-…（2026-11-09 云端干跑 WoO 1 的反馈）
        const dry = renderClaimComment({ state: 'working', owner: 'alice', claimId: 'a1', item: ITEM, action: 'refactor', run: 'woo1', task: 'woo1-no1', pr: 'dry-woo1-no1', leaseUntil: '2026-11-09T14:00:00Z' }, config);
        expect(dry.split('\n')[0]).toBe(`coven: working @alice (干跑 PR) · WoO 1 No. 1 · 重构 \`${ITEM}\` · 租约至 11-09 22:00（UTC+8）`);
        expect(parseClaimComment({ id: 3, author: 'alice', association: 'OWNER', createdAt: '2026-11-09T03:00:00Z', body: dry }, { leaseHours: 12 })).toMatchObject({ pr: 'dry-woo1-no1' });
    });
});

/** 内存里的跟踪 issue：评论按发出的顺序编号、带时间。 */
function fakeIssue(initial = []) {
    const comments = [...initial];
    let id = 1000;
    return {
        comments,
        dryRun: false,
        list: () => comments,
        create(_issue, body) {
            const created = { id: id++, author: 'alice', association: 'OWNER', createdAt: '2026-11-09T04:00:00Z', updatedAt: '2026-11-09T04:00:00Z', body };
            comments.push(created);
            return created;
        },
        edit(_issue, commentId, body) {
            const target = comments.find(entry => entry.id === commentId);
            if (target) target.body = body;
        },
    };
}

const freshState = () => ({ owner: 'alice', scope: 'arch', trackingIssue: 42, dryRun: false, items: {} });

describe('coven claim flow', () => {
    it('claims a free item, skips one held by someone else, and keeps its own claim on resume', () => {
        const other = 'D190:src/a.ts->src/components/b.ts';
        const held = comment({ owner: 'bob', claimId: 'b1', item: other }, { at: '2026-11-09T03:00:00Z' });
        const issue = fakeIssue([held]);
        const state = freshState();
        const result = claimItems({ keys: [ITEM, other], state, config, io: issue, now: NOW });
        expect(result.won).toEqual([ITEM]);
        expect(result.skipped).toEqual([expect.objectContaining({ item: other })]);
        expect(issue.comments).toHaveLength(2);
        // 监控 session 重启后再认领一次：已经是自己的，不再发评论
        const again = claimItems({ keys: [ITEM], state, config, io: issue, now: NOW });
        expect(again.won).toEqual([ITEM]);
        expect(issue.comments).toHaveLength(2);
    });

    it('backs off when an earlier claim shows up on the second read (D830)', () => {
        const issue = fakeIssue();
        const rival = comment({ owner: 'bob', claimId: 'b1' }, { at: '2026-11-09T03:59:59Z', id: 1 });
        // 第一次读时还看不到 bob 的评论（同时认领），发完再读才出现
        let reads = 0;
        const io = { ...issue, list: () => (reads++ === 0 ? issue.comments : [rival, ...issue.comments]) };
        const state = freshState();
        const result = claimItems({ keys: [ITEM], state, config, io, now: NOW });
        expect(result.won).toEqual([]);
        expect(result.skipped[0].reason).toContain('D830');
        expect(issue.comments[0].body).toMatch(/^coven: released @alice/);
        expect(state.items[ITEM].claim.state).toBe('released');
    });

    it('renews and changes state only while the claim is still its own', () => {
        const issue = fakeIssue();
        const state = freshState();
        claimItems({ keys: [ITEM], state, config, io: issue, now: NOW });
        const blocked = updateClaims({ keys: [ITEM], state, config, io: issue, change: { state: 'blocked', code: 'D811' }, now: NOW + 3600_000 });
        expect(blocked.updated).toEqual([ITEM]);
        expect(issue.comments[0].body).toMatch(/^coven: blocked @alice \(D811\)/);
        // 被别人点名接手之后（比如租约过期了），不再改它
        issue.comments.push(comment({ owner: 'bob', claimId: 'b1', takeover: { owner: 'alice', claimId: state.items[ITEM].claimId } }, { at: '2026-11-09T05:00:00Z' }));
        const renewed = updateClaims({ keys: [ITEM], state, config, io: issue, now: NOW + 2 * 3600_000 });
        expect(renewed.updated).toEqual([]);
        expect(renewed.lost).toEqual([expect.objectContaining({ item: ITEM })]);
    });
});

describe('coven claim recovery', () => {
    it('saves the claimId before posting, so a failure after posting leaves no orphan claim', () => {
        const issue = fakeIssue();
        const state = freshState();
        const saved = [];
        const flaky = {
            ...issue,
            persist: () => saved.push(JSON.stringify(state.items[ITEM] ?? null)),
            create(issueNumber, body) {
                issue.create(issueNumber, body);
                throw new Error('gh: 502 Bad Gateway');
            },
        };
        expect(() => claimItems({ keys: [ITEM], state, config, io: flaky, now: NOW })).toThrow('502');
        // 发评论之前已经落盘了 claimId
        expect(JSON.parse(saved[0])).toMatchObject({ claimId: expect.any(String), commentId: null, claim: { state: 'pending' } });
        // 重跑：按 claimId 认回那条评论，不再发新的
        const again = claimItems({ keys: [ITEM], state, config, io: issue, now: NOW });
        expect(again.won).toEqual([ITEM]);
        expect(issue.comments).toHaveLength(1);
        expect(state.items[ITEM].commentId).toBe(issue.comments[0].id);
        expect(state.items[ITEM].claim.state).toBe('claimed');
    });

    it('renews its own lapsed lease in place when nobody took over', () => {
        const issue = fakeIssue();
        const state = freshState();
        claimItems({ keys: [ITEM], state, config, io: issue, now: NOW });
        // 监控 session 停了 13 小时
        const later = NOW + 13 * 3600_000;
        expect(unheldItems({ keys: [ITEM], state, config, io: issue, now: later })).toHaveLength(1);
        const renewed = updateClaims({ keys: [ITEM], state, config, io: issue, now: later });
        expect(renewed).toEqual({ updated: [ITEM], lost: [], fresh: [] });
        expect(issue.comments).toHaveLength(1);
        expect(unheldItems({ keys: [ITEM], state, config, io: issue, now: later })).toEqual([]);
    });

    // Op. 1：33 分钟的运行里评论被编辑了 9 次，5 次只是续租，最近两次只隔 16 秒
    it('leaves the comment alone when it was renewed within the last hour, and keeps the lease near full otherwise', () => {
        const issue = fakeIssue();
        const state = freshState();
        claimItems({ keys: [ITEM], state, config, io: issue, now: NOW });
        const edits = [];
        const io = { ...issue, edit: (...args) => { edits.push(args); issue.edit(...args); } };
        const soon = updateClaims({ keys: [ITEM], state, config, io, now: NOW + 40 * 60_000 });
        expect(soon).toEqual({ updated: [], lost: [], fresh: [ITEM] });
        expect(edits).toEqual([]);
        // 换状态照样编辑（顺带续上租约）
        expect(updateClaims({ keys: [ITEM], state, config, io, change: { state: 'working', pr: 7 }, now: NOW + 50 * 60_000 }).updated).toEqual([ITEM]);
        expect(edits).toHaveLength(1);
        expect(updateClaims({ keys: [ITEM], state, config, io, now: NOW + 70 * 60_000 }).fresh).toEqual([ITEM]);
        // 上次编辑过了一小时多才续：续完租约还剩差不多 12 小时，监控 session 等一晚上也不会过期
        const later = NOW + 50 * 60_000 + 61 * 60_000;
        expect(updateClaims({ keys: [ITEM], state, config, io, now: later }).updated).toEqual([ITEM]);
        expect(edits).toHaveLength(2);
        expect(issue.comments[0].body).toMatch(/^coven: working @alice \(PR #7\)/);
        expect(unheldItems({ keys: [ITEM], state, config, io: issue, now: later + 11 * 3600_000 })).toEqual([]);
    });

    it('does not revive a lapsed claim that someone took over', () => {
        const issue = fakeIssue();
        const state = freshState();
        claimItems({ keys: [ITEM], state, config, io: issue, now: NOW });
        const later = NOW + 13 * 3600_000;
        issue.comments.push(comment({ owner: 'bob', claimId: 'b1', takeover: { owner: 'alice', claimId: state.items[ITEM].claimId }, leaseUntil: new Date(later + 3600_000).toISOString() }, { at: new Date(later - 60_000).toISOString() }));
        const result = updateClaims({ keys: [ITEM], state, config, io: issue, now: later });
        expect(result.updated).toEqual([]);
        expect(result.lost[0].holder?.owner).toBe('bob');
    });
});

describe('coven command line', () => {
    it('rejects an unknown option instead of treating it as "not given"', () => {
        expect(() => parseArgs(['set', '--tasks', 'x'], [], ['task', 'items', 'state'])).toThrow('--tasks');
        expect(parseArgs(['set', '--task', 'x', '--dry-run'], ['dry-run'], ['task'])).toEqual({ positional: ['set'], options: { task: 'x', 'dry-run': true } });
    });

    it('asks for help only where an option can stand, not inside an option value', () => {
        expect(() => parseArgs(['set', '--help'], [], ['task'])).toThrow(HelpRequested);
        expect(() => parseArgs(['-h'], [], [])).toThrow(HelpRequested);
        expect(parseArgs(['hd', 'HD1', '--note', '-h'], [], ['note'])).toEqual({ positional: ['hd', 'HD1'], options: { note: '-h' } });
    });
});
