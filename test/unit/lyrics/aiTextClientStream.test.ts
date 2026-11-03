import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildCompatibleBody } from '../../../shared/ai/compatibleBody.mjs';
import { customAdapter } from '../../../shared/ai/custom.mjs';

// test/unit/lyrics/aiTextClientStream.test.ts
// Some OpenAI-compatible relays only accept `stream: true`. The answer is still structured JSON, so
// the client reads the SSE stream to the end and hands the assembled text to the same path as a
// non-streamed reply. These tests pin the SSE stitching and the request-level behaviour.

const client = createRequire(import.meta.url)('../../../electron/aiTextClient.cjs');

const delta = (content: string, extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content, ...extra } }] })}\n\n`;
const finish = (reason: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;

/** Feeds chunks to a fresh accumulator and returns what it produced. */
const accumulate = (chunks: string[]) => {
    const acc = client.createOpenAIStreamAccumulator();
    chunks.forEach((chunk) => acc.push(chunk));
    return acc.finish();
};

describe('createOpenAIStreamAccumulator', () => {
    it('joins content across several events and stops at [DONE]', () => {
        const result = accumulate([delta('{"a":'), delta('1}'), finish('stop'), 'data: [DONE]\n\n']);
        expect(result.content).toBe('{"a":1}');
        expect(result.choice.finish_reason).toBe('stop');
        expect(result.done).toBe(true);
    });

    it('ignores data frames that arrive after [DONE]', () => {
        const result = accumulate([delta('{"a":1}'), 'data: [DONE]\n\n', delta('junk'), 'data: {"error":"late"}\n\n']);
        expect(result.content).toBe('{"a":1}');
        expect(result.done).toBe(true);
    });

    it('survives a line split across chunks at any byte', () => {
        const whole = delta('{"k":"v"}') + finish('stop') + 'data: [DONE]\n\n';
        for (let cut = 1; cut < whole.length; cut += 7) {
            const result = accumulate([whole.slice(0, cut), whole.slice(cut)]);
            expect(result.content).toBe('{"k":"v"}');
            expect(result.done).toBe(true);
        }
    });

    it('accepts CRLF, bare CR, blank lines and a missing space after the colon', () => {
        const raw = [
            `data:${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}`,
            '',
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'b' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'c' }, finish_reason: 'stop' }] })}`,
            'data: [DONE]',
            '',
        ];
        expect(accumulate([raw.join('\r\n')]).content).toBe('abc');
        expect(accumulate([raw.join('\r')]).content).toBe('abc');
        // CRLF split between the \r and the \n must not lose or duplicate anything.
        const crlf = raw.join('\r\n');
        const cut = crlf.indexOf('\r\n') + 1;
        expect(accumulate([crlf.slice(0, cut), crlf.slice(cut)]).content).toBe('abc');
    });

    it('ignores keep-alive comments and other SSE fields', () => {
        const result = accumulate([
            ': keep-alive\n\n',
            'event: message\nid: 7\nretry: 100\n',
            delta('{}'),
            ':ping\n',
            finish('stop'),
        ]);
        expect(result.content).toBe('{}');
    });

    it('processes a final line that has no trailing newline', () => {
        const result = accumulate([`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}`]);
        expect(result.content).toBe('x');
        expect(result.done).toBe(false);
    });

    it('ignores empty choices arrays and malformed data lines', () => {
        const result = accumulate([
            'data: {"choices":[]}\n\n',
            'data: {not json\n\n',
            delta('ok'),
        ]);
        expect(result.content).toBe('ok');
    });

    it('throws on an error event in the middle of the stream', () => {
        const acc = client.createOpenAIStreamAccumulator();
        acc.push(delta('partial'));
        expect(() => acc.push(`data: ${JSON.stringify({ error: { message: 'upstream overloaded' } })}\n\n`))
            .toThrow(/upstream overloaded/);
    });

    it('throws on an error event delivered without a trailing newline', () => {
        const acc = client.createOpenAIStreamAccumulator();
        acc.push(`data: ${JSON.stringify({ error: 'quota exceeded' })}`);
        expect(() => acc.finish()).toThrow(/quota exceeded/);
    });

    it('never mixes reasoning_content into the answer', () => {
        const result = accumulate([
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' } }] })}\n\n`,
            delta('{"a":1}'),
            finish('stop'),
        ]);
        expect(result.content).toBe('{"a":1}');
    });

    it('reports reasoning-only output as an empty completion that exhausted the budget', () => {
        const result = accumulate([
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking' } }] })}\n\n`,
            finish('length'),
            'data: [DONE]\n\n',
        ]);
        expect(result.content).toBe('');
        expect(result.choice.finish_reason).toBe('length');
        expect(client.describeEmptyCompletion(result.choice, result.usage, 'm')).toMatch(/reasoning.*non-reasoning model/s);
    });

    it('keeps truncated content with finish_reason=length, like the non-streamed path', () => {
        const result = accumulate([delta('{"a":'), finish('length')]);
        expect(result.content).toBe('{"a":');
        expect(result.choice.finish_reason).toBe('length');
    });

    it('surfaces a streamed refusal', () => {
        const acc = client.createOpenAIStreamAccumulator();
        acc.push(`data: ${JSON.stringify({ choices: [{ delta: { refusal: 'cannot help' } }] })}\n\n`);
        expect(() => acc.finish()).toThrow(/refused.*cannot help/);
    });

    it('understands a relay that ignored stream:true and sent one plain JSON body', () => {
        const body = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"z":1}' } }] });
        expect(accumulate([body.slice(0, 10), body.slice(10)]).content).toBe('{"z":1}');
        expect(() => accumulate([JSON.stringify({ error: { message: 'bad key' } })])).toThrow(/bad key/);
    });
});

