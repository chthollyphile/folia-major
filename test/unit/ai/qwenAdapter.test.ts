import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REASONING_ALLOWANCE } from '../../../shared/ai/aiTasks.mjs';
import { resetLearnedAttempts } from '../../../shared/ai/attemptRunner.mjs';
import { modelAlwaysThinks, resolveAiConnection } from '../../../shared/ai/providerRegistry.mjs';
import { SEGMENTATION_SCHEMA_NAME } from '../../../shared/lyricSegmentationPrompt.mjs';
import { resetOpenAICompatibleCapabilities } from '../../../shared/openAICompatibleRequest.mjs';
import { ANSWER_TOKENS, answered, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/qwenAdapter.test.ts
// What the Qwen adapter (shared/ai/qwen.mjs) sends to Model Studio for each ask and model, when it
// falls back, how it reads the model catalogue, and the same request end to end through the
// desktop client with a fake fetch.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];
const reasoningOf = (body: Record<string, any>) => ({
    enable_thinking: body.enable_thinking,
    reasoning_effort: body.reasoning_effort,
    thinking_budget: body.thinking_budget,
});

describe('thinking switches by model', () => {
    it.each([
        'qwen3.8-flash', 'qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-max', 'qwen3.7-max-2026-05-20', 'qwen3.6-flash',
        'qwen3.5-plus', 'qwen3.5-flash-2026-02-23', 'qwen-plus', 'qwen-plus-2025-04-28', 'qwen-flash', 'QWEN3.8-FLASH',
    ])('%s (hybrid): enable_thinking false at the top level on every ask, budget for the answer only; nothing if that is refused', model => {
        for (const task of TASKS) {
            const [off, fallback, ...rest] = requestsFor('qwen', task, model);
            expect(rest).toEqual([]);
            expect(reasoningOf(off.body)).toEqual({ enable_thinking: false, reasoning_effort: undefined, thinking_budget: undefined });
            expect(off.body.max_tokens).toBe(ANSWER_TOKENS[task]);
            expect(reasoningOf(fallback.body)).toEqual({ enable_thinking: undefined, reasoning_effort: undefined, thinking_budget: undefined });
            expect(fallback.body.max_tokens).toBe(ANSWER_TOKENS[task] + REASONING_ALLOWANCE[task]);
        }
    });

    it('qwen3.8-2.4t-a95b (thinking only): effort low on every ask, never with thinking_budget', () => {
        for (const task of TASKS) {
            const [only, ...rest] = requestsFor('qwen', task, 'qwen3.8-2.4t-a95b');
            expect(rest).toEqual([]);
            expect(reasoningOf(only.body)).toEqual({ enable_thinking: undefined, reasoning_effort: 'low', thinking_budget: undefined });
            expect(only.body.max_tokens).toBe(ANSWER_TOKENS[task] + REASONING_ALLOWANCE[task]);
        }
    });

    it.each(['qwen3.7-max-preview', 'qwen3.7-max-2026-05-17'])('%s (thinking only): a capped chain of thought for segmentation and the test, the default for the theme', model => {
        for (const task of ['segmentation', 'test'] as AiTask[]) {
            const [only, ...rest] = requestsFor('qwen', task, model);
            expect(rest).toEqual([]);
            expect(reasoningOf(only.body)).toEqual({ enable_thinking: undefined, reasoning_effort: undefined, thinking_budget: 2048 });
            expect(only.body.max_tokens).toBe(ANSWER_TOKENS[task] + REASONING_ALLOWANCE[task]);
        }
        const [theme, ...rest] = requestsFor('qwen', 'theme', model);
        expect(rest).toEqual([]);
        expect(reasoningOf(theme.body)).toEqual({ enable_thinking: undefined, reasoning_effort: undefined, thinking_budget: undefined });
        expect(theme.body.max_tokens).toBe(ANSWER_TOKENS.theme + REASONING_ALLOWANCE.theme);
    });

    it('qwen-max (no thinking): nothing reasoning-related, budget for the answer only', () => {
        for (const task of TASKS) {
            const [only, ...rest] = requestsFor('qwen', task, 'qwen-max-latest');
            expect(rest).toEqual([]);
            expect(reasoningOf(only.body)).toEqual({ enable_thinking: undefined, reasoning_effort: undefined, thinking_budget: undefined });
            expect(only.body.max_tokens).toBe(ANSWER_TOKENS[task]);
        }
    });

    it.each(['qwen3-235b-a22b', 'qwen-turbo', 'glm-5.3', 'kimi/kimi-k3'])('%s (not named): enable_thinking false, then nothing with room to think', model => {
        expect(requestsFor('qwen', 'segmentation', model).map(({ attempt, budget, body }) => [attempt.label, budget, body.enable_thinking]))
            .toEqual([
                ['enable_thinking=false', ANSWER_TOKENS.segmentation, false],
                ['plain', ANSWER_TOKENS.segmentation + REASONING_ALLOWANCE.segmentation, undefined],
            ]);
    });

    it('never sends the generic ladder\'s reasoning_effort none or chat_template_kwargs', () => {
        for (const model of ['qwen3.8-flash', 'qwen3.5-plus', 'qwen3-235b-a22b', 'qwen3.8-2.4t-a95b', 'qwen3.7-max-preview', 'qwen-max']) {
            for (const task of TASKS) {
                for (const { body } of requestsFor('qwen', task, model)) {
                    expect(body.reasoning_effort).not.toBe('none');
                    expect(body).not.toHaveProperty('chat_template_kwargs');
                }
            }
        }
    });

    it('knows which models cannot switch thinking off', () => {
        expect(modelAlwaysThinks('qwen', 'qwen3.8-2.4t-a95b')).toBe(true);
        expect(modelAlwaysThinks('qwen', 'Qwen3.7-Max-Preview')).toBe(true);
        expect(modelAlwaysThinks('qwen', 'qwen3.7-max-2026-05-17')).toBe(true);
        expect(modelAlwaysThinks('qwen', 'qwen3.7-max')).toBe(false);
        expect(modelAlwaysThinks('qwen', 'qwen3.8-flash')).toBe(false);
    });
});

describe('temperature, token cap and JSON mode', () => {
    it('sends the temperature, below 2: Qwen takes [0, 2)', () => {
        expect(firstBody('qwen', 'segmentation', 'qwen3.8-flash').temperature).toBe(0.7);
        expect(firstBody('qwen', 'theme', 'qwen3.8-flash', { temperature: 2 }).temperature).toBe(1.99);
        expect(firstBody('qwen', 'theme', 'qwen3.8-flash', { temperature: 0 }).temperature).toBe(0);
        expect(firstBody('qwen', 'test', 'qwen3.8-flash')).not.toHaveProperty('temperature');
    });

    it('caps with max_tokens, never max_completion_tokens', () => {
        const body = firstBody('qwen', 'segmentation', 'qwen3.8-flash');
        expect(body.max_tokens).toBe(ANSWER_TOKENS.segmentation);
        expect(body).not.toHaveProperty('max_completion_tokens');
    });

    it.each(['qwen3.8-flash', 'qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.7-max', 'qwen3.7-max-2026-05-20'])('gives %s a strict json_schema', model => {
        for (const task of ['segmentation', 'theme'] as AiTask[]) {
            expect(firstBody('qwen', task, model).response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
        }
        expect(firstBody('qwen', 'segmentation', model).response_format.json_schema.name).toBe(SEGMENTATION_SCHEMA_NAME);
    });

    it.each(['qwen3.6-plus', 'qwen3.5-flash', 'qwen-plus', 'qwen-max', 'qwen3.8-27b', 'qwen3.8-omni-flash', 'qwen3-235b-a22b'])('gives %s plain JSON mode', model => {
        expect(firstBody('qwen', 'segmentation', model).response_format).toEqual({ type: 'json_object' });
    });

    it('sends no JSON mode with the test hello', () => {
        expect(firstBody('qwen', 'test', 'qwen3.8-flash')).not.toHaveProperty('response_format');
    });
});

describe('falling back', () => {
    it.each([
        ['restricted to True', { error: { message: '<400> InternalError.Algo.InvalidParameter: The value of the enable_thinking parameter is restricted to True.', type: 'invalid_request_error', code: 'invalid_parameter_error' } }],
        ['does not support', { error: { message: 'The model qwen3-coder does not support enable_thinking.', code: 'InvalidParameter.NotSupportEnableThinking' } }],
        ['error.param', { error: { message: 'Invalid value', param: 'enable_thinking', code: 'invalid_parameter_error' } }],
    ])('moves an unnamed model on when the switch is refused (%s)', async (_name, refusal) => {
        const { bodies, outcome } = await simulate('qwen', 'segmentation', 'qwen3-coder-plus', (_body, index) => (
            index === 0 ? rejectedWith(400, refusal) : answered('{"lines":[]}')
        ));
        expect(bodies.map(body => body.enable_thinking)).toEqual([false, undefined]);
        expect(outcome).toMatchObject({ index: 1, result: { content: '{"lines":[]}' } });
    });

    it.each([
        ['a wrong key', 401, { error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } }],
        ['an unknown model', 404, { error: { message: 'The model `qwen-x` does not exist or you do not have access to it.', code: 'model_not_found' } }],
        ['a rate limit', 429, { error: { message: 'Requests rate limit exceeded', code: 'limit_requests' } }],
        ['an echoed request body', 400, { error: { message: 'Range of max_tokens should be [1, 8192]' }, request: { enable_thinking: false } }],
        ['the json mode prompt check', 400, { error: { message: "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'." } }],
    ])('does not move on for %s', async (_name, status, body) => {
        const { bodies, outcome } = await simulate('qwen', 'segmentation', 'qwen3-coder-plus', () => rejectedWith(status, body));
        expect(bodies).toHaveLength(1);
        expect(outcome).toMatchObject({ index: 0, result: { ok: false, status } });
    });

    it('refuses thinking_budget in Model Studio\'s words as well', async () => {
        const qwen = (await import('../../../shared/ai/qwen.mjs')).qwenAdapter;
        const refusal = JSON.stringify({ error: { message: 'The thinking_budget parameter must be a positive integer and not greater than 1024' } });
        expect(qwen.rejectedParameter?.(400, refusal, 'thinking_budget')).toBe(true);
        expect(qwen.rejectedParameter?.(400, refusal, 'enable_thinking')).toBe(false);
        expect(qwen.rejectedParameter?.(500, refusal, 'thinking_budget')).toBe(false);
    });
});

describe('settings', () => {
    it('defaults a blank model to qwen3.8-flash on every regional site', () => {
        for (const url of [
            'https://dashscope.aliyuncs.com/compatible-mode/v1',
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
            'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
            'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
            'https://ws-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        ]) {
            expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: url }), url)
                .toMatchObject({ presetId: 'qwen', adapterId: 'qwen', model: 'qwen3.8-flash' });
        }
    });
});

