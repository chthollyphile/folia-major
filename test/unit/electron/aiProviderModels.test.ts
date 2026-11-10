import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER_PRESETS, resolveAiProviderPreset } from '../../../shared/ai/providerRegistry.mjs';

// Provider catalogues, native protocols and legacy settings are tested without network access.
const require = createRequire(import.meta.url);
const { listAiModels } = require('../../../electron/ai/modelDiscovery.cjs');
const { registerAiModelDiscovery } = require('../../../electron/ai/modelDiscoveryIpc.cjs');
const client = require('../../../electron/aiTextClient.cjs');
const payload = { provider: 'openai', apiKey: 'test-secret', apiUrl: 'https://relay.example/v1' };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const storeWith = (settings: Record<string, unknown>) => ({ get: (name: string) => settings[name] });

describe('provider presets and migration', () => {
    it('includes the requested providers and keeps custom last', () => {
        expect(AI_PROVIDER_PRESETS.map(p => p.id)).toEqual(['qwen', 'anthropic', 'deepseek', 'gemini', 'kimi', 'openai', 'tencentcloud', 'mimo', 'glm', 'custom']);
    });
    it('preserves old compatible connections and infers the provider from the host', () => {
        expect(resolveAiProviderPreset({}).id).toBe('gemini');
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'deepseek', OPENAI_API_URL: 'https://custom.example/v1' }).id).toBe('custom');
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.deepseek.com/v1/chat/completions/' }).id).toBe('deepseek');
        // DeepSeek's own spelling of its address, without /v1, was custom while presets matched by text.
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.deepseek.com' }).id).toBe('deepseek');
        // An old compatible-layer setting on Anthropic's host now uses the native Messages API.
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1' }).id).toBe('anthropic');
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'anthropic', OPENAI_API_URL: 'https://api.anthropic.com/v1' }).protocol).toBe('anthropic');
        // Requests go where the URL says (the saved key is bound to it), so a preset alone does not move them.
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'anthropic' }).id).toBe('openai');
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'gemini', AI_PROVIDER_PRESET: 'anthropic' }).id).toBe('gemini');
    });
});

