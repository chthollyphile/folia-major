import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER_PRESETS, inferAiProviderFromUrl, modelAlwaysThinks, resolveAiConnection, retiredModelHint } from '../../../shared/ai/providerRegistry.mjs';
import { segmentLyricLines } from '../../../shared/lyricSegmentationService.mjs';
import { answered, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/kimiAdapter.test.ts
// What the Kimi adapter sends (thinking per model, never a temperature, max_completion_tokens,
// plain JSON mode) on both sites, how its attempts move down, and its hints. The desktop client
// and the web segmentation service are each driven once with a fake fetch; no request leaves the test.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];
const ladder = (task: AiTask, model: string) => requestsFor('kimi', task, model).map(({ attempt, budget }) => [attempt.label, budget]);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('thinking per model', () => {
    it('switches kimi-k2.6 off for every ask', () => {
        expect(ladder('segmentation', 'kimi-k2.6')).toEqual([['thinking=disabled', 8192]]);
        expect(ladder('theme', 'kimi-k2.6')).toEqual([['thinking=disabled', 8192]]);
        expect(ladder('test', 'kimi-k2.6')).toEqual([['thinking=disabled', 512]]);
        expect(firstBody('kimi', 'theme', 'kimi-k2.6').thinking).toEqual({ type: 'disabled' });
    });

    it('asks kimi-k3 for its lowest level, with room to reason, and never sends it the switch', () => {
        expect(ladder('segmentation', 'kimi-k3')).toEqual([['reasoning_effort=low', 8192 + 24576]]);
        expect(ladder('theme', 'kimi-k3')).toEqual([['reasoning_effort=low', 8192 + 16384]]);
        expect(ladder('test', 'kimi-k3')).toEqual([['reasoning_effort=low', 512 + 3584]]);
    });

    it.each(['kimi-k2.7-code', 'kimi-k2.7-code-highspeed'])('sends %s nothing reasoning-related, with room to reason', (model) => {
        for (const task of TASKS) {
            const [only, ...rest] = requestsFor('kimi', task, model);
            expect(rest).toEqual([]);
            expect(only.attempt.reasoningOff).toBe(false);
            expect(only.body.thinking).toBeUndefined();
            expect(only.body.reasoning_effort).toBeUndefined();
        }
    });

    it.each(['kimi-k4-preview', 'moonshot-v2-8k', 'some-model'])('tries %s with the switch, then the low level, then nothing', (model) => {
        expect(ladder('segmentation', model)).toEqual([
            ['thinking=disabled', 8192],
            ['reasoning_effort=low', 8192 + 24576],
            ['plain', 8192 + 24576],
        ]);
    });

    it('never sends a disabled switch to a model that always thinks, nor none to anything', () => {
        for (const model of ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed']) {
            for (const task of TASKS) {
                for (const { body } of requestsFor('kimi', task, model)) {
                    expect(body.thinking).toBeUndefined();
                }
            }
        }
        for (const model of ['kimi-k2.6', 'kimi-k3', 'other']) {
            for (const task of TASKS) {
                for (const { body } of requestsFor('kimi', task, model)) {
                    expect(body.reasoning_effort).not.toBe('none');
                }
            }
        }
    });

    it('moves down on a named rejection of the switch, and when reasoning still ate the budget', async () => {
        const { bodies } = await simulate('kimi', 'segmentation', 'kimi-k4-preview', (_body, index) => (
            index === 0 ? rejectedWith(400, { error: { message: 'Invalid request: thinking is not supported for this model', type: 'invalid_request_error' } })
                : index === 1 ? exhaustedReply()
                    : answered('{}')
        ));
        expect(bodies.map(body => [body.thinking, body.reasoning_effort])).toEqual([
            [{ type: 'disabled' }, undefined],
            [undefined, 'low'],
            [undefined, undefined],
        ]);
    });
});

describe('the request body', () => {
    it('never carries a temperature, whatever the setting', () => {
        for (const model of ['kimi-k2.6', 'kimi-k3', 'other']) {
            for (const task of TASKS) {
                for (const { body } of requestsFor('kimi', task, model, { temperature: 1 })) {
                    expect(body.temperature).toBeUndefined();
                }
            }
        }
    });

    it('caps in max_completion_tokens and asks for plain JSON mode', () => {
        const body = firstBody('kimi', 'segmentation', 'kimi-k2.6');
        expect(body.max_completion_tokens).toBe(8192);
        expect(body.max_tokens).toBeUndefined();
        expect(body.response_format).toEqual({ type: 'json_object' });
    });
});

describe('sites and defaults', () => {
    it('offers the China site first and the international one, both inferred as Kimi', () => {
        const preset = AI_PROVIDER_PRESETS.find(entry => entry.id === 'kimi');
        expect(preset?.endpoints).toEqual([
            { id: 'cn', baseUrl: 'https://api.moonshot.cn/v1' },
            { id: 'global', baseUrl: 'https://api.moonshot.ai/v1' },
        ]);
        expect(preset?.temperature).toBeNull();
        for (const endpoint of preset?.endpoints ?? []) {
            expect(inferAiProviderFromUrl(endpoint.baseUrl)).toBe('kimi');
        }
    });

    it('uses kimi-k2.6 when the model is left blank', () => {
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.moonshot.ai/v1' }))
            .toMatchObject({ adapterId: 'kimi', model: 'kimi-k2.6' });
    });

    it('lists the model ids of /v1/models', async () => {
        const customFetch = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [{ id: 'kimi-k2.6', object: 'model' }, { id: 'kimi-k3', object: 'model' }] }));
        const result = await listAiModels({ provider: 'openai', apiKey: 'test-secret', apiUrl: 'https://api.moonshot.cn/v1' }, { customFetch });
        expect(result).toEqual({ ok: true, models: [{ id: 'kimi-k2.6', name: 'kimi-k2.6' }, { id: 'kimi-k3', name: 'kimi-k3' }] });
        expect(customFetch.mock.calls[0][0]).toBe('https://api.moonshot.cn/v1/models');
    });
});