describe('model catalogue', () => {
    const payload = { provider: 'openai', apiKey: 'test-secret', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };
    const json = (value: unknown) => Response.json(value);

    it('reads OpenAI\'s data[].id', async () => {
        const customFetch = vi.fn().mockResolvedValue(json({ object: 'list', data: [{ id: 'qwen3.8-flash', object: 'model' }, { id: 'qwen3.7-plus' }] }));
        expect(await listAiModels(payload, { customFetch })).toEqual({
            ok: true, models: [{ id: 'qwen3.8-flash', name: 'qwen3.8-flash' }, { id: 'qwen3.7-plus', name: 'qwen3.7-plus' }],
        });
        expect(new URL(customFetch.mock.calls[0][0]).pathname).toBe('/compatible-mode/v1/models');
    });

    it('reads the native output.models[] with display names, page by page', async () => {
        const customFetch = vi.fn()
            .mockResolvedValueOnce(json({ output: { total: 3, page_no: 1, page_size: 2, models: [{ model: 'qwen3.8-max', name: 'Qwen3.8-Max' }, { model: 'qwen3.8-flash', name: 'Qwen3.8-Flash' }] } }))
            .mockResolvedValueOnce(json({ output: { total: 3, page_no: 2, page_size: 2, models: [{ model: 'qwen3.7-plus' }] } }));
        expect(await listAiModels(payload, { customFetch })).toEqual({
            ok: true,
            models: [{ id: 'qwen3.8-max', name: 'Qwen3.8-Max' }, { id: 'qwen3.8-flash', name: 'Qwen3.8-Flash' }, { id: 'qwen3.7-plus', name: 'qwen3.7-plus' }],
        });
        expect(customFetch).toHaveBeenCalledTimes(2);
        expect(new URL(customFetch.mock.calls[1][0]).searchParams.get('page_no')).toBe('2');
    });

    it('treats any other shape as malformed, and still suggests models', async () => {
        expect(await listAiModels(payload, { customFetch: async () => json({ output: { text: 'hi' } }) })).toEqual({
            ok: false, errorKind: 'invalid', suggestedModels: ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max'],
        });
    });
});

