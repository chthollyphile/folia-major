import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENAI_MODEL, isShutDown } from '../../../shared/ai/openai.mjs';
import { modelAlwaysThinks, retiredModelHint } from '../../../shared/ai/providerRegistry.mjs';
import { answered, ASKS, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/openaiAdapter.test.ts
// What the OpenAI adapter sends (reasoning_effort per model family, no temperature, the cap in
// max_completion_tokens, the usage chunk asked for when streaming), how its attempts move down,
// its model listing filter and its retired and always-thinking hints. No request leaves the test.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];

/** [label, budget] of every attempt, in order. */
const ladder = (task: AiTask, model: string) => requestsFor('openai', task, model).map(({ attempt, budget }) => [attempt.label, budget]);

describe('reasoning per model family', () => {
    it.each(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-luna-2026-05-01'])(
        '%s: reasoning off for segmentation and the test, low for the theme',
        (model) => {
            expect(ladder('segmentation', model)).toEqual([['reasoning_effort=none', 8192]]);
            expect(ladder('theme', model)).toEqual([['reasoning_effort=low', 8192 + 16384]]);
            expect(ladder('test', model)).toEqual([['reasoning_effort=none', 512]]);
        },
    );

    it.each(['gpt-6-astra', 'gpt-6.1-sol', 'ft:gpt-6-astra:acme::abc123'])('%s, which does not take none: low for every ask, with room to reason', (model) => {
        expect(ladder('segmentation', model)).toEqual([['reasoning_effort=low', 8192 + 24576]]);
        expect(ladder('theme', model)).toEqual([['reasoning_effort=low', 8192 + 16384]]);
        expect(ladder('test', model)).toEqual([['reasoning_effort=low', 512 + 3584]]);
    });

    it.each(['gpt-4.1-mini', 'gpt-4o', 'gpt-3.5-turbo', 'chatgpt-4o-latest'])('%s, which does not reason: no reasoning parameter', (model) => {
        for (const task of TASKS) {
            const requests = requestsFor('openai', task, model);
            expect(requests.map(({ attempt }) => attempt.label)).toEqual(['plain']);
            expect(requests[0].body.reasoning_effort).toBeUndefined();
        }
        expect(ladder('theme', 'gpt-4o')).toEqual([['plain', 8192]]);
    });

    it.each(['gpt-5-mini', 'o3', 'gpt-5.5-chat-latest', 'some-model'])('%s, not known: none, then low, then nothing with room to reason', (model) => {
        expect(ladder('segmentation', model)).toEqual([
            ['reasoning_effort=none', 8192],
            ['reasoning_effort=low', 8192 + 24576],
            ['plain', 8192 + 24576],
        ]);
        expect(ladder('theme', model)).toEqual([
            ['reasoning_effort=low', 8192 + 16384],
            ['plain', 8192 + 16384],
        ]);
        expect(ladder('test', model).map(([label]) => label)).toEqual(['reasoning_effort=none', 'reasoning_effort=low', 'plain']);
    });

    it('never sends minimal, a temperature or max_tokens, whatever the model and the setting', () => {
        for (const model of ['gpt-5.6-luna', 'gpt-6-astra', 'gpt-4o', 'gpt-5-mini', 'o3']) {
            for (const task of TASKS) {
                for (const { body, budget } of requestsFor('openai', task, model, { temperature: 1.5 })) {
                    expect(body.reasoning_effort).not.toBe('minimal');
                    expect(body.temperature).toBeUndefined();
                    expect(body.max_tokens).toBeUndefined();
                    expect(body.max_completion_tokens).toBe(budget);
                }
            }
        }
    });
});

describe('the request body', () => {
    it('asks for the schema as a strict structured output, and the test as a bare hello', () => {
        expect(firstBody('openai', 'theme', DEFAULT_OPENAI_MODEL).response_format).toEqual({
            type: 'json_schema', json_schema: { name: 'dual_theme', strict: true, schema: ASKS.theme.schema },
        });
        expect(firstBody('openai', 'test', DEFAULT_OPENAI_MODEL)).toEqual({
            model: DEFAULT_OPENAI_MODEL,
            messages: [{ role: 'user', content: 'hello' }],
            max_completion_tokens: 512,
            reasoning_effort: 'none',
        });
    });

    it('asks for the usage chunk when streaming, and only then', () => {
        const streamed = firstBody('openai', 'segmentation', DEFAULT_OPENAI_MODEL, { stream: true });
        expect(streamed).toMatchObject({ stream: true, stream_options: { include_usage: true } });
        const plain = firstBody('openai', 'segmentation', DEFAULT_OPENAI_MODEL);
        expect('stream' in plain).toBe(false);
        expect('stream_options' in plain).toBe(false);
        // Other hosts are not asked for it.
        expect(firstBody('custom', 'segmentation', 'm', { stream: true }).stream_options).toBeUndefined();
    });
});

describe('moving down', () => {
    it('to low when the model does not take none, by the wording OpenAI uses', async () => {
        const { bodies, outcome } = await simulate('openai', 'segmentation', 'gpt-5-mini', (_body, index) => (index === 0
            ? rejectedWith(400, { error: {
                message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'low', 'medium', and 'high'.",
                type: 'invalid_request_error', param: 'reasoning_effort', code: 'unsupported_value',
            } })
            : answered('{"lines":[]}')));
        expect(bodies.map(body => body.reasoning_effort)).toEqual(['none', 'low']);
        expect(outcome.index).toBe(1);
    });

    it('to nothing at all when the model takes no reasoning_effort', async () => {
        const { bodies, outcome } = await simulate('openai', 'theme', 'gpt-5.5-chat-latest', (body) => (body.reasoning_effort
            ? rejectedWith(400, 'Unrecognized request argument supplied: reasoning_effort')
            : answered('{}')));
        expect(bodies.map(body => body.reasoning_effort)).toEqual(['low', undefined]);
        expect(outcome.result.content).toBe('{}');
    });

    it('when reasoning ate the budget, and not on a wrong key', async () => {
        const exhausted = await simulate('openai', 'segmentation', 'o3', (_body, index) => (index === 0 ? exhaustedReply() : answered('{}')));
        expect(exhausted.bodies.map(body => body.reasoning_effort)).toEqual(['none', 'low']);

        const unauthorised = await simulate('openai', 'segmentation', 'o3', () => rejectedWith(401, { error: { message: 'Incorrect API key', param: 'reasoning_effort' } }));
        expect(unauthorised.bodies).toHaveLength(1);
    });
});

describe('a streamed desktop request', () => {
    const encoder = new TextEncoder();
    const sse = (...frames: unknown[]) => new Response(new ReadableStream({
        start(controller) {
            for (const frame of frames) {
                controller.enqueue(encoder.encode(`data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`));
            }
            controller.close();
        },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

    it('reads the usage chunk, so an answer reasoning ate moves to the next attempt', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const customFetch = async (_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return bodies.length === 1
                // OpenAI sends no reasoning text: only the usage chunk (no choices) tells it apart.
                ? sse({ choices: [{ delta: { content: '' }, finish_reason: 'length' }] },
                    { choices: [], usage: { completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8192 } } },
                    '[DONE]')
                : sse({ choices: [{ delta: { content: '{"lines":[]}' }, finish_reason: 'stop' }] }, '[DONE]');
        };
        const store = { get: (key: string) => ({
            AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_MODEL: 'gpt-5-nano-stream-test', OPENAI_API_STREAM: true,
        } as Record<string, unknown>)[key] };

        const answer = await client.runAiJsonCompletion({
            store, task: 'segmentation', systemPrompt: 's', sourcePrompt: 'u', customFetch, answerTokens: 8192,
        });

        expect(answer).toBe('{"lines":[]}');
        expect(bodies.map(body => [body.reasoning_effort, body.stream, body.stream_options])).toEqual([
            ['none', true, { include_usage: true }],
            ['low', true, { include_usage: true }],
        ]);
        vi.restoreAllMocks();
    });
});

describe('the model listing', () => {
    it('keeps chat models that are not shut down, from one page of /v1/models', async () => {
        const customFetch = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [
            { id: 'gpt-5.6-luna', shutdown_date: null },
            { id: 'o3' },
            { id: 'chatgpt-4o-latest' },
            { id: 'ft:gpt-4o-mini:acme::abc123' },
            { id: 'gpt-6-luna', shutdown_date: '2999-01-01' },
            { id: 'o4-mini', shutdown_date: '2001-01-01' },
            { id: 'gpt-4o-mini-tts' },
            { id: 'gpt-4o-transcribe' },
            { id: 'gpt-realtime' },
            { id: 'gpt-4o-audio-preview' },
            { id: 'gpt-image-1' },
            { id: 'text-embedding-3-small' },
            { id: 'omni-moderation-latest' },
            { id: 'gpt-4o-search-preview' },
            { id: 'dall-e-3' },
            { id: 'whisper-1' },
            { id: 'babbage-002' },
            // Responses API only.
            { id: 'gpt-5-pro' },
            { id: 'o3-pro-2025-06-10' },
            { id: 'o1-pro' },
            { id: 'gpt-5-codex' },
            { id: 'gpt-5.1-codex-mini' },
        ], has_more: true, last_id: 'whisper-1' }));

        const result = await listAiModels({ provider: 'openai', apiKey: 'test-secret', apiUrl: 'https://api.openai.com/v1' }, { customFetch });

        expect(result).toEqual({ ok: true, models: ['gpt-5.6-luna', 'o3', 'chatgpt-4o-latest', 'ft:gpt-4o-mini:acme::abc123', 'gpt-6-luna'].map(id => ({ id, name: id })) });
        expect(customFetch).toHaveBeenCalledTimes(1);
        expect(customFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    });

    it('counts a shutdown date as reached from the start of that day', () => {
        const day = Date.parse('2026-10-23');
        expect(isShutDown({ shutdown_date: '2026-10-23' }, day - 1)).toBe(false);
        expect(isShutDown({ shutdown_date: '2026-10-23' }, day)).toBe(true);
        expect(isShutDown({ shutdown_date: null }, day)).toBe(false);
        expect(isShutDown({ shutdown_date: 'soon' }, day)).toBe(false);
    });
});

