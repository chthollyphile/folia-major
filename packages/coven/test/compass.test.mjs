import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateAdapter } from '../src/adapter.mjs';
import { renderClaimComment } from '../src/claim.mjs';
import { buildScope, claimsView, createCompassServer, runView } from '../src/compass.mjs';
import { applyPlanImport } from '../src/contract.mjs';
import { applyDecision } from '../src/escalations.mjs';
import { createState } from '../src/state.mjs';
import fixture, { riskRules } from './fixtures/adapter.mjs';

// packages/coven/test/compass.test.mjs
// Coven Compass：页面要的数据（运行、认领、范围）和本机服务本身——只认发给本机的请求、接口要令牌、
// 范围按来源重新列一遍再存、正在跑的范围不能覆盖、不碰 GitHub（认领评论由测试给）。

const adapter = validateAdapter(fixture);
const CONFIG = {
    repo: 'o/r', leaseHours: 12, timeZone: 'UTC', timeZoneLabel: 'UTC', concurrency: 1, maxReviewRounds: 2, trackingIssue: 42, hd0Confirmed: true,
    risk: riskRules, roles: { planner: { model: 'm', effort: 'high' }, generator: { model: 'm', effort: 'high' }, evaluator: { model: 'm', effort: 'high' } },
};

function opState() {
    const state = createState({ run: 'op2', scope: 'fugue-a', owner: 'alice', trackingIssue: 42, dryRun: false, now: '2026-11-09T01:00:00.000Z' });
    state.items['todo:src/a.ts'] = { claimId: 'mine1', commentId: 7, claim: { state: 'claimed' } };
    state.items['todo:style'] = { claimId: 'mine2', commentId: 8, claim: { state: 'blocked', code: 'D812' } };
    applyPlanImport(state, {
        tasks: [{ task: 'op2-no1', title: 'fix-a', items: ['todo:src/a.ts'], risk: 'R2' }],
        escalations: [{ items: ['todo:style'], code: 'D812', question: '改还是不改？', options: ['改', '不改'] }],
    }, '2026-11-09T01:10:00.000Z');
    applyDecision(state, { id: 'e1', outcome: 'hold', by: 'alice', note: '先放着', now: '2026-11-09T01:20:00.000Z' });
    state.tasks['op2-no1'] = { ...state.tasks['op2-no1'], phase: 'pr', rounds: 1, tokens: 1200, pr: 1201, prTitle: 'fix(a): 改好 [Op. 2 No. 1]' };
    state.costs.push({ at: '2026-11-09T01:05:00.000Z', task: null, role: 'planner', tokens: 900, approx: true });
    state.interventions.push({ at: '2026-11-09T01:20:00.000Z', kind: 'HD4', note: '@alice 对 e1（D812）：hold —— 先放着' });
    return state;
}

const claimComment = (claim, id, at = '2026-11-09T01:00:00Z') => ({ id, author: claim.owner, association: 'OWNER', createdAt: at, updatedAt: at, body: renderClaimComment(claim, CONFIG) });