describe('model discovery', () => {
    // GLM has no listing (shared/ai/glm.mjs); see 'model discovery as described by the adapters'.
    it.each(AI_PROVIDER_PRESETS.filter(p => p.protocol === 'openai' && p.id !== 'custom' && p.id !== 'glm'))('uses the %s base path and Bearer authentication', async preset => {
        // A model the provider's own listing filter keeps.
        const modelId = preset.recommendedModel ?? 'model-one';
        const customFetch = vi.fn().mockResolvedValue(json({ data: [{ id: modelId }] }));
        const result = await listAiModels({ ...payload, apiUrl: preset.baseUrl }, { customFetch });
        const url = new URL(customFetch.mock.calls[0][0]);
        expect(url.origin).toBe(new URL(preset.baseUrl).origin);
        // <API base>/models, the base as requests normalise it (DeepSeek's bare origin gains /v1).
        const base = new URL(client.normalizeOpenAIChatCompletionsUrl(preset.baseUrl)).pathname.replace(/\/chat\/completions$/, '');
        expect(url.pathname).toBe(base + '/models');
        expect(customFetch.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer test-secret' }, redirect: 'error' });
        expect(result).toMatchObject({ ok: true, models: [{ id: modelId }] });
    });
    it('filters Gemini non-chat models, normalises names and follows page tokens on the same host', async () => {
        const customFetch = vi.fn()
            .mockResolvedValueOnce(json({ models: [
                { name: 'models/gemini-one', displayName: 'One', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
                { name: 'models/../unsafe', supportedGenerationMethods: ['generateContent'] },
            ], nextPageToken: 'https://other.example/?secret=anything' }))
            .mockResolvedValueOnce(json({ models: [{ name: 'models/gemini-two', supportedGenerationMethods: ['generateContent'] }] }));
        expect(await listAiModels({ provider: 'gemini', apiKey: 'test-secret' }, { customFetch })).toEqual({
            ok: true, models: [{ id: 'gemini-one', name: 'One' }, { id: 'gemini-two', name: 'gemini-two' }],
        });
        expect(new URL(customFetch.mock.calls[1][0]).hostname).toBe('generativelanguage.googleapis.com');
        expect(customFetch.mock.calls[0][1].headers).toEqual({ 'x-goog-api-key': 'test-secret' });
        expect(customFetch.mock.calls[0][0]).not.toContain('test-secret');
    });
    it('uses native Anthropic headers and pagination, without Bearer auth', async () => {
        const customFetch = vi.fn()
            .mockResolvedValueOnce(json({ data: [{ id: 'claude-one', display_name: 'Claude One' }], has_more: true, last_id: 'claude-one' }))
            .mockResolvedValueOnce(json({ data: [{ id: 'claude-two' }], has_more: false }));
        const result = await listAiModels({ ...payload, presetId: 'anthropic', apiUrl: 'https://api.anthropic.com/v1/messages' }, { customFetch });
        expect(result.models).toHaveLength(2);
        expect(customFetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models?limit=1000');
        expect(customFetch.mock.calls[1][0]).toContain('after_id=claude-one');
        expect(customFetch.mock.calls[0][1].headers).toMatchObject({ 'x-api-key': 'test-secret', 'anthropic-version': '2023-06-01' });
        expect(customFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });
    it('deduplicates models and ignores malformed rows', async () => {
        const customFetch = vi.fn().mockResolvedValue(json({ data: [null, {}, { id: 'a' }, { id: 'a' }, { id: 'bad\u0000id' }, { id: 12 }] }));
        expect(await listAiModels(payload, { customFetch })).toEqual({ ok: true, models: [{ id: 'a', name: 'a' }] });
    });
    it.each([401, 403, 500])('returns a fixed failure for HTTP %i without echoing response bodies', async status => {
        const result = await listAiModels(payload, { customFetch: async () => new Response('test-secret Authorization: secret', { status }) });
        expect(result).toEqual({ ok: false, status, errorKind: status === 500 ? 'http' : 'auth' });
        expect(JSON.stringify(result)).not.toContain('secret');
    });
    it.each([null, {}, { data: [] }, { data: 'wrong' }])('handles an invalid or empty catalogue: %s', async data => {
        const result = await listAiModels(payload, { customFetch: async () => json(data) });
        expect(result).toEqual({ ok: false, errorKind: Array.isArray(data?.data) ? 'empty' : 'invalid' });
    });
    it('rejects invalid JSON and oversized streamed bodies', async () => {
        for (const text of ['not json', 'x'.repeat(2_000_001)]) {
            expect(await listAiModels(payload, { customFetch: async () => new Response(text) })).toEqual({ ok: false, errorKind: 'invalid' });
        }
    });
    it('bounds pagination and rejects repeating cursors', async () => {
        const customFetch = vi.fn().mockImplementation(async () => json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }));
        expect(await listAiModels(payload, { customFetch })).toEqual({ ok: false, errorKind: 'invalid' });
        expect(customFetch).toHaveBeenCalledTimes(2);
    });
    it('fails before requesting with missing keys or invalid connection values', async () => {
        const customFetch = vi.fn();
        expect(await listAiModels({ ...payload, apiKey: '' }, { customFetch })).toEqual({ ok: false, errorKind: 'config' });
        expect(await listAiModels({ ...payload, apiUrl: 'file:///secret' }, { customFetch })).toEqual({ ok: false, errorKind: 'invalid' });
        expect(customFetch).not.toHaveBeenCalled();
    });
    it('reports timeout and transport errors without credentials', async () => {
        const customFetch = (_url: string, init: any) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('test-secret'))));
        expect(await listAiModels(payload, { customFetch, timeoutMs: 5 })).toEqual({ ok: false, errorKind: 'timeout' });
        expect(await listAiModels(payload, { customFetch: async () => { throw new Error('test-secret'); } })).toEqual({ ok: false, errorKind: 'network' });
    });
});

