import { COMPATIBLE_MODEL_CATALOGUE, rejectsCompatibleParameter } from './compatibleBody.mjs';

// shared/ai/qwen.mjs
// Alibaba Cloud Model Studio (Qwen) in compatible mode. Keys are bound to their region, so each
// region is its own site; workspace-dedicated domains end in .maas.aliyuncs.com. Coding Plan and
// Token Plan are for AI coding tools only and get no site [Qwen·base-url].
//
// Thinking: the hybrid models (Qwen3.5 and later, qwen-plus, qwen-flash) take a top-level
// `enable_thinking: false` on every ask; the few thinking-only models are turned down instead of
// off. The token cap is `max_tokens`, which on Qwen bounds the answer only [Qwen·openai-chat].
// Every other model, the hybrid ones included, starts with `enable_thinking: false` and falls back
// to sending nothing.

/** One request shape whose knobs are exactly the parameters it sends. */
const attempt = (label, params, reasoningOff) => Object.freeze({
    label,
    reasoningOff,
    params: Object.freeze(params),
    knobs: Object.freeze(Object.keys(params)),
});

// "Must be top-level when calling over HTTP" [Qwen·deep-thinking].
const THINKING_OFF = attempt('enable_thinking=false', { enable_thinking: false }, true);
// qwen3.8 models take low / medium / xhigh; low is a 4096-token thinking budget, and it cannot be
// sent together with thinking_budget [Qwen·openai-chat].
const EFFORT_LOW = attempt('effort=low', { reasoning_effort: 'low' }, false);
// The qwen3.7 thinking-only models have no effort levels, only a cap on the chain of thought
// [Qwen·deep-thinking].
const THINKING_BUDGET = attempt('thinking_budget=2048', { thinking_budget: 2048 }, false);
// Nothing reasoning-related: a thinking-only model thinks at its default, so budget for it.
const THINKING_DEFAULT = attempt('plain', {}, false);
// Nothing reasoning-related, for a model that never thinks.
const NO_THINKING = attempt('plain', {}, true);

const EFFORT_ONLY = Object.freeze([EFFORT_LOW]);
const BUDGET_ONLY = Object.freeze([THINKING_BUDGET]);
const DEFAULT_ONLY = Object.freeze([THINKING_DEFAULT]);
const PLAIN_ONLY = Object.freeze([NO_THINKING]);
// The hybrid models take `enable_thinking: false` [Qwen·deep-thinking], yet the error-code page
// gives qwen3.7-plus, hybrid by the deep-thinking page, as its example of a model that answers it
// with "The value of the enable_thinking parameter is restricted to True" [Qwen·error-code]. So the
// switch is followed by sending nothing, which only costs a request when the switch is refused.
const SWITCH_THEN_DEFAULT = Object.freeze([THINKING_OFF, THINKING_DEFAULT]);

// Thinking-only models [Qwen·deep-thinking]: enable_thinking:false is refused ("restricted to True").
const isEffortThinker = (model) => /^qwen3\.8-2\.4t-a95b(?:$|-)/.test(model);
const BUDGET_THINKERS = new Set(['qwen3.7-max-preview', 'qwen3.7-max-2026-05-17']);

// qwen-max (and its snapshots) does not think at all.
const isNonThinking = (model) => /^qwen-max(?:$|-)/.test(model);

// The series the structured-output guide lists for json_schema strict; every other model gets
// json_object [Qwen·structured-output].
const takesJsonSchema = (model) => /^qwen3\.[78]-(?:max|plus|flash)/.test(model);

// Model Studio's own wording for a switch a model does not take [Qwen·error-code]: "The value of
// the enable_thinking parameter is restricted to True.", "The model xxx does not support
// enable_thinking.", "The thinking_budget parameter must be a positive integer and not greater
// than xxx". None names the field the way the shared check expects.
const rejectedInQwenWords = (errorBody, knob) => {
    const name = knob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
        `\\bthe value of the ["'\`]?${name}["'\`]? parameter is restricted\\b`
            + `|\\bdoes not support ["'\`]?${name}\\b`
            + `|\\bthe ["'\`]?${name}["'\`]? parameter must be\\b`,
        'i',
    ).test(errorBody);
};

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const qwenAdapter = {
    id: 'qwen',
    label: 'Alibaba Cloud Qwen',
    protocol: 'openai',
    hosts: [
        'dashscope.aliyuncs.com',
        'dashscope-intl.aliyuncs.com',
        'dashscope-us.aliyuncs.com',
        'cn-hongkong.dashscope.aliyuncs.com',
    ],
    hostSuffixes: ['.maas.aliyuncs.com'],
    endpoints: [
        { id: 'cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        { id: 'singapore', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
        { id: 'us', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
        { id: 'hongkong', baseUrl: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1' },
    ],
    // [Qwen·models]
    defaultModel: 'qwen3.8-flash',
    recommendedModel: 'qwen3.8-flash',
    // Offered when the compatible-mode catalogue (whose shape is undocumented) fails or is empty.
    suggestedModels: ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max'],
    // [0, 2): 2 itself is rejected ("Temperature should be in [0.0, 2.0)") [Qwen·openai-chat].
    temperature: { min: 0, max: 1.99 },
    stream: true,
    // Bounds the answer only on Qwen; max_completion_tokens exists for new models only [Qwen·openai-chat].
    tokenField: 'max_tokens',
    attempts(task, model) {
        const name = String(model ?? '').trim().toLowerCase();
        if (isEffortThinker(name)) {
            // The theme too: "as low as possible" is low here.
            return EFFORT_ONLY;
        }
        if (BUDGET_THINKERS.has(name)) {
            // A capped chain of thought for the mechanical asks; the theme keeps the default.
            return task === 'theme' ? DEFAULT_ONLY : BUDGET_ONLY;
        }
        if (isNonThinking(name)) {
            return PLAIN_ONLY;
        }
        // Hybrid (every Qwen3.5 and later model that is not thinking-only, qwen-plus, qwen-flash and
        // their snapshots [Qwen·deep-thinking]) or not named here: the switch, then nothing.
        return SWITCH_THEN_DEFAULT;
    },
    responseFormat: (model, schema, schemaName) => (schema && schemaName && takesJsonSchema(String(model ?? '').toLowerCase())
        ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
        : { type: 'json_object' }),
    rejectedParameter: (status, errorBody, knob) => rejectsCompatibleParameter(status, errorBody, knob)
        || ((status === 400 || status === 422) && rejectedInQwenWords(String(errorBody ?? ''), knob)),
    // `GET <base>/models` exists in compatible mode but its shape is undocumented [Qwen·list-models]:
    // read either OpenAI's `data[].id` or the native list's `output.models[].model` (with its display
    // `name` and page_no paging).
    models: {
        rows: (json) => json.data ?? json.output?.models,
        id: (row) => row.id ?? row.model,
        name: (row) => row.name,
        keep: () => true,
        next: (json, rows, page) => {
            const output = json.output;
            if (output && Array.isArray(output.models)) {
                const pageNo = Number(output.page_no) || page + 1;
                const pageSize = Number(output.page_size) || rows.length;
                return pageSize && pageNo * pageSize < Number(output.total)
                    ? { param: 'page_no', value: String(pageNo + 1) }
                    : null;
            }
            return COMPATIBLE_MODEL_CATALOGUE.next(json, rows, page);
        },
    },
    alwaysThinks: (model) => isEffortThinker(model) || BUDGET_THINKERS.has(model),
};
