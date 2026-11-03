import { afterEach, describe, expect, it, vi } from 'vitest';
import vercelGenerateGeminiTheme from '../../../api-ts/generate-theme';
import vercelGenerateOpenAITheme from '../../../api-ts/generate-theme_openai';
import builtGenerateGeminiTheme from '../../../api/generate-theme.js';
import builtGenerateOpenAITheme from '../../../api/generate-theme_openai.js';
import { resetLearnedAttempts } from '../../../shared/ai/attemptRunner.mjs';
import { segmentLyricLines } from '../../../shared/lyricSegmentationService.mjs';
import {
    SEGMENTATION_GEMINI_GENERATION_CONFIG,
    SEGMENTATION_JSON_SCHEMA,
    buildSegmentationSourcePrompt,
    buildSegmentationSystemPrompt,
} from '../../../shared/lyricSegmentationPrompt.mjs';
import { isMissingAiApiKeyError } from '../../../src/services/aiText';
import { handleGenerateTheme } from '../../../worker/generate-theme';
import { handleGenerateOpenAITheme } from '../../../worker/generate-theme_openai';

// test/unit/services/aiServerlessRequests.test.ts
// The request our serverless routes send to an OpenAI-compatible service for a theme (the three
// copies of /api/generate-theme_openai: Cloudflare's in worker/, Vercel's source in api-ts/, and
// api/, the file built from it that Vercel and the Docker backend run) and for a lyric segmentation
// (the service both /api/segment-lyrics routes share): which address and which model each
// deployment setting leads to. Recorded with a fake fetch; no request leaves the test.
//
// Also here: what a route answers when the deployment has no key (all six theme routes, the window
// must take it for a missing key), when the service's answer has no choices, and what a timeout says.
//
// Not here: what the Gemini theme routes send (worker/generate-theme.ts, api-ts/generate-theme.ts).
// They send through the @google/genai package, not through a fetch of ours.

