import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REASONING_ALLOWANCE } from '../../../shared/ai/aiTasks.mjs';
import { resetLearnedAttempts } from '../../../shared/ai/attemptRunner.mjs';
import { exhaustedByReasoning } from '../../../shared/ai/compatibleBody.mjs';
import { AI_PROVIDER_PRESETS, getAiAdapter, inferAiProviderFromUrl, resolveAiConnection, retiredModelHint } from '../../../shared/ai/providerRegistry.mjs';
import { segmentLyricLines } from '../../../shared/lyricSegmentationService.mjs';
import { resetOpenAICompatibleCapabilities } from '../../../shared/openAICompatibleRequest.mjs';
import { ANSWER_TOKENS, firstBody, requestsFor, type AiTask } from './adapterHarness';

// test/unit/ai/mimoAdapter.test.ts
// What the MiMo adapter (shared/ai/mimo.mjs) sends for each ask and model, how a reply cut off for
// repetition is read, the catalogue filter and the retired models, and the same requests end to end
// through the desktop client and the web segmentation route with a fake fetch.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];
const BASE = 'https://api.xiaomimimo.com/v1';
const DISABLED = { type: 'disabled' };

describe('requests', () => {
    it.each(['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed', 'MiMo-V2.6-Flash'])('%s: thinking disabled on every ask, capped with max_completion_tokens', model => {
        for (const task of TASKS) {
            const requests = requestsFor('mimo', task, model);
            expect(requests).toHaveLength(1);
            expect(requests[0].body.thinking).toEqual(DISABLED);
            expect(requests[0].body.max_completion_tokens).toBe(ANSWER_TOKENS[task]);
            expect(requests[0].body).not.toHaveProperty('max_tokens');
            expect(requests[0].body).not.toHaveProperty('reasoning_effort');
        }
    });

    it('a model not known to take the switch: disabled first, then nothing with room to think', () => {
        expect(requestsFor('mimo', 'segmentation', 'mimo-v3-preview').map(({ attempt, body }) => [attempt.label, body.max_completion_tokens, body.thinking]))
            .toEqual([
                ['thinking=disabled', ANSWER_TOKENS.segmentation, DISABLED],
                ['plain', ANSWER_TOKENS.segmentation + REASONING_ALLOWANCE.segmentation, undefined],
            ]);
    });

    it('sends the temperature up to 1.5', () => {
        expect(firstBody('mimo', 'segmentation', 'mimo-v2.6-flash').temperature).toBe(0.7);
        expect(firstBody('mimo', 'theme', 'mimo-v2.6-flash', { temperature: 1.5 }).temperature).toBe(1.5);
        expect(firstBody('mimo', 'theme', 'mimo-v2.6-flash', { temperature: 2 }).temperature).toBe(1.5);
        expect(firstBody('mimo', 'test', 'mimo-v2.6-flash')).not.toHaveProperty('temperature');
    });

    it('asks for plain JSON mode, never a schema', () => {
        for (const task of ['segmentation', 'theme'] as AiTask[]) {
            expect(firstBody('mimo', task, 'mimo-v2.6-flash').response_format).toEqual({ type: 'json_object' });
        }
    });
});

describe('an answer cut off for repetition', () => {
    const looped = { finish_reason: 'repetition_truncation', message: { content: '', reasoning_content: 'and again and again' } };

    it('counts as reasoning that used up the budget, for MiMo only', () => {
        expect(exhaustedByReasoning(looped, undefined, getAiAdapter('mimo'))).toBe(true);
        expect(exhaustedByReasoning({ ...looped, finish_reason: 'length' }, undefined, getAiAdapter('mimo'))).toBe(true);
        expect(exhaustedByReasoning({ ...looped, finish_reason: 'stop' }, undefined, getAiAdapter('mimo'))).toBe(false);
        expect(exhaustedByReasoning(looped, undefined, getAiAdapter('custom'))).toBe(false);
        expect(exhaustedByReasoning(looped, undefined)).toBe(false);
    });
});

describe('settings', () => {
    it('recognises every xiaomimimo.com host but offers only the pay-as-you-go site', () => {
        expect(inferAiProviderFromUrl('https://token-plan-cn.xiaomimimo.com/v1')).toBe('mimo');
        expect(AI_PROVIDER_PRESETS.find(preset => preset.id === 'mimo')?.endpoints).toEqual([{ id: 'default', baseUrl: BASE }]);
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: BASE })).toMatchObject({ adapterId: 'mimo', model: 'mimo-v2.6-flash' });
    });

    it.each([
        ['mimo-v2.5-pro', 'mimo-v2.6-pro'],
        ['mimo-v2-pro', 'mimo-v2.6-pro'],
        ['mimo-v2.5', 'mimo-v2.6-flash'],
        ['MiMo-V2-Flash', 'mimo-v2.6-flash'],
        ['mimo-v2-omni', 'mimo-v2.6-flash'],
    ])('points the retired %s to %s', (model, replacement) => {
        expect(retiredModelHint('mimo', model)).toEqual({ model, replacement });
    });

    it.each(['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5-tts'])('leaves %s alone', model => {
        expect(retiredModelHint('mimo', model)).toBeNull();
    });
});

