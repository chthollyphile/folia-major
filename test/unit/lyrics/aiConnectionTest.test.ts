import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/lyrics/aiConnectionTest.test.ts
// The AI settings "test connection" button sends one "hello" with the unsaved form values. These
// tests drive runAiConnectionTest with an injected fetch (no network) and pin the request shape,
// the result mapping and the input validation.

const client = createRequire(import.meta.url)('../../../electron/aiTextClient.cjs');

type Call = { url: string; init: any; body: any };

const makeFetch = (respond: (call: Call) => Response | Promise<Response>) => {
    const calls: Call[] = [];
    const customFetch = async (url: string, init: any) => {
        const call = { url, init, body: init?.body ? JSON.parse(init.body) : undefined };
        calls.push(call);
        return respond(call);
    };
    return { calls, customFetch };
};

const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const sse = (...frames: unknown[]) =>
    new Response(
        frames.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`).join(''),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

const openai = (extra: Record<string, unknown> = {}) => ({
    provider: 'openai',
    apiKey: 'sk-secret',
    apiUrl: 'https://relay.example.com/v1',
    model: 'my-model',
    ...extra,
});

describe('runAiConnectionTest (OpenAI compatible)', () => {
    it('sends only a hello user message and reports the reply', async () => {
        const { calls, customFetch } = makeFetch(() => json({
            model: 'my-model-2026',
            choices: [{ message: { content: 'Hi there!\nSecond line' }, finish_reason: 'stop' }],
        }));
        const result = await client.runAiConnectionTest(openai(), { customFetch });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://relay.example.com/v1/chat/completions');
        expect(calls[0].init.headers.Authorization).toBe('Bearer sk-secret');
        expect(calls[0].body).toEqual({
            model: 'my-model',
            messages: [{ role: 'user', content: 'hello' }],
            max_tokens: 512,
        });
        expect(result).toMatchObject({ ok: true, status: 200, model: 'my-model-2026', text: 'Hi there!\nSecond line' });
        expect(typeof result.durationMs).toBe('number');
    });

    it('redacts the key from a successful reply that echoes it', async () => {
        const { customFetch } = makeFetch(() => json({
            choices: [{ message: { content: 'You sent Bearer sk-secret, key sk-secret' }, finish_reason: 'stop' }],
        }));
        const result = await client.runAiConnectionTest(openai(), { customFetch });

        expect(result.ok).toBe(true);
        expect(result.text).not.toContain('sk-secret');
    });

    it('uses max_completion_tokens on the official OpenAI host', async () => {
        const { calls, customFetch } = makeFetch(() => json({ choices: [{ message: { content: 'hi' } }] }));
        const result = await client.runAiConnectionTest(
            openai({ apiUrl: 'https://api.openai.com/v1' }),
            { customFetch },
        );
        expect(calls[0].body.max_completion_tokens).toBe(512);
        expect(calls[0].body.max_tokens).toBeUndefined();
        expect(result.model).toBe('my-model');
    });

    it('reads a streamed reply when the stream flag is on', async () => {
        const { calls, customFetch } = makeFetch(() => sse(
            { model: 'streamed-model', choices: [{ delta: { content: 'Hel' } }] },
            { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
            '[DONE]',
        ));
        const result = await client.runAiConnectionTest(openai({ stream: true }), { customFetch });
        expect(calls[0].body.stream).toBe(true);
        expect(result).toMatchObject({ ok: true, text: 'Hello', model: 'streamed-model' });
    });

    it.each([false, true])('asks an always-thinking GLM model for its lowest level, which it accepts (stream=%s)', async (stream) => {
        const { calls, customFetch } = makeFetch((call) => (
            call.body.reasoning_effort !== 'low'
            || call.body.thinking !== undefined
            || call.body.chat_template_kwargs !== undefined
        )
            ? json({ error: { message: '该模型始终思考，不支持关闭思考，请使用 low、high 或 max。' } }, 400)
            : stream
                ? sse({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }, '[DONE]')
                : json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }));
        const result = await client.runAiConnectionTest(openai({
            apiUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-5.3-flash', stream,
        }), { customFetch });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
        expect(calls[0].body).toMatchObject({ reasoning_effort: 'low', max_tokens: 4096 });
        expect(result).toMatchObject({ ok: true, text: 'hi' });
    });

    it('falls back to a bare hello when a GLM endpoint rejects the level', async () => {
        const { calls, customFetch } = makeFetch((call) => (call.body.reasoning_effort !== undefined
            ? json({ error: { code: '1214', message: '`reasoning_effort` 参数非法。请检查文档' } }, 400)
            : json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })));
        const result = await client.runAiConnectionTest(openai({
            apiUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5.3-flash',
        }), { customFetch });
        expect(calls.map(call => call.body.reasoning_effort)).toEqual(['low', undefined]);
        expect(calls[1].body).toEqual({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'hello' }], max_tokens: 4096 });
        expect(result).toMatchObject({ ok: true, text: 'hi' });
    });

    it('still sends a bare hello to an unknown endpoint', async () => {
        const { calls, customFetch } = makeFetch(() => json({ choices: [{ message: { content: 'hi' } }] }));
        await client.runAiConnectionTest(openai(), { customFetch });
        expect(calls.map(call => call.body)).toEqual([{ model: 'my-model', messages: [{ role: 'user', content: 'hello' }], max_tokens: 512 }]);
    });

    it('switches DeepSeek thinking off, as segmentation does', async () => {
        const { calls, customFetch } = makeFetch(() => json({ choices: [{ message: { content: 'hi' } }] }));
        await client.runAiConnectionTest(openai({ apiUrl: 'https://api.deepseek.com/v1' }), { customFetch });
        expect(calls).toHaveLength(1);
        expect(calls[0].body.thinking).toEqual({ type: 'disabled' });
        expect(calls[0].body.reasoning_effort).toBe('none');
        expect(calls[0].body.chat_template_kwargs).toBeUndefined();
        expect(calls[0].body.max_tokens).toBe(512);
    });

    it('scrubs echoed Authorization, x-goog-api-key and key= values from errors', async () => {
        const { customFetch } = makeFetch(() => json({ error: { message: 'bad Authorization: Bearer zzz-other x-goog-api-key: abc123 at /x?key=qq1&a=1' } }, 401));
        const result = await client.runAiConnectionTest(openai(), { customFetch });
        const text = JSON.stringify(result);
        expect(text).not.toContain('zzz-other');
        expect(text).not.toContain('abc123');
        expect(text).not.toContain('qq1');
    });

    it('reports an empty reply caused by reasoning as a success with a reason', async () => {
        const { calls, customFetch } = makeFetch(() => json({
            choices: [{ message: { content: '', reasoning_content: 'thinking...' }, finish_reason: 'length' }],
            usage: { completion_tokens_details: { reasoning_tokens: 64 } },
        }));
        const result = await client.runAiConnectionTest(openai(), { customFetch });
        expect(result).toMatchObject({ ok: true, text: '', emptyReason: 'reasoning' });
        expect(calls).toHaveLength(1);
    });

    it('reports a plain empty reply as a success with the generic reason', async () => {
        const { customFetch } = makeFetch(() => json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }));
        const result = await client.runAiConnectionTest(openai(), { customFetch });
        expect(result).toMatchObject({ ok: true, emptyReason: 'empty' });
    });

    it('truncates long replies', async () => {
        const { customFetch } = makeFetch(() => json({ choices: [{ message: { content: 'a'.repeat(2000) } }] }));
        const result = await client.runAiConnectionTest(openai(), { customFetch });
        expect(result.text.length).toBeLessThanOrEqual(501);
        expect(result.text.endsWith('…')).toBe(true);
    });

    it('maps a 401 to a failure carrying the status and provider message', async () => {
        const { customFetch } = makeFetch(() => json({ error: { message: 'Incorrect API key provided' } }, 401));
        const result = await client.runAiConnectionTest(openai(), { customFetch });
        expect(result).toMatchObject({ ok: false, status: 401, errorKind: 'http' });
        expect(result.error).toContain('Incorrect API key provided');
    });

    it('never leaks the key or URL query in error text', async () => {
        const { customFetch } = makeFetch(() => json({ error: { message: 'bad key sk-secret' } }, 401));
        const result = await client.runAiConnectionTest(
            openai({ apiUrl: 'https://relay.example.com/v1?token=abc' }),
            { customFetch },
        );
        expect(JSON.stringify(result)).not.toContain('sk-secret');

        const failing = makeFetch(() => { throw new Error('connect ECONNREFUSED'); });
        const network = await client.runAiConnectionTest(
            openai({ apiUrl: 'https://relay.example.com/v1?token=abc' }),
            { customFetch: failing.customFetch },
        );
        expect(network).toMatchObject({ ok: false, errorKind: 'network' });
        expect(JSON.stringify(network)).not.toContain('token=abc');
    });

    it('reports a timeout', async () => {
        const { customFetch } = makeFetch((call) => new Promise<Response>((_, reject) => {
            call.init.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'TimeoutError';
                reject(error);
            });
        }));
        const result = await client.runAiConnectionTest(openai(), { customFetch, timeoutMs: 20 });
        expect(result).toMatchObject({ ok: false, errorKind: 'timeout' });
        expect(result.error).toContain('timed out');
    });

    it('fails without a request when the key is missing', async () => {
        const { calls, customFetch } = makeFetch(() => json({}));
        const result = await client.runAiConnectionTest(openai({ apiKey: '  ' }), { customFetch });
        expect(calls).toHaveLength(0);
        expect(result).toMatchObject({ ok: false, errorKind: 'config' });
    });
});

describe('runAiConnectionTest (Gemini)', () => {
    it('sends hello with the key in a header, not the URL', async () => {
        const { calls, customFetch } = makeFetch(() => json({
            modelVersion: 'gemini-3-flash-preview',
            candidates: [{ content: { parts: [{ text: 'Hello!' }] }, finishReason: 'STOP' }],
        }));
        const result = await client.runAiConnectionTest({ provider: 'gemini', apiKey: 'g-key' }, { customFetch });
        expect(calls[0].url).not.toContain('g-key');
        expect(calls[0].init.headers['x-goog-api-key']).toBe('g-key');
        expect(calls[0].body.contents).toEqual([{ parts: [{ text: 'hello' }] }]);
        expect(calls[0].body.systemInstruction).toBeUndefined();
        expect(calls[0].body.generationConfig).toEqual({ maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } });
        expect(result).toMatchObject({ ok: true, status: 200, text: 'Hello!', model: 'gemini-3-flash-preview' });
    });

    it('reports HTTP errors and a thinking-exhausted empty reply', async () => {
        const denied = makeFetch(() => new Response('API key not valid', { status: 400, statusText: 'Bad Request' }));
        const failed = await client.runAiConnectionTest({ provider: 'gemini', apiKey: 'g-key' }, { customFetch: denied.customFetch });
        expect(failed).toMatchObject({ ok: false, status: 400, errorKind: 'http' });
        expect(failed.error).toContain('API key not valid');

        const empty = makeFetch(() => json({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }));
        const result = await client.runAiConnectionTest({ provider: 'gemini', apiKey: 'g-key' }, { customFetch: empty.customFetch });
        expect(result).toMatchObject({ ok: true, text: '', emptyReason: 'reasoning' });
    });
});

describe('validateAiConnectionTestInput', () => {
    const bad = (raw: unknown) => client.validateAiConnectionTestInput(raw).error;

    it('rejects non-objects and unknown providers', () => {
        expect(bad(null)).toBeTruthy();
        expect(bad('x')).toBeTruthy();
        expect(bad({ provider: 'anthropic', apiKey: 'k' })).toBeTruthy();
    });

    it('rejects non-http URLs, bad URLs, overlong and non-string fields', () => {
        expect(bad(openai({ apiUrl: 'file:///etc/passwd' }))).toBeTruthy();
        expect(bad(openai({ apiUrl: 'ftp://x.example.com' }))).toBeTruthy();
        expect(bad(openai({ apiUrl: 'not a url' }))).toBeTruthy();
        expect(bad(openai({ apiKey: 'k'.repeat(1025) }))).toBeTruthy();
        expect(bad(openai({ model: 'm'.repeat(257) }))).toBeTruthy();
        expect(bad(openai({ apiKey: 123 }))).toBeTruthy();
    });

    it('accepts and trims valid input; blank URL falls back to the default endpoint', async () => {
        const ok = client.validateAiConnectionTestInput(openai({ apiKey: ' sk ', apiUrl: '', stream: true }));
        expect(ok.config).toMatchObject({ provider: 'openai', apiKey: 'sk', apiUrl: '', stream: true });

        const { calls, customFetch } = makeFetch(() => json({ choices: [{ message: { content: 'hi' } }] }));
        await client.runAiConnectionTest(openai({ apiUrl: '' }), { customFetch });
        expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('returns a failure result instead of calling fetch for invalid input', async () => {
        const { calls, customFetch } = makeFetch(() => json({}));
        const result = await client.runAiConnectionTest({ provider: 'openai', apiKey: 'k', apiUrl: 'file:///x' }, { customFetch });
        expect(calls).toHaveLength(0);
        expect(result).toMatchObject({ ok: false, errorKind: 'invalid' });
    });
});
