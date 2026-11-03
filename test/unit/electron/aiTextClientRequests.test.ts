import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/aiTextClientRequests.test.ts
// The request the main process sends for each AI ask (a theme from lyrics, a lyric segmentation,
// the connection test) to each service (Gemini, OpenAI itself, another OpenAI-compatible host):
// address, method, headers and body, recorded with a fake fetch. No request leaves the test.
//
// The asks are made the way the handlers in electron/main.cjs make them. main.cjs itself cannot be
// loaded in a test (it starts the app), so the theme's prompts and schema, which live there, are
// stand-ins here; the segmentation's come from the shared module the handler uses.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');
const segmentation = require('../../../shared/lyricSegmentationPrompt.cjs');

const GEMINI_ADDRESS = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const OPENAI_ADDRESS = 'https://api.openai.com/v1/chat/completions';
const KEY = 'test-key';

const storeWith = (settings: Record<string, unknown>) => ({ get: (key: string) => settings[key] });
const GEMINI_STORE = storeWith({ GEMINI_API_KEY: KEY });
const OPENAI_STORE = storeWith({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY });
const DEEPSEEK_STORE = storeWith({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY, OPENAI_API_URL: 'https://api.deepseek.com' });
const RELAY_STORE = storeWith({
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: KEY,
    OPENAI_API_URL: 'https://relay.example.com/v1',
    OPENAI_API_MODEL: 'my-model',
    OPENAI_API_TEMPERATURE: '0.2',
});

type Recorded = { url: string; method: string; headers: Record<string, string>; body: any; signal: unknown };

/** A fake fetch that records each request and answers with `answer`. */
const record = (answer: () => Response) => {
    const requests: Recorded[] = [];
    const customFetch = async (url: string, init: any) => {
        requests.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
        return answer();
    };
    return { requests, customFetch };
};

/** What went over the wire: everything recorded but the abort signal. */
const sent = (requests: Recorded[]) => requests.map(({ signal, ...request }) => request);

const openAiAnswer = (content: string) => () => Response.json({
    choices: [{ finish_reason: 'stop', message: { content } }],
});
const geminiAnswer = (text: string) => () => Response.json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
});

const OPENAI_HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };
const GEMINI_HEADERS = { 'Content-Type': 'application/json', 'x-goog-api-key': KEY };

// Everything the client prints while the asks below run; checked for the key after each test.
let printed: string[] = [];

beforeEach(() => {
    printed = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
            printed.push(args.map(String).join(' '));
        });
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    expect(printed.filter(line => line.includes(KEY))).toEqual([]);
});

