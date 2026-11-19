import { describe, expect, it } from 'vitest';
import { renderMarker } from '../../../.github/scripts/triage/lib/comments.mjs';
import { decideIssue } from '../../../.github/scripts/triage/lib/decide-issue.mjs';
import { decidePr, globToRegExp, parseAnnouncementBlock, parseConventionalTitle } from '../../../.github/scripts/triage/lib/decide-pr.mjs';
import { decideStale } from '../../../.github/scripts/triage/lib/decide-stale.mjs';
import { extractFacts } from '../../../.github/scripts/triage/lib/parse-issue.mjs';
import { config, daysAgo, filledBugBody, makeIssue, noHistory, NOW, qrReport, templateLines } from './helpers';

// test/unit/triage/decide.test.ts

const llmValue = (patch: Record<string, unknown> = {}) => ({
    type: 'bug', module: 'playback', duplicateOf: null, duplicateConfidence: 0, closeSuggestion: 'none', closeConfidence: 0,
    outOfScopeTopic: null, needsErrorLog: false, tldr: null, reason: '分类依据', ...patch,
});

// 用真实的事实提取跑一次决策；llm 传 null 表示 LLM 不可用。
function decide(issuePatch: Record<string, unknown>, options: Record<string, unknown> = {}) {
    const issue = makeIssue(issuePatch);
    const facts = extractFacts({ title: issue.title, body: issue.body, labels: issue.labels }, { templateLines, config });
    const llm = options.llm === undefined ? { status: 'ok', value: llmValue() } : options.llm === null ? { status: 'unavailable' } : options.llm;
    return decideIssue({
        issue, facts, config, mode: 'live', trigger: 'opened', now: NOW, llm, breaker: null, duplicate: null, candidateNumbers: [],
        previous: null, history: noHistory, bodyHash: 'h', aggregateTarget: { number: 484, open: true }, ...options,
    });
}

