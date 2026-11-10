import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEMINI_MODEL, modelAlwaysThinks, retiredModelHint } from '../../../shared/ai/providerRegistry.mjs';
import { answered, exhaustedReply, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/geminiAdapter.test.ts
// What the Gemini adapter asks of each model family (thinkingConfig and the cap), how a rejected
// thinking config moves to the next attempt, and how the desktop sender reads Gemini's answers:
// thought parts skipped, thinking that ate the budget named as such. No request leaves the test.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');

const MINIMAL = { thinkingLevel: 'minimal' };
const LOW = { thinkingLevel: 'low' };
const OFF = { thinkingBudget: 0 };

// Budgets: answer only when thinking is off; answer + REASONING_ALLOWANCE otherwise.
const CAP = {
    segmentation: { off: 8192, on: 8192 + 24576 },
    theme: { off: 8192, on: 8192 + 16384 },
    test: { off: 512, on: 512 + 3584 },
};

type Shape = [thinkingConfig: Record<string, unknown> | undefined, cap: number];

describe('requests per model family', () => {
    const quiet = (thinking: Record<string, unknown>, off: boolean) => (task: AiTask): Shape[] => [[thinking, CAP[task][off ? 'off' : 'on']]];

    const rows: [string, AiTask, Shape[]][] = [
        // The default model: a zero budget for segmentation and the test, low for the theme.
        [DEFAULT_GEMINI_MODEL, 'segmentation', quiet(OFF, true)('segmentation')],
        [DEFAULT_GEMINI_MODEL, 'test', quiet(OFF, true)('test')],
        [DEFAULT_GEMINI_MODEL, 'theme', [[LOW, CAP.theme.on]]],
        // Models that only go down to 'minimal'.
        ['gemini-3.6-flash', 'segmentation', quiet(MINIMAL, false)('segmentation')],
        ['gemini-3.6-flash', 'test', quiet(MINIMAL, false)('test')],
        ['gemini-3.6-flash', 'theme', [[LOW, CAP.theme.on]]],
        ['gemini-3.5-flash-001', 'segmentation', quiet(MINIMAL, false)('segmentation')],
        ['gemini-3.5-flash-lite', 'test', quiet(MINIMAL, false)('test')],
        ['gemini-3.1-flash-lite', 'segmentation', quiet(MINIMAL, false)('segmentation')],
        // Models for which 'minimal' is an error: low for every ask.
        ['gemini-3.8-flash', 'segmentation', quiet(LOW, false)('segmentation')],
        ['gemini-3.8-flash-001', 'test', quiet(LOW, false)('test')],
        ['gemini-3.1-pro-preview', 'segmentation', quiet(LOW, false)('segmentation')],
        ['gemini-4-flash', 'theme', [[LOW, CAP.theme.on]]],
        // Gemini 2.5 speaks budgets; the theme keeps its default thinking.
        ['gemini-2.5-flash', 'segmentation', quiet(OFF, true)('segmentation')],
        ['gemini-2.5-flash-lite', 'test', quiet(OFF, true)('test')],
        ['gemini-2.5-flash', 'theme', [[undefined, CAP.theme.on]]],
        ['gemini-2.5-pro', 'segmentation', [[{ thinkingBudget: 128 }, CAP.segmentation.on]]],
        ['gemini-2.5-pro', 'theme', [[undefined, CAP.theme.on]]],
        // The aliases keep a step to fall back on, should they come to point elsewhere.
        ['gemini-3.5-flash', 'segmentation', [[MINIMAL, CAP.segmentation.on], [LOW, CAP.segmentation.on]]],
        ['gemini-3.5-flash', 'theme', [[LOW, CAP.theme.on], [undefined, CAP.theme.on]]],
        ['gemini-3.7-flash', 'test', [[LOW, CAP.test.on], [undefined, CAP.test.on]]],
        ['gemini-3.7-flash', 'theme', [[LOW, CAP.theme.on], [undefined, CAP.theme.on]]],
        // Anything else walks down from the lowest level to nothing.
        ['gemini-flash-latest', 'segmentation', [[MINIMAL, CAP.segmentation.on], [LOW, CAP.segmentation.on], [undefined, CAP.segmentation.on]]],
        ['gemini-flash-latest', 'test', [[MINIMAL, CAP.test.on], [LOW, CAP.test.on], [undefined, CAP.test.on]]],
        ['gemini-flash-latest', 'theme', [[LOW, CAP.theme.on], [undefined, CAP.theme.on]]],
        // Matched case-insensitively.
        ['Gemini-3.6-Flash', 'segmentation', quiet(MINIMAL, false)('segmentation')],
    ];

    it.each(rows)('%s %s', (model, task, expected) => {
        const shapes = requestsFor('gemini', task, model).map(({ body }) => [
            body.generationConfig.thinkingConfig,
            body.generationConfig.maxOutputTokens,
        ]);
        expect(shapes).toEqual(expected);
    });

    it.each(rows)('%s %s: never a thinking level and a budget together, never a temperature', (model, task) => {
        for (const { body } of requestsFor('gemini', task, model, { temperature: 1.5 })) {
            const thinking = body.generationConfig.thinkingConfig ?? {};
            expect('thinkingLevel' in thinking && 'thinkingBudget' in thinking).toBe(false);
            expect(JSON.stringify(body)).not.toContain('temperature');
        }
    });
});

describe('moving to the next attempt', () => {
    const thinkingRejected = rejectedWith(400, {
        error: { code: 400, message: 'Thinking level MINIMAL is not supported by this model.', status: 'INVALID_ARGUMENT' },
    });

    it('moves on when a 400 talks about thinking, sending the next level', async () => {
        const { bodies, outcome } = await simulate('gemini', 'segmentation', 'gemini-flash-latest', (_body, index) => (
            index === 0 ? thinkingRejected : answered('{"lines":[]}')
        ));
        expect(bodies.map(body => body.generationConfig.thinkingConfig)).toEqual([MINIMAL, LOW]);
        expect(outcome).toMatchObject({ index: 1, result: { content: '{"lines":[]}' } });
    });

    it('also moves on when thinking used up the budget', async () => {
        const { bodies } = await simulate('gemini', 'theme', 'gemini-flash-latest', (_body, index) => (
            index === 0 ? exhaustedReply() : answered('{}')
        ));
        expect(bodies.map(body => body.generationConfig.thinkingConfig)).toEqual([LOW, undefined]);
    });

    it.each([
        ['a 400 about something else', rejectedWith(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } })],
        ['a 429 that mentions thinking', rejectedWith(429, { error: { code: 429, message: 'Quota exceeded for thinking models' } })],
        ['a 500', rejectedWith(500, 'internal')],
    ])('stops at %s', async (_name, reply) => {
        const { bodies, outcome } = await simulate('gemini', 'segmentation', 'gemini-flash-latest', () => reply);
        expect(bodies).toHaveLength(1);
        expect(outcome).toMatchObject({ index: 0, result: { ok: false } });
    });

    it('reads a plain-text error body as well', async () => {
        const { bodies } = await simulate('gemini', 'test', 'gemini-flash-latest', (_body, index) => (
            index === 0 ? rejectedWith(400, 'Budget 0 is invalid. This model only works in thinking mode.') : answered('Hi')
        ));
        expect(bodies).toHaveLength(2);
    });
});