describe('coven compass views', () => {
    it('shows a run with its tasks, escalations, interventions and run-level tokens', () => {
        expect(runView(null, CONFIG)).toBeNull();
        const view = runView(opState(), CONFIG, '2026-11-09T02:00:00.000Z');
        expect(view).toMatchObject({ label: 'Op. 2', scopeLabel: 'Fugue "a"', trackingIssueUrl: 'https://github.com/o/r/issues/42', finishedAt: null });
        expect(view.tasks).toEqual([expect.objectContaining({ id: 'op2-no1', label: 'Op. 2 No. 1 "fix-a"', phase: 'pr', prLabel: 'PR #1201', prUrl: 'https://github.com/o/r/pull/1201', tempo: 'Andante（R2）' })]);
        expect(view.escalations).toEqual([expect.objectContaining({ id: 'e1', open: true, openItems: ['todo:style'], result: '等维护者再看', decision: expect.objectContaining({ outcome: 'hold' }) })]);
        expect(view.totals).toMatchObject({ tokens: 2100, approxTokens: true, overhead: { planner: 900 } });
        expect(view.interventions).toHaveLength(1);
    });

    it('also shows a task that stopped in review, with the evaluator’s question', () => {
        const state = opState();
        Object.assign(state.tasks['op2-no1'], { phase: 'blocked', code: 'D812', lastVerdict: { round: 1, verdict: 'escalate', passes: false, escalation: { code: 'D812', question: '要不要改行为？', options: ['改', '不改'] } } });
        const view = runView(state, CONFIG);
        expect(view.escalations.at(-1)).toMatchObject({ id: null, task: 'op2-no1', code: 'D812', question: '要不要改行为？', options: ['改', '不改'], open: true });
    });

    it('tells which claims belong to this checkout and which are someone else’s', () => {
        const lease = '2026-11-09T13:00:00.000Z';
        const comments = [
            claimComment({ state: 'claimed', owner: 'alice', claimId: 'mine1', item: 'todo:src/a.ts', leaseUntil: lease }, 1),
            claimComment({ state: 'working', owner: 'bob', claimId: 'b1', item: 'todo:src/app/registry.ts', pr: 9, leaseUntil: lease }, 2),
            claimComment({ state: 'done', owner: 'bob', claimId: 'b2', item: 'todo:old', leaseUntil: lease }, 3),
            { id: 4, author: 'mallory', association: 'NONE', createdAt: '2026-11-09T01:00:00Z', body: 'coven: claimed @mallory · `todo:src/a.ts`' },
        ];
        const view = claimsView({ comments, state: opState(), config: CONFIG, itemPattern: adapter.itemKeyPattern, now: Date.parse('2026-11-09T02:00:00Z'), issue: 42 });
        expect(view.items.map(entry => [entry.item, entry.status, entry.holder?.owner ?? null, entry.holder?.mine ?? null])).toEqual([
            ['todo:src/a.ts', 'held', 'alice', true],
            ['todo:src/app/registry.ts', 'held', 'bob', false],
            ['todo:old', 'done', 'bob', false],
        ]);
        expect(view.items[1].holder).toMatchObject({ prLabel: 'PR #9', prUrl: 'https://github.com/o/r/pull/9' });
        expect(view.ignored).toEqual([expect.objectContaining({ code: 'D831', author: 'mallory' })]);
    });

    it('builds a scope by listing the source again, never trusting the item objects from the page', () => {
        const host = { root: os.tmpdir(), config: CONFIG, adapter };
        const scope = buildScope(host, { name: 'etude-x', picks: [{ source: 'todo', options: { tags: ['x'] }, keys: ['todo:style', 'todo:src/a.ts', 'todo:style'] }] }, '2026-11-09T03:00:00.000Z');
        expect(scope.items.map(item => [item.key, item.risk])).toEqual([['todo:style', 'R0'], ['todo:src/a.ts', 'R2']]);
        expect(scope.source).toEqual({ from: ['todo'], compass: [{ source: 'todo', options: { tags: ['x'] } }] });
        // 这组选项列不出来的条目（页面上旧的列表、伪造的 key）整份拒绝
        expect(() => buildScope(host, { name: 'etude-x', picks: [{ source: 'todo', options: { tags: ['x'] }, keys: ['todo:src/app/registry.ts'] }] })).toThrow('列不出来');
        expect(() => buildScope(host, { name: 'Bad Name', picks: [{ source: 'todo', options: {}, keys: ['todo:style'] }] })).toThrow('范围名不合格');
        expect(() => buildScope(host, { name: 'etude-x', picks: [{ source: 'todo', options: { colour: ['x'] }, keys: ['todo:style'] }] })).toThrow('没有选项 colour');
        expect(() => buildScope(host, { name: 'etude-x', picks: [{ source: 'constructor', options: {}, keys: ['x'] }] })).toThrow('没有来源 constructor');
    });
});