describe('the theme ask', () => {
    const SYSTEM = 'theme system prompt';
    const SOURCE = 'Pure instrumental: no\nSource snippet:\nla la la';
    const SCHEMA = { type: 'object', properties: { light: { type: 'object' }, dark: { type: 'object' } } };
    const GEMINI_SCHEMA = { type: 'OBJECT', properties: { light: { type: 'OBJECT' }, dark: { type: 'OBJECT' } } };
    const MESSAGES = [{ role: 'system', content: SYSTEM }, { role: 'user', content: SOURCE }];

    // The 'generate-theme' handler asks for 8192 answer tokens; a model that keeps reasoning gets
    // room for that on top (shared/ai/aiTasks.mjs).
    const askOpenAi = (store: unknown, customFetch: unknown) => client.runAiJsonCompletion({
        store, task: 'theme', systemPrompt: SYSTEM, sourcePrompt: SOURCE, schema: SCHEMA, schemaName: 'dual_theme', customFetch,
        answerTokens: 8192,
    });

    it('to OpenAI itself: its address, the default model at low effort with no temperature, the schema as a structured output', async () => {
        const { requests, customFetch } = record(openAiAnswer('{"light":{},"dark":{}}'));

        const answer = await askOpenAi(OPENAI_STORE, customFetch);

        expect(sent(requests)).toEqual([{
            url: OPENAI_ADDRESS,
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'gpt-5.6-luna',
                messages: MESSAGES,
                max_completion_tokens: 8192 + 16384,
                reasoning_effort: 'low',
                response_format: { type: 'json_schema', json_schema: { name: 'dual_theme', strict: true, schema: SCHEMA } },
            },
        }]);
        expect(requests[0].signal).toBeInstanceOf(AbortSignal);
        expect(answer).toBe('{"light":{},"dark":{}}');
    });

    it('to another OpenAI-compatible host: the user\'s address, model and temperature, plain JSON mode', async () => {
        const { requests, customFetch } = record(openAiAnswer('{}'));

        await askOpenAi(RELAY_STORE, customFetch);

        expect(sent(requests)).toEqual([{
            url: 'https://relay.example.com/v1/chat/completions',
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'my-model',
                messages: MESSAGES,
                temperature: 0.2,
                max_tokens: 8192,
                response_format: { type: 'json_object' },
            },
        }]);
    });

    it('to DeepSeek: its own default model, thinking off as for segmentation', async () => {
        const { requests, customFetch } = record(openAiAnswer('{}'));

        await askOpenAi(DEEPSEEK_STORE, customFetch);

        expect(sent(requests)).toEqual([{
            url: 'https://api.deepseek.com/v1/chat/completions',
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'deepseek-flash',
                messages: MESSAGES,
                temperature: 0.7,
                max_tokens: 8192,
                thinking: { type: 'disabled' },
                reasoning_effort: 'none',
                response_format: { type: 'json_object' },
            },
        }]);
    });

    // The Gemini side of the theme ask: runGeminiThemeCompletion, as the handler calls it. It was
    // written in electron/main.cjs (generateGeminiTheme) until it moved into the client; the three
    // tests below were first run against that function, taken out of main.cjs's text.
    // The handler asks for 8192 answer tokens, as it does of the other providers.
    const sendGeminiTheme = ({ apiKey, systemPrompt, sourcePrompt, responseSchema, customFetch }: {
        apiKey: string; systemPrompt: string; sourcePrompt: string; responseSchema: unknown; customFetch: unknown;
    }): Promise<unknown> => client.runGeminiThemeCompletion({
        store: storeWith({ GEMINI_API_KEY: apiKey }), systemPrompt, sourcePrompt, responseSchema, customFetch, answerTokens: 8192,
    });
    const askGemini = (customFetch: unknown) => sendGeminiTheme({
        apiKey: KEY, systemPrompt: SYSTEM, sourcePrompt: SOURCE, responseSchema: GEMINI_SCHEMA, customFetch,
    });
    const GEMINI_THEME_REQUEST = {
        url: GEMINI_ADDRESS,
        method: 'POST',
        headers: GEMINI_HEADERS,
        body: {
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [{ parts: [{ text: SOURCE }] }],
            // Thinking turned down to low, and the cap leaves room for it: 8192 + 16384.
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: GEMINI_SCHEMA,
                maxOutputTokens: 24576,
                thinkingConfig: { thinkingLevel: 'low' },
            },
        },
    };

    it('to Gemini: its address with the model in it, the key in a header, under a deadline; the answer comes back parsed', async () => {
        const { requests, customFetch } = record(geminiAnswer('{"light":{"name":"Dawn"},"dark":{"name":"Night"}}'));

        const answer = await askGemini(customFetch);

        expect(sent(requests)).toEqual([GEMINI_THEME_REQUEST]);
        expect(requests[0].signal).toBeInstanceOf(AbortSignal);
        expect(answer).toEqual({ light: { name: 'Dawn' }, dark: { name: 'Night' } });
    });

    it('to Gemini: fails with the service\'s status and text, or a fixed message when the answer is empty', async () => {
        const refused = record(() => new Response('API key not valid', { status: 400, statusText: 'Bad Request' }));
        await expect(askGemini(refused.customFetch)).rejects.toThrow('Gemini API error: 400 Bad Request - API key not valid');

        const empty = record(() => Response.json({ candidates: [{ content: { parts: [] } }] }));
        await expect(askGemini(empty.customFetch)).rejects.toThrow('Failed to generate theme JSON');
    });

    it('to Gemini without a key: sends nothing, and fails with the words the window takes for a missing key', async () => {
        const { requests, customFetch } = record(geminiAnswer('{}'));

        await expect(sendGeminiTheme({
            apiKey: '', systemPrompt: SYSTEM, sourcePrompt: SOURCE, responseSchema: GEMINI_SCHEMA, customFetch,
        })).rejects.toThrow('GEMINI_API_KEY is not configured in settings');
        expect(requests).toEqual([]);
    });

    it('to Gemini: the client\'s other sender, asked the same thing, sends the same address, headers and body', async () => {
        const { requests, customFetch } = record(geminiAnswer('{}'));

        await client.runAiJsonCompletion({
            store: GEMINI_STORE, task: 'theme', systemPrompt: SYSTEM, sourcePrompt: SOURCE, geminiSchema: GEMINI_SCHEMA, customFetch,
            answerTokens: 8192,
        });

        expect(sent(requests)).toEqual([GEMINI_THEME_REQUEST]);
    });
});

