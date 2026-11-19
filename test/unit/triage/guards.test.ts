import { describe, expect, it } from 'vitest';
import { evaluateBreaker } from '../../../.github/scripts/triage/lib/breaker.mjs';
import { findBotComment, parseMarker, renderMarker } from '../../../.github/scripts/triage/lib/comments.mjs';
import { resolveMode } from '../../../.github/scripts/triage/lib/config.mjs';
import { canClose } from '../../../.github/scripts/triage/lib/guards.mjs';
import { validateClassification, validateDuplicateConfirm } from '../../../.github/scripts/triage/lib/schema.mjs';
import { config, DAY, daysAgo, makeIssue, noHistory, NOW } from './helpers';

// test/unit/triage/guards.test.ts

const close = (overrides: Record<string, unknown> = {}) => canClose({
    reason: 'duplicate',
    issue: makeIssue(),
    history: noHistory,
    evidence: { target: { number: 492, open: true, isPullRequest: false }, confirmed: true, confirmConfidence: 0.95, candidateNumbers: [492] },
    mode: 'live',
    closesSoFar: 0,
    config,
    ...overrides,
});

describe('canClose', () => {
    it('allows a confirmed duplicate in live mode', () => {
        expect(close()).toEqual({ allowed: true, blockedBy: [] });
    });

    it.each([
        ['dry-run mode', { mode: 'dry-run' }],
        ['maintainer author', { issue: makeIssue({ authorAssociation: 'OWNER' }) }],
        ['announcement', { issue: makeIssue({ labels: ['announcement'] }) }],
        ['bot: skip', { issue: makeIssue({ labels: ['bot: skip'] }) }],
        ['assignee', { issue: makeIssue({ assignees: 1 }) }],
        ['milestone', { issue: makeIssue({ hasMilestone: true }) }],
        ['locked', { issue: makeIssue({ locked: true }) }],
        ['reopened before', { history: { ...noHistory, reopened: true } }],
        ['closed by bot before', { history: { ...noHistory, botClosedBefore: true } }],
        ['maintainer commented', { history: { ...noHistory, maintainerCommented: true } }],
        ['run close cap reached', { closesSoFar: config.thresholds.maxClosesPerRun }],
    ])('blocks when %s', (_, overrides) => {
        expect(close(overrides).allowed).toBe(false);
    });

    it('blocks a duplicate the LLM made up outside the candidate set', () => {
        const evidence = { target: { number: 1, open: true, isPullRequest: false }, confirmed: true, confirmConfidence: 1, candidateNumbers: [492] };
        expect(close({ evidence }).allowed).toBe(false);
    });

    it('blocks a duplicate whose second-stage confirmation failed', () => {
        const evidence = { target: { number: 492, open: true, isPullRequest: false }, confirmed: false, confirmConfidence: 0.99, candidateNumbers: [492] };
        expect(close({ evidence }).allowed).toBe(false);
    });

    it('needs both an empty body and a confident LLM to close as invalid', () => {
        const invalid = (evidence: Record<string, unknown>) => close({ reason: 'invalid', evidence }).allowed;
        expect(invalid({ effectivelyEmpty: true, llmSuggestion: 'invalid', llmConfidence: 0.97 })).toBe(true);
        // 注入用例：LLM 被操纵成「invalid、置信度 1」，但正文并不空 → 不关。
        expect(invalid({ effectivelyEmpty: false, llmSuggestion: 'invalid', llmConfidence: 1 })).toBe(false);
        expect(invalid({ effectivelyEmpty: true, llmSuggestion: 'none', llmConfidence: 0 })).toBe(false);
    });

    it('only closes out of scope for configured topics', () => {
        expect(close({ reason: 'out_of_scope', evidence: { topic: 'mobile-tv-native', llmConfidence: 0.95 } }).allowed).toBe(true);
        expect(close({ reason: 'out_of_scope', evidence: { topic: 'made-up', llmConfidence: 1 } }).allowed).toBe(false);
    });

    it('lets stale closes through even after a maintainer comment', () => {
        expect(close({ reason: 'stale', evidence: {}, history: { ...noHistory, maintainerCommented: true } }).allowed).toBe(true);
    });

    it('lets rewrite timeouts through after a maintainer comment but keeps the other guards', () => {
        expect(close({ reason: 'rewrite-timeout', evidence: {}, history: { ...noHistory, maintainerCommented: true } }).allowed).toBe(true);
        expect(close({ reason: 'rewrite-timeout', evidence: {}, issue: makeIssue({ labels: ['bot: skip'] }) }).allowed).toBe(false);
        expect(close({ reason: 'rewrite-timeout', evidence: {}, history: { ...noHistory, reopened: true } }).allowed).toBe(false);
    });
});