describe('model catalogue', () => {
    it('drops the speech models', async () => {
        const customFetch = vi.fn().mockResolvedValue(Response.json({ object: 'list', data: [
            { id: 'mimo-v2.6-flash', object: 'model', owned_by: 'xiaomi' },
            { id: 'mimo-v2.5-tts', object: 'model', owned_by: 'xiaomi' },
            { id: 'mimo-v2-asr', object: 'model', owned_by: 'xiaomi' },
            { id: 'mimo-audio-x', object: 'model', owned_by: 'xiaomi' },
            { id: 'mimo-v2.6-pro', object: 'model', owned_by: 'xiaomi' },
        ] }));
        expect(await listAiModels({ provider: 'openai', apiKey: 'test-secret', apiUrl: BASE }, { customFetch })).toEqual({
            ok: true, models: [{ id: 'mimo-v2.6-flash', name: 'mimo-v2.6-flash' }, { id: 'mimo-v2.6-pro', name: 'mimo-v2.6-pro' }],
        });
        expect(customFetch.mock.calls[0][0]).toBe(`${BASE}/models`);
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
    const reply = (choice: Record<string, unknown>) => () => Response.json({ choices: [choice] });
    const ANSWER = reply({ finish_reason: 'stop', message: { content: '{"lines":[]}' } });
    const LOOPED = reply({ finish_reason: 'repetition_truncation', message: { content: '', reasoning_content: 'again and again' } });
    const storeWith = (settings: Record<string, unknown>) => ({ get: (key: string) => settings[key] });
    const ask = (model: string, customFetch: unknown) => client.runAiJsonCompletion({
        store: storeWith({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: BASE, OPENAI_API_MODEL: model, OPENAI_API_TEMPERATURE: '1.8' }),
        task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source', schema: { type: 'object' }, schemaName: 'x', answerTokens: 8192, customFetch,
    });

    beforeEach(() => {
        resetLearnedAttempts();
        resetOpenAICompatibleCapabilities();
        for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('desktop segmentation: thinking off, max_completion_tokens and the clamped temperature', async () => {
        const { requests, customFetch } = record([ANSWER]);
        await ask('mimo-v2.6-flash', customFetch);
        expect(requests[0].url).toBe(`${BASE}/chat/completions`);
        expect(requests[0].body).toMatchObject({ model: 'mimo-v2.6-flash', thinking: DISABLED, max_completion_tokens: 8192, temperature: 1.5 });
        expect(requests[0].body).not.toHaveProperty('max_tokens');
    });

    it('desktop: a reply cut off while reasoning moves an unknown model on, and is reported for a known one', async () => {
        const fallback = record([LOOPED, ANSWER]);
        await expect(ask('mimo-v3-preview', fallback.customFetch)).resolves.toBe('{"lines":[]}');
        expect(fallback.requests.map(({ body }) => [body.thinking, body.max_completion_tokens])).toEqual([
            [DISABLED, 8192],
            [undefined, 8192 + REASONING_ALLOWANCE.segmentation],
        ]);

        // Reported the way the runner read it: reasoning that did not finish, not an empty answer.
        await expect(ask('mimo-v2.6-flash', record([LOOPED]).customFetch)).rejects.toThrow(/stopped while still reasoning \(finish_reason: repetition_truncation\)/);
    });

    it('desktop connection test: the reply cut off while reasoning is reported as reasoning', async () => {
        const { requests, customFetch } = record([LOOPED]);
        const result = await client.runAiConnectionTest({ provider: 'openai', apiKey: KEY, apiUrl: BASE, model: 'mimo-v2.6-flash' }, { customFetch });
        expect(result).toMatchObject({ ok: true, text: '', emptyReason: 'reasoning' });
        expect(requests[0].body).toEqual({ model: 'mimo-v2.6-flash', messages: [{ role: 'user', content: 'hello' }], max_completion_tokens: 512, thinking: DISABLED });
    });

    it('web segmentation: the same switch and fallback', async () => {
        const { requests, customFetch } = record([LOOPED, ANSWER]);
        await segmentLyricLines(['ab'], { AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: BASE, OPENAI_API_MODEL: 'mimo-v3-preview' }, customFetch).catch(() => {});
        expect(requests.map(({ body }) => [body.thinking, body.max_completion_tokens])).toEqual([
            [DISABLED, 8192],
            [undefined, 8192 + REASONING_ALLOWANCE.segmentation],
        ]);

        await expect(segmentLyricLines(['ab'], { AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: BASE, OPENAI_API_MODEL: 'mimo-v2.6-flash' }, record([LOOPED]).customFetch))
            .rejects.toThrow(/stopped while still reasoning \(finish_reason: repetition_truncation\)/);
    });
});
