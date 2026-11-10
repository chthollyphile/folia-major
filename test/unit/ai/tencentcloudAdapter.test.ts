import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REASONING_ALLOWANCE } from '../../../shared/ai/aiTasks.mjs';
import { resetLearnedAttempts } from '../../../shared/ai/attemptRunner.mjs';
import { withErrorHint } from '../../../shared/ai/compatibleBody.mjs';
import { getAiAdapter, inferAiProviderFromUrl, modelAlwaysThinks, resolveAiConnection } from '../../../shared/ai/providerRegistry.mjs';
import { segmentLyricLines } from '../../../shared/lyricSegmentationService.mjs';
import { resetOpenAICompatibleCapabilities } from '../../../shared/openAICompatibleRequest.mjs';
import { ANSWER_TOKENS, answered, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/tencentcloudAdapter.test.ts
// What the TokenHub adapter (shared/ai/tencentcloud.mjs) sends for each ask and model family, when
// it falls back, how its 402 is explained, which models the catalogue keeps, and the same requests
// end to end through the desktop client and the web segmentation route with a fake fetch.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];
const CHINA = 'https://tokenhub.tencentmaas.com/v1';
const DISABLED = { type: 'disabled' };
const TOKENHUB_400002 = (field: string) => ({
    error: { message: `The request parameter ${field} is invalid or missing.`, message_zh: '请求参数无效', code: '400002', type: 'gateway_error' },
});

describe('thinking switches by model family', () => {
    it.each([
        'hy4-preview', 'hy3', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek/deepseek-flash', 'deepseek-v4-flash-202605',
        'glm-5.2', 'glm-5v-turbo', 'kimi-k2.6', 'kimi-k2.5', 'qwen3.5-plus', 'qwen3.5-flash', 'minimax-m3', 'DeepSeek-V4-Flash',
    ])('%s: thinking disabled on every ask, budget for the answer only', model => {
        for (const task of TASKS) {
            const requests = requestsFor('tencentcloud', task, model);
            expect(requests).toHaveLength(1);
            expect(requests[0].body.thinking).toEqual(DISABLED);
            expect(requests[0].body).not.toHaveProperty('reasoning_effort');
            expect(requests[0].body.max_tokens).toBe(ANSWER_TOKENS[task]);
        }
    });

    it.each(['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'kimi-k3'])('%s (cannot switch off): effort low, room to think', model => {
        for (const task of TASKS) {
            const [only, ...rest] = requestsFor('tencentcloud', task, model);
            expect(rest).toEqual([]);
            expect(only.body.reasoning_effort).toBe('low');
            expect(only.body).not.toHaveProperty('thinking');
            expect(only.body.max_tokens).toBe(ANSWER_TOKENS[task] + REASONING_ALLOWANCE[task]);
        }
        expect(modelAlwaysThinks('tencentcloud', model)).toBe(true);
    });

    it.each(['kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'minimax-m2.7', 'minimax-m2.5'])('%s (cannot switch off, no levels): nothing sent, room to think', model => {
        for (const task of TASKS) {
            const [only, ...rest] = requestsFor('tencentcloud', task, model);
            expect(rest).toEqual([]);
            expect(only.body).not.toHaveProperty('thinking');
            expect(only.body).not.toHaveProperty('reasoning_effort');
            expect(only.body.max_tokens).toBe(ANSWER_TOKENS[task] + REASONING_ALLOWANCE[task]);
        }
        expect(modelAlwaysThinks('tencentcloud', model)).toBe(true);
    });

    it.each(['mimo-v2.6-flash', 'kimi-k2.8-preview', 'minimax-m3.1-flash', 'step-5-preview', 'hy-mt2-pro'])('%s (not in the table): thinking disabled, then nothing with room to think', model => {
        expect(requestsFor('tencentcloud', 'segmentation', model).map(({ attempt, budget, body }) => [attempt.label, budget, body.thinking]))
            .toEqual([
                ['thinking=disabled', ANSWER_TOKENS.segmentation, DISABLED],
                ['plain', ANSWER_TOKENS.segmentation + REASONING_ALLOWANCE.segmentation, undefined],
            ]);
        expect(modelAlwaysThinks('tencentcloud', model)).toBe(false);
    });

    it('never sends reasoning_effort none, chat_template_kwargs or a json_schema', () => {
        for (const model of ['deepseek-v4-flash', 'glm-5.3', 'kimi-k3', 'minimax-m2.7', 'unknown-model']) {
            for (const task of TASKS) {
                for (const { body } of requestsFor('tencentcloud', task, model)) {
                    expect(body.reasoning_effort).not.toBe('none');
                    expect(body).not.toHaveProperty('chat_template_kwargs');
                    expect(body.response_format?.type).not.toBe('json_schema');
                }
            }
        }
        expect(firstBody('tencentcloud', 'segmentation', 'deepseek-v4-flash').response_format).toEqual({ type: 'json_object' });
    });
});

describe('temperature by model family', () => {
    it.each([
        ['hy3', 0.7, 0.7],
        ['deepseek-v4-flash', 2, 2],
        ['qwen3.5-plus', 1.3, 1.3],
        ['glm-5.2', 1.5, 1],
        ['glm-5.3-flash', 0.4, 0.4],
    ])('%s takes the temperature (%s sent as %s)', (model, setting, expected) => {
        expect(firstBody('tencentcloud', 'theme', model, { temperature: setting }).temperature).toBe(expected);
    });

    it.each(['kimi-k2.6', 'kimi-k3', 'minimax-m3', 'mimo-v2.6-flash', 'unknown-model', 'hunyuan-role-latest'])('%s gets none', model => {
        for (const { body } of requestsFor('tencentcloud', 'segmentation', model)) {
            expect(body).not.toHaveProperty('temperature');
        }
    });
});

describe('falling back', () => {
    it('moves a model not in the table on when TokenHub calls the switch invalid', async () => {
        const { bodies, outcome } = await simulate('tencentcloud', 'segmentation', 'step-5-preview', (_body, index) => (
            index === 0 ? rejectedWith(400, TOKENHUB_400002('thinking')) : answered('{"lines":[]}')
        ));
        expect(bodies.map(body => body.thinking)).toEqual([DISABLED, undefined]);
        expect(outcome).toMatchObject({ index: 1 });
    });

    it('moves on when the model kept thinking and spent the budget', async () => {
        const { bodies, outcome } = await simulate('tencentcloud', 'theme', 'step-5-preview', (_body, index) => (
            index === 0 ? exhaustedReply() : answered('{}')
        ));
        expect(bodies.map(body => body.max_tokens)).toEqual([ANSWER_TOKENS.theme, ANSWER_TOKENS.theme + REASONING_ALLOWANCE.theme]);
        expect(outcome).toMatchObject({ index: 1 });
    });

    it.each([
        ['another parameter', 400, TOKENHUB_400002('messages')],
        ['a model that is not activated', 402, { error: { message: 'Service not activated', code: '401007', type: 'gateway_error' } }],
        ['a wrong key', 401, { error: { message: 'Invalid API key', code: '401002' } }],
    ])('does not move on for %s', async (_name, status, body) => {
        const { bodies } = await simulate('tencentcloud', 'segmentation', 'step-5-preview', () => rejectedWith(status, body));
        expect(bodies).toHaveLength(1);
    });
});

describe('the 402 hint', () => {
    const adapter = getAiAdapter('tencentcloud')!;

    it('adds a sentence to the error line of a 402 only, and keeps the raw body', () => {
        const failed = { ok: false, status: 402, errorText: 'OpenAI compatible API error (402): Service not activated', errorBody: '{"error":{}}' };
        const hinted = withErrorHint(adapter, failed);
        expect(hinted.errorText).toMatch(/^OpenAI compatible API error \(402\): Service not activated \(TokenHub answers 402 when this model is not activated.*console/);
        expect(hinted.errorBody).toBe(failed.errorBody);
        expect(withErrorHint(adapter, { ...failed, status: 401 })).toEqual({ ...failed, status: 401 });
        expect(withErrorHint(getAiAdapter('custom')!, failed)).toBe(failed);
        expect(withErrorHint(adapter, { ok: true, status: 200, content: '{}' })).toEqual({ ok: true, status: 200, content: '{}' });
    });
});

describe('settings', () => {
    it('recognises both domain families and the US site, but not the retired lkeap and Hunyuan addresses', () => {
        for (const url of [CHINA, 'https://tokenhub-intl.tencentcloudmaas.com/v1', 'https://tokenhub.tencentmaas.cn/v1', 'https://tokenhub-us.tencentcloudmaas.tech/v1']) {
            expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: url }), url)
                .toMatchObject({ presetId: 'tencentcloud', adapterId: 'tencentcloud', model: 'deepseek-v4-flash' });
        }
        expect(inferAiProviderFromUrl('https://api.lkeap.cloud.tencent.com/v1')).toBe('custom');
        expect(inferAiProviderFromUrl('https://api.hunyuan.cloud.tencent.com/v1')).toBe('custom');
        // An old lkeap setting keeps the custom ladder, even with the preset still saved.
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'tencentcloud', OPENAI_API_URL: 'https://api.lkeap.cloud.tencent.com/v1' }))
            .toMatchObject({ presetId: 'custom', adapterId: 'custom' });
    });
});