describe('decideIssue', () => {
    it('merges old QQ QR diagnostics into the aggregate issue', () => {
        const plan = decide({ title: '[QR login] qq login failed', body: qrReport('0.7.10') }, { llm: { status: 'skipped' } });
        expect(plan.close).toEqual({ reason: 'qr-aggregate', stateReason: 'duplicate' });
        expect(plan.labelsAdd).toEqual(expect.arrayContaining(['duplicate', 'bot: auto-closed', 'module: omni', 'bug']));
        expect(plan.comments[0]).toContain('#484');
    });

    it('keeps newer QR diagnostics open and points at the aggregate', () => {
        const plan = decide({ title: '[QR login] qq login failed', body: qrReport('0.7.16') }, { llm: { status: 'skipped' } });
        expect(plan.close).toBeNull();
        expect(plan.upsert?.body).toContain('#484');
    });

    it('never closes netease QR reports without an aggregate', () => {
        const plan = decide({ title: '[QR login] netease login failed', body: qrReport('0.7.10', 'netease') }, { llm: { status: 'skipped' } });
        expect(plan.close).toBeNull();
        expect(plan.labelsAdd).toContain('module: omni');
    });

    it('labels bugs by the build tag on their copied version line', () => {
        const body = filledBugBody.replace('c69afdc/水仙的守护与龙', 'c69afdc/水仙的守护与龙 · Unofficial build');
        const plan = decide({ title: '[BUG] 歌词乱码', body, labels: ['bug'] });
        expect(plan.labelsAdd).toContain('unofficial build');
        expect(plan.close).toBeNull();
        expect(decide({ title: '[BUG] 歌词乱码', body: filledBugBody, labels: ['bug'] }).labelsAdd).not.toContain('unofficial build');
        const selfHosted = decide({ title: '[BUG] 歌词乱码', body: filledBugBody.replace('c69afdc/水仙的守护与龙', 'c69afdc/水仙的守护与龙 · Self-hosted'), labels: ['bug'] });
        expect(selfHosted.labelsAdd).toContain('self-hosted');
        expect(selfHosted.labelsAdd).not.toContain('unofficial build');
    });

    it('asks for missing info on a bug and labels the module', () => {
        const plan = decide({ title: '[BUG] 歌词乱码', body: '**Bug 描述**\n导入的本地歌词显示为乱码', labels: ['bug'] }, { llm: { status: 'ok', value: llmValue({ needsErrorLog: true }) } });
        expect(plan.labelsAdd).toEqual(expect.arrayContaining(['needs-info', 'module: playback']));
        expect(plan.upsert?.body).toContain('初步归属模块');
        expect(plan.upsert?.body).toContain('Folia 版本号');
        expect(plan.upsert?.body).toContain('报错信息');
    });

    it('does not ask UI interaction bugs for console errors', () => {
        const body = filledBugBody.replace(/```[\s\S]*?```/, '');
        const plan = decide({ title: '[BUG] 命令窗口方向键不滚动', body, labels: ['bug'] }, { llm: { status: 'ok', value: llmValue({ module: 'command', needsErrorLog: false }) } });
        expect(plan.labelsAdd).not.toContain('needs-info');
        expect(plan.labelsAdd).toContain('module: command');
    });

    it('replies to provider requests with the fixed text and never closes them', () => {
        const plan = decide({ title: '[FEATURE] 希望支持 Apple Music', body: '想在 Folia 里听 Apple Music', labels: ['enhancement'] }, {
            llm: { status: 'ok', value: llmValue({ type: 'provider_request', closeSuggestion: 'out_of_scope', closeConfidence: 1, outOfScopeTopic: 'mobile-tv-native' }) },
        });
        expect(plan.close).toBeNull();
        expect(plan.labelsAdd).toEqual(expect.arrayContaining(['provider-request', 'module: omni']));
        expect(plan.upsert?.body).toContain('添加新的平台需要对应平台的 API 后端');
        expect(plan.upsert?.body).toContain('Apple Music 平台短期内不会支持');
    });

    it('falls back to keyword detection for provider requests without the LLM', () => {
        const plan = decide({ title: '[FEATURE] 能不能 加个 喜马拉雅 啊', body: '', labels: ['enhancement'] }, { llm: null });
        expect(plan.labelsAdd).toContain('provider-request');
        expect(plan.upsert?.body).not.toContain('Apple Music');
    });

    it('links in-progress platform work', () => {
        const plan = decide({ title: '[FEATURE] 支持 Spotify', body: '希望接入 Spotify 账号', labels: ['enhancement'] }, { llm: null });
        expect(plan.upsert?.body).toContain('#507');
    });

    it('closes an empty bug only when the LLM agrees', () => {
        const empty = { title: '[BUG] ', body: '', labels: ['bug'] };
        expect(decide(empty, { llm: null }).close).toBeNull();
        expect(decide(empty, { llm: null }).labelsAdd).toContain('needs-info');
        const plan = decide(empty, { llm: { status: 'ok', value: llmValue({ closeSuggestion: 'invalid', closeConfidence: 0.97 }) } });
        expect(plan.close).toEqual({ reason: 'invalid', stateReason: 'not_planned' });
    });

    it('closes a confirmed duplicate but only mentions an unconfirmed one', () => {
        const value = llmValue({ duplicateOf: 492, duplicateConfidence: 0.95 });
        const issue = { title: '[BUG] 歌手页进入专辑后返回错误', body: filledBugBody, labels: ['bug'] };
        const target = { number: 492, open: true, isPullRequest: false };
        const confirmed = decide(issue, { llm: { status: 'ok', value }, candidateNumbers: [492], duplicate: { target, confirmed: true, confidence: 0.95 } });
        expect(confirmed.close?.reason).toBe('duplicate');
        const unconfirmed = decide(issue, { llm: { status: 'ok', value }, candidateNumbers: [492], duplicate: { target, confirmed: false, confidence: 0.4 } });
        expect(unconfirmed.close).toBeNull();
        expect(unconfirmed.upsert?.body).toContain('#492');
        expect(unconfirmed.blocked.map((item: { reason: string }) => item.reason)).toContain('duplicate');
    });

    it('does not close anything in dry-run mode', () => {
        const plan = decide({ title: '[QR login] qq login failed', body: qrReport('0.7.10') }, { llm: { status: 'skipped' }, mode: 'dry-run' });
        expect(plan.close).toBeNull();
        expect(plan.blocked[0].blockedBy).toContain('当前模式为 dry-run');
    });

    it('adds a TL;DR to long issues and keeps it across follow-ups', () => {
        const body = `**Bug 描述**\n${'很长的描述。'.repeat(300)}`;
        const plan = decide({ title: '[BUG] 长', body, labels: ['bug'] }, { llm: { status: 'ok', value: llmValue({ tldr: ['要点一', '要点二'] }) } });
        expect(plan.upsert?.body).toContain('### TL;DR');
        expect(plan.upsert?.body).toContain('由 AI 自动生成');
        const followup = decide({ title: '[BUG] 长', body, labels: ['bug', 'needs-info'] }, {
            llm: { status: 'skipped' }, trigger: 'author-comment', previous: { kind: 'triage', module: 'playback', tldr: ['要点一'], bodyHash: 'h', missing: ['version'] },
        });
        expect(followup.upsert?.body).toContain('要点一');
    });

    it('marks rate-limited issues and clears the mark once the LLM runs', () => {
        const limited = decide({ title: '[FEATURE] 某功能', body: '希望有某功能', labels: ['enhancement'] }, { llm: { status: 'breaker' }, breaker: { tripped: true, reasons: ['x'] } });
        expect(limited.labelsAdd).toContain('bot: rate-limited');
        const rerun = decide({ title: '[FEATURE] 某功能', body: '希望有某功能', labels: ['enhancement', 'bot: rate-limited'] }, { trigger: 'rerun' });
        expect(rerun.labelsRemove).toContain('bot: rate-limited');
    });

    it('removes needs-info once the author supplied everything', () => {
        const plan = decide({ title: '[BUG] alac', body: filledBugBody, labels: ['bug', 'needs-info'] }, {
            llm: { status: 'skipped' }, trigger: 'edited', previous: { kind: 'triage', module: 'playback', missing: ['version'], askedAt: daysAgo(3) },
        });
        expect(plan.labelsRemove).toContain('needs-info');
        expect(plan.upsert?.body).toContain('已收到补充信息');
    });

    it('only adds the module label for maintainer issues', () => {
        const plan = decide({ title: '[BUG] ', body: '', labels: ['bug'], authorAssociation: 'OWNER' });
        expect(plan.labelsAdd).toEqual(['module: playback']);
        expect(plan.upsert).toBeNull();
        expect(plan.close).toBeNull();
    });

    it('keeps an existing module label chosen by a human', () => {
        const plan = decide({ title: '[BUG] x', body: filledBugBody, labels: ['bug', 'module: lattice'] });
        expect(plan.labelsAdd.some((name: string) => name.startsWith('module: '))).toBe(false);
        expect(plan.upsert?.body).toContain('`lattice`');
    });
});