describe('the segmentation ask', () => {
    const LINES = ['la la la', '君の名は'];
    const SYSTEM = segmentation.buildSegmentationSystemPrompt();
    const SOURCE = segmentation.buildSegmentationSourcePrompt(LINES);
    const MESSAGES = [{ role: 'system', content: SYSTEM }, { role: 'user', content: SOURCE }];

    // As the 'segment-lyrics' handler asks.
    const ask = (store: unknown, customFetch: unknown) => client.runAiJsonCompletion({
        store,
        task: 'segmentation',
        systemPrompt: SYSTEM,
        sourcePrompt: SOURCE,
        schema: segmentation.SEGMENTATION_JSON_SCHEMA,
        schemaName: segmentation.SEGMENTATION_SCHEMA_NAME,
        geminiSchema: segmentation.SEGMENTATION_GEMINI_SCHEMA,
        customFetch,
        answerTokens: segmentation.SEGMENTATION_MAX_OUTPUT_TOKENS,
    });

    it('to Gemini: the tuned generation config with thinking off, under a deadline', async () => {
        const { requests, customFetch } = record(geminiAnswer('{"lines":[]}'));

        const answer = await ask(GEMINI_STORE, customFetch);

        expect(sent(requests)).toEqual([{
            url: GEMINI_ADDRESS,
            method: 'POST',
            headers: GEMINI_HEADERS,
            body: {
                systemInstruction: { parts: [{ text: SYSTEM }] },
                contents: [{ parts: [{ text: SOURCE }] }],
                generationConfig: segmentation.SEGMENTATION_GEMINI_GENERATION_CONFIG,
            },
        }]);
        expect(requests[0].body.generationConfig).toMatchObject({
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 0 },
        });
        expect(requests[0].signal).toBeInstanceOf(AbortSignal);
        expect(answer).toBe('{"lines":[]}');
    });

    it('to OpenAI itself: reasoning off and no temperature, the schema as a structured output', async () => {
        const { requests, customFetch } = record(openAiAnswer('{"lines":[]}'));

        const answer = await ask(OPENAI_STORE, customFetch);

        expect(sent(requests)).toEqual([{
            url: OPENAI_ADDRESS,
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'gpt-5.6-luna',
                messages: MESSAGES,
                max_completion_tokens: 8192,
                reasoning_effort: 'none',
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: 'lyric_word_segmentation', strict: true, schema: segmentation.SEGMENTATION_JSON_SCHEMA },
                },
            },
        }]);
        expect(answer).toBe('{"lines":[]}');
    });

    it('to DeepSeek: its thinking switch as well, plain JSON mode', async () => {
        const { requests, customFetch } = record(openAiAnswer('{"lines":[]}'));

        await ask(DEEPSEEK_STORE, customFetch);

        expect(sent(requests)).toEqual([{
            url: 'https://api.deepseek.com/v1/chat/completions',
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'deepseek-flash',
                messages: MESSAGES,
                temperature: 0.7,
                max_tokens: 8192,
                thinking: { type: 'disabled' },
                reasoning_effort: 'none',
                response_format: { type: 'json_object' },
            },
        }]);
    });
});

