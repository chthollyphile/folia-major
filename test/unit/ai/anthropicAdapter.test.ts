import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { structuredOutputSchema } from '../../../shared/ai/anthropic.mjs';
import { modelAlwaysThinks, retiredModelHint } from '../../../shared/ai/providerRegistry.mjs';
import { SEGMENTATION_JSON_SCHEMA } from '../../../shared/lyricSegmentationPrompt.mjs';
import { answered, exhaustedReply, firstBody, rejectedWith, requestsFor, simulate, type AiTask } from './adapterHarness';

// test/unit/ai/anthropicAdapter.test.ts
// What the Anthropic adapter asks of each Claude model (thinking, effort, the cap, the schema as
// output_config.format), which rejections move to the next attempt, and how the desktop sender reads
// stop_reason, refusals and errors. No request leaves the test.

const require = createRequire(import.meta.url);
const client = require('../../../electron/aiTextClient.cjs');

const DISABLED = { type: 'disabled' };
const BETWEEN_TOOLS = { type: 'between_tools' };

// Budgets: answer only when thinking is off; answer + REASONING_ALLOWANCE otherwise.
const CAP = {
    segmentation: { off: 8192, on: 8192 + 24576 },
    theme: { off: 8192, on: 8192 + 16384 },
    test: { off: 512, on: 512 + 3584 },
};

type Shape = [thinking: unknown, effort: string | undefined, cap: number];
const shapesOf = (task: AiTask, model: string): Shape[] => requestsFor('anthropic', task, model).map(({ body }) => [
    body.thinking,
    body.output_config?.effort,
    body.max_tokens,
]);