describe('through the desktop client', () => {
    const KEY = 'test-key';
    const SINGAPORE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    type Recorded = { url: string; body: any };
    const record = (content: string) => {
        const requests: Recorded[] = [];
        const customFetch = async (url: string, init: any) => {
            requests.push({ url, body: JSON.parse(init.body) });
            return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
        };
        return { requests, customFetch };
    };

    beforeEach(() => {
        resetLearnedAttempts();
        resetOpenAICompatibleCapabilities();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('segments with the default model, thinking off and a strict schema', async () => {
        const { requests, customFetch } = record('{"lines":[]}');
        const store = { get: (key: string) => ({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: SINGAPORE, OPENAI_API_TEMPERATURE: '2' } as Record<string, unknown>)[key] };
        await client.runAiJsonCompletion({
            store, task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source',
            schema: { type: 'object' }, schemaName: 'lyric_segmentation', answerTokens: 8192, customFetch,
        });
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(`${SINGAPORE}/chat/completions`);
        expect(requests[0].body).toMatchObject({
            model: 'qwen3.8-flash', enable_thinking: false, max_tokens: 8192, temperature: 1.99,
            response_format: { type: 'json_schema', json_schema: { name: 'lyric_segmentation', strict: true } },
        });
    });

    it('tests the connection with the same switch and no temperature', async () => {
        const { requests, customFetch } = record('Hello!');
        const result = await client.runAiConnectionTest({ provider: 'openai', apiKey: KEY, apiUrl: SINGAPORE, model: 'qwen3.5-plus' }, { customFetch });
        expect(result).toMatchObject({ ok: true, text: 'Hello!' });
        expect(requests[0].body).toEqual({ model: 'qwen3.5-plus', messages: [{ role: 'user', content: 'hello' }], max_tokens: 512, enable_thinking: false });
    });
});
