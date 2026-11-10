import { budgetFor } from '../../../shared/ai/aiTasks.mjs';
import { walkAttempts } from '../../../shared/ai/attemptRunner.mjs';
import { buildCompatibleBody } from '../../../shared/ai/compatibleBody.mjs';
import { getAiAdapter, type AiAdapter, type AiAttempt } from '../../../shared/ai/providerRegistry.mjs';
import {
    SEGMENTATION_GEMINI_SCHEMA,
    SEGMENTATION_JSON_SCHEMA,
    SEGMENTATION_MAX_OUTPUT_TOKENS,
    SEGMENTATION_SCHEMA_NAME,
} from '../../../shared/lyricSegmentationPrompt.mjs';

// test/unit/ai/adapterHarness.ts
// Shared helper for the per-provider adapter tests (test/unit/ai/<id>Adapter.test.ts): what one
// adapter sends for a task and a model, attempt by attempt, built exactly as the desktop and the
// web routes build it, and how the shared runner walks those attempts against scripted replies.
// No request leaves the test.
//
//   const [first, second] = requestsFor('glm', 'segmentation', 'glm-5.3-flash');
//   expect(first.body).toMatchObject({ reasoning_effort: 'low', max_tokens: 8192 + 24576 });
//   const { bodies } = await simulate('glm', 'segmentation', 'glm-5.2', (_body, index) => (
//       index === 0 ? rejectedWith(400, { error: { code: '1210', message: 'Invalid API parameter' } }) : answered('{}')));

export type AiTask = 'segmentation' | 'theme' | 'test';

/** The answer budgets the real callers pass: main.cjs's two handlers and the connection test. */
export const ANSWER_TOKENS: Record<AiTask, number> = {
    segmentation: SEGMENTATION_MAX_OUTPUT_TOKENS,
    theme: 8192,
    test: 512,
};

// main.cjs's theme schema cannot be imported (main.cjs starts the app); this stands in for it. Like
// the real one, every object is closed (Anthropic's structured outputs refuse an open one).
const THEME_SIDE_SCHEMA = { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } }, required: ['name'] };
const THEME_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { light: THEME_SIDE_SCHEMA, dark: THEME_SIDE_SCHEMA },
    required: ['light', 'dark'],
};
const THEME_GEMINI_SCHEMA = { type: 'OBJECT', properties: { light: { type: 'OBJECT' }, dark: { type: 'OBJECT' } } };

/** The prompts and schemas each task is asked with. The test is a bare "hello". */
export const ASKS: Record<AiTask, { systemPrompt?: string; sourcePrompt: string; schema?: object; schemaName?: string; geminiSchema?: object }> = {
    segmentation: {
        systemPrompt: 'segmentation system prompt',
        sourcePrompt: 'la la la',
        schema: SEGMENTATION_JSON_SCHEMA,
        schemaName: SEGMENTATION_SCHEMA_NAME,
        geminiSchema: SEGMENTATION_GEMINI_SCHEMA,
    },
    theme: {
        systemPrompt: 'theme system prompt',
        sourcePrompt: 'Pure instrumental: no\nSource snippet:\nla la la',
        schema: THEME_SCHEMA,
        schemaName: 'dual_theme',
        geminiSchema: THEME_GEMINI_SCHEMA,
    },
    test: { sourcePrompt: 'hello' },
};

/** The user's temperature when none is set (DEFAULT_OPENAI_TEMPERATURE). */
export const DEFAULT_TEMPERATURE = 0.7;

export type RequestOptions = { temperature?: number; stream?: boolean; answerTokens?: number };
export type AdapterRequest = { attempt: AiAttempt; budget: number | undefined; body: Record<string, any> };

/** The adapter registered under `id` (or the adapter itself), failing loudly for an unknown id. */
export const adapterOf = (adapter: string | AiAdapter): AiAdapter => {
    if (typeof adapter !== 'string') return adapter;
    const found = getAiAdapter(adapter);
    if (!found) throw new Error(`No adapter registered as ${adapter}`);
    return found;
};

/** One attempt's body, built the way the senders build it (compatibleBody for 'openai', the adapter's own otherwise). */
export const bodyFor = (adapter: string | AiAdapter, task: AiTask, model: string, attempt: AiAttempt, options: RequestOptions = {}) => {
    const resolved = adapterOf(adapter);
    const budget = budgetFor(task, options.answerTokens ?? ANSWER_TOKENS[task], attempt);
    const request = {
        task,
        model,
        attempt,
        ...ASKS[task],
        budget,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        stream: options.stream,
    };
    if (resolved.protocol === 'openai') {
        return { budget, body: buildCompatibleBody(resolved, request) as Record<string, any> };
    }
    if (!resolved.buildBody) throw new Error(`${resolved.id} speaks ${resolved.protocol} but has no buildBody`);
    return { budget, body: resolved.buildBody(request) as Record<string, any> };
};

/** Every attempt the adapter gives for `task` and `model`, in order, with its budget and body. */
export const requestsFor = (adapter: string | AiAdapter, task: AiTask, model: string, options: RequestOptions = {}): AdapterRequest[] => (
    adapterOf(adapter).attempts(task, model).map((attempt: AiAttempt) => ({ attempt, ...bodyFor(adapter, task, model, attempt, options) }))
);

/** Shorthand for the first attempt's body. */
export const firstBody = (adapter: string | AiAdapter, task: AiTask, model: string, options: RequestOptions = {}) => (
    requestsFor(adapter, task, model, options)[0].body
);

/**
 * Where the token cap and the reasoning switches sit for this protocol: OpenAI-compatible and
 * Anthropic bodies keep them at the top level, Gemini inside generationConfig.
 */
export const capOf = (adapter: string | AiAdapter, body: Record<string, any>) => {
    const resolved = adapterOf(adapter);
    return resolved.protocol === 'gemini' ? body.generationConfig?.maxOutputTokens : body[resolved.tokenField];
};

export type SendResult = {
    ok: boolean;
    status?: number;
    errorText?: string;
    errorBody?: string;
    content?: string | null;
    exhausted?: boolean;
};

/** A successful reply carrying `content`. */
export const answered = (content: string): SendResult => ({ ok: true, status: 200, content });
/** A successful reply with nothing in it because reasoning used up the budget. */
export const exhaustedReply = (): SendResult => ({ ok: true, status: 200, content: '', exhausted: true });
/** A failed reply whose raw error body is `body` (JSON-encoded unless already a string). */
export const rejectedWith = (status: number, body: unknown): SendResult => {
    const errorBody = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: false, status, errorBody, errorText: `API error (${status}): ${errorBody}` };
};

/**
 * Walks the adapter's attempts with the shared runner against scripted replies (`reply(body, index)`),
 * nothing remembered between calls. Returns every body sent and the runner's outcome.
 */
export const simulate = async (
    adapter: string | AiAdapter,
    task: AiTask,
    model: string,
    reply: (body: Record<string, any>, index: number) => SendResult,
    options: RequestOptions = {},
) => {
    const resolved = adapterOf(adapter);
    const bodies: Record<string, any>[] = [];
    const outcome = await walkAttempts({
        adapter: resolved,
        task,
        url: resolved.endpoints[0]?.baseUrl || 'https://endpoint.test/v1',
        model,
        attempts: resolved.attempts(task, model),
        cache: null,
        send: async (attempt: AiAttempt, index: number) => {
            const { body } = bodyFor(resolved, task, model, attempt, options);
            bodies.push(body);
            return reply(body, index);
        },
    });
    return { bodies, outcome };
};