describe('model discovery as described by the adapters', () => {
    const { modelListUrl } = require('../../../electron/ai/modelDiscovery.cjs');
    const adapter = (models: Record<string, unknown>, protocol = 'openai') => ({
        protocol, endpoints: [{ id: 'default', baseUrl: 'https://catalogue.example/v9' }], models,
    });

    it('lists <API base>/models unless the adapter names its own path and query', () => {
        expect(modelListUrl(adapter({}), 'https://relay.example/v1/chat/completions').toString()).toBe('https://relay.example/v1/models');
        expect(modelListUrl(adapter({ path: '/api/list', query: { pageSize: '50' } }), 'https://relay.example/v1').toString())
            .toBe('https://relay.example/api/list?pageSize=50');
        expect(modelListUrl(adapter({}, 'gemini'), undefined).toString()).toBe('https://catalogue.example/v9/models');
        expect(modelListUrl(adapter({}, 'anthropic'), 'https://api.anthropic.com/v1/messages').toString()).toBe('https://api.anthropic.com/v1/models');
    });

    it('sends no listing request to either GLM site, whose model centre is undocumented, and suggests models instead', async () => {
        for (const apiUrl of ['https://open.bigmodel.cn/api/paas/v4', 'https://api.z.ai/api/paas/v4']) {
            const customFetch = vi.fn();
            expect(await listAiModels({ ...payload, apiUrl }, { customFetch })).toEqual({
                ok: false, errorKind: 'empty', suggestedModels: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-4.7-flash'],
            });
            expect(customFetch).not.toHaveBeenCalled();
        }
    });

    it('returns the adapter\'s suggested models with a failed or empty listing, and only then', async () => {
        const apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        const suggestedModels = ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max'];
        expect(await listAiModels({ ...payload, apiUrl }, { customFetch: async () => new Response('denied', { status: 401 }) }))
            .toEqual({ ok: false, status: 401, errorKind: 'auth', suggestedModels });
        expect(await listAiModels({ ...payload, apiUrl }, { customFetch: async () => json({ data: [] }) }))
            .toEqual({ ok: false, errorKind: 'empty', suggestedModels });
        expect(await listAiModels({ ...payload, apiUrl }, { customFetch: async () => json({ data: [{ id: 'qwen3.8-flash' }] }) }))
            .toEqual({ ok: true, models: [{ id: 'qwen3.8-flash', name: 'qwen3.8-flash' }] });
        // A provider without suggestions fails as before.
        expect(await listAiModels(payload, { customFetch: async () => json({ data: [] }) })).toEqual({ ok: false, errorKind: 'empty' });
    });

    it('follows page-number paging until the reported total', async () => {
        const page = (ids: string[]) => json({ rows: ids.map(modelCode => ({ modelCode })), total: 150 });
        const customFetch = vi.fn()
            .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => `m${index}`)))
            .mockResolvedValueOnce(page(['last']));
        const result = await listAiModels(payload, { customFetch });
        expect(result.models).toHaveLength(101);
        expect(new URL(customFetch.mock.calls[1][0]).searchParams.get('pageNum')).toBe('2');
    });
});