describe('settings hints', () => {
    it.each(['gemini-2.0-flash', 'gemini-2.0-flash-lite-001', 'gemini-3-pro-preview', 'Gemini-3.1-Flash-Lite-Preview'])('calls %s retired', model => {
        expect(retiredModelHint('gemini', model)).toEqual({ model, replacement: DEFAULT_GEMINI_MODEL });
    });

    it.each([DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash-lite', 'gemini-3.6-flash'])('does not call %s retired', model => {
        expect(retiredModelHint('gemini', model)).toBeNull();
    });

    it.each([
        ['gemini-3.6-flash', true],
        ['gemini-3.8-flash', true],
        ['gemini-2.5-pro', true],
        [DEFAULT_GEMINI_MODEL, false],
        ['gemini-2.5-flash', false],
        ['gemini-flash-latest', false],
    ] as const)('%s always thinks: %s', (model, thinks) => {
        expect(modelAlwaysThinks('gemini', model)).toBe(thinks);
    });
});

describe('the desktop sender', () => {
    const KEY = 'g-key';
    const storeWith = (settings: Record<string, unknown>) => ({ get: (key: string) => settings[key] });
    const geminiStore = (model?: string) => storeWith({ GEMINI_API_KEY: KEY, ...(model ? { GEMINI_API_MODEL: model } : {}) });
    const record = (answer: (index: number) => Response) => {
        const bodies: any[] = [];
        const customFetch = async (_url: string, init: any) => {
            bodies.push(JSON.parse(init.body));
            return answer(bodies.length - 1);
        };
        return { bodies, customFetch };
    };
    const ask = (store: unknown, customFetch: unknown) => client.runAiJsonCompletion({
        store, task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source', geminiSchema: { type: 'OBJECT' },
        answerTokens: 8192, customFetch,
    });

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('skips thought parts and joins the answer\'s text parts', async () => {
        const { customFetch } = record(() => Response.json({ candidates: [{
            content: { parts: [{ text: 'Let me think', thought: true }, { text: '{"lines":' }, { text: '[]}' }] },
            finishReason: 'STOP',
        }] }));
        expect(await ask(geminiStore(), customFetch)).toBe('{"lines":[]}');
    });

    it('says thinking used the whole budget when the cap was reached with thoughts and no answer', async () => {
        const { bodies, customFetch } = record(() => Response.json({
            candidates: [{ content: { parts: [{ text: 'still thinking', thought: true }] }, finishReason: 'MAX_TOKENS' }],
            usageMetadata: { thoughtsTokenCount: 32760 },
        }));
        await expect(ask(geminiStore('gemini-3.6-flash'), customFetch))
            .rejects.toThrow('Model "gemini-3.6-flash" used its entire output budget on thinking (32760 thinking tokens)');
        expect(bodies).toHaveLength(1);
    });

    it('names the cap, another finish reason or a blocked prompt instead of a bare "empty"', async () => {
        const cases: [unknown, string][] = [
            [{ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }, 'hit the output token limit'],
            [{ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }, 'Model returned an empty response (finishReason: SAFETY)'],
            [{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'Model returned an empty response (blockReason: PROHIBITED_CONTENT)'],
        ];
        for (const [answer, message] of cases) {
            await expect(ask(geminiStore(), record(() => Response.json(answer)).customFetch)).rejects.toThrow(message);
        }
    });

    it('walks an unlisted model down when its thinking level is rejected', async () => {
        const { bodies, customFetch } = record(index => (index === 0
            ? Response.json({ error: { code: 400, message: 'thinking_level is not supported for this model.', status: 'INVALID_ARGUMENT' } }, { status: 400 })
            : Response.json({ candidates: [{ content: { parts: [{ text: '{"lines":[]}' }] }, finishReason: 'STOP' }] })));
        expect(await ask(geminiStore('gemini-pro-latest'), customFetch)).toBe('{"lines":[]}');
        expect(bodies.map(body => body.generationConfig.thinkingConfig)).toEqual([MINIMAL, LOW]);
    });

    it('the theme ask keeps its own words for an empty answer but names thinking that ate the budget', async () => {
        const theme = (answer: unknown) => client.runGeminiThemeCompletion({
            store: geminiStore(), systemPrompt: 'system', sourcePrompt: 'source', responseSchema: { type: 'OBJECT' },
            answerTokens: 8192, customFetch: record(() => Response.json(answer)).customFetch,
        });
        await expect(theme({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] })).rejects.toThrow('Failed to generate theme JSON');
        await expect(theme({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 24000 } }))
            .rejects.toThrow('used its entire output budget on thinking (24000 thinking tokens)');
    });

    it('tests a listed model with the switch segmentation uses, and shows no thought part', async () => {
        const { bodies, customFetch } = record(() => Response.json({
            modelVersion: 'gemini-3.6-flash',
            candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'Hello!' }] }, finishReason: 'STOP' }],
        }));
        const result = await client.runAiConnectionTest({ provider: 'gemini', apiKey: KEY, model: 'gemini-3.6-flash' }, { customFetch });
        expect(bodies).toEqual([{
            contents: [{ parts: [{ text: 'hello' }] }],
            generationConfig: { maxOutputTokens: 4096, thinkingConfig: MINIMAL },
        }]);
        expect(result).toMatchObject({ ok: true, text: 'Hello!', model: 'gemini-3.6-flash' });
    });
});

