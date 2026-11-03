// shared/ai/openai.mjs
// OpenAI itself: api.openai.com and its data-residency subdomains (eu., jp. and so on). Reasoning
// is set per model family with the top-level `reasoning_effort` (never 'minimal'), temperature is
// never sent, the cap is `max_completion_tokens`, the schema goes as a strict json_schema, and a
// streamed request asks for the usage chunk so "reasoning ate the budget" can still be recognised.
// Sources in brackets are listed in shared/ai/SOURCES.md.

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';

/** One `reasoning_effort` attempt; only 'none' expects no reasoning at all. */
const effort = (value) => Object.freeze({
    label: `reasoning_effort=${value}`,
    reasoningOff: value === 'none',
    params: Object.freeze({ reasoning_effort: value }),
    knobs: Object.freeze(['reasoning_effort']),
});

const EFFORT_NONE = effort('none');
const EFFORT_LOW = effort('low');
// A model that does not reason (GPT-4 and older): no reasoning parameter, the answer's budget only.
const NOT_REASONING = Object.freeze({ label: 'plain', reasoningOff: true, params: Object.freeze({}), knobs: Object.freeze([]) });
// The last resort for a model we do not know: nothing reasoning-related, with room to reason.
const LAST_RESORT = Object.freeze({ label: 'plain', reasoningOff: false, params: Object.freeze({}), knobs: Object.freeze([]) });

// A dated snapshot (gpt-6-luna-2026-05-01) behaves as its model.
const SNAPSHOT = '(?:-\\d{4}-\\d{2}-\\d{2})?$';
// 'none' switches reasoning off; the theme asks for 'low'. [OpenAI·reasoning][OpenAI·latest-model] and each model page
const SWITCHES_OFF = new RegExp(`^(?:gpt-6-luna|gpt-6-sol|gpt-5\\.6-luna|gpt-5\\.6-terra)${SNAPSHOT}`);
// No 'none' (astra answers it with a 400): 'low' for every ask. [OpenAI·gpt-6-astra][OpenAI·gpt-6.1-sol]
const LOW_ONLY = new RegExp(`^(?:gpt-6-astra|gpt-6\\.1-sol)${SNAPSHOT}`);
// Older chat models do not take reasoning_effort at all.
const NOT_REASONING_MODEL = /^(?:gpt-4|gpt-3\.5|chatgpt-4o)/;
// The o-series reasons whatever is asked (low is its lowest level).
const O_SERIES = /^o\d/;

/** The model's family name: lower case, a fine-tune (`ft:gpt-…:org::id`) as its base model. */
const familyOf = (model) => String(model ?? '').trim().toLowerCase().replace(/^ft:([^:]+)(?::.*)?$/, '$1');

/**
 * Reasoning per model family. Segmentation and the connection test switch reasoning off where the
 * model can ('none'), and otherwise ask for the lowest level; the theme always asks for 'low' (as
 * little thinking as still thinks). An unknown model, other gpt-5/gpt-6 and the o-series included,
 * starts with what is likely to work and moves down when the endpoint names reasoning_effort as
 * rejected; its last attempt sends nothing and leaves room to reason, for models that take no
 * reasoning_effort at all (the `-chat-latest` aliases, for one). [OpenAI·reasoning]
 */
const attemptsFor = (task, model) => {
    const family = familyOf(model);
    if (NOT_REASONING_MODEL.test(family)) {
        return [NOT_REASONING];
    }
    if (LOW_ONLY.test(family)) {
        return [EFFORT_LOW];
    }
    if (SWITCHES_OFF.test(family)) {
        return [task === 'theme' ? EFFORT_LOW : EFFORT_NONE];
    }
    return task === 'theme' ? [EFFORT_LOW, LAST_RESORT] : [EFFORT_NONE, EFFORT_LOW, LAST_RESORT];
};

// The model listing keeps chat models only. [OpenAI·models-list] The -pro models (gpt-5-pro,
// o3-pro, o1-pro) and the codex ones answer on the Responses API only; these asks use Chat
// Completions, so they would be refused on the first request.
const CHAT_MODEL = /^(?:ft:)?(?:gpt-|o\d|chatgpt-)/;
const NOT_CHAT = /tts|transcribe|realtime|audio|image|embedding|moderation|search|dall-e|whisper|codex/;
const RESPONSES_ONLY_PRO = new RegExp(`-pro${SNAPSHOT}`);

/** True when the row's `shutdown_date` (a YYYY-MM-DD string, or null) has been reached. [OpenAI·models-list] */
export const isShutDown = (row, now = Date.now()) => {
    const date = row && row.shutdown_date;
    if (typeof date !== 'string' || !date.trim()) {
        return false;
    }
    const time = Date.parse(date.trim());
    return Number.isFinite(time) && time <= now;
};

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const openaiAdapter = {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    hosts: ['api.openai.com'],
    // Data-residency subdomains such as eu.api.openai.com. [OpenAI·your-data]
    hostSuffixes: ['.openai.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.openai.com/v1' }],
    defaultModel: DEFAULT_OPENAI_MODEL,
    recommendedModel: DEFAULT_OPENAI_MODEL,
    // Never sent: a reasoning model asked with a temperature answers 400, and one rule for every
    // model is simpler than telling which ones have reasoning off. [OpenAI·latest-model][khoj#1377]
    temperature: null,
    stream: true,
    // Without the usage chunk a streamed reply carries no reasoning_tokens, and an answer the
    // reasoning ate would look like a plain empty one. [OpenAI·chat]
    streamExtras: { stream_options: { include_usage: true } },
    // Counts reasoning tokens too; max_tokens is deprecated here. [OpenAI·chat]
    tokenField: 'max_completion_tokens',
    attempts: attemptsFor,
    responseFormat: (_model, schema, schemaName) => (schema && schemaName
        ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
        : { type: 'json_object' }),
    // GET /v1/models, one page. [OpenAI·models-list]
    models: {
        rows: (json) => json.data,
        id: (row) => row.id,
        name: () => undefined,
        keep: (row, id) => {
            const name = id.toLowerCase();
            return CHAT_MODEL.test(name) && !NOT_CHAT.test(name) && !RESPONSES_ONLY_PRO.test(name) && !isShutDown(row);
        },
        next: () => null,
    },
    // Shut down, or shutting down on 2026-10-23. [OpenAI·deprecations]
    retired: [
        /^gpt-3\.5-turbo(?:-|$)/,
        /^gpt-4(?:-\d{4})?$/,
        /^gpt-4-turbo(?:-|$)/,
        /^gpt-4\.1-nano(?:-|$)/,
        /^gpt-4o-2024-05-13$/,
        /^o1(?:-pro)?(?:-\d{4}-\d{2}-\d{2})?$/,
        /^o3-mini(?:-\d{4}-\d{2}-\d{2})?$/,
        /^o4-mini(?:-\d{4}-\d{2}-\d{2})?$/,
        /^gpt-5\.[23]-chat-latest$/,
    ].map((pattern) => ({ pattern, replacement: DEFAULT_OPENAI_MODEL })),
    alwaysThinks: (model) => {
        const family = familyOf(model);
        return LOW_ONLY.test(family) || O_SERIES.test(family);
    },
};