describe('discovery IPC credential boundary', () => {
    const setup = (resolved: unknown = { apiKey: 'saved-secret' }) => {
        let handler: any;
        const resolveTestApiKey = vi.fn().mockReturnValue(resolved);
        const fetchWithOptionalSystemProxy = vi.fn().mockImplementation(async () => json({ data: [{ id: 'one' }] }));
        registerAiModelDiscovery({
            ipcMain: { handle: (_name: string, fn: unknown) => { handler = fn; } },
            aiCredentials: { resolveTestApiKey }, store: storeWith({ USE_SYSTEM_PROXY_FOR_AI: true }),
            isTrustedMainWindowContents: (sender: string) => sender === 'main',
            fetchWithOptionalSystemProxy,
        });
        return { invoke: (value: unknown, sender = 'main') => handler({ sender }, value), resolveTestApiKey, fetchWithOptionalSystemProxy };
    };
    it('blocks untrusted windows and keys bound to another endpoint', async () => {
        const test = setup({ error: 'endpoint mismatch' });
        expect(await test.invoke(payload, 'other')).toEqual({ ok: false, errorKind: 'invalid' });
        expect(test.resolveTestApiKey).not.toHaveBeenCalled();
        expect(await test.invoke(payload)).toEqual({ ok: false, errorKind: 'config' });
        expect(test.fetchWithOptionalSystemProxy).not.toHaveBeenCalled();
    });
    it.each([
        { provider: 'openai', catalogue: { data: [
            { id: 'Bearer saved-secret' },
            { id: 'one', display_name: 'Authorization: Bearer saved-secret; saved-secret' },
        ] } },
        { provider: 'openai', presetId: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', catalogue: { data: [
            { id: 'saved-secret' },
            { id: 'one', display_name: 'x-api-key: saved-secret' },
        ] } },
        { provider: 'gemini', shownId: 'gemini-one', catalogue: { models: [
            { name: 'models/gemini-saved-secret', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-one', displayName: 'x-goog-api-key: saved-secret', supportedGenerationMethods: ['generateContent'] },
        ] } },
        { provider: 'openai', catalogue: { rows: [
            { modelCode: 'saved-secret' },
            { modelCode: 'one', modelName: 'Model saved-secret' },
        ], total: 2 } },
    ])('sanitises successful $provider catalogue fields before returning saved credentials to the renderer', async ({ catalogue, shownId = 'one', ...connection }) => {
        const test = setup();
        test.fetchWithOptionalSystemProxy.mockImplementation(async () => json(catalogue));
        const result = await test.invoke({ ...payload, ...connection, apiKey: '' });
        expect(result.ok).toBe(true);
        expect(result.models).toHaveLength(1);
        expect(result.models[0].id).toBe(shownId);
        expect(result.models[0].name).toContain('***');
        expect(JSON.stringify(result)).not.toContain('saved-secret');
    });
    it('returns an empty catalogue failure when all model ids contain the saved key', async () => {
        const test = setup();
        test.fetchWithOptionalSystemProxy.mockImplementation(async () => json({ data: [{ id: 'model-saved-secret' }] }));
        expect(await test.invoke({ ...payload, apiKey: '' })).toEqual({ ok: false, errorKind: 'empty' });
    });
    it('redacts complete keys before truncating display names', async () => {
        const test = setup();
        test.fetchWithOptionalSystemProxy.mockImplementation(async () => json({ data: [
            { id: 'one', display_name: 'x'.repeat(250) + 'saved-secret' },
        ] }));
        const result = await test.invoke({ ...payload, apiKey: '' });
        expect(result).toEqual({ ok: true, models: [{ id: 'one', name: 'x'.repeat(250) + '***' }] });
    });
    it('uses the saved key and proxy choice only in the main process', async () => {
        const test = setup();
        const result = await test.invoke({ ...payload, apiKey: '', useSystemProxy: false });
        expect(test.resolveTestApiKey).toHaveBeenCalledWith('openai', '', payload.apiUrl);
        expect(test.fetchWithOptionalSystemProxy.mock.calls[0][1].headers.Authorization).toBe('Bearer saved-secret');
        expect(test.fetchWithOptionalSystemProxy.mock.calls[0][2]).toBe(false);
        expect(JSON.stringify(result)).not.toContain('secret');
        await test.invoke({ ...payload, apiKey: '' });
        expect(test.fetchWithOptionalSystemProxy.mock.calls[1][2]).toBe(true);
    });
});