describe('coven compass server', () => {
    let root;
    let server;
    let token;
    let base;
    let reads;

    beforeEach(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-compass-'));
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'coven:state': 'node x' } }));
        reads = 0;
        const readComments = ({ issue }) => {
            reads++;
            return [claimComment({ state: 'working', owner: 'bob', claimId: 'b1', item: 'todo:src/app/registry.ts', pr: 9, leaseUntil: '2099-01-01T00:00:00.000Z' }, issue * 10)];
        };
        ({ server, token } = createCompassServer({ root, config: CONFIG, adapter }, { readComments }));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    afterEach(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    });

    const call = (route, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}${route}`, {
        method,
        headers: { 'x-coven-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    /** fetch 改不了 Host：用 http.request 直接发。 */
    const rawGet = (route, headers) => new Promise((resolve, reject) => {
        http.get(`${base}${route}`, { headers }, response => {
            response.resume();
            resolve(response.statusCode);
        }).on('error', reject);
    });

    it('serves the page with its one-time token and a strict content security policy', async () => {
        const response = await fetch(`${base}/`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
        const html = await response.text();
        expect(html).toContain(`content="${token}"`);
        expect(html).not.toContain('%COVEN_TOKEN%');
        expect((await fetch(`${base}/compass.js`)).headers.get('content-type')).toContain('javascript');
    });

    it('refuses requests for another host name, from another origin, or without the token', async () => {
        // DNS 重绑定：网页把自己的域名解析到 127.0.0.1，请求里的 Host 就是那个域名
        expect(await rawGet('/', { host: 'evil.example:80' })).toBe(403);
        expect(await rawGet('/api/overview', { host: `localhost:${server.address().port}`, 'x-coven-token': token })).toBe(200);
        expect((await call('/api/overview', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
        expect((await fetch(`${base}/api/overview`)).status).toBe(403);
        expect((await call('/api/overview', { headers: { 'x-coven-token': 'nope' } })).status).toBe(403);
        expect((await call('/api/../package.json')).status).toBe(404);
        expect((await call('/api/runs/..%2F..%2Fpackage')).status).toBe(400);
        expect((await call('/api/scopes/..%2Fstate')).status).toBe(400);
    });

    it('shows an empty run, lists candidates with hints, and marks who holds them once claims were read', async () => {
        const overview = await (await call('/api/overview')).json();
        expect(overview).toMatchObject({ repo: 'o/r', adapter: 'fixture', run: null, runs: [], scopes: [], commandStyle: 'npm' });
        expect(overview.sources).toEqual([{ name: 'todo', describe: '假的待办列表', options: ['tags'], hasHints: true }]);
        expect(await (await call('/api/hints?source=todo')).json()).toEqual({ hints: { tags: [{ value: 'x', count: 2 }, { value: 'y', count: 1 }] } });
        const before = await (await call('/api/candidates?source=todo&tags=y')).json();
        expect(before.items).toEqual([expect.objectContaining({ key: 'todo:src/app/registry.ts', risk: 'R3', claim: null })]);
        const claims = await (await call('/api/claims')).json();
        expect(claims).toMatchObject({ available: true, issue: 42, items: [expect.objectContaining({ item: 'todo:src/app/registry.ts', status: 'held' })] });
        // 30 秒内再读用缓存，refresh=1 才重读
        await call('/api/claims');
        expect(reads).toBe(1);
        await call('/api/claims?refresh=1');
        expect(reads).toBe(2);
        const after = await (await call('/api/candidates?source=todo&tags=y')).json();
        expect(after.items[0].claim).toEqual({ status: 'held', owner: 'bob', state: 'working', mine: false });
        expect((await call('/api/candidates?source=nope')).status).toBe(400);
    });

    it('saves a scope only under .coven/scopes, asks before overwriting, and never overwrites the scope of a running run', async () => {
        const picks = [{ source: 'todo', options: { tags: ['x'] }, keys: ['todo:src/a.ts'] }];
        const saved = await call('/api/scopes', { method: 'POST', body: { name: 'etude-x', picks } });
        expect(await saved.json()).toEqual({ file: '.coven/scopes/etude-x.json', name: 'etude-x', count: 1 });
        const file = path.join(root, '.coven', 'scopes', 'etude-x.json');
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).items[0]).toMatchObject({ key: 'todo:src/a.ts', risk: 'R2', action: 'refactor' });
        const again = await call('/api/scopes', { method: 'POST', body: { name: 'etude-x', picks } });
        expect(again.status).toBe(409);
        expect(await again.json()).toMatchObject({ exists: true });
        expect((await call('/api/scopes', { method: 'POST', body: { name: 'etude-x', picks, overwrite: true } })).status).toBe(200);
        // 正在跑的运行用的就是这个范围：不能覆盖
        fs.writeFileSync(path.join(root, '.coven', 'state.json'), JSON.stringify(createState({ run: 'woo1', scope: 'etude-x', owner: 'alice', trackingIssue: null, dryRun: true })));
        const running = await call('/api/scopes', { method: 'POST', body: { name: 'etude-x', picks, overwrite: true } });
        expect(running.status).toBe(409);
        expect((await running.json()).error).toContain('正在跑的 WoO 1');
        // 要 JSON、要令牌
        expect((await call('/api/scopes', { method: 'POST', body: { name: 'etude-y', picks }, headers: { 'x-coven-token': 'nope' } })).status).toBe(403);
        expect((await fetch(`${base}/api/scopes`, { method: 'POST', headers: { 'x-coven-token': token, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
        expect(fs.readdirSync(path.join(root, '.coven', 'scopes'))).toEqual(['etude-x.json']);
        const overview = await (await call('/api/overview')).json();
        expect(overview.run).toMatchObject({ label: 'WoO 1', dryRun: true });
        expect(overview.scopes).toEqual([expect.objectContaining({ name: 'etude-x', count: 1 })]);
        expect(await (await call('/api/scopes/etude-x')).json()).toMatchObject({ name: 'etude-x' });
    });

    // 第一轮审查找到的错误路径：都该是 4xx，不该是 500，也不该让页面打不开
    it('answers bad input with 4xx and keeps working when the ledger is broken', async () => {
        const port = server.address().port;
        // 字符数一样、字节数不一样的令牌（非 ASCII）
        expect(await rawGet('/api/overview', { host: `127.0.0.1:${port}`, 'x-coven-token': `é${token.slice(1)}` })).toBe(403);
        expect((await call('/api/runs/%E0%A4%A')).status).toBe(400);
        expect((await call('/api/scopes', { method: 'POST', body: null })).status).toBe(400);
        const huge = await fetch(`${base}/api/scopes`, { method: 'POST', headers: { 'x-coven-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 10) }) });
        expect(huge.status).toBe(413);
        // 账本写坏了：页面照样能开，运行一栏写原因；新名字照存，覆盖已有的不行（确认不了是不是正在用）
        fs.mkdirSync(path.join(root, '.coven'), { recursive: true });
        fs.writeFileSync(path.join(root, '.coven', 'state.json'), '{ broken');
        const overview = await call('/api/overview');
        expect(overview.status).toBe(200);
        expect((await overview.json()).run).toEqual({ error: expect.any(String) });
        const picks = [{ source: 'todo', options: {}, keys: ['todo:src/a.ts'] }];
        expect((await call('/api/scopes', { method: 'POST', body: { name: 'etude-new', picks } })).status).toBe(200);
        const overwrite = await call('/api/scopes', { method: 'POST', body: { name: 'etude-new', picks, overwrite: true } });
        expect(overwrite.status).toBe(409);
        expect((await overwrite.json()).error).toContain('读不了 .coven/state.json');
        // 服务还活着
        expect((await call('/api/overview')).status).toBe(200);
    });

    it('reads only the simulated claims of a dry run that has no tracking issue, like coven claim status', async () => {
        const state = createState({ run: 'woo3', scope: 'etude-x', owner: 'alice', trackingIssue: null, dryRun: true });
        state.dryComments.push({ ...claimComment({ state: 'claimed', owner: 'alice', claimId: 'd1', item: 'todo:src/a.ts', leaseUntil: '2099-01-01T00:00:00.000Z' }, 'dry-1'), issue: null });
        fs.mkdirSync(path.join(root, '.coven'), { recursive: true });
        fs.writeFileSync(path.join(root, '.coven', 'state.json'), JSON.stringify(state));
        const seen = [];
        const local = createCompassServer({ root, config: CONFIG, adapter }, { readComments: ({ issue, state: current }) => { seen.push(issue); return current.dryComments.filter(comment => comment.issue === issue); } });
        await new Promise(resolve => local.server.listen(0, '127.0.0.1', resolve));
        try {
            const response = await fetch(`http://127.0.0.1:${local.server.address().port}/api/claims`, { headers: { 'x-coven-token': local.token } });
            expect(await response.json()).toMatchObject({ available: true, issue: null, items: [expect.objectContaining({ item: 'todo:src/a.ts', status: 'held' })] });
            // 不退回去读配置里的跟踪 issue #42
            expect(seen).toEqual([null]);
        } finally {
            await new Promise(resolve => local.server.close(resolve));
        }
    });

    it('lists finished runs and shows their summary', async () => {
        fs.mkdirSync(path.join(root, '.coven', 'runs'), { recursive: true });
        fs.writeFileSync(path.join(root, '.coven', 'runs', 'op1.json'), JSON.stringify({ run: 'op1', scope: 'fugue-explore', startedAt: '2026-11-09T07:13:00Z', finishedAt: '2026-11-09T07:46:00Z', totals: { tasks: 1, done: 1 }, interventionCount: 4 }));
        fs.writeFileSync(path.join(root, '.coven', 'runs', 'op1.md'), '# Coven Op. 1\n');
        fs.writeFileSync(path.join(root, '.coven', 'runs', 'broken.json'), '{');
        const overview = await (await call('/api/overview')).json();
        expect(overview.runs).toEqual([expect.objectContaining({ run: 'op1', label: 'Op. 1', scopeLabel: 'Fugue "explore"', interventionCount: 4 })]);
        expect(await (await call('/api/runs/op1')).json()).toMatchObject({ summary: '# Coven Op. 1\n' });
        expect((await call('/api/runs/op9')).status).toBe(404);
    });
});
