// shared/ai/kimi.mjs
// Moonshot's Kimi: the China site (api.moonshot.cn) and the international one (api.moonshot.ai),
// whose keys do not work on each other. Thinking is set per model (kimi-k2.6 is the only model on
// sale that can switch it off), the temperature is never sent (sampling is fixed), the cap is
// max_completion_tokens and the answer comes in plain JSON mode. Sources in brackets are listed in
// shared/ai/SOURCES.md.

// The only model on sale whose thinking can be switched off. [Kimi·models]
const DEFAULT_KIMI_MODEL = 'kimi-k2.6';

const THINKING_OFF = Object.freeze({
    label: 'thinking=disabled',
    reasoningOff: true,
    params: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }) }),
    knobs: Object.freeze(['thinking']),
});
const EFFORT_LOW = Object.freeze({
    label: 'reasoning_effort=low',
    reasoningOff: false,
    params: Object.freeze({ reasoning_effort: 'low' }),
    knobs: Object.freeze(['reasoning_effort']),
});
// Nothing reasoning-related, with room to reason: for models that always think and take no level.
const THINKING_ON = Object.freeze({ label: 'plain', reasoningOff: false, params: Object.freeze({}), knobs: Object.freeze([]) });

// `thinking: disabled` switches k2.6 off. [Kimi·thinking]
const SWITCHES_OFF = /^kimi-k2\.6(?:-|$)/;
// k3 always reasons and takes no `thinking` at all; its levels are low, high and max. [Kimi·reasoning-effort][Kimi·k3]
const LEVELS_ONLY = /^kimi-k3(?:-|$)/;
// The k2.7 code models always think: `disabled` is an error and there are no levels. [Kimi·thinking]
const ALWAYS_ON = /^kimi-k2\.7-code(?:-|$)/;

/**
 * Thinking per model, the same for every ask (off where it can be, else the lowest
 * level). Any other model starts with the switch, moves to the low level when the switch is
 * rejected by name (or does not stop the reasoning), and finally sends nothing. Neither k3 nor
 * k2.6 is sent the other's parameter, since what they do with it is not documented.
 */
const attemptsFor = (_task, model) => {
    const name = String(model ?? '').trim().toLowerCase();
    if (SWITCHES_OFF.test(name)) {
        return [THINKING_OFF];
    }
    if (LEVELS_ONLY.test(name)) {
        return [EFFORT_LOW];
    }
    if (ALWAYS_ON.test(name)) {
        return [THINKING_ON];
    }
    return [THINKING_OFF, EFFORT_LOW, THINKING_ON];
};

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const kimiAdapter = {
    id: 'kimi',
    label: 'Kimi',
    protocol: 'openai',
    hosts: ['api.moonshot.cn', 'api.moonshot.ai'],
    // The two sites' keys are not interchangeable. [Kimi·overview][Kimi·list-models]
    endpoints: [
        { id: 'cn', baseUrl: 'https://api.moonshot.cn/v1' },
        { id: 'global', baseUrl: 'https://api.moonshot.ai/v1' },
    ],
    defaultModel: DEFAULT_KIMI_MODEL,
    recommendedModel: DEFAULT_KIMI_MODEL,
    // Never sent: the models on sale sample at fixed values, and "any other value will result in
    // an error". [Kimi·chat]
    temperature: null,
    stream: true,
    // max_tokens is deprecated. [Kimi·chat]
    tokenField: 'max_completion_tokens',
    attempts: attemptsFor,
    // Kimi also takes a strict json_schema, but how its validator reads our schemas is unverified
    // and k2.6 is unsteady with complex ones, so plain JSON mode for now. [Kimi·response_format]
    responseFormat: () => ({ type: 'json_object' }),
    // GET /v1/models: `data[].id`, no display name, one page. [Kimi·list-models]
    models: {
        rows: (json) => json.data,
        id: (row) => row.id,
        name: () => undefined,
        keep: () => true,
        next: () => null,
    },
    // [Kimi·changelog]
    retired: [
        /^kimi-k2\.5(?:-|$)/,
        /^moonshot-v1-/,
        /^kimi-k2-/,
        /^kimi-latest(?:-|$)/,
        /^kimi-thinking-preview$/,
    ].map((pattern) => ({ pattern, replacement: DEFAULT_KIMI_MODEL })),
    alwaysThinks: (model) => LEVELS_ONLY.test(model) || ALWAYS_ON.test(model),
};
