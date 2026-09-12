import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { REASONING_SUPPRESSION_ATTEMPTS } from '../../../shared/lyricSegmentationPrompt.mjs';

// test/unit/lyrics/aiTextClientReasoning.test.ts
// Reasoning models were the worst failure in this feature: on Gemini they turned a request into
// 40s, and on DeepSeek they consumed the whole token budget and returned nothing at all after 52s.
//
// Requests use endpoint capabilities; empty output and rate limits must not cause paid retries.
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
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: 'x',
            json: async () => payload,
            text: async () => JSON.stringify(payload),
        };
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
    maxTokens: 4096,
    disableReasoning: true,
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

    it('sends nothing extra when the caller has not asked to disable reasoning', async () => {
        const { attempts, fetchImpl } = makeFetch(() => answered('{}'));
        await client.runAiJsonCompletion({
            store: { get: (k: string) => ({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: 'http://g.test/v1' }[k]) },
            systemPrompt: 'sys', sourcePrompt: 'src', customFetch: fetchImpl, maxTokens: 4096,
        });

        expect(attempts).toHaveLength(1);
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
        const body = client.buildOpenAICompatibleRequestBody(
            'm', 'deepseek', 'sys', 'user', 0.7, { type: 'object' }, 'name', 4096, { reasoning_effort: 'none' },
        );
        expect(body).toMatchObject({
            model: 'm',
            max_tokens: 4096,
            reasoning_effort: 'none',
            response_format: { type: 'json_object' },
        });
        expect(body.messages).toHaveLength(2);
    });
});

describe('OpenAI-compatible provider detection', () => {
    it('treats GPT models on custom domains as generic', () => {
        expect(client.detectOpenAICompatibleProvider('https://example.test/v1', 'gpt-5.6-luna'))
            .toBe('generic');
    });

    it('treats api.openai.com and its subdomains as OpenAI', () => {
        expect(client.detectOpenAICompatibleProvider('https://api.openai.com/v1', 'custom-model')).toBe('openai');
        expect(client.detectOpenAICompatibleProvider('https://edge.api.openai.com/v1', 'custom-model')).toBe('openai');
    });
});

describe('AI JSON response parsing', () => {
    it.each([
        ['pure JSON', '{"ok":true}'],
        ['fenced JSON', '```json\n{"ok":true}\n```'],
        ['prose-wrapped JSON', 'Here is the result:\n{"ok":true}\nDone.'],
    ])('parses %s', (_label, input) => {
        expect(client.parseAiJsonObject(input)).toEqual({ ok: true });
    });

    it('fails clearly when no valid JSON object exists', () => {
        expect(() => client.parseAiJsonObject('No JSON was returned.'))
            .toThrow('AI response did not contain a valid JSON object');
    });

    it('does not accept a syntactically valid object missing required fields', () => {
        expect(() => client.parseAiJsonObject('{"ok":true}', ['light', 'dark']))
            .toThrow('required keys: light, dark');
    });
});

describe('generic JSON mode compatibility', () => {
    it('does not classify empty success as a capability failure', async () => {
        const { attempts, fetchImpl } = makeFetch(() => answered(''));
        await expect(run(fetchImpl, 'https://empty.example.test/v1')).rejects.toThrow('empty response');
        expect(attempts).toHaveLength(1);
    });

    it.each([429, 400])('does not retry concurrency errors (%s)', async (status) => {
        const { attempts, fetchImpl } = makeFetch(() => ({ status,
            payload: { error: { message: 'Concurrency limit exceeded for user' } },
        }));
        await expect(run(fetchImpl, 'https://concurrency.example.test/v1')).rejects.toThrow('Concurrency');
        expect(attempts).toHaveLength(1);
    });

    it('retries explicit response_format rejection and remembers it', async () => {
        const { attempts, fetchImpl } = makeFetch(body => body.response_format
            ? rejected('response_format') : answered('{}'));
        await run(fetchImpl, 'https://cache.example.test/v1');
        await run(fetchImpl, 'https://cache.example.test/v1');
        expect(attempts).toHaveLength(3);
        expect(attempts[1].body.response_format).toBeUndefined();
        expect(attempts[2].body.response_format).toBeUndefined();
    });
});