describe('requests per model', () => {
    it.each([
        // Thinking off at low effort; the theme keeps thinking at low effort.
        ['claude-haiku-5-5', 'segmentation', [[DISABLED, 'low', CAP.segmentation.off]]],
        ['claude-haiku-5-5', 'test', [[DISABLED, 'low', CAP.test.off]]],
        ['claude-haiku-5-5', 'theme', [[undefined, 'low', CAP.theme.on]]],
        ['claude-opus-5', 'segmentation', [[DISABLED, 'low', CAP.segmentation.off]]],
        ['claude-sonnet-5', 'test', [[DISABLED, 'low', CAP.test.off]]],
        // sonnet-5-5 rejects 'disabled': between_tools, budgeted as thinking.
        ['claude-sonnet-5-5', 'segmentation', [[BETWEEN_TOOLS, 'low', CAP.segmentation.on]]],
        ['claude-sonnet-5-5', 'test', [[BETWEEN_TOOLS, 'low', CAP.test.on]]],
        ['claude-sonnet-5-5', 'theme', [[undefined, 'low', CAP.theme.on]]],
        // Thinking always on: effort only.
        ['claude-opus-5-5', 'segmentation', [[undefined, 'low', CAP.segmentation.on]]],
        ['claude-opus-5-5', 'test', [[undefined, 'low', CAP.test.on]]],
        ['claude-opus-5-5', 'theme', [[undefined, 'low', CAP.theme.on]]],
        ['claude-fable-5-1', 'segmentation', [[undefined, 'low', CAP.segmentation.on]]],
        ['claude-fable-5', 'test', [[undefined, 'low', CAP.test.on]]],
        ['claude-mythos-5-1', 'theme', [[undefined, 'low', CAP.theme.on]]],
        ['claude-mythos-5', 'segmentation', [[undefined, 'low', CAP.segmentation.on]]],
        // No thinking unless asked for: nothing sent, answer budget only.
        ['claude-opus-4-8', 'segmentation', [[undefined, undefined, CAP.segmentation.off]]],
        ['claude-opus-4-7', 'theme', [[undefined, undefined, CAP.theme.off]]],
        ['claude-sonnet-4-6', 'test', [[undefined, undefined, CAP.test.off]]],
        ['claude-haiku-4-5-20251001', 'segmentation', [[undefined, undefined, CAP.segmentation.off]]],
        ['claude-sonnet-4-5', 'theme', [[undefined, undefined, CAP.theme.off]]],
        ['claude-opus-4-5@20251101', 'segmentation', [[undefined, undefined, CAP.segmentation.off]]],
        // The retired 4.0 and 4.1 models take no effort either: nothing sent, no fallback to pay for.
        ['claude-opus-4-1-20250805', 'segmentation', [[undefined, undefined, CAP.segmentation.off]]],
        ['claude-opus-4-0', 'test', [[undefined, undefined, CAP.test.off]]],
        ['claude-sonnet-4-0', 'theme', [[undefined, undefined, CAP.theme.off]]],
        ['claude-opus-4-20250514', 'segmentation', [[undefined, undefined, CAP.segmentation.off]]],
        ['claude-sonnet-4-20250514', 'test', [[undefined, undefined, CAP.test.off]]],
        // Anything else: off, then low effort, then nothing.
        ['claude-nova-6', 'segmentation', [[DISABLED, 'low', CAP.segmentation.off], [undefined, 'low', CAP.segmentation.on], [undefined, undefined, CAP.segmentation.on]]],
        ['claude-nova-6', 'test', [[DISABLED, 'low', CAP.test.off], [undefined, 'low', CAP.test.on], [undefined, undefined, CAP.test.on]]],
        ['claude-nova-6', 'theme', [[undefined, 'low', CAP.theme.on], [undefined, undefined, CAP.theme.on]]],
        // Matched case-insensitively; a newer minor version is not mistaken for its family.
        ['Claude-Haiku-5-5', 'segmentation', [[DISABLED, 'low', CAP.segmentation.off]]],
        ['claude-opus-5-6', 'theme', [[undefined, 'low', CAP.theme.on], [undefined, undefined, CAP.theme.on]]],
    ] as [string, AiTask, Shape[]][])('%s %s', (model, task, expected) => {
        expect(shapesOf(task, model)).toEqual(expected);
    });

    const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-4-8', 'claude-nova-6'];
    const TASKS: AiTask[] = ['segmentation', 'theme', 'test'];

    it.each(MODELS)('%s: never a temperature, a forced tool or a stream, whatever the setting', model => {
        for (const task of TASKS) {
            for (const { body } of requestsFor('anthropic', task, model, { temperature: 0.7, stream: true })) {
                expect('temperature' in body).toBe(false);
                expect(body.tools).toBeUndefined();
                expect(body.tool_choice).toBeUndefined();
                expect(body.stream).toBeUndefined();
            }
        }
    });

    it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-1', 'claude-mythos-5'])(
        '%s is never sent thinking disabled, and between_tools travels alone',
        model => {
            for (const task of TASKS) {
                for (const { body } of requestsFor('anthropic', task, model)) {
                    expect(body.thinking?.type).not.toBe('disabled');
                    if (body.thinking) expect(body.thinking).toEqual(BETWEEN_TOOLS);
                }
            }
        },
    );

    it('asks for the schema as output_config.format next to the effort; the test sends neither system prompt nor format', () => {
        expect(firstBody('anthropic', 'segmentation', 'claude-haiku-5-5')).toEqual({
            model: 'claude-haiku-5-5',
            max_tokens: 8192,
            system: 'segmentation system prompt',
            messages: [{ role: 'user', content: 'la la la' }],
            thinking: DISABLED,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: SEGMENTATION_JSON_SCHEMA } },
        });
        expect(firstBody('anthropic', 'test', 'claude-opus-4-8')).toEqual({
            model: 'claude-opus-4-8',
            max_tokens: 512,
            messages: [{ role: 'user', content: 'hello' }],
        });
        expect(firstBody('anthropic', 'test', 'claude-opus-5-5').output_config).toEqual({ effort: 'low' });
    });
});