describe('the connection test', () => {
    it('to Gemini: one hello with thinking off', async () => {
        const { requests, customFetch } = record(geminiAnswer('Hello!'));

        const result = await client.runAiConnectionTest({ provider: 'gemini', apiKey: KEY }, { customFetch });

        expect(sent(requests)).toEqual([{
            url: GEMINI_ADDRESS,
            method: 'POST',
            headers: GEMINI_HEADERS,
            body: {
                contents: [{ parts: [{ text: 'hello' }] }],
                generationConfig: { maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
            },
        }]);
        expect(result).toMatchObject({ ok: true, status: 200, text: 'Hello!', model: 'gemini-3-flash-preview' });
    });

    it('to OpenAI itself with nothing but a key in the form: its address, the default model, reasoning off as segmentation asks', async () => {
        const { requests, customFetch } = record(openAiAnswer('Hello!'));

        const result = await client.runAiConnectionTest({ provider: 'openai', apiKey: KEY }, { customFetch });

        expect(sent(requests)).toEqual([{
            url: OPENAI_ADDRESS,
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'gpt-5.6-luna',
                messages: [{ role: 'user', content: 'hello' }],
                max_completion_tokens: 512,
                reasoning_effort: 'none',
            },
        }]);
        expect(result).toMatchObject({ ok: true, status: 200, text: 'Hello!', model: 'gpt-5.6-luna' });
    });

    it('to another OpenAI-compatible host: the address and model from the form', async () => {
        const { requests, customFetch } = record(openAiAnswer('Hello!'));

        await client.runAiConnectionTest(
            { provider: 'openai', apiKey: KEY, apiUrl: 'https://relay.example.com/v1', model: 'my-model' },
            { customFetch },
        );

        expect(sent(requests)).toEqual([{
            url: 'https://relay.example.com/v1/chat/completions',
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: 'my-model',
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 512,
            },
        }]);
    });
});

describe('the two asks of Gemini, which share one sender', () => {
    const gemini = (customFetch: unknown) => client.runAiJsonCompletion({
        store: GEMINI_STORE, task: 'theme', systemPrompt: 'system', sourcePrompt: 'source', customFetch, timeoutMs: 20_000,
    });
    const theme = (customFetch: unknown) => client.runGeminiThemeCompletion({
        store: GEMINI_STORE, systemPrompt: 'system', sourcePrompt: 'source', responseSchema: { type: 'OBJECT' }, customFetch,
    });
    const timeout = async () => {
        throw new DOMException('The operation timed out', 'TimeoutError');
    };

    it('the text ask logs its three steps and names what timed out; the theme ask prints nothing and, under the same default deadline, names what timed out too', async () => {
        await gemini(record(geminiAnswer('{}')).customFetch);
        expect(printed.map(line => line.replace(/\d+ms/g, 'Nms'))).toEqual([
            '[ai] POST gemini-3-flash-preview',
            '[ai] gemini headers 200 in Nms, reading body…',
            '[ai] gemini body complete in Nms total',
        ]);
        await expect(gemini(timeout)).rejects.toThrow('Request to Gemini timed out after 20s');

        printed = [];
        await theme(record(geminiAnswer('{"light":{},"dark":{}}')).customFetch);
        expect(printed).toEqual([]);
        await expect(theme(timeout)).rejects.toThrow('Request to Gemini timed out after 120s');
    });

    it('an empty answer: each ask keeps its own words', async () => {
        const empty = () => Response.json({ candidates: [{ content: { parts: [] } }] });
        await expect(gemini(record(empty).customFetch)).rejects.toThrow('Model returned an empty response');
        await expect(theme(record(empty).customFetch)).rejects.toThrow('Failed to generate theme JSON');
    });
});

describe('an OpenAI-compatible address that does not answer in time', () => {
    // An address as a person may have typed it: with a login and a key in it.
    const store = storeWith({
        AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY,
        OPENAI_API_URL: 'https://someone:hidden@relay.example.com/v1/chat/completions?token=hidden',
    });
    const ask = (customFetch: unknown) => client.runAiJsonCompletion({
        store, task: 'theme', systemPrompt: 'system', sourcePrompt: 'source', customFetch, timeoutMs: 20_000,
    });
    const timedOut = () => new DOMException('The operation timed out', 'TimeoutError');

    it('says which address by its origin and path only, while sending and while reading the answer', async () => {
        const sending = await ask(async () => { throw timedOut(); }).catch((error: Error) => error.message);
        expect(sending).toBe('Request to https://relay.example.com/v1/chat/completions timed out after 20s');

        const reading = await ask(async () => ({ ok: true, status: 200, json: async () => { throw timedOut(); } }))
            .catch((error: Error) => error.message);
        expect(reading).toBe('Reading the response from https://relay.example.com/v1/chat/completions timed out after 20s');

        expect(printed.filter(line => line.includes('hidden'))).toEqual([]);
    });
});