describe('model listing', () => {
    it('asks for 1000 a page, follows the page token, and keeps only Gemini text-generation models', async () => {
        const row = (id: string, methods = ['generateContent']) => ({ name: `models/${id}`, supportedGenerationMethods: methods });
        const customFetch = vi.fn()
            .mockResolvedValueOnce(Response.json({ models: [
                row('gemini-3.6-flash'),
                row('gemini-2.5-flash-preview-tts'),
                row('gemini-3-pro-image-preview'),
                row('gemini-live-2.5-flash'),
                row('gemini-2.5-flash-native-audio-latest'),
                row('gemini-embedding-001', ['embedContent', 'generateContent']),
                row('aqa'),
                // Gemma takes no system instruction and no JSON mode.
                row('gemma-3-27b-it'),
                row('gemma-4-e4b-it'),
            ], nextPageToken: 'next-page' }))
            .mockResolvedValueOnce(Response.json({ models: [row('gemini-3-flash-preview')] }));

        const result = await listAiModels({ provider: 'gemini', apiKey: 'g-key' }, { customFetch });

        expect(result).toEqual({ ok: true, models: [
            { id: 'gemini-3.6-flash', name: 'gemini-3.6-flash' },
            { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' },
        ] });
        const [first, second] = customFetch.mock.calls.map(([url]) => new URL(url));
        expect([first.pathname, first.searchParams.get('pageSize'), first.searchParams.get('pageToken')])
            .toEqual(['/v1beta/models', '1000', null]);
        expect([second.searchParams.get('pageSize'), second.searchParams.get('pageToken')]).toEqual(['1000', 'next-page']);
    });
});
