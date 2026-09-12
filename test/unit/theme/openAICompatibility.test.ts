import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import apiTheme from '../../../api-ts/generate-theme_openai';
import generatedTheme from '../../../api/generate-theme_openai.js';
import { handleGenerateOpenAITheme } from '../../../worker/generate-theme_openai';
import apiSegments from '../../../api-ts/segment-lyrics';
import { handleSegmentLyrics } from '../../../worker/segment-lyrics';

// Exercise actual adapters, not just the shared retry predicate.
const client = createRequire(import.meta.url)('../../../electron/aiTextClient.cjs');
const theme = { name: 'test', description: 'test', backgroundColor: '#ffffff', primaryColor: '#111111',
    accentColor: '#ff0000', secondaryColor: '#555555', wordColors: [], lyricsIcons: [] };
const content = JSON.stringify({ light: theme, dark: theme, lines: [['hello']] });
type Env = Record<string, string>;
const request = () => new Request('https://app.example.test', { method: 'POST',
    body: JSON.stringify({ lyricsText: 'hello', lines: ['hello'] }) });
const routes = {
    'web theme': (env: Env) => apiTheme(request()),
    'generated web theme': (env: Env) => generatedTheme(request()),
    'worker theme': (env: Env) => handleGenerateOpenAITheme(request(), env),
    'web segmentation': (env: Env) => apiSegments(request()),
    'worker segmentation': (env: Env) => handleSegmentLyrics(request(), env),
    'electron': async (env: Env) => {
        try {
            await client.runAiJsonCompletion({ store: { get: (key: string) => env[key] },
                systemPrompt: 'JSON', sourcePrompt: 'hello', schema: { type: 'object' }, schemaName: 'test',
                maxTokens: 8192, customFetch: globalThis.fetch });
            return new Response('{}');
        } catch (error) { return new Response(String(error), { status: 500 }); }
    },
};
let sequence = 0;
const setup = (url?: string, model = 'gpt-5.6-luna', reply?: (body: Record<string, any>, index: number) => Response | undefined) => {
    const env = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', OPENAI_API_URL: url || `https://case-${sequence++}.example.test/v1`, OPENAI_API_MODEL: model };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return reply?.(body, bodies.length - 1) || Response.json({ choices: [{ message: { content } }] });
    }));
    return { env, bodies };
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const rejected = (message: string, status = 400) => Response.json({ error: { message } }, { status });

for (const [name, run] of Object.entries(routes)) describe(name, () => {
    it('uses official defaults when endpoint and model are unset', async () => {
        const { env, bodies } = setup();
        env.OPENAI_API_URL = ''; env.OPENAI_API_MODEL = '';
        vi.stubEnv('OPENAI_API_URL', ''); vi.stubEnv('OPENAI_API_MODEL', '');
        expect((await run(env)).status).toBe(200);
        expect(bodies[0].model).toBe('gpt-5.6-luna');
        expect(bodies[0].max_tokens).toBeUndefined();
        expect(bodies[0].max_completion_tokens).toBeGreaterThan(0);
    });
    it('does not remove the output bound if both token parameters are rejected', async () => {
        const { env, bodies } = setup(undefined, undefined, body =>
            rejected('Unsupported parameter: ' + (body.max_tokens ? 'max_tokens' : 'max_completion_tokens')));
        expect((await run(env)).status).toBeGreaterThanOrEqual(400);
        expect(bodies).toHaveLength(2);
        expect(bodies.every(body => body.max_tokens || body.max_completion_tokens)).toBe(true);
    });
    it.each(['gpt-5.6-luna', 'o3'])('uses official token and schema parameters for %s', async model => {
        const { env, bodies } = setup('https://api.openai.com/v1', model);
        expect((await run(env)).status).toBe(200);
        expect(bodies).toHaveLength(1);
        expect(bodies[0].max_tokens).toBeUndefined();
        expect(bodies[0].max_completion_tokens).toBeGreaterThan(0);
        expect(bodies[0].response_format.type).toBe('json_schema');
    });
    it.each(['gpt-5.6-luna', 'deepseek-reasoner'])('does not infer official capabilities from %s', async model => {
        const { env, bodies } = setup(undefined, model);
        expect((await run(env)).status).toBe(200);
        expect(bodies[0].response_format.type).toBe('json_object');
        expect(bodies[0].max_tokens).toBe(8192);
        expect(bodies[0].thinking).toBeUndefined();
        expect(bodies[0].reasoning_effort).toBeUndefined();
    });
    it.each(['response_format not supported', "Unsupported parameter: response_format", 'unsupported json_schema'])('falls back for %s', async message => {
        const { env, bodies } = setup(undefined, undefined, (_, index) => index === 0 ? rejected(message) : undefined);
        expect((await run(env)).status).toBe(200);
        expect(bodies).toHaveLength(2);
        expect(bodies[1].response_format).toBeUndefined();
        expect(bodies[1].max_tokens).toBe(8192);
    });
    it.each([429, 500, 400])('does not classify rate limiting as a capability (%s)', async status => {
        const { env, bodies } = setup(undefined, undefined, () => rejected('Concurrency limit exceeded: response_format not supported', status));
        expect((await run(env)).status).toBeGreaterThanOrEqual(400);
        expect(bodies).toHaveLength(1);
    });
    it('never applies generic fallback to official OpenAI', async () => {
        const { env, bodies } = setup('https://api.openai.com/v1', undefined, () => rejected('response_format not supported'));
        expect((await run(env)).status).toBeGreaterThanOrEqual(400);
        expect(bodies).toHaveLength(1);
    });
    it('switches the rejected token spelling while preserving the bound', async () => {
        const { env, bodies } = setup(undefined, undefined, body => body.max_tokens ? rejected('Invalid parameter: max_tokens') : undefined);
        expect((await run(env)).status).toBe(200);
        expect(bodies).toHaveLength(2);
        expect(bodies[1].max_tokens).toBeUndefined();
        expect(bodies[1].max_completion_tokens).toBe(8192);
    });
    it('does not guess another shape after a network failure', async () => {
        const { env, bodies } = setup(undefined, undefined, () => { throw new Error('network failed'); });
        expect((await run(env)).status).toBeGreaterThanOrEqual(400);
        expect(bodies).toHaveLength(1);
    });
});

it('bounds pathological JSON candidate scanning', () => {
    expect(() => client.parseAiJsonObject('{'.repeat(65536))).toThrow('valid JSON object');
    expect(client.parseAiJsonObject('prefix {bad} then {"ok":true}')).toEqual({ ok: true });
});
