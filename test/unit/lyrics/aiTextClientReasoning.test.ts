import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { buildCompatibleBody } from '../../../shared/ai/compatibleBody.mjs';
import { deepseekAdapter } from '../../../shared/ai/deepseek.mjs';
import { getAiAdapter, inferAiProviderFromUrl } from '../../../shared/ai/providerRegistry.mjs';
import { REASONING_SUPPRESSION_ATTEMPTS } from '../../../shared/lyricSegmentationPrompt.mjs';

// test/unit/lyrics/aiTextClientReasoning.test.ts
// Reasoning models were the worst failure in this feature: on Gemini they turned a request into
// 40s, and on DeepSeek they consumed the whole token budget and returned nothing at all after 52s.
//
// The user can point the app at any OpenAI-compatible URL with any model name, so there is no
// provider list to key off. The client instead walks a ladder of ways to ask for no reasoning and
// remembers what worked. These tests pin that walk, including the two conditions that advance it
// and the one that must not.

const client = createRequire(import.meta.url)('../../../electron/aiTextClient.cjs');

type Attempt = { body: Record<string, unknown> };

/** A fake endpoint that records what was asked of it and replies however the test wants. */
const makeFetch = (reply: (body: Record<string, unknown>, attempt: number) => {
    status?: number;
    payload: unknown;
}) => {
    const attempts: Attempt[] = [];
    const fetchImpl = async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        attempts.push({ body });
        const { status = 200, payload } = reply(body, attempts.length - 1);
        return Response.json(payload, { status });
    };
    return { attempts, fetchImpl };
};

const answered = (content: string) => ({
    payload: { choices: [{ finish_reason: 'stop', message: { content } }] },
});

const reasonedItself_dry = (tokens: number) => ({
    payload: {
        choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking' } }],
        usage: { completion_tokens_details: { reasoning_tokens: tokens } },
    },
});

const rejected = (param: string) => ({
    status: 400,
    payload: { error: { message: `Unsupported parameter: '${param}' is not supported with this model.` } },
});

const run = (fetchImpl: unknown, url = 'http://endpoint.test/v1') => client.runAiJsonCompletion({
    store: { get: (k: string) => ({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: url }[k]) },
    systemPrompt: 'sys',
    sourcePrompt: 'src',
    customFetch: fetchImpl,
    task: 'segmentation',
    answerTokens: 4096,
});