describe('decideIssue wishlist', () => {
    // 结构上像 #1298：好几个小节、十几条互不相关的需求。
    const wishlistBody = [
        '### 一句话诉求', '想要一个只放本地歌的版本。',
        '### 为什么', '- 用不到账号', '- 启动太慢', '- 状态太多',
        '### 希望包含', '**保留**', '- 海报墙', '- 歌词', '- 播放队列', '- 搜索',
        '**移除**', '- 登录', '- 在线源', '- 推荐',
        '### 加分项', '1. 只留壁纸模式', '2. 居中搜索框', '3. 封面原图', '4. 隐藏任务栏',
    ].join('\n');
    const wishlistLlm = (patch: Record<string, unknown> = {}) => ({ status: 'ok', value: llmValue({ type: 'feature', module: 'desktop', wishlistConfidence: 0.95, ...patch }) });
    const run = (patch: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => decide(
        { title: '做一个纯本地版', body: wishlistBody, labels: ['enhancement'], ...patch },
        { llm: wishlistLlm(), ...options },
    );
    const previousState = (rewrite: unknown) => ({ kind: 'triage', module: 'desktop', missing: [], bodyHash: 'old', rewrite });

    it('asks for a rewrite with a deadline instead of closing', () => {
        const plan = run();
        expect(plan.close).toBeNull();
        expect(plan.labelsAdd).toContain('needs-rewrite');
        expect(plan.upsert?.body).toContain('请拆分或改写这个 issue');
        expect(plan.upsert?.body).toContain('7 天内');
        expect(plan.upsert?.body).not.toMatch(/AI 写|AI 生成的内容/);
        // 新 issue 的 triage 评论本身会通知作者，不用再另发一条。
        expect(plan.comments).toEqual([]);
    });

    it('needs both the LLM and the structure gate', () => {
        expect(run({}, { llm: wishlistLlm({ wishlistConfidence: 0.6 }) }).labelsAdd).not.toContain('needs-rewrite');
        expect(run({ body: '### 需求\n- 歌词字体能调大\n- 调大后不要换行' }).labelsAdd).not.toContain('needs-rewrite');
        expect(run({}, { llm: null }).labelsAdd).not.toContain('needs-rewrite');
        expect(run({ title: '[BUG] x', labels: ['bug'] }, { llm: wishlistLlm({ type: 'bug' }) }).labelsAdd).not.toContain('needs-rewrite');
        expect(run({ authorAssociation: 'OWNER' }).labelsAdd).not.toContain('needs-rewrite');
        expect(run({ authorAssociation: 'CONTRIBUTOR' }).labelsAdd).not.toContain('needs-rewrite');
    });

    it('keeps the original deadline across edits that are still a wishlist', () => {
        const askedAt = daysAgo(3);
        const plan = run({ labels: ['enhancement', 'needs-rewrite'] }, { trigger: 'edited', previous: previousState({ askedAt }) });
        expect(plan.upsert?.body).toContain(`"askedAt":"${askedAt}"`);
        expect(plan.labelsRemove).not.toContain('needs-rewrite');
    });

    it('clears the mark once the author rewrote it', () => {
        const plan = run({ labels: ['enhancement', 'needs-rewrite'], body: '### 需求\n只扫描本地文件夹，不显示登录引导。' }, { trigger: 'edited', previous: previousState({ askedAt: daysAgo(3) }) });
        expect(plan.labelsRemove).toContain('needs-rewrite');
        expect(plan.upsert?.body).toContain('已收到修改');
    });

    it('stops once a maintainer took the label off', () => {
        const plan = run({ labels: ['enhancement'] }, { trigger: 'edited', previous: previousState({ askedAt: daysAgo(3) }) });
        expect(plan.labelsAdd).not.toContain('needs-rewrite');
        expect(plan.upsert?.body).toContain('"cancelled":true');
        const later = run({ labels: ['enhancement'] }, { trigger: 'rerun', previous: previousState({ cancelled: true }) });
        expect(later.labelsAdd).not.toContain('needs-rewrite');
    });

    it('posts a separate notice when the triage comment already existed', () => {
        const plan = run({}, { trigger: 'rerun', previous: previousState(null) });
        expect(plan.labelsAdd).toContain('needs-rewrite');
        expect(plan.comments).toHaveLength(1);
        expect(plan.comments[0]).toContain('请拆分或改写这个 issue');
    });
});

describe('decidePr', () => {
    const pr = (patch: Record<string, unknown> = {}) => ({ ...makeIssue({ number: 700, title: 'fix(qq): 修复扫码登录', isPullRequest: true }), draft: false, ...patch });
    const run = (prPatch: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => decidePr({
        pr: pr(prPatch), files: [{ filename: 'src/services/qq.ts', additions: 10, deletions: 2 }], announcements: [], botOwnedLabels: [], config, hasExistingComment: false, ...options,
    });

    it('parses conventional titles', () => {
        expect(parseConventionalTitle('feat(spotify): 新增音源')).toEqual({ type: 'feat', breaking: false });
        expect(parseConventionalTitle('refactor!: 拆分')).toEqual({ type: 'refactor', breaking: true });
        expect(parseConventionalTitle('修复了一些问题')).toBeNull();
    });

    it('labels by title prefix', () => {
        expect(run().labelsAdd).toEqual(['bug']);
        expect(run({ title: 'perf!: 提速' }).labelsAdd).toEqual(['type: perf', 'breaking-change']);
    });

    it('reminds about the title format without labeling', () => {
        const plan = run({ title: '修复了一些问题' });
        expect(plan.labelsAdd).toEqual([]);
        expect(plan.upsert?.body).toContain('标题格式');
    });

    it('only removes type labels the bot added itself', () => {
        expect(run({ title: 'feat: x', labels: ['bug'] }, { botOwnedLabels: ['bug'] }).labelsRemove).toEqual(['bug']);
        expect(run({ title: 'feat: x', labels: ['bug'] }, { botOwnedLabels: [] }).labelsRemove).toEqual([]);
    });

    it('flags oversized PRs while ignoring lockfiles and the code map', () => {
        const files = [
            { filename: 'package-lock.json', additions: 9000, deletions: 0 },
            { filename: 'docs/CODEMAP.md', additions: 2000, deletions: 0 },
            { filename: 'src/a.ts', additions: 100, deletions: 0 },
        ];
        expect(run({}, { files }).labelsAdd).not.toContain('scope too large');
        const big = [{ filename: 'src/a.ts', additions: 3500, deletions: 0 }];
        expect(run({}, { files: big }).labelsAdd).toContain('scope too large');
        expect(run({ authorAssociation: 'OWNER' }, { files: big }).labelsAdd).not.toContain('scope too large');
    });

    it('warns about paused areas only for open maintainer announcements', () => {
        const files = [{ filename: 'src/library/suites/grid/Grid.tsx', additions: 1, deletions: 0 }];
        const announcement = { ...makeIssue({ number: 506, labels: ['announcement'], authorAssociation: 'OWNER' }) };
        expect(run({}, { files, announcements: [announcement] }).upsert?.body).toContain('#506');
        const byStranger = { ...announcement, authorAssociation: 'NONE' };
        expect(run({}, { files, announcements: [byStranger] }).upsert).toBeNull();
    });

    it('reads paused prefixes from the announcement block', () => {
        expect(parseAnnouncementBlock('说明\n```folia-triage\npaused-path-prefixes:\n  - src/mods/\n  - electron/\n```')).toEqual(['src/mods/', 'electron/']);
    });

    it('skips the all-contributors bot', () => {
        expect(run({ author: 'app/allcontributors', title: 'docs: add x' }).labelsAdd).toEqual([]);
    });

    it('matches simple globs', () => {
        expect(globToRegExp('**/*.snap').test('test/a/b.snap')).toBe(true);
        expect(globToRegExp('**/*.snap').test('b.snap')).toBe(true);
        expect(globToRegExp('docs/CODEMAP.md').test('docs/CODEMAP.mdx')).toBe(false);
    });
});

describe('decideStale', () => {
    const timeline = { reopened: false, botClosedBefore: false, botOwnedLabels: [], labeledAt: () => null };
    const triageComment = (askedAt: string) => ({ author: config.botLogin, body: renderMarker({ kind: 'triage', askedAt }), createdAt: askedAt });
    const run = (issuePatch: Record<string, unknown>, comments: unknown[] = [], extra: Record<string, unknown> = {}) => decideStale({
        issue: makeIssue({ createdAt: daysAgo(100), ...issuePatch }), comments, timeline, config, mode: 'live', now: NOW, ...extra,
    });

    it('closes needs-info after 14 days without an author reply', () => {
        const plan = run({ labels: ['bug', 'needs-info'] }, [triageComment(daysAgo(15))]);
        expect(plan.close).toEqual({ reason: 'needs-info-timeout', stateReason: 'not_planned' });
    });

    it('keeps needs-info open when the author replied', () => {
        const plan = run({ labels: ['bug', 'needs-info'] }, [triageComment(daysAgo(15)), { author: 'someone', body: '补充', createdAt: daysAgo(10) }]);
        expect(plan.close).toBeNull();
    });

    it('measures inactivity from human activity, not bot comments', () => {
        const plan = run({ labels: ['bug'] }, [{ author: config.botLogin, body: 'bot', createdAt: daysAgo(1) }]);
        expect(plan.labelsAdd).toContain('stale');
        expect(run({ labels: ['bug'] }, [{ author: 'someone', body: 'hi', createdAt: daysAgo(5) }]).labelsAdd).not.toContain('stale');
    });

    it('closes stale bugs but never feature requests or PRs', () => {
        const stale = { author: config.botLogin, body: renderMarker({ kind: 'stale', at: daysAgo(31) }), createdAt: daysAgo(31) };
        expect(run({ labels: ['bug', 'stale'] }, [stale]).close?.reason).toBe('stale');
        expect(run({ labels: ['enhancement', 'stale'] }, [stale]).close).toBeNull();
        expect(run({ labels: ['bug', 'stale'], isPullRequest: true }, [stale]).close).toBeNull();
    });

    it('removes stale after new human activity', () => {
        const stale = { author: config.botLogin, body: renderMarker({ kind: 'stale', at: daysAgo(10) }), createdAt: daysAgo(10) };
        expect(run({ labels: ['bug', 'stale'] }, [stale, { author: 'x', body: 'still broken', createdAt: daysAgo(2) }]).labelsRemove).toContain('stale');
    });

    it('exempts priority, provider requests, aggregates and assigned issues', () => {
        expect(run({ labels: ['bug', 'priority: high'] }).labelsAdd).toEqual([]);
        expect(run({ labels: ['enhancement', 'provider-request'] }).labelsAdd).toEqual([]);
        expect(run({ number: 484, labels: ['bug'] }).labelsAdd).toEqual([]);
        expect(run({ labels: ['bug'], assignees: 1 }).labelsAdd).toEqual([]);
    });

    it('closes needs-rewrite after the grace days even with an exempt label', () => {
        const triage = (askedAt: string) => ({ author: config.botLogin, body: renderMarker({ kind: 'triage', rewrite: { askedAt } }), createdAt: askedAt });
        const labels = ['enhancement', 'provider-request', 'needs-rewrite'];
        expect(run({ labels }, [triage(daysAgo(8))]).close).toEqual({ reason: 'rewrite-timeout', stateReason: 'not_planned' });
        expect(run({ labels }, [triage(daysAgo(5))]).close).toBeNull();
        expect(run({ labels, assignees: 1 }, [triage(daysAgo(8))]).close).toBeNull();
        expect(run({ labels: [...labels, 'bot: skip'] }, [triage(daysAgo(8))]).close).toBeNull();
    });

    it('respects the per-run close cap', () => {
        const plan = run({ labels: ['bug', 'needs-info'] }, [triageComment(daysAgo(15))], { closesSoFar: config.thresholds.maxClosesPerRun });
        expect(plan.close).toBeNull();
    });
});
