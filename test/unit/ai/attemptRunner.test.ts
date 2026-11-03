import { beforeEach, describe, expect, it } from 'vitest';
import { budgetFor, REASONING_ALLOWANCE } from '../../../shared/ai/aiTasks.mjs';
import { attemptCacheKey, resetLearnedAttempts, runAttempts, walkAttempts } from '../../../shared/ai/attemptRunner.mjs';
import { customAdapter } from '../../../shared/ai/custom.mjs';

// test/unit/ai/attemptRunner.test.ts
// The shared attempt runner: when it moves to the next request shape (a parameter rejected by
// name, reasoning that ate the budget), when it must not (any other failure), and what it
// remembers. Requests are fakes: `send` answers whatever each test scripts.

type Attempt = { label: string; reasoningOff: boolean; params: Record<string, unknown>; knobs: string[] };
type Reply = { ok: boolean; status?: number; errorText?: string; errorBody?: string; content?: string | null; exhausted?: boolean };

const ATTEMPTS: Attempt[] = [
    { label: 'effort=none', reasoningOff: true, params: { reasoning_effort: 'none' }, knobs: ['reasoning_effort'] },
    { label: 'thinking=disabled', reasoningOff: true, params: { thinking: { type: 'disabled' } }, knobs: ['thinking'] },
    { label: 'plain', reasoningOff: false, params: {}, knobs: [] },
];
const adapter = { id: 'fake' };

/** Runs ATTEMPTS against scripted replies (one per call, the last one repeating). */
const walk = async (replies: Reply[], options: Record<string, unknown> = {}) => {
    const sent: string[] = [];
    const logged: string[] = [];
    const outcome = await walkAttempts({
        adapter, task: 'segmentation', url: 'https://endpoint.test/v1', model: 'm', attempts: ATTEMPTS,
        send: async (attempt: Attempt) => {
            sent.push(attempt.label);
            return replies[Math.min(sent.length - 1, replies.length - 1)];
        },
        cache: null,
        log: (line: string) => logged.push(line),
        ...options,
    });
    return { sent, logged, outcome };
};

const ok = (content: string): Reply => ({ ok: true, status: 200, content });
const fail = (status: number, body: unknown): Reply => {
    const errorBody = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: false, status, errorBody, errorText: `OpenAI compatible API error (${status}): …` };
};

beforeEach(() => resetLearnedAttempts());