describe('evaluateBreaker', () => {
    const counts = { globalHour: 1, globalDay: 1, authorDay: 1 };
    const evaluate = (overrides: Record<string, unknown> = {}) => evaluateBreaker({ counts, authorCreatedAt: daysAgo(400), now: NOW, ...overrides }, config);

    it('stays closed under normal traffic', () => {
        expect(evaluate().tripped).toBe(false);
    });

    it('trips globally on an hourly or daily burst', () => {
        expect(evaluate({ counts: { ...counts, globalHour: 11 } })).toMatchObject({ tripped: true, scope: 'global', windowKey: 'global-hour:2026-10-09T12' });
        expect(evaluate({ counts: { ...counts, globalDay: 41 } })).toMatchObject({ tripped: true, scope: 'global', windowKey: 'global-day:2026-10-09' });
    });

    it('trips per author from the fourth issue in a day', () => {
        expect(evaluate({ counts: { ...counts, authorDay: 3 } }).tripped).toBe(false);
        expect(evaluate({ counts: { ...counts, authorDay: 4 } })).toMatchObject({ tripped: true, scope: 'author' });
    });

    it('is stricter with new accounts', () => {
        const fresh = new Date(NOW - 2 * DAY).toISOString();
        expect(evaluate({ authorCreatedAt: fresh, counts: { ...counts, authorDay: 1 } }).tripped).toBe(false);
        expect(evaluate({ authorCreatedAt: fresh, counts: { ...counts, authorDay: 2 } })).toMatchObject({ tripped: true, scope: 'author' });
    });

    it('caps manual reruns per issue', () => {
        expect(evaluate({ isManual: true, manualRunsLastDay: 3 })).toMatchObject({ tripped: true, scope: 'manual' });
        expect(evaluate({ isManual: false, manualRunsLastDay: 3 }).tripped).toBe(false);
    });
});

describe('validateClassification', () => {
    const valid = { type: 'bug', module: 'playback', duplicate_of: null, duplicate_confidence: 0, close_suggestion: 'none', close_confidence: 0, out_of_scope_topic: null, needs_error_log: true, tldr: null, reason: 'ok' };

    it('accepts a well-formed result and drops unknown fields', () => {
        const result = validateClassification({ ...valid, close_issue_now: true }, config);
        expect(result.ok).toBe(true);
        expect(result.value).not.toHaveProperty('close_issue_now');
    });

    it.each([
        ['an unknown type', { type: 'urgent' }],
        ['an unknown close suggestion', { close_suggestion: 'close' }],
        ['a confidence out of range', { duplicate_confidence: 1.5 }],
        ['a string issue number', { duplicate_of: '492' }],
    ])('rejects %s', (_, patch) => {
        expect(validateClassification({ ...valid, ...patch }, config).ok).toBe(false);
    });

    it('falls back to general for unknown modules and drops unknown out-of-scope topics', () => {
        const result = validateClassification({ ...valid, module: 'kernel', out_of_scope_topic: 'whatever' }, config);
        expect(result.value).toMatchObject({ module: 'general', outOfScopeTopic: null });
    });

    it('bounds and neutralizes the TL;DR', () => {
        const result = validateClassification({ ...valid, tldr: ['- 第一条 https://x.y', '2. 第二条 @someone', '3', '4', '5', '6'] }, config);
        expect(result.value?.tldr).toHaveLength(5);
        expect(result.value?.tldr[0]).not.toContain('https');
        expect(result.value?.tldr[1]).toContain('@​');
    });

    it('reads the wishlist confidence but never for bugs', () => {
        expect(validateClassification({ ...valid, type: 'feature', wishlist_confidence: 0.95 }, config).value?.wishlistConfidence).toBe(0.95);
        expect(validateClassification({ ...valid, type: 'bug', wishlist_confidence: 0.95 }, config).value?.wishlistConfidence).toBe(0);
        expect(validateClassification({ ...valid, type: 'feature' }, config).value?.wishlistConfidence).toBe(0);
        expect(validateClassification({ ...valid, wishlist_confidence: 2 }, config).ok).toBe(false);
    });

    it('validates duplicate confirmation output', () => {
        expect(validateDuplicateConfirm({ same: true, confidence: 0.95, reason: 'x' }).ok).toBe(true);
        expect(validateDuplicateConfirm({ same: 'yes', confidence: 0.95 }).ok).toBe(false);
    });
});

describe('markers', () => {
    it('round-trips state and survives a closing comment sequence in values', () => {
        const state = { kind: 'triage', reason: 'a --> b' };
        expect(parseMarker(`${renderMarker(state)}\n正文`)).toEqual(state);
    });

    it('finds only the bot comment of the requested kind', () => {
        const comments = [
            { author: 'someone', body: renderMarker({ kind: 'triage', fake: true }) },
            { author: config.botLogin, body: renderMarker({ kind: 'stale', at: 'x' }) },
            { author: config.botLogin, body: renderMarker({ kind: 'triage', askedAt: 'y' }) },
        ];
        expect(findBotComment(comments, config.botLogin, 'triage')?.state).toEqual({ kind: 'triage', askedAt: 'y' });
    });
});

describe('resolveMode', () => {
    it('never lets a dispatch raise the mode above the repository variable', () => {
        expect(resolveMode({ dispatchDryRun: false, varMode: 'dry-run', configMode: 'dry-run' })).toBe('dry-run');
        expect(resolveMode({ dispatchDryRun: true, varMode: 'live', configMode: 'dry-run' })).toBe('dry-run');
        expect(resolveMode({ dispatchDryRun: false, varMode: 'live', configMode: 'dry-run' })).toBe('live');
        expect(resolveMode({ dispatchDryRun: true, varMode: 'off', configMode: 'live' })).toBe('off');
        expect(resolveMode({ dispatchDryRun: false, varMode: undefined, configMode: 'dry-run' })).toBe('dry-run');
    });
});