const KEY = 'test-key';
const OPENAI_ADDRESS = 'https://api.openai.com/v1/chat/completions';
const OPENAI_HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` };

type Recorded = { url: string; method: string; headers: Record<string, string>; body: any };
type Deployment = { OPENAI_API_KEY?: string; OPENAI_API_URL?: string; OPENAI_API_MODEL?: string; OPENAI_API_TEMPERATURE?: string };

/** A fake fetch that records each request and answers as an OpenAI-compatible service would. */
const recordOpenAi = (content: string) => {
    const requests: Recorded[] = [];
    const fetchImpl = async (url: string, init: any) => {
        requests.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
    };
    return { requests, fetchImpl: fetchImpl as unknown as typeof fetch };
};

// One row per deployment setting: the address and model it leads to, and the rest of the body each
// ask sends there (the adapter the host picks, shared/ai/; messages and response_format are checked
// apart). `schema`: the ask is constrained by its JSON schema rather than plain JSON mode.
type Expected = { url: string; model: string; schema?: boolean; theme: Record<string, unknown>; segmentation: Record<string, unknown> };
const DEEPSEEK_OFF = { temperature: 0.7, max_tokens: 8192, thinking: { type: 'disabled' }, reasoning_effort: 'none' };
const DEPLOYMENTS: Array<[string, Deployment, Expected]> = [
    // OpenAI is never sent a temperature; the theme thinks a little (low) with room for it on top.
    ['only a key', {}, { url: OPENAI_ADDRESS, model: 'gpt-5.6-luna', schema: true,
        theme: { max_completion_tokens: 24576, reasoning_effort: 'low' },
        segmentation: { max_completion_tokens: 8192, reasoning_effort: 'none' } }],
    ['DeepSeek\'s address', { OPENAI_API_URL: 'https://api.deepseek.com' },
        { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-flash', theme: DEEPSEEK_OFF, segmentation: DEEPSEEK_OFF }],
    ['another DeepSeek host', { OPENAI_API_URL: 'https://eu.deepseek.com/v1/' },
        { url: 'https://eu.deepseek.com/v1/chat/completions', model: 'deepseek-flash', theme: DEEPSEEK_OFF, segmentation: DEEPSEEK_OFF }],
    ['DeepSeek\'s address and a model', { OPENAI_API_URL: 'https://api.deepseek.com/v1', OPENAI_API_MODEL: ' my-model ' },
        { url: 'https://api.deepseek.com/v1/chat/completions', model: 'my-model', theme: DEEPSEEK_OFF, segmentation: DEEPSEEK_OFF }],
    // Kimi's models fix their own sampling, so no temperature; k2.6 can switch thinking off.
    ['Kimi\'s address', { OPENAI_API_URL: 'https://api.moonshot.cn/v1' },
        { url: 'https://api.moonshot.cn/v1/chat/completions', model: 'kimi-k2.6',
            theme: { max_completion_tokens: 8192, thinking: { type: 'disabled' } },
            segmentation: { max_completion_tokens: 8192, thinking: { type: 'disabled' } } }],
    // GLM takes temperatures up to 1 only; glm-5.2 switches thinking off with 'none'.
    ['GLM\'s address and a high temperature', { OPENAI_API_URL: 'https://open.bigmodel.cn/api/paas/v4', OPENAI_API_TEMPERATURE: '1.5' },
        { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.2',
            theme: { temperature: 1, max_tokens: 8192, reasoning_effort: 'none' },
            segmentation: { temperature: 1, max_tokens: 8192, reasoning_effort: 'none' } }],
    // Any other host is the custom adapter: the theme as before, segmentation from the generic ladder.
    ['another host and a temperature', { OPENAI_API_URL: 'https://relay.example.com/v1', OPENAI_API_TEMPERATURE: '0.2' },
        { url: 'https://relay.example.com/v1/chat/completions', model: 'gpt-5.6-luna',
            theme: { temperature: 0.2, max_tokens: 8192 },
            segmentation: { temperature: 0.2, max_tokens: 8192, reasoning_effort: 'none' } }],
    ['an address that is not a URL', { OPENAI_API_URL: 'relay.example.com/v1/' },
        { url: 'relay.example.com/v1', model: 'gpt-5.6-luna',
            theme: { temperature: 0.7, max_tokens: 8192 },
            segmentation: { temperature: 0.7, max_tokens: 8192, reasoning_effort: 'none' } }],
];

afterEach(() => {
    // The runner remembers the attempt that worked per endpoint and model, across these routes too.
    resetLearnedAttempts();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** The Vercel copies read the deployment's settings from process.env. */
const withProcessEnv = (handler: (request: Request) => Promise<Response>) => (request: Request, deployment: Deployment) => {
    for (const name of ['OPENAI_API_KEY', 'OPENAI_API_URL', 'OPENAI_API_MODEL', 'OPENAI_API_TEMPERATURE'] as const) {
        vi.stubEnv(name, deployment[name] ?? '');
    }
    return handler(request);
};

describe.each([
    ['the Cloudflare route', (request: Request, deployment: Deployment) => handleGenerateOpenAITheme(request, deployment)],
    ['the Vercel route', withProcessEnv(vercelGenerateOpenAITheme)],
    ['the built Vercel route', withProcessEnv(builtGenerateOpenAITheme)],
])('a theme from %s for OpenAI-compatible services', (_name, handle) => {
    const ask = () => new Request('https://folia.test/api/generate-theme_openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyricsText: 'la la la' }),
    });

    it.each(DEPLOYMENTS)('with %s', async (_setting, deployment, expected) => {
        const { requests, fetchImpl } = recordOpenAi('{"light":{"name":"Dawn"},"dark":{"name":"Night"}}');
        vi.stubGlobal('fetch', fetchImpl);

        const response = await handle(ask(), { OPENAI_API_KEY: KEY, ...deployment });

        expect(requests).toHaveLength(1);
        const { body: { messages, response_format: responseFormat, ...body }, ...request } = requests[0];
        expect(request).toEqual({ url: expected.url, method: 'POST', headers: OPENAI_HEADERS });
        expect(body).toEqual({ model: expected.model, ...expected.theme });
        if (expected.schema) {
            expect(responseFormat).toMatchObject({ type: 'json_schema', json_schema: { name: 'dual_theme', strict: true } });
        } else {
            expect(responseFormat).toEqual({ type: 'json_object' });
        }
        expect(messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user']);
        expect(messages[0].content.startsWith('Analyze the mood of the provided song source text')).toBe(true);
        expect(messages[1].content).toBe('Pure instrumental: no\nSource snippet:\nla la la');

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            light: { name: 'Dawn', fontStyle: 'sans', provider: 'OpenAI Compatible' },
            dark: { name: 'Night', fontStyle: 'sans', provider: 'OpenAI Compatible' },
        });
    });

    it('without a key sends nothing and answers with a server error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { requests, fetchImpl } = recordOpenAi('{}');
        vi.stubGlobal('fetch', fetchImpl);

        const response = await handle(ask(), {});

        expect(requests).toEqual([]);
        expect(response.status).toBe(500);
        const answer = await response.json();
        expect(answer).toEqual({ error: 'Server configuration error' });
        // The window falls back to colours from the cover when it takes the answer for a missing key.
        expect(isMissingAiApiKeyError(new Error(answer.error))).toBe(true);
    });

    it('answers that no theme came when the service answers without choices', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', (async () => Response.json({})) as unknown as typeof fetch);

        const response = await handle(ask(), { OPENAI_API_KEY: KEY });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'Failed to generate theme JSON' });
    });

    it('moves to the next attempt when the service rejects the reasoning switch by name, and remembers it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const bodies: any[] = [];
        vi.stubGlobal('fetch', (async (_url: string, init: any) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            return body.reasoning_effort
                ? Response.json({ error: { message: 'Bad request', param: 'reasoning_effort', code: 'invalid_value' } }, { status: 400 })
                : Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"light":{"name":"Dawn"},"dark":{"name":"Night"}}' } }] });
        }) as unknown as typeof fetch);
        // DeepSeek's attempts: both switches, then thinking alone, then neither.
        const deployment = { OPENAI_API_KEY: KEY, OPENAI_API_URL: 'https://api.deepseek.com' };

        const response = await handle(ask(), deployment);

        expect(response.status).toBe(200);
        expect(bodies.map(body => [body.thinking, body.reasoning_effort])).toEqual([
            [{ type: 'disabled' }, 'none'],
            [{ type: 'disabled' }, undefined],
        ]);
        await handle(ask(), deployment);
        expect(bodies).toHaveLength(3);
        expect(bodies[2].reasoning_effort).toBeUndefined();
    });

    it('says when reasoning used up the whole budget on the last attempt', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', (async () => Response.json({
            choices: [{ finish_reason: 'length', message: { content: '' } }],
            usage: { completion_tokens_details: { reasoning_tokens: 24576 } },
        })) as unknown as typeof fetch);

        const response = await handle(ask(), { OPENAI_API_KEY: KEY });

        expect(response.status).toBe(500);
        expect((await response.json()).error).toBe('Model "gpt-5.6-luna" used its entire output budget on reasoning and returned no theme.');
    });
});

describe('a theme from the Gemini routes of a deployment without a key', () => {
    const body = { lyricsText: 'la la la' };
    /** The Vercel copies answer through a response object they are handed. */
    const vercelAnswer = async (handler: (req: unknown, res: unknown) => Promise<unknown>) => {
        const answer = { status: 0, body: undefined as unknown };
        const res = {
            status(code: number) { answer.status = code; return res; },
            json(value: unknown) { answer.body = value; return res; },
        };
        vi.stubEnv('GEMINI_API_KEY', '');
        await handler({ method: 'POST', body }, res);
        return answer;
    };

    it.each([
        ['the Cloudflare route', async () => {
            const response = await handleGenerateTheme(new Request('https://folia.test/api/generate-theme', { method: 'POST', body: JSON.stringify(body) }), {} as never);
            return { status: response.status, body: await response.json() };
        }],
        ['the Vercel route', () => vercelAnswer(vercelGenerateGeminiTheme)],
        ['the built Vercel route', () => vercelAnswer(builtGenerateGeminiTheme)],
    ])('%s answers what the window takes for a missing key', async (_name, answerOf) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const answer = await answerOf();

        expect(answer).toEqual({ status: 500, body: { error: 'Server configuration error' } });
        expect(isMissingAiApiKeyError(new Error((answer.body as { error: string }).error))).toBe(true);
    });
});

describe('a lyric segmentation from the service both /api/segment-lyrics routes share', () => {
    const LINES = ['la la'];
    const MESSAGES = [
        { role: 'system', content: buildSegmentationSystemPrompt() },
        { role: 'user', content: buildSegmentationSourcePrompt(LINES) },
    ];

    it.each(DEPLOYMENTS)('to an OpenAI-compatible service with %s', async (_setting, deployment, expected) => {
        const { requests, fetchImpl } = recordOpenAi('{"lines":[["la ","la"]]}');

        const boundaries = await segmentLyricLines(LINES, { OPENAI_API_KEY: KEY, ...deployment }, fetchImpl);

        expect(requests).toEqual([{
            url: expected.url,
            method: 'POST',
            headers: OPENAI_HEADERS,
            body: {
                model: expected.model,
                messages: MESSAGES,
                ...expected.segmentation,
                response_format: expected.schema
                    ? { type: 'json_schema', json_schema: { name: 'lyric_word_segmentation', strict: true, schema: SEGMENTATION_JSON_SCHEMA } }
                    : { type: 'json_object' },
            },
        }]);
        expect(boundaries).toEqual([['la ', 'la']]);
    });

    it('says which service timed out without the credentials or the query of its address', async () => {
        const fetchImpl = (async () => {
            throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
        }) as unknown as typeof fetch;

        const failure = await segmentLyricLines(
            LINES,
            { OPENAI_API_KEY: KEY, OPENAI_API_URL: 'https://someone:a-password@relay.example.com/v1?key=a-key-in-the-address' },
            fetchImpl,
        ).catch((error: unknown) => error) as { status: number; message: string };

        expect(failure.status).toBe(504);
        expect(failure.message).toBe('Request to https://relay.example.com/v1/chat/completions timed out');
    });

    it('to Gemini when the deployment has its key', async () => {
        const requests: Recorded[] = [];
        const fetchImpl = (async (url: string, init: any) => {
            requests.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
            return Response.json({ candidates: [{ content: { parts: [{ text: '{"lines":[["la ","la"]]}' }] } }] });
        }) as unknown as typeof fetch;

        const boundaries = await segmentLyricLines(LINES, { GEMINI_API_KEY: KEY, OPENAI_API_KEY: 'other-test-key' }, fetchImpl);

        expect(requests).toEqual([{
            url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
            body: {
                systemInstruction: { parts: [{ text: MESSAGES[0].content }] },
                contents: [{ parts: [{ text: MESSAGES[1].content }] }],
                generationConfig: SEGMENTATION_GEMINI_GENERATION_CONFIG,
            },
        }]);
        expect(boundaries).toEqual([['la ', 'la']]);
    });
});