describe('the schema structured outputs receive', () => {
    it('keeps only what structured outputs support, at schema positions only, and closes objects whose properties are listed', () => {
        const schema = {
            type: 'object',
            properties: {
                minimum: { type: 'integer', minimum: 0, maximum: 9, multipleOf: 3 },
                name: { type: 'string', minLength: 1, maxLength: 10, pattern: '^[a-z]+$', format: 'email', title: 'Name', default: 'a' },
                tags: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'object', properties: { word: { type: 'string' } } } },
                either: { anyOf: [{ type: 'object', properties: {}, additionalProperties: false }, { type: 'null' }] },
                kind: { enum: ['a', 'b', null], description: 'plain values' },
            },
            required: ['minimum'],
            $defs: { color: { type: 'object', minProperties: 1, properties: { hex: { type: 'string' } } } },
        };
        const before = JSON.stringify(schema);

        expect(structuredOutputSchema(schema)).toEqual({
            type: 'object',
            additionalProperties: false,
            properties: {
                minimum: { type: 'integer' },
                name: { type: 'string', pattern: '^[a-z]+$', format: 'email', title: 'Name', default: 'a' },
                tags: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: { word: { type: 'string' } } } },
                either: { anyOf: [{ type: 'object', properties: {}, additionalProperties: false }, { type: 'null' }] },
                kind: { enum: ['a', 'b', null], description: 'plain values' },
            },
            required: ['minimum'],
            $defs: { color: { type: 'object', additionalProperties: false, properties: { hex: { type: 'string' } } } },
        });
        expect(JSON.stringify(schema)).toBe(before);
    });

    it('drops every other keyword, nested ones included, and reads oneOf as anyOf', () => {
        const string = { type: 'string' };
        expect(structuredOutputSchema({
            type: 'object',
            additionalProperties: false,
            properties: {
                tuple: { type: 'array', prefixItems: [string], items: string, minItems: 2, contains: string },
                notX: { type: 'string', not: { const: 'x' } },
                conditional: { type: 'string', if: { minLength: 1 }, then: { minLength: 2 }, else: {} },
                lookahead: { type: 'string', format: 'regex', pattern: '^(?=a)b' },
                boundary: { type: 'string', pattern: String.raw`\bword\b` },
                choice: { oneOf: [string, { type: 'null' }] },
                complexEnum: { enum: ['a', { b: 1 }] },
                positional: { type: 'array', items: [string, string] },
            },
            patternProperties: { '^x': string },
            propertyNames: { pattern: '^x' },
            dependentRequired: { tuple: ['notX'] },
            unevaluatedProperties: false,
        })).toEqual({
            type: 'object',
            additionalProperties: false,
            properties: {
                tuple: { type: 'array', items: string },
                notX: string,
                conditional: string,
                lookahead: string,
                boundary: string,
                choice: { anyOf: [string, { type: 'null' }] },
                complexEnum: {},
                positional: { type: 'array' },
            },
        });
    });

    it('follows local $refs into the definitions', () => {
        const schema = {
            type: 'object',
            properties: { a: { $ref: '#/$defs/leaf' }, b: { $ref: '#/definitions/other' }, c: { $ref: '#/$defs/leaf' } },
            $defs: { leaf: { type: 'object', properties: { x: { type: 'string', maxLength: 3 } } } },
            definitions: { other: { type: 'string' } },
        };
        expect(structuredOutputSchema(schema)).toEqual({
            type: 'object',
            additionalProperties: false,
            properties: { a: { $ref: '#/$defs/leaf' }, b: { $ref: '#/definitions/other' }, c: { $ref: '#/$defs/leaf' } },
            $defs: { leaf: { type: 'object', additionalProperties: false, properties: { x: { type: 'string' } } } },
            definitions: { other: { type: 'string' } },
        });
    });

    it.each([
        ['a map of strings', { type: 'object', properties: { map: { type: 'object', additionalProperties: { type: 'string' } } } }, '#/properties/map'],
        ['an explicitly open object', { type: 'object', properties: { open: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true } } }, '#/properties/open'],
        ['an object with no properties listed', { type: 'object', properties: { any: { type: 'object' } } }, '#/properties/any'],
        ['a $ref to the root', { type: 'object', properties: { self: { $ref: '#' } } }, 'recursive'],
        ['a definition that refers to itself', {
            type: 'object', properties: { tree: { $ref: '#/$defs/node' } },
            $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } },
        }, 'recursive'],
        ['two definitions that refer to each other', {
            type: 'object', properties: { a: { $ref: '#/$defs/a' } },
            $defs: { a: { type: 'object', properties: { b: { $ref: '#/$defs/b' } } }, b: { type: 'object', properties: { a: { $ref: '#/$defs/a' } } } },
        }, 'recursive'],
        ['another document', { type: 'object', properties: { x: { $ref: 'https://example.test/schema.json' } } }, 'https://example.test/schema.json'],
        ['a missing definition', { type: 'object', properties: { x: { $ref: '#/$defs/missing' } } }, 'unresolved'],
        ['allOf with a $ref', { type: 'object', properties: { x: { allOf: [{ $ref: '#/$defs/s' }] } }, $defs: { s: { type: 'string' } } }, 'allOf'],
    ])('refuses %s instead of changing what it means', (_name, schema, mentions) => {
        expect(() => structuredOutputSchema(schema)).toThrow(mentions);
    });

    it('leaves a schema that already fits unchanged', () => {
        expect(structuredOutputSchema(SEGMENTATION_JSON_SCHEMA)).toEqual(SEGMENTATION_JSON_SCHEMA);
    });
});