describe('model hints', () => {
    it.each(['kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-128k', 'kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'kimi-k2-turbo-preview',
        'kimi-k2-thinking', 'kimi-latest', 'kimi-thinking-preview'])('suggests kimi-k2.6 for the retired %s', (model) => {
        expect(retiredModelHint('kimi', model)).toEqual({ model, replacement: 'kimi-k2.6' });
    });

    it('leaves current models alone, and marks the ones that always think', () => {
        for (const model of ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code']) {
            expect(retiredModelHint('kimi', model)).toBeNull();
        }
        expect(['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'].map(model => modelAlwaysThinks('kimi', model)))
            .toEqual([true, true, true, false]);
    });
});

describe('end to end', () => {
    const answer = (content: string) => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });

    it('the desktop theme ask to the international site: the default model, thinking off, no temperature', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const requests: { url: string; body: Record<string, unknown> }[] = [];
        const customFetch = async (url: string, init: { body: string }) => {
            requests.push({ url, body: JSON.parse(init.body) });
            return answer('{"light":{},"dark":{}}');
        };
        const store = { get: (key: string) => ({
            AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://api.moonshot.ai/v1', OPENAI_API_TEMPERATURE: '0.9',
        } as Record<string, unknown>)[key] };

        await client.runAiJsonCompletion({
            store, task: 'theme', systemPrompt: 's', sourcePrompt: 'u', schema: { type: 'object' }, schemaName: 'dual_theme', customFetch, answerTokens: 8192,
        });

        expect(requests).toEqual([{
            url: 'https://api.moonshot.ai/v1/chat/completions',
            body: {
                model: 'kimi-k2.6',
                messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
                max_completion_tokens: 8192,
                thinking: { type: 'disabled' },
                response_format: { type: 'json_object' },
            },
        }]);
    });

    it('the connection test sends kimi-k3 its level', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const customFetch = async (_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            return answer('hi');
        };
        const result = await client.runAiConnectionTest(
            { provider: 'openai', apiKey: 'k', apiUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
            { customFetch },
        );
        expect(result).toMatchObject({ ok: true, text: 'hi' });
        expect(bodies).toEqual([{
            model: 'kimi-k3',
            messages: [{ role: 'user', content: 'hello' }],
            max_completion_tokens: 4096,
            reasoning_effort: 'low',
        }]);
    });

    it('a model whose switch the endpoint rejects gets the low level next, on the desktop and the web', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl = async (_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.thinking
                ? Response.json({ error: { message: 'Invalid request: thinking is not supported for this model', type: 'invalid_request_error' } }, { status: 400 })
                : answer('{"lines":[["la ","la"]]}');
        };
        const store = { get: (key: string) => ({
            AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://api.moonshot.cn/v1', OPENAI_API_MODEL: 'kimi-k4-desktop',
        } as Record<string, unknown>)[key] };

        await client.runAiJsonCompletion({ store, task: 'segmentation', systemPrompt: 's', sourcePrompt: 'u', customFetch: fetchImpl, answerTokens: 8192 });
        await segmentLyricLines(['la la'], {
            OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://api.moonshot.cn/v1', OPENAI_API_MODEL: 'kimi-k4-web',
        }, fetchImpl as unknown as typeof fetch);

        // The rejection reaches the runner, which moves to the next attempt the adapter wrote: the
        // low level, budgeted for reasoning. Nothing is sent with neither parameter.
        const shapes = bodies.map(body => [body.model, body.thinking, body.reasoning_effort, body.max_completion_tokens]);
        expect(shapes).toEqual([
            ['kimi-k4-desktop', { type: 'disabled' }, undefined, 8192],
            ['kimi-k4-desktop', undefined, 'low', 8192 + 24576],
            ['kimi-k4-web', { type: 'disabled' }, undefined, 8192],
            ['kimi-k4-web', undefined, 'low', 8192 + 24576],
        ]);
    });

    it('the web segmentation service sends the same request shape', async () => {
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl = (async (_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            return answer('{"lines":[["la ","la"]]}');
        }) as unknown as typeof fetch;

        const boundaries = await segmentLyricLines(['la la'], {
            OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://api.moonshot.cn/v1', OPENAI_API_TEMPERATURE: '0.3',
        }, fetchImpl);

        expect(boundaries).toEqual([['la ', 'la']]);
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toMatchObject({ model: 'kimi-k2.6', max_completion_tokens: 8192, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
        expect(bodies[0].temperature).toBeUndefined();
    });
});