describe('streamed requests', () => {
    const sseResponse = (chunks: string[], status = 200) => {
        const encoder = new TextEncoder();
        const body = new ReadableStream({
            start(controller) {
                chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                controller.close();
            },
        });
        return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const run = (fetchImpl: unknown, url: string, stream: boolean | undefined) => client.runAiJsonCompletion({
        store: {
            get: (k: string) => ({
                AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_API_URL: url, OPENAI_API_STREAM: stream,
            } as Record<string, unknown>)[k],
        },
        systemPrompt: 'sys',
        sourcePrompt: 'src',
        customFetch: fetchImpl,
        task: 'theme',
        answerTokens: 1024,
    });

    it('adds stream:true only when the setting is on, and nothing else stream-related', () => {
        const body = (stream?: boolean) => buildCompatibleBody(customAdapter, {
            task: 'theme', model: 'm', attempt: customAdapter.attempts('theme', 'm')[0],
            systemPrompt: 's', sourcePrompt: 'u', temperature: 0.7, budget: 100, stream,
        }) as Record<string, unknown>;
        const on = body(true);
        const off = body(false);
        const unset = body();
        expect(on.stream).toBe(true);
        expect(on.stream_options).toBeUndefined();
        expect('stream' in off).toBe(false);
        expect('stream' in unset).toBe(false);
    });

    it('sends stream:true and returns the assembled text from a chunked body', async () => {
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl = async (_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            const full = delta('{"a":') + delta('1}') + finish('stop') + 'data: [DONE]\n\n';
            return sseResponse([full.slice(0, 13), full.slice(13, 40), full.slice(40)]);
        };

        await expect(run(fetchImpl, 'http://s1.test/v1', true)).resolves.toBe('{"a":1}');
        expect(bodies[0].stream).toBe(true);
    });

    it('keeps the default request non-streamed', async () => {
        const bodies: Record<string, unknown>[] = [];
        const fetchImpl = async (_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body));
            return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });
        };

        await expect(run(fetchImpl, 'http://s2.test/v1', undefined)).resolves.toBe('{}');
        expect('stream' in bodies[0]).toBe(false);
    });

    it('still reads the error body on a non-2xx streamed request', async () => {
        const fetchImpl = async () => Response.json({ error: { message: 'Incorrect API key' } }, { status: 401 });
        await expect(run(fetchImpl, 'http://s3.test/v1', true)).rejects.toThrow(/401.*Incorrect API key/);
    });

    it('reports an empty streamed completion with the usual diagnosis', async () => {
        const fetchImpl = async () => sseResponse([finish('length'), 'data: [DONE]\n\n']);
        await expect(run(fetchImpl, 'http://s4.test/v1', true)).rejects.toThrow(/output token limit/);
    });

    it('fails with the provider message when the stream carries an error event', async () => {
        const fetchImpl = async () => sseResponse([delta('{'), `data: ${JSON.stringify({ error: { message: 'relay down' } })}\n\n`]);
        await expect(run(fetchImpl, 'http://s5.test/v1', true)).rejects.toThrow(/relay down/);
    });
});