describe('custom provider URL requirements', () => {
    it.each(['', '   '])('blocks connection tests, discovery and saved completions before fetch for URL %j', async apiUrl => {
        const customFetch = vi.fn();
        const input = { ...payload, apiUrl, model: 'custom-model', presetId: 'custom' };
        expect(await client.runAiConnectionTest(input, { customFetch })).toMatchObject({ ok: false, errorKind: 'invalid' });
        expect(await listAiModels(input, { customFetch })).toEqual({ ok: false, errorKind: 'invalid' });
        const store = storeWith({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'custom',
            OPENAI_API_URL: apiUrl, OPENAI_API_KEY: 'test-secret', OPENAI_API_MODEL: 'custom-model' });
        await expect(client.runAiJsonCompletion({ store, task: 'theme', systemPrompt: 'system', sourcePrompt: 'source', customFetch }))
            .rejects.toThrow('API URL is required');
        expect(customFetch).not.toHaveBeenCalled();
    });
});

describe('selected model completion', () => {
    it('trims a saved Anthropic model exactly as the connection test does', async () => {
        const models: string[] = [];
        const customFetch = async (_url: string, init: any) => {
            models.push(JSON.parse(init.body).model);
            return json({ content: [{ type: 'text', text: '{}' }] });
        };
        const model = '  claude-selected\t';
        const store = storeWith({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'anthropic',
            OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: 'test-secret', OPENAI_API_MODEL: model });
        expect(await client.runAiConnectionTest({ ...payload, presetId: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', model }, { customFetch })).toMatchObject({ ok: true });
        await client.runAiJsonCompletion({ store, task: 'theme', systemPrompt: 'theme', sourcePrompt: 'source', customFetch });
        await client.runAiJsonCompletion({ store, task: 'segmentation', systemPrompt: 'segmentation', sourcePrompt: 'source', customFetch });
        expect(models).toEqual(['claude-selected', 'claude-selected', 'claude-selected']);
    });
    it.each([undefined, null, 12, '', '   ', 'a'.repeat(257), 'claude bad', 'claude\ninvalid'])('rejects invalid Anthropic model %j before fetch', async model => {
        const { sendAnthropic } = require('../../../electron/ai/anthropicClient.cjs');
        const customFetch = vi.fn();
        await expect(sendAnthropic({ apiKey: 'test-secret', body: { model, max_tokens: 512, messages: [{ role: 'user', content: 'hello' }] }, customFetch }))
            .rejects.toThrow('valid Anthropic model');
        expect(customFetch).not.toHaveBeenCalled();
    });
    it('never sends Claude a temperature, and fails once with the provider\'s redacted error', async () => {
        const bodies: any[] = [];
        const customFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
            bodies.push(JSON.parse(init.body));
            return json({ content: [{ type: 'text', text: '{}' }] });
        });
        const store = storeWith({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: 'test-secret',
            OPENAI_API_MODEL: 'claude-opus-4-6', OPENAI_API_TEMPERATURE: '0.7' });
        await client.runAiJsonCompletion({ store, task: 'theme', systemPrompt: 'theme', sourcePrompt: 'source', customFetch, answerTokens: 8192 });
        await client.runAiJsonCompletion({ store, task: 'segmentation', systemPrompt: 'segmentation', sourcePrompt: 'source', customFetch, answerTokens: 8192 });
        expect(bodies.map(body => 'temperature' in body)).toEqual([false, false]);

        const denied = vi.fn().mockImplementation(async () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key test-secret' } }, 401));
        const failure = await client.runAiJsonCompletion({ store, task: 'theme', systemPrompt: 'theme', sourcePrompt: 'source', customFetch: denied, answerTokens: 8192 })
            .catch((error: Error) => error.message);
        expect(failure).toBe('Anthropic API error (401): authentication_error: invalid x-api-key ***');
        expect(denied).toHaveBeenCalledTimes(1);
    });
    it('uses the selected Gemini model for both real theme and segmentation requests', async () => {
        const calls: { url: string; body: any }[] = [];
        const customFetch = async (url: string, init: any) => {
            calls.push({ url, body: JSON.parse(init.body) });
            return json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
        };
        const store = storeWith({ GEMINI_API_KEY: 'test-secret', GEMINI_API_MODEL: 'models/gemini-selected' });
        await client.runGeminiThemeCompletion({ store, systemPrompt: 'system', sourcePrompt: 'source', responseSchema: {}, customFetch });
        await client.runAiJsonCompletion({ store, task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source', customFetch,
            geminiSchema: { type: 'OBJECT' }, answerTokens: 8192 });
        expect(calls.map(call => call.url)).toEqual(Array(2).fill('https://generativelanguage.googleapis.com/v1beta/models/gemini-selected:generateContent'));
        // A model the adapter does not list starts from the lowest thinking level for each ask.
        expect(calls.map(call => call.body.generationConfig.thinkingConfig)).toEqual([{ thinkingLevel: 'low' }, { thinkingLevel: 'minimal' }]);
    });
    it('asks native Anthropic for the schema through output_config.format, reads the text block and keeps the selected model', async () => {
        const calls: any[] = [];
        const customFetch = async (url: string, init: any) => {
            calls.push({ url, init, body: JSON.parse(init.body) });
            return json({ model: 'claude-selected', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"lines":[]}' }] });
        };
        const store = storeWith({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'anthropic', OPENAI_API_KEY: 'test-secret',
            OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_MODEL: 'claude-selected', OPENAI_API_STREAM: true });
        expect(await client.runAiJsonCompletion({ store, task: 'theme', systemPrompt: 'system', sourcePrompt: 'source',
            schema: { type: 'object', properties: { lines: { type: 'array' } } }, schemaName: 'result', customFetch })).toBe('{"lines":[]}');
        expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
        expect(calls[0].body).toMatchObject({ model: 'claude-selected', system: 'system',
            output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', properties: { lines: { type: 'array' } }, additionalProperties: false } } } });
        expect(calls[0].body.tools).toBeUndefined();
        expect(calls[0].body.tool_choice).toBeUndefined();
        expect(calls[0].body.stream).toBeUndefined();
    });
    it('tests the unsaved selected Gemini model and Anthropic protocol', async () => {
        const calls: any[] = [];
        const customFetch = async (url: string, init: any) => {
            calls.push({ url, init, body: JSON.parse(init.body) });
            return url.includes('googleapis')
                ? json({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] })
                : json({ content: [{ type: 'text', text: 'Hi test-secret' }] });
        };
        await client.runAiConnectionTest({ provider: 'gemini', apiKey: 'test-secret', model: 'gemini-selected' }, { customFetch });
        const result = await client.runAiConnectionTest({ ...payload, presetId: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', model: 'claude-selected' }, { customFetch });
        expect(calls[0].url).toContain('/gemini-selected:generateContent');
        expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
        expect(calls[1].url).toBe('https://api.anthropic.com/v1/messages');
        expect(result).toMatchObject({ ok: true, model: 'claude-selected', text: 'Hi ***' });
    });
    it('follows the address\'s host, not the form\'s preset, as the saved settings do', async () => {
        const urls: string[] = [];
        const customFetch = async (url: string) => {
            urls.push(url);
            return json({ choices: [{ finish_reason: 'stop', message: { content: 'Hi' } }] });
        };
        // A preset that does not match the address is only what the form shows; the relay is a custom endpoint.
        expect(await client.runAiConnectionTest({ ...payload, presetId: 'anthropic', model: 'claude-selected' }, { customFetch })).toMatchObject({ ok: true });
        expect(urls).toEqual(['https://relay.example/v1/chat/completions']);
        expect(client.validateAiConnectionTestInput({ ...payload, presetId: 12 })).toEqual({ error: 'Unknown AI provider preset.' });
        expect(client.validateAiConnectionTestInput({ ...payload, apiUrl: '', presetId: 'custom' })).toEqual({ error: 'API URL is required for a custom AI provider.' });
        expect(client.validateAiConnectionTestInput({ ...payload, apiUrl: '', presetId: 'openai' }).config).toMatchObject({ presetId: 'openai', apiUrl: '' });
    });
});
