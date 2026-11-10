import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    checkWrittenRule,
    writtenRuleState,
    WRITTEN_RULE_LIMIT_MS,
    type WrittenRuleVerdict,
} from '@/components/modal/lyric-filter/useWrittenRuleCheck';

// test/unit/lyrics/writtenRuleCheck.test.ts
// The check a written rule passes before the lyric filter window tests it on its own thread: the
// time counts from when the worker is ready, a check over the limit is slow and stops the worker,
// and only a rule whose check came back in time is tested there.

const startCheck = () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null } as unknown as Worker;
    const settled: WrittenRuleVerdict[] = [];
    checkWrittenRule(worker, '^(\\w+\\s?)*$', ['a line'], verdict => settled.push(verdict));
    // What the worker posts when a request is done: the empty one first (no song), then the check.
    const reply = (total: number) => (worker.onmessage as (event: unknown) => void)({ data: { complete: true, total } });
    return { worker, settled, reply };
};

describe('checking a written rule off the window thread', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('passes a rule back in time, the worker loading not counted', () => {
        const { worker, settled, reply } = startCheck();
        vi.advanceTimersByTime(10_000);
        reply(0);
        vi.advanceTimersByTime(WRITTEN_RULE_LIMIT_MS - 1);
        reply(1);

        expect(settled).toEqual(['ok']);
        expect(worker.terminate).not.toHaveBeenCalled();
    });

    it('stops a rule that runs out of time, once', () => {
        const { worker, settled, reply } = startCheck();
        reply(0);
        vi.advanceTimersByTime(WRITTEN_RULE_LIMIT_MS);
        reply(1);

        expect(settled).toEqual(['slow']);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('lets the window test only what came back in time', () => {
        const verdicts = new Map<string, WrittenRuleVerdict>([['^OP', 'ok'], ['^(\\w+\\s?)*$', 'slow']]);

        expect(writtenRuleState({ shape: 'contains', text: '作词' }, verdicts)).toBe('ok');
        expect(writtenRuleState({ shape: 'written', text: ' ^OP ' }, verdicts)).toBe('ok');
        expect(writtenRuleState({ shape: 'written', text: '^(\\w+\\s?)*$' }, verdicts)).toBe('slow');
        expect(writtenRuleState({ shape: 'written', text: '^ED' }, verdicts)).toBe('checking');
        // Not valid: it removes nothing, so there is nothing to run.
        expect(writtenRuleState({ shape: 'written', text: '[' }, verdicts)).toBe('ok');
    });
});
