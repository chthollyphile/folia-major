import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_DEFAULT_MODEL } from '../../../shared/ai/deepseek.mjs';
import { AI_PROVIDER_PRESETS, inferAiProviderFromUrl, modelAlwaysThinks, resolveAiConnection, retiredModelHint } from '../../../shared/ai/providerRegistry.mjs';
import { answered, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/deepseekAdapter.test.ts
// What the DeepSeek adapter sends (thinking off with both documented switches for every ask, the
// temperature, max_tokens, plain JSON mode), how its attempts move down, its default model and
// address, its model listing and its retired-model hints. No request leaves the test.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];
const BOTH = { thinking: { type: 'disabled' }, reasoning_effort: 'none' };

describe('thinking', () => {
    it.each(TASKS)('%s: both switches off, then the thinking switch alone, then nothing with room to reason', (task) => {
        const answer = { segmentation: 8192, theme: 8192, test: 512 }[task];
        const allowance = { segmentation: 24576, theme: 16384, test: 3584 }[task];
        expect(requestsFor('deepseek', task, DEEPSEEK_DEFAULT_MODEL).map(({ attempt, budget }) => [attempt.label, budget])).toEqual([
            ['thinking=disabled+reasoning_effort=none', answer],
            ['thinking=disabled', answer],
            ['plain', answer + allowance],
        ]);
        expect(firstBody('deepseek', task, 'any-model')).toMatchObject(BOTH);
    });

    it('moves to the thinking switch alone when reasoning_effort is rejected, and on when reasoning still ate the budget', async () => {
        const { bodies, outcome } = await simulate('deepseek', 'segmentation', DEEPSEEK_DEFAULT_MODEL, (_body, index) => (
            index === 0 ? rejectedWith(400, { error: { message: 'Invalid value', param: 'reasoning_effort', type: 'invalid_request_error' } })
                : index === 1 ? exhaustedReply()
                    : answered('{"lines":[]}')
        ));
        expect(bodies.map(body => [body.thinking, body.reasoning_effort])).toEqual([
            [{ type: 'disabled' }, 'none'],
            [{ type: 'disabled' }, undefined],
            [undefined, undefined],
        ]);
        expect(outcome.index).toBe(2);
    });

    it('walks down the attempts when the endpoint rejects the thinking switch: the transport no longer drops it', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const bodies: Record<string, unknown>[] = [];
        const customFetch = async (_url: string, init: { body: string }) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.thinking
                ? Response.json({ error: { message: 'Invalid value', param: 'thinking', type: 'invalid_request_error' } }, { status: 400 })
                : Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
        };
        const store = { get: (key: string) => ({
            AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://api.deepseek.com', OPENAI_API_MODEL: 'deepseek-transport-test',
        } as Record<string, unknown>)[key] };

        await client.runAiJsonCompletion({ store, task: 'theme', systemPrompt: 's', sourcePrompt: 'u', customFetch, answerTokens: 8192 });

        expect(bodies.map(body => [body.thinking, body.reasoning_effort, body.max_tokens])).toEqual([
            [{ type: 'disabled' }, 'none', 8192],
            [{ type: 'disabled' }, undefined, 8192],
            [undefined, undefined, 8192 + 16384],
        ]);
        vi.restoreAllMocks();
    });
});

describe('the request body', () => {
    it('sends the temperature, clamped to 0..2, but not with the test', () => {
        expect(firstBody('deepseek', 'theme', DEEPSEEK_DEFAULT_MODEL).temperature).toBe(0.7);
        expect(firstBody('deepseek', 'segmentation', DEEPSEEK_DEFAULT_MODEL, { temperature: 2.5 }).temperature).toBe(2);
        expect(firstBody('deepseek', 'test', DEEPSEEK_DEFAULT_MODEL).temperature).toBeUndefined();
    });

    it('caps in max_tokens and asks for plain JSON mode even when a schema is given', () => {
        for (const task of ['segmentation', 'theme'] as AiTask[]) {
            for (const { body, budget } of requestsFor('deepseek', task, DEEPSEEK_DEFAULT_MODEL)) {
                expect(body.max_tokens).toBe(budget);
                expect(body.max_completion_tokens).toBeUndefined();
                expect(body.response_format).toEqual({ type: 'json_object' });
            }
        }
        expect(firstBody('deepseek', 'test', DEEPSEEK_DEFAULT_MODEL).response_format).toBeUndefined();
    });
});

describe('default model and address', () => {
    it('uses deepseek-flash when the model is left blank', () => {
        expect(DEEPSEEK_DEFAULT_MODEL).toBe('deepseek-flash');
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.deepseek.com', OPENAI_API_MODEL: ' ' }))
            .toMatchObject({ adapterId: 'deepseek', model: 'deepseek-flash' });
    });

    it('presets DeepSeek\'s own spelling of its address, which still infers as DeepSeek and is requested under /v1', () => {
        const preset = AI_PROVIDER_PRESETS.find(entry => entry.id === 'deepseek');
        expect(preset?.baseUrl).toBe('https://api.deepseek.com');
        expect(preset?.recommendedModel).toBe('deepseek-flash');
        expect(inferAiProviderFromUrl(preset?.baseUrl)).toBe('deepseek');
        expect(client.normalizeOpenAIChatCompletionsUrl(preset?.baseUrl)).toBe('https://api.deepseek.com/v1/chat/completions');
    });
});

describe('the model listing', () => {
    it('shows each model\'s name', async () => {
        const customFetch = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [
            { id: 'deepseek-flash', object: 'model', owned_by: 'deepseek', name: 'DeepSeek-V4.1-Flash' },
            { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek', name: 'DeepSeek-V4-Pro' },
            { id: 'deepseek-unnamed', object: 'model', owned_by: 'deepseek' },
        ] }));

        const result = await listAiModels({ provider: 'openai', apiKey: 'test-secret', apiUrl: 'https://api.deepseek.com' }, { customFetch });

        expect(result).toEqual({ ok: true, models: [
            { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
            { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
            { id: 'deepseek-unnamed', name: 'deepseek-unnamed' },
        ] });
        expect(customFetch.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/models');
    });
});

describe('model hints', () => {
    it.each(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'DeepSeek-V4-Flash'])('suggests deepseek-flash for %s', (model) => {
        expect(retiredModelHint('deepseek', model)).toEqual({ model, replacement: 'deepseek-flash' });
    });

    it('leaves current models alone, and none of them always thinks', () => {
        for (const model of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat-x']) {
            expect(retiredModelHint('deepseek', model)).toBeNull();
            expect(modelAlwaysThinks('deepseek', model)).toBe(false);
        }
    });
});