describe('model catalogue', () => {
    it('keeps online models with their names', async () => {
        const customFetch = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [
            { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', status: 'online' },
            { id: 'glm-5v-turbo', name: 'GLM-5V-Turbo', status: 'pre-offline' },
            { id: 'hy3', name: 'Hy3', status: 'offline' },
            { id: 'kimi-k3' },
        ] }));
        expect(await listAiModels({ provider: 'openai', apiKey: 'test-secret', apiUrl: CHINA }, { customFetch })).toEqual({
            ok: true, models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }, { id: 'kimi-k3', name: 'kimi-k3' }],
        });
        expect(customFetch.mock.calls[0][0]).toBe(`${CHINA}/models`);
    });
});

describe('end to end', () => {
    const KEY = 'test-key';
    type Recorded = { url: string; body: any };
    const record = (answers: Array<() => Response>) => {
        const requests: Recorded[] = [];
        const customFetch = async (url: string | URL | Request, init?: any) => {
            requests.push({ url: String(url), body: JSON.parse(init.body) });
            return answers[Math.min(requests.length - 1, answers.length - 1)]();
        };
        return { requests, customFetch };
    };
    const reply = (content: string) => () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
    const status = (code: number, body: unknown) => () => Response.json(body, { status: code });
    const storeWith = (settings: Record<string, unknown>) => ({ get: (key: string) => settings[key] });

    beforeEach(() => {
        resetLearnedAttempts();
        resetOpenAICompatibleCapabilities();
        for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('desktop segmentation: the default model with thinking off, falling back when a model does not take it', async () => {
        const { requests, customFetch } = record([reply('{"lines":[]}')]);
        await client.runAiJsonCompletion({
            store: storeWith({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: CHINA }),
            task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source', schema: { type: 'object' }, schemaName: 'x', answerTokens: 8192, customFetch,
        });
        expect(requests[0].url).toBe(`${CHINA}/chat/completions`);
        expect(requests[0].body).toMatchObject({ model: 'deepseek-v4-flash', thinking: DISABLED, max_tokens: 8192, temperature: 0.7, response_format: { type: 'json_object' } });

        const fallback = record([status(400, TOKENHUB_400002('thinking')), reply('{"lines":[]}')]);
        await client.runAiJsonCompletion({
            store: storeWith({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: CHINA, OPENAI_API_MODEL: 'step-5-preview' }),
            task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source', schema: { type: 'object' }, schemaName: 'x', answerTokens: 8192, customFetch: fallback.customFetch,
        });
        expect(fallback.requests.map(({ body }) => [body.thinking, body.max_tokens, body.temperature])).toEqual([
            [DISABLED, 8192, undefined],
            [undefined, 8192 + REASONING_ALLOWANCE.segmentation, undefined],
        ]);
    });

    it('desktop: a 402 says to activate the model, in the asks and in the connection test', async () => {
        const notActivated = status(402, { error: { message: 'The endpoint has no free package', code: '401007', type: 'gateway_error' } });
        await expect(client.runAiJsonCompletion({
            store: storeWith({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: CHINA }),
            task: 'theme', systemPrompt: 'system', sourcePrompt: 'source', schema: { type: 'object' }, schemaName: 'x', answerTokens: 8192,
            customFetch: record([notActivated]).customFetch,
        })).rejects.toThrow(/\(402\): The endpoint has no free package \(TokenHub answers 402 .*TokenHub console/);

        const result = await client.runAiConnectionTest({ provider: 'openai', apiKey: KEY, apiUrl: CHINA, model: 'glm-5.3' }, { customFetch: record([notActivated]).customFetch });
        expect(result).toMatchObject({ ok: false, status: 402, errorKind: 'http' });
        expect(result.error).toMatch(/activate it .*TokenHub console/);
    });

    it('desktop connection test: hello with the model\'s switch', async () => {
        const { requests, customFetch } = record([reply('Hi')]);
        await client.runAiConnectionTest({ provider: 'openai', apiKey: KEY, apiUrl: CHINA, model: 'glm-5.3' }, { customFetch });
        expect(requests[0].body).toEqual({
            model: 'glm-5.3', messages: [{ role: 'user', content: 'hello' }], max_tokens: 512 + REASONING_ALLOWANCE.test, reasoning_effort: 'low',
        });
    });

    it('web segmentation: the same request, and the same 402 hint', async () => {
        const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: 'https://tokenhub-intl.tencentcloudmaas.com/v1', OPENAI_API_MODEL: 'hy3' };
        const ok = record([reply('{"lines":[[1]]}')]);
        await segmentLyricLines(['ab'], env, ok.customFetch).catch(() => {});
        expect(ok.requests[0].body).toMatchObject({ model: 'hy3', thinking: DISABLED, max_tokens: 8192, temperature: 0.7 });

        const notActivated = record([status(402, { error: { message: 'Insufficient balance', code: '403004' } })]);
        await expect(segmentLyricLines(['ab'], { ...env, OPENAI_API_URL: 'https://tokenhub-intl.tencentmaas.com/v1' }, notActivated.customFetch))
            .rejects.toThrow(/Insufficient balance \(TokenHub answers 402/);
    });
});
