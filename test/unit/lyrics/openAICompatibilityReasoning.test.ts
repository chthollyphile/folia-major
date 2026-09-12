import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenAICompatible, rejectsParameter, resetOpenAICompatibilityCache } from '../../../shared/openAICompatibility.mjs';
import { segmentLyricLines } from '../../../shared/lyricSegmentationService.mjs';

// Parameter rejection is independent of a successful but reasoning-exhausted completion.
const client = createRequire(import.meta.url)('../../../electron/aiTextClient.cjs');
const answer = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"lines":[["hello"]]}' } }] });
const dry = () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking' } }],
    usage: { completion_tokens_details: { reasoning_tokens: 8192 } } });
const reject = (parameter: string, status = 422) => Response.json({ detail: [
    { type: 'extra_forbidden', loc: ['body', parameter], msg: 'Extra inputs are not permitted' },
] }, { status });
let id = 0;
const harness = (reply: (body: any, index: number) => Response, url = `https://suppression-${id++}.example.test/v1`) => {
    const bodies: any[] = [];
    const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', OPENAI_API_URL: url, OPENAI_API_MODEL: 'test-model' };
    const fetchImpl = vi.fn(async (_url: unknown, init: any) => {
        const body = JSON.parse(init.body); bodies.push(body); return reply(body, bodies.length - 1);
    });
    return { env, bodies, fetchImpl };
};
beforeEach(resetOpenAICompatibilityCache);

const runners = {
    electron: (env: Record<string, string>, fetchImpl: any, disableReasoning = true) => client.runAiJsonCompletion({
        store: { get: (key: string) => env[key] }, systemPrompt: 'JSON', sourcePrompt: 'hello',
        schema: { type: 'object' }, schemaName: 'test', maxTokens: 8192, disableReasoning, customFetch: fetchImpl,
    }),
    'web/worker shared segmentation': (env: Record<string, string>, fetchImpl: any) => segmentLyricLines(['hello'], env, fetchImpl),
};
for (const [name, run] of Object.entries(runners)) describe(name, () => {
    it('restores the 8192, 8192, 32768 reasoning budget sequence', async () => {
        const { env, bodies, fetchImpl } = harness((_body, i) => i < 2 ? dry() : answer());
        await run(env, fetchImpl);
        expect(bodies.map(b => b.max_tokens)).toEqual([8192, 8192, 32768]);
        expect(bodies[0].reasoning_effort).toBe('none');
        expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(bodies[2].reasoning_effort).toBeUndefined();
        expect(bodies[2].chat_template_kwargs).toBeUndefined();
        expect(bodies.every(b => b.response_format)).toBe(true);
    });
    it('keeps HTTP fallback within the current suppression rung', async () => {
        const { env, bodies, fetchImpl } = harness(body => {
            if (body.response_format) return reject('response_format');
            if (body.reasoning_effort) return reject('reasoning_effort');
            return answer();
        });
        await run(env, fetchImpl);
        expect(bodies).toHaveLength(3);
        expect(bodies[1].reasoning_effort).toBe('none');
        expect(bodies[1].response_format).toBeUndefined();
        expect(bodies[2].chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(bodies[2].response_format).toBeUndefined();
        await run(env, fetchImpl);
        expect(bodies).toHaveLength(4);
        expect(bodies[3]).toEqual(bodies[2]);
    });
    it('preserves official token spelling throughout suppression fallback', async () => {
        const { env, bodies, fetchImpl } = harness(body => body.reasoning_effort
            ? reject('reasoning_effort') : answer(), 'https://api.openai.com/v1');
        env.OPENAI_API_MODEL = `official-${id++}`;
        await run(env, fetchImpl);
        expect(bodies).toHaveLength(2);
        expect(bodies.every(b => !b.max_tokens && b.max_completion_tokens === 8192)).toBe(true);
        expect(bodies.every(b => b.response_format.type === 'json_schema')).toBe(true);
    });
    it('remembers a rejected DeepSeek thinking parameter across suppression rungs', async () => {
        const { env, bodies, fetchImpl } = harness(body => {
            if (body.thinking) return reject('thinking');
            if (body.reasoning_effort) return dry();
            return answer();
        }, 'https://api.deepseek.com/v1');
        env.OPENAI_API_MODEL = `deepseek-${id++}`;
        await run(env, fetchImpl);
        expect(bodies).toHaveLength(3);
        expect(bodies[0].thinking).toEqual({ type: 'disabled' });
        expect(bodies.slice(1).every(b => !b.thinking)).toBe(true);
        await run(env, fetchImpl);
        expect(bodies).toHaveLength(4);
        expect(bodies[3].thinking).toBeUndefined();
    });
    it.each([400, 422, 429, 503])('never retries a concurrency failure (%s)', async status => {
        const { env, bodies, fetchImpl } = harness(() => Response.json({ error: { message: 'Concurrency limit exceeded: reasoning_effort' } }, { status }));
        await expect(run(env, fetchImpl)).rejects.toThrow('Concurrency');
        expect(bodies).toHaveLength(1);
    });
    it('does not retry empty content without reasoning exhaustion', async () => {
        const { env, bodies, fetchImpl } = harness(() => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }));
        await expect(run(env, fetchImpl)).rejects.toThrow('empty response');
        expect(bodies).toHaveLength(1);
    });
});

it('a theme completion does not overwrite the segmentation suppression cache', async () => {
    const { env, bodies, fetchImpl } = harness(body => body.reasoning_effort ? reject('reasoning_effort') : answer());
    await runners.electron(env, fetchImpl);
    await runners.electron(env, fetchImpl, false);
    await runners.electron(env, fetchImpl);
    expect(bodies).toHaveLength(4);
    expect(bodies[2].reasoning_effort).toBeUndefined();
    expect(bodies[2].chat_template_kwargs).toBeUndefined();
    expect(bodies[3].chat_template_kwargs).toEqual({ enable_thinking: false });
});

it.each([400, 422])('caches DeepSeek thinking rejection by endpoint/model and supports reset (%s)', async status => {
    const { bodies, fetchImpl } = harness(body => body.thinking ? reject('thinking', status) : answer());
    const send = (url = 'https://proxy.example.test/v1', model = 'deepseek-test') => fetchOpenAICompatible(url,
        { body: JSON.stringify({ model, max_tokens: 8192, response_format: { type: 'json_object' } }) }, 'deepseek', fetchImpl);
    await send(); await send();
    expect(bodies).toHaveLength(3);
    expect(bodies[2].thinking).toBeUndefined();
    await send(undefined, 'other-model');
    expect(bodies).toHaveLength(5);
    await send('https://other.example.test/v1');
    expect(bodies).toHaveLength(7);
    resetOpenAICompatibilityCache(); await send();
    expect(bodies).toHaveLength(9);
    expect(bodies[7].thinking).toEqual({ type: 'disabled' });
});

it('recognizes Pydantic rejection without treating echoed input as the rejected field', () => {
    const text = JSON.stringify({ detail: [{ type: 'extra_forbidden', msg: 'Extra inputs are not permitted',
        loc: ['body', 'thinking'], input: { response_format: { type: 'json_object' } } }] });
    expect(rejectsParameter(422, text, 'thinking')).toBe(true);
    expect(rejectsParameter(422, text, 'response_format')).toBe(false);
    expect(rejectsParameter(422, `OpenAI compatible API error (422): ${text}`, 'response_format')).toBe(false);
    expect(rejectsParameter(422, 'type=extra_forbidden loc=response_format', 'response_format')).toBe(true);
    expect(rejectsParameter(422, 'unsupported chat_template_kwargs', 'thinking')).toBe(false);
});