describe('model hints', () => {
    it.each(['gpt-3.5-turbo', 'gpt-3.5-turbo-0125', 'gpt-4', 'gpt-4-0613', 'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4.1-nano',
        'gpt-4o-2024-05-13', 'o1', 'o1-pro', 'o1-2024-12-17', 'o3-mini', 'o4-mini', 'O4-Mini', 'gpt-5.2-chat-latest', 'gpt-5.3-chat-latest'])(
        'suggests the default model for the retired %s',
        (model) => {
            expect(retiredModelHint('openai', model)).toEqual({ model, replacement: DEFAULT_OPENAI_MODEL });
        },
    );

    it.each(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'gpt-5.6-luna', 'gpt-5.4-chat-latest', 'o4-mini-deep-research'])('does not call %s retired', (model) => {
        expect(retiredModelHint('openai', model)).toBeNull();
    });

    it('marks the models whose reasoning cannot be switched off', () => {
        expect(['gpt-6-astra', 'gpt-6.1-sol', 'o3', 'ft:gpt-6-astra:acme::abc'].map(model => modelAlwaysThinks('openai', model))).toEqual([true, true, true, true]);
        expect(['gpt-5.6-luna', 'gpt-6-luna', 'gpt-4o', 'gpt-5-mini'].map(model => modelAlwaysThinks('openai', model))).toEqual([false, false, false, false]);
    });
});