describe('moving to the next attempt', () => {
    it.each([
        ['error.param in the raw body', fail(400, { error: { message: 'Bad request', param: 'reasoning_effort', code: 'invalid_value' } })],
        ['OpenAI Unsupported value', fail(400, { error: { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model.", param: null } })],
        ['OpenAI Unrecognized request argument', fail(400, 'Unrecognized request argument supplied: reasoning_effort')],
        ['GLM 1214', fail(400, { error: { code: '1214', message: 'Parameter `reasoning_effort` is invalid' } })],
        ['a 422 naming the field', fail(422, { detail: [{ type: 'extra_forbidden', loc: ['body', 'reasoning_effort'], msg: 'Extra inputs are not permitted' }] })],
    ])('when %s rejects this attempt\'s knob', async (_name, rejection) => {
        const { sent, logged, outcome } = await walk([rejection, ok('{}')]);

        expect(sent).toEqual(['effort=none', 'thinking=disabled']);
        expect(logged).toEqual(['[ai] effort=none rejected by the endpoint, trying the next option']);
        expect(outcome).toMatchObject({ index: 1, result: { content: '{}' } });
    });

    it('when the model answered nothing because reasoning used up the budget', async () => {
        const { sent, logged } = await walk([{ ok: true, status: 200, content: '', exhausted: true }, ok('{}')]);

        expect(sent).toEqual(['effort=none', 'thinking=disabled']);
        expect(logged).toEqual(['[ai] effort=none did not stop the model reasoning, trying the next option']);
    });

    it('asks the adapter\'s own check when it has one', async () => {
        const glm1210 = fail(400, { error: { code: '1210', message: 'Invalid API parameter, please check the documentation.' } });
        const strict = await walk([glm1210, ok('{}')]);
        expect(strict.sent).toEqual(['effort=none']);

        const lenient = await walk([glm1210, ok('{}')], {
            adapter: { id: 'fake', rejectedParameter: (_status: number, body: string) => body.includes('"1210"') },
        });
        expect(lenient.sent).toEqual(['effort=none', 'thinking=disabled']);
    });
});

describe('not moving on', () => {
    it.each([401, 403, 404, 429, 500, 503])('for HTTP %i, even when the body names the knob', async (status) => {
        const reply = fail(status, { error: { message: 'Unsupported parameter', param: 'reasoning_effort' } });
        const { sent, outcome } = await walk([reply]);

        expect(sent).toEqual(['effort=none']);
        expect(outcome.result).toBe(reply);
    });

    it('for a 400 that names no parameter, or another one', async () => {
        expect((await walk([fail(400, { error: { message: 'Your request was malformed.' } })])).sent).toEqual(['effort=none']);
        expect((await walk([fail(400, { error: { message: 'Bad', param: 'temperature', code: 'invalid_value' } })])).sent).toEqual(['effort=none']);
    });

    it('for an empty answer that reasoning does not explain', async () => {
        const { sent, outcome } = await walk([{ ok: true, status: 200, content: '', exhausted: false }]);
        expect(sent).toEqual(['effort=none']);
        expect(outcome.result.content).toBe('');
    });

    it('past the last attempt, whose failure comes back as it came', async () => {
        const rejection = fail(400, { error: { message: 'Bad', param: 'reasoning_effort', code: 'invalid_value' } });
        const { sent, outcome } = await walk([rejection, fail(400, { error: { param: 'thinking', message: 'invalid' } }), rejection]);
        expect(sent).toEqual(['effort=none', 'thinking=disabled', 'plain']);
        expect(outcome).toMatchObject({ index: 2, result: rejection });
    });
});

describe('remembering what worked', () => {
    const run = (cache: Map<string, number>, task: string, replies: Reply[]) => walk(replies, { cache, task });

    it('starts the next call at the attempt that answered, per adapter, task, URL and model', async () => {
        const cache = new Map<string, number>();
        const rejection = fail(400, { error: { message: 'Bad', param: 'reasoning_effort', code: 'invalid_value' } });

        expect((await run(cache, 'segmentation', [rejection, ok('{}')])).sent).toHaveLength(2);
        expect((await run(cache, 'segmentation', [ok('{}')])).sent).toEqual(['thinking=disabled']);
        // Another task on the same endpoint and model learns on its own.
        expect((await run(cache, 'theme', [ok('{}')])).sent).toEqual(['effort=none']);
        expect([...cache.keys()]).toEqual([
            attemptCacheKey({ adapter, task: 'segmentation', url: 'https://endpoint.test/v1', model: 'm' }),
            attemptCacheKey({ adapter, task: 'theme', url: 'https://endpoint.test/v1', model: 'm' }),
        ]);
        expect(cache.keys().next().value).toBe('fake|segmentation|https://endpoint.test/v1|m');
    });

    it('does not remember a failure, and `cache: null` neither reads nor writes', async () => {
        const cache = new Map<string, number>();
        await run(cache, 'segmentation', [fail(401, { error: { message: 'no' } })]);
        expect(cache.size).toBe(0);

        cache.set(attemptCacheKey({ adapter, task: 'segmentation', url: 'https://endpoint.test/v1', model: 'm' }), 2);
        expect((await walk([ok('{}')], { cache: null })).sent).toEqual(['effort=none']);
    });
});

describe('runAttempts', () => {
    const run = (replies: Reply[], extra: Record<string, unknown> = {}) => runAttempts({
        adapter, task: 'segmentation', url: 'https://endpoint.test/v1', model: 'm', attempts: ATTEMPTS, cache: null,
        send: async () => replies.shift()!,
        describeEmpty: (result: Reply) => `empty after ${result.exhausted ? 'reasoning' : 'nothing'}`,
        ...extra,
    });

    it('returns the answer text', async () => {
        await expect(run([ok('{"a":1}')])).resolves.toBe('{"a":1}');
    });

    it('throws the endpoint\'s own error line, or the empty-answer description', async () => {
        await expect(run([fail(401, 'denied')])).rejects.toThrow('OpenAI compatible API error (401): …');
        await expect(run([
            { ok: true, content: '', exhausted: true }, { ok: true, content: '', exhausted: true }, { ok: true, content: '', exhausted: true },
        ])).rejects.toThrow('empty after reasoning');
    });

    it('builds the error with the caller\'s factory', async () => {
        class Tagged extends Error { status = 502; }
        await expect(run([fail(500, 'down')], { fail: (message: string) => new Tagged(message) })).rejects.toBeInstanceOf(Tagged);
    });
});

describe('budgets', () => {
    it('gives reasoning room only to attempts that do not expect reasoning off', () => {
        expect(budgetFor('segmentation', 8192, { reasoningOff: true })).toBe(8192);
        expect(budgetFor('segmentation', 8192, { reasoningOff: false })).toBe(8192 + REASONING_ALLOWANCE.segmentation);
        expect(budgetFor('theme', 8192, { reasoningOff: false })).toBe(24576);
        expect(budgetFor('test', 512, { reasoningOff: false })).toBe(4096);
    });

    it('sends no cap without an answer budget', () => {
        expect(budgetFor('theme', undefined, { reasoningOff: false })).toBeUndefined();
    });

    it('keeps the custom ladder\'s old x4 last rung for segmentation', () => {
        const budgets = customAdapter.attempts('segmentation', 'm').map((attempt: Attempt) => budgetFor('segmentation', 8192, attempt));
        expect(budgets).toEqual([8192, 8192, 8192 * 4]);
    });
});
