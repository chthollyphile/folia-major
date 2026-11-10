import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiAdapter, AI_PROVIDER_PRESETS, inferAiProviderFromUrl, modelAlwaysThinks, resolveAiConnection } from '../../../shared/ai/providerRegistry.mjs';
import { segmentLyricLines } from '../../../shared/lyricSegmentationService.mjs';
import { answered, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/glmAdapter.test.ts
// What the GLM adapter sends (reasoning per model family, the temperature clamped to 0..1,
// max_tokens, plain JSON mode) on both sites, which of GLM's error codes move to the next attempt,
// and that it lists no models but suggests some. The desktop client and the web segmentation
// service are each driven once with a fake fetch; no request leaves the test.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];
const ladder = (task: AiTask, model: string) => requestsFor('glm', task, model).map(({ attempt, budget }) => [attempt.label, budget]);
const adapter = getAiAdapter('glm')!;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('reasoning per model family', () => {
    it.each(['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.3-flashx-legal'])('%s, which always thinks: low, then nothing, with room to reason', (model) => {
        expect(ladder('segmentation', model)).toEqual([['reasoning_effort=low', 8192 + 24576], ['plain', 8192 + 24576]]);
        expect(ladder('theme', model)).toEqual([['reasoning_effort=low', 8192 + 16384], ['plain', 8192 + 16384]]);
        expect(ladder('test', model)).toEqual([['reasoning_effort=low', 512 + 3584], ['plain', 512 + 3584]]);
    });

    it('switches glm-5.2 off with none for every ask, the theme too (its low is mapped to high)', () => {
        for (const task of TASKS) {
            const requests = requestsFor('glm', task, 'glm-5.2');
            expect(requests.map(({ attempt }) => attempt.label)).toEqual(['reasoning_effort=none', 'thinking=disabled', 'plain']);
            expect(requests[0].body.thinking).toBeUndefined();
        }
        expect(ladder('theme', 'glm-5.2')).toEqual([['reasoning_effort=none', 8192], ['thinking=disabled', 8192], ['plain', 8192 + 16384]]);
    });

    it('tries the thinking switch of glm-5.2 when an endpoint rejects the level', async () => {
        const { bodies } = await simulate('glm', 'segmentation', 'glm-5.2', (_body, index) => (index === 0
            ? rejectedWith(400, { error: { code: '1214', message: 'Parameter `reasoning_effort` is invalid. Please check the documentation.' } })
            : answered('{}')));
        expect(bodies.map(body => [body.reasoning_effort, body.thinking])).toEqual([['none', undefined], [undefined, { type: 'disabled' }]]);
    });

    it.each(['glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6', 'glm-4.6v', 'glm-4.5', 'glm-4.5-air'])('switches %s off with the thinking switch', (model) => {
        for (const task of TASKS) {
            expect(ladder(task, model)).toEqual([['thinking=disabled', { segmentation: 8192, theme: 8192, test: 512 }[task]]]);
        }
        expect(firstBody('glm', 'segmentation', model).thinking).toEqual({ type: 'disabled' });
    });

    it.each(['glm-4-plus', 'glm-4-flash-250414', 'glm-4'])('sends %s, which does not think, nothing reasoning-related', (model) => {
        expect(ladder('segmentation', model)).toEqual([['plain', 8192]]);
    });

    it.each(['glm-6', 'glm-5.5-air', 'some-model'])('tries %s with the switch, then low, then nothing', (model) => {
        expect(ladder('segmentation', model)).toEqual([
            ['thinking=disabled', 8192],
            ['reasoning_effort=low', 8192 + 24576],
            ['plain', 8192 + 24576],
        ]);
    });

    it('never sends the disabled switch to the forced-thinking family, nor anything but low to it', () => {
        for (const model of ['glm-5.3', 'glm-5.3-flash']) {
            for (const task of TASKS) {
                for (const { body } of requestsFor('glm', task, model)) {
                    expect(body.thinking).toBeUndefined();
                    expect([undefined, 'low']).toContain(body.reasoning_effort);
                }
            }
        }
    });
});

describe('GLM\'s error codes', () => {
    const glm1210 = rejectedWith(400, { error: { code: '1210', message: 'Invalid API parameter, please check the documentation.' } });
    const glm1210cn = rejectedWith(400, { error: { code: '1210', message: 'API 调用参数有误，请检查文档' } });

    it.each([['Z.ai', glm1210], ['open.bigmodel.cn', glm1210cn]])('takes a %s 1210, which names nothing, as this attempt\'s knobs rejected', async (_site, rejection) => {
        const { bodies, outcome } = await simulate('glm', 'segmentation', 'glm-next', (_body, index) => (index === 0 ? rejection : answered('{}')));
        expect(bodies.map(body => [body.thinking, body.reasoning_effort])).toEqual([[{ type: 'disabled' }, undefined], [undefined, 'low']]);
        expect(outcome.index).toBe(1);
    });

    it.each([
        ['Z.ai', 'Parameter `reasoning_effort` is invalid. Please check the documentation.'],
        ['open.bigmodel.cn', '`reasoning_effort` 参数非法。请检查文档'],
    ])('takes a %s 1214 that names the knob as its rejection', async (_site, message) => {
        const { bodies } = await simulate('glm', 'segmentation', 'glm-5.3-flash', (_body, index) => (
            index === 0 ? rejectedWith(400, { error: { code: '1214', message } }) : answered('{}')));
        expect(bodies.map(body => body.reasoning_effort)).toEqual(['low', undefined]);
    });

    it('names a sub-path of the field too, and only the asked field', () => {
        const thinkingType = JSON.stringify({ error: { code: '1214', message: '`thinking.type` 参数非法。请检查文档' } });
        expect(adapter.rejectedParameter!(400, thinkingType, 'thinking')).toBe(true);
        expect(adapter.rejectedParameter!(400, thinkingType, 'reasoning_effort')).toBe(false);
        const temperature = JSON.stringify({ error: { code: '1214', message: '`temperature` 参数非法。请检查文档' } });
        expect(adapter.rejectedParameter!(400, temperature, 'thinking')).toBe(false);
    });

    it('does not move on for other codes, or other statuses', () => {
        const unknownModel = JSON.stringify({ error: { code: '1211', message: 'Unknown Model, please check the model code.' } });
        expect(adapter.rejectedParameter!(400, unknownModel, 'thinking')).toBe(false);
        expect(adapter.rejectedParameter!(429, JSON.stringify({ error: { code: '1210', message: 'x' } }), 'thinking')).toBe(false);
        expect(adapter.rejectedParameter!(400, 'not json', 'thinking')).toBe(false);
    });

    it('fails on the last attempt as it came when a 1210 has another cause', async () => {
        const { bodies, outcome } = await simulate('glm', 'segmentation', 'glm-next', () => glm1210);
        expect(bodies).toHaveLength(3);
        expect(outcome.result).toBe(glm1210);
    });

    it('moves on when reasoning ate the budget', async () => {
        const { bodies } = await simulate('glm', 'theme', 'glm-next', (_body, index) => (index === 0 ? exhaustedReply() : answered('{}')));
        expect(bodies.map(body => body.reasoning_effort)).toEqual([undefined, 'low']);
    });
});

describe('the request body', () => {
    it('clamps the temperature to 0..1 and sends none with the test', () => {
        expect(firstBody('glm', 'theme', 'glm-5.2', { temperature: 1.6 }).temperature).toBe(1);
        expect(firstBody('glm', 'segmentation', 'glm-5.3-flash', { temperature: 0.4 }).temperature).toBe(0.4);
        expect(firstBody('glm', 'test', 'glm-5.2').temperature).toBeUndefined();
        expect(adapter.temperature).toEqual({ min: 0, max: 1 });
    });

    it('caps in max_tokens and asks for plain JSON mode', () => {
        for (const { body, budget } of requestsFor('glm', 'segmentation', 'glm-5.3-flash')) {
            expect(body.max_tokens).toBe(budget);
            expect(body.max_completion_tokens).toBeUndefined();
            expect(body.response_format).toEqual({ type: 'json_object' });
        }
    });
});

describe('sites, defaults and models', () => {
    it('offers the China site first and Z.ai, both inferred as GLM, and Coding Plan addresses too', () => {
        const preset = AI_PROVIDER_PRESETS.find(entry => entry.id === 'glm');
        expect(preset?.endpoints).toEqual([
            { id: 'cn', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
            { id: 'global', baseUrl: 'https://api.z.ai/api/paas/v4' },
        ]);
        for (const url of [...(preset?.endpoints ?? []).map(endpoint => endpoint.baseUrl), 'https://api.z.ai/api/coding/paas/v4']) {
            expect(inferAiProviderFromUrl(url)).toBe('glm');
        }
    });

    it('uses glm-5.2 when the model is left blank, and suggests models instead of listing them', () => {
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.z.ai/api/paas/v4' }))
            .toMatchObject({ adapterId: 'glm', model: 'glm-5.2' });
        expect(adapter.models).toBeNull();
        const preset = AI_PROVIDER_PRESETS.find(entry => entry.id === 'glm');
        expect(preset?.recommendedModel).toBe('glm-5.2');
        expect(preset?.suggestedModels).toEqual(['glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-4.7-flash']);
    });

    it('marks the forced-thinking family', () => {
        expect(['glm-5.3', 'glm-5.3-flash', 'GLM-5.3-FlashX', 'glm-5.2', 'glm-4.7'].map(model => modelAlwaysThinks('glm', model)))
            .toEqual([true, true, true, false, false]);
    });
});

describe('end to end', () => {
    const answer = (content: string) => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });

    it('the desktop segmentation ask to Z.ai with glm-5.3-flash: low, the clamped temperature, max_tokens', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const requests: { url: string; body: Record<string, unknown> }[] = [];
        const customFetch = async (url: string, init: { body: string }) => {
            requests.push({ url, body: JSON.parse(init.body) });
            return answer('{"lines":[]}');
        };
        const store = { get: (key: string) => ({
            AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://api.z.ai/api/paas/v4',
            OPENAI_API_MODEL: 'glm-5.3-flash', OPENAI_API_TEMPERATURE: '1.5',
        } as Record<string, unknown>)[key] };

        await client.runAiJsonCompletion({
            store, task: 'segmentation', systemPrompt: 's', sourcePrompt: 'u', schema: { type: 'object' }, schemaName: 'x', customFetch, answerTokens: 8192,
        });

        expect(requests).toEqual([{
            url: 'https://api.z.ai/api/paas/v4/chat/completions',
            body: {
                model: 'glm-5.3-flash',
                messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
                temperature: 1,
                max_tokens: 8192 + 24576,
                reasoning_effort: 'low',
                response_format: { type: 'json_object' },
            },
        }]);
    });

    // GLM's 1210 names no field, so it may be about JSON mode as much as the reasoning switch
    // (response_format is documented for text models only, and glm-5.3-flash is a vision one).
    const unnamed = () => Response.json({ error: { code: '1210', message: 'Invalid API parameter, please check the documentation.' } }, { status: 400 });
    const storeFor = (url: string, model: string) => ({ get: (key: string) => ({
        AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: url, OPENAI_API_MODEL: model,
    } as Record<string, unknown>)[key] });
    const segment = (store: { get: (key: string) => unknown }, customFetch: unknown) => client.runAiJsonCompletion({
        store, task: 'segmentation', systemPrompt: 's', sourcePrompt: 'u', customFetch, answerTokens: 8192,
    });

    it('retries a 1210 without JSON mode first, and keeps it off once that works', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const customFetch = async (_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.response_format ? unnamed() : answer('{"lines":[]}');
        };
        const store = storeFor('https://open.bigmodel.cn/api/paas/v4', 'glm-5.3-flash');

        await segment(store, customFetch);
        await segment(store, customFetch);

        expect(bodies.map(body => [body.reasoning_effort, body.response_format])).toEqual([
            ['low', { type: 'json_object' }],
            ['low', undefined],
            ['low', undefined],
        ]);
    });

    it('takes a 1210 that is not about JSON mode as the reasoning switch, and keeps JSON mode', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const customFetch = async (_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.thinking ? unnamed() : answer('{"lines":[]}');
        };
        const store = storeFor('https://open.bigmodel.cn/api/paas/v4', 'glm-6-preview');

        await segment(store, customFetch);
        await segment(store, customFetch);

        expect(bodies.map(body => [body.thinking, body.reasoning_effort, body.response_format])).toEqual([
            [{ type: 'disabled' }, undefined, { type: 'json_object' }],
            [{ type: 'disabled' }, undefined, undefined],
            [undefined, 'low', { type: 'json_object' }],
            // Learned: the low level, still in JSON mode.
            [undefined, 'low', { type: 'json_object' }],
        ]);
    });

    it('moves an unknown model past a rejected switch on Z.ai to the low level', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const customFetch = async (_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.thinking
                ? Response.json({ error: { code: '1214', message: 'Parameter `thinking` is invalid' } }, { status: 400 })
                : answer('{"lines":[]}');
        };

        await segment(storeFor('https://api.z.ai/api/paas/v4', 'glm-6-zai'), customFetch);

        expect(bodies.map(body => [body.thinking, body.reasoning_effort])).toEqual([[{ type: 'disabled' }, undefined], [undefined, 'low']]);
    });

    it('the web segmentation service: the default model with its thinking off', async () => {
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl = (async (_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            return answer('{"lines":[["la ","la"]]}');
        }) as unknown as typeof fetch;

        const boundaries = await segmentLyricLines(['la la'], { OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://open.bigmodel.cn/api/paas/v4' }, fetchImpl);

        expect(boundaries).toEqual([['la ', 'la']]);
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toMatchObject({ model: 'glm-5.2', temperature: 0.7, max_tokens: 8192, reasoning_effort: 'none', response_format: { type: 'json_object' } });
    });
});