describe('moving to the next attempt', () => {
    const invalid = (message: string) => rejectedWith(400, { type: 'error', error: { type: 'invalid_request_error', message } });

    it('moves on when thinking, then effort, is rejected by name', async () => {
        const { bodies, outcome } = await simulate('anthropic', 'segmentation', 'claude-nova-6', (_body, index) => (
            index === 0 ? invalid('"thinking.type.disabled" is not supported for this model.')
                : index === 1 ? invalid('This model does not support the effort parameter.')
                    : answered('{"lines":[]}')
        ));
        expect(bodies.map(body => [body.thinking, body.output_config?.effort])).toEqual([[DISABLED, 'low'], [undefined, 'low'], [undefined, undefined]]);
        expect(outcome).toMatchObject({ index: 2, result: { content: '{"lines":[]}' } });
    });

    it('moves on when output_config itself is unknown to the endpoint', async () => {
        const { bodies } = await simulate('anthropic', 'test', 'claude-nova-6', (_body, index) => (
            index < 2 ? invalid('output_config: Extra inputs are not permitted') : answered('Hi')
        ));
        expect(bodies).toHaveLength(3);
    });

    it('moves on when thinking used up the budget', async () => {
        const { bodies } = await simulate('anthropic', 'theme', 'claude-nova-6', (_body, index) => (
            index === 0 ? exhaustedReply() : answered('{}')
        ));
        expect(bodies).toHaveLength(2);
    });

    it.each([
        ['a format the model rejects', invalid('output_config.format.schema: For \'object\' type, \'additionalProperties\' must be explicitly set to false')],
        ['a 400 about something else', invalid('messages: text content blocks must be non-empty')],
        ['a 401', rejectedWith(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })],
        ['a 404 for the model', rejectedWith(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-nova-6' } })],
        ['a 429 that mentions thinking', rejectedWith(429, { type: 'error', error: { type: 'rate_limit_error', message: 'thinking tokens rate limit' } })],
    ])('stops at %s', async (_name, reply) => {
        const { bodies, outcome } = await simulate('anthropic', 'segmentation', 'claude-nova-6', () => reply);
        expect(bodies).toHaveLength(1);
        expect(outcome).toMatchObject({ index: 0, result: { ok: false } });
    });
});

describe('settings hints', () => {
    it.each(['claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-latest', 'claude-opus-4-1-20250805', 'claude-opus-4-0', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929'])(
        'calls %s retired',
        model => {
            expect(retiredModelHint('anthropic', model)).toEqual({ model, replacement: 'claude-haiku-5-5' });
        },
    );

    it.each(['claude-haiku-5-5', 'claude-opus-4-5', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'])('does not call %s retired', model => {
        expect(retiredModelHint('anthropic', model)).toBeNull();
    });

    it.each([
        ['claude-opus-5-5', true],
        ['claude-fable-5-1', true],
        ['claude-mythos-5', true],
        ['claude-haiku-5-5', false],
        ['claude-sonnet-5-5', false],
        ['claude-opus-4-8', false],
        ['claude-nova-6', false],
    ] as const)('%s always thinks: %s', (model, thinks) => {
        expect(modelAlwaysThinks('anthropic', model)).toBe(thinks);
    });
});

describe('the desktop sender', () => {
    const KEY = 'sk-ant-test-secret';
    const store = (model: string) => ({
        get: (key: string) => ({
            AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: KEY, OPENAI_API_MODEL: model,
        } as Record<string, unknown>)[key],
    });
    const record = (answer: (index: number) => Response) => {
        const bodies: any[] = [];
        const customFetch = async (_url: string, init: any) => {
            bodies.push(JSON.parse(init.body));
            return answer(bodies.length - 1);
        };
        return { bodies, customFetch };
    };
    const ask = (model: string, customFetch: unknown) => client.runAiJsonCompletion({
        store: store(model), task: 'segmentation', systemPrompt: 'system', sourcePrompt: 'source',
        schema: SEGMENTATION_JSON_SCHEMA, schemaName: 'lyric_word_segmentation', answerTokens: 8192, customFetch,
    });
    const reply = (value: unknown, status = 200) => () => Response.json(value, { status });
    const test = (model: string, customFetch: unknown, timeoutMs?: number) => client.runAiConnectionTest(
        { provider: 'openai', apiKey: KEY, apiUrl: 'https://api.anthropic.com/v1', model },
        { customFetch, ...(timeoutMs ? { timeoutMs } : {}) },
    );

    let printed: string[] = [];
    beforeEach(() => {
        printed = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(' ')); });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        expect(printed.filter(line => line.includes(KEY))).toEqual([]);
    });

    it('skips thinking blocks and returns the text', async () => {
        const { customFetch } = record(reply({
            stop_reason: 'end_turn',
            content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '{"lines":[]}' }],
        }));
        expect(await ask('claude-opus-5-5', customFetch)).toBe('{"lines":[]}');
        expect(printed.map(line => line.replace(/\d+ms/, 'Nms'))).toEqual([
            '[ai] POST https://api.anthropic.com/v1/messages model=claude-opus-5-5 provider=anthropic reasoning=effort=low',
            '[ai] https://api.anthropic.com/v1/messages answered in Nms stop_reason=end_turn',
        ]);
    });

    it('fails on a refusal with its category and explanation, without retrying', async () => {
        const { bodies, customFetch } = record(reply({
            stop_reason: 'refusal',
            stop_details: { type: 'refusal', category: 'cyber', explanation: 'Declined by a safety classifier.' },
            content: [{ type: 'text', text: '{"li' }],
        }));
        await expect(ask('claude-nova-6', customFetch)).rejects.toThrow('Model refused request (cyber): Declined by a safety classifier.');
        expect(bodies).toHaveLength(1);
    });

    it('does not hand on a cut-off answer: says thinking used the budget, or that the cap was reached', async () => {
        const thinkingCut = reply({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"lines":[["la' }] });
        await expect(ask('claude-opus-5-5', record(thinkingCut).customFetch))
            .rejects.toThrow('Model "claude-opus-5-5" used its entire output budget on thinking');
        const cut = reply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"lines":[["la' }] });
        await expect(ask('claude-opus-4-8', record(cut).customFetch))
            .rejects.toThrow('Model "claude-opus-4-8" hit the output token limit before finishing its answer.');
        await expect(ask('claude-opus-4-8', record(reply({ stop_reason: 'end_turn', content: [] })).customFetch))
            .rejects.toThrow('Model "claude-opus-4-8" returned an empty response (stop_reason: end_turn).');
    });

    it('gives an unlisted model the next attempt when thinking ate the budget', async () => {
        const { bodies, customFetch } = record(index => (index === 0
            ? Response.json({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] })
            : Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"lines":[]}' }] })));
        expect(await ask('claude-nova-6-2', customFetch)).toBe('{"lines":[]}');
        expect(bodies.map(body => body.max_tokens)).toEqual([8192, 8192 + 24576]);
    });

    it('shows the provider\'s error type and message, with the key redacted', async () => {
        const echoed = reply({ type: 'error', error: { type: 'invalid_request_error', message: `max_tokens: too large (x-api-key: ${KEY})` } }, 400);
        await expect(ask('claude-haiku-5-5', record(echoed).customFetch))
            .rejects.toThrow('Anthropic API error (400): invalid_request_error: max_tokens: too large (x-api-key: ***');
    });

    it('tests with the segmentation switch and passes an empty reply with a reason', async () => {
        const hello = record(reply({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello!' }] }));
        expect(await test('claude-haiku-5-5', hello.customFetch)).toMatchObject({ ok: true, status: 200, text: 'Hello!', model: 'claude-haiku-5-5' });
        expect(hello.bodies).toEqual([{
            model: 'claude-haiku-5-5',
            max_tokens: 512,
            messages: [{ role: 'user', content: 'hello' }],
            thinking: DISABLED,
            output_config: { effort: 'low' },
        }]);

        const cut = record(reply({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] }));
        expect(await test('claude-opus-5-5', cut.customFetch)).toMatchObject({ ok: true, text: '', emptyReason: 'reasoning' });
        expect(cut.bodies[0].max_tokens).toBe(4096);
        const empty = record(reply({ stop_reason: 'end_turn', content: [] }));
        expect(await test('claude-opus-4-8', empty.customFetch)).toMatchObject({ ok: true, text: '', emptyReason: 'empty' });
    });

    it('fails the test on a refusal, an HTTP error or a timeout', async () => {
        const refused = record(reply({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null }, content: [] }));
        expect(await test('claude-opus-5-5', refused.customFetch)).toMatchObject({ ok: false, errorKind: 'http', error: 'Model refused request' });

        const denied = record(reply({ type: 'error', error: { type: 'authentication_error', message: `invalid key ${KEY}` } }, 401));
        const failed = await test('claude-opus-5-5', denied.customFetch);
        expect(failed).toMatchObject({ ok: false, status: 401, errorKind: 'http', error: 'Anthropic API error (401): authentication_error: invalid key ***' });

        const stalled = (_url: string, init: any) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
        expect(await test('claude-opus-5-5', stalled, 5)).toMatchObject({ ok: false, errorKind: 'timeout', error: 'Request to https://api.anthropic.com/v1/messages timed out after 0s' });
    });
});