describe('reasoning suppression ladder', () => {
    it('tries to switch reasoning off before anything else', async () => {
        const { attempts, fetchImpl } = makeFetch(() => answered('{}'));
        await run(fetchImpl, 'http://a.test/v1');

        expect(attempts).toHaveLength(1);
        expect(attempts[0].body).toMatchObject(REASONING_SUPPRESSION_ATTEMPTS[0].params);
    });

    it('walks down when the endpoint rejects the parameter, and still succeeds', async () => {
        const { attempts, fetchImpl } = makeFetch((body) => {
            if (body.reasoning_effort !== undefined) return rejected('reasoning_effort');
            if (body.chat_template_kwargs !== undefined) return rejected('chat_template_kwargs');
            return answered('{"ok":1}');
        });

        await expect(run(fetchImpl, 'http://b.test/v1')).resolves.toBe('{"ok":1}');
        expect(attempts).toHaveLength(REASONING_SUPPRESSION_ATTEMPTS.length);
        expect(attempts[attempts.length - 1].body.reasoning_effort).toBeUndefined();
    });

    it('walks down when only the raw error body names the parameter', async () => {
        // The message says nothing; error.param is the only evidence, and it is lost once the error
        // is formatted for display.
        const { attempts, fetchImpl } = makeFetch((body) => (
            body.reasoning_effort !== undefined
                ? { status: 400, payload: { error: { message: 'Bad request', param: 'reasoning_effort', code: 'invalid_value' } } }
                : answered('{"ok":1}')
        ));

        await expect(run(fetchImpl, 'http://b2.test/v1')).resolves.toBe('{"ok":1}');
        expect(attempts).toHaveLength(2);
        expect(attempts[1].body.reasoning_effort).toBeUndefined();
    });

    it('walks down when the parameter is accepted but the model reasons anyway', async () => {
        const { attempts, fetchImpl } = makeFetch((body, attempt) => (
            attempt < 2 ? reasonedItself_dry(Number(body.max_tokens)) : answered('{"ok":1}')
        ));

        await expect(run(fetchImpl, 'http://c.test/v1')).resolves.toBe('{"ok":1}');
        expect(attempts).toHaveLength(3);
    });

    it('gives the last attempt room for reasoning and an answer', async () => {
        const { attempts, fetchImpl } = makeFetch((body, attempt) => (
            attempt < 2 ? reasonedItself_dry(Number(body.max_tokens)) : answered('{}')
        ));
        await run(fetchImpl, 'http://d.test/v1');

        expect(attempts[0].body.max_tokens).toBe(4096);
        expect(attempts[2].body.max_tokens).toBeGreaterThan(4096);
    });

    it('remembers what worked, so later calls do not re-probe', async () => {
        const { attempts, fetchImpl } = makeFetch((body) => (
            body.reasoning_effort !== undefined ? rejected('reasoning_effort') : answered('{}')
        ));
        const url = 'http://e.test/v1';

        await run(fetchImpl, url);
        const afterFirst = attempts.length;
        expect(afterFirst).toBeGreaterThan(1);

        await run(fetchImpl, url);
        expect(attempts.length - afterFirst).toBe(1);
    });

    it('does not walk the ladder for a real error, which would triple the failure', async () => {
        const { attempts, fetchImpl } = makeFetch(() => ({
            status: 401,
            payload: { error: { message: 'Incorrect API key provided' } },
        }));

        await expect(run(fetchImpl, 'http://f.test/v1')).rejects.toThrow('Incorrect API key');
        expect(attempts).toHaveLength(1);
    });

    it('sends nothing extra for the theme to an unknown endpoint, which does not ask to disable reasoning', async () => {
        const { attempts, fetchImpl } = makeFetch(() => answered('{}'));
        await client.runAiJsonCompletion({
            store: { get: (k: string) => ({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: 'https://theme.example.test/v1' }[k]) },
            task: 'theme', systemPrompt: 'sys', sourcePrompt: 'src', customFetch: fetchImpl, answerTokens: 4096,
        });

        expect(attempts).toHaveLength(1);
        expect(attempts[0].body.thinking).toBeUndefined();
        expect(attempts[0].body.reasoning_effort).toBeUndefined();
        expect(attempts[0].body.chat_template_kwargs).toBeUndefined();
    });
});

describe('empty completion diagnostics', () => {
    it('names reasoning exhaustion rather than reporting a bare empty response', async () => {
        const { fetchImpl } = makeFetch((body) => reasonedItself_dry(Number(body.max_tokens)));
        await expect(run(fetchImpl, 'http://h.test/v1')).rejects.toThrow(/reasoning tokens.*non-reasoning model/s);
    });

    it('falls back to the finish reason when reasoning does not explain it', () => {
        expect(client.describeEmptyCompletion({ finish_reason: 'content_filter', message: {} }, {}, 'm'))
            .toContain('content_filter');
    });
});

describe('request body', () => {
    it('keeps the rest of the body intact alongside the suppression parameters', () => {
        const body = buildCompatibleBody(deepseekAdapter, {
            task: 'segmentation', model: 'm', attempt: deepseekAdapter.attempts('segmentation', 'm')[0],
            systemPrompt: 'sys', sourcePrompt: 'user', temperature: 0.7, schema: { type: 'object' }, schemaName: 'name', budget: 4096,
        });
        expect(body).toMatchObject({
            model: 'm',
            max_tokens: 4096,
            reasoning_effort: 'none',
            response_format: { type: 'json_object' },
        });
        expect(body.messages).toHaveLength(2);
    });

    it('uses the official OpenAI token field only for the official hostname', async () => {
        const ask = (url: string) => {
            const adapter = getAiAdapter(inferAiProviderFromUrl(url));
            if (!adapter) throw new Error('no adapter for ' + url);
            return buildCompatibleBody(adapter, {
                task: 'theme', model: 'gpt-5-mini', attempt: adapter.attempts('segmentation', 'gpt-5-mini')[2],
                systemPrompt: 'sys', sourcePrompt: 'user', temperature: 0.7, budget: 4096,
            }) as Record<string, unknown>;
        };
        const official = ask('https://api.openai.com/v1');
        const compatible = ask('https://relay.example.com/v1');

        expect(official.max_completion_tokens).toBe(4096);
        expect(official.max_tokens).toBeUndefined();
        expect(compatible.max_tokens).toBe(4096);
        expect(compatible.max_completion_tokens).toBeUndefined();
    });
});
